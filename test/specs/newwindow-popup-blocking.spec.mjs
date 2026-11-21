/*
 * Pop-up blocking for script-initiated window.open() calls that lack real
 * user activation: T-23 (blocked + toast + "Open" recovers it) and T-24
 * (a tight loop of 50 window.open() calls from one click yields one tab).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  activeFrame,
  waitForTabCount,
  sleep,
  withShellTest,
} from '../support/shell.mjs';

describe('new-window: pop-up blocking', () => {
  it('T-23: a script-initiated open with no user activation is blocked, with a recoverable toast', async () => {
    covers('T-23', ['FR-NEW-21', 'FR-NEW-22']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-23', page, async () => {
        const frame = await activeFrame(page);
        // Stub navigator.userActivation.isActive to false for exactly this
        // one call, then restore it: in a headless harness, activation from
        // the Enter keypress that navigated the tab can otherwise still
        // read as "active" here, unlike a real idle browsing session.
        await frame.evaluate(() => {
          const proto = Object.getPrototypeOf(navigator.userActivation);
          const original = Object.getOwnPropertyDescriptor(proto, 'isActive');
          Object.defineProperty(proto, 'isActive', { get: () => false, configurable: true });
          window.__r = window.open('/p2');
          Object.defineProperty(proto, 'isActive', original);
        });
        // Confirming a block (no tab, __r === null) has no positive DOM
        // condition to wait on - a short fixed delay then a direct check
        // is the straightforward way to verify the rejection took effect.
        await sleep(400);
        assert.equal((await tabsInfo(page)).length, 1);
        assert.equal(await frame.evaluate(() => window.__r), null);

        const toastText = await page.textContent('#toasts');
        assert.match(toastText, /Pop-up blocked: 127\.0\.0\.1 tried to open a new tab\./);
        assert.match(toastText, /Open/);

        await page.click('.toast-action');
        await waitForTabCount(page, 2);
      });
    });
  });

  it('T-24: 50 window.open() calls from a single click still only open one tab', async () => {
    covers('T-24', ['FR-NEW-21']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('T-24', page, async () => {
        const frame = await activeFrame(page);
        await frame.click('#spawn'); // onclick loops window.open() 50 times
        // Proving "at most one tab" needs to wait out the whole 50-call
        // loop and its rejections; there's no single positive signal for
        // "the loop is done and nothing more will happen".
        await sleep(800);
        assert.equal((await tabsInfo(page)).length, 2, 'one real click => at most one tab, regardless of loop size');
      });
    });
  });
});
