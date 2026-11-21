/*
 * Links: target=_blank, modifier clicks, plain/self/hash/download/mailto
 * links, dynamically-created links, named targets, and the security-
 * relevant XSS-resistance of tab titles/links (T-70/T-71).
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
  loadFixturePath,
  sleep,
  withShellTest,
} from '../support/shell.mjs';

describe('new-window: links', () => {
  it('T-19: target=_blank opens a real link in a foreground shell tab, right after the opener', async () => {
    covers('T-19', ['FR-NEW-02']);
    await withShellTest({ loadPath: '/' }, async (page, { fixtureBase, context }) => {
      let realPageOpened = false;
      context.on('page', () => { realPageOpened = true; });
      await withFailureArtifacts('T-19', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#blank');
        await waitForTabCount(page, 2);
        let tabs = await tabsInfo(page);
        assert.ok(tabs[1].active, 'the new tab should be foreground');
        assert.equal(tabs[1].origin, 'link');
        await waitForTabTitle(page, 'Page 2');
        tabs = await tabsInfo(page);
        assert.equal(tabs[1].url, fixtureBase + '/p2');
        assert.equal(realPageOpened, false, 'no real browser tab/window should ever open');
      });
    });
  });

  it('T-20: Ctrl/Cmd-click and middle-click open a background tab, keeping the opener active', async () => {
    covers('T-20', ['FR-NEW-02']);
    await withShellTest({ loadPath: '/' }, async (page, { context }) => {
      let realPageOpened = false;
      context.on('page', () => { realPageOpened = true; });
      await withFailureArtifacts('T-20', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#self', { modifiers: ['Control'] });
        await waitForTabCount(page, 2);
        let tabs = await tabsInfo(page);
        assert.ok(tabs[0].active, 'the opener tab should remain active');
        assert.equal(tabs[1].active, false);

        await frame.click('#self', { button: 'middle' });
        await waitForTabCount(page, 3);
        tabs = await tabsInfo(page);
        assert.ok(tabs[0].active);
        assert.equal(tabs[1].origin, 'link');
        assert.equal(tabs[2].origin, 'link');
        assert.equal(realPageOpened, false);

        // opener content must be unaffected by either background open
        const openerFrame = await frameOf(page, tabs[0].id);
        assert.equal(await openerFrame.textContent('h1'), 'Target Home');
      });
    });
  });

  it('T-21: Shift-click opens a foreground tab', async () => {
    covers('T-21', ['FR-NEW-02']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-21', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#self', { modifiers: ['Shift'] });
        await waitForTabCount(page, 2);
        const tabs = await tabsInfo(page);
        assert.ok(tabs[1].active);
      });
    });
  });

  it('T-25: a plain link with no target navigates the same tab', async () => {
    covers('T-25', []);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-25', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#self');
        await waitForTabTitle(page, 'Page 2');
        assert.equal((await tabsInfo(page)).length, 1);
      });
    });
  });

  it('T-26: an in-page hash link scrolls without reloading or opening a tab', async () => {
    covers('T-26', []);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-26', page, async () => {
        const frame = await activeFrame(page);
        await frame.evaluate(() => { window.__marker = 'same-doc'; });
        await frame.click('#hash');
        // A hash-only navigation's scroll happens synchronously/near-
        // instantly in Chromium; polling for it directly is both faster
        // and more precise than a blind delay.
        await frame.waitForFunction(() => scrollY > 50);
        const frameAfter = await activeFrame(page);
        assert.equal(await frameAfter.evaluate(() => window.__marker), 'same-doc');
        assert.ok(await frameAfter.evaluate(() => scrollY) > 50);
        assert.equal((await tabsInfo(page)).length, 1);
      });
    });
  });

  it('T-27: download and mailto links are left to native handling (no tab opened)', async () => {
    covers('T-27', []);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-27', page, async () => {
        const frame = await activeFrame(page);
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
        await frame.click('#dl');
        await downloadPromise;
        assert.equal((await tabsInfo(page)).length, 1);

        // Confirming "no tab" for an unhandled scheme has no positive DOM
        // condition to wait on.
        await frame.click('#mailto').catch(() => {});
        await sleep(300);
        assert.equal((await tabsInfo(page)).length, 1);
      });
    });
  });

  it('T-30: links created dynamically (createElement and innerHTML) are still caught', async () => {
    covers('T-30', ['FR-NEW-03']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-30', page, async () => {
        let frame = await activeFrame(page);
        await frame.click('#dyn');
        await frame.click('#dynlink');
        await waitForTabCount(page, 2);

        await page.click('.tab:nth-child(1)');
        frame = await activeFrame(page);
        await frame.click('#dyn-inner');
        await frame.click('#innerlink');
        await waitForTabCount(page, 3);
      });
    });
  });

  it('T-31 / T-72: named targets reuse the same tab, and a closed name is not stale-reused', async () => {
    covers('T-31', ['FR-NEW-05']);
    covers('T-72', ['FR-NEW-05']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-31_T-72', page, async () => {
        let frame = await activeFrame(page);
        await frame.click('#named'); // target="foo" -> new tab
        await waitForTabCount(page, 2);
        await waitForTabTitle(page, 'Page 3');

        await page.click('.tab:nth-child(1)');
        frame = await activeFrame(page);
        await frame.click('#named'); // same name -> reuse, not a 3rd tab
        // Confirming the count *stays* at 2 (no 3rd tab) has no positive
        // condition to wait on.
        await sleep(400);
        let tabs = await tabsInfo(page);
        assert.equal(tabs.length, 2);
        assert.ok(tabs[1].active);
        assert.equal(tabs[1].name, 'foo');

        // T-72: close the named tab, then click again — must open a *new*
        // tab, not resurrect/misuse the old (now-gone) mapping.
        await page.click('.tab:nth-child(2) .tab-close');
        await waitForTabCount(page, 1);
        frame = await activeFrame(page);
        await frame.click('#named');
        await waitForTabCount(page, 2);
        tabs = await tabsInfo(page);
        assert.equal(tabs[1].name, 'foo');
        assert.ok(tabs[1].active);
      });
    });
  });

  it('T-70: a page that sets a script-injected, HTML-tag-shaped title is shown as inert text', async () => {
    covers('T-70', ['FR-TAB-15']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      let dialogFired = false;
      page.on('dialog', async (d) => {
        dialogFired = true;
        await d.dismiss();
      });
      await withFailureArtifacts('T-70', page, async () => {
        await loadFixturePath(page, fixtureBase, '/xss-title');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].title, '<img src=x onerror=alert(1)>');
        const titleEl = await page.$('.tab.is-active .tab-title');
        assert.equal(await titleEl.evaluate((e) => e.children.length), 0, 'title must be plain text, not parsed HTML');
        assert.equal(dialogFired, false, 'onerror must never execute');
      });
    });
  });

  it('T-71: HTML-tag-shaped href/title attributes on a proxied page render as text, not markup', async () => {
    covers('T-71', ['FR-TAB-15']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-71', page, async () => {
        await loadFixturePath(page, fixtureBase, '/xss-favicon');
        const frame = await activeFrame(page);
        // the link's visible text must be the escaped/plain form, never
        // interpreted as a nested element
        const evilLink = await frame.$('#evil');
        assert.equal(await evilLink.evaluate((e) => e.children.length), 0);
        assert.match(await evilLink.getAttribute('title'), /<img src=x onerror=alert\(1\)>/);
      });
    });
  });
});
