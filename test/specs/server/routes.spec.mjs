/*
 * S-01 / S-03: server routing regressions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureServers } from '../../support/ensure-servers.mjs';
import { covers } from '../../support/traceability.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

describe('server routes', () => {
  it('S-01: the retired /proxy.html path is a plain 404 JSON response', async () => {
    covers('S-01', ['SERVER-NO-LEGACY-ROUTE']);
    const { appBase } = await ensureServers();
    const res = await fetch(appBase + '/proxy.html', { redirect: 'manual' });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  });

  it('S-03: static files resolve regardless of the process working directory', async () => {
    covers('S-03', ['SERVER-CWD-INDEPENDENT']);
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(repoRoot, 'index.js')], {
      cwd: os.tmpdir(),
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
        child.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
        child.stdout.on('data', (buf) => {
          if (String(buf).includes('Server Listening')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const res = await fetch(`http://127.0.0.1:${port}/container.html`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<html/i);
    } finally {
      child.removeAllListeners('exit');
      child.kill('SIGTERM');
    }
  });
});
