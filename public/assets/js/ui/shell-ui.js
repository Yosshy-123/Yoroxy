/*
 * The browser interface (shell-ui.html): tab bar, toolbar, context menu,
 * toasts, keyboard shortcuts. It runs in a sandboxed iframe with an opaque
 * origin and holds no tabs and no logic about them: it shows the state the
 * container sends (ui-channel.js) and reports what the user does.
 *
 * It also reports where it is on screen. The container puts the tab pages
 * above this document, exactly over the empty #content slot, so it sends
 *   content  the rectangle of the #content slot (where the pages go)
 *   modal    whether this document must cover the pages right now (a context
 *            menu or the drawer backdrop is shown over the slot)
 * whenever they change. Toasts are not overlays: they are a bar in the layout
 * (above the slot), so the slot simply gets smaller while one is shown.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var root = document.documentElement;

  function $(id) {
    return document.getElementById(id);
  }

  var tabsView = []; // last list of tab views from the container
  var activeId = null;
  var layoutKnown = false;

  /* ------------------------------------------------------ the channel */

  var channel = Y.uiChannel.createUiEnd({
    handlers: {
      'ui:layout': applyLayout,
      'ui:tabs': function (m) { setTabs(m, false); },
      'ui:active': function (m) { setTabs(m, true); },
      'ui:update': updateTab,
      'ui:toast': showToast,
      'ui:focusAddress': function () { closeDrawer(); toolbar.focusAddress(); },
      'ui:closeDrawer': closeDrawer
    }
  });

  function send(type, fields) {
    var msg = fields || {};
    msg.type = type;
    channel.send(msg);
  }

  /* ----------------------------------------------------------- wiring */

  var tabBar = Y.ui.createTabBar($('tablist'), {
    onActivate: function (id) {
      send('ui:activate', { id: id });
      closeDrawer();
    },
    onClose: function (id) { send('ui:close', { id: id }); },
    onNew: function () { closeDrawer(); send('ui:new'); },
    onMove: function (id, index) { send('ui:move', { id: id, index: index }); },
    onContext: function (id, x, y) { openContextMenu(id, x, y); }
  });

  var toolbar = Y.createToolbar({
    back: $('back-btn'),
    forward: $('forward-btn'),
    reload: $('reload-btn'),
    home: $('home-btn'),
    settings: $('settings-btn'),
    tabs: $('tabs-btn'),
    tabCount: $('tab-count'),
    form: $('address-form'),
    input: $('address'),
    main: $('main')
  }, {
    onBack: function () { send('ui:back'); },
    onForward: function () { send('ui:forward'); },
    onReload: function () { send('ui:reload'); },
    onStop: function () { send('ui:stop'); },
    onHome: function () { send('ui:home'); },
    onSettings: function () { closeDrawer(); send('ui:settings'); },
    onTabsToggle: function () { toggleDrawer(); },
    onSubmit: function (text, opts) {
      if (text.length > C.MAX_BRIDGE_URL) return; // too long to be an address
      send('ui:submit', { text: text, newTab: !!(opts && opts.newTab) });
    }
  });

  $('new-tab-btn').addEventListener('click', function () { closeDrawer(); send('ui:new'); });
  $('drawer-backdrop').addEventListener('click', closeDrawer);

  Y.installShortcuts({
    newTab: function () { closeDrawer(); send('ui:new'); },
    closeActive: function () { if (activeId) send('ui:close', { id: activeId }); },
    focusAddress: function () { toolbar.focusAddress(); },
    closeDrawer: closeDrawer,
    activateAt: function (n) {
      var target = n === 9 ? tabsView[tabsView.length - 1] : tabsView[n - 1];
      if (target) send('ui:activate', { id: target.id });
    }
  });

  /* ------------------------------------------------------------ drawer */

  function toggleDrawer() {
    if (root.hasAttribute('data-drawer-open')) root.removeAttribute('data-drawer-open');
    else root.setAttribute('data-drawer-open', '');
  }

  function closeDrawer() {
    root.removeAttribute('data-drawer-open');
  }

  /* ---------------------------------------------------- state from the container */

  function applyLayout(m) {
    root.setAttribute('data-tab-layout', m.layout);
    $('tablist').setAttribute('aria-orientation', m.layout === 'vertical' ? 'vertical' : 'horizontal');
    tabBar.setLayout(m.layout);
    if (m.layout !== 'vertical') closeDrawer();
    layoutKnown = true;
    scheduleReport();
  }

  function syncToolbar(tab, force) {
    toolbar.setUrl(tab.address, force);
    toolbar.setNav(tab);
    toolbar.setLoading(tab.loading);
  }

  function activeTab() {
    for (var i = 0; i < tabsView.length; i++) if (tabsView[i].id === activeId) return tabsView[i];
    return null;
  }

  function setTabs(m, activated) {
    tabsView = m.tabs;
    activeId = m.activeId;
    tabBar.render(tabsView, activeId);
    toolbar.setTabCount(tabsView.length);
    var active = activeTab();
    if (activated && active) syncToolbar(active, true);
  }

  function updateTab(m) {
    for (var i = 0; i < tabsView.length; i++) {
      if (tabsView[i].id === m.tab.id) tabsView[i] = m.tab;
    }
    activeId = m.activeId;
    tabBar.updateTab(m.tab, activeId);
    if (m.tab.id === activeId) syncToolbar(m.tab, false);
  }

  function showToast(m) {
    Y.ui.toast({
      message: m.message,
      actionLabel: m.actionLabel || undefined,
      timeout: m.timeout || undefined,
      onAction: m.actionLabel ? function () { send('ui:toastAction', { id: m.id }); } : undefined,
      /* however it went (closed, expired, acted on, pushed out): let the container forget it */
      onClose: function () { send('ui:toastDismiss', { id: m.id }); }
    });
  }

  /* ------------------------------------------------------ context menu */

  function openContextMenu(id, x, y) {
    var index = -1;
    for (var i = 0; i < tabsView.length; i++) if (tabsView[i].id === id) index = i;
    if (index === -1) return;
    var vertical = root.getAttribute('data-tab-layout') === 'vertical';
    function act(action) { return function () { send('ui:context', { id: id, action: action }); }; }
    Y.ui.showContextMenu(x, y, [
      { label: 'Reload', action: act('reload') },
      { label: 'Duplicate', action: act('duplicate') },
      { label: 'Close tab', action: act('close') },
      { label: 'Close other tabs', disabled: tabsView.length < 2, action: act('closeOthers') },
      {
        label: vertical ? 'Close tabs below' : 'Close tabs to the right',
        disabled: index === tabsView.length - 1,
        action: act('closeAfter')
      }
    ]);
  }

  /* --------------------------------------------- where we are on screen */

  var lastReport = '';
  var frameRequested = false;

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left * 100) / 100,
      y: Math.round(r.top * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100
    };
  }

  function visible(el) {
    return !el.hidden && global.getComputedStyle(el).display !== 'none';
  }

  function report() {
    frameRequested = false;
    if (!layoutKnown) return;
    var modal = visible($('ctxmenu')) || visible($('drawer-backdrop'));
    var content = rectOf($('content'));
    var key = JSON.stringify([content, modal]);
    if (key === lastReport) return;
    lastReport = key;
    send('ui:geometry', { content: content, modal: modal });
  }

  function scheduleReport() {
    if (frameRequested) return;
    frameRequested = true;
    global.requestAnimationFrame(report);
  }

  if (global.ResizeObserver) {
    var resizeObserver = new global.ResizeObserver(scheduleReport);
    resizeObserver.observe($('content'));
    resizeObserver.observe(root);
  }
  new global.MutationObserver(scheduleReport).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'style', 'class', 'data-drawer-open', 'data-tab-layout']
  });
  new global.MutationObserver(scheduleReport).observe(root, { attributes: true });
  global.addEventListener('resize', scheduleReport);

  /* ---------------------------------------------------------------- boot */

  root.style.setProperty('--vtab-w', C.VERTICAL_TAB_WIDTH + 'px');
  Y.icons.hydrate(document);
  send('ui:ready');
})(window);
