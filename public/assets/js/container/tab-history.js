/*
 * A tab's navigation history: the stack behind Back / Forward.
 *
 * The shell owns this stack instead of trusting the frame's session history
 * (Navigation API / history.length). Whether the browser records session
 * history for a frame depends on the window hosting the shell - in the
 * document.write()-injected about:blank window the launcher opens, every
 * document navigation of a tab's iframe replaces its single entry and entries
 * made by pushState cannot be traversed - so that history can't be relied on.
 *
 * Pure logic: no DOM, no timers.
 *
 * An entry is { url, doc, key }; two entries with the same URL stay distinct:
 *   doc  the document it belongs to. Entries made by pushState / hash links
 *        share their document's number, so a step between two entries of the
 *        same number is a same-document step (no page load needed)
 *   key  the Navigation API key of the entry, when there is one (a way to
 *        traverse natively); null otherwise
 *
 * Position: `index` is the committed (settled) entry; `target` is the entry a
 * Back / Forward is heading for while it has not settled yet. Everything the
 * interface shows (canGoBack / canGoForward) and every further Back / Forward
 * is measured from the *effective* position - the target if there is one,
 * else the index - so quick repeated presses compose instead of all aiming at
 * the same neighbour.
 *
 * Contract with the caller:
 *  - observe(url, opts) is called with the URL the frame has *settled* on (not
 *    while a navigation is pending). opts:
 *      type          'push' (default) | 'replace' | 'reload' | 'traverse'
 *                    what the browser says happened (Navigation API
 *                    navigationType; 'push' when it can't be told)
 *      sameDocument  true when no new document was loaded (pushState, hash
 *                    link, native traversal inside one document)
 *      key           the Navigation API key of the entry now current, if any
 *    - while a traversal is pending, the observation is its outcome: the index
 *      moves to the target and the target entry takes the observed URL (it may
 *      differ after redirects);
 *    - 'replace' rewrites the current entry (history.replaceState,
 *      location.replace, redirects the browser reports as replacements);
 *    - 'reload' and the same URL again change nothing but the bookkeeping;
 *    - 'traverse' without a pending traversal is a move made by someone else
 *      (the browser's own Back button, ...): the index moves to the entry that
 *      matches (key, else the nearest one with that URL) instead of a new
 *      entry being pushed;
 *    - anything else is a new entry, dropping the forward entries.
 *  - Back / forward go through beginTraversal(delta), which returns what to
 *    load. Anything that starts a different navigation first calls
 *    cancelTraversal().
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  var NONE = -1;

  /* snapshot (optional): { urls: [string], index } to start from (a duplicated tab) */
  function create(snapshot) {
    var entries = [];
    var index = NONE;
    var target = NONE;
    var docSeq = 0;

    function makeEntry(url, doc, key) {
      return { url: url, doc: doc, key: key || null };
    }

    if (snapshot && Array.isArray(snapshot.urls) && snapshot.urls.length) {
      snapshot.urls.forEach(function (u) { entries.push(makeEntry(u, ++docSeq, null)); });
      index = Math.max(0, Math.min(snapshot.index, entries.length - 1));
    }

    function effective() {
      return target !== NONE ? target : index;
    }

    /* The index of the entry a move made by someone else landed on. */
    function findLanding(url, key) {
      var i;
      if (key) {
        for (i = 0; i < entries.length; i++) if (entries[i].key === key) return i;
      }
      for (var d = 1; d < entries.length; d++) {
        if (index - d >= 0 && entries[index - d].url === url) return index - d;
        if (index + d < entries.length && entries[index + d].url === url) return index + d;
      }
      return NONE;
    }

    function push(url, sameDocument, key) {
      var doc = sameDocument && index !== NONE ? entries[index].doc : ++docSeq;
      entries.splice(index + 1);
      entries.push(makeEntry(url, doc, key));
      index = entries.length - 1;
    }

    function refreshEntry(entry, url, sameDocument, key) {
      entry.url = url;
      if (key) entry.key = key;
      if (!sameDocument) entry.doc = ++docSeq;
    }

    function observe(url, opts) {
      if (!url) return;
      opts = opts || {};
      var type = opts.type || 'push';
      var sameDocument = !!opts.sameDocument;
      var key = opts.key || null;

      if (target !== NONE) {
        index = target;
        target = NONE;
        refreshEntry(entries[index], url, sameDocument, key);
        return;
      }
      if (index === NONE) {
        push(url, false, key);
        return;
      }
      if (type === 'replace') {
        refreshEntry(entries[index], url, sameDocument, key);
        return;
      }
      if (type === 'traverse') {
        var landing = findLanding(url, key);
        if (landing !== NONE) {
          index = landing;
          refreshEntry(entries[index], url, sameDocument, key);
          return;
        }
      }
      if (type === 'reload' || entries[index].url === url) {
        refreshEntry(entries[index], entries[index].url === url ? url : entries[index].url, sameDocument, key);
        return;
      }
      push(url, sameDocument, key);
    }

    /*
     * Starts a step of `delta` entries from the effective position. Returns
     *   { index, url, key, delta, sameDocument }
     * or null when there is no such entry. `delta` is relative to the
     * committed entry (what history.go() would need); `sameDocument` is true
     * only when no other traversal is in flight and the target belongs to the
     * document that is showing now.
     */
    function beginTraversal(delta) {
      if (index === NONE) return null;
      var inFlight = target !== NONE;
      var t = effective() + delta;
      if (t < 0 || t >= entries.length) return null;
      target = t;
      return {
        index: t,
        url: entries[t].url,
        key: entries[t].key,
        delta: t - index,
        sameDocument: !inFlight && t !== index && entries[t].doc === entries[index].doc
      };
    }

    function cancelTraversal() {
      target = NONE;
    }

    return {
      observe: observe,
      beginTraversal: beginTraversal,
      cancelTraversal: cancelTraversal,
      pendingIndex: function () { return target; },
      canGoBack: function () { return effective() > 0; },
      canGoForward: function () { var e = effective(); return e !== NONE && e < entries.length - 1; },
      /* plain data, for tests and for duplicating a tab */
      snapshot: function () {
        return { urls: entries.map(function (e) { return e.url; }), index: index };
      }
    };
  }

  Y.tabHistory = { create: create };
})(window);
