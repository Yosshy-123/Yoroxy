/*
 * TAB-T1: every field a tab ever carries is declared in createTabRecord().
 *
 * A field that only appears after some navigation (the old `pending*` ones)
 * is an implicit contract between modules. The tab is created, then driven
 * through every kind of navigation, and its own keys must still be exactly
 * the declared ones.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { activeFrame, loadFixturePath, typeAddress, waitForActiveTab, withShellTest } from '../support/shell.mjs';

describe('tab model', () => {
  it('TAB-T1: createTabRecord declares pending* and every other field; navigation adds none', async () => {
    covers('TAB-T1', ['TAB-RECORD']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('TAB-T1', page, async () => {
        const declared = await page.evaluate(() => Object.keys(window.Yoroxy.tabModel.createTabRecord({ id: 'probe', iframe: null })).sort());
        for (const key of ['pending', 'pendingKind', 'pendingTitle', 'pendingInternal']) {
          assert.ok(declared.includes(key), `${key} is declared`);
        }

        const keysOfTabs = () =>
          page.evaluate(() => window.Yoroxy.shell.tabs.getTabs().map((t) => Object.keys(t).sort()));

        // web page, another page, an internal page, an error page, back, a same-document navigation, a new tab
        await loadFixturePath(page, fixtureBase, '/p2');
        await loadFixturePath(page, fixtureBase, '/spa');
        await typeAddress(page, 'yoroxy://settings');
        await waitForActiveTab(page, (t) => t.internalName === 'settings' && !t.loading);
        await typeAddress(page, 'yoroxy://nope');
        await waitForActiveTab(page, (t) => t.internalName === 'error' && !t.loading);
        await page.click('#back-btn');
        await waitForActiveTab(page, (t) => !t.loading);
        await page.click('#new-tab-btn');
        await typeAddress(page, 'about:blank');
        await waitForActiveTab(page, (t) => t.kind === 'blank' && !t.loading);

        for (const keys of await keysOfTabs()) assert.deepEqual(keys, declared);
        assert.equal((await activeFrame(page)).url(), 'about:blank');
      });
    });
  });
});
