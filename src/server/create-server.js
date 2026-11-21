/*
 * Assembles the HTTP server. Nothing listens until the caller says so, and
 * nothing here reads process.env or touches process-wide state (see
 * config.js and lifecycle.js), so tests can create and close servers freely.
 *
 *   const { server, close } = createServer({ trustedProxy });
 *   server.listen(port);
 *
 * Options:
 *   publicDir      directory served (default: ../../public)
 *   trustedProxy   reverse proxies in front (see config.js)
 *   testOnly       switches that exist for the test suite and must never be
 *                  set by the real entry point (index.js):
 *     allowLocalTargets  true: Bare may reach loopback / private addresses for
 *                        everyone. Off, only the person on this machine may
 *                        (see bare-gateway.js); everyone else is refused: the
 *                        SSRF guard.
 *     disableRateLimit   true: no per-client rate limit on /bare/
 *     rateLimit          { capacity, refillPerSecond } replacing
 *                        DEFAULT_RATE_LIMIT
 *     exposeTestHooks    keep window.Yoroxy in the served pages
 *
 * Returns { server, close }.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBareServer } from '@tomphttp/bare-server-node';
import { createApp } from './static-routes.js';
import { buildShellPages } from './pages/page-registry.js';
import { createBareGateway } from './bare-gateway.js';
import { createRateLimiter } from './rate-limit.js';
import { isIgnorableNetworkError } from './network-errors.js';
import {
  watchStreams,
  handleRoutingError,
  handleUpgradeError,
  installServerErrorHandlers,
} from './error-handlers.js';

const DEFAULT_PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

/*
 * Generous on purpose: one page load fans out into dozens of /bare/
 * requests, and every tab polls. 300 requests of burst, then 60 per second
 * per client (3600 per minute), is far above any person's browsing and still
 * stops a script from using the server as a bulk relay.
 */
export const DEFAULT_RATE_LIMIT = Object.freeze({ capacity: 300, refillPerSecond: 60 });

/*
 * Keep-alive and header timeouts exceed the 60 s idle timeout common to load
 * balancers (e.g. AWS ALB): a server that closes an idle connection first
 * makes the balancer reuse a dead socket and return sporadic 502s.
 * headersTimeout must be larger than keepAliveTimeout.
 */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 70_000;

export function createServer({ publicDir = DEFAULT_PUBLIC_DIR, trustedProxy = 0, testOnly = {} } = {}) {
  const {
    allowLocalTargets = false,
    disableRateLimit = false,
    rateLimit = DEFAULT_RATE_LIMIT,
    exposeTestHooks = false,
  } = testOnly;

  const root = path.resolve(publicDir);
  const pages = buildShellPages({ publicDir: root, exposeTestHooks });
  const app = createApp({ publicDir: root, pages });
  // Two Bare servers: one with the SSRF guard (refuses loopback, private and
  // other non-public addresses), one without, used only for the person on this
  // machine (bare-gateway.js). A test may drop the guard for everyone.
  const bareServer = createBareServer('/bare/', { legacySupport: false, blockLocal: !allowLocalTargets });
  const localBareServer = allowLocalTargets ? bareServer : createBareServer('/bare/', { legacySupport: false, blockLocal: false });
  const limiter = disableRateLimit ? null : createRateLimiter(rateLimit);
  const gateway = createBareGateway({ bareServer, localBareServer, limiter, trustedProxy });

  const server = http.createServer((req, res) => {
    watchStreams(req, res);

    try {
      if (!gateway.handleRequest(req, res)) app(req, res);
    } catch (err) {
      handleRoutingError(err, res);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', (err) => {
      if (!isIgnorableNetworkError(err)) console.warn('Socket error during upgrade:', err);
    });

    try {
      if (!gateway.handleUpgrade(req, socket, head)) socket.destroy();
    } catch (err) {
      handleUpgradeError(err, socket);
    }
  });

  installServerErrorHandlers(server);
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  let closed = null;
  /** Stops accepting connections, drops idle ones, releases Bare and timers. */
  function close() {
    if (closed) return closed;
    closed = new Promise((resolve) => {
      const finish = () => {
        gateway.close();
        resolve();
      };
      if (!server.listening) {
        finish();
        return;
      }
      server.close(finish);
      server.closeIdleConnections();
    });
    return closed;
  }

  return { server, close };
}
