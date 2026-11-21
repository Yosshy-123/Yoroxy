/*
 * Starts the app the way the E2E suite needs it, as its own process (the
 * harness spawns this file; production uses index.js):
 *
 *   - local targets allowed for everyone (testOnly): the suite proxies a loopback
 *     fixture server. Its browser runs on this machine and would be let
 *     through by the "person on this machine" rule anyway; the switch keeps
 *     the suite independent of that rule. It is injected here, not read from
 *     the environment, so index.js has no way to turn it on.
 *   - rate limiting off: one test client makes far more /bare/ requests than
 *     a person would (SEC-T6 tests the limiter on a server of its own).
 *   - test hooks on: window.Yoroxy stays reachable from the tests.
 *
 * PORT is the only environment variable used.
 */
import { readConfig } from '../../src/server/config.js';
import { createServer } from '../../src/server/create-server.js';
import { installLifecycle } from '../../src/server/lifecycle.js';

const { port } = readConfig(process.env);
const app = createServer({ testOnly: { allowLocalTargets: true, disableRateLimit: true, exposeTestHooks: true } });
installLifecycle(app);
app.server.listen(port, () => {
  console.log(`Server Listening on ${app.server.address().port}`);
});
