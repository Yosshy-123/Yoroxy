/*
 * An app server configured like production as far as the pages go (no test
 * hooks, so window.Yoroxy is removed once a page has started), in this
 * process on an ephemeral port. It still allows loopback targets and has no
 * rate limit, because the suite proxies the loopback fixture server.
 */
import { createServer } from '../../src/server/create-server.js';

export async function startProdApp() {
  const app = createServer({ testOnly: { allowLocalTargets: true, disableRateLimit: true } });
  await new Promise((resolve) => app.server.listen(0, 'localhost', resolve));
  return { base: `http://localhost:${app.server.address().port}`, close: app.close };
}
