/*
 * SCR-T1..T3  the page area scrolls with the wheel in both tab layouts, also
 *             while a toast is shown or after a menu was closed. (The interface
 *             used to be clipped to its parts with a non-rectangular clip-path,
 *             which in Chromium stops wheel scrolling of the page underneath.)
 * TOAST-T1    a toast has a close button and closes on Escape; a closed toast
 *             lets the container forget its action
 * TOAST-T2    nothing of the interface paints over the page area: no clip-path,
 *             a transparent interface document, the toast is a bar in the layout
 * MODAL-T1    the context menu and the drawer cover the pages while they are
 *             open and hand them back when they close
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../support/failure-artifacts.mjs';
import { covers } from '../support/traceability.mjs';
import { activeFrame, sleep, tabsInfo, waitForTabCount, withShellTest } from '../support/shell.mjs';

const LAYOUTS = ['horizontal', 'vertical'];

/** Where the middle of the page area is, in the shell window. */
function contentCenter(page) {
  return page.evaluate(() => {
    const r = window.Yoroxy.shell.tabs.getActive().iframe.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y, height: r.height };
  });
}

const scrollY = (page) => page.evaluate(() => window.Yoroxy.shell.tabs.getActive().iframe.contentWindow.scrollY);

/** Turns the wheel over the middle of the page area; returns how far the page scrolled. */
async function wheelOverPage(page) {
  await page.evaluate(() => window.Yoroxy.shell.tabs.getActive().iframe.contentWindow.scrollTo(0, 0));
  const c = await contentCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 300);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const y = await scrollY(page);
    if (y > 0) return y;
    await sleep(50);
  }
  return scrollY(page);
}

/** A script-initiated window.open() without user activation: blocked, with a toast. */
async function provokeToast(page) {
  const frame = await activeFrame(page);
  await frame.evaluate(() => {
    const proto = Object.getPrototypeOf(navigator.userActivation);
    const original = Object.getOwnPropertyDescriptor(proto, 'isActive');
    Object.defineProperty(proto, 'isActive', { get: () => false, configurable: true });
    window.open('/p2');
    Object.defineProperty(proto, 'isActive', original);
  });
  await page.waitForSelector('#toasts .toast');
}

describe('shell: scrolling the page area', () => {
  for (const layout of LAYOUTS) {
    it(`SCR-T1: the wheel scrolls the page in the ${layout} layout`, async () => {
      covers(`SCR-T1-${layout}`, ['SHELL-SCROLL']);
      await withShellTest({ loadPath: '/tall', settingsOverrides: { tabLayout: layout } }, async (page) => {
        await withFailureArtifacts(`SCR-T1-${layout}`, page, async () => {
          assert.equal(await page.getAttribute('html', 'data-tab-layout'), layout);
          assert.ok((await wheelOverPage(page)) > 0, 'the page did not scroll');
        });
      });
    });

    it(`SCR-T2: ...also while a toast is shown (${layout})`, async () => {
      covers(`SCR-T2-${layout}`, ['SHELL-SCROLL']);
      await withShellTest({ loadPath: '/', settingsOverrides: { tabLayout: layout } }, async (page, { fixtureBase }) => {
        await withFailureArtifacts(`SCR-T2-${layout}`, page, async () => {
          await page.evaluate((url) => window.Yoroxy.shell.tabs.navigate(window.Yoroxy.shell.tabs.getActive(), url), fixtureBase + '/tall');
          await page.waitForFunction(() => window.Yoroxy.shell.tabs.getActive().url.endsWith('/tall') && !window.Yoroxy.shell.tabs.getActive().loading);
          const before = await contentCenter(page);
          await provokeToast(page);
          await page.waitForFunction((top) => window.Yoroxy.shell.tabs.getActive().iframe.getBoundingClientRect().y > top, before.top);
          assert.ok((await wheelOverPage(page)) > 0, 'the page did not scroll while a toast was shown');
        });
      });
    });
  }

  it('SCR-T3: scrolling still works after a context menu was opened and closed', async () => {
    covers('SCR-T3', ['SHELL-SCROLL']);
    await withShellTest({ loadPath: '/tall', settingsOverrides: { tabLayout: 'vertical' } }, async (page) => {
      await withFailureArtifacts('SCR-T3', page, async () => {
        await page.click('.tab', { button: 'right' });
        await page.waitForSelector('#ctxmenu:not([hidden])');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#ctxmenu', { state: 'hidden' });
        assert.ok((await wheelOverPage(page)) > 0);
      });
    });
  });
});

