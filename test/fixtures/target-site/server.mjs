/*
 * Fixture "target" site used by the E2E suite to exercise proxied-page
 * behaviour (links, forms, window.open, favicons, XSS-shaped input, slow
 * responses, etc). Deliberately dependency-free (plain node:http) so the
 * test suite doesn't need a build step.
 *
 * GET /__test/health returns a JSON list of every route below, so a test
 * (or a human) can confirm the fixture matches this file without reading
 * the source.
 *
 * This file lists the routes and dispatches them; the pages are in
 * http-helpers.mjs and routes/*.mjs.
 */
import http from 'node:http';
import { URL } from 'node:url';
import { RED_PNG, page, send } from './http-helpers.mjs';
import { handleHome, handleSlow } from './routes/home.mjs';
import {
  handleXssTitle,
  handleXssFavicon,
  handleTopProbe,
  handleReachProbe,
  handleCspProbe,
  handleExposureProbe,
  handleMsgProbe,
} from './routes/probes.mjs';
import { handleIconSized, handleFaviconPage, handleTitlePage } from './routes/icons.mjs';
import { handleUiAttack } from './routes/ui-attack.mjs';

const PORT = Number(process.env.PORT || 9100);

const ROUTES = [
  { method: 'GET', path: '/', desc: 'Main page with links/buttons/forms exercising every new-tab/new-window path' },
  { method: 'GET', path: '/p2', desc: 'Simple page with a window.close() link and a back link' },
  { method: 'GET', path: '/p3', desc: 'Simple page (named-target destination)' },
  { method: 'GET', path: '/inner', desc: 'Simple page loaded into a named in-page <iframname="inner">' },
  { method: 'GET', path: '/search?q=', desc: 'Echoes the q= query param, for verifying search-engine substitution' },
  { method: 'POST', path: '/post', desc: 'Echoes the request method + raw body, for verifying real POST delivery' },
  { method: 'GET', path: '/icon.png', desc: 'A real 1x1 PNG, used as a <link rel=icon> target' },
  { method: 'GET', path: '/favicon.ico', desc: 'Same PNG, served at the default favicon path' },
  { method: 'GET', path: '/file.txt', desc: 'Content-Disposition: attachment, for verifying downloads bypass tab handling' },
  { method: 'GET', path: '/spa', desc: 'Page with a button that calls history.pushState + sets document.title' },
  { method: 'GET', path: '/slow', desc: 'Delays the response by ?ms= (default 3000) before responding' },
  { method: 'GET', path: '/xss-title', desc: 'Sets document.title to a literal HTML-tag-shaped string via script' },
  { method: 'GET', path: '/xss-favicon', desc: 'Page + link whose visible attributes contain HTML-tag-shaped text' },
  { method: 'GET', path: '/large-favicon.bin', desc: 'Content-Type: text/html served at an icon URL (non-image payload)' },
  { method: 'GET', path: '/top-probe', desc: 'Inline <script> that probes window.top from a real (UV-rewritten) page script' },
  { method: 'GET', path: '/reach-probe', desc: 'Inline <script> that tries 13 ways to reach the shell document (SEC-T1)' },
  { method: 'GET', path: '/csp-probe', desc: 'Script that reaches the shell through window[\'to\'+\'p\'] and tries to run code there (SEC-T2)' },
  { method: 'GET', path: '/exposure-probe', desc: 'Reads what a page that reached the shell can see of it: namespace and bridge keys (SEC-T3)' },
  { method: 'GET', path: '/msg-probe', desc: 'Posts forged internal-page messages to the shell from a proxied page (SEC-T11)' },
  { method: 'GET', path: '/favicon-page?bytes=N&mode=length|chunked', desc: 'Page whose icon is /icon-sized with the same parameters (SEC-T8)' },
  { method: 'GET', path: '/icon-sized?bytes=N&mode=length|chunked', desc: 'N bytes of a valid image/png (padded), with a Content-Length or chunked without one' },
  { method: 'GET', path: '/title-page?bytes=N', desc: 'Page whose document.title is N characters long (TAB-T2)' },
  { method: 'GET', path: '/ui-attack', desc: 'Forges interface <-> container messages from a proxied page (SEC-T10)' },
  { method: 'GET', path: '/tall', desc: 'A 5000px tall page, to check that the wheel scrolls it (scrolling)' },
  { method: 'GET', path: '/spa-multi', desc: 'Buttons #one / #two pushState /spa-multi/one|two; #back calls history.back() (history)' },
  { method: 'GET', path: '/js-redirect', desc: 'location.replace(\'/p3\') as soon as it runs (history: a redirect is not an entry)' },
  { method: 'GET', path: '/meta-refresh', desc: '<meta http-equiv=refresh content="0;url=/p3"> (history: a redirect is not an entry)' },
  { method: 'GET', path: '/back-button', desc: 'A button #back that calls history.back() (history: a site\'s own Back button)' },
  { method: 'GET', path: '/open-handle', desc: 'Buttons that use the window.open() handle: w.location.href = ..., w.location = ..., reading w.location.href' },
  { method: 'GET', path: '/__test/health', desc: 'This route list, as JSON' },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/__test/health') {
    send(res, 200, JSON.stringify({ routes: ROUTES }, null, 2), { 'content-type': 'application/json' });
    return;
  }
  if (p === '/' && req.method === 'GET') return handleHome(res);
  if (p === '/p2') return send(res, 200, page('Page 2', '<h1>Page 2</h1><a id="closeme" href="#" onclick="window.close();return false">close</a><a id="back" href="/">home</a>'));
  if (p === '/p3') return send(res, 200, page('Page 3', '<h1>Page 3</h1>'));
  if (p === '/inner') return send(res, 200, page('Inner', '<h1>Inner</h1>'));
  if (p === '/search') return send(res, 200, page('Search ' + url.searchParams.get('q'), '<h1>Search</h1><p id="q">' + (url.searchParams.get('q') || '') + '</p>'));
  if (p === '/post') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => send(res, 200, page('Post result', `<h1>Post</h1><p id="body">${body}</p><p id="method">${req.method}</p>`)));
    return;
  }
  if (p === '/icon.png' || p === '/favicon.ico') return send(res, 200, RED_PNG, { 'content-type': 'image/png' });
  if (p === '/file.txt') return send(res, 200, 'hi', { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename=file.txt' });
  if (p === '/spa') return send(res, 200, page('SPA', "<h1>SPA</h1><button id=\"push\" onclick=\"history.pushState({}, '', '/spa/route2'); document.title='SPA route2'\">push</button>"));
  if (p === '/tall') return send(res, 200, page('Tall', '<div style="height:5000px">tall</div>'));
  if (p === '/spa-multi') {
    return send(res, 200, page('SPA multi', '<button id="one" onclick="history.pushState({}, \'\', \'/spa-multi/one\')">one</button><button id="two" onclick="history.pushState({}, \'\', \'/spa-multi/two\')">two</button><button id="back" onclick="history.back()">back</button><p id="marker">kept</p>'));
  }
  if (p === '/js-redirect') return send(res, 200, page('JS redirect', '<p>redirecting</p><script>location.replace(\'/p3\')</script>'));
  if (p === '/meta-refresh') return send(res, 200, page('Meta refresh', '<p>redirecting</p>', '<meta http-equiv="refresh" content="0;url=/p3">'));
  if (p === '/back-button') return send(res, 200, page('Back button', '<button id="back" onclick="history.back()">back</button><button id="fwd" onclick="history.forward()">fwd</button><button id="go2" onclick="history.go(-2)">go-2</button>'));
  if (p === '/open-handle') {
    return send(res, 200, page('Open handle', '<button id="b1" onclick="var w=window.open(\'\');w.location.href=\'/p3\'">1</button><button id="b2" onclick="var w=window.open(\'/p2\');w.location=\'/p3\'">2</button><button id="b3" onclick="var w=window.open(\'/p2\');document.title=\'href \'+w.location.href">3</button>'));
  }
  if (p === '/slow') return handleSlow(res, url.searchParams);
  if (p === '/xss-title') return handleXssTitle(res);
  if (p === '/xss-favicon') return handleXssFavicon(res);
  if (p === '/large-favicon.bin') return send(res, 200, '<html>not an image</html>', { 'content-type': 'text/html' });
  if (p === '/top-probe') return handleTopProbe(res);
  if (p === '/reach-probe') return handleReachProbe(res);
  if (p === '/csp-probe') return handleCspProbe(res);
  if (p === '/ui-attack') return handleUiAttack(res, `http://${req.headers.host}`);
  if (p === '/icon-sized') return handleIconSized(res, url.searchParams);
  if (p === '/favicon-page') return handleFaviconPage(res, url.searchParams);
  if (p === '/title-page') return handleTitlePage(res, url.searchParams);
  if (p === '/exposure-probe') return handleExposureProbe(res);
  if (p === '/msg-probe') return handleMsgProbe(res, `http://${req.headers.host}`);

  send(res, 404, page('Not found', 'nf'));
});

server.listen(PORT, () => console.log(`target-site fixture listening on ${PORT}`));
