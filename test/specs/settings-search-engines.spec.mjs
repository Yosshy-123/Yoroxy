/*
 * Settings > Search: default engine selection, custom engine CRUD and its
 * validation rules (including the exact-boundary cases and Unicode input),
 * persistence, and Reset to defaults.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  openShell,
  tabsInfo,
  activeFrame,
  typeAddress,
  waitForActiveTab,
  readStoredSettings,
  withShellTest,
} from '../support/shell.mjs';

async function openSettings(page) {
  await page.click('#settings-btn');
  await page.waitForFunction(
    () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
  );
  return activeFrame(page);
}

async function addEngine(frame, name, template) {
  await frame.fill('#add-name', name);
  await frame.fill('#add-url', template);
  await frame.click('#add-form button[type=submit]');
}

/*
 * Like addEngine, but sets the name directly, past the input's maxlength
 * (fill() would truncate it there). Used to show the schema itself rejects
 * an over-long name that arrives by some other route (paste handlers, scripts).
 */
async function addEngineIgnoringMaxlength(frame, name, template) {
  await frame.evaluate((value) => { document.getElementById('add-name').value = value; }, name);
  await frame.fill('#add-url', template);
  await frame.click('#add-form button[type=submit]');
}

async function fieldErrors(frame) {
  return {
    name: await frame.textContent('#add-name-error'),
    url: await frame.textContent('#add-url-error'),
    general: await frame.textContent('#add-general-error'),
  };
}