describe('shell: toasts', () => {
  it('TOAST-T1: a toast can be closed with its button and with Escape, and Open still works', async () => {
    covers('TOAST-T1', ['TOAST-DISMISS']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('TOAST-T1', page, async () => {
        await provokeToast(page);
        const close = page.locator('#toasts .toast .toast-close');
        assert.equal(await close.count(), 1);
        assert.equal(await close.getAttribute('aria-label'), 'Dismiss');
        await close.click();
        await page.ui.waitForFunction(() => document.querySelectorAll('#toasts .toast').length === 0);
        assert.equal((await tabsInfo(page)).length, 1, 'closing a toast must not run its action');

        await provokeToast(page);
        await page.focus('#toasts .toast .toast-close');
        await page.keyboard.press('Escape');
        await page.ui.waitForFunction(() => document.querySelectorAll('#toasts .toast').length === 0);
        assert.equal((await tabsInfo(page)).length, 1);

        await provokeToast(page);
        await page.click('.toast-action');
        await waitForTabCount(page, 2);
        await page.ui.waitForFunction(() => document.querySelectorAll('#toasts .toast').length === 0);
      });
    });
  });

  it('TOAST-T1b: a toast waits while the pointer is on it', async () => {
    covers('TOAST-T1b', ['TOAST-DISMISS']);
    await withShellTest({ loadPath: '/' }, async (page) => {
      await withFailureArtifacts('TOAST-T1b', page, async () => {
        await provokeToast(page);
        await page.hover('#toasts .toast-text');
        // A toast that is not hovered goes after its timeout; this one is held while the pointer is on it.
        await sleep(1500);
        assert.equal(await page.locator('#toasts .toast').count(), 1);
      });
    });
  });

  for (const layout of LAYOUTS) {
    it(`TOAST-T2: nothing of the interface paints over the page area (${layout})`, async () => {
      covers(`TOAST-T2-${layout}`, ['TOAST-BACKGROUND']);
      await withShellTest({ loadPath: '/tall', settingsOverrides: { tabLayout: layout } }, async (page) => {
        await withFailureArtifacts(`TOAST-T2-${layout}`, page, async () => {
          await provokeToast(page);
          const container = await page.evaluate(() => ({
            clip: document.getElementById('ui').style.clipPath,
            uiZ: Number(getComputedStyle(document.getElementById('ui')).zIndex),
            contentZ: Number(getComputedStyle(document.getElementById('content')).zIndex),
          }));
          assert.equal(container.clip, '', 'the interface must not be clipped');
          assert.ok(container.contentZ > container.uiZ, 'the pages sit above the interface');

          const ui = await page.ui.evaluate(() => {
            const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
            const slot = document.getElementById('content').getBoundingClientRect();
            const toast = document.querySelector('#toasts .toast').getBoundingClientRect();
            return {
              html: bg('html'), body: bg('body'), app: bg('#app'), main: bg('.main'), slot: bg('#content'),
              toastBottom: toast.bottom, slotTop: slot.top,
            };
          });
          for (const key of ['html', 'body', 'app', 'main', 'slot']) {
            assert.equal(ui[key], 'rgba(0, 0, 0, 0)', `${key} must be transparent`);
          }
          assert.ok(ui.toastBottom <= ui.slotTop + 0.5, 'the toast is in the layout above the page area, not over it');
        });
      });
    });
  }
});

describe('shell: the interface covers the pages only while it has to', () => {
  it('MODAL-T1: context menu', async () => {
    covers('MODAL-T1', ['SHELL-MODAL']);
    await withShellTest({ loadPath: '/tall' }, async (page) => {
      await withFailureArtifacts('MODAL-T1', page, async () => {
        const onTop = () => page.evaluate(() => document.getElementById('ui').classList.contains('is-modal'));
        assert.equal(await onTop(), false);
        await page.click('.tab', { button: 'right' });
        await page.waitForSelector('#ctxmenu:not([hidden])');
        await page.waitForFunction(() => document.getElementById('ui').classList.contains('is-modal'));
        // a click on the page area goes to the interface and closes the menu
        const c = await contentCenter(page);
        await page.mouse.click(c.x, c.y);
        await page.waitForSelector('#ctxmenu', { state: 'hidden' });
        await page.waitForFunction(() => !document.getElementById('ui').classList.contains('is-modal'));
        assert.ok((await wheelOverPage(page)) > 0);
      });
    });
  });

  it('MODAL-T2: the drawer of the narrow vertical layout', async () => {
    covers('MODAL-T2', ['SHELL-MODAL']);
    await withShellTest(
      { loadPath: '/tall', contextOptions: { viewport: { width: 420, height: 700 } }, settingsOverrides: { tabLayout: 'vertical' } },
      async (page) => {
        await withFailureArtifacts('MODAL-T2', page, async () => {
          await page.click('#tabs-btn');
          await page.waitForFunction(() => document.getElementById('ui').classList.contains('is-modal'));
          await page.mouse.click(400, 400); // on the backdrop
          await page.waitForFunction(() => !document.getElementById('ui').classList.contains('is-modal'));
          assert.ok((await wheelOverPage(page)) > 0);
        });
      }
    );
  });
});
