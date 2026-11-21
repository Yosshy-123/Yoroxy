/*
 * Helpers for driving the Yoroxy browser shell from Playwright tests.
 * Kept deliberately thin: tests should read like a sequence of user
 * actions, with app-state polling hidden in here.
 */
import assert from 'node:assert/strict';
import { ensureServers } from './ensure-servers.mjs';
import { launchBrowser, launchBrowserStrictCsp } from './browser.mjs';
import { withSettings, withStorageDisabled } from './settings.mjs';

/*
 * The shell is two documents: the container (the page itself: tab manager,
 * window.Yoroxy in test mode, the tab frames) and the browser interface, a
 * sandboxed iframe named "ui" (tab bar, address bar, toolbar, toasts, menus).
 * The tests were written against one document, so the Page returned by
 * openShell() is wrapped: Page methods that take a selector for something on
 * screen (click, fill, textContent, locator, waitForSelector, ...) act on the
 * interface frame, and everything else (evaluate, waitForFunction, keyboard,
 * mouse, screenshot, on, ...) stays on the page, i.e. the container.
 *
 *   page.ui              the interface Frame, for evaluate()/waitForFunction()
 *                        code that reads the interface's DOM
 *   page.mainFrame()     the container, for selectors of the container's DOM
 *                        (the tab frames: .tab-frame)
 */
const UI_FRAME_METHODS = new Set([
  'click', 'dblclick', 'fill', 'press', 'type', 'hover', 'focus', 'check', 'uncheck', 'dragAndDrop',
  'selectOption', 'dispatchEvent', 'tap',
  '$', '$$', '$eval', '$$eval', 'locator',
  'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTitle', 'getByTestId',
  'textContent', 'innerText', 'innerHTML', 'getAttribute', 'inputValue',
  'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable',
  'waitForSelector',
]);

/*
 * What the user does in the interface reaches the container, and what the
 * container then decides reaches the interface again, as messages: it takes a
 * moment. After an action the wrapper below waits for that round trip (two
 * animation frames in the interface, two in the container, and one more in the
 * interface for the reply), so a test can read the result straight away like
 * it could when there was one document.
 */
const UI_ACTION_METHODS = new Set([
  'click', 'dblclick', 'fill', 'press', 'type', 'check', 'uncheck', 'dragAndDrop', 'selectOption', 'dispatchEvent', 'tap',
]);
const FRAMES = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export async function settle(page) {
  try {
    const ui = uiFrameOf(page);
    if (!ui) return;
    await ui.evaluate(FRAMES);
    await page.mainFrame().evaluate(FRAMES);
    await ui.evaluate(FRAMES);
  } catch {
    /* the page or frame went away (closed, navigated): nothing left to wait for */
  }
}

function wrapInput(target, input, methods) {
  return new Proxy(input, {
    get(obj, prop) {
      const value = obj[prop];
      if (typeof value !== 'function') return value;
      if (!methods.has(prop)) return value.bind(obj);
      return async (...args) => {
        const result = await value.apply(obj, args);
        await settle(target);
        return result;
      };
    },
  });
}
const INPUT_METHODS = new Set(['press', 'type', 'down', 'up', 'insertText', 'click', 'dblclick', 'wheel']);

export function uiFrameOf(page) {
  const main = page.mainFrame();
  return page.frames().find((f) => f !== main && f.name() === 'ui' && f.parentFrame() === main) || null;
}

