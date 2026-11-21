/*
 * FR-EN-05: no Japanese characters anywhere in the visible UI, including
 * text that only appears after some interaction (toasts, dialogs, error
 * pages, validation messages) — not just the static markup checked by a
 * one-time source scan.
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

const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;

function assertNoJapanese(text, where) {
  assert.doesNotMatch(text || '', JAPANESE_RE, `unexpected Japanese text in ${where}: ${JSON.stringify(text)}`);
}

describe('i18n: English-only UI', () => {
  it('T-34: static pages (New Tab, Settings, Error) contain no Japanese', async () => {
    covers('T-34', ['FR-EN-05']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-34', page, async () => {
        assertNoJapanese(await page.ui.evaluate(() => document.body.innerText), 'the shell chrome');

        let frame = await activeFrame(page);
        assertNoJapanese(await frame.evaluate(() => document.body.innerText), 'New Tab');

        await page.click('#settings-btn');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
        );
        frame = await activeFrame(page);
        assertNoJapanese(await frame.evaluate(() => document.body.innerText), 'Settings');

        await typeAddress(page, 'yoroxy://foo');
        await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
        frame = await activeFrame(page);
        assertNoJapanese(await frame.evaluate(() => document.body.innerText), 'Error page');
      });
    });
  });

  it('T-78: dynamic strings (toasts, dialogs, validation errors) contain no Japanese', async () => {
    covers('T-78', ['FR-EN-05']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-78', page, async () => {
        // Tab-limit toast.
        for (let i = 0; i < 31; i++) await page.click('#new-tab-btn');
        assertNoJapanese(await page.textContent('#toasts'), 'tab-limit toast');

        // Free up room before opening Settings (we're at the 30-tab cap).
        while ((await page.evaluate(() => window.Yoroxy.shell.tabs.getTabs().length)) > 1) {
          await page.click('.tab:last-child .tab-close');
        }

        // Settings validation errors + reset-confirmation dialog.
        await page.click('#settings-btn');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
        );
        const frame = await activeFrame(page);
        await frame.fill('#add-name', 'google');
        await frame.fill('#add-url', 'https://x.com/?q=%s');
        await frame.click('#add-form button[type=submit]');
        assertNoJapanese(await frame.textContent('#add-name-error'), 'engine name validation error');

        await frame.click('#reset-btn');
        assertNoJapanese(await frame.textContent('#reset-text'), 'reset confirmation dialog');
      });
    });
  });
});
