/*
 * SEC-T8  The favicon size limit (256 KiB), whether or not the server
 *         declares a Content-Length.
 * TAB-T2  A page title of 1 MB is shortened to 512 characters.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { loadFixturePath, tabsInfo, waitForActiveTab, sleep, withShellTest } from '../support/shell.mjs';

const LIMIT = 256 * 1024;

describe('favicon size limit and title length', () => {
  for (const mode of ['length', 'chunked']) {
    it(`SEC-T8: an icon of exactly 256 KiB is shown (${mode})`, async () => {
      covers(`SEC-T8-ok-${mode}`, ['SECURITY-FAVICON-LIMIT']);
      await withShellTest({}, async (page, { fixtureBase }) => {
        await withFailureArtifacts(`SEC-T8-ok-${mode}`, page, async () => {
          await loadFixturePath(page, fixtureBase, `/favicon-page?bytes=${LIMIT}&mode=${mode}`);
          await waitForActiveTab(page, (t) => typeof t.favicon === 'string' && t.favicon.startsWith('data:image/'), { timeout: 10000 });
          await page.waitForSelector('.tab.is-active .tab-favicon img');
        });
      });
    });

    it(`SEC-T8: an icon one byte over the limit, and a much larger one, fall back to the globe (${mode})`, async () => {
      covers(`SEC-T8-over-${mode}`, ['SECURITY-FAVICON-LIMIT']);
      for (const bytes of [LIMIT + 1, 4 * 1024 * 1024]) {
        await withShellTest({}, async (page, { fixtureBase }) => {
          await withFailureArtifacts(`SEC-T8-over-${mode}-${bytes}`, page, async () => {
            await loadFixturePath(page, fixtureBase, `/favicon-page?bytes=${bytes}&mode=${mode}`);
            // No positive signal exists for "gave up"; the larger icon takes a moment to be cut off.
            await sleep(3000);
            assert.equal((await tabsInfo(page))[0].favicon, null);
            assert.equal(await page.$('.tab.is-active .tab-favicon img'), null, 'the globe, not an image');
          });
        });
      }
    });
  }

  it('TAB-T2: a 1 MB title is cut to 512 characters', async () => {
    covers('TAB-T2', ['TAB-TITLE-LIMIT']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('TAB-T2', page, async () => {
        await loadFixturePath(page, fixtureBase, '/title-page?bytes=1000000');
        await waitForActiveTab(page, (t) => !!t.title && t.title.startsWith('TTTT'), { timeout: 15000 });
        assert.equal((await tabsInfo(page))[0].title.length, 512);
        assert.equal(await page.locator('.tab.is-active .tab-title').evaluate((el) => el.textContent.length), 512);
      });
    });
  });
});
