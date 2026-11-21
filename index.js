/*
 * Entry point: read the configuration, build the server, listen.
 * The server itself lives in src/server/ (see create-server.js).
 */
import { readConfig } from './src/server/config.js';
import { createServer } from './src/server/create-server.js';
import { installLifecycle } from './src/server/lifecycle.js';

let config;
try {
  config = readConfig(process.env);
} catch (err) {
  console.error(`Invalid configuration: ${err.message}`);
  process.exit(1);
}

let app;
try {
  app = createServer({ trustedProxy: config.trustedProxy });
} catch (err) {
  // Typically a page that cannot be served under the CSP (see pages/page-registry.js).
  console.error(`Cannot start: ${err.message}`);
  process.exit(1);
}

installLifecycle(app);

// config.host is undefined unless HOST is set, which listens on every interface.
app.server.listen(config.port, config.host, () => {
  console.log(`Server Listening on ${app.server.address().port}`);
});