describe('settings: search engines', () => {
  it('T-13: choosing Google as default is reflected in the next search', async () => {
    covers('T-13', ['FR-SET-21']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-13', page, async () => {
        const frame = await openSettings(page);
        await frame.click('#engine-list .engine[data-id="google"] input');
        await page.click('.tab:nth-child(1)');
        await typeAddress(page, 'some words');
        await waitForActiveTab(page, (t) => t.kind === 'web');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].url, 'https://www.google.com/search?q=some%20words');
      });
    });
  });

  it('T-14: adding a custom engine, selecting it as default, and using it to search', async () => {
    covers('T-14', ['FR-SET-22']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-14', page, async () => {
        const frame = await openSettings(page);
        await addEngine(frame, 'Local', fixtureBase + '/search?q=%s');
        const rows = await frame.$$eval('#engine-list .engine', (els) => els.map((e) => e.getAttribute('data-id')));
        assert.equal(rows.length, 7);
        assert.ok(rows[6].startsWith('custom-'));

        await frame.click('#engine-list .engine:nth-child(7) input');
        await page.click('.tab:nth-child(1)');
        await typeAddress(page, 'hello & bye');
        await waitForActiveTab(page, (t) => t.title.startsWith('Search'));
        const qFrame = await activeFrame(page);
        assert.equal(await qFrame.textContent('#q'), 'hello & bye');
      });
    });
  });

  it('T-15: validation errors for missing %s, non-http scheme, duplicate/empty/long names, and whitespace URLs', async () => {
    covers('T-15', ['FR-SET-22']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-15', page, async () => {
        const frame = await openSettings(page);

        await addEngine(frame, 'X', 'https://x.com/search');
        assert.equal((await fieldErrors(frame)).url, 'URL must contain %s where the search terms go.');

        await addEngine(frame, 'X', 'ftp://x.com/%s');
        assert.equal((await fieldErrors(frame)).url, 'URL must start with http:// or https://.');

        await addEngine(frame, 'google', 'https://x.com/?q=%s');
        assert.equal((await fieldErrors(frame)).name, 'A search engine with this name already exists.');

        await addEngine(frame, '', 'https://x.com/?q=%s');
        assert.equal((await fieldErrors(frame)).name, 'Name is required.');

        await addEngineIgnoringMaxlength(frame, 'a'.repeat(41), 'https://x.com/?q=%s');
        assert.equal((await fieldErrors(frame)).name, 'Name must be 40 characters or fewer.');

        await addEngine(frame, 'Bad', 'https://x .com/?q=%s');
        assert.equal((await fieldErrors(frame)).url, 'URL is not valid.');
      });
    });
  });

  it('SET-T3: %s in the host part of a search URL is refused; in the path, query or fragment it is allowed', async () => {
    covers('SET-T3', ['SECURITY-ENGINE-TEMPLATE']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('SET-T3', page, async () => {
        const verdicts = await page.evaluate(() => {
          const t = window.Yoroxy.settingsSchema.templateError;
          const cases = {
            'https://%s.example.com/': 'host',
            'https://x%s/': 'host',
            'https://x%s.example.com:8080/?q=1': 'host',
            'https://user:%s@x.example/': 'host',
            'https://%s': 'host',
            'https://x/?q=%s': null,
            'https://x/%s': null,
            'https://x/path?a=1#%s': null,
            'https://x.example:8080/?q=%s': null,
          };
          return Object.fromEntries(Object.keys(cases).map((url) => [url, t(url)]));
        });
        for (const [url, error] of Object.entries(verdicts)) {
          const expectHost = /^https:\/\/(%s|x%s|user:%s)/.test(url);
          if (expectHost) assert.match(error, /host name/, url);
          else assert.equal(error, null, url);
        }

        const frame = await openSettings(page);
        await addEngine(frame, 'Hostile', 'https://%s.example.com/');
        assert.match((await fieldErrors(frame)).url, /host name/);
        await addEngine(frame, 'Fine', 'https://x.example/?q=%s');
        assert.deepEqual(await fieldErrors(frame), { name: '', url: '', general: '' });
        assert.ok(await frame.$('#engine-list .engine:has-text("Fine")'));
      });
    });
  });

  it('SET-T4: the name limit is 40, and the input\'s maxlength says the same', async () => {
    covers('SET-T4', ['SETTINGS-NAME-LIMIT']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('SET-T4', page, async () => {
        const frame = await openSettings(page);
        assert.equal(await frame.getAttribute('#add-name', 'maxlength'), '40');
        // Typing stops at the limit (fill() would bypass it, so type for real).
        await frame.click('#add-name');
        await frame.locator('#add-name').pressSequentially('b'.repeat(41));
        assert.equal((await frame.inputValue('#add-name')).length, 40);

        await addEngine(frame, 'a'.repeat(40), 'https://x.com/?q=%s');
        assert.deepEqual(await fieldErrors(frame), { name: '', url: '', general: '' });
        assert.ok(await frame.$(`#engine-list .engine:has-text("${'a'.repeat(40)}")`), '40 characters is accepted');

        await addEngineIgnoringMaxlength(frame, 'c'.repeat(41), 'https://x.com/?q=%s');
        assert.equal((await fieldErrors(frame)).name, 'Name must be 40 characters or fewer.');
        assert.equal(await frame.$(`#engine-list .engine:has-text("${'c'.repeat(41)}")`), null, '41 characters is refused');
      });
    });
  });

  it('T-16: deleting the currently-default custom engine falls back to Startpage, with a notice', async () => {
    covers('T-16', ['FR-SET-23']);
    await withShellTest({ settingsOverrides: {
      search: { defaultEngineId: 'custom-aaaaaaaa', customEngines: [{ id: 'custom-aaaaaaaa', name: 'Temp', template: 'https://x.com/?q=%s' }] },
    } }, async (page) => {
      await withFailureArtifacts('T-16', page, async () => {
        const frame = await openSettings(page);
        await frame.click('#engine-list .engine:has-text("Temp") button:has-text("Delete")');
        assert.ok(await frame.isChecked('#engine-list .engine[data-id="startpage"] input'));
        assert.match(await frame.textContent('#engine-notice'), /reset to Startpage/);
      });
    });
  });

  it('T-17: settings persist to localStorage across a fresh shell load', async () => {
    covers('T-17', ['FR-SET-40']);
    // seed: false - deliberately no settings seeding. Seeding uses
    // context.addInitScript, which re-runs on every new document including
    // the second page's navigation below. This test instead starts from a
    // genuinely empty profile and lets the UI build up state, so that
    // opening a second page exercises real persistence rather than being
    // reset by our own test scaffolding.
    await withShellTest({ seed: false }, async (page, { context, appBase, fixtureBase }) => {
      await withFailureArtifacts('T-17', page, async () => {
        const frame = await openSettings(page);
        await addEngine(frame, 'Persisted', fixtureBase + '/search?q=%s');
        await frame.click('#engine-list .engine:has-text("Persisted") input');

        const { page: page2 } = await openShell(context, appBase);
        const stored = await readStoredSettings(page2);
        assert.equal(stored.search.customEngines.length, 1);
        assert.equal(stored.search.customEngines[0].name, 'Persisted');
        assert.equal(stored.search.defaultEngineId, stored.search.customEngines[0].id);
      });
    });
  });

  it('T-68: a name of exactly 40 characters is accepted (boundary opposite T-15)', async () => {
    covers('T-68', ['FR-SET-22']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-68', page, async () => {
        const frame = await openSettings(page);
        await addEngine(frame, 'n'.repeat(40), 'https://x.com/?q=%s');
        assert.deepEqual(await fieldErrors(frame), { name: '', url: '', general: '' });
        const rows = await frame.$$eval('#engine-list .engine', (els) => els.length);
        assert.equal(rows, 7);
      });
    });
  });

  it('T-69: a corrupted/partly-invalid stored settings blob is sanitized, not fatal', async () => {
    covers('T-69', ['FR-SET-42']);
    await withShellTest({
      seed: false,
      beforeShell: async (context) => {
        await context.addInitScript(() => {
          // Deliberately malformed: unknown top-level key, wrong type for
          // tabLayout, one valid custom engine and one invalid (no %s).
          const raw = JSON.stringify({
            version: 1,
            tabLayout: 12345,
            unknownTopLevelField: 'should be ignored',
            search: {
              defaultEngineId: 'does-not-exist',
              customEngines: [
                { id: 'custom-goodgood', name: 'Good', template: 'https://good.com/?q=%s' },
                { id: 'custom-badbadba', name: 'Bad', template: 'https://bad.com/no-placeholder' },
              ],
            },
          });
          window.localStorage.setItem('yoroxy:settings', raw);
        });
      },
    }, async (page) => {
      await withFailureArtifacts('T-69', page, async () => {
        const frame = await openSettings(page);
        // Invalid tabLayout falls back to the default.
        assert.ok(await frame.isChecked('input[name="tab-layout"][value="horizontal"]'));
        // Invalid defaultEngineId falls back to startpage.
        assert.ok(await frame.isChecked('#engine-list .engine[data-id="startpage"] input'));
        // The well-formed custom engine survived...
        assert.ok(await frame.$('#engine-list .engine:has-text("Good")'));
        // ...and the malformed one was dropped rather than crashing the page.
        assert.equal(await frame.$('#engine-list .engine:has-text("Bad")'), null);
      });
    });
  });

  it('T-79: custom engine names with emoji / surrogate-pair characters round-trip correctly', async () => {
    covers('T-79', ['I18N-CUSTOM-ENGINE']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-79', page, async () => {
        const frame = await openSettings(page);
        const emojiName = '検索🔍😀';
        await addEngine(frame, emojiName, 'https://x.com/?q=%s');
        assert.deepEqual(await fieldErrors(frame), { name: '', url: '', general: '' });
        assert.ok(await frame.$(`#engine-list .engine:has-text("${emojiName}")`));

        const stored = await readStoredSettings(page);
        assert.equal(stored.search.customEngines[0].name, emojiName);

        await frame.click(`#engine-list .engine:has-text("${emojiName}") button:has-text("Delete")`);
        assert.equal(await frame.$(`#engine-list .engine:has-text("${emojiName}")`), null);
      });
    });
  });

  it('Reset to defaults clears custom engines and restores horizontal layout', async () => {
    covers('RESET-DEFAULTS', ['FR-SET-30']);
    await withShellTest({ settingsOverrides: {
      tabLayout: 'vertical',
      search: { defaultEngineId: 'google', customEngines: [{ id: 'custom-cccccccc', name: 'C', template: 'https://c.com/?q=%s' }] },
    } }, async (page) => {
      await withFailureArtifacts('reset-defaults', page, async () => {
        const frame = await openSettings(page);
        await frame.click('#reset-btn');
        await frame.click('#reset-dialog button[value=reset]');
        await page.ui.waitForFunction(
          () => document.documentElement.getAttribute('data-tab-layout') === 'horizontal',
          null,
          { timeout: 5000 }
        );
        const stored = await readStoredSettings(page);
        assert.equal(stored.tabLayout, 'horizontal');
        assert.equal(stored.search.defaultEngineId, 'startpage');
        assert.equal(stored.search.customEngines.length, 0);
      });
    });
  });
});
