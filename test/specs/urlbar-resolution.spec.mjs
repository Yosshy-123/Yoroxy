/*
 * Address-bar input resolution rules: search vs URL vs internal page vs
 * error, plus the boundary cases (T-60 .. T-67).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import {
  tabsInfo,
  typeAddress,
  activeFrame,
  waitForActiveTab,
  withShellTest,
} from '../support/shell.mjs';

describe('address bar resolution', () => {
  it('T-03: plain text with no dots/scheme resolves via the default search engine', async () => {
    covers('T-03', ['URL-RULE-8']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-03', page, async () => {
        await typeAddress(page, 'cats and dogs');
        await waitForActiveTab(page, (t) => t.kind === 'web');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].url, 'https://www.startpage.com/sp/search?query=cats%20and%20dogs');
      });
    });
  });

  it('T-04: javascript: is rejected as an unsupported scheme', async () => {
    covers('T-04', ['URL-RULE-6']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-04', page, async () => {
        await typeAddress(page, 'javascript:alert(1)');
        await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
        const frame = await activeFrame(page);
        assert.match(await frame.textContent('h1'), /can.t be opened/);
        assert.match(await frame.textContent('#detail'), /javascript/);
      });
    });
  });

  it('T-05: yoroxy://foo (unknown internal page) shows a not-found error', async () => {
    covers('T-05', []);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-05', page, async () => {
        await typeAddress(page, 'yoroxy://foo');
        await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
        const frame = await activeFrame(page);
        assert.match(await frame.textContent('h1'), /doesn.t exist/);
        assert.match(await frame.textContent('#detail'), /yoroxy:\/\/foo/);
      });
    });
  });

  it('T-60: re-entering the exact same URL reloads the tab', async () => {
    covers('T-60', ['FR-URL-03']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-60', page, async () => {
        await typeAddress(page, fixtureBase + '/p2');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);
        const frame1 = await activeFrame(page);
        await frame1.evaluate(() => { window.__marker = 'alive'; });
        await typeAddress(page, fixtureBase + '/p2');
        await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().loading === false, null, {
          timeout: 15000,
        });
        const frame2 = await activeFrame(page);
        assert.equal(await frame2.evaluate(() => window.__marker), undefined);
      });
    });
  });

  it('T-61: typing about:blank shows a blank Untitled tab', async () => {
    covers('T-61', ['FR-URL-01']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-61', page, async () => {
        await typeAddress(page, 'about:blank');
        await waitForActiveTab(page, (t) => t.kind === 'blank');
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].title, 'Untitled');
      });
    });
  });

  it('T-62: Escape while editing discards the change and restores the shown URL', async () => {
    covers('T-62', ['FR-URL-02']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-62', page, async () => {
        await typeAddress(page, fixtureBase + '/p2');
        await waitForActiveTab(page, (t) => t.title === 'Page 2' && !t.loading);
        await page.click('#address');
        await page.fill('#address', 'this should be discarded');
        await page.press('#address', 'Escape');
        assert.equal(await page.inputValue('#address'), fixtureBase + '/p2');
        // and the tab itself must not have navigated anywhere
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].url, fixtureBase + '/p2');
      });
    });
  });

  it('T-65: every listed unsupported scheme is rejected with the right scheme name shown', async () => {
    covers('T-65', ['URL-RULE-6']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('T-65', page, async () => {
        const cases = [
          ['data:text/html,x', 'data'],
          ['file:///etc/passwd', 'file'],
          ['blob:http://x', 'blob'],
          ['vbscript:x', 'vbscript'],
          ['view-source:http://x', 'view-source'],
          ['chrome://settings', 'chrome'],
        ];
        for (const [input, scheme] of cases) {
          await typeAddress(page, input);
          await waitForActiveTab(page, (t) => t.kind === 'internal' && !t.loading);
          const frame = await activeFrame(page);
          const detail = await frame.textContent('#detail');
          assert.match(detail, new RegExp(scheme), `expected scheme "${scheme}" in error detail: ${detail}`);
        }
      });
    });
  });

  it('T-66: search terms are inserted literally, not interpreted as replace() patterns', async () => {
    covers('T-66', ['URL-RULE-8']);
    await withShellTest({ settingsOverrides: ({ fixtureBase }) => ({
      search: { defaultEngineId: 'ddg', customEngines: [{ id: 'custom-aaaaaaaa', name: 'Local', template: fixtureBase + '/search?q=%s' }] },
    }) }, async (page) => {
      await withFailureArtifacts('T-66', page, async () => {
        await page.evaluate(() => window.Yoroxy.settings.setDefaultEngine('custom-aaaaaaaa'));
        await typeAddress(page, 'a$&b');
        await waitForActiveTab(page, (t) => t.kind === 'web' && !t.loading);
        const frame = await activeFrame(page);
        assert.equal(await frame.textContent('#q'), 'a$&b');
      });
    });
  });

  it('T-67: a template with two %s placeholders substitutes both', async () => {
    covers('T-67', ['URL-RULE-8']);
    await withShellTest({ settingsOverrides: ({ fixtureBase }) => ({
      search: {
        defaultEngineId: 'custom-bbbbbbbb',
        customEngines: [{ id: 'custom-bbbbbbbb', name: 'Double', template: fixtureBase + '/search?q=%s&r=%s' }],
      },
    }) }, async (page, { fixtureBase }) => {
      await withFailureArtifacts('T-67', page, async () => {
        await typeAddress(page, 'zed');
        await waitForActiveTab(page, (t) => t.kind === 'web' && !t.loading);
        const tabs = await tabsInfo(page);
        assert.equal(tabs[0].url, fixtureBase + '/search?q=zed&r=zed');
      });
    });
  });
});
