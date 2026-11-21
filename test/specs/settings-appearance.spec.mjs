/*
 * Settings > Appearance: tab-layout switch, its immediate effect on all
 * open shells (via the storage event), and the gear icon's fixed position.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { assertSymmetricPadding, rectOf } from '../support/assert-layout.mjs';
import {
  openShell,
  tabsInfo,
  activeFrame,
  waitForActiveTab,
  loadFixturePath,
  withShellTest,
} from '../support/shell.mjs';

async function openSettings(page) {
  await page.click('#settings-btn');
  await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
}

describe('settings: appearance', () => {
  it('T-11: the gear icon opens Settings once, reusing the existing tab on a second click', async () => {
    covers('T-11', ['FR-INT-02', 'FR-INT-03']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-11', page, async () => {
        await openSettings(page);
        let tabs = await tabsInfo(page);
        assert.equal(tabs.length, 2);
        assert.equal(tabs[1].title, 'Settings');
        assert.equal(tabs[1].url, 'yoroxy://settings');
        assert.equal(await page.inputValue('#address'), 'yoroxy://settings');

        await page.click('.tab:nth-child(1)');
        await page.click('#settings-btn');
        tabs = await tabsInfo(page);
        assert.equal(tabs.length, 2, 'must not open a duplicate settings tab');
        assert.ok(tabs[1].active);
      });
    });
  });

  it('T-12: switching to vertical applies instantly, without reloading tabs, and syncs to another window', async () => {
    covers('T-12', ['FR-SET-10', 'FR-UI-04', 'FR-UI-05', 'FR-SET-43']);
    await withShellTest({}, async (page1, { context, appBase, fixtureBase }) => {
      const { page: page2 } = await openShell(context, appBase);
      await withFailureArtifacts('T-12', page1, async () => {
        await loadFixturePath(page1, fixtureBase, '/');
        const frame = await activeFrame(page1);
        await frame.evaluate(() => { window.__marker = 'alive'; });

        await openSettings(page1);
        const settingsFrame = await activeFrame(page1);
        await settingsFrame.click('input[name="tab-layout"][value="vertical"]');

        await page1.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');
        const box = await rectOf(page1, '#tabbar');
        assert.equal(Math.round(box.width), 240);
        await assertSymmetricPadding(
          await page1.$('#tabbar'),
          await page1.$('#new-tab-btn'),
          'x',
          0.5,
          'vertical sidebar left/right padding must be symmetric'
        );

        // the fixture tab was not touched by the layout change
        await page1.click('.tab:nth-child(1)');
        const frameAfter = await activeFrame(page1);
        assert.equal(await frameAfter.evaluate(() => window.__marker), 'alive');

        // a second, independent shell window picks up the change too
        await page2.ui.waitForFunction(
          () => document.documentElement.getAttribute('data-tab-layout') === 'vertical',
          null,
          { timeout: 5000 }
        );
      });
    });
  });
});
