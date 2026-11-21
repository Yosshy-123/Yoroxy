/*
 * Decides whether a postMessage() from a proxied page's window.open() handle
 * may be delivered to the tab behind it.
 *
 * Every proxied site is served from this app's own origin, so the browser
 * cannot tell sites apart and `targetOrigin` toward the iframe gives no
 * protection. The shell therefore works out the *site* origin itself, from
 * the document that is actually inside the tab's iframe right now (the
 * one that would receive the message), never from cached tab fields.
 *
 * Policy: FAIL CLOSED. A message is delivered only when the receiving
 * document is positively identified and the opener's intent is clear:
 *   - the caller named a targetOrigin (anything but "*" / omitted) and it
 *     equals the receiving page's site origin exactly - the opener itself
 *     declared the recipient, as in a native browser; or
 *   - the caller gave no usable targetOrigin ("*" or omitted) and the
 *     receiving page's site origin is trusted for this tab; or
 *   - the receiver is an about:blank document (the opener's own scratch
 *     window; it holds no foreign content) and no site was named.
 * Anything else - internal pages, an unreadable or unrecognised location,
 * a mismatching targetOrigin, an untrusted origin under "*", any error -
 * is dropped.
 *
 * Trusted origins per tab (used only for "*" / omitted): the URL the
 * opener asked for (window.open / w.location = ...) and the first site
 * origin the tab committed to (covers server redirects, e.g. to www or to
 * a login host). "*" declares no recipient, so without this check a
 * message could reach whatever site the tab was later navigated to.
 *
 *   Y.createPostMessageGuard({ tabs }) -> { trustOrigin(tab, url), mayDeliver(tab, openerTab, targetArg) }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function createPostMessageGuard(deps) {
    var tabs = deps.tabs;
    var trusted = {}; // tab.id -> { allowed: { origin: true }, learned: boolean }

    function originOf(url) {
      try {
        var u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
      } catch (err) {
        return null;
      }
    }

    /*
     * What is inside the tab's iframe right now:
     *   { kind: 'blank' } | { kind: 'web', origin } | null  (unknown / not allowed to receive)
     */
    function receiver(tab) {
      try {
        var href = tab.iframe.contentWindow.location.href;
        if (href === 'about:blank') return { kind: 'blank' };
        var prefix = global.__uv$config && global.__uv$config.prefix;
        if (!prefix || new URL(href).pathname.indexOf(prefix) !== 0) return null; // not a proxied page
        var loc = Y.url.fromLocation(href);
        if (loc.kind !== 'web') return null;
        var origin = originOf(loc.url);
        return origin ? { kind: 'web', origin: origin } : null;
      } catch (err) {
        return null;
      }
    }

    function trustState(tab) {
      return trusted[tab.id] || (trusted[tab.id] = { allowed: {}, learned: false });
    }

    function trustOrigin(tab, url) {
      var o = originOf(url);
      if (o) trustState(tab).allowed[o] = true;
    }

    tabs.on('update', function (tab) {
      try {
        var st = trusted[tab.id];
        if (!st) return;
        if (tab.closed) { delete trusted[tab.id]; return; }
        if (st.learned) return;
        var r = receiver(tab);
        if (r && r.kind === 'web') { st.allowed[r.origin] = true; st.learned = true; }
      } catch (err) { /* tracking failure only means fewer trusted origins */ }
    });

    /* targetOrigin as given to postMessage(message, targetOrigin | { targetOrigin }) */
    function requestedTarget(arg) {
      if (arg && typeof arg === 'object') arg = arg.targetOrigin;
      return typeof arg === 'string' ? arg : undefined;
    }

    function mayDeliver(tab, openerTab, targetArg) {
      try {
        if (tab.closed) return false;
        var target = requestedTarget(targetArg);
        var r = receiver(tab);
        if (!r) return false;

        if (r.kind === 'blank') {
          return target === undefined || target === '*' || target === '/';
        }

        if (target !== undefined && target !== '*') {
          /* the opener named the recipient: deliver iff that is who is there */
          var want = target === '/' ? originOf(openerTab && openerTab.url) : originOf(target);
          return !!want && want === r.origin;
        }
        return trustState(tab).allowed[r.origin] === true;
      } catch (err) {
        return false;
      }
    }

    return { trustOrigin: trustOrigin, mayDeliver: mayDeliver };
  }

  Y.createPostMessageGuard = createPostMessageGuard;
})(window);
