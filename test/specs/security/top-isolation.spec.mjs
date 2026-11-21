/*
 * T-80: a proxied page's script cannot reach the shell's own DOM/state
 * through window.top / window.parent — Ultraviolet rewrites those to
 * point at UV's own proxy objects rather than exposing the real shell.
 * This is a defence-in-depth regression check on UV's own behaviour, not
 * a Yoroxy-specific feature, but it's exactly the kind of thing that could
 * silently regress on a UV version bump.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../../support/failure-artifacts.mjs';
import { covers } from '../../support/traceability.mjs';
import { activeFrame, withShellTest } from '../../support/shell.mjs';

describe('security: top-frame isolation', () => {
  it('T-80: window.top from a proxied page\'s own script cannot reach the shell\'s bridge or DOM', async () => {
    covers('T-80', ['SECURITY-TOP-ISOLATION']);
    await withShellTest({ loadPath: '/top-probe' }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-80', page, async () => {
        // The probe script runs as part of the page's own <script> tag, so
        // it goes through Ultraviolet's normal JS rewriting — unlike a
        // Playwright-injected evaluate(), which would bypass that pipeline
        // entirely and prove nothing about real page scripts.
        const frame = await activeFrame(page);
        await frame.waitForFunction(() => document.title === 'Top Probe Done');
        const probe = JSON.parse(await frame.textContent('#result'));

        assert.notEqual(probe.hasYoroxyShell, true, 'proxied script must not see the real __yoroxyShell bridge');
        assert.notEqual(probe.canSeeAddressBar, true, "proxied script must not reach the shell's #address input");

        // And the shell's own address bar must still faithfully show the
        // fixture's URL, unaffected by the probe.
        assert.equal(await page.inputValue('#address'), fixtureBase + '/top-probe');
      });
    });
  });
});
