/*
 * Keyboard access: roving-tabindex arrow-key navigation on the tab strip
 * (FR-TAB-14), and shell-wide shortcuts Alt+T/W/L/1-9 (FR-TAB-16).
 * Previously untested despite being fully implemented.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { tabsInfo, withShellTest } from '../support/shell.mjs';

describe('tab keyboard navigation', () => {
  it('T-47: ArrowRight moves focus and selection forward on the horizontal strip', async () => {
    covers('T-47', ['FR-TAB-14']);
    await withShellTest({ extraTabs: 2 }, async (page) => {
      await withFailureArtifacts('T-47', page, async () => {
        const first = page.locator('.tab-hit').first();
        await first.focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        const tabs = await tabsInfo(page);
        assert.ok(tabs[2].active, 'the 3rd tab should be active');
        const focused = await page.ui.evaluate(() => document.activeElement.closest('.tab').getAttribute('data-id'));
        assert.equal(focused, tabs[2].id);
        assert.equal(await page.locator('.tab-hit').nth(2).getAttribute('aria-selected'), 'true');
      });
    });
  });

  it('T-48: ArrowDown/ArrowUp do the same job on the vertical strip', async () => {
    covers('T-48', ['FR-TAB-14']);
    await withShellTest({ extraTabs: 2 }, async (page) => {
      await withFailureArtifacts('T-48', page, async () => {
        await page.evaluate(() => window.Yoroxy.settings.setTabLayout('vertical'));
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');
        const first = page.locator('.tab-hit').first();
        await first.focus();
        await page.keyboard.press('ArrowDown');
        let tabs = await tabsInfo(page);
        assert.ok(tabs[1].active);
        await page.keyboard.press('ArrowUp');
        tabs = await tabsInfo(page);
        assert.ok(tabs[0].active);
      });
    });
  });

  it('T-49: Home/End jump to the first/last tab', async () => {
    covers('T-49', ['FR-TAB-14']);
    await withShellTest({ extraTabs: 3 }, async (page) => {
      await withFailureArtifacts('T-49', page, async () => {
        const second = page.locator('.tab-hit').nth(1);
        await second.focus();
        await page.keyboard.press('End');
        let tabs = await tabsInfo(page);
        assert.ok(tabs[3].active);
        await page.keyboard.press('Home');
        tabs = await tabsInfo(page);
        assert.ok(tabs[0].active);
      });
    });
  });

  it('T-50: Enter/Space activates the focused tab', async () => {
    covers('T-50', ['FR-TAB-14']);
    await withShellTest({ extraTabs: 2 }, async (page) => {
      await withFailureArtifacts('T-50', page, async () => {
        const middle = page.locator('.tab-hit').nth(1);
        await middle.focus();
        await page.keyboard.press('Enter');
        let tabs = await tabsInfo(page);
        assert.ok(tabs[1].active);
        // move focus elsewhere, then Space on the 3rd tab
        const third = page.locator('.tab-hit').nth(2);
        await third.focus();
        await page.keyboard.press(' ');
        tabs = await tabsInfo(page);
        assert.ok(tabs[2].active);
      });
    });
  });

  it('T-51: Alt+T / Alt+W / Alt+L chain — new tab, close it, focus the address bar', async () => {
    covers('T-51', ['FR-TAB-16']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-51', page, async () => {
        await page.click('#tabbar'); // chrome area outside the tab's iframe, so keydown reaches the shell
        await page.keyboard.press('Alt+t');
        assert.equal((await tabsInfo(page)).length, 2);
        await page.keyboard.press('Alt+w');
        assert.equal((await tabsInfo(page)).length, 1);
        await page.keyboard.press('Alt+l');
        assert.equal(await page.ui.evaluate(() => document.activeElement.id), 'address');
      });
    });
  });

  it('T-52: Alt+3 then Alt+9 select the 3rd tab, then the last tab', async () => {
    covers('T-52', ['FR-TAB-16']);
    await withShellTest({ extraTabs: 4 }, async (page) => {
      await withFailureArtifacts('T-52', page, async () => {
        await page.click('#tabbar');
        await page.keyboard.press('Alt+3');
        let tabs = await tabsInfo(page);
        assert.ok(tabs[2].active);
        await page.keyboard.press('Alt+9');
        tabs = await tabsInfo(page);
        assert.ok(tabs[4].active, 'Alt+9 should select the last tab regardless of count');
      });
    });
  });
});
