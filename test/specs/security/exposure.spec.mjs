/*
 * SEC-T3 / SEC-T4 / SEC-T11: what the app exposes to proxied pages and to
 * the messages that internal pages send.
 *
 * These run against an app server WITHOUT test hooks (support/prod-app.mjs),
 * i.e. the way production serves the pages: window.Yoroxy is gone once a page
 * has started. Everything is therefore driven through the DOM.
 *
 * SEC-T3   no namespace, and a bridge with exactly the five functions the
 *          Ultraviolet handler needs, that cannot be replaced
 * SEC-T4   the object window.open() returns holds nothing of the shell
 * SEC-T11  internal page -> shell messages: valid ones work, forged or
 *          malformed ones are dropped and never navigate anything
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServers } from '../../support/ensure-servers.mjs';
import { startProdApp } from '../../support/prod-app.mjs';
import { launchBrowserStrictCsp } from '../../support/browser.mjs';
import { withFailureArtifacts } from '../../support/failure-artifacts.mjs';
import { covers } from '../../support/traceability.mjs';
import { openShell, sleep } from '../../support/shell.mjs';

let app;
let fixtureBase;

before(async () => {
  app = await startProdApp();
  ({ fixtureBase } = await ensureServers());
});
after(async () => {
  await app.close();
});

/** Fresh strict-CSP browser with the shell open on the production-style app. */
async function withProdShell(fn) {
  const browser = await launchBrowserStrictCsp();
  try {
    const context = await browser.newContext();
    const { page, logs } = await openShell(context, app.base, '/container.html', { viaDom: true });
    return await fn(page, { context, logs });
  } finally {
    await browser.close();
  }
}

const activeTitle = (page) => page.locator('.tab.is-active .tab-title').textContent();
const tabCount = (page) => page.locator('#tablist .tab').count();
const tabSnapshot = (page) => page.ui.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.title));

async function go(page, url, doneTitle) {
  await page.click('#address');
  await page.fill('#address', url);
  await page.press('#address', 'Enter');
  await page.waitForSelector(`.tab.is-active .tab-title:text-is("${doneTitle}")`, { timeout: 15000 });
}

/** The frame of the active tab. */
async function activeFrame(page) {
  const handle = await page.mainFrame().waitForSelector('.tab-frame.is-active');
  return handle.contentFrame();
}

describe('security: what is exposed', () => {
  it('SEC-T3: no Yoroxy namespace; the bridge has exactly five functions and cannot be replaced', async () => {
    covers('SEC-T3', ['SECURITY-EXPOSURE']);
    await withProdShell(async (page, { logs }) => {
      await withFailureArtifacts('SEC-T3', page, async () => {
        assert.equal(await page.evaluate(() => typeof window.Yoroxy), 'undefined', 'shell document');
        const newtab = await activeFrame(page);
        await newtab.waitForSelector('#search-input');
        assert.equal(await newtab.evaluate(() => typeof window.Yoroxy), 'undefined', 'internal page');

        await go(page, fixtureBase + '/exposure-probe', 'Exposure Probe Done');
        const frame = await activeFrame(page);
        const seen = JSON.parse(await frame.textContent('#result'));
        const allowed = ['closeTabOf', 'openTab', 'prepareFormTarget', 'replaceNext', 'traverse'];
        assert.equal(seen.namespace, 'undefined');
        assert.deepEqual([...seen.keys].sort(), allowed);
        assert.deepEqual(seen.names, allowed, 'no hidden members such as version or submit');
        assert.equal(seen.replaced, false, 'the bridge must not be replaceable');
        assert.equal(seen.frozen, true);
        assert.deepEqual(logs.filter((l) => l.startsWith('pageerror')), [], 'starting without the namespace must not break any page');
      });
    });
  });

  it('SEC-T4: the window.open() handle contains nothing of the shell', async () => {
    covers('SEC-T4', ['SECURITY-EXPOSURE']);
    await withProdShell(async (page) => {
      await withFailureArtifacts('SEC-T4', page, async () => {
        await go(page, fixtureBase + '/', 'Target Home');
        const frame = await activeFrame(page);
        await frame.click('#open-ret'); // real click: window.open(), the handle is kept in window.__w
        await page.ui.waitForFunction(() => document.querySelectorAll('.tab').length === 2).catch(() => {});
        const report = await frame.evaluate(() => {
          const w = window.__w;
          // A DOM node, a window or a document found anywhere reachable from the handle.
          const isHostObject = (v) =>
            !!v && typeof v === 'object' && (typeof v.nodeType === 'number' || (v.document !== undefined && typeof v.setTimeout === 'function'));
          const found = [];
          const seen = new Set();
          const walk = (value, path, depth) => {
            if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value) || depth > 4) return;
            seen.add(value);
            if (isHostObject(value)) found.push(path);
            let names = [];
            try { names = Object.getOwnPropertyNames(value); } catch (e) { return; }
            for (const name of names) {
              let child;
              try { child = value[name]; } catch (e) { continue; }
              walk(child, path + '.' + name, depth + 1);
            }
          };
          walk(w, 'w', 0);
          return { type: typeof w, document: typeof w.document, found, names: Object.getOwnPropertyNames(w).sort() };
        });
        assert.equal(report.type, 'object', 'the handle itself exists');
        assert.equal(report.document, 'undefined', 'no document on the handle');
        assert.deepEqual(report.found, [], 'nothing reachable from the handle may be a window, document or element');
        assert.ok(!report.names.includes('document') && !report.names.includes('contentDocument'));
      });
    });
  });
});

