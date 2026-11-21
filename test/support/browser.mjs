/*
 * Browser launch helpers for the E2E suite.
 *
 * `playwright` is a declared devDependency (package.json); browser binaries
 * are installed separately with `npx playwright install chromium firefox`.
 * Nothing here downloads anything.
 *
 * Two flavours, because the app ships a strict, hash-based CSP on its own
 * pages (SEC-02) and the two kinds of test need opposite things:
 *
 *   launchBrowser()            functional tests. Contexts bypass CSP, because
 *                              page.waitForFunction("...") evaluates a string
 *                              inside the page and a strict CSP forbids that.
 *                              Subresource Integrity is NOT affected by the
 *                              bypass, so SRI is still verified.
 *   launchBrowserStrictCsp()   tests of the CSP itself (SEC-T2, SEC-T7). Use
 *                              page.evaluate() and waitForSelector() only.
 *
 * Browser engine: Chromium by default; set YOROXY_TEST_BROWSER=firefox to run
 * the suite on Firefox.
 */
import { chromium, firefox } from 'playwright';

const ENGINES = { chromium, firefox };

function engine() {
  const name = process.env.YOROXY_TEST_BROWSER || 'chromium';
  const found = ENGINES[name];
  if (!found) throw new Error(`YOROXY_TEST_BROWSER must be "chromium" or "firefox", got "${name}"`);
  return { name, type: found };
}

/*
 * Options:
 *   blockExternalNetwork  boolean  make every host except localhost/127.0.0.1
 *                                  unreachable, so a test that lets the app
 *                                  navigate to an external site (the
 *                                  launcher's cloak redirect) never touches
 *                                  the real network. Observe such a
 *                                  navigation with page.on('request').
 */
function launchOptions({ blockExternalNetwork = false } = {}) {
  const { name } = engine();
  if (name === 'chromium') {
    const args = ['--no-sandbox'];
    if (blockExternalNetwork) {
      args.push('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1');
    }
    return { headless: true, args };
  }
  const options = { headless: true };
  if (blockExternalNetwork) {
    // Firefox has no host-resolver switch: send everything but loopback to a
    // proxy that is not listening.
    options.firefoxUserPrefs = {
      'network.proxy.type': 1,
      'network.proxy.http': '127.0.0.1',
      'network.proxy.http_port': 9,
      'network.proxy.ssl': '127.0.0.1',
      'network.proxy.ssl_port': 9,
      'network.proxy.no_proxies_on': 'localhost,127.0.0.1',
    };
  }
  return options;
}

/** Makes `browser.newContext()` default to `defaults` (explicit options still win). */
function withContextDefaults(browser, defaults) {
  const original = browser.newContext.bind(browser);
  browser.newContext = (options) => original({ ...defaults, ...options });
  return browser;
}

/** Fresh headless browser; contexts bypass CSP. The caller closes it. */
export async function launchBrowser(options) {
  const browser = await engine().type.launch(launchOptions(options));
  return withContextDefaults(browser, { bypassCSP: true });
}

/** Fresh headless browser whose contexts enforce the pages' CSP. The caller closes it. */
export async function launchBrowserStrictCsp(options) {
  const browser = await engine().type.launch(launchOptions(options));
  return withContextDefaults(browser, { bypassCSP: false });
}

export { chromium, firefox };
