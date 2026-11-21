/* Pages that serve tab icons and titles of chosen size and shape. */
import { RED_PNG, page, send } from '../http-helpers.mjs';

/* SEC-T8: an icon of exactly `bytes` bytes, with or without a declared length. */
export function handleIconSized(res, params) {
  const bytes = Number(params.get('bytes')) || 0;
  // A real PNG followed by padding (decoders ignore what follows the image), so a
  // browser can still draw it when it is within the limit.
  const body = Buffer.concat([RED_PNG, Buffer.alloc(Math.max(0, bytes - RED_PNG.length))]).subarray(0, bytes);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  if (params.get('mode') === 'chunked') {
    // No Content-Length: the client can only find out the size by reading.
    const CHUNK = 16 * 1024;
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      res.write(body.subarray(sent, sent + CHUNK));
      sent += CHUNK;
      if (sent >= bytes) {
        clearInterval(timer);
        res.end();
      }
    }, 1);
    res.on('close', () => clearInterval(timer));
  } else {
    res.setHeader('Content-Length', String(bytes));
    res.end(body);
  }
}

export function handleFaviconPage(res, params) {
  const query = `bytes=${Number(params.get('bytes')) || 0}&mode=${params.get('mode') === 'chunked' ? 'chunked' : 'length'}`;
  send(res, 200, page('Favicon Page', '<h1>Favicon Page</h1>', `<link rel="icon" href="/icon-sized?${query}">`));
}

/* TAB-T2: a document.title of `bytes` characters. */
export function handleTitlePage(res, params) {
  const bytes = Number(params.get('bytes')) || 0;
  send(res, 200, page('Title Page (pending)', `<h1>Title Page</h1><script>document.title = 'T'.repeat(${bytes});</script>`));
}
