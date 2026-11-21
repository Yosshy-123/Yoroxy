/*
 * Classification of "the other side went away" network errors.
 *
 * A proxy sees these constantly: a user closes a tab mid-download, an
 * upstream site drops a connection, a mobile client loses signal. They are
 * not bugs in this server and must not take it down. Everything else still
 * is a bug and must be loud.
 *
 * No dependencies, so it can be unit-tested without starting the server.
 */

/* Error codes that mean a connection ended or timed out. Matched by code
 * only: codes are stable across Node versions, message text is not. */
const IGNORABLE_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_STREAM_PREMATURE_CLOSE', // a pipe ended early because a peer left
  'UND_ERR_SOCKET',             // undici: socket closed
  'UND_ERR_ABORTED',            // undici: request aborted
  'ABORT_ERR',                  // AbortController / AbortSignal
  'HPE_INVALID_EOF_STATE',      // the peer closed the socket in the middle of a request
]);

/* Exact messages of abort errors that carry no code. Exact match on
 * purpose: a substring test would also swallow unrelated errors whose
 * message happens to contain the word. */
const IGNORABLE_MESSAGES = new Set(['aborted', 'socket hang up']);

/* Wrapped errors (e.g. undici's "fetch failed") keep the real reason in
 * `cause`; follow it, but never loop forever on a cyclic chain. */
const MAX_CAUSE_DEPTH = 3;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

export function isIgnorableNetworkError(err, depth = 0) {
  if (!isObject(err) || depth > MAX_CAUSE_DEPTH) return false;

  if (typeof err.code === 'string' && IGNORABLE_CODES.has(err.code)) return true;
  if (err.name === 'AbortError') return true;
  if (typeof err.message === 'string' && IGNORABLE_MESSAGES.has(err.message)) return true;

  return isIgnorableNetworkError(err.cause, depth + 1);
}

/* True when the error (or its cause chain) is a timeout. */
function isTimeout(err, depth = 0) {
  if (!isObject(err) || depth > MAX_CAUSE_DEPTH) return false;
  return err.code === 'ETIMEDOUT' || isTimeout(err.cause, depth + 1);
}

/*
 * HTTP status to answer an ignorable error with, if a response can still be
 * sent. 499 is the de-facto "client closed request"; a timeout is not the
 * client's doing, so it is reported as 504 Gateway Timeout instead.
 */
export function statusForIgnorableError(err) {
  return isTimeout(err) ? 504 : 499;
}
