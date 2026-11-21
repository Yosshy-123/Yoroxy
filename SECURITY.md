# Security notes

This file describes what Yoroxy protects against, what it deliberately does
not, and the rules that keep it that way. Code comments refer to it by
section name.

## R1: proxied sites share the app's origin (residual risk)

Every proxied site is served by the service worker under `/uv/service/...` on
the same origin as the shell (`container.html`) and its tab `<iframe>`s are
not sandboxed. A script of a proxied page therefore runs with the same
origin as the shell:

- Hardening in `public/uv/uv.handler.js` (`yoroxyHarden`) blocks 11 of the 13
  techniques the suite probes for reaching the shell's document
  (`test/specs/security/reach-paths.spec.mjs`). **Two cannot be blocked:**
  `window['to'+'p']` (a computed property name), also from a fresh iframe.
  The test snapshot is exact, so any change in this list is noticed.
- The browser interface (`shell-ui.html`) is the exception: it runs in an
  iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, an opaque
  origin no page of the app can reach. It talks to the container by
  `postMessage` only, and every message is validated
  (`protocol/validators.js`, `protocol/ui-messages.js`).
- What a script that reached the container can do is limited by the container's
  CSP (hash-only `script-src`, no inline script) and its small API surface
  (`window.__yoroxyShell` has five methods, frozen).
- The same origin also means a proxied page can read and write what the app
  keeps in `localStorage` (the settings under `yoroxy:settings`, including the
  default search engine) and the `window.top` property the settings fall back
  to when storage is unavailable (`__yoroxySettingsMemory`). Settings are
  validated again on every load (`common/settings/schema.js`, `sanitize`),
  which stops malformed values but not a well-formed change.

Removing R1 needs one origin per proxied site, which is an architecture change
and is not part of the current design.

## The Bare relay has no authentication

`/bare/` relays requests to other sites. There is no login. A request is
accepted when:

1. it comes from a page of this same site, judged by the browser's `Origin`
   and `Sec-Fetch-Site` headers (`src/server/request-guard.js`). **A client that
   is not a browser can send any headers**, so this stops other websites from
   using the relay through their visitors' browsers, not a determined script;
2. the client is within its rate limit: a burst of 300 requests, then 60 per
   second per client (IPv6 clients are counted per /64).

A server reachable from the internet is therefore an open relay for anyone who
can send HTTP. If that is not acceptable, put authentication in front of it
(a reverse proxy with a login, a VPN, an allow-list). This is a decision, not
an oversight: the application itself does not add a login.

Bare's SSRF guard (`blockLocal`) makes it refuse loopback, private,
link-local, reserved and IPv4-mapped addresses, checked at connection time,
so a DNS answer that changes cannot slip past it. It does not restrict
public destinations. Two Bare servers run side by side
(`src/server/create-server.js`):

- **the person on this machine** can reach this machine's own addresses
  (`http://localhost:3000`, `http://192.168.x.x/`, and sites whose DNS answer
  is a private or "fake IP" address). Such a person could reach them without
  the proxy, so nothing is given away. Someone counts as local only when the
  connection comes from a loopback address, the `Host` is `localhost`, a
  `127.x.x.x` address or `[::1]`, **no** forwarding header (`X-Forwarded-*`,
  `Forwarded`, `X-Real-IP`) is present, and `TRUSTED_PROXY` is not set
  (`isLocalUser` in `src/server/request-guard.js`);
- **everyone else** goes through the guard and gets `Forbidden IP` for those
  addresses.

A reverse proxy on the same machine that adds no forwarding header, and sends
a `localhost` Host to the app, would make every visitor look local: configure
it to send `X-Forwarded-For` and set `TRUSTED_PROXY`, which switches the local
exception off.

## Reverse proxies (`TRUSTED_PROXY`)

`TRUSTED_PROXY=n` says that `n` reverse proxies sit in front of the server;
only then are `X-Forwarded-For` / `X-Forwarded-Host` believed. Set it to the
real number of proxies: too low and every visitor shares the proxy's address
and one rate-limit bucket; too high (or set with no proxy) and clients can
choose their own address.

TLS and `Strict-Transport-Security` are not handled by the app; the TLS
terminator must send HSTS.

## Content-Security-Policy

Pages built by the server (`src/server/pages/`) get a CSP as an HTTP header and
as a `<meta>` element (the shell is also written into an `about:blank`
window, where no header applies):

- `script-src` lists the SHA-256 hash of each script and nothing else.
  `'self'` is deliberately absent, as it would also allow any same-origin
  script. The server computes the hashes at start-up and adds
  `integrity` attributes; after changing a script, restart the server.
- `style-src` is `'self'`: no page uses inline `<style>` or `style=""`.
- `shell-ui.html` (the sandboxed interface) has its scripts written into the
  page and a stricter policy: no network, no frames, no forms.
- A page with an inline script, an inline event handler or a `javascript:` URL
  makes the server refuse to start.
- Browser scripts are classic scripts, not ES modules, because a module graph
  cannot be covered by hashes.
- `frame-ancestors` is not set. It can only be sent as an HTTP header, and
  whether `'self'` works for the shell's frames inside the `about:blank`
  window has not been verified in a browser.

## Static files

Only `/assets/*` and `/uv/*` are served as static files. HTML is served from
memory, with its CSP, and never from disk. The server refuses to start if
`assets/` or `uv/` contains an `.html` file.

## Logging and errors

- Error responses carry a short message only. Bare's `stack` is removed
  (`src/server/bare-errors.js`).
- Do not log environment variables, request headers, cookies or request
  bodies. The only environment variables the server reads are `PORT`,
  `TRUSTED_PROXY` and `HOST` (`src/server/config.js`).

## Resource limits

Only keep-alive and header timeouts are set (`src/server/create-server.js`).
The Node defaults apply to the request timeout and to the number of
connections, and open WebSockets and long streams are not metered by the rate
limit. No load test has been run, so no further limits are set yet.

## Test-only switches

`createServer({ testOnly })` can allow Bare to reach local addresses for
everyone (the guard above is off), turn the
rate limit off, or keep `window.Yoroxy` in the pages. They exist for the test
suite; `index.js` must never pass `testOnly` (checked by
`test/specs/server/server.spec.mjs`).

## Vendored Ultraviolet

See `vendor/uv/UPSTREAM.md`. `npm run verify:vendor` checks that the served
files are the recorded ones.

## Reporting a vulnerability

No reporting contact has been set for this project yet.
