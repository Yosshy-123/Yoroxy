/*
 * HIST-T1..T9  Back / Forward in a real shell, both when the shell is the real
 *              /container.html and when it is the launcher's about:blank window
 *              (where the browser records no session history for a tab's frame):
 *   T1  quick repeated Back presses go that many entries back
 *   T2  the buttons follow the position (nothing to go back to at the start)
 *   T3  a site's own history.back() / forward() / go(n) move the shell's history
 *   T4  an entry made by pushState is traversed without reloading the page
 *       (where the window allows it); the URL is right either way
 *   T5  location.replace and <meta refresh> redirects are not entries
 *   T6  a duplicated tab starts with its source's history
 *   T7  Back during a slow load, and a new navigation after Back
 * OPEN-T1      the window.open() handle: `w.location = url`, `w.location.href = url`
 *              and reading `w.location.href` work in page scripts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  activeFrame,
  loadFixturePath,
  openInjectedShell,
  sleep,
  tabsInfo,
  typeAddress,
  waitForActiveTab,
  waitForTabCount,
  withShellTest,
} from '../support/shell.mjs';

/* Runs `fn(page, env)` in the real container and in the launcher's injected window. */
const MODES = [
  { name: 'container', open: async (page) => ({ page }) },
  { name: 'injected', open: async (_page, { context, appBase }) => openInjectedShell(context, appBase) },
];

async function inEachMode(testId, fn, opts = {}) {
  for (const mode of MODES) {
    await withShellTest({ blockExternalNetwork: true, ...opts }, async (firstPage, env) => {
      const { page } = await mode.open(firstPage, env);
      await withFailureArtifacts(`${testId}-${mode.name}`, page, () => fn(page, env, mode.name));
    });
  }
}

const state = (page) =>
  page.evaluate(() => {
    const t = window.Yoroxy.shell.tabs.getActive();
    return { url: t.url, back: t.canGoBack, forward: t.canGoForward, loading: t.loading };
  });

const atUrl = (page, url) =>
  page.waitForFunction(
    (u) => {
      const t = window.Yoroxy.shell.tabs.getActive();
      return t.url === u && !t.loading;
    },
    url,
    { timeout: 15000 }
  );

const clickBack = (page) => page.click('#back-btn');
const clickForward = (page) => page.click('#forward-btn');

async function goTo(page, fixtureBase, path) {
  await loadFixturePath(page, fixtureBase, path);
  await atUrl(page, fixtureBase + path);
}

