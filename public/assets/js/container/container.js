/*
 * The container (container.html): the thin, logic-bearing half of the browser
 * shell. It owns the tabs (their iframes, history, state) and the two bridges
 * of the tab pages, and it drives the browser interface, which lives in a
 * sandboxed iframe (shell-ui.html) and is reached only through the
 * validated messages of ui-channel.js:
 *
 *   to the interface    tab state, layout, toasts, focus requests
 *   from the interface  what the user did (new tab, switch, close, type an
 *                       address...) and where the interface is on screen
 *
 * The interface fills the whole window. The tab pages (#content) sit ABOVE it,
 * exactly over the hole the interface leaves, so that the hole is hit-tested,
 * scrolled and painted by the tab page and not by the interface frame. (A
 * clip-path on the interface frame is not an option: with a clip that is not a
 * single rectangle, Chromium no longer delivers wheel scrolling to the page
 * underneath.) Where the hole is, and whether the interface currently needs to
 * be on top of the pages (a context menu or the drawer is open: "modal"), is
 * what the interface reports ("ui:geometry").
 *
 * This file runs either in a real /container.html document or inside an
 * about:blank window (see index.html). Do not use location.origin or
 * location.reload() here.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  function $(id) {
    return document.getElementById(id);
  }

  /* ------------------------------------------------------------- wiring */

  var tabs = Y.createTabManager({ content: $('content'), registerSW: Y.containerSw.register });
  var uiFrame = $('ui');

  /* ---- to the interface: views of tabs (what the tab bar and toolbar need) ---- */

  var viewOf = Y.tabView.viewOf;

  function activeId() {
    var active = tabs.getActive();
    return active ? active.id : null;
  }

  function sendTabs(type) {
    channel.send({ type: type, tabs: tabs.getTabs().map(viewOf), activeId: activeId() });
  }

  /* ---- toasts: shown by the interface; an action comes back as a message ---- */

  var toasts = Y.toastRegistry.create(function (msg) { channel.send(msg); });
  var toast = toasts.toast;

  /* ---- actions the interface asks for ---- */

  function focusContent(tab) {
    if (!tab) return;
    try { tab.iframe.focus(); } catch (err) { /* ignore */ }
  }

  function submitText(text, tab, newTab) {
    var desc = Y.url.resolve(text, Y.settings.load());
    if (desc.kind === 'none') return;
    if (newTab) {
      tabs.createTab({ target: desc, active: true, origin: 'user', index: tabs.indexOf(tab.id) + 1 });
    } else {
      tabs.navigate(tab, desc);
    }
    focusContent(tabs.getActive());
  }

  function focusAddress() {
    try { uiFrame.focus(); } catch (err) { /* ignore */ }
    channel.send({ type: 'ui:focusAddress' });
  }

  function newTab() {
    var tab = tabs.createTab({ target: { kind: 'internal', name: 'newtab' }, active: true, origin: 'user' });
    if (tab) focusAddress();
  }

  function openSettings() {
    var existing = tabs.findInternal('settings');
    if (existing) tabs.activate(existing.id);
    else tabs.createTab({ target: { kind: 'internal', name: 'settings' }, active: true, origin: 'user' });
  }

  function withActive(fn) {
    var active = tabs.getActive();
    if (active) fn(active);
  }

  function contextAction(id, action) {
    var tab = tabs.find(id);
    if (!tab) return;
    if (action === 'reload') tabs.reload(tab);
    else if (action === 'duplicate') tabs.duplicate(id);
    else if (action === 'close') tabs.close(id);
    else if (action === 'closeOthers') tabs.closeOthers(id);
    else if (action === 'closeAfter') tabs.closeAfter(id);
  }

  /* ---- where the interface is: place the tab pages, stack the interface ---- */

  var firstGeometry = null; // resolved when the interface has told us where the hole is

  function px(n) {
    return Math.round(n * 100) / 100 + 'px';
  }

  /*
   * The tab pages are placed over the hole. The interface frame is underneath
   * them (never clipped) except while it is "modal": then it is put on top,
   * unclipped, and the pages cannot be reached until the menu / drawer closes.
   */
  function applyGeometry(geometry) {
    var c = geometry.content;

    var content = $('content');
    content.style.left = px(c.x);
    content.style.top = px(c.y);
    content.style.width = px(c.w);
    content.style.height = px(c.h);

    uiFrame.classList.toggle('is-modal', !!geometry.modal);
    if (firstGeometry) {
      var resolve = firstGeometry;
      firstGeometry = null;
      resolve();
    }
  }

  /* ---- the channel ---- */

  var channel = Y.uiChannel.createContainerEnd({
    frame: uiFrame,
    handlers: {
      'ui:ready': function () { sendLayout(); sendTabs('ui:active'); },
      'ui:geometry': applyGeometry,
      'ui:new': newTab,
      'ui:activate': function (m) { if (tabs.find(m.id)) tabs.activate(m.id); },
      'ui:close': function (m) { if (tabs.find(m.id)) tabs.close(m.id); },
      'ui:move': function (m) { if (tabs.find(m.id)) tabs.move(m.id, Math.min(m.index, tabs.getTabs().length - 1)); },
      'ui:context': function (m) { contextAction(m.id, m.action); },
      'ui:back': function () { withActive(tabs.back); },
      'ui:forward': function () { withActive(tabs.forward); },
      'ui:reload': function () { withActive(tabs.reload); },
      'ui:stop': function () { withActive(tabs.stop); },
      'ui:home': function () { withActive(function (t) { tabs.navigate(t, { kind: 'internal', name: 'newtab' }); }); },
      'ui:settings': openSettings,
      'ui:submit': function (m) { withActive(function (t) { submitText(m.text, t, m.newTab); }); },
      'ui:toastAction': function (m) { toasts.onAction(m.id); },
      /* A toast is gone (closed, expired, acted on): drop its action. */
      'ui:toastDismiss': function (m) { toasts.onDismiss(m.id); }
    }
  });

  /* Only now, with the listener in place (see container.html). */
  uiFrame.src = Y.url.abs('/shell-ui.html');

  /* ------------------------------------------------------------ settings */

  function sendLayout() {
    channel.send({ type: 'ui:layout', layout: Y.settings.load().tabLayout });
  }

  Y.settings.onChange(sendLayout); // storage events from other windows

  /* ------------------------------------------------------------ tab events */

  tabs.on('tabs', function () { sendTabs('ui:tabs'); });
  tabs.on('active', function () { sendTabs('ui:active'); });
  tabs.on('update', function (tab) {
    if (tab.closed) return;
    channel.send({ type: 'ui:update', tab: viewOf(tab), activeId: activeId() });
  });
  tabs.on('limit', function () {
    toast({ message: 'Tab limit reached (' + C.MAX_TABS + '). Close a tab to open a new one.' });
  });

  /* --------------------------------------------------------------- bridge */

  /* For proxied pages (called by the patched Ultraviolet handler through
   * window.top): tab requests only. Read-only, so a page cannot swap it. */
  Object.defineProperty(global, '__yoroxyShell', {
    value: Y.createBridgeProxy({ tabs: tabs, toast: toast }),
    writable: false,
    configurable: false,
    enumerable: false
  });

  /* For the New Tab / Error / Settings pages: validated postMessage requests. */
  Y.createBridgeInternal({
    tabs: tabs,
    submitText: function (text, tab) { submitText(text, tab, false); },
    newTab: newTab,
    settingsChanged: sendLayout
  });

  /* ---------------------------------------------------------------- boot */

  /* Test hook: boot-seal.js removes the whole Yoroxy namespace (this included)
   * once the page has started, unless the page was served in test mode. */
  Y.shell = { tabs: tabs };

  tabs.ensureSW().catch(function () { /* surfaced as an error page on first navigation */ });

  /* The first tab is created once the interface has said where the pages go,
   * so that it loads at its real size. */
  new Promise(function (resolve) { firstGeometry = resolve; }).then(function () {
    tabs.createTab({ target: { kind: 'internal', name: 'newtab' }, active: true, origin: 'user' });
    focusAddress();
  });
})(window);
