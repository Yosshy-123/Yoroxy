/*
 * Pixel-level screenshot regression checks, built on pixelmatch.
 *
 * On first run for a given name, no baseline exists yet: the screenshot is
 * saved as the new baseline and the check passes (bootstrap mode) — this
 * mirrors how most visual-regression tools behave, and avoids failing a
 * fresh checkout that has never captured baselines before. Every run after
 * that compares against the stored baseline and fails if more than
 * `maxDiffRatio` of pixels differ.
 *
 * Baselines live under test/visual/baselines/<name>.png and are meant to be
 * committed; a deliberate visual change should be reviewed and the
 * baseline updated (delete the old PNG and re-run once) rather than the
 * threshold being loosened.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import assert from 'node:assert/strict';
import { slug } from './failure-artifacts.mjs';

const baselineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../visual/baselines');
const diffDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/visual-diffs');

fs.mkdirSync(baselineDir, { recursive: true });

/**
 * compareScreenshot(page, 'newtab-horizontal-light', { maxDiffRatio: 0.01 })
 */
export async function compareScreenshot(page, name, { maxDiffRatio = 0.01 } = {}) {
  const safeName = slug(name);
  const baselinePath = path.join(baselineDir, `${safeName}.png`);
  const buffer = await page.screenshot();

  if (!fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, buffer);
    return { bootstrapped: true, diffRatio: 0 };
  }

  const actual = PNG.sync.read(buffer);
  const expected = PNG.sync.read(fs.readFileSync(baselinePath));

  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Screenshot "${name}" size changed: baseline ${expected.width}x${expected.height}, actual ${actual.width}x${actual.height}. ` +
        `If intentional, delete ${baselinePath} and re-run to recapture.`
    );
  }

  const { width, height } = actual;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(actual.data, expected.data, diff.data, width, height, { threshold: 0.15 });
  const diffRatio = diffPixels / (width * height);

  if (diffRatio > maxDiffRatio) {
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(path.join(diffDir, `${safeName}.actual.png`), buffer);
    fs.writeFileSync(path.join(diffDir, `${safeName}.diff.png`), PNG.sync.write(diff));
  }

  return { bootstrapped: false, diffRatio };
}

/** Asserts a screenshot matches its baseline within `maxDiffRatio`. */
export async function assertScreenshotMatches(page, name, opts = {}) {
  const { bootstrapped, diffRatio } = await compareScreenshot(page, name, opts);
  if (bootstrapped) return; // nothing to compare against yet
  const max = opts.maxDiffRatio ?? 0.01;
  assert.ok(
    diffRatio <= max,
    `screenshot "${name}" differs from its baseline by ${(diffRatio * 100).toFixed(2)}% ` +
      `(max ${(max * 100).toFixed(2)}%). See test/reports/visual-diffs/${name}.diff.png`
  );
}
