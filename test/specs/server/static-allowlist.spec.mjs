/*
 * R-SEC-01  Static files come from /assets and /uv only.
 * R-SEC-02  No page needs 'unsafe-inline' styles, and none carries inline
 *           style markup; the header and the <meta> policy are the same.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { covers } from '../../support/traceability.mjs';
import { createServer } from '../../../src/server/create-server.js';

const realPublic = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');

async function listen(publicDir) {
  const app = createServer({ publicDir, testOnly: { disableRateLimit: true } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { port: app.server.address().port, close: app.close };
}

/* Raw request line: no client-side normalisation of ".." or "%2e". */
function rawGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: requestPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', reject);
  });
}

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoroxy-static-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put('index.html', '<!doctype html><html><head><title>t</title></head><body></body></html>');
  put('secret.txt', 'TOP-SECRET');
  put('.env', 'TOP-SECRET');
  put('private/data.json', 'TOP-SECRET');
  put('assets/a.js', 'var a = 1;');
  put('assets/.hidden', 'TOP-SECRET');
  put('uv/b.js', 'var b = 2;');
  return { dir, put };
}

describe('static files', () => {
  it('R-SEC-01: only /assets and /uv are served; nothing else under public/, whatever its name', async () => {
    covers('R-SEC-01', ['REFACTOR-STATIC-ALLOWLIST']);
    const site = makeSite();
    const app = await listen(site.dir);
    try {
      for (const p of ['/secret.txt', '/.env', '/private/data.json', '/assets/.hidden', '/assets/', '/uv/']) {
        const res = await rawGet(app.port, p);
        assert.equal(res.status, 404, `${p} must be 404`);
        assert.ok(!res.body.includes('TOP-SECRET'), p);
      }
      for (const p of ['/assets/../secret.txt', '/uv/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/secret.txt', '/assets/..%2fsecret.txt', '/assets/%2e%2e%2fsecret.txt']) {
        const res = await rawGet(app.port, p);
        assert.notEqual(res.status, 200, `${p} must not be served`);
        assert.ok(!res.body.includes('TOP-SECRET'), p);
      }
      const a = await rawGet(app.port, '/assets/a.js');
      assert.equal(a.status, 200);
      assert.equal(a.body, 'var a = 1;');
      assert.equal((await rawGet(app.port, '/uv/b.js')).status, 200);
    } finally {
      await app.close();
    }
  });

  it('R-SEC-01: the server refuses to start when assets/ or uv/ holds an HTML file', () => {
    covers('R-SEC-01b', ['REFACTOR-STATIC-ALLOWLIST']);
    for (const where of ['assets/x.html', 'uv/y.html', 'assets/deep/z.HTML']) {
      const site = makeSite();
      site.put(where, '<!doctype html><html><head></head><body></body></html>');
      assert.throws(() => createServer({ publicDir: site.dir }), /not allowed under assets\/ or uv\//, where);
    }
  });

  it('R-SEC-02: no page allows inline styles, and the header policy equals the <meta> policy', async () => {
    covers('R-SEC-02', ['REFACTOR-CSP-STYLE']);
    const app = await listen(realPublic);
    try {
      const pages = [];
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else if (e.name.endsWith('.html')) pages.push('/' + path.relative(realPublic, path.join(dir, e.name)).split(path.sep).join('/'));
        }
      };
      walk(realPublic);
      assert.ok(pages.length >= 6);
      for (const p of pages) {
        const res = await rawGet(app.port, p);
        assert.equal(res.status, 200, p);
        const header = res.headers['content-security-policy'];
        const meta = res.body.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
        assert.equal(meta, header, `${p}: header and meta policy are the same`);
        assert.doesNotMatch(header, /unsafe-inline/, p);
        assert.match(header, /style-src 'self'(?:;|$)/, p);
        assert.doesNotMatch(meta, /frame-ancestors/, `${p}: frame-ancestors is ignored in a <meta> policy`);
        assert.doesNotMatch(res.body, /<style\b|\sstyle\s*=/i, `${p}: no inline style markup`);
      }
    } finally {
      await app.close();
    }
  });
});
