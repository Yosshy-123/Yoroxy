/*
 * Static checks that need no browser, for the rules the refactoring set.
 *
 * R-STR-01  On every page each script is loaded after the scripts whose
 *           members it uses while loading, and boot-seal.js is last.
 * R-STR-02  A browser script depends only on the directories its own may:
 *           common <- protocol <- container / ui; pages use common only.
 * R-DOC-01  Every *.md file named in the code exists.
 * R-SUP-01  The vendored Ultraviolet files are the recorded ones.
 * R-SEC-04  The real entry point passes no test-only switch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { covers } from '../../support/traceability.mjs';
import { root, scanBrowserScripts } from '../../support/namespace-scan.mjs';

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'reports'].includes(entry.name)) continue;
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, filter, out);
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

/* The script files a page loads, in order, as paths relative to the repository. */
function scriptsOf(page) {
  return [...read(page).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => 'public' + m[1]);
}

describe('refactoring rules', () => {
  it('R-STR-01: every page loads a script after the scripts it uses while loading', () => {
    covers('R-STR-01', ['REFACTOR-STRUCTURE']);
    const { loadTimeUsesOf, files } = scanBrowserScripts();
    const pages = walk('public', (f) => f.endsWith('.html'));
    assert.ok(pages.length >= 6);
    for (const page of pages) {
      const order = scriptsOf(page);
      assert.equal(order.at(-1), 'public/assets/js/common/boot-seal.js', `${page}: boot-seal.js is last`);
      for (const [i, script] of order.entries()) {
        if (!files.includes(script)) continue; // UV files: not part of the Yoroxy namespace
        for (const dep of loadTimeUsesOf(script)) {
          assert.ok(order.indexOf(dep) !== -1 && order.indexOf(dep) < i, `${page}: ${script} needs ${dep} loaded before it`);
        }
      }
    }
  });

  it('R-STR-02: browser scripts depend only on the directories their own may', () => {
    covers('R-STR-02', ['REFACTOR-STRUCTURE']);
    const { files, usesOf } = scanBrowserScripts();
    const allowed = {
      common: ['common'],
      protocol: ['common', 'protocol'],
      container: ['common', 'protocol', 'container'],
      ui: ['common', 'protocol', 'ui'],
      pages: ['common', 'pages'],
    };
    const dirOf = (f) => f.split('/')[3];
    for (const f of files) {
      assert.ok(allowed[dirOf(f)], `${f}: not in one of ${Object.keys(allowed).join(', ')}`);
      for (const dep of usesOf(f)) {
        assert.ok(allowed[dirOf(f)].includes(dirOf(dep)), `${f} (${dirOf(f)}/) uses ${dep} (${dirOf(dep)}/)`);
      }
    }
  });

  it('R-DOC-01: every *.md file named in the code exists', () => {
    covers('R-DOC-01', ['REFACTOR-DOCS']);
    const skipped = new Set(['public/uv/uv.bundle.js', 'public/uv/uv.client.js', 'public/uv/uv.sw.js', 'package-lock.json']);
    const files = walk('.', (f) => /\.(m?js|html|css|json)$/.test(f) && !skipped.has(f) && !f.startsWith('test/visual/baselines'));
    for (const f of files) {
      for (const m of read(f).matchAll(/[A-Za-z0-9_./-]+\.md\b/g)) {
        assert.ok(fs.existsSync(path.join(root, m[0])), `${f} refers to ${m[0]}, which does not exist`);
      }
    }
  });

  it('R-SUP-01: the vendored Ultraviolet files match vendor/uv/checksums.json', () => {
    covers('R-SUP-01', ['REFACTOR-VENDOR']);
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/verify-vendor.mjs')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  });

  it('R-SEC-04: index.js passes no test-only switch and the factory blocks local targets by default', () => {
    covers('R-SEC-04', ['REFACTOR-SSRF-DEFAULT']);
    const entry = read('index.js');
    assert.doesNotMatch(entry, /testOnly|allowLocalTargets|disableRateLimit|exposeTestHooks|blockLocal/);
    const factory = read('src/server/create-server.js');
    assert.match(factory, /allowLocalTargets = false/);
    assert.match(factory, /blockLocal: !allowLocalTargets/);
  });
});
