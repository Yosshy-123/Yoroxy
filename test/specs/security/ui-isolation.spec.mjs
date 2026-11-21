/*
 * SEC-T10 (second half) and the interface channel.
 *
 * The browser interface is a sandboxed iframe with an opaque origin, talking
 * to the container only through ui-channel.js. These tests check that
 *
 *   - the frame is set up as intended (sandbox, origin, no storage, strict CSP,
 *     scripts inline and hashed);
 *   - a proxied page that has reached the container cannot make either end
 *     act on forged messages;
 *   - the genuine interface itself cannot make the container do anything with a
 *     malformed or out-of-range message, while a valid one works (control);
 *   - the validator accepts exactly what the tables describe.
 *
 * Test mode keeps window.Yoroxy in the container, which is how the container's
 * state is read here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ensureServers } from '../../support/ensure-servers.mjs';
import { withFailureArtifacts } from '../../support/failure-artifacts.mjs';
import { covers } from '../../support/traceability.mjs';
import { loadFixturePath, sleep, withShellTest } from '../../support/shell.mjs';

/** What the container currently believes and has applied. */
const containerState = (page) =>
  page.evaluate(() => {
    const tabs = window.Yoroxy.shell.tabs;
    const content = document.getElementById('content');
    return {
      ids: tabs.getTabs().map((t) => t.id),
      active: tabs.getActive() && tabs.getActive().id,
      urls: tabs.getTabs().map((t) => t.url),
      box: [content.style.left, content.style.top, content.style.width, content.style.height],
      clip: document.getElementById('ui').style.clipPath,
    };
  });

/** What the interface currently shows. */
const interfaceState = (page) =>
  page.ui.evaluate(() => ({
    layout: document.documentElement.getAttribute('data-tab-layout'),
    tabs: [...document.querySelectorAll('.tab .tab-title')].map((e) => e.textContent),
    toasts: [...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent),
  }));

