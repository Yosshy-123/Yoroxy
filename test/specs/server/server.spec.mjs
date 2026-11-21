/*
 * Server unit/integration tests that need no browser. Each test builds its
 * own server with createServer() on an ephemeral port, so nothing here
 * depends on (or disturbs) the shared app server of the suite.
 *
 * SRV-T1 blockLocal   SRV-T2 listen/close   SRV-T3 readConfig   SRV-T4 404s
 * SRV-T5 dropped connections   SRV-T6 page registry   SEC-T6 rate limit / Origin
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { covers } from '../../support/traceability.mjs';
import { createServer } from '../../../src/server/create-server.js';
import { readConfig } from '../../../src/server/config.js';
import { buildShellPages } from '../../../src/server/pages/page-registry.js';
import { createRateLimiter } from '../../../src/server/rate-limit.js';
import { normalizeIp, clientIp, isLocalUser } from '../../../src/server/request-guard.js';

async function start({ trustedProxy, testOnly = {} } = {}) {
  // Rate limiting is off unless a test supplies its own limit.
  const app = createServer({ trustedProxy, testOnly: { disableRateLimit: !testOnly.rateLimit, ...testOnly } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return { ...app, port, base: `http://127.0.0.1:${port}` };
}

/** A loopback HTTP server that answers every request with "hello". */
async function startTarget() {
  const server = http.createServer((_req, res) => res.end('hello'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

/*
 * A Bare v3 request with exact control of the Host header and of extra
 * headers (fetch cannot set Host), as another machine's browser would send it.
 */
function bareAs(port, target, { host = `127.0.0.1:${port}`, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port,
      path: '/bare/v3/',
      headers: {
        Host: host,
        'x-bare-url': target,
        'x-bare-headers': JSON.stringify({ Host: new URL(target).host }),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

/** Raw HTTP request with an exact request-target (fetch would normalise "/../"). */
function rawGet(port, target) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: target }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

describe('server: createServer', () => {
  it('SRV-T1: the person on this machine may reach local addresses, anyone else is refused', async () => {
    covers('SRV-T1', ['SERVER-CREATE']);
    const target = await startTarget();
    const url = `http://127.0.0.1:${target.port}/`;
    const app = await start();
    const { port } = app;
    try {
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
        const res = await bareAs(port, url, { host });
        assert.equal(res.status, 200, `Host ${host}: a loopback client using a loopback name`);
        assert.equal(res.body, 'hello');
      }
      const refusedCases = {
        'a reverse proxy added X-Forwarded-For': { headers: { 'X-Forwarded-For': '203.0.113.9' } },
        'a reverse proxy added Forwarded': { headers: { Forwarded: 'for=203.0.113.9' } },
        'a reverse proxy added X-Real-IP': { headers: { 'X-Real-IP': '203.0.113.9' } },
        'a reverse proxy added X-Forwarded-Host': { headers: { 'X-Forwarded-Host': 'proxy.example.com' } },
        'the Host is the public name, not a loopback one': { host: 'proxy.example.com' },
        'the Host only starts like a loopback one': { host: `localhost.example.com:${port}` },
      };
      for (const [why, options] of Object.entries(refusedCases)) {
        const res = await bareAs(port, url, options);
        assert.equal(res.status, 500, why);
        assert.match(res.body, /Forbidden IP/, why);
        assert.doesNotMatch(res.body, /hello/, why);
      }
    } finally {
      await Promise.all([app.close(), target.close()]);
    }
  });

  it('SRV-T1: behind a trusted reverse proxy nobody may reach local addresses', async () => {
    covers('SRV-T1b', ['SERVER-CREATE']);
    const target = await startTarget();
    const app = await start({ trustedProxy: 1 });
    try {
      const res = await bareAs(app.port, `http://127.0.0.1:${target.port}/`, { headers: { 'X-Forwarded-For': '127.0.0.1' } });
      assert.equal(res.status, 500);
      assert.match(res.body, /Forbidden IP/);
      const direct = await bareAs(app.port, `http://127.0.0.1:${target.port}/`);
      assert.match(direct.body, /Forbidden IP/, 'even a request that looks local: TRUSTED_PROXY says a proxy is in front');
    } finally {
      await Promise.all([app.close(), target.close()]);
    }
  });

  it('SRV-T1: the test-only switch lets everyone reach local addresses', async () => {
    covers('SRV-T1d-switch', ['SERVER-CREATE']);
    const target = await startTarget();
    const open = await start({ testOnly: { allowLocalTargets: true } });
    try {
      const res = await bareAs(open.port, `http://127.0.0.1:${target.port}/`, { headers: { 'X-Forwarded-For': '203.0.113.9' }, host: 'proxy.example.com' });
      assert.equal(res.status, 200);
      assert.equal(res.body, 'hello');
    } finally {
      await Promise.all([open.close(), target.close()]);
    }
  });

  it('SRV-T1: isLocalUser needs a loopback connection, a loopback Host and no sign of a reverse proxy', () => {
    covers('SRV-T1e', ['SERVER-CREATE']);
    const req = (address, host, headers = {}) => ({ socket: { remoteAddress: address }, headers: { ...(host === undefined ? {} : { host }), ...headers } });
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) {
      assert.equal(isLocalUser(req(address, 'localhost:8080')), true, address);
    }
    for (const address of ['192.168.1.5', '10.0.0.1', '8.8.8.8', '::ffff:10.0.0.1', '2001:db8::1', 'fe80::1', '', undefined]) {
      assert.equal(isLocalUser(req(address, 'localhost:8080')), false, `address ${address}`);
    }
    for (const host of ['localhost', 'localhost:8080', 'LocalHost:80', '127.0.0.1', '127.0.0.1:3000', '127.5.6.7:1', '[::1]', '[::1]:8080']) {
      assert.equal(isLocalUser(req('127.0.0.1', host)), true, `host ${host}`);
    }
    for (const host of [undefined, '', 'example.com', 'localhost.example.com', '127.0.0.1.example.com', 'xlocalhost', 'localhost:abc', 'localhost:8080@evil.com', 'evil.com#localhost', '192.168.1.5:8080', '[::2]:8080']) {
      assert.equal(isLocalUser(req('127.0.0.1', host)), false, `host ${host}`);
    }
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip']) {
      assert.equal(isLocalUser(req('127.0.0.1', 'localhost:8080', { [header]: 'x' })), false, header);
    }
    assert.equal(isLocalUser(req('127.0.0.1', 'localhost:8080'), 1), false, 'TRUSTED_PROXY=1');
    assert.equal(isLocalUser({ headers: { host: 'localhost' } }), false, 'no socket');
  });

  it('SRV-T1: Bare speaks v3 only (no legacy v1/v2)', async () => {
    covers('SRV-T1c', ['SERVER-CREATE']);
    const app = await start();
    try {
      const manifest = await (await fetch(`${app.base}/bare/`)).json();
      assert.deepEqual(manifest.versions, ['v3']);
    } finally {
      await app.close();
    }
  });

  it('SRV-T1: error responses do not carry server-side stack traces or file paths', async () => {
    covers('SRV-T1d', ['SERVER-CREATE']);
    const app = await start();
    try {
      const bodies = [];
      // malformed Bare headers, an unknown Bare route, and a forbidden address
      bodies.push(await (await fetch(`${app.base}/bare/v3/`, { headers: { 'x-bare-url': 'not a url', 'x-bare-headers': '{}' } })).text());
      bodies.push(await (await fetch(`${app.base}/bare/v3/`, { headers: { 'x-bare-url': 'http://127.0.0.1:9/', 'x-bare-headers': '{}', 'x-bare-pass-status': 'x' } })).text());
      bodies.push(await (await fetch(`${app.base}/bare/nope/`)).text());
      bodies.push(await (await fetch(`${app.base}/bare/v3/`, { headers: { 'x-bare-url': 'http://127.0.0.1:9/', 'x-bare-headers': '{}' } })).text());
      for (const body of bodies) {
        assert.doesNotMatch(body, /"stack"/);
        assert.doesNotMatch(body, /node_modules|\.js:\d+|\bat [A-Za-z.<]/, 'no stack frames');
        assert.ok(!body.includes(process.cwd()), 'no local path');
        assert.ok(JSON.parse(body).code !== undefined || body === '{}', 'the error code survives');
      }
    } finally {
      await app.close();
    }
  });

  it('SRV-T2: repeated listen/close leaves no listener or timer behind', async () => {
    covers('SRV-T2', ['SERVER-CREATE']);
    const count = (type) => process.getActiveResourcesInfo().filter((t) => t === type).length;
    const before = { tcp: count('TCPServerWrap'), timeout: count('Timeout') };
    let port = 0;
    for (let i = 0; i < 8; i++) {
      const app = createServer({ testOnly: { rateLimit: { capacity: 5, refillPerSecond: 1 } } });
      await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
      port = app.server.address().port; // the same port must be reusable each round
      assert.equal((await fetch(`http://127.0.0.1:${port}/container.html`)).status, 200);
      await app.close();
      assert.equal(app.server.listening, false);
    }
    assert.equal(count('TCPServerWrap'), before.tcp, 'no listening socket may remain');
    assert.ok(count('Timeout') <= before.timeout, 'no timer may remain');
  });
});

describe('server: configuration', () => {
  it('SRV-T3: PORT is validated', () => {
    covers('SRV-T3', ['SERVER-CONFIG']);
    for (const bad of ['', 'abc', '-1', '65536', '80.5', ' 8080', '8080 ', '0x50', '1e3']) {
      assert.throws(() => readConfig({ PORT: bad }), /PORT/, JSON.stringify(bad));
    }
    assert.equal(readConfig({ PORT: '8080' }).port, 8080);
    assert.equal(readConfig({ PORT: '0' }).port, 0);
    assert.equal(readConfig({ PORT: '65535' }).port, 65535);
    assert.equal(readConfig({}).port, 8080, 'unset means the default');
  });

  it('SRV-T3: TRUSTED_PROXY is validated', () => {
    covers('SRV-T3b', ['SERVER-CONFIG']);
    assert.equal(readConfig({}).trustedProxy, 0);
    assert.equal(readConfig({ TRUSTED_PROXY: '1' }).trustedProxy, 1);
    for (const bad of ['', 'yes', '-1', '11', '1.5']) {
      assert.throws(() => readConfig({ TRUSTED_PROXY: bad }), /TRUSTED_PROXY/, JSON.stringify(bad));
    }
  });
});

describe('server: routing', () => {
  it('SRV-T4: unknown paths are a JSON 404 and source files are not exposed', async () => {
    covers('SRV-T4', ['SERVER-ROUTES']);
    covers('S-01', ['SERVER-NO-LEGACY-ROUTE']);
    const app = await start();
    try {
      for (const p of ['/nope', '/proxy.html', '/package.json', '/index.js', '/src/server/create-server.js', '/../index.js', '/%2e%2e/index.js', '/%2e%2e%2fpackage.json', '/..%2findex.js', '/internal/%2e%2e/%2e%2e/index.js']) {
        const res = await rawGet(app.port, p);
        assert.equal(res.status, 404, p);
        assert.deepEqual(JSON.parse(res.body), { error: 'not found' }, p);
      }
    } finally {
      await app.close();
    }
  });

  it('SRV-T4: pages are only served with their CSP (no raw .html through the static handler)', async () => {
    covers('SRV-T4b', ['SERVER-ROUTES']);
    const app = await start();
    try {
      for (const p of ['/container.html', '/CONTAINER.HTML', '/internal/newtab.html', '/']) {
        const res = await rawGet(app.port, p);
        assert.equal(res.status, 200, p);
        assert.ok(res.headers['content-security-policy'], `${p} must carry the CSP`);
      }
      for (const p of ['/contain%65r.html', '/internal/newtab%2ehtml', '/internal/missing.html']) {
        assert.equal((await rawGet(app.port, p)).status, 404, p);
      }
      assert.equal((await rawGet(app.port, '/assets/js/common/config.js')).status, 200);
    } finally {
      await app.close();
    }
  });

  it('SRV-T5: dropped connections do not stop the server', async () => {
    covers('SRV-T5', ['SERVER-NETWORK-ERRORS']);
    const app = await start();
    const failures = [];
    const onUncaught = (err) => failures.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      const drop = (payload, { upgrade = false } = {}) =>
        new Promise((resolve) => {
          const socket = net.connect(app.port, '127.0.0.1', () => {
            socket.write(payload);
            setTimeout(() => {
              socket.destroy();
              resolve();
            }, 50);
          });
          socket.on('error', () => {});
          void upgrade;
        });

      await drop('GET /container.html HTTP/1.1\r\nHost: x\r\n'); // headers never finished
      await drop('GET /container.html HTTP/1.1\r\nHost: x\r\n\r\n'); // closed before reading the answer
      await drop('POST /bare/v3/ HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nabc'); // body cut short
      await drop('GET /bare/v3/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); // bad upgrade
      await drop('garbage\r\n\r\n'); // malformed request

      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await fetch(`${app.base}/container.html`)).status, 200, 'still serving');
      assert.deepEqual(failures, [], 'nothing may escape as an uncaught exception');
    } finally {
      process.off('uncaughtException', onUncaught);
      await app.close();
    }
  });
});

