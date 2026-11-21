/*
 * window.open() interception: return value, noopener, about:blank,
 * window.close(), postMessage through the returned handle, and the
 * bridge's own input validation (super-long URL, disallowed scheme).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  activeFrame,
  waitForTabCount,
  waitForTabTitle,
  sleep,
  withShellTest,
} from '../support/shell.mjs';

describe('new-window: window.open', () => {
  it('T-22: window.open(url, "_blank", features) opens a tab, ignores features, and returns a usable handle', async () => {
    covers('T-22', ['FR-NEW-07']);
    await withShellTest({ loadPath: '/' }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-22', page, async () => {
        let frame = await activeFrame(page);
        await frame.click('#open'); // width/height in features must be ignored
        await waitForTabCount(page, 2);

        await page.click('.tab:nth-child(1)');
        frame = await activeFrame(page);
        await frame.click('#open-ret');
        await waitForTabCount(page, 3);
        assert.equal(await frame.evaluate(() => window.__ret), 'object');
        assert.equal(await frame.evaluate(() => window.__w.closed), false);

        // the handle's location setter re-enters the proxy
        await frame.evaluate(() => { window.__w.location.href = '/p3'; });
        await waitForTabTitle(page, 'Page 3');
        const tabs = await tabsInfo(page);
        assert.ok(tabs.some((t) => t.url === fixtureBase + '/p3'));

        // and handle.close() closes that tab
        await frame.evaluate(() => { window.__w.close(); });
        await waitForTabCount(page, 2);
        assert.equal(await frame.evaluate(() => window.__w.closed), true);
      });
    });
  });

  it('T-22b: window.open() / window.open("about:blank") returns a handle for a blank tab', async () => {
    covers('T-22', ['FR-NEW-07']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-22b', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#open-blank');
        await waitForTabCount(page, 2);
        assert.equal(await frame.evaluate(() => window.__ret), 'object');
        const tabs = await tabsInfo(page);
        assert.ok(tabs.some((t) => t.kind === 'blank' || t.url === 'about:blank'));
      });
    });
  });

  it('T-32: window.close() closes a script/link-created tab, but is ignored on a user-opened tab', async () => {
    covers('T-32', []);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-32', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#blank'); // link-created tab
        await waitForTabCount(page, 2);
        await waitForTabTitle(page, 'Page 2');
        const scriptFrame = await activeFrame(page);
        // closing itself destroys its own frame mid-call; Playwright's CDP
        // round-trip for evaluate() can surface that as "frame was
        // detached" even though window.close() itself succeeded.
        await scriptFrame.evaluate(() => window.close()).catch(() => {});
        await waitForTabCount(page, 1);

        // No positive DOM signal exists for "the close call was correctly
        // ignored" (the desired outcome is that *nothing* happens): a short
        // fixed wait, then asserting the count never changed, is the
        // straightforward way to check for an absence of an effect.
        const userFrame = await activeFrame(page);
        await userFrame.evaluate(() => window.close()).catch(() => {});
        await sleep(300);
        assert.equal((await tabsInfo(page)).length, 1, 'a user-opened tab must not be closed by script');
      });
    });
  });

  it('T-73: a window.open() handle can postMessage into the tab it opened', async () => {
    covers('T-73', ['BRIDGE-POSTMESSAGE']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-73', page, async () => {
        const opener = await activeFrame(page);
        await opener.click('#open-ret'); // opens /p2 in a new (foreground) tab, __w = handle
        await waitForTabCount(page, 2);
        await waitForTabTitle(page, 'Page 2');

        // Arm the listener inside the *destination* tab (the one the
        // handle points at), then send from the opener via the handle.
        const destFrame = await activeFrame(page);
        await destFrame.evaluate(() => {
          window.addEventListener('message', (ev) => { window.__lastMessage = ev.data; });
        });
        await opener.evaluate(() => window.__w.postMessage({ hello: 'world' }));
        await destFrame.waitForFunction(() => window.__lastMessage && window.__lastMessage.hello === 'world');
      });
    });
  });

  it('T-73b: handle.postMessage is fail-closed - delivered only to a positively identified receiver the opener named or the tab trusts', async () => {
    covers('T-73b', ['BRIDGE-POSTMESSAGE']);
    // Drives the real createBridgeProxy() with a fake tab manager whose iframe
    // location we control, so every branch of the guard is checked
    // deterministically without a proxied site.
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-73b', page, async () => {
        const results = await page.evaluate(() => {
          const Y = window.Yoroxy;
          const site = (u) => Y.url.abs(Y.url.encodeProxy(u));
          const sent = [];
          const listeners = [];
          const A = 'https://a.example/x';
          const makeTab = (href) => {
            const win = {
              location: { href },
              postMessage: (m, o) => sent.push({ m, o }),
            };
            return { id: 'fake', closed: false, kind: 'web', url: A, pending: null, loading: false, name: '', origin: 'script', iframe: { contentWindow: win }, win };
          };
          const setup = (tab) => {
            const tabs = {
              on: (type, fn) => { if (type === 'update') listeners.push(fn); },
              tabForWindow: () => null,
              findByName: () => null,
              createTab: () => tab,
              navigate: () => {},
              reload: () => {},
              activate: () => {},
              close: () => {},
            };
            const bridge = Y.createBridgeProxy({ tabs, activation: () => true });
            return bridge.openTab({ url: A, userActivated: true, source: 'script' }).window;
          };
          const loaded = (tab) => listeners.forEach((fn) => fn(tab)); // 'update' event after a load
          // returns how many messages reached the iframe
          const attempt = (href, { learn = true, mutate, args = [] } = {}) => {
            const tab = makeTab(site(A));
            const handle = setup(tab);
            if (learn) loaded(tab);
            tab.win.location.href = href;
            if (mutate) mutate(tab);
            sent.length = 0;
            handle.postMessage({ n: 1 }, ...args);
            return sent.length;
          };
          const out = {};
          out.requestedOrigin = attempt(site(A));
          out.usesOwnOrigin = sent[0] && sent[0].o === window.location.origin;
          out.requestedOriginNeverLearned = attempt(site(A), { learn: false });
          out.otherOrigin = attempt(site('https://evil.example/'));
          out.otherOriginNeverLearned = attempt(site('https://evil.example/'), { learn: false });
          out.otherOriginWhileLoading = attempt(site('https://evil.example/'), { mutate: (t) => { t.loading = true; t.pending = site('https://evil.example/'); } });
          out.requestedOriginWhileLoading = attempt(site(A), { mutate: (t) => { t.loading = true; t.pending = site('https://evil.example/'); } });
          out.internalPage = attempt(Y.url.abs(Y.url.internalPath({ kind: 'internal', name: 'newtab' })));
          out.unproxiedAppPath = attempt(window.location.origin + '/uv/uv.config.js');
          out.blank = attempt('about:blank');
          out.blankWithSiteTarget = attempt('about:blank', { args: ['https://a.example'] });
          out.locationThrows = attempt(site(A), { mutate: (t) => { Object.defineProperty(t.win, 'location', { get() { throw new Error('cross-origin'); } }); } });
          out.closed = attempt(site(A), { mutate: (t) => { t.closed = true; } });
          out.targetMatches = attempt(site(A), { args: ['https://a.example'] });
          out.targetWildcard = attempt(site(A), { args: ['*'] });
          out.targetOptionsObject = attempt(site(A), { args: [{ targetOrigin: 'https://a.example' }] });
          out.targetMismatch = attempt(site(A), { args: ['https://other.example'] });
          // an explicit targetOrigin that matches is honoured even for an origin the tab was never trusted for
          out.explicitTargetUntrustedOrigin = attempt(site('https://login.example/'), { args: ['https://login.example'] });
          out.explicitTargetUntrustedNeverLearned = attempt(site('https://login.example/'), { learn: false, args: ['https://login.example'] });
          out.explicitTargetObjectUntrusted = attempt(site('https://login.example/'), { args: [{ targetOrigin: 'https://login.example' }] });
          out.explicitTargetWrongPort = attempt(site('https://login.example:8443/'), { args: ['https://login.example'] });
          out.explicitTargetWrongScheme = attempt(site('http://login.example/'), { args: ['https://login.example'] });
          out.explicitTargetOnInternalPage = attempt(Y.url.abs(Y.url.internalPath({ kind: 'internal', name: 'settings' })), { args: [window.location.origin] });
          out.wildcardUntrustedOrigin = attempt(site('https://login.example/'), { args: ['*'] });
          out.omittedTargetUntrustedOrigin = attempt(site('https://login.example/'));
          out.targetSlashWithoutOpener = attempt(site(A), { args: ['/'] });
          {
            // a first-load redirect (a -> b) is learned; the requested origin stays allowed; a third origin is not
            const tab = makeTab(site(A));
            const handle = setup(tab);
            tab.win.location.href = site('https://b.example/landing');
            loaded(tab);
            sent.length = 0; handle.postMessage({ n: 1 }); out.redirectTarget = sent.length;
            tab.win.location.href = site('https://a.example/back');
            sent.length = 0; handle.postMessage({ n: 2 }); out.backToRequested = sent.length;
            tab.win.location.href = site('https://evil.example/');
            sent.length = 0; handle.postMessage({ n: 3 }); out.laterThirdOrigin = sent.length;
            // the opener choosing a new destination itself authorises it
            handle.location.href = 'https://c.example/';
            tab.win.location.href = site('https://c.example/');
            sent.length = 0; handle.postMessage({ n: 4 }); out.openerNavigated = sent.length;
          }
          return out;
        });
        const expected = {
          requestedOrigin: 1,
          usesOwnOrigin: true,
          requestedOriginNeverLearned: 1,
          otherOrigin: 0,
          otherOriginNeverLearned: 0,
          otherOriginWhileLoading: 0,
          requestedOriginWhileLoading: 1, // the document inside the iframe is what receives it
          internalPage: 0,
          unproxiedAppPath: 0,
          blank: 1,
          blankWithSiteTarget: 0,
          locationThrows: 0,
          closed: 0,
          targetMatches: 1,
          targetWildcard: 1,
          targetOptionsObject: 1,
          targetMismatch: 0,
          explicitTargetUntrustedOrigin: 1,
          explicitTargetUntrustedNeverLearned: 1,
          explicitTargetObjectUntrusted: 1,
          explicitTargetWrongPort: 0,
          explicitTargetWrongScheme: 0,
          explicitTargetOnInternalPage: 0,
          wildcardUntrustedOrigin: 0,
          omittedTargetUntrustedOrigin: 0,
          targetSlashWithoutOpener: 0,
          redirectTarget: 1,
          backToRequested: 1,
          laterThirdOrigin: 0,
          openerNavigated: 1,
        };
        assert.deepEqual(results, expected);
      });
    });
  });

  it('T-74: the bridge rejects a URL over the 8192-char limit', async () => {
    covers('T-74', ['BRIDGE-VALIDURL']);
    await withShellTest({ loadPath: '/' }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-74', page, async () => {
        const frame = await activeFrame(page);
        const before = (await tabsInfo(page)).length;
        await frame.evaluate((fixtureBase) => {
          const longUrl = fixtureBase + '/p2?pad=' + 'x'.repeat(9000);
          window.top.__yoroxyShell.openTab({ url: longUrl, active: true, opener: window, source: 'script', userActivated: true });
        }, fixtureBase);
        // Asserting an absence (no tab created) has no positive condition
        // to wait on; a short fixed delay then a direct count check is the
        // straightforward way to verify a rejection had no effect.
        await sleep(300);
        assert.equal((await tabsInfo(page)).length, before, 'an over-long URL must be rejected, no tab created');
      });
    });
  });

  it('T-75: the bridge rejects a javascript: URL passed directly', async () => {
    covers('T-75', ['BRIDGE-VALIDURL']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-75', page, async () => {
        const frame = await activeFrame(page);
        const before = (await tabsInfo(page)).length;
        await frame.evaluate(() => {
          window.top.__yoroxyShell.openTab({ url: 'javascript:alert(1)', active: true, opener: window, source: 'script', userActivated: true });
        });
        // Same reasoning as above: confirming a rejection produced no tab.
        await sleep(300);
        assert.equal((await tabsInfo(page)).length, before);
      });
    });
  });
});
