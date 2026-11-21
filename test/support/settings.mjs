/*
 * Seeds localStorage['yoroxy:settings'] before any app script runs, so
 * settings-dependent tests don't depend on state left behind by another
 * test (see the "test independence" policy in the test spec).
 *
 * Uses context.addInitScript(), which re-runs on *every* new document
 * created in this context afterwards - including not just a second
 * openShell() call, but every internal-page/tab iframe navigation, and
 * even hidden iframes the app creates itself (the shell's own service-
 * worker-registration fallback opens a hidden newtab.html iframe per tab
 * it creates until the SW is confirmed ready). Seeding is therefore only
 * applied when localStorage doesn't already hold a value: once the first
 * navigation seeds it, every later navigation (in any frame, including
 * those hidden ones) sees a non-null value and leaves it alone. Without
 * this guard, a hidden iframe's re-seed can fire a same-origin `storage`
 * event on the shell's own top window at an arbitrary moment afterwards,
 * silently reverting a setting the test (or the app's own UI) had just
 * changed - a real race this project hit while writing its test suite.
 */
export async function withSettings(context, overrides = {}) {
  const value = JSON.stringify({
    tabLayout: 'horizontal',
    search: { defaultEngineId: 'startpage', customEngines: [] },
    ...overrides,
  });
  await context.addInitScript((json) => {
    try {
      if (window.localStorage.getItem('yoroxy:settings') === null) {
        window.localStorage.setItem('yoroxy:settings', json);
      }
    } catch (err) {
      // storage disabled in this context (e.g. the T-18-style test) — fine,
      // the app is expected to fall back to in-memory defaults.
    }
  }, value);
}

/** Forces every localStorage write to throw, simulating a browser/profile that blocks storage. */
export async function withStorageDisabled(context) {
  await context.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('blocked', 'QuotaExceededError');
    };
  });
}
