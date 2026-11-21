/*
 * Tab reordering by drag & drop (FR-TAB-12). Previously untested despite
 * tab-ui.js implementing full HTML5 drag/drop handling.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  loadFixturePath,
  withShellTest,
} from '../support/shell.mjs';

/* tab A = /p2, tab B = /p3, tab C = New Tab */
const LABELED_TABS = {
  loadPath: '/p2',
  setup: async (page, { fixtureBase }) => {
    await page.click('#new-tab-btn');
    await loadFixturePath(page, fixtureBase, '/p3');
    await page.click('#new-tab-btn');
  },
};

describe('tab drag & drop', () => {
  it('T-39: dragging shows .dragging / .drop-before-after visual state', async () => {
    covers('T-39', ['FR-TAB-12']);
    await withShellTest(LABELED_TABS, async (page) => {
      await withFailureArtifacts('T-39', page, async () => {
        const first = page.locator('.tab').nth(0);
        const third = page.locator('.tab').nth(2);
        const box1 = await first.boundingBox();
        const box3 = await third.boundingBox();

        await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
        await page.mouse.down();
        await page.mouse.move(box3.x + box3.width - 2, box3.y + box3.height / 2, { steps: 10 });
        assert.ok(await first.evaluate((e) => e.classList.contains('dragging')));
        const thirdHasDropMark = await third.evaluate(
          (e) => e.classList.contains('drop-before') || e.classList.contains('drop-after')
        );
        assert.ok(thirdHasDropMark, 'the hovered drop target should show a drop-before/after mark');
        await page.mouse.up();

        // visual state must be cleared afterwards, whatever the outcome
        assert.equal(await first.evaluate((e) => e.classList.contains('dragging')), false);
      });
    });
  });

  it('T-40: dragging tab A past tab C reorders to B, C, A without reloading any tab', async () => {
    covers('T-40', ['FR-TAB-12']);
    await withShellTest(LABELED_TABS, async (page) => {
      await withFailureArtifacts('T-40', page, async () => {
        const before = await tabsInfo(page);
        const [aId, bId, cId] = before.map((t) => t.id);

        // Mark tab A's frame so we can prove it wasn't reloaded by the move.
        const aFrame = await page.mainFrame().$(`iframe[data-tab-id="${aId}"]`).then((h) => h.contentFrame());
        await aFrame.evaluate(() => { window.__marker = 'still-here'; });

        await page.locator('.tab').nth(0).dragTo(page.locator('.tab').nth(2));

        const after = await tabsInfo(page);
        assert.deepEqual(
          after.map((t) => t.id),
          [bId, cId, aId],
          `expected order [B,C,A], got ${JSON.stringify(after.map((t) => t.id))}`
        );

        const aFrameAfter = await page.mainFrame().$(`iframe[data-tab-id="${aId}"]`).then((h) => h.contentFrame());
        assert.equal(await aFrameAfter.evaluate(() => window.__marker), 'still-here');
      });
    });
  });

  it('T-41: the same reordering works in the vertical layout (top-to-bottom)', async () => {
    covers('T-41', ['FR-TAB-12']);
    await withShellTest(LABELED_TABS, async (page) => {
      await withFailureArtifacts('T-41', page, async () => {
        await page.evaluate(() => window.Yoroxy.settings.setTabLayout('vertical'));
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');

        const before = await tabsInfo(page);
        const [aId, bId, cId] = before.map((t) => t.id);

        await page.locator('.tab').nth(0).dragTo(page.locator('.tab').nth(2));

        const after = await tabsInfo(page);
        assert.deepEqual(after.map((t) => t.id), [bId, cId, aId]);
      });
    });
  });
});
