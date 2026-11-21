/*
 * Right-click context menu on a tab: Reload / Duplicate / Close other tabs /
 * Close tabs to the right (or below, in vertical layout). Previously
 * untested despite being fully implemented (FR-TAB-13).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  waitForTabCount,
  withShellTest,
} from '../support/shell.mjs';

async function openMenuOn(page, nth) {
  const tab = page.locator(`.tab:nth-child(${nth})`);
  const box = await tab.boundingBox();
  await tab.click({ button: 'right' });
  return box;
}

describe('tab context menu', () => {
  it('T-43: Reload reloads only the clicked tab', async () => {
    covers('T-43', ['FR-TAB-13']);
    await withShellTest({ loadPath: '/p2', extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-43', page, async () => {
        const tabs = await tabsInfo(page);
        const aId = tabs[0].id;
        const aFrame = await page.mainFrame().$(`iframe[data-tab-id="${aId}"]`).then((h) => h.contentFrame());
        await aFrame.evaluate(() => { window.__marker = 'before-reload'; });

        await openMenuOn(page, 1);
        await page.click('#ctxmenu button:has-text("Reload")');
        await page.waitForFunction(
          (id) => {
            const t = window.Yoroxy.shell.tabs.getTabs().find((x) => x.id === id);
            return t && t.loading === false;
          },
          aId,
          { timeout: 15000 }
        );
        const aFrameAfter = await page.mainFrame().$(`iframe[data-tab-id="${aId}"]`).then((h) => h.contentFrame());
        assert.equal(await aFrameAfter.evaluate(() => window.__marker), undefined);
      });
    });
  });

  it('T-44: Duplicate opens a copy of the same URL, active, next to the source tab', async () => {
    covers('T-44', ['FR-TAB-13']);
    await withShellTest({ loadPath: '/p2', extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-44', page, async () => {
        const before = await tabsInfo(page);
        await openMenuOn(page, 1); // the /p2 tab
        await page.click('#ctxmenu button:has-text("Duplicate")');
        await waitForTabCount(page, before.length + 1);
        const after = await tabsInfo(page);
        assert.equal(after[1].url, before[0].url);
        assert.ok(after[1].active);
      });
    });
  });

  it('T-45: Close other tabs leaves only the clicked tab', async () => {
    covers('T-45', ['FR-TAB-13']);
    await withShellTest({ loadPath: '/p2', extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-45', page, async () => {
        const before = await tabsInfo(page);
        const targetId = before[2].id; // the 3rd tab (C)
        await openMenuOn(page, 3);
        await page.click('#ctxmenu button:has-text("Close other tabs")');
        await waitForTabCount(page, 1);
        const after = await tabsInfo(page);
        assert.equal(after[0].id, targetId);
        assert.ok(after[0].active);
      });
    });
  });

  it('T-46: Close tabs to the right is disabled on the last tab, and closes only the right side otherwise', async () => {
    covers('T-46', ['FR-TAB-13']);
    await withShellTest({ loadPath: '/p2', extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-46', page, async () => {
        // On the rightmost tab (D), the action must be disabled.
        await openMenuOn(page, 4);
        const disabled = await page.getAttribute('#ctxmenu button:has-text("Close tabs to the right")', 'disabled');
        assert.notEqual(disabled, null, 'expected the action to be disabled on the last tab');
        await page.keyboard.press('Escape');

        // On the 2nd tab (B), it closes C and D only.
        const before = await tabsInfo(page);
        await openMenuOn(page, 2);
        await page.click('#ctxmenu button:has-text("Close tabs to the right")');
        await waitForTabCount(page, 2);
        const after = await tabsInfo(page);
        assert.equal(after[0].id, before[0].id);
        assert.equal(after[1].id, before[1].id);
      });
    });
  });

  it('T-46b: in vertical layout the label reads "Close tabs below"', async () => {
    covers('T-46', ['FR-TAB-13', 'FR-UI-04']);
    await withShellTest({ loadPath: '/p2', extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-46b', page, async () => {
        await page.evaluate(() => window.Yoroxy.settings.setTabLayout('vertical'));
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');
        await openMenuOn(page, 2);
        assert.ok(await page.$('#ctxmenu button:has-text("Close tabs below")'));
        assert.equal(await page.$('#ctxmenu button:has-text("Close tabs to the right")'), null);
      });
    });
  });
});
