/*
 * The door to Bare (/bare/): decides which requests reach it, and hands them
 * over. Only this file knows the admission rules for Bare traffic.
 *
 *   - the request must come from a page of this same site (request-guard.js);
 *   - the client must be within its rate limit (rate-limit.js).
 *
 * Which Bare server serves a request depends on who is asking: the person on
 * this machine (isLocalUser) may reach this machine's own addresses through
 * the proxy, anyone else is held back by Bare's SSRF guard (blockLocal), which
 * refuses loopback, private and other non-public addresses.
 *
 * A refused request is answered here (403 / 429) and never reaches Bare. For a
 * plain request the answer is JSON; for a WebSocket upgrade, which has no
 * response object yet, it is a bare HTTP status line on the socket.
 *
 * Depends on request-guard, security-headers and bare-errors. It does not
 * serve pages or static files and does not read process.env.
 */
import http from 'node:http';
import { applySecurityHeaders } from './security-headers.js';
import { hideBareErrorDetails } from './bare-errors.js';
import { clientKey, isLocalUser, isSameSiteRequest } from './request-guard.js';

/**
 * @param {{ bareServer: object, localBareServer?: object, limiter: object|null, trustedProxy?: number }} deps
 *   `bareServer` has the SSRF guard on; `localBareServer` (default: the same
 *   server) has it off and serves the person on this machine.
 *   `limiter` is null when rate limiting is off (tests).
 * @returns {{
 *   handleRequest(req, res): boolean,
 *   handleUpgrade(req, socket, head): boolean,
 *   close(): void,
 * }} handleRequest / handleUpgrade return false when the request is not for
 *   Bare at all (the caller then serves it some other way).
 */
export function createBareGateway({ bareServer, localBareServer = bareServer, limiter, trustedProxy = 0 }) {
  const serverFor = (req) => (isLocalUser(req, trustedProxy) ? localBareServer : bareServer);

  /* true: let Bare handle it. false: already answered (403 / 429). */
  function admit(req, reject) {
    if (!isSameSiteRequest(req, trustedProxy)) {
      reject(403, 'forbidden');
      return false;
    }
    if (limiter && !limiter.take(clientKey(req, trustedProxy))) {
      reject(429, 'rate limited', { 'Retry-After': String(limiter.retryAfterSeconds()) });
      return false;
    }
    return true;
  }

  function handleRequest(req, res) {
    if (!bareServer.shouldRoute(req)) return false;
    applySecurityHeaders(res);
    hideBareErrorDetails(res);
    const reject = (status, error, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify({ error }));
    };
    if (admit(req, reject)) serverFor(req).routeRequest(req, res);
    return true;
  }

  function handleUpgrade(req, socket, head) {
    if (!bareServer.shouldRoute(req)) return false;
    const reject = (status) => {
      socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (admit(req, reject)) serverFor(req).routeUpgrade(req, socket, head);
    return true;
  }

  /** Releases Bare and the limiter's timer. */
  function close() {
    for (const server of new Set([bareServer, localBareServer])) {
      try {
        server.close();
      } catch (err) {
        console.error('bareServer.close error:', err);
      }
    }
    if (limiter) limiter.dispose();
  }

  return { handleRequest, handleUpgrade, close };
}
