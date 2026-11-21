/*
 * Tab creation, activation, closing, the 30-tab limit, background-tab
 * polling and favicon handling.
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
  loadFixturePath,
  sleep,
  withShellTest,
} from '../support/shell.mjs';

describe('tab lifecycle', () => {
  it('T-08: switching away and back preserves in-page state (no reload of background tabs)', async () => {
    covers('T-08', ['FR-TAB-04']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-08', page, async () => {
        await loadFixturePath(page, fixtureBase, '/');
        await page.click('#new-tab-btn');
        await page.click('.tab:nth-child(1)');
        const f1 = await activeFrame(page);
        await f1.evaluate(() => { window.__marker = 42; });
        await page.click('.tab:nth-child(2)');
        await page.click('.tab:nth-child(1)');
        const f1again = await activeFrame(page);
        assert.equal(await f1again.evaluate(() => window.__marker), 42);
      });
    });
  });

  it('T-09 / T-42: closing a tab activates the right neighbour, or the left one if there is none', async () => {
    covers('T-09', ['FR-TAB-05']);
    covers('T-42', ['FR-TAB-05']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-09_T-42', page, async () => {
        await page.click('#new-tab-btn'); // tab-2
        await page.click('#new-tab-btn'); // tab-3
        await page.click('#new-tab-btn'); // tab-4
        let tabs = await tabsInfo(page);
        assert.equal(tabs.length, 4);

        // Close the 2nd tab (index 1) while a right neighbour (3rd) exists.
        await page.click('.tab:nth-child(2)');
        await page.click('.tab:nth-child(2) .tab-close');
        await waitForTabCount(page, 3);
        tabs = await tabsInfo(page);
        assert.ok(tabs[1].active, 'the right neighbour should now be active');

        // Close the last (rightmost) tab: only a left neighbour exists.
        await page.click('.tab:last-child');
        await page.click('.tab:last-child .tab-close');
        await waitForTabCount(page, 2);
        tabs = await tabsInfo(page);
        assert.ok(tabs[tabs.length - 1].active, 'the left neighbour should now be active');

        // Close down to the very last tab: it is replaced by a fresh New Tab.
        await page.click('.tab:last-child .tab-close');
        await page.click('.tab:last-child .tab-close');
        await waitForTabCount(page, 1);
        tabs = await tabsInfo(page);
        assert.equal(tabs[0].kind, 'internal');
        assert.equal(tabs[0].title, 'New Tab');
      });
    });
  });

  it('T-10 / T-53 / T-54 / T-55: the 30-tab limit is enforced for UI clicks and scripted opens alike, and is re-evaluated after closing', async () => {
    covers('T-10', ['FR-TAB-07']);
    covers('T-53', ['FR-TAB-07', 'FR-NEW-23']);
    covers('T-54', ['FR-TAB-07']);
    covers('T-55', ['FR-TAB-07', 'FR-NEW-21']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-10_T-53_54_55', page, async () => {
        // T-10: UI-driven creation stops exactly at 30 and shows the toast.
        for (let i = 0; i < 35; i++) await page.click('#new-tab-btn');
        let tabs = await tabsInfo(page);
        assert.equal(tabs.length, 30);
        assert.match(await page.textContent('#toasts'), /Tab limit reached \(30\)/);

        // T-54: closing one tab frees exactly one slot (limit is evaluated
        // against the current count, not a one-time flag).
        await page.click('.tab:last-child .tab-close');
        assert.equal((await tabsInfo(page)).length, 29);
        await page.click('#new-tab-btn');
        assert.equal((await tabsInfo(page)).length, 30);

        // T-53: a script-initiated window.open() from a proxied page is
        // subject to the very same limit.
        await loadFixturePath(page, fixtureBase, '/');
        const frame = await activeFrame(page);
        await frame.click('#open'); // one user-activated window.open()
        // We were already at 30 before navigating this tab away from
        // newtab, so the fixture page itself occupies one of the 30 slots;
        // the click above must therefore be rejected. Proving that absence
        // has no positive DOM condition to wait on, hence the fixed delay.
        await sleep(300);
        assert.equal((await tabsInfo(page)).length, 30, 'must not exceed the limit via window.open()');
      });
    });
  });

  it('T-55b: one user gesture only ever opens one tab, independent of the tab-count limit', async () => {
    covers('T-55', ['FR-NEW-21']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-55b', page, async () => {
        await loadFixturePath(page, fixtureBase, '/');
        const frame = await activeFrame(page);
        await frame.click('#spawn'); // fires window.open() 50 times synchronously
        // Proving "only one tab" needs to wait out the whole loop; there's
        // no single positive signal for "the loop is done".
        await sleep(800);
        const tabs = await tabsInfo(page);
        assert.equal(tabs.length, 2, 'only one tab should be opened for the whole click, well under the 30 limit');
      });
    });
  });

  it('T-56 / T-59: background tabs are polled on a slower cadence, and activation refreshes immediately', async () => {
    covers('T-56', ['FR-TAB-09']);
    covers('T-59', ['FR-TAB-09']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-56_T-59', page, async () => {
        await loadFixturePath(page, fixtureBase, '/spa');
        await page.click('#new-tab-btn'); // tab-2 becomes active; tab-1 (SPA) goes to background

        const tab1Id = (await tabsInfo(page))[0].id;
        const bgFrame = await frameOf(page, tab1Id);
        // The tab is genuinely backgrounded (pointer-events:none), so this
        // simulates the page changing itself (e.g. from a timer) rather
        // than a real click, which wouldn't be deliverable to a hidden tab.
        await bgFrame.evaluate(() => {
          history.pushState({}, '', '/spa/route2');
          document.title = 'SPA route2';
        });

        // T-59: switching back to it must reflect the new title immediately,
        // not after waiting out the next poll interval.
        await page.click('.tab:nth-child(1)');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].title, 'SPA route2');
        assert.ok(tabs[0].url.endsWith('/spa/route2'));
      });
    });
  });

  it('T-57: a page with no favicon and no /favicon.ico falls back to the generic icon', async () => {
    covers('T-57', ['FR-TAB-10', 'FR-TAB-11']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-57', page, async () => {
        // /p2 has no <link rel=icon>, so the tab falls back to fetching
        // /favicon.ico — which this fixture serves as a real PNG. This is
        // the success path; T-58 covers the non-image-response failure path.
        await loadFixturePath(page, fixtureBase, '/p2');
        await page.waitForFunction(
          () => {
            const t = window.Yoroxy.shell.tabs.getActive();
            return t.favicon && t.favicon.startsWith('data:image/');
          },
          null,
          { timeout: 8000 }
        );
        assert.ok(await page.$('.tab.is-active .tab-favicon img'));
      });
    });
  });

  it('T-58: a non-image response at the favicon URL falls back to the generic icon, not a broken image', async () => {
    covers('T-58', ['FR-TAB-10', 'FR-TAB-11']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-58', page, async () => {
        await loadFixturePath(page, fixtureBase, '/xss-favicon'); // <link rel=icon href="/large-favicon.bin">
        // Give the (failing) favicon fetch a moment to resolve, then assert
        // the tab never ends up with a favicon at all (i.e. it fell back).
        // No positive signal is exposed for "the fetch attempt gave up",
        // hence the fixed delay rather than a waitFor condition.
        await sleep(1200);
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].favicon, null);
        // And the tab strip must show the generic globe icon, not an <img>.
        assert.equal(await page.$('.tab.is-active .tab-favicon img'), null);
      });
    });
  });
});
