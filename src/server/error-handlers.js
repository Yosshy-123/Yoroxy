/*
 * Error handling for the HTTP server. A proxy sees dropped connections
 * constantly (a closed tab, an upstream that hangs up); those are classified
 * by network-errors.js, answered quietly where a response is still possible,
 * and never logged. Anything else is a bug and is logged.
 */
import { isIgnorableNetworkError, statusForIgnorableError } from './network-errors.js';

/** Express: 404 for anything no route handled. */
export function notFound(_req, res) {
  res.status(404).json({ error: 'not found' });
}

/** Express error handler (the 4-argument signature is what marks it as one). */
export function expressErrorHandler(err, _req, res, _next) {
  if (isIgnorableNetworkError(err)) {
    if (!res.headersSent) {
      const status = statusForIgnorableError(err);
      return res.status(status).json({ error: status === 504 ? 'timeout' : 'client closed request' });
    }
    return;
  }

  console.error('Express error:', err);

  if (res.headersSent) return;
  res.status(500).json({ error: 'internal error' });
}

/** Per-request stream errors (a request/response whose peer went away). */
export function watchStreams(req, res) {
  req.on('error', (err) => {
    if (!isIgnorableNetworkError(err)) console.warn('Request stream error:', err);
  });
  res.on('error', (err) => {
    if (!isIgnorableNetworkError(err)) console.warn('Response stream error:', err);
  });
}

/** Last-resort handler for an error thrown while routing a plain request. */
export function handleRoutingError(err, res) {
  if (isIgnorableNetworkError(err)) return;

  console.error('Request routing error:', err);

  if (!res.headersSent) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'internal error' }));
  } else {
    res.destroy();
  }
}

/** Last-resort handler for an error thrown while routing an upgrade. */
export function handleUpgradeError(err, socket) {
  if (!isIgnorableNetworkError(err)) console.error('Upgrade routing error:', err);
  socket.destroy();
}

/** Server-level events: malformed requests and listener errors. */
export function installServerErrorHandlers(server) {
  server.on('clientError', (err, socket) => {
    if (isIgnorableNetworkError(err)) {
      socket.destroy();
      return;
    }

    // Not the error object: for a malformed request Node attaches the raw
    // bytes it received (`rawPacket`), which can hold cookies or credentials.
    console.warn('clientError:', err.code || err.name, err.message);

    if (socket.writable && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } else {
      socket.destroy();
    }
  });

  server.on('error', (err) => {
    console.error('HTTP server error:', err);
  });
}