export function wrapShellPage(page) {
  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'ui') {
        const frame = uiFrameOf(target);
        if (!frame) throw new Error('the interface frame (#ui) is not there (yet)');
        return frame;
      }
      if (prop === 'keyboard' || prop === 'mouse') return wrapInput(target, target[prop], INPUT_METHODS);
      if (UI_FRAME_METHODS.has(prop)) {
        const frame = uiFrameOf(target);
        if (!frame) throw new Error(`page.${String(prop)}(): the interface frame (#ui) is not there (yet)`);
        if (UI_ACTION_METHODS.has(prop)) {
          return async (...args) => {
            const result = await frame[prop](...args);
            await settle(target);
            return result;
          };
        }
        return frame[prop].bind(frame);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Resolves once the interface frame exists and has drawn its first tab. */
export async function waitForInterface(page) {
  const deadline = Date.now() + 30000;
  while (!uiFrameOf(page)) {
    if (Date.now() > deadline) throw new Error('the interface frame never appeared');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await uiFrameOf(page).waitForSelector('#tablist .tab', { timeout: 30000 });
  // The first tab exists as soon as it is created, but its page (New Tab) is still loading: acting on
  // it before its scripts have run (typing in the search box, clicking its links) would race them.
  const handle = await page.mainFrame().waitForSelector('.tab-frame.is-active', { state: 'attached', timeout: 30000 });
  const tabFrame = await handle.contentFrame();
  if (tabFrame) await tabFrame.waitForLoadState('load', { timeout: 30000 });
}

/**
 * Opens a fresh page at the shell (container.html) and waits for boot.
 *
 * `viaDom: true` waits for the first tab to appear in the DOM instead of
 * polling window.Yoroxy. It is for contexts that enforce the page's CSP
 * (waitForFunction's string evaluation is forbidden there) and for a server
 * running without test hooks (window.Yoroxy does not exist there).
 */
export async function openShell(context, base, path = '/container.html', { viaDom = false } = {}) {
  const page = wrapShellPage(await context.newPage());
  const logs = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(base + path);
  await waitForInterface(page);
  if (!viaDom) {
    await page.waitForFunction(
      () => window.Yoroxy && window.Yoroxy.shell && window.Yoroxy.shell.tabs.getTabs().length >= 1
    );
  }
  return { page, logs };
}

/**
 * Opens the shell the way it is opened in production: by loading the
 * launcher (/) in a page, which opens an about:blank window and writes
 * container.html into it (launcher.js). In such a window the browser
 * records no session history for the tab iframes, which Back / Forward must
 * not depend on. The launcher also sends the original page to the cloak URL,
 * so the browser of the calling test must be launched with
 * `blockExternalNetwork: true` (withShellTest option) to keep that off the
 * network.
 *
 * Returns { page: the injected shell, opener }.
 */
export async function openInjectedShell(context, base) {
  const opener = await context.newPage();
  const popupPromise = context.waitForEvent('page');
  await opener.goto(base + '/');
  const page = wrapShellPage(await popupPromise);
  await waitForInterface(page);
  await page.waitForFunction(
    () => window.Yoroxy && window.Yoroxy.shell && window.Yoroxy.shell.tabs.getTabs().length >= 1
  );
  return { page, opener };
}

/** Snapshot of every tab's public fields, in display order. */
export function tabsInfo(page) {
  return page.evaluate(() => {
    const tabs = window.Yoroxy.shell.tabs;
    const active = tabs.getActive();
    return tabs.getTabs().map((t) => ({
      id: t.id,
      kind: t.kind,
      url: t.url,
      title: t.title,
      active: active ? t.id === active.id : false,
      loading: t.loading,
      origin: t.origin,
      name: t.name,
      favicon: t.favicon,
    }));
  });
}

export function activeTabId(page) {
  return page.evaluate(() => window.Yoroxy.shell.tabs.getActive()?.id ?? null);
}

export async function frameOf(page, tabId) {
  const handle = await page.mainFrame().$(`iframe[data-tab-id="${tabId}"]`);
  assert.ok(handle, `no iframe found for tab ${tabId}`);
  return handle.contentFrame();
}

export async function activeFrame(page) {
  const id = await activeTabId(page);
  assert.ok(id, 'no active tab');
  return frameOf(page, id);
}

/** Types into the address bar and presses Enter (or Alt+Enter). */
export async function typeAddress(page, text, { alt = false } = {}) {
  await page.click('#address');
  await page.fill('#address', text);
  await page.press('#address', alt ? 'Alt+Enter' : 'Enter');
}

/** Resolves once the active tab matches `predicate(tab)`, or throws. */
export function waitForActiveTab(page, predicate, opts = {}) {
  return page.waitForFunction(
    (src) => {
      const fn = new Function('tab', `return (${src})(tab)`);
      const tab = window.Yoroxy.shell.tabs.getActive();
      return tab ? fn(tab) : false;
    },
    predicate.toString(),
    { timeout: 15000, ...opts }
  );
}

/** Resolves once the shell has exactly `n` tabs. */
export function waitForTabCount(page, n, opts = {}) {
  return page.waitForFunction((n) => window.Yoroxy.shell.tabs.getTabs().length === n, n, {
    timeout: 8000,
    ...opts,
  });
}

/** Resolves once some tab (any tab) has the given title and isn't loading. */
export function waitForTabTitle(page, title, opts = {}) {
  return page.waitForFunction(
    (title) => window.Yoroxy.shell.tabs.getTabs().some((t) => t.title === title && !t.loading),
    title,
    { timeout: 15000, ...opts }
  );
}

/** Navigates the active tab to a fixture URL and waits for it to finish loading. */
export async function loadFixturePath(page, fixtureBase, urlPath = '/') {
  await typeAddress(page, fixtureBase + urlPath);
  await waitForActiveTab(page, (t) => t.kind === 'web' && !t.loading && t.title !== 'Loading…');
}

/** Reads and parses the persisted settings object (or null if absent/invalid). */
export async function readStoredSettings(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('yoroxy:settings'));
    } catch (err) {
      return null;
    }
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * withShellTest(opts, fn) - the one setup/teardown every spec shares.
 *
 * Launches a fresh browser + context, seeds settings, opens the shell, runs
 * `fn(page, env)` and ALWAYS closes the browser afterwards (even when `fn`
 * throws), so a spec can never leak a browser by forgetting a `finally`.
 *
 * opts (all optional):
 *   settingsOverrides  object | ({ appBase, fixtureBase }) => object
 *                               merged into the seeded settings (withSettings)
 *   seed               boolean  default true; false = start from a genuinely empty profile
 *   disableStorage     boolean  simulate unavailable localStorage instead of seeding
 *   contextOptions     object   passed to browser.newContext (viewport, colorScheme, ...)
 *   strictCsp          boolean  enforce the pages' CSP (see launchBrowserStrictCsp);
 *                               only evaluate()/waitForSelector() may then be used
 *   blockExternalNetwork boolean  no host but loopback is reachable (see browser.mjs)
 *   beforeShell        async (context, env) => void   e.g. add init scripts/routes
 *   loadPath           string   load fixtureBase + loadPath in the first tab
 *   extraTabs          number   click "new tab" this many times afterwards
 *   setup              async (page, env) => void      extra arrangement (more tabs, ...)
 *
 * env = { browser, context, appBase, fixtureBase, logs }
 * Returns whatever `fn` returns.
 */
export async function withShellTest(opts, fn) {
  const {
    settingsOverrides,
    seed = true,
    disableStorage = false,
    contextOptions,
    beforeShell,
    loadPath,
    extraTabs = 0,
    setup,
    strictCsp = false,
    blockExternalNetwork = false,
  } = opts || {};
  const { appBase, fixtureBase } = await ensureServers();
  const launch = strictCsp ? launchBrowserStrictCsp : launchBrowser;
  const browser = await launch({ blockExternalNetwork });
  try {
    const context = await browser.newContext(contextOptions);
    if (disableStorage) await withStorageDisabled(context);
    else if (seed) {
      await withSettings(
        context,
        typeof settingsOverrides === 'function' ? settingsOverrides({ appBase, fixtureBase }) : settingsOverrides
      );
    }
    const env = { browser, context, appBase, fixtureBase, logs: [] };
    if (beforeShell) await beforeShell(context, env);
    const { page, logs } = await openShell(context, appBase, '/container.html', { viaDom: strictCsp });
    env.logs = logs;
    if (loadPath !== undefined && !strictCsp) await loadFixturePath(page, fixtureBase, loadPath);
    for (let i = 0; i < extraTabs; i++) await page.click('#new-tab-btn');
    if (setup) await setup(page, env);
    return await fn(page, env);
  } finally {
    await browser.close();
  }
}
