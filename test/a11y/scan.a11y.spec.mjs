/*
 * Automated accessibility scanning (A-01..A-03).
 *
 * A-01 uses axe-core against the shell chrome (both tab layouts) and each
 * standalone internal page. Internal pages are scanned via direct
 * navigation rather than through the proxy iframe: axe needs to inject its
 * runtime into the document under test, and doing that reliably across a
 * same-origin-but-dynamically-created iframe adds real flakiness for no
 * extra coverage, since these pages' accessibility doesn't depend on
 * whether they happen to be embedded.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureServers } from '../support/ensure-servers.mjs';
import { launchBrowser } from '../support/browser.mjs';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { tabsInfo, withShellTest } from '../support/shell.mjs';
import AxeBuilder from '@axe-core/playwright';

function seriousViolations(results) {
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

function describeViolations(violations) {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`).join('\n');
}

describe('accessibility scan', () => {
  it('A-01: shell chrome has no critical/serious axe violations, horizontal and vertical', async () => {
    covers('A-01', ['A11Y-SCAN']);
    for (const layout of ['horizontal', 'vertical']) {
      await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 } }, settingsOverrides: { tabLayout: layout } }, async (page) => {
        await withFailureArtifacts(`A-01-shell-${layout}`, page, async () => {
          await page.ui.waitForFunction((l) => document.documentElement.getAttribute('data-tab-layout') === l, layout);
          const results = await new AxeBuilder({ page }).exclude('#content').analyze();
          const bad = seriousViolations(results);
          assert.equal(bad.length, 0, `shell chrome (${layout}) has serious a11y violations:\n${describeViolations(bad)}`);
        });
      });
    }
  });

  it('A-01b: each internal page (New Tab, Settings, Error) has no critical/serious axe violations', async () => {
    covers('A-01', ['A11Y-SCAN']);
    const { appBase } = await ensureServers();
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const pages = [
        ['/internal/newtab.html', 'newtab'],
        ['/internal/settings.html', 'settings'],
        ['/internal/error.html?type=not-found&name=foo', 'error'],
      ];
      for (const [path, label] of pages) {
        const page = await context.newPage();
        await withFailureArtifacts(`A-01b-${label}`, page, async () => {
          await page.goto(appBase + path);
          await page.waitForLoadState('networkidle');
          const results = await new AxeBuilder({ page }).analyze();
          const bad = seriousViolations(results);
          assert.equal(bad.length, 0, `${label} page has serious a11y violations:\n${describeViolations(bad)}`);
        });
        await page.close();
      }
      await context.close();
    } finally {
      await browser.close();
    }
  });

  it('A-02: exactly one tab has aria-selected="true" at all times, matching the active tab', async () => {
    covers('A-02', ['A11Y-SCAN']);
    await withShellTest({}, async (page) => {
      await withFailureArtifacts('A-02', page, async () => {
        for (let i = 0; i < 4; i++) await page.click('#new-tab-btn');
        assert.equal(await page.getAttribute('#tablist', 'role'), 'tablist');

        for (let n = 1; n <= 5; n++) {
          await page.click(`.tab:nth-child(${n})`);
          const selected = await page.$$eval('.tab-hit', (els) => els.map((e) => e.getAttribute('aria-selected')));
          assert.equal(selected.filter((v) => v === 'true').length, 1, `expected exactly one selected tab, got: ${selected}`);
          assert.equal(selected[n - 1], 'true');
          const tabs = await tabsInfo(page);
          assert.ok(tabs[n - 1].active);
        }
      });
    });
  });

  it('A-03: keyboard-focusable controls show a visible focus outline', async () => {
    covers('A-03', ['A11Y-SCAN']);
    await withShellTest({}, async (page, { fixtureBase }) => {
      await withFailureArtifacts('A-03', page, async () => {
        // Back/Forward are disabled (and thus correctly excluded from the
        // Tab order) until there's history to move through.
        await page.click('#address');
        await page.fill('#address', fixtureBase + '/p2');
        await page.press('#address', 'Enter');
        await page.waitForFunction(() => !window.Yoroxy.shell.tabs.getActive().loading);

        // #forward-btn is excluded here: it would still be legitimately
        // disabled (no forward history yet) and thus correctly out of the
        // Tab order, same reasoning as #back-btn before this navigation.
        const selectors = ['#back-btn', '#reload-btn', '#home-btn', '#address', '#settings-btn'];
        // Real keyboard Tab presses, not element.focus(): Chromium's
        // :focus-visible heuristic generally does not activate for a
        // programmatic .focus() call the way it does for genuine keyboard
        // navigation, so testing via .focus() would under-report real
        // focus-ring visibility.
        await page.click('#tabbar'); // known starting point, outside the iframe
        for (const sel of selectors) {
          let matched = false;
          for (let i = 0; i < 20 && !matched; i++) {
            await page.keyboard.press('Tab');
            matched = await page.ui.evaluate((s) => document.activeElement === document.querySelector(s), sel);
          }
          assert.ok(matched, `could not reach ${sel} via Tab from the tab bar within 20 presses`);
          const outline = await page.locator(sel).evaluate((e) => {
            const s = getComputedStyle(e);
            return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
          });
          const hasVisibleFocus =
            (outline.outlineStyle !== 'none' && parseFloat(outline.outlineWidth) > 0) || outline.boxShadow !== 'none';
          assert.ok(hasVisibleFocus, `${sel} has no visible focus indicator: ${JSON.stringify(outline)}`);
        }
      });
    });
  });
});
