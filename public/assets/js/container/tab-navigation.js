/*
 * Navigation of a single tab: turning a target into a displayed state and
 * loading it into the tab's iframe.
 *
 * Everything stateful is injected through `ctx`, so this module never reaches
 * into the tab manager:
 *   ctx = {
 *     nextToken():    () => number   next navigation token (race control)
 *     isSWReady():    () => boolean
 *     ensureSW():     () => Promise  resolves once the service worker is active
 *     refresh(tab):   recompute displayed fields from the iframe
 *     emit(type, payload)
 *   }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var INTERNAL_TITLES = Y.tabModel.INTERNAL_TITLES;

  function displayFor(desc) {
    switch (desc.kind) {
      case 'internal':
        return { kind: 'internal', url: 'yoroxy://' + desc.name + (desc.hash || ''), title: INTERNAL_TITLES[desc.name] };
      case 'error':
        return { kind: 'internal', url: 'yoroxy://error', title: INTERNAL_TITLES.error };
      case 'blank':
        return { kind: 'blank', url: 'about:blank', title: 'Untitled' };
      default:
        return { kind: 'web', url: desc.url, title: 'Loading…' };
    }
  }

  /* True when navigating to `absUrl` only changes the fragment of the
   * current document: the browser then fires no load event. */
  function isFragmentNavigation(win, absUrl) {
    try {
      var cur = new URL(win.location.href);
      var next = new URL(absUrl);
      return next.hash !== '' && cur.origin === next.origin &&
        cur.pathname === next.pathname && cur.search === next.search;
    } catch (err) {
      return false;
    }
  }

  /* Returns true when the navigation was a same-document (fragment) one. */
  function load(tab, absUrl) {
    var frame = tab.iframe;
    var win = null;
    try { win = frame.contentWindow; } catch (err) { /* ignore */ }
    var fresh = true;
    try { fresh = !win || win.location.href === 'about:blank'; } catch (err) { fresh = false; }
    if (!fresh && win) {
      var fragment = isFragmentNavigation(win, absUrl);
      try {
        win.location.assign(absUrl);
        return fragment;
      } catch (err) { /* fall back to src */ }
    }
    frame.src = absUrl;
    return false;
  }

  function normalize(target) {
    if (typeof target === 'string') {
      return target === 'about:blank' ? { kind: 'blank' } : { kind: 'web', url: target, via: 'url' };
    }
    return target;
  }

  function navigate(tab, target, ctx) {
    var desc = normalize(target);
    if (!desc || desc.kind === 'none' || tab.closed) return;

    var disp = displayFor(desc);
    var token = ctx.nextToken();
    tab.navToken = token;
    tab.awaiting = true;
    tab.wantBlank = desc.kind === 'blank';
    tab.loading = true;
    tab.loadStarted = Date.now();
    tab.pending = disp.url;
    tab.pendingKind = disp.kind;
    tab.pendingTitle = disp.title;
    tab.pendingInternal = disp.kind === 'internal' ? (desc.kind === 'error' ? 'error' : desc.name) : null;

    if (desc.kind === 'internal' || desc.kind === 'error') {
      if (load(tab, Y.url.abs(Y.url.internalPath(desc)))) {
        /* same-document navigation: no load event will follow */
        tab.awaiting = false;
        tab.loading = false;
        tab.pending = null;
      }
    } else if (desc.kind === 'blank') {
      load(tab, 'about:blank');
    } else if (ctx.isSWReady()) {
      load(tab, Y.url.abs(Y.url.encodeProxy(desc.url)));
    } else {
      ctx.ensureSW().then(function () {
        if (tab.closed || tab.navToken !== token) return;
        load(tab, Y.url.abs(Y.url.encodeProxy(desc.url)));
      }, function () {
        if (tab.closed || tab.navToken !== token) return;
        navigate(tab, { kind: 'error', type: 'sw-failed', url: desc.url }, ctx);
      });
    }
    ctx.refresh(tab);
    ctx.emit('update', tab);
  }

  Y.tabNavigation = { navigate: navigate };
})(window);
