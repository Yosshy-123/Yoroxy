/*
 * SEC-T5: Subresource Integrity and the script hashes in the CSP.
 *
 *  - Normal delivery: every <script src> of every page has an integrity
 *    attribute equal to the SHA-256 of the file actually served, and the
 *    page's CSP lists exactly that hash.
 *  - Tampered delivery: when one byte of a script differs on the wire, the
 *    browser refuses to run it and the shell does not start. (SRI is not
 *    affected by Playwright's CSP bypass, so the ordinary functional browser
 *    is enough.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ensureServers } from '../../support/ensure-servers.mjs';
import { launchBrowser } from '../../support/browser.mjs';
import { covers } from '../../support/traceability.mjs';

const PAGES = ['/', '/container.html', '/internal/newtab.html', '/internal/settings.html', '/internal/error.html'];

describe('security: script integrity', () => {
  it('SEC-T5: integrity attributes and CSP hashes match the served scripts', async () => {
    covers('SEC-T5', ['SECURITY-SRI']);
    const { appBase } = await ensureServers();
    for (const p of PAGES) {
      const res = await fetch(appBase + p);
      const html = await res.text();
      const csp = res.headers.get('content-security-policy');
      const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
      assert.ok(tags.length > 0, `${p}: has scripts`);
      for (const tag of tags) {
        const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
        const integrity = /\bintegrity="([^"]+)"/.exec(tag)?.[1];
        assert.ok(src && integrity, `${p}: ${tag} needs src and integrity`);
        const bytes = Buffer.from(await (await fetch(new URL(src, appBase))).arrayBuffer());
        const actual = 'sha256-' + crypto.createHash('sha256').update(bytes).digest('base64');
        assert.equal(integrity, actual, `${p}: ${src}`);
        assert.ok(csp.includes(`'${actual}'`), `${p}: CSP lacks the hash of ${src}`);
      }
      assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, `${p}: no inline script`);
    }
  });

  it('SEC-T5: a script whose bytes differ from the hashed ones is not executed and the shell does not start', async () => {
    covers('SEC-T5b', ['SECURITY-SRI']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const messages = [];
      page.on('console', (m) => messages.push(m.text()));

      // Any change to the bytes must be refused; here, extra text at the end.
      await page.route('**/assets/js/container/tab-history.js', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + '\n' + 'window.__tampered = 1;' });
      });
      await page.goto(appBase + '/container.html');
      await page.waitForTimeout(1500);

      assert.equal(await page.evaluate(() => window.__tampered), undefined, 'the modified script must not run');
      assert.equal(await page.locator('#tablist .tab').count(), 0, 'the shell must not boot with a refused script');
      assert.ok(
        messages.some((m) => /integrity/i.test(m)),
        `the browser should report the integrity failure; console: ${messages.join(' | ')}`
      );
    } finally {
      await browser.close();
    }
  });
});
