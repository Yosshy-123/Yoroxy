/*
 * Forms: GET/POST submission with target=_blank, and programmatic
 * form.submit(). T-28 / T-29.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  activeFrame,
  frameOf,
  waitForTabCount,
  waitForTabTitle,
  withShellTest,
} from '../support/shell.mjs';

describe('new-window: forms', () => {
  it('T-28: a GET form and a programmatic form.submit(), both target=_blank, open a foreground tab', async () => {
    covers('T-28', ['FR-NEW-02', 'FR-NEW-08']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-28', page, async () => {
        let frame = await activeFrame(page);
        await frame.click('#fget-btn');
        await waitForTabCount(page, 2);
        await waitForTabTitle(page, 'Search hello world');
        let tabs = await tabsInfo(page);
        assert.equal(tabs[1].title, 'Search hello world');

        await page.click('.tab:nth-child(1)');
        frame = await activeFrame(page);
        await frame.click('#fprog-btn'); // document.getElementById('fprog').submit()
        await waitForTabCount(page, 3);
        await waitForTabTitle(page, 'Search prog');

        // the opener's own form target attribute is restored afterwards
        assert.equal(await frame.getAttribute('#fpost', 'target'), '_blank');

        // a form with no target navigates the same tab
        await page.click('.tab:nth-child(1)');
        frame = await activeFrame(page);
        await frame.click('#fself-btn');
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getTabs()[0].title === 'Search selfq', null, {
          timeout: 15000,
        });
        assert.equal((await tabsInfo(page)).length, 3);
      });
    });
  });

  it('T-29: a POST form with target=_blank delivers a real POST to the new tab', async () => {
    covers('T-29', ['FR-NEW-02']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-29', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#fpost-btn');
        await waitForTabCount(page, 2);
        const gotTitle = await Promise.race([
          waitForTabTitle(page, 'Post result').then(() => true),
          new Promise((r) => setTimeout(() => r(false), 15000)),
        ]);
        assert.ok(gotTitle, 'expected the POST result page to load in the new tab');
        const tabs = await tabsInfo(page);
        const postTab = tabs.find((t) => t.title === 'Post result');
        const postFrame = await frameOf(page, postTab.id);
        assert.equal(await postFrame.textContent('#method'), 'POST');
        assert.equal(await postFrame.textContent('#body'), 'a=1');
      });
    });
  });
});
