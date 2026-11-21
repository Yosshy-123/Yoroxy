/*
 * The Content-Security-Policy text for the pages this server builds.
 * A pure function of the script hashes: no files, no HTTP.
 *
 * script-src lists exactly the page's script hashes and nothing else ('self'
 * is deliberately NOT allowed: it would also allow any same-origin script).
 * style-src is 'self' only: no page uses inline <style> or style="..."
 * markup (styles set from script go through the CSSOM, which the CSP does not
 * govern).
 */

/** The policy for a page whose scripts have the given hashes. */
export function buildCsp(hashes, { sandboxedUi = false } = {}) {
  const scriptSrc = 'script-src ' + (hashes.length ? hashes.map((h) => `'${h}'`).join(' ') : "'none'");
  if (sandboxedUi) {
    // The interface talks to its parent with postMessage only: no network, no
    // frames, no forms. Tab icons arrive as blob:/data: URLs.
    return [
      "default-src 'none'",
      scriptSrc,
      "style-src 'self'",
      'img-src blob: data:',
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
  }
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    // script-src (hashes only) would otherwise also govern the service worker script.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
