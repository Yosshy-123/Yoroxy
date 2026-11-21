/*
 * L-01..L-04: the real entry flow. Visiting `/` must open the shell in a new
 * tab and send the original tab away; if the pop-up is blocked, a
 * non-blocking in-page notice (not alert()) takes over.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServers } from '../support/ensure-servers.mjs';
import { launchBrowser } from '../support/browser.mjs';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { wrapShellPage } from '../support/shell.mjs';

const CLOAK_URL = 'https://www.google.com';

/*
 * The cloak target is an external site. These tests never touch the network:
 * the browser is launched with every non-loopback host unresolvable
 * (blockExternalNetwork), and the redirect is observed as a request via
 * page.on('request') / waitForRequest. Do not use context.route() here: with a
 * route registered the pop-up's scripts stall and the shell never boots.
 */
const BROWSER_OPTIONS = { blockExternalNetwork: true };

async function waitForShell(page) {
  await page.waitForFunction(
    () => window.Yoroxy && window.Yoroxy.shell && window.Yoroxy.shell.tabs.getTabs().length >= 1
  );
}

describe('launcher (index.html)', () => {
  it('L-01/L-02: opens the shell in a new tab and redirects the original tab', async () => {
    covers('L-01', ['LAUNCHER-OPEN']);
    covers('L-02', ['LAUNCHER-CLOAK']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser(BROWSER_OPTIONS);
    try {
      const context = await browser.newContext();
      const original = await context.newPage();
      await withFailureArtifacts('L-01', original, async () => {
        const popupPromise = context.waitForEvent('page');
        const cloakRequest = original.waitForRequest((req) => req.url().startsWith(CLOAK_URL), { timeout: 30000 });
        await original.goto(appBase + '/');
        const shell = wrapShellPage(await popupPromise);
        await waitForShell(shell);
        await shell.waitForSelector('#toolbar'); // in the interface frame
        assert.equal(await shell.isVisible('#toolbar'), true, 'shell UI must be rendered');

        const request = await cloakRequest;
        assert.ok(request.isNavigationRequest(), 'the cloak must be a navigation of the original tab');
        assert.equal(context.pages().length, 2);
      });
    } finally {
      await browser.close();
    }
  });

  it('L-03: a blocked pop-up shows an in-page notice and a retry button, never alert()', async () => {
    covers('L-03', ['LAUNCHER-POPUP-BLOCKED']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser(BROWSER_OPTIONS);
    try {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        window.open = () => null; // simulate a pop-up blocker
      });
      const page = await context.newPage();
      let dialogSeen = false;
      page.on('dialog', async (d) => {
        dialogSeen = true;
        await d.dismiss();
      });
      await withFailureArtifacts('L-03', page, async () => {
        await page.goto(appBase + '/');
        await page.waitForSelector('#goButton', { state: 'visible' });
        assert.match(await page.textContent('#message'), /blocked/i);

        await page.click('#goButton');
        await page.waitForSelector('#popup-blocked-notice:not([hidden])');
        assert.match(await page.textContent('#popup-blocked-notice'), /still blocked/i);
        assert.equal(dialogSeen, false, 'alert() must not be used');
        assert.ok(page.url().startsWith(appBase), 'original tab must not be redirected when nothing opened');

        // There is no way to open /container.html by hand (it does not work outside an
        // about:blank window the launcher opened), so no link to it is offered...
        assert.equal(await page.locator('a').count(), 0, 'no link anywhere on the page');
        assert.doesNotMatch(await page.textContent('body'), /container\.html|manually/i);
        // ...and the button keeps working: it can be pressed again after allowing pop-ups.
        assert.equal(await page.isEnabled('#goButton'), true);
        await page.evaluate(() => { window.__tries = 0; window.open = () => { window.__tries++; return null; }; });
        await page.click('#goButton');
        await page.waitForFunction(() => window.__tries === 1);
        assert.equal(await page.locator('a').count(), 0);
      });
    } finally {
      await browser.close();
    }
  });

  it('L-05: a failed load offers a retry, not a link to /container.html', async () => {
    covers('L-05', ['LAUNCHER-NO-MANUAL-LINK']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser(BROWSER_OPTIONS);
    try {
      const context = await browser.newContext();
      let failures = 1; // the first fetch of the shell page fails, the retry succeeds
      await context.route('**/container.html', (route) => {
        if (failures-- > 0) return route.abort();
        return route.continue();
      });
      const original = await context.newPage();
      await withFailureArtifacts('L-05', original, async () => {
        await original.goto(appBase + '/');
        await original.waitForSelector('#goButton', { state: 'visible' });
        assert.match(await original.textContent('#message'), /Failed to load/i);
        assert.equal(await original.locator('a').count(), 0, 'no link to /container.html');
        assert.doesNotMatch(await original.textContent('body'), /container\.html|manually/i);

        const popupPromise = context.waitForEvent('page', { timeout: 30000 });
        await original.click('#goButton'); // the retry fetches again and opens the shell
        await popupPromise;
      });
    } finally {
      await browser.close();
    }
  });

  it('L-04: the proxy service worker is registered by the launcher flow', async () => {
    covers('L-04', ['LAUNCHER-SW']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser(BROWSER_OPTIONS);
    try {
      const context = await browser.newContext();
      const original = await context.newPage();
      await withFailureArtifacts('L-04', original, async () => {
        const popupPromise = context.waitForEvent('page');
        await original.goto(appBase + '/');
        const shell = wrapShellPage(await popupPromise);
        await waitForShell(shell);
        const deadline = Date.now() + 10000;
        let found = false;
        while (Date.now() < deadline && !found) {
          found = context.serviceWorkers().some((w) => w.url() === appBase + '/uv/sw.js');
          if (!found) await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(found, 'expected /uv/sw.js to be registered');
      });
    } finally {
      await browser.close();
    }
  });
});
