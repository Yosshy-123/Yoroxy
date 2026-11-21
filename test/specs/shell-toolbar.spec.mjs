/*
 * Toolbar basics: initial boot state, address bar display, navigation
 * history (back/forward/reload/stop), and the "+" new-tab button.
 * Test IDs: T-01, T-02, T-06, T-06b, T-06c, T-06d, T-07, T-63, T-64.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  typeAddress,
  activeFrame,
  waitForActiveTab,
  loadFixturePath,
  openInjectedShell,
  withShellTest,
} from '../support/shell.mjs';

describe('shell toolbar', () => {
  it('T-01: boots with exactly one New Tab, address bar empty', async () => {
    covers('T-01', ['FR-INT-01']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-01', page, async () => {
        const tabs = await tabsInfo(page);
        assert.equal(tabs.length, 1);
        assert.equal(tabs[0].kind, 'internal');
        assert.equal(tabs[0].title, 'New Tab');
        assert.equal(await page.inputValue('#address'), '');
      });
    });
  });

  it('T-02: navigating shows the real decoded URL, not the proxy path', async () => {
    covers('T-02', ['FR-URL-01']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-02', page, async () => {
        await loadFixturePath(page, fixtureBase, '/');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].url, fixtureBase + '/');
        assert.equal(tabs[0].title, 'Target Home');
        assert.equal(await page.inputValue('#address'), fixtureBase + '/');
        const frame = await activeFrame(page);
        assert.equal(await frame.textContent('h1'), 'Target Home');
      });
    });
  });

  it('T-06: back / forward / reload / stop-while-loading', async () => {
    covers('T-06', ['FR-URL-05', 'FR-URL-06']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-06', page, async () => {
        await loadFixturePath(page, fixtureBase, '/');
        let frame = await activeFrame(page);
        await frame.click('#self');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);

        assert.equal(await page.getAttribute('#back-btn', 'disabled'), null, 'back should be enabled');
        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.title === 'Target Home' && !t.loading);

        assert.equal(await page.getAttribute('#forward-btn', 'disabled'), null, 'forward should be enabled');
        await page.click('#forward-btn');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);

        // Reload should actually reload (an in-page marker should be lost).
        frame = await activeFrame(page);
        await frame.evaluate(() => { window.__marker = 1; });
        await page.click('#reload-btn');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().loading === false,
          null,
          { timeout: 15000 }
        );
        frame = await activeFrame(page);
        assert.equal(await frame.evaluate(() => window.__marker), undefined);
      });
    });
  });

  it('T-06b: back / forward also work in the launcher-style injected popup window', async () => {
    covers('T-06b', ['FR-URL-05', 'FR-URL-06']);
    await withShellTest({ blockExternalNetwork: true }, async (_page, { context, appBase, fixtureBase }) => {
      const { page } = await openInjectedShell(context, appBase);
      await withFailureArtifacts('T-06b', page, async () => {
        assert.equal(await page.getAttribute('#back-btn', 'disabled'), '', 'nothing to go back to yet');
        await loadFixturePath(page, fixtureBase, '/');
        assert.equal(await page.getAttribute('#back-btn', 'disabled'), null, 'back to the New Tab');
        const frame = await activeFrame(page);
        await frame.click('#self');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);

        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.title === 'Target Home' && !t.loading);
        assert.equal(await page.getAttribute('#forward-btn', 'disabled'), null, 'forward should be enabled');
        await page.click('#forward-btn');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);

        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.title === 'Target Home' && !t.loading);
        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
        assert.equal(await page.getAttribute('#back-btn', 'disabled'), '', 'start of history');
      });
    });
  });

  it('T-06c: following a link back to an earlier page is a new entry, not a back step', async () => {
    covers('T-06c', ['FR-URL-05']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-06c', page, async () => {
        await loadFixturePath(page, fixtureBase, '/');
        await (await activeFrame(page)).click('#self');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);
        await (await activeFrame(page)).click('#back');
        await waitForActiveTab(page, (t) => t.title === 'Target Home' && !t.loading);
        assert.equal(await page.getAttribute('#forward-btn', 'disabled'), '', 'no forward entry after a new navigation');

        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);
      });
    });
  });

  it('T-06d: in-page navigations (pushState, replaceState, hash link) are recorded as history', async () => {
    covers('T-06d', ['FR-URL-05', 'FR-URL-06']);
    await withShellTest({ blockExternalNetwork: true }, async (_page, { context, appBase, fixtureBase }) => {
      const { page } = await openInjectedShell(context, appBase);
      await withFailureArtifacts('T-06d', page, async () => {
        const url = async () => (await page.evaluate(() => window.Yoroxy.shell.tabs.getActive().url)).replace(fixtureBase, '');

        await loadFixturePath(page, fixtureBase, '/spa');
        await (await activeFrame(page)).click('#push');
        await waitForActiveTab(page, (t) => t.url.endsWith('/spa/route2'));
        assert.equal(await page.getAttribute('#back-btn', 'disabled'), null);

        await (await activeFrame(page)).evaluate(() => history.replaceState(null, '', '/spa/replaced'));
        await waitForActiveTab(page, (t) => t.url.endsWith('/spa/replaced'));
        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.url.endsWith('/spa') && !t.loading);
        assert.equal(await url(), '/spa', 'replaceState rewrote the entry instead of adding one');
        await page.click('#forward-btn');
        await waitForActiveTab(page, (t) => t.url.endsWith('/spa/replaced') && !t.loading);

        await loadFixturePath(page, fixtureBase, '/');
        await (await activeFrame(page)).click('#hash');
        await waitForActiveTab(page, (t) => t.url.endsWith('/#sec'));
        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => t.url.endsWith('/') && !t.url.includes('#') && !t.loading);
      });
    });
  });

  it('T-07: "+" opens a new tab, appended and focused', async () => {
    covers('T-07', ['FR-TAB-02']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-07', page, async () => {
        const before = (await tabsInfo(page)).length;
        await page.click('#new-tab-btn');
        const tabs = await tabsInfo(page);
        assert.equal(tabs.length, before + 1);
        assert.ok(tabs[tabs.length - 1].active);
        assert.equal(tabs[tabs.length - 1].kind, 'internal');
        assert.equal(await page.ui.evaluate(() => document.activeElement.id), 'address');
      });
    });
  });

  it('T-63: Stop cancels an in-flight slow load', async () => {
    covers('T-63', ['FR-URL-06']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-63', page, async () => {
        await typeAddress(page, fixtureBase + '/slow?ms=8000');
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().loading === true);
        // Reload button should now read/behave as Stop.
        assert.equal(await page.getAttribute('#reload-btn', 'aria-label'), 'Stop');
        await page.click('#reload-btn');
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().loading === false, null, {
          timeout: 5000,
        });
        assert.equal(await page.getAttribute('#reload-btn', 'aria-label'), 'Reload');
        // The slow page's content must never have arrived.
        const frame = await activeFrame(page);
        const hasWaited = await frame.$('#waited').catch(() => null);
        assert.equal(hasWaited, null);
      });
    });
  });

  it('T-64: Alt+Enter from the address bar opens the result in a new tab', async () => {
    covers('T-64', ['FR-URL-08']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-64', page, async () => {
        const before = (await tabsInfo(page)).length;
        await typeAddress(page, fixtureBase + '/p2', { alt: true });
        await page.waitForFunction((n) => window.Yoroxy.shell.tabs.getTabs().length === n + 1, before);
        const tabs = await tabsInfo(page);
        assert.equal(tabs.length, before + 1);
        assert.ok(tabs[tabs.length - 1].active, 'the new tab should be active');
        assert.equal(tabs[0].kind, 'internal', 'the original tab must be untouched');
      });
    });
  });
});
