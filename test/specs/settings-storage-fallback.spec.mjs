/*
 * T-18: when localStorage is unavailable/blocked, settings still work
 * in-memory for the session, with a visible warning banner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { withShellTest } from '../support/shell.mjs';

describe('settings: storage fallback', () => {
  it('T-18: shows a warning banner and still applies changes in-memory when storage throws', async () => {
    covers('T-18', ['FR-SET-41']);
    await withShellTest({ disableStorage: true }, async (page) => {
      await withFailureArtifacts('T-18', page, async () => {
        await page.click('#settings-btn');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
        );
        const id = await page.evaluate(() => window.Yoroxy.shell.tabs.getActive().id);
        const frame = await page.mainFrame().$(`iframe[data-tab-id="${id}"]`).then((h) => h.contentFrame());

        assert.ok(await frame.isVisible('#storage-warning'));

        await frame.click('input[name="tab-layout"][value="vertical"]');
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');
        assert.equal(await page.getAttribute('html', 'data-tab-layout'), 'vertical');
      });
    });
  });
});
