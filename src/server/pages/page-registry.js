/*
 * Builds the HTML pages the server itself serves (every .html under public/)
 * once, at start-up, and the table of URL paths that serve them.
 *
 *   - each page is transformed by html-transform.js (integrity / inlining);
 *   - each page gets a Content-Security-Policy (csp.js) that lists exactly
 *     its script hashes, delivered as an HTTP header and as a <meta
 *     http-equiv="Content-Security-Policy"> element inside the page;
 *   - in test mode (exposeTestHooks) <html> gets data-yoroxy-test="1".
 *
 * The CSP only applies to these pages. Proxied sites are served by the
 * service worker as separate documents and are not restricted by it.
 *
 * HTML files are allowed outside assets/ and uv/ only: those two directories
 * are served as plain static files (static-routes.js), so a page there would
 * be sent without its policy. Start-up fails if one exists.
 *
 * One page is special: shell-ui.html, the browser interface, runs in a
 * sandboxed iframe with an opaque origin (see SANDBOXED_UI_PAGES). Scripts
 * fetched by an opaque-origin document are cross-origin requests, so a
 * Subresource Integrity check on them would need CORS headers on every asset.
 * Instead the server writes that page's scripts INTO the HTML, and the CSP
 * lists the hash of each inline script. The page gets a stricter policy too:
 * it needs no network and no frames at all.
 *
 * Scripts are hashed once: after changing a script, restart the server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { transformHtml, scriptHashesIn } from './html-transform.js';
import { buildCsp } from './csp.js';

/*
 * The launcher (index.html) fetches container.html and document.write()s it
 * into an about:blank window it opened. That window is not a response from
 * this server, so the HTTP header never applies to it, and Chromium does not
 * make it inherit the opener's policy either (verified by SEC-T7). The
 * policy therefore also travels inside the HTML, as a <meta> element, which
 * is enforced wherever the markup ends up.
 *
 * INJECTED_PAGES lists the pages whose script-src must additionally admit the
 * scripts of the page injected from them: a browser that does inherit the
 * opener's policy would otherwise apply index.html's policy on top of the
 * shell's own and refuse the shell's scripts.
 */
export const INJECTED_PAGES = Object.freeze({ 'index.html': ['container.html'] });

/* Pages loaded into <iframe sandbox="allow-scripts"> (no allow-same-origin). */
const SANDBOXED_UI_PAGES = Object.freeze(['shell-ui.html']);

/* Directories served as plain static files, never as pages. */
const STATIC_DIRS = /^(?:assets|uv)\//;

function listHtml(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtml(full, base));
    else if (/\.html$/i.test(entry.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/* The meta element comes first in <head>: it only governs what follows it. */
function withMetaCsp(html, csp) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  if (!/<head\b[^>]*>/i.test(html)) throw new Error('page has no <head> to carry the Content-Security-Policy meta element');
  return html.replace(/<head\b[^>]*>/i, (open) => open + meta);
}

function markTestMode(html) {
  return html.replace(/<html\b([^>]*)>/i, (_m, attrs) => `<html${attrs} data-yoroxy-test="1">`);
}

/* Start-up self-check: the finished policy must list every script of the page. */
function assertCspCoversScripts(rel, page) {
  for (const hash of scriptHashesIn(page.html)) {
    if (!page.csp.includes(`'${hash}'`)) {
      throw new Error(`${rel}: a script is missing from the page's Content-Security-Policy`);
    }
  }
}

/**
 * Reads every page under publicDir. Returns
 *   { pages: Map<relPath, { html, csp, hashes }>, routes: Map<urlPath, relPath> }
 * `routes` maps URL paths ('/', '/container.html', '/internal/newtab.html'...)
 * to the page served there.
 */
export function buildShellPages({ publicDir, exposeTestHooks = false }) {
  const root = path.resolve(publicDir);
  const built = new Map();
  for (const rel of listHtml(root)) {
    if (STATIC_DIRS.test(rel)) {
      throw new Error(`${rel}: HTML files are not allowed under assets/ or uv/ (those directories are served as static files)`);
    }
    const { html, hashes } = transformHtml(fs.readFileSync(path.join(root, rel), 'utf8'), root, rel, {
      inline: SANDBOXED_UI_PAGES.includes(rel),
    });
    built.set(rel, { html: exposeTestHooks ? markTestMode(html) : html, hashes });
  }

  const pages = new Map();
  for (const [rel, page] of built) {
    const all = [...page.hashes];
    for (const other of INJECTED_PAGES[rel] || []) {
      const extra = built.get(other);
      if (!extra) continue; // nothing to inject if that page does not exist
      for (const h of extra.hashes) if (!all.includes(h)) all.push(h);
    }
    const csp = buildCsp(all, { sandboxedUi: SANDBOXED_UI_PAGES.includes(rel) });
    const finished = { html: withMetaCsp(page.html, csp), hashes: all, csp };
    assertCspCoversScripts(rel, finished);
    pages.set(rel, finished);
  }

  const routes = new Map();
  for (const rel of pages.keys()) routes.set('/' + rel, rel);
  if (pages.has('index.html')) routes.set('/', 'index.html');

  return { pages, routes };
}
