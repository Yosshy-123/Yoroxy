/*
 * TabManager: owns the tabs and their <iframe>s.
 *
 * - Every tab is a same-origin iframe inside #content. Inactive tabs stay
 *   alive (hidden with visibility, never display:none).
 * - The displayed URL / title / favicon / loading state of a tab is derived
 *   from the iframe's real location (all frames are same-origin).
 * - Navigations are described by descriptors from Yoroxy.url.resolve()
 *   (or a plain real URL string, or 'about:blank').
 *
 * Events: 'tabs' (list changed), 'active' (active tab changed),
 *         'update' (tab fields changed), 'limit' (MAX_TABS reached).
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  var Model = Y.tabModel;
  var Nav = Y.tabNavigation;
  var Favicon = Y.tabFavicon;
  var Poller = Y.tabSyncPoller;

  /*
   * opts: { content: HTMLElement, registerSW: () => Promise }
   */
  function createTabManager(opts) {
    var content = opts.content;
    var registry = Y.tabRegistry.create();
    var tabs = registry.list(); // the live array, in tab-bar order
    var activeId = null;
    var seq = 0;
    var navSeq = 0;
    var handlers = {};
    var sw = { ready: false, promise: null };

    /* ---------------------------------------------------------- events */
    function on(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    }
    function emit(type, payload) {
      (handlers[type] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (err) { console.error('[Yoroxy] handler failed', err); }
      });
    }

    /* ------------------------------------------------------ service worker */
    function ensureSW() {
      if (sw.ready) return Promise.resolve();
      if (!sw.promise) {
        sw.promise = opts.registerSW().then(function () {
          sw.ready = true;
        }, function (err) {
          sw.promise = null;
          throw err;
        });
      }
      return sw.promise;
    }

    /* ----------------------------------------------------------- lookups */
    var indexOf = registry.indexOf;
    var find = registry.find;
    var findByName = registry.findByName;
    var findInternal = registry.findInternal;
    var tabForWindow = registry.tabForWindow;
    var frameWindow = Y.tabRegistry.frameWindow;

    function getActive() {
      return find(activeId);
    }

    /* ---------------------------------------------------------- creating */
    /*
     * o: { target, active = true, openerId, origin = 'user', name, index, history }
     *   history: a tab history snapshot to start from (duplicate)
     * Returns the tab, or null when MAX_TABS is reached.
     */
    function createTab(o) {
      o = o || {};
      if (tabs.length >= C.MAX_TABS) {
        emit('limit');
        return null;
      }
      var id = 'tab-' + (++seq);

      var iframe = document.createElement('iframe');
      iframe.className = 'tab-frame';
      iframe.name = 'yoroxy-' + id;
      iframe.title = 'Tab content';
      /* Deliberately not sandboxed: same-origin access is required. */
      iframe.setAttribute('allow', 'fullscreen; autoplay; clipboard-write; picture-in-picture');
      iframe.setAttribute('data-tab-id', id);

      var tab = Model.createTabRecord({ id: id, iframe: iframe, openerId: o.openerId, origin: o.origin, name: o.name });
      if (o.history) tab.history = Y.tabHistory.create(o.history); // a duplicate starts with its source's entries

      registry.insert(tab, o);

      iframe.addEventListener('load', function () { onLoad(tab); });
      content.appendChild(iframe);

      emit('tabs');
      navigate(tab, o.target || { kind: 'internal', name: 'newtab' });
      if (o.active !== false) activate(id);
      return tab;
    }

    /* -------------------------------------------------------- navigating */
    var navCtx = {
      nextToken: function () { return ++navSeq; },
      isSWReady: function () { return sw.ready; },
      ensureSW: ensureSW,
      refresh: function (tab) { return Poller.refresh(tab); },
      emit: emit
    };

    function navigate(tab, target) {
      tab.replaceNext = false;
      tab.history.cancelTraversal();
      Nav.navigate(tab, target, navCtx);
    }

    function onFaviconChange(tab) {
      emit('update', tab);
    }

    /* ---------------------------------------------------------- syncing */
    function onLoad(tab) {
      if (tab.closed) return;
      var win = null;
      var href = '';
      try {
        win = tab.iframe.contentWindow;
        href = win.location.href;
      } catch (err) { /* ignore */ }

      /* the initial about:blank load that precedes our first navigation */
      if (tab.awaiting && href === 'about:blank' && !tab.wantBlank) return;

      /* A load the shell itself started (address bar, Back / Forward, ...) is the
       * entry that navigation was for, even if the page then redirected itself
       * with location.replace before the load event: the browser calls that a
       * replacement, but of an entry the shell has not recorded yet. Only a
       * load the page started on its own is believed when it says "replace". */
      var startedByShell = !!tab.pending;
      /* The page said its next load replaces it (a meta refresh, see
       * uv.handler.js): in a window that records no session history the
       * browser cannot tell. */
      var replaceAsked = tab.replaceNext;
      tab.replaceNext = false;

      tab.awaiting = false;
      tab.wantBlank = false;
      tab.loading = false;
      tab.pending = null;

      if (win) {
        try {
          win.addEventListener('pagehide', function () {
            if (tab.closed) return;
            tab.loading = true;
            tab.loadStarted = Date.now();
            emit('update', tab);
          });
        } catch (err) { /* ignore */ }
        watchNavigation(tab, win);
      }

      Poller.recordNavigation(tab, startedByShell ? 'push' : (replaceAsked ? 'replace' : undefined), 'load');
      Poller.refresh(tab);
      Favicon.updateFaviconWithRetry(tab, onFaviconChange);
      emit('update', tab);
    }

    /* Same-document navigations (pushState, replaceState, hash links) fire no
     * load event; the document's Navigation API reports them. It is
     * per-document, so this runs again for every load. Without a Navigation
     * API the poller records them instead (tab.navigationEvents). */
    function watchNavigation(tab, win) {
      var nav = null;
      try { nav = win.navigation; } catch (err) { /* ignore */ }
      tab.navigationEvents = !!(nav && nav.addEventListener);
      if (!tab.navigationEvents) return;
      nav.addEventListener('currententrychange', function (event) {
        if (tab.closed) return;
        Poller.recordNavigation(tab, event.navigationType, 'event');
        if (Poller.refresh(tab)) emit('update', tab);
      });
    }

    var pollerTimer = Poller.startSyncPoller(
      function () { return tabs; },
      function () { return activeId; },
      function (tab) { emit('update', tab); }
    );

    /* --------------------------------------------------------- operations */
    function activate(id) {
      var tab = find(id);
      if (!tab) return;
      activeId = id;
      tabs.forEach(function (t) {
        t.iframe.classList.toggle('is-active', t.id === id);
      });
      Poller.refresh(tab);
      emit('active', tab);
    }

    function close(id) {
      var tab = find(id);
      if (!tab) return;
      var wasActive = tab.id === activeId;
      var i = registry.remove(id);
      tab.closed = true;
      try { tab.iframe.src = 'about:blank'; } catch (err) { /* ignore */ }
      if (tab.iframe.parentNode) tab.iframe.parentNode.removeChild(tab.iframe);

      if (tabs.length === 0) {
        activeId = null;
        createTab({ target: { kind: 'internal', name: 'newtab' }, active: true, origin: 'user' });
        return;
      }
      emit('tabs');
      if (wasActive) activate(tabs[Math.min(i, tabs.length - 1)].id);
    }

    function move(id, toIndex) {
      if (registry.move(id, toIndex)) emit('tabs');
    }

    function duplicate(id) {
      var src = find(id);
      if (!src) return null;
      var desc = Y.tabTraversal.describeUrl(src.url);
      if (desc.kind === 'none') desc = { kind: 'internal', name: 'newtab' };
      return createTab({ target: desc, active: true, origin: 'user', index: indexOf(id) + 1, history: src.history.snapshot() });
    }

    function closeOthers(id) {
      tabs.slice().forEach(function (t) { if (t.id !== id) close(t.id); });
      if (find(id)) activate(id);
    }

    function closeAfter(id) {
      var i = indexOf(id);
      if (i === -1) return;
      tabs.slice(i + 1).forEach(function (t) { close(t.id); });
    }

    function reload(tab) {
      var win = frameWindow(tab);
      if (!win) return;
      tab.loading = true;
      tab.loadStarted = Date.now();
      try {
        win.location.reload();
      } catch (err) { /* the frame went away while closing: nothing to reload */ }
      emit('update', tab);
    }

    function stop(tab) {
      var win = frameWindow(tab);
      try { if (win) win.stop(); } catch (err) { /* ignore */ }
      tab.loading = false;
      tab.pending = null;
      tab.awaiting = false;
      tab.history.cancelTraversal();
      Poller.refresh(tab);
      emit('update', tab);
    }

    var traversal = Y.tabTraversal.create({
      navigate: function (tab, desc) { Nav.navigate(tab, desc, navCtx); },
      refresh: function (tab) { return Poller.refresh(tab); },
      emitUpdate: function (tab) { emit('update', tab); }
    });
    var traverse = traversal.traverse;

    return {
      on: on,
      ensureSW: ensureSW,
      createTab: createTab,
      navigate: navigate,
      activate: activate,
      close: close,
      move: move,
      duplicate: duplicate,
      closeOthers: closeOthers,
      closeAfter: closeAfter,
      reload: reload,
      stop: stop,
      back: function (tab) { traverse(tab, -1); },
      forward: function (tab) { traverse(tab, 1); },
      go: traverse,
      replaceNext: function (tab) { if (tab && !tab.closed) tab.replaceNext = true; },
      find: find,
      indexOf: indexOf,
      getTabs: function () { return tabs.slice(); },
      getActive: getActive,
      findByName: findByName,
      findInternal: findInternal,
      tabForWindow: tabForWindow,
      /* Stops the background poller. The tabs themselves are left as they are
       * (close them first if they should go): for a manager that is discarded,
       * such as in a test, so its interval does not keep running. */
      destroy: function () { clearInterval(pollerTimer); }
    };
  }

  Y.createTabManager = createTabManager;
})(window);
