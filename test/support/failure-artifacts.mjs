/*
 * On test failure, saves a screenshot and the current tab list next to the
 * test's name under test/reports/failures/<test-name>/, then rethrows.
 * Wrap the body of an `it(...)` in this to get automatic failure artifacts
 * without every test having to remember to do it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reportsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/failures');

/** File-name-safe form of a test/screenshot name (also keeps paths inside their directory). */
export function slug(name) {
  return name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export async function withFailureArtifacts(name, page, fn) {
  try {
    return await fn();
  } catch (err) {
    try {
      const dir = path.join(reportsDir, slug(name));
      await fs.mkdir(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'screenshot.png') }).catch(() => {});
      const tabs = await page
        .evaluate(() => {
          try {
            const tabs = window.Yoroxy?.shell?.tabs;
            return tabs
              ? tabs.getTabs().map((t) => ({ id: t.id, kind: t.kind, url: t.url, title: t.title, loading: t.loading }))
              : null;
          } catch (e) {
            return { evalError: String(e) };
          }
        })
        .catch((e) => ({ error: String(e) }));
      await fs.writeFile(
        path.join(dir, 'state.json'),
        JSON.stringify({ error: String(err && err.message || err), tabs, url: page.url() }, null, 2)
      );
    } catch (artifactErr) {
      // Never let artifact collection mask the original failure.
      console.error('Failed to save failure artifacts:', artifactErr);
    }
    throw err;
  }
}
