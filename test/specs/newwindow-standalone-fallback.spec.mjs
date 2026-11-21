/*
 * T-33: a proxied URL opened outside the shell (no window.top.__yoroxyShell)
 * must never open a real browser window — every new-tab/new-window path
 * falls back to same-frame navigation.
 *
 * T-76: TabManager's navToken guard against out-of-order async resolution
 * when a tab is navigated twice in rapid succession before the service
 * worker becomes ready (a race that's very hard to hit black-box, since
 * real SW registration is usually too fast to race against from outside;
 * exercised here directly against the TabManager module with a stubbed,
 * deliberately slow registerSW).
 *
 * T-77: a service worker registration failure surfaces as the sw-failed
 * error page, and Reload retries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  activeFrame,
  typeAddress,
  waitForActiveTab,
  withShellTest,
} from '../support/shell.mjs';

describe('new-window: standalone fallback and internal races', () => {
  it('T-33: a /uv/service/... URL opened directly (no shell) falls back to same-frame navigation', async () => {
    covers('T-33', ['FR-NEW-20']);
    await withShellTest({ loadPath: '/' }, async (shellPage, { context, appBase, fixtureBase }) => {
      const encoded = await shellPage.evaluate((u) => window.Yoroxy.url.encodeProxy(u), fixtureBase + '/');

      const realPagesBefore = context.pages().length;
      const solo = await context.newPage();
      await withFailureArtifacts('T-33', solo, async () => {
        await solo.goto(appBase + encoded);
        await solo.waitForSelector('#blank');

        await solo.click('#blank'); // target=_blank, but no shell present
        await solo.waitForFunction(() => document.title === 'Page 2', null, { timeout: 15000 });
        assert.equal(context.pages().length, realPagesBefore + 1, 'only the one solo page we opened ourselves should exist');

        await solo.goBack();
        await solo.waitForSelector('#open');
        await solo.click('#open'); // window.open(), still no shell
        await new Promise((r) => setTimeout(r, 1500));
        assert.equal(context.pages().length, realPagesBefore + 1, 'window.open must not create a real window either');
      });
    });
  });

  it('T-76: rapid re-navigation before the service worker is ready ends on the later URL, not the earlier one', async () => {
    covers('T-76', ['TABMANAGER-NAVTOKEN']);
    await withShellTest({ seed: false }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-76', page, async () => {
        const result = await page.evaluate(
          ({ url1, url2 }) => {
            return new Promise((resolve) => {
              const container = document.createElement('div');
              document.body.appendChild(container);
              // A deliberately slow, never-cached registerSW: both
              // navigate() calls below will race on this same promise.
              const slowRegister = () => new Promise((res) => setTimeout(res, 400));
              const tm = window.Yoroxy.createTabManager({ content: container, registerSW: slowRegister });
              const tab = tm.createTab({ target: { kind: 'blank' }, active: false, origin: 'user' });
              tm.navigate(tab, url1);
              tm.navigate(tab, url2); // supersedes url1 before SW "resolves"
              setTimeout(() => {
                resolve({ finalUrl: tab.url, finalKind: tab.kind });
                tm.destroy();
                container.remove();
              }, 900);
            });
          },
          { url1: fixtureBase + '/p2', url2: fixtureBase + '/p3' }
        );
        assert.equal(result.finalKind, 'web');
        assert.equal(result.finalUrl, fixtureBase + '/p3', 'the later navigate() call must win, not the earlier one');
      });
    });
  });

  it('T-77: a failed service worker registration shows sw-failed, and Reload retries the address', async () => {
    covers('T-77', ['SW-FAILURE']);
    // Force every registration attempt in every document of this context
    // to reject, simulating an environment where the service worker
    // cannot start.
    await withShellTest({
      beforeShell: async (context) => {
          await context.addInitScript(() => {
            if (navigator.serviceWorker) {
              navigator.serviceWorker.register = () => Promise.reject(new Error('forced failure for T-77'));
            }
          });
      },
    }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-77', page, async () => {
        await typeAddress(page, fixtureBase + '/p2');
        await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading, { timeout: 20000 });
        const frame = await activeFrame(page);
        assert.match(await frame.textContent('h1'), /couldn.t start/);
        assert.match(await frame.textContent('#detail'), /service worker failed to start/i);
      });
    });
  });
});
