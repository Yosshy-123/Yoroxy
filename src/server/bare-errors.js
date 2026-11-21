/*
 * Bare answers its own failures (bad request headers, a forbidden address,
 * an unreachable target...) with a JSON body that always includes the
 * server-side stack trace, which contains absolute file paths of this
 * machine. That cannot be switched off in Bare, so the body is rewritten
 * before it leaves: the `stack` member is removed, everything else (code, id,
 * message) is kept because clients such as Ultraviolet rely on it.
 *
 * Only Bare's own errors are touched: those are the responses with an HTTP
 * status of 400 or above. A proxied response is always sent with status 200
 * (the target's status travels in the x-bare-status header).
 */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

export function hideBareErrorDetails(res) {
  const writeHead = res.writeHead.bind(res);
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  let chunks = null;
  let size = 0;

  res.writeHead = (status, ...rest) => {
    if (status >= 400) {
      chunks = [];
      // The length changes when the body is rewritten: let it be chunked.
      const headers = rest.find((arg) => arg && typeof arg === 'object');
      if (headers) for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-length') delete headers[key];
      res.removeHeader('Content-Length');
    }
    return writeHead(status, ...rest);
  };

  const collect = (chunk, encoding) => {
    if (chunk == null) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    size += buffer.length;
    if (size <= MAX_ERROR_BODY_BYTES) chunks.push(buffer);
  };

  res.write = (chunk, encoding, callback) => {
    if (!chunks) return write(chunk, encoding, callback);
    collect(chunk, encoding);
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };

  res.end = (chunk, encoding, callback) => {
    if (!chunks) return end(chunk, encoding, callback);
    if (typeof chunk !== 'function') collect(chunk, encoding);
    let body = Buffer.concat(chunks);
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed && typeof parsed === 'object') {
        delete parsed.stack;
        body = Buffer.from(JSON.stringify(parsed, null, '\t'));
      }
    } catch {
      body = Buffer.from('{}'); // not the JSON Bare normally sends: say nothing
    }
    const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : callback;
    return end(body, done);
  };
}