describe('security: pop-up gate', () => {
  it('SEC-T4: a page claiming userActivated:true without a real user gesture is blocked', async () => {
    covers('SEC-T4b', ['SECURITY-EXPOSURE']);
    await withProdShell(async (page) => {
      await withFailureArtifacts('SEC-T4b', page, async () => {
        await go(page, fixtureBase + '/', 'Target Home');
        const frame = await activeFrame(page);
        const before = await tabCount(page);
        // Playwright's evaluate() runs with a user gesture of its own, so the attempt is made from a page
        // timer, after the activation left by typing the address (and by evaluate itself) has expired.
        await frame.evaluate(() => {
          setTimeout(() => {
            const top = window.top;
            const bridge = top['__yoroxyShell'];
            const result = bridge.openTab({ url: location.origin + '/x', opener: window, source: 'script', userActivated: true });
            window.__gate = { shellActive: top.navigator.userActivation.isActive, blocked: result.blocked, window: result.window };
          }, 6500);
        });
        await sleep(7500);
        const gate = await frame.evaluate(() => window.__gate);
        assert.ok(gate, 'the attempt ran');
        assert.equal(gate.shellActive, false, 'precondition: the shell has no user activation at that moment');
        assert.equal(gate.blocked, true, 'the shell asks the browser, not the page');
        assert.equal(gate.window, null);
        await sleep(300);
        assert.equal(await tabCount(page), before, 'no tab was opened');
      });
    });
  });
});