describe('tab history in a real shell', () => {
  it('HIST-T1/T2: quick repeated Back / Forward, and the buttons follow the position', async () => {
    covers('HIST-T1', ['TAB-HISTORY']);
    covers('HIST-T2', ['TAB-HISTORY']);
    await inEachMode('HIST-T1', async (page, { fixtureBase }) => {
      assert.equal(await page.getAttribute('#back-btn', 'disabled'), '', 'nothing to go back to at first');
      for (const p of ['/p2', '/p3', '/search?q=x']) await goTo(page, fixtureBase, p);

      // two presses, one right after the other, before the first load settled
      await page.ui.evaluate(() => { document.getElementById('back-btn').click(); document.getElementById('back-btn').click(); });
      await atUrl(page, fixtureBase + '/p2');
      assert.deepEqual(await state(page), { url: fixtureBase + '/p2', back: true, forward: true, loading: false });

      await clickBack(page); // the New Tab page
      await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
      assert.equal(await page.getAttribute('#back-btn', 'disabled'), '', 'Back is off at the first entry');
      assert.equal(await page.getAttribute('#forward-btn', 'disabled'), null);

      await page.ui.evaluate(() => { document.getElementById('forward-btn').click(); document.getElementById('forward-btn').click(); document.getElementById('forward-btn').click(); });
      await atUrl(page, fixtureBase + '/search?q=x');
      assert.equal(await page.getAttribute('#forward-btn', 'disabled'), '', 'Forward is off at the last entry');

      // going back and then somewhere new drops what was ahead
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p3');
      await goTo(page, fixtureBase, '/p2');
      assert.equal(await page.getAttribute('#forward-btn', 'disabled'), '');
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p3');
    });
  });

  it("HIST-T3: a site's own history.back() / forward() / go(n) move the shell's history", async () => {
    covers('HIST-T3', ['TAB-HISTORY']);
    await inEachMode('HIST-T3', async (page, { fixtureBase }) => {
      await goTo(page, fixtureBase, '/p2');
      await goTo(page, fixtureBase, '/p3');
      await goTo(page, fixtureBase, '/back-button');

      let frame = await activeFrame(page);
      await frame.click('#back');
      await atUrl(page, fixtureBase + '/p3');
      assert.deepEqual([(await state(page)).back, (await state(page)).forward], [true, true]);
      // the shell's own Back now goes one further back (the page's move was not a new entry)
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p2');
      await clickForward(page);
      await atUrl(page, fixtureBase + '/p3');
      await clickForward(page);
      await atUrl(page, fixtureBase + '/back-button');

      frame = await activeFrame(page);
      await frame.click('#go2');
      await atUrl(page, fixtureBase + '/p2');
      await clickForward(page);
      await atUrl(page, fixtureBase + '/p3');
    });
  });

  it('HIST-T4: an entry made by pushState is stepped to without losing the page, where the window allows', async () => {
    covers('HIST-T4', ['TAB-HISTORY']);
    await inEachMode('HIST-T4', async (page, { fixtureBase }, mode) => {
      await goTo(page, fixtureBase, '/spa-multi');
      let frame = await activeFrame(page);
      await frame.evaluate(() => { window.__kept = 'same document'; });
      await frame.click('#one');
      await atUrl(page, fixtureBase + '/spa-multi/one');
      await frame.click('#two');
      await atUrl(page, fixtureBase + '/spa-multi/two');

      await clickBack(page);
      await atUrl(page, fixtureBase + '/spa-multi/one');
      await clickBack(page);
      await atUrl(page, fixtureBase + '/spa-multi');
      assert.equal((await state(page)).forward, true);
      if (mode === 'container') {
        // the same document all the way: nothing was reloaded
        frame = await activeFrame(page);
        assert.equal(await frame.evaluate(() => window.__kept), 'same document');
      }
      await clickForward(page);
      await atUrl(page, fixtureBase + '/spa-multi/one');
    });
  });

  it('HIST-T5: location.replace and <meta refresh> redirects are not history entries', async () => {
    covers('HIST-T5', ['TAB-HISTORY']);
    await inEachMode('HIST-T5', async (page, { fixtureBase }) => {
      await goTo(page, fixtureBase, '/p2');
      await typeAddress(page, fixtureBase + '/js-redirect');
      await atUrl(page, fixtureBase + '/p3');
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p2'); // not /js-redirect

      await typeAddress(page, fixtureBase + '/meta-refresh');
      await atUrl(page, fixtureBase + '/p3'); // the meta refresh is followed at all
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p2');
    });
  });

  it('HIST-T6: a duplicated tab starts with its source history', async () => {
    covers('HIST-T6', ['TAB-HISTORY']);
    await inEachMode('HIST-T6', async (page, { fixtureBase }) => {
      await goTo(page, fixtureBase, '/p2');
      await goTo(page, fixtureBase, '/p3');
      await page.evaluate(() => window.Yoroxy.shell.tabs.duplicate(window.Yoroxy.shell.tabs.getActive().id));
      await waitForTabCount(page, 2);
      await atUrl(page, fixtureBase + '/p3');
      assert.equal((await state(page)).back, true);
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p2');
      // the original tab is untouched
      await page.evaluate(() => window.Yoroxy.shell.tabs.activate(window.Yoroxy.shell.tabs.getTabs()[0].id));
      assert.equal((await state(page)).url, fixtureBase + '/p3');
    });
  });

  it('HIST-T7: Back while a slow page loads, and a new navigation right after Back', async () => {
    covers('HIST-T7', ['TAB-HISTORY']);
    await inEachMode('HIST-T7', async (page, { fixtureBase }) => {
      await goTo(page, fixtureBase, '/p2');
      await goTo(page, fixtureBase, '/p3');
      await typeAddress(page, fixtureBase + '/slow?ms=4000');
      await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().loading);
      await clickBack(page);
      await atUrl(page, fixtureBase + '/p2');
      await sleep(4500); // the slow answer must not bring its page back
      assert.equal((await state(page)).url, fixtureBase + '/p2');
      assert.equal((await state(page)).forward, true);

      // Back to the New Tab page (instant), then somewhere new: what was ahead is gone
      await clickBack(page);
      await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
      await goTo(page, fixtureBase, '/p3');
      assert.equal((await state(page)).forward, false);
      await clickBack(page);
      await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
      assert.equal((await state(page)).back, false, '/p2 was dropped with the entries that were ahead');
      assert.equal((await tabsInfo(page)).length, 1);
    });
  });
});

describe('the window.open() handle', () => {
  it('OPEN-T1: w.location.href = url, w.location = url and reading w.location.href work in page scripts', async () => {
    covers('OPEN-T1', ['NEWWINDOW-HANDLE-LOCATION']);
    await withShellTest({ loadPath: '/open-handle' }, async (page, { fixtureBase, logs }) => {
      await withFailureArtifacts('OPEN-T1', page, async () => {
        let frame = await activeFrame(page);
        await frame.click('#b1'); // window.open(''); w.location.href = '/p3'
        await waitForTabCount(page, 2);
        await waitForActiveTab(page, (t) => t.url.endsWith('/p3') && !t.loading);

        await page.evaluate(() => window.Yoroxy.shell.tabs.activate(window.Yoroxy.shell.tabs.getTabs()[0].id));
        frame = await activeFrame(page);
        await frame.click('#b2'); // window.open('/p2'); w.location = '/p3'
        await waitForTabCount(page, 3);
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getTabs()[2].url.endsWith('/p3'));

        await page.evaluate(() => window.Yoroxy.shell.tabs.activate(window.Yoroxy.shell.tabs.getTabs()[0].id));
        frame = await activeFrame(page);
        await frame.click('#b3'); // reads w.location.href
        await waitForTabCount(page, 4);
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getTabs()[0].title.startsWith('href '));
        assert.deepEqual(logs.filter((l) => l.startsWith('pageerror')), []);
        assert.ok(fixtureBase);
      });
    });
  });
});