describe('server: page registry', () => {
  function pagesFrom(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoroxy-assets-'));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }
  const page = (body, head = '') => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

  it('SRV-T6: a normal page gets integrity, a hash-only CSP and the meta copy', () => {
    covers('SRV-T6', ['SERVER-SHELL-ASSETS']);
    const dir = pagesFrom({ 'index.html': page('<script src="/a.js"></script><script src="b.js" defer></script>'), 'a.js': 'var a=1;', 'b.js': 'var b=2;' });
    const { pages, routes } = buildShellPages({ publicDir: dir });
    const p = pages.get('index.html');
    assert.equal([...p.html.matchAll(/ integrity="sha256-/g)].length, 2);
    assert.match(p.html, /<script src="b\.js" defer integrity="sha256-[^"]+"><\/script>/);
    assert.match(p.html, /<head><meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'sha256-/);
    assert.equal(p.hashes.length, 2);
    assert.ok(routes.has('/') && routes.has('/index.html'));
    assert.doesNotMatch(p.html, /data-yoroxy-test/);
    assert.match(buildShellPages({ publicDir: dir, exposeTestHooks: true }).pages.get('index.html').html, /<html data-yoroxy-test="1">/);
  });

  it('SRV-T6: anything that could not run under the CSP stops the start-up', () => {
    covers('SRV-T6b', ['SERVER-SHELL-ASSETS']);
    const bad = {
      'inline script': [page('<script>alert(1)</script>'), /inline <script>/],
      'event handler': [page('<button onclick="go()">x</button>'), /event-handler/],
      'javascript: url': [page('<a href="javascript:void 0">x</a>'), /javascript: URL/],
      'missing script': [page('<script src="/missing.js"></script>'), /cannot read script/],
      'external script': [page('<script src="https://cdn.example/x.js"></script>'), /external script/],
      'outside public': [page('<script src="/../secret.js"></script>'), /outside public|cannot read/],
      'own integrity': [page('<script src="/a.js" integrity="sha256-x"></script>'), /already has an integrity/],
    };
    for (const [label, [html, pattern]] of Object.entries(bad)) {
      const dir = pagesFrom({ 'index.html': html, 'a.js': 'x', '../secret.js': 'x' });
      assert.throws(() => buildShellPages({ publicDir: dir }), pattern, label);
    }
  });

  it('SRV-T6: the real pages build', () => {
    covers('SRV-T6c', ['SERVER-SHELL-ASSETS']);
    const { pages } = buildShellPages({ publicDir: new URL('../../../public', import.meta.url).pathname });
    assert.ok(pages.size >= 5);
    for (const [rel, p] of pages) assert.ok(p.hashes.length > 0, rel);
  });
});

describe('server: /bare/ guard', () => {
  it('SEC-T6: requests beyond the limit get 429, the server carries on', async () => {
    covers('SEC-T6', ['SECURITY-BARE-GUARD']);
    const app = await start({ testOnly: { rateLimit: { capacity: 5, refillPerSecond: 0.5 } } });
    try {
      const statuses = [];
      for (let i = 0; i < 8; i++) statuses.push((await fetch(`${app.base}/bare/`)).status);
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429, 429]);
      const limited = await fetch(`${app.base}/bare/`);
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
      assert.equal((await fetch(`${app.base}/container.html`)).status, 200, 'pages are not rate limited');
    } finally {
      await app.close();
    }
  });

  it('SEC-T6: another site\'s Origin gets 403; the same site and no Origin are served', async () => {
    covers('SEC-T6b', ['SECURITY-BARE-GUARD']);
    const app = await start();
    try {
      const status = async (headers) => (await fetch(`${app.base}/bare/`, { headers })).status;
      assert.equal(await status({ Origin: 'https://evil.example' }), 403);
      assert.equal(await status({ Origin: 'null' }), 403);
      assert.equal(await status({ Origin: `http://127.0.0.1:${app.port + 1}` }), 403, 'same host, other port');
      assert.equal(await status({ 'Sec-Fetch-Site': 'cross-site' }), 403);
      assert.equal(await status({ Origin: app.base }), 200);
      assert.equal(await status({ 'Sec-Fetch-Site': 'same-origin' }), 200);
      assert.equal(await status({}), 200);

      // preflights from another site are refused, so the CORS * of Bare is never granted
      const preflight = await fetch(`${app.base}/bare/v3/`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
      assert.equal(preflight.status, 403);
      assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    } finally {
      await app.close();
    }
  });

  it('SEC-T6: a WebSocket upgrade from another site is refused, and is rate limited', async () => {
    covers('SEC-T6c', ['SECURITY-BARE-GUARD']);
    const app = await start({ testOnly: { rateLimit: { capacity: 2, refillPerSecond: 0.1 } } });
    try {
      const upgrade = (origin) =>
        new Promise((resolve) => {
          const socket = net.connect(app.port, '127.0.0.1', () => {
            socket.write(`GET /bare/v3/ HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${origin ? `Origin: ${origin}\r\n` : ''}\r\n`);
          });
          let data = '';
          socket.on('data', (d) => (data += d));
          socket.on('close', () => resolve(data.split('\r\n')[0]));
          socket.on('error', () => {});
          setTimeout(() => socket.destroy(), 500);
        });
      assert.match(await upgrade('https://evil.example'), /403/);
      // The refusal above did not use a token: two more attempts still reach Bare (which answers
      // with its own error for the incomplete handshake), the third is limited.
      assert.doesNotMatch(await upgrade(null), /403|429/);
      assert.doesNotMatch(await upgrade(null), /403|429/);
      assert.match(await upgrade(null), /429/);
    } finally {
      await app.close();
    }
  });

  it('SEC-T6: X-Forwarded-For is believed only behind a trusted proxy', async () => {
    covers('SEC-T6d', ['SECURITY-BARE-GUARD']);
    const direct = await start({ testOnly: { rateLimit: { capacity: 2, refillPerSecond: 0.01 } } });
    const proxied = await start({ testOnly: { rateLimit: { capacity: 2, refillPerSecond: 0.01 } }, trustedProxy: 1 });
    try {
      const run = async (app, forwardedFor) => {
        const out = [];
        for (let i = 0; i < 3; i++) out.push((await fetch(`${app.base}/bare/`, { headers: forwardedFor(i) })).status);
        return out;
      };
      // Spoofing a different address per request must not evade the limit when no proxy is trusted.
      assert.deepEqual(await run(direct, (i) => ({ 'X-Forwarded-For': `10.0.0.${i}` })), [200, 200, 429]);
      // Behind one trusted proxy, the entry it appended identifies the client; spoofed extras to the left are ignored.
      assert.deepEqual(await run(proxied, (i) => ({ 'X-Forwarded-For': `1.1.1.${i}, 203.0.113.7` })), [200, 200, 429]);
      assert.deepEqual(await run(proxied, (i) => ({ 'X-Forwarded-For': `203.0.113.${50 + i}` })), [200, 200, 200]);
    } finally {
      await Promise.all([direct.close(), proxied.close()]);
    }
  });

  it('SEC-T6: limiter and address helpers', () => {
    covers('SEC-T6e', ['SECURITY-BARE-GUARD']);
    let now = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now, sweepIntervalMs: 1e9 });
    assert.deepEqual([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('b')], [true, true, false, true]);
    now = 1000;
    assert.equal(limiter.take('a'), true, 'one token per second comes back');
    assert.equal(limiter.take('a'), false);
    limiter.dispose();
    assert.throws(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 }));

    assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
    assert.equal(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), normalizeIp('2001:db8:1:2::1'), 'one /64 is one client');
    assert.notEqual(normalizeIp('2001:db8:1:3::1'), normalizeIp('2001:db8:1:2::1'));
    assert.equal(clientIp({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '9.9.9.9' } }, 0), '10.0.0.1');
    assert.equal(clientIp({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '9.9.9.9' } }, 2), '10.0.0.1', 'chain shorter than the trusted hops');
  });
});
