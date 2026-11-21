/*
 * The object returned to a proxied page's window.open().
 *
 * A plain facade is used instead of the tab's real Window: the real one would
 * let `w.location = url` leave the proxy, because it is not hooked by
 * Ultraviolet. Location changes are routed through the shell instead, which
 * encodes them. The facade deliberately has NO `document` (and nothing else
 * that is a window, document or element of the shell or of the tab): a
 * proxied page must not get a way from the handle to the shell's DOM.
 *
 *   Y.windowHandle.isValidUrl(url)
 *   Y.createWindowHandleFactory({ tabs, guard }) -> make(tab, openerTab, requestedUrl) -> handle
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  /* Absolute http(s) URL (or about:blank) within the length limit. */
  function isValidUrl(u) {
    if (typeof u !== 'string' || u.length === 0 || u.length > C.MAX_BRIDGE_URL) return false;
    if (u === 'about:blank') return true;
    try {
      var p = new URL(u).protocol;
      return p === 'http:' || p === 'https:';
    } catch (err) {
      return false;
    }
  }

  function createWindowHandleFactory(deps) {
    var tabs = deps.tabs;
    var guard = deps.guard;

    function make(tab, openerTab, requestedUrl) {
      if (requestedUrl) guard.trustOrigin(tab, requestedUrl);
      var baseUrl = openerTab && /^https?:/i.test(openerTab.url) ? openerTab.url : null;

      function go(value) {
        var text = String(value);
        var abs = null;
        try {
          abs = new URL(text, baseUrl || (/^https?:/i.test(tab.url) ? tab.url : undefined)).href;
        } catch (err) { return; }
        if (!isValidUrl(abs)) return;
        guard.trustOrigin(tab, abs); // the opener itself chose this destination
        tabs.navigate(tab, abs);
      }

      var loc = {
        assign: go,
        replace: go,
        reload: function () { tabs.reload(tab); },
        toString: function () { return loc.href; }
      };
      Object.defineProperty(loc, 'href', {
        get: function () { return tab.kind === 'web' || tab.kind === 'blank' ? tab.url : ''; },
        set: go,
        enumerable: true
      });

      var handle = {
        focus: function () { if (!tab.closed) tabs.activate(tab.id); },
        blur: function () {},
        close: function () { if (!tab.closed) tabs.close(tab.id); },
        postMessage: function (message, targetOrigin) {
          if (tab.closed) return;
          if (!guard.mayDeliver(tab, openerTab, targetOrigin)) return; // receiver not positively allowed
          var win = Y.tabRegistry.frameWindow(tab);
          if (!win) return;
          try {
            /* The tab's iframe always lives on this app's own origin (the
               proxied site is served under /uv/service/...), so that origin
               is the only targetOrigin the browser will accept. Do NOT derive
               it from tab.url: that is the proxied site's URL, which never
               matches and makes the browser drop every message. Nor use
               location.origin: in the launcher's about:blank window it is
               "null". */
            win.postMessage(message, Y.url.appOrigin());
          } catch (err) {
            /* A message that cannot be cloned is the page's own mistake and is
               dropped, as postMessage itself would throw to the sender. Anything
               else is a bug worth seeing. */
            if (!err || err.name !== 'DataCloneError') console.warn('[Yoroxy] postMessage to a window handle failed', err);
          }
        }
      };
      var locationAccessor = { get: function () { return loc; }, set: go, enumerable: false };
      Object.defineProperty(handle, 'location', locationAccessor);
      /* Ultraviolet rewrites `w.location` in page scripts to `w.__uv$location` */
      Object.defineProperty(handle, '__uv$location', locationAccessor);
      /* ...and as `w.__uv$setSource(__uv).__uv$location`. Ultraviolet defines
         __uv$setSource on the Object.prototype of the PAGE's realm, but this
         handle is made in the container's realm, so it needs its own (it just
         returns the handle). Without it, any `w.location` of a page script that
         holds this handle throws "w.__uv$setSource is not a function". */
      Object.defineProperty(handle, '__uv$setSource', { value: function () { return handle; } });
      Object.defineProperty(handle, 'closed', { get: function () { return tab.closed; } });
      Object.defineProperty(handle, 'name', { get: function () { return tab.name || ''; } });
      Object.defineProperty(handle, 'opener', { get: function () { return null; } });
      ['top', 'parent', 'self', 'window', '__uv$top', '__uv$parent'].forEach(function (key) {
        Object.defineProperty(handle, key, { get: function () { return handle; } });
      });
      return handle;
    }

    return make;
  }

  Y.windowHandle = { isValidUrl: isValidUrl };
  Y.createWindowHandleFactory = createWindowHandleFactory;
})(window);
