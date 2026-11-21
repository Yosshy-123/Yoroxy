/*
 * Keeps a tab's displayed fields (kind / url / title / back-forward state)
 * in sync with its iframe, and polls to catch changes that fire no event
 * (document.title edits - and, in browsers without a Navigation API,
 * pushState / hashchange).
 *
 * refresh() only reads: the tab's history is written by recordNavigation(),
 * which the tab manager calls from the frame's load and navigation events.
 * Back / forward availability comes from the history's effective position
 * alone (see tab-history.js), never from the loading state.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var INTERNAL_TITLES = Y.tabModel.INTERNAL_TITLES;

  /* Recomputes the displayed fields from the iframe. Returns true if changed. */
  function refresh(tab) {
    var win, href;
    try {
      win = tab.iframe.contentWindow;
      href = win.location.href;
    } catch (err) {
      return false;
    }

    var kind, url, title, internalName = null;

    if (tab.loading && Date.now() - tab.loadStarted > C.LOADING_TIMEOUT_MS) {
      tab.loading = false;
      tab.pending = null;
      tab.history.cancelTraversal();
    }

    if (tab.pending) {
      kind = tab.pendingKind;
      url = tab.pending;
      title = tab.pendingTitle;
      internalName = tab.pendingInternal;
    } else {
      var loc = Y.url.fromLocation(href);
      kind = loc.kind;
      url = loc.url;
      if (kind === 'internal') {
        internalName = loc.name;
        title = INTERNAL_TITLES[loc.name] || 'Untitled';
      } else if (kind === 'blank') {
        title = 'Untitled';
      } else {
        var doc = '';
        try { doc = (win.document.title || '').trim(); } catch (err) { /* ignore */ }
        // Page titles come from the proxied site: cap them.
        title = Y.text.truncate(doc, C.MAX_TAB_TITLE) || (tab.loading ? 'Loading…' : (Y.url.hostOf(url) || 'Untitled'));
      }
    }

    var canBack = tab.history.canGoBack();
    var canForward = tab.history.canGoForward();

    var changed = tab.kind !== kind || tab.url !== url || tab.title !== title ||
      tab.internalName !== internalName || tab.canGoBack !== canBack ||
      tab.canGoForward !== canForward;
    tab.kind = kind;
    tab.url = url;
    tab.title = title;
    tab.internalName = internalName;
    tab.canGoBack = canBack;
    tab.canGoForward = canForward;
    return changed;
  }

  /* The Navigation API key of the entry the frame is on, or null. */
  function currentKey(win) {
    try {
      var nav = win.navigation;
      return nav && nav.currentEntry ? nav.currentEntry.key || null : null;
    } catch (err) {
      return null;
    }
  }

  /*
   * What the browser says a just-loaded document replaced or pushed, when that
   * can be believed. In a window that records no session history for the frame
   * (the about:blank window the launcher opens) every load is reported as a
   * 'replace' and the frame has a single entry, so nothing is believed there:
   * undefined means "treat it as a new entry".
   */
  function loadType(win) {
    try {
      var nav = win.navigation;
      if (!nav || !nav.activation || nav.entries().length < 2) return undefined;
      var type = nav.activation.navigationType;
      return type === 'replace' || type === 'reload' || type === 'traverse' ? type : undefined;
    } catch (err) {
      return undefined;
    }
  }

  /*
   * Feeds the URL the frame has settled on to the tab's history. Does
   * nothing while a navigation is pending or the page is loading - the load
   * event records the final URL.
   *
   *   source  'load'  a document was loaded (load event): a new document
   *           'event' the Navigation API reported a same-document change;
   *                   `type` is its navigationType
   *           'poll'  the poller saw the URL change without a load (no
   *                   Navigation API): a same-document change
   *
   * See tab-history.js for what each type does to the stack.
   */
  function recordNavigation(tab, type, source) {
    if (tab.pending || tab.loading) return;
    var win, href;
    try {
      win = tab.iframe.contentWindow;
      href = win.location.href;
    } catch (err) { return; }
    var url = Y.url.fromLocation(href).url;
    var sameDocument = source === 'event' || source === 'poll';
    tab.history.observe(url, {
      type: source === 'load' && type === undefined ? loadType(win) : type,
      sameDocument: sameDocument,
      key: currentKey(win)
    });
  }

  /*
   * Starts the poll. The active tab is refreshed every SYNC_ACTIVE_MS, the
   * others every SYNC_BACKGROUND_MS. `onChanged(tab)` runs when a refresh
   * changed something. Returns the interval id (pass to clearInterval).
   */
  function startSyncPoller(getTabs, getActiveId, onChanged) {
    var tickCount = 0;
    var ratio = Math.max(1, Math.round(C.SYNC_BACKGROUND_MS / C.SYNC_ACTIVE_MS));
    return setInterval(function () {
      if (document.hidden) return;
      tickCount++;
      var background = tickCount % ratio === 0;
      var activeId = getActiveId();
      getTabs().forEach(function (tab) {
        if (tab.id !== activeId && !background) return;
        if (!tab.navigationEvents) recordNavigation(tab, undefined, 'poll');
        if (refresh(tab)) onChanged(tab);
      });
    }, C.SYNC_ACTIVE_MS);
  }

  Y.tabSyncPoller = {
    refresh: refresh,
    recordNavigation: recordNavigation,
    startSyncPoller: startSyncPoller
  };
})(window);