describe('security: messages from internal pages (SEC-T11)', () => {
  /* Every forged submit points at `target`, so a message that slipped through would show up as a tab on /p3. */
  const forged = (target) => [
    { label: 'unknown type', data: { type: 'yoroxy:evil', text: target } },
    { label: 'no type', data: { text: target } },
    { label: 'a string, not an object', data: 'yoroxy:submit' },
    { label: 'extra field', data: { type: 'yoroxy:submit', text: target, extra: 1 } },
    { label: 'text is not a string', data: { type: 'yoroxy:submit', text: 42 } },
    { label: 'missing text', data: { type: 'yoroxy:submit' } },
    { label: 'text over the limit', data: { type: 'yoroxy:submit', text: target + '?' + 'a'.repeat(9000) } },
    { label: 'extra field on newTab', data: { type: 'yoroxy:newTab', window: 1 } },
  ];

  it('SEC-T11: New Tab search and Error "New tab" work (control)', async () => {
    covers('SEC-T11a', ['SECURITY-INTERNAL-MESSAGES']);
    await withProdShell(async (page) => {
      await withFailureArtifacts('SEC-T11a', page, async () => {
        const newtab = await activeFrame(page);
        await newtab.fill('#search-input', fixtureBase + '/p2');
        await newtab.press('#search-input', 'Enter');
        await page.waitForSelector('.tab.is-active .tab-title:text-is("Page 2")', { timeout: 15000 });
        assert.equal(await tabCount(page), 1, 'the search navigated the sending tab');

        await go(page, 'yoroxy://nope', 'Error');
        const errorFrame = await activeFrame(page);
        await errorFrame.click('#new-tab');
        await page.ui.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
        assert.equal(await activeTitle(page), 'New Tab');
      });
    });
  });

  it('SEC-T11: a proxied page cannot forge them', async () => {
    covers('SEC-T11b', ['SECURITY-INTERNAL-MESSAGES']);
    await withProdShell(async (page) => {
      await withFailureArtifacts('SEC-T11b', page, async () => {
        await page.click('#new-tab-btn'); // a second tab: the probe runs in it, the first (New Tab) is a bystander
        await page.ui.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
        await go(page, fixtureBase + '/msg-probe', 'Msg Probe Done');
        await sleep(800); // a delivered message would act within this time
        const tabs = await tabSnapshot(page);
        assert.equal(tabs.length, 2, 'no tab was opened by the forged newTab messages');
        assert.equal(tabs.some((t) => t.includes('/p3')), false, 'nothing navigated to the forged submit target');
        assert.equal(await activeTitle(page), 'Msg Probe Done', 'the probe tab was not navigated away');
        assert.ok(tabs[0].startsWith('New Tab'), 'the bystander tab was not navigated');
      });
    });
  });

  it('SEC-T11: messages from about:blank, from nested frames of an internal page, and malformed ones are dropped', async () => {
    covers('SEC-T11c', ['SECURITY-INTERNAL-MESSAGES']);
    await withProdShell(async (page) => {
      await withFailureArtifacts('SEC-T11c', page, async () => {
        const target = fixtureBase + '/p3';
        const valid = { type: 'yoroxy:submit', text: target };

        // a tab showing about:blank
        await page.click('#address');
        await page.fill('#address', 'about:blank');
        await page.press('#address', 'Enter');
        await page.waitForSelector('.tab.is-active .tab-title:text-is("Untitled")');
        const blank = await activeFrame(page);
        await blank.evaluate(({ m, origin }) => window.parent.postMessage(m, origin), { m: valid, origin: app.base });

        // a tab showing New Tab: malformed messages from the real page, and a valid one from a nested frame
        await page.click('#new-tab-btn');
        await page.waitForSelector('.tab.is-active .tab-title:text-is("New Tab")');
        const newtab = await activeFrame(page);
        await newtab.waitForSelector('#search-input');
        await newtab.evaluate((forged) => forged.forEach((m) => window.parent.postMessage(m, location.origin)), forged(target).map((f) => f.data));
        // The nested frame's own code must send it (a call made by the parent's code would count as the parent).
        await newtab.evaluate(() => document.body.appendChild(document.createElement('iframe')));
        const nested = newtab.childFrames()[0];
        await nested.evaluate(({ m, origin }) => window.parent.parent.postMessage(m, origin), { m: valid, origin: app.base });
        // a valid message from the wrong internal page (newtab may not ask for a new tab)
        await newtab.evaluate(() => window.parent.postMessage({ type: 'yoroxy:newTab' }, location.origin));

        await sleep(800);
        const tabs = await tabSnapshot(page);
        assert.equal(tabs.length, 2, 'no tab was opened');
        assert.equal(tabs.some((t) => t.includes('/p3')), false, 'no tab navigated to the target');
        assert.equal(await activeTitle(page), 'New Tab');
      });
    });
  });
});
