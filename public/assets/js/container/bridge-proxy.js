/*
 * The API proxied pages use to ask the shell for tabs: window.__yoroxyShell.
 *
 * The (patched) Ultraviolet handler calls it synchronously through
 * window.top, because window.open() has to return a value. Everything that
 * crosses it is validated: the callers are proxied web pages. It holds the
 * proxied-page-facing functions and nothing else (the New Tab / Error /
 * Settings pages use postMessage instead, see bridge-internal.js).
 *
 *   openTab({ url, active, name, opener, noopener, userActivated, source })
 *       -> { blocked: boolean, window: WindowHandle | null }
 *   closeTabOf(win)               -> boolean
 *   traverse(win, delta)          -> boolean   history.back/forward/go of a tab's page
 *   replaceNext(win)              -> boolean   the page's next load replaces it (meta refresh)
 *   prepareFormTarget(options)    -> { frameName, tabId } | null
 *
 * Nothing returned contains a Window, Document or Element of the shell.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  var RESERVED_NAMES = { '': 1, '_blank': 1, '_self': 1, '_top': 1, '_parent': 1 };

  /* What the browser says about user activation in the shell window itself:
   * true / false, or null when navigator.userActivation does not exist. */
  function browserActivation() {
    var ua = global.navigator && global.navigator.userActivation;
    return ua ? ua.isActive === true : null;
  }

  /*
   * deps: { tabs, activation?, toast?(options) }
   *   activation: () => true | false | null  (replaceable for tests)
   */
  function createBridgeProxy(deps) {
    var tabs = deps.tabs;
    var activation = deps.activation || browserActivation;
    var toast = deps.toast || function () {};
    var guard = Y.createPostMessageGuard({ tabs: tabs });
    var makeHandle = Y.createWindowHandleFactory({ tabs: tabs, guard: guard });
    var isValidUrl = Y.windowHandle.isValidUrl;
    var orphanTimes = []; // rate-limit bucket for callers without a known tab

    function normalizeName(name) {
      if (typeof name !== 'string') return null;
      var n = name.trim();
      if (RESERVED_NAMES[n.toLowerCase()] || n.length > 200) return null;
      return n;
    }

    /*
     * Pop-up gate for script-initiated tabs (links clicked by the user never
     * pass through here). `claimed` is what the page's own handler reported;
     * it can say "no" (the page already used up its activation) but its "yes"
     * is not believed: the shell asks the browser. Activation propagates from
     * a click in a tab's iframe to the shell window, its ancestor.
     */
    function allowScriptOpen(openerTab, claimed) {
      if (claimed === false) return false;
      var active = activation();
      if (active === true) return true;
      if (active === false) return false;
      /* navigator.userActivation unavailable: rate limit instead */
      var bucket = openerTab ? openerTab.popupTimes : orphanTimes;
      var now = Date.now();
      while (bucket.length && now - bucket[0] > C.POPUP_RATE_WINDOW_MS) bucket.shift();
      if (bucket.length >= C.POPUP_RATE_LIMIT) return false;
      bucket.push(now);
      return true;
    }

    function showBlocked(openerTab, req, name) {
      var host = openerTab ? Y.url.hostOf(openerTab.url) : '';
      toast({
        message: 'Pop-up blocked: ' + (host || 'this site') + ' tried to open a new tab.',
        actionLabel: 'Open',
        timeout: 10000,
        onAction: function () {
          tabs.createTab({
            target: req.url,
            active: true,
            openerId: openerTab && !openerTab.closed ? openerTab.id : null,
            origin: 'script',
            name: name
          });
        }
      });
    }

    function openTab(req) {
      req = req || {};
      if (!isValidUrl(req.url)) return { blocked: false, window: null };

      var openerTab = req.opener ? tabs.tabForWindow(req.opener) : null;
      var source = req.source === 'script' ? 'script' : 'link';
      var name = normalizeName(req.name);

      if (source === 'script' && !allowScriptOpen(openerTab, req.userActivated)) {
        showBlocked(openerTab, req, name);
        return { blocked: true, window: null };
      }

      /* A named tab is reused, like a named browsing context */
      var existing = name ? tabs.findByName(name) : null;
      if (existing) {
        if (req.url !== 'about:blank') tabs.navigate(existing, req.url);
        if (req.active !== false) tabs.activate(existing.id);
        return { blocked: false, window: req.noopener ? null : makeHandle(existing, openerTab, req.url) };
      }

      var tab = tabs.createTab({
        target: req.url,
        active: req.active !== false,
        openerId: openerTab ? openerTab.id : null,
        origin: source,
        name: name
      });
      if (!tab) return { blocked: true, window: null }; /* MAX_TABS (toast shown by the shell) */
      return { blocked: false, window: req.noopener ? null : makeHandle(tab, openerTab, req.url) };
    }

    function closeTabOf(win) {
      var tab = tabs.tabForWindow(win);
      /* like browsers: only tabs opened by a script or a link may be closed by script */
      if (!tab || tab.origin === 'user') return false;
      tabs.close(tab.id);
      return true;
    }

    /*
     * The page called history.back() / forward() / go(delta): move the tab
     * through the shell's own history, which is the one Back / Forward show.
     * Only the tab's own top document may do this (not a frame inside it).
     */
    function traverse(win, delta) {
      var tab = tabs.tabForWindow(win);
      if (!tab) return false;
      try { if (tab.iframe.contentWindow !== win) return false; } catch (err) { return false; }
      if (typeof delta !== 'number' || !isFinite(delta) || Math.floor(delta) !== delta ||
          delta === 0 || Math.abs(delta) > 1000) return false;
      return tabs.go(tab, delta);
    }

    function replaceNext(win) {
      var tab = tabs.tabForWindow(win);
      if (!tab) return false;
      try { if (tab.iframe.contentWindow !== win) return false; } catch (err) { return false; }
      tabs.replaceNext(tab);
      return true;
    }

    function prepareFormTarget(options) {
      options = options || {};
      var openerTab = options.opener ? tabs.tabForWindow(options.opener) : null;
      var source = options.source === 'script' ? 'script' : 'link';
      var name = normalizeName(options.name);

      if (!allowScriptOpen(openerTab, options.userActivated)) {
        showBlocked(openerTab, { url: 'about:blank' }, name);
        return null;
      }
      var existing = name ? tabs.findByName(name) : null;
      if (existing) {
        tabs.activate(existing.id);
        return { frameName: existing.iframe.name, tabId: existing.id };
      }
      var tab = tabs.createTab({
        target: 'about:blank',
        active: true,
        openerId: openerTab ? openerTab.id : null,
        origin: source,
        name: name
      });
      if (!tab) return null;
      return { frameName: tab.iframe.name, tabId: tab.id };
    }

    return Object.freeze({ openTab: openTab, closeTabOf: closeTabOf, traverse: traverse, replaceNext: replaceNext, prepareFormTarget: prepareFormTarget });
  }

  Y.createBridgeProxy = createBridgeProxy;
})(window);
