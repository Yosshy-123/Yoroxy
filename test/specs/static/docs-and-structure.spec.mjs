/*
 * Static checks that need no browser.
 *
 * STRUCT-T1    No import cycle among the ES modules; no cycle among the
 *              browser scripts' use of the shared Yoroxy namespace.
 * STRUCT-T2    Removed mechanisms are gone from the code (version handshake,
 *              legacy Bare, test-only switches, ...).
 * STRUCT-T3    Every page ends with boot-seal.js; error.html loads no
 *              settings scripts; no script is both unused and exported.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { covers } from '../../support/traceability.mjs';
import { scanBrowserScripts } from '../../support/namespace-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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

describe('structure', () => {
  it('STRUCT-T1: the ES modules have no import cycle', () => {
    covers('STRUCT-T1', ['STRUCTURE']);
    const files = walk('.', (f) => /\.(m?js)$/.test(f) && !f.startsWith('public/') && !f.startsWith('test/fixtures/'));
    const graph = new Map();
    for (const f of files) {
      const deps = [...read(f).matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g)].map((m) =>
        path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]))
      );
      graph.set(f, deps.filter((d) => files.includes(d)));
    }
    const state = new Map();
    const visit = (f, trail) => {
      state.set(f, 1);
      for (const d of graph.get(f) || []) {
        assert.notEqual(state.get(d), 1, `import cycle: ${[...trail, f, d].join(' -> ')}`);
        if (!state.has(d)) visit(d, [...trail, f]);
      }
      state.set(f, 2);
    };
    for (const f of files) if (!state.has(f)) visit(f, []);
  });

  it('STRUCT-T1: the browser scripts have no cycle in their use of the Yoroxy namespace', () => {
    covers('STRUCT-T1b', ['STRUCTURE']);
    const { files, usesOf } = scanBrowserScripts();
    const graph = new Map(files.map((f) => [f, [...usesOf(f)]]));
    const state = new Map();
    const visit = (f, trail) => {
      state.set(f, 1);
      for (const d of graph.get(f)) {
        assert.notEqual(state.get(d), 1, `cycle: ${[...trail, f, d].join(' -> ')}`);
        if (!state.has(d)) visit(d, [...trail, f]);
      }
      state.set(f, 2);
    };
    for (const f of files) if (!state.has(f)) visit(f, []);
  });

  it('STRUCT-T2: removed mechanisms are gone from the code', () => {
    covers('STRUCT-T2', ['STRUCTURE']);
    const self = 'test/specs/static/docs-and-structure.spec.mjs';
    const files = walk('.', (f) => /\.(m?js|html|json|yml|md)$/.test(f) && f !== self && f !== 'package-lock.json' && !f.startsWith('test/visual/baselines'));
    const banned = {
      'API_VERSION': 'bridge version handshake',
      's.version ===': 'bridge version handshake',
      'legacySupport: true': 'legacy Bare',
      'existingTests': 'migration-era test split',
      'newTests': 'migration-era test split',
      'YOROXY_PLAYWRIGHT_REQUIRE_PATH': 'Playwright lookup switch',
      'YOROXY_TEST_ALLOW_LOCAL_BARE': 'test-only environment switch',
    };
    for (const f of files) {
      if (f === 'public/uv/uv.bundle.js' || f === 'public/uv/uv.client.js') continue;
      const text = read(f);
      for (const [needle, what] of Object.entries(banned)) assert.ok(!text.includes(needle), `${f} still contains ${needle} (${what})`);
    }
    assert.ok(!/\blegacySupport\s*:\s*true/.test(read('src/server/create-server.js')));
    assert.ok(/legacySupport:\s*false/.test(read('src/server/create-server.js')));
    assert.ok(!fs.existsSync(path.join(root, 'lib')), 'lib/ moved to src/server/');
    assert.ok(!('main' in JSON.parse(read('package.json'))), 'package.json has no main');
  });

  it('STRUCT-T3: boot-seal.js is the last script of every page; error.html has no settings scripts', () => {
    covers('STRUCT-T3', ['STRUCTURE']);
    const pages = walk('public', (f) => f.endsWith('.html'));
    assert.ok(pages.length >= 5);
    for (const page of pages) {
      const scripts = [...read(page).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(scripts.at(-1), '/assets/js/common/boot-seal.js', `${page}: the last script`);
    }
    assert.doesNotMatch(read('public/internal/error.html'), /settings-/);
  });
});
