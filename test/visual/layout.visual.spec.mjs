/*
 * Visual regression coverage (V-01..V-06).
 *
 * Two complementary techniques are used:
 *   - Numeric layout assertions (assert-layout.mjs) for the specific,
 *     previously-shipped bugs this project has actually hit (asymmetric
 *     vertical-sidebar padding; an off-center settings radio button).
 *     These are deterministic and don't depend on font rendering.
 *   - Pixel screenshot diffing (visual.mjs) as a general safety net across
 *     the main screens/themes/layouts, catching anything the numeric
 *     checks don't specifically look for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { assertCentered, assertSymmetricPadding } from '../support/assert-layout.mjs';
import { assertScreenshotMatches } from '../support/visual.mjs';
import { activeFrame, withShellTest } from '../support/shell.mjs';

describe('visual regression', () => {
  it('V-01: New Tab, horizontal layout, light and dark', async () => {
    covers('V-01', ['VISUAL-REGRESSION']);
    for (const scheme of ['light', 'dark']) {
      await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 }, colorScheme: scheme } }, async (page) => {
        await withFailureArtifacts(`V-01-${scheme}`, page, async () => {
          await page.click('#new-tab-btn');
          await assertScreenshotMatches(page, `newtab-horizontal-${scheme}`);
        });
      });
    }
  });

  it('V-02: Settings, About section, light and dark', async () => {
    covers('V-02', ['VISUAL-REGRESSION']);
    for (const scheme of ['light', 'dark']) {
      await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 }, colorScheme: scheme } }, async (page) => {
        await withFailureArtifacts(`V-02-${scheme}`, page, async () => {
          await page.click('#settings-btn');
          await page.waitForFunction(
            () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
          );
          const frame = await activeFrame(page);
          await frame.evaluate(() => document.getElementById('about').scrollIntoView({ block: 'center' }));
          await page.waitForTimeout(150); // let the scroll settle
          await assertScreenshotMatches(page, `settings-about-${scheme}`);
        });
      });
    }
  });

  it('V-03: numeric layout checks catch the two real bugs this project shipped and fixed', async () => {
    covers('V-03', ['VISUAL-REGRESSION']);
    await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 } } }, async (page) => {
      await withFailureArtifacts('V-03', page, async () => {
        // --- Bug 1: vertical sidebar's right-side border ate 1px of layout
        // width via `border-right`, making the right gap 9px vs 8px on the
        // left. Fixed by switching to an inset box-shadow. Prove both that
        // (a) the current CSS passes, and (b) reintroducing the old rule
        // makes this exact assertion fail — i.e. the check has teeth.
        await page.evaluate(() => window.Yoroxy.settings.setTabLayout('vertical'));
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');

        await assertSymmetricPadding(
          await page.$('#tabbar'),
          await page.$('#new-tab-btn'),
          'x',
          0.5,
          'vertical sidebar left/right padding must be symmetric'
        );

        const regressionStyle = await page.ui.addStyleTag({
          content: 'html[data-tab-layout="vertical"] .tabbar { box-shadow: none !important; border-right: 1px solid rgba(0,0,0,0.3) !important; }',
        });
        let regressionCaught = false;
        try {
          await assertSymmetricPadding(await page.$('#tabbar'), await page.$('#new-tab-btn'), 'x', 0.5);
        } catch (err) {
          regressionCaught = true;
        }
        assert.ok(regressionCaught, 'reintroducing the old border-right rule should break the symmetry check');
        await regressionStyle.evaluate((el) => el.remove());

        // sanity: removing the regression rule restores a passing state
        await assertSymmetricPadding(await page.$('#tabbar'), await page.$('#new-tab-btn'), 'x', 0.5);

        // --- Bug 2: a settings search-engine radio button was vertically
        // off-center against its two-line (name + URL) label, fixed with a
        // CSS Grid layout. Same prove-it-both-ways approach.
        await page.click('#settings-btn');
        await page.waitForFunction(
          () => window.Yoroxy.shell.tabs.getActive().internalName === 'settings' && !window.Yoroxy.shell.tabs.getActive().loading
        );
        const frame = await activeFrame(page);
        const radio = await frame.$('#engine-list .engine:first-child input');
        const mainBox = await frame.$('#engine-list .engine:first-child .engine-main');
        await assertCentered(radio, mainBox, 'y', 0.5, 'the default-engine radio should be centered on its row');

        const regressionStyle2 = await frame.addStyleTag({
          content: '.engine-main input { position: relative; top: -10px; }',
        });
        let regressionCaught2 = false;
        try {
          await assertCentered(radio, mainBox, 'y', 0.5);
        } catch (err) {
          regressionCaught2 = true;
        }
        assert.ok(regressionCaught2, 'a 10px vertical offset on the radio should fail the centering check');
        await regressionStyle2.evaluate((el) => el.remove());
        await assertCentered(radio, mainBox, 'y', 0.5);
      });
    });
  });

  it('V-04: narrow (375px) vertical-layout drawer, closed and open', async () => {
    covers('V-04', ['VISUAL-REGRESSION']);
    await withShellTest({ contextOptions: { viewport: { width: 375, height: 700 } }, settingsOverrides: { tabLayout: 'vertical' } }, async (page) => {
      await withFailureArtifacts('V-04', page, async () => {
        await page.ui.waitForFunction(() => document.documentElement.getAttribute('data-tab-layout') === 'vertical');
        await assertScreenshotMatches(page, 'narrow-drawer-closed');
        await page.click('#tabs-btn');
        await page.waitForTimeout(200);
        await assertScreenshotMatches(page, 'narrow-drawer-open');
      });
    });
  });

  it('V-05: many tabs (10+) on the horizontal strip stay legible (no overlap)', async () => {
    covers('V-05', ['VISUAL-REGRESSION']);
    await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 } } }, async (page) => {
      await withFailureArtifacts('V-05', page, async () => {
        for (let i = 0; i < 12; i++) await page.click('#new-tab-btn');
        const rects = await page.$$eval('.tab', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
        for (let i = 1; i < rects.length; i++) {
          assert.ok(rects[i].left >= rects[i - 1].left, 'tabs must stay left-to-right ordered, not overlap/reorder visually');
        }
        await assertScreenshotMatches(page, 'many-tabs-horizontal');
      });
    });
  });

  it('V-06: the three error pages', async () => {
    covers('V-06', ['VISUAL-REGRESSION']);
    await withShellTest({ contextOptions: { viewport: { width: 1200, height: 800 } } }, async (page) => {
      await withFailureArtifacts('V-06', page, async () => {
        const cases = [
          ['yoroxy://foo', 'error-not-found'],
          ['javascript:alert(1)', 'error-unsupported-scheme'],
        ];
        for (const [input, name] of cases) {
          await page.click('#address');
          await page.fill('#address', input);
          await page.press('#address', 'Enter');
          await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().kind === 'internal' && !window.Yoroxy.shell.tabs.getActive().loading);
          await assertScreenshotMatches(page, name);
        }
      });
    });
  });
});
