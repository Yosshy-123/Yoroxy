/*
 * TST-T1: the traceability log only counts passing tests.
 * TST-T2: the two browser launch helpers differ exactly in CSP handling.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { covers } from '../support/traceability.mjs';
import { launchBrowser, launchBrowserStrictCsp } from '../support/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const traceabilityModule = path.resolve(here, '../support/traceability.mjs');

describe('test support', () => {
  it('TST-T1: a failing test leaves its requirement uncovered, a passing one covers it', () => {
    covers('TST-T1', ['TEST-TRACEABILITY']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoroxy-trace-'));
    const coverage = path.join(dir, 'coverage.ndjson');
    const spec = path.join(dir, 'sample.spec.mjs');
    fs.writeFileSync(
      spec,
      `import { it } from 'node:test';
       import { covers } from ${JSON.stringify(traceabilityModule)};
       it('passes', () => { covers('SAMPLE-PASS', ['REQ-PASS']); });
       it('fails', () => { covers('SAMPLE-FAIL', ['REQ-FAIL']); throw new Error('boom'); });`
    );
    // NODE_TEST_CONTEXT is set while this very suite runs under node:test; left in the child it would make
    // the child a nested reporter that always exits 0.
    const env = { ...process.env, YOROXY_COVERAGE_FILE: coverage };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', spec], { env, encoding: 'utf8' });
    assert.notEqual(run.status, 0, 'the sample suite must fail overall');
    const lines = fs.readFileSync(coverage, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.testId), ['SAMPLE-PASS']);
    assert.ok(!lines.some((l) => l.frIds.includes('REQ-FAIL')), 'the failing test must not count');
  });

  it('TST-T2: launchBrowser bypasses CSP by default, the strict helper enforces it', async () => {
    covers('TST-T2', ['TEST-TRACEABILITY']);
    const csp = "default-src 'none'";
    const html = '<!doctype html><title>x</title><body>ok</body>';
    // page.evaluate() is exempt from the page's CSP (it comes from DevTools), so use a mechanism the page
    // owns: an inline <script> element, which a CSP without 'unsafe-inline' refuses.
    const viaScript = async (launch) => {
      const browser = await launch();
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.route('http://csp.test/', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': csp }, body: html })
        );
        await page.goto('http://csp.test/');
        await page.evaluate(() => {
          const s = document.createElement('script');
          s.textContent = 'window.__ran = 1';
          document.body.appendChild(s);
        });
        return await page.evaluate(() => window.__ran === 1);
      } finally {
        await browser.close();
      }
    };
    assert.equal(await viaScript(launchBrowser), true, 'default helper: CSP bypassed');
    assert.equal(await viaScript(launchBrowserStrictCsp), false, 'strict helper: CSP enforced');
  });
});
