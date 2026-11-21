/*
 * SEC-T2 / SEC-T7: the Content-Security-Policy on the app's own pages.
 *
 * SEC-T2  Even a page that has reached the shell (residual risk R1) must not
 *         be able to run code in it: Function(), string timers,
 *         inline <script> and inline event handlers are all refused. The
 *         same attack with the CSP bypassed is the positive control - without
 *         it, "nothing ran" could simply mean the probe never reached the shell.
 * SEC-T7  Every HTML page carries the policy and the other security headers,
 *         and the shell that the launcher injects into an about:blank window
 *         (which inherits the launcher's policy) is covered too.
 *
 * The strict-CSP browser forbids string evaluation inside the page, so these
 * tests use only evaluate(), waitForSelector() and the address bar. Code that
 * page.evaluate() itself runs is exempt from the CSP (it comes from DevTools),
 * so what the page's policy blocks is tested with mechanisms the page owns:
 * script elements, inline handlers, and a real page script (the probe).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServers } from '../../support/ensure-servers.mjs';
import { launchBrowser, launchBrowserStrictCsp } from '../../support/browser.mjs';
import { withFailureArtifacts } from '../../support/failure-artifacts.mjs';
import { covers } from '../../support/traceability.mjs';
import { openShell, wrapShellPage, waitForInterface } from '../../support/shell.mjs';

const FLAGS = ['__csp_fn', '__csp_timer', '__csp_inline', '__csp_onerror'];

/** Runs the attack from /csp-probe and returns which flags the shell ended up with. */
async function attackShell(launch, { appBase, fixtureBase }, name) {
  const browser = await launch();
  try {
    const context = await browser.newContext();
    const { page } = await openShell(context, appBase, '/container.html', { viaDom: true });
    return await withFailureArtifacts(name, page, async () => {
      await page.click('#address');
      await page.fill('#address', fixtureBase + '/csp-probe');
      await page.press('#address', 'Enter');
      await page.waitForSelector('.tab.is-active .tab-title:text-is("CSP Probe Done")', { timeout: 15000 });
      return page.evaluate((names) => Object.fromEntries(names.map((n) => [n, window[n] === 1])), FLAGS);
    });
  } finally {
    await browser.close();
  }
}

describe('security: Content-Security-Policy', () => {
  it('SEC-T2: a page that reaches the shell cannot run code in it', async () => {
    covers('SEC-T2', ['SECURITY-CSP']);
    const env = await ensureServers();

    const control = await attackShell(launchBrowser, env, 'SEC-T2-control');
    assert.deepEqual(
      control,
      Object.fromEntries(FLAGS.map((n) => [n, true])),
      'positive control: without the CSP every attack must work, or the probe proves nothing'
    );

    const enforced = await attackShell(launchBrowserStrictCsp, env, 'SEC-T2');
    assert.deepEqual(enforced, Object.fromEntries(FLAGS.map((n) => [n, false])), 'with the CSP nothing may run');
  });

  it('SEC-T7: every HTML page has the CSP and the other security headers', async () => {
    covers('SEC-T7', ['SECURITY-HEADERS']);
    const { appBase } = await ensureServers();
    const paths = ['/', '/index.html', '/container.html', '/internal/newtab.html', '/internal/settings.html', '/internal/error.html'];
    const policies = {};
    for (const p of paths) {
      const res = await fetch(appBase + p);
      assert.equal(res.status, 200, p);
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp, `${p}: Content-Security-Policy`);
      policies[p] = csp;

      const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
      assert.match(scriptSrc, /^script-src( 'sha256-[A-Za-z0-9+/=]+')+$/, `${p}: script-src must list only hashes`);
      assert.doesNotMatch(csp, /unsafe-eval|unsafe-hashes|\*/, `${p}: no unsafe-eval / wildcards`);
      assert.doesNotMatch(scriptSrc, /unsafe-inline|'self'/, `${p}: scripts are not allowed by 'self' or inline`);
      for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-src 'self'", "worker-src 'self'"]) {
        assert.ok(csp.includes(directive), `${p}: ${directive}`);
      }
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
      assert.match(res.headers.get('cache-control'), /no-cache/, p);
    }

    // The launcher's policy must also admit the shell it injects (see INJECTED_PAGES).
    const hashes = (csp) => csp.match(/'sha256-[^']+'/g);
    for (const h of hashes(policies['/container.html'])) {
      assert.ok(hashes(policies['/']).includes(h), `the launcher's CSP is missing a shell script hash ${h}`);
    }

    // Not only pages: assets and errors carry the headers too.
    for (const p of ['/assets/js/common/config.js', '/uv/uv.config.js', '/nope']) {
      const res = await fetch(appBase + p);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
    }
  });

  it('SEC-T7: the shell injected into about:blank by the launcher enforces the CSP as well', async () => {
    covers('SEC-T7b', ['SECURITY-HEADERS']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowserStrictCsp({ blockExternalNetwork: true });
    try {
      const context = await browser.newContext();
      const original = await context.newPage();
      const popupPromise = context.waitForEvent('page');
      await original.goto(appBase + '/');
      const shell = wrapShellPage(await popupPromise);
      // The shell booting at all proves its scripts pass the inherited policy and SRI.
      // (The tab bar is in the interface frame; the container itself is the about:blank page.)
      await waitForInterface(shell);
      assert.equal(shell.url(), 'about:blank', 'this must be the injected copy, not a real shell page');

      const outcome = await shell.evaluate(async () => {
        const violations = [];
        document.addEventListener('securitypolicyviolation', (e) => violations.push(e.effectiveDirective));
        const s = document.createElement('script');
        s.textContent = 'window.__inj_inline = 1';
        document.body.appendChild(s);
        document.body.insertAdjacentHTML('beforeend', '<img src="x:" onerror="window.__inj_onerror = 1">');
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { ran: [window.__inj_inline === 1, window.__inj_onerror === 1], violations };
      });
      assert.deepEqual(outcome.ran, [false, false], 'injected code must not run in the launcher-opened shell');
      assert.ok(outcome.violations.some((d) => d.startsWith('script-src-elem')), `inline script reported: ${outcome.violations}`);
      assert.ok(outcome.violations.some((d) => d.startsWith('script-src-attr')), `inline handler reported: ${outcome.violations}`);
    } finally {
      await browser.close();
    }
  });
});
