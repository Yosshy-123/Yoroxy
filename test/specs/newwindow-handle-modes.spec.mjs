/*
 * R-INT-01: the window.open() handle's postMessage reaches the tab it opened
 * in BOTH ways the shell runs:
 *
 *   container  a real /container.html document;
 *   injected   the launcher's about:blank window with container.html written
 *              into it - how the shell runs in production. There
 *              location.origin is "null", so a targetOrigin taken from it
 *              makes every postMessage throw (and be dropped).
 *
 * T-73 (newwindow-window-open.spec.mjs) covers the first mode only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  activeFrame,
  loadFixturePath,
  openInjectedShell,
  waitForTabCount,
  waitForTabTitle,
  withShellTest,
} from '../support/shell.mjs';

const MODES = [
  { name: 'container', open: async (page) => ({ page }) },
  { name: 'injected', open: async (_page, { context, appBase }) => openInjectedShell(context, appBase) },
];

describe('new-window: window.open handle in both shell modes', () => {
  it('R-INT-01: handle.postMessage reaches the opened tab in the container and in the injected window', async () => {
    covers('R-INT-01', ['REFACTOR-HANDLE-ORIGIN']);
    for (const mode of MODES) {
      await withShellTest({ blockExternalNetwork: true }, async (firstPage, env) => {
        const { page } = await mode.open(firstPage, env);
        await withFailureArtifacts(`R-INT-01-${mode.name}`, page, async () => {
          await loadFixturePath(page, env.fixtureBase, '/');
          const opener = await activeFrame(page);
          await opener.click('#open-ret'); // opens /p2 in a new tab; window.__w is the handle
          await waitForTabCount(page, 2);
          await waitForTabTitle(page, 'Page 2');

          const destination = await activeFrame(page);
          await destination.evaluate(() => {
            window.addEventListener('message', (ev) => { window.__lastMessage = ev.data; });
          });
          await opener.evaluate((name) => window.__w.postMessage({ hello: name }, '*'), mode.name);
          await destination.waitForFunction(() => window.__lastMessage && window.__lastMessage.hello);
          const received = await destination.evaluate(() => window.__lastMessage);
          assert.deepEqual(received, { hello: mode.name }, `${mode.name}: the message arrived intact`);
        });
      });
    }
  });
});
