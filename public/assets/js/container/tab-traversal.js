/*
 * Back / Forward for one tab: turns a step in the tab's history
 * (tab-history.js) into a navigation.
 *
 *   var traversal = Y.tabTraversal.create({ navigate, refresh, emitUpdate });
 *   traversal.traverse(tab, delta)  -> false when there is no such entry
 *   Y.tabTraversal.describeUrl(url) -> navigation descriptor that reopens a
 *                                      URL as shown in the address bar
 *
 *   navigate(tab, descriptor)   loads the descriptor in the tab
 *   refresh(tab)                re-reads the tab's state from its frame
 *   emitUpdate(tab)             tells listeners the tab changed
 *
 * Steps `delta` entries back (negative) or forward (positive). Repeated calls
 * before the first has settled compose (two quick Backs go two entries back).
 *
 * A step inside the document that is showing (an entry made by pushState or a
 * hash link) is first tried through the browser's own history, so the page
 * keeps its state; if that does not take (see nativeTraverse), or the step
 * leaves the document, the entry's URL is loaded.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  var NATIVE_TRAVERSAL_WAIT_MS = 400;

  function describeUrl(url) {
    var desc = Y.url.resolve(url, null);
    return desc.kind === 'web' ? { kind: 'web', url: url, via: 'url' } : desc;
  }

  /*
   * Tries to make the frame move to `step` through its own session history.
   * Returns false when that is not possible at all. When it is attempted but
   * does not settle (browsers and windows differ in whether entries made by
   * pushState are traversable: in the launcher's about:blank window they are
   * not), `fallback` loads the entry's URL instead.
   */
  function nativeTraverse(tab, step, fallback) {
    var win = Y.tabRegistry.frameWindow(tab);
    if (!win) return false;
    try {
      var nav = win.navigation;
      if (nav && step.key && typeof nav.traverseTo === 'function') {
        var result = nav.traverseTo(step.key);
        if (result) {
          if (result.committed && result.committed.catch) result.committed.catch(fallback);
          if (result.finished && result.finished.catch) result.finished.catch(fallback);
        }
      } else if (step.delta && win.history && typeof win.history.go === 'function') {
        win.history.go(step.delta);
      } else {
        return false;
      }
    } catch (err) {
      return false;
    }
    setTimeout(fallback, NATIVE_TRAVERSAL_WAIT_MS);
    return true;
  }

  function create(deps) {
    function traverse(tab, delta) {
      if (tab.closed) return false;
      var step = tab.history.beginTraversal(delta);
      if (!step) return false;
      var desc = describeUrl(step.url);
      if (desc.kind === 'none') {
        tab.history.cancelTraversal();
        return false;
      }
      function load() {
        if (tab.closed || tab.history.pendingIndex() !== step.index) return; // settled or superseded
        deps.navigate(tab, desc);
      }
      if (step.sameDocument && nativeTraverse(tab, step, load)) {
        deps.refresh(tab);
        deps.emitUpdate(tab);
        return true;
      }
      load();
      return true;
    }

    return { traverse: traverse };
  }

  Y.tabTraversal = { create: create, describeUrl: describeUrl };
})(window);
