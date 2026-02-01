import express from 'express';
import http from 'node:http';
import { createBareServer } from "@tomphttp/bare-server-node";
import path from 'node:path';

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.PORT) || 8080;

const app = express();
const bareServer = createBareServer('/bare/');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT_DIR, 'public')));
app.use('/uv', express.static(path.join(ROOT_DIR, 'public', 'uv')));

app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return next();
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'), (err) => {
    if (err) next(err);
  });
});

const server = http.createServer((req, res) => {
  try {
    if (bareServer.shouldRoute(req)) return bareServer.routeRequest(req, res);
    return app(req, res);
  } catch (err) {
    console.error('Request handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bareServer.shouldRoute(req)) return bareServer.routeUpgrade(req, socket, head);
  socket.destroy();
});

server.listen(PORT, () => {
  const addr = server.address();
  const port = (addr && typeof addr === 'object') ? addr.port : PORT;
  console.log(`Server listening on port ${port}`);
});

async function shutdown() {
  console.log('Shutting down...');
  await new Promise((resolve) => server.close(() => resolve()));
  try {
    if (typeof bareServer.close === 'function') {
      const maybe = bareServer.close();
      if (maybe && typeof maybe.then === 'function') await maybe;
    }
  } catch (err) {
    console.warn('Error closing bareServer:', err);
  }
  console.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