describe('security: interface isolation', () => {
  it('SEC-T10: the interface frame is sandboxed with an opaque origin and has nothing to steal', async () => {
    covers('SEC-T10b', ['SECURITY-UI-ISOLATION']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('SEC-T10b', page, async () => {
        const frameElement = await page.evaluate(() => {
          const f = document.getElementById('ui');
          return { sandbox: f.getAttribute('sandbox'), sandboxTokens: [...f.sandbox], srcAttribute: f.getAttribute('src') };
        });
        assert.deepEqual(frameElement.sandboxTokens, ['allow-scripts'], 'allow-scripts and nothing else (in particular not allow-same-origin)');

        const inside = await page.ui.evaluate(() => {
          const result = { origin: window.origin };
          try { result.storage = typeof window.localStorage; } catch (e) { result.storage = e.name; }
          try { result.cookie = document.cookie; } catch (e) { result.cookie = e.name; }
          try { result.parentDocument = typeof window.parent.document.body; } catch (e) { result.parentDocument = e.name; }
          try { result.topChildren = window.top.frames.length; result.topLocation = typeof window.top.location.href; } catch (e) { result.topLocation = e.name; }
          result.scriptTags = [...document.querySelectorAll('script[src]')].length;
          return result;
        });
        assert.equal(inside.origin, 'null', 'opaque origin');
        assert.equal(inside.storage, 'SecurityError', 'no localStorage');
        assert.equal(inside.cookie, 'SecurityError', 'no cookies');
        assert.equal(inside.parentDocument, 'SecurityError', 'cannot read the container');
        assert.equal(inside.topLocation, 'SecurityError', 'cannot read the container location');
        assert.equal(inside.scriptTags, 0, 'its scripts are inline, not fetched');
      });
    });
  });

  it('SEC-T10: shell-ui.html has the strict policy, and every inline script is hashed in it', async () => {
    covers('SEC-T10c', ['SECURITY-UI-ISOLATION']);
    const { appBase } = await ensureServers();
    const res = await fetch(appBase + '/shell-ui.html');
    const csp = res.headers.get('content-security-policy');
    const html = await res.text();
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", 'img-src blob: data:']) {
      assert.ok(csp.includes(directive), directive);
    }
    assert.doesNotMatch(csp, /unsafe-eval|\*/, 'no unsafe-eval, no wildcard');
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
    assert.doesNotMatch(scriptSrc, /unsafe-|'self'/);
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(inline.length >= 8, 'the interface scripts are written into the page');
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i, 'no external script');
    for (const text of inline) {
      const hash = 'sha256-' + crypto.createHash('sha256').update(text, 'utf8').digest('base64');
      assert.ok(scriptSrc.includes(`'${hash}'`), 'an inline script is missing from script-src');
    }
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('SEC-T10: forged messages from a proxied page are ignored by both ends', async () => {
    covers('SEC-T10d', ['SECURITY-UI-ISOLATION']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('SEC-T10d', page, async () => {
        const containerBefore = await containerState(page);
        const interfaceBefore = await interfaceState(page);
        await loadFixturePath(page, fixtureBase, '/ui-attack');
        await page.ui.waitForFunction(() => [...document.querySelectorAll('.tab .tab-title')].some((e) => e.textContent === 'UI Attack Done'));
        await sleep(800); // a message acted on would show within this time

        const containerAfter = await containerState(page);
        assert.deepEqual(containerAfter.ids, containerBefore.ids, 'no tab opened or closed');
        assert.equal(containerAfter.urls.some((u) => u.includes('/p3')), false, 'no forged address submission');
        assert.deepEqual(containerAfter.box, containerBefore.box, 'the pages were not moved by a forged geometry');
        assert.equal(containerAfter.clip, containerBefore.clip, 'the interface clip was not changed');

        const interfaceAfter = await interfaceState(page);
        assert.equal(interfaceAfter.layout, interfaceBefore.layout, 'forged layout ignored');
        assert.ok(!interfaceAfter.tabs.includes('FORGED TAB'), 'forged tab list ignored');
        assert.ok(interfaceAfter.tabs.includes('UI Attack Done'), 'the real state is still what is shown');
        assert.deepEqual(interfaceAfter.toasts, [], 'forged toast ignored');
      });
    });
  });

  it('SEC-T10: malformed or out-of-range messages from the genuine interface do nothing; a valid one works', async () => {
    covers('SEC-T10e', ['SECURITY-UI-ISOLATION']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('SEC-T10e', page, async () => {
        const before = await containerState(page);
        const big = 'a'.repeat(9000);
        const bad = [
          'ui:new', // a string, not an object
          ['ui:new'],
          null,
          42,
          {},
          { type: 7 },
          { type: 'ui:evil' },
          { type: 'constructor' },
          { type: '__proto__' },
          { type: 'toString' },
          { type: 'ui:new', extra: 1 },
          { type: 'ui:close' },
          { type: 'ui:close', id: 'tab-999' },
          { type: 'ui:close', id: 'tab-1; drop' },
          { type: 'ui:close', id: 1 },
          { type: 'ui:activate', id: 'tab-1', extra: true },
          { type: 'ui:move', id: 'tab-1', index: -1 },
          { type: 'ui:move', id: 'tab-1', index: 1e9 },
          { type: 'ui:move', id: 'tab-1', index: 1.5 },
          { type: 'ui:context', id: 'tab-1', action: 'deleteEverything' },
          { type: 'ui:context', id: 'tab-999', action: 'close' },
          { type: 'ui:submit', text: 'https://example.com/', newTab: 'yes' },
          { type: 'ui:submit', text: big, newTab: true },
          { type: 'ui:submit', text: 5, newTab: true },
          { type: 'ui:toastAction', id: 'toast-424242' },
          { type: 'ui:toastAction', id: 'tab-1' },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: NaN, h: 100 }, regions: [] },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: Infinity, h: 100 }, regions: [] },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: 1e9, h: 100 }, regions: [] },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: 100, h: -5 }, regions: [] },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: 100, h: 100 }, regions: Array.from({ length: 100 }, () => ({ x: 0, y: 0, w: 1, h: 1 })) },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: 100, h: 100 }, regions: [{ x: 0, y: 0, w: 1 }] },
          { type: 'ui:geometry', content: { x: 0, y: 0, w: 100, h: 100, z: 1 }, regions: [] },
          'JSON-WITH-PROTO-KEY', // built inside the page: Playwright would drop an own "__proto__" key from an argument
        ];
        await page.ui.evaluate((messages) => {
          const origin = new URL(location.href).origin;
          for (const m of messages) {
            window.parent.postMessage(m === 'JSON-WITH-PROTO-KEY' ? JSON.parse('{"type":"ui:new","__proto__":{"polluted":true}}') : m, origin);
          }
        }, bad);
        await sleep(600);
        assert.deepEqual(await containerState(page), before, 'not one of them had any effect');
        assert.equal(await page.evaluate(() => ({}).polluted), undefined, 'no prototype pollution');

        // control: a valid message is acted on, so the checks above are not just a dead channel
        await page.ui.evaluate(() => window.parent.postMessage({ type: 'ui:new' }, new URL(location.href).origin));
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getTabs().length === 2);
      });
    });
  });

  it('SEC-T10: the validator accepts what the tables describe and nothing more', async () => {
    covers('SEC-T10f', ['SECURITY-UI-ISOLATION']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('SEC-T10f', page, async () => {
        const verdicts = await page.evaluate(() => {
          const Y = window.Yoroxy;
          const U = { validate: Y.validators.validate, FROM_UI: Y.uiMessages.FROM_UI, FROM_CONTAINER: Y.uiMessages.FROM_CONTAINER };
          const ok = (table, m) => U.validate(table, m) !== null;
          const tab = { id: 'tab-1', url: 'https://a/', title: 't', favicon: null, loading: false, canGoBack: false, canGoForward: true, address: 'https://a/' };
          const iconTab = { ...tab, favicon: 'data:image/png;base64,AAAA' };
          const original = { type: 'ui:submit', text: 'x', newTab: false };
          const copy = U.validate(U.FROM_UI, original);
          return {
            validUi: ok(U.FROM_UI, { type: 'ui:activate', id: 'tab-12' }),
            validTabs: ok(U.FROM_CONTAINER, { type: 'ui:tabs', tabs: [tab, iconTab], activeId: 'tab-1' }),
            nullActive: ok(U.FROM_CONTAINER, { type: 'ui:tabs', tabs: [], activeId: null }),
            blobIcon: ok(U.FROM_CONTAINER, { type: 'ui:update', tab: { ...tab, favicon: 'blob:http://x/1' }, activeId: null }),
            scriptIcon: ok(U.FROM_CONTAINER, { type: 'ui:update', tab: { ...tab, favicon: 'javascript:alert(1)' }, activeId: null }),
            tooLongTitle: ok(U.FROM_CONTAINER, { type: 'ui:update', tab: { ...tab, title: 'x'.repeat(513) }, activeId: null }),
            tooManyTabs: ok(U.FROM_CONTAINER, { type: 'ui:tabs', tabs: Array.from({ length: 31 }, () => tab), activeId: null }),
            tabExtraField: ok(U.FROM_CONTAINER, { type: 'ui:update', tab: { ...tab, extra: 1 }, activeId: null }),
            tabMissingField: ok(U.FROM_CONTAINER, { type: 'ui:update', tab: { id: 'tab-1' }, activeId: null }),
            badLayout: ok(U.FROM_CONTAINER, { type: 'ui:layout', layout: 'diagonal' }),
            wrongDirection: ok(U.FROM_CONTAINER, { type: 'ui:new' }),
            wrongDirection2: ok(U.FROM_UI, { type: 'ui:tabs', tabs: [], activeId: null }),
            isCopy: copy !== null && copy !== original && copy.text === 'x',
            nonPlain: ok(U.FROM_UI, Object.assign(Object.create({ inherited: 1 }), { type: 'ui:new' })),
            date: ok(U.FROM_UI, new Date()),
          };
        });
        assert.deepEqual(verdicts, {
          validUi: true, validTabs: true, nullActive: true,
          blobIcon: false, scriptIcon: false, tooLongTitle: false, tooManyTabs: false,
          tabExtraField: false, tabMissingField: false, badLayout: false,
          wrongDirection: false, wrongDirection2: false, isCopy: true, nonPlain: false, date: false,
        });
      });
    });
  });
});
