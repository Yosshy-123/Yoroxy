/*
 * The Discord entry points (New Tab footer, Settings > About) always open
 * in a real browser tab — never inside a Yoroxy shell tab — and carry
 * rel="noopener noreferrer".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { tabsInfo, activeFrame, withShellTest } from '../support/shell.mjs';

const DISCORD_URL = 'https://discord.gg/QcrEzNtgVc';

describe('Discord call-to-action', () => {
  it('T-37: the New Tab footer link opens Discord in a real tab, shell tab count unchanged', async () => {
    covers('T-37', ['FR-COM-02', 'FR-COM-04']);
    await withShellTest({}, async (page, { context }) => {
      await withFailureArtifacts('T-37', page, async () => {
        const frame = await activeFrame(page);
        const href = await frame.getAttribute('#discord-link', 'href');
        const rel = await frame.getAttribute('#discord-link', 'rel');
        assert.equal(href, DISCORD_URL);
        assert.match(rel, /noopener/);
        assert.match(rel, /noreferrer/);

        const popupPromise = context.waitForEvent('page', { timeout: 5000 });
        await frame.click('#discord-link');
        const popup = await popupPromise;
        assert.equal((await tabsInfo(page)).length, 1, 'no shell tab should be created');
        await popup.close();
      });
    });
  });

  it('T-38: the Settings > About link behaves identically, reachable via #about', async () => {
    covers('T-38', ['FR-COM-01', 'FR-COM-04']);
    await withShellTest({}, async (page, { context }) => {
      await withFailureArtifacts('T-38', page, async () => {
        await page.click('#address');
        await page.fill('#address', 'yoroxy://settings#about');
        await page.press('#address', 'Enter');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
        );
        const frame = await activeFrame(page);
        await frame.waitForFunction(() => document.getElementById('about').getBoundingClientRect().top < 700);

        const href = await frame.getAttribute('#discord-link', 'href');
        const rel = await frame.getAttribute('#discord-link', 'rel');
        assert.equal(href, DISCORD_URL);
        assert.match(rel, /noopener/);
        assert.match(rel, /noreferrer/);

        const popupPromise = context.waitForEvent('page', { timeout: 5000 });
        await frame.click('#discord-link');
        const popup = await popupPromise;
        assert.equal((await tabsInfo(page)).length, 1, 'no additional shell tab should be created');
        await popup.close();
      });
    });
  });
});
