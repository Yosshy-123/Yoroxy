/*
 * Process lifecycle: signals, last-resort error handling and shutdown.
 * Only the entry point (index.js) and test/support/start-app.mjs install
 * this; createServer() itself never touches the process.
 */
import { isIgnorableNetworkError } from './network-errors.js';

const FORCE_EXIT_MS = 5000;

/*
 * `app` is what createServer() returned. Returns { shutdown }.
 *
 * Continuing after an uncaught exception is unsafe in general (Node's docs
 * recommend restarting), so it is allowed ONLY for a dropped-connection error:
 * those come from a socket that is already gone and leave no shared state
 * half-updated. Anything else is a bug: log it and exit; the host restarts us.
 */
export function installLifecycle(app, { proc = process, forceExitMs = FORCE_EXIT_MS } = {}) {
  let shuttingDown = false;

  function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('Shutting down...');

    const forceExitTimer = setTimeout(() => {
      console.error('Forced exit after shutdown timeout');
      proc.exit(exitCode || 1);
    }, forceExitMs);
    forceExitTimer.unref();

    app.close().then(
      () => {
        clearTimeout(forceExitTimer);
        proc.exit(exitCode);
      },
      (err) => {
        console.error('shutdown error:', err);
        clearTimeout(forceExitTimer);
        proc.exit(1);
      }
    );
  }

  proc.on('uncaughtException', (err) => {
    if (isIgnorableNetworkError(err)) return;
    console.error('uncaughtException:', err);
    shutdown(1);
  });

  proc.on('unhandledRejection', (reason) => {
    if (isIgnorableNetworkError(reason)) return;
    console.error('unhandledRejection:', reason);
    shutdown(1);
  });

  proc.on('SIGINT', () => shutdown(0));
  proc.on('SIGTERM', () => shutdown(0));

  return { shutdown };
}
