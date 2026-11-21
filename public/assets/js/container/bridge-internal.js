/*
 * Receives the messages the internal pages (New Tab, Error, Settings) send
 * through common/shell-client.js and carries them out.
 *
 * Every message is checked before anything happens; anything that fails a
 * check is dropped silently:
 *
 *   1. event.origin is this app's origin;
 *   2. event.source is the window of one of the shell's tabs (its top frame,
 *      not a frame nested inside the page) - the tab to act on is found from
 *      the source itself; the message never names a window;
 *   3. that tab is showing the internal page allowed to send this message
 *      right now (a proxied page that took the tab over is not);
 *   4. the message is a plain object whose type is on the list below and
 *      whose fields are exactly the expected ones, with the expected types
 *      (the rules are those of protocol/validators.js).
 *
 *   yoroxy:submit { text }     only from /internal/newtab.html; text: string,
 *                              at most MAX_BRIDGE_URL characters
 *   yoroxy:newTab              only from /internal/error.html
 *   yoroxy:settingsChanged     from any internal page; the shell only re-reads
 *                              the saved settings
 *
 * deps: { tabs, submitText(text, tab), newTab(), settingsChanged() }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var V = Y.validators.V;

  /* Which message exists, which internal page may send it, and its fields. */
  var ANY_INTERNAL = null;
  var FROM = {
    'yoroxy:submit': 'newtab',
    'yoroxy:newTab': 'error',
    'yoroxy:settingsChanged': ANY_INTERNAL
  };
  var SHAPES = {
    'yoroxy:submit': { text: V.str(C.MAX_BRIDGE_URL) },
    'yoroxy:newTab': {},
    'yoroxy:settingsChanged': {}
  };

  function createBridgeInternal(deps) {
    var tabs = deps.tabs;
    var appOrigin = Y.url.appOrigin();

    /* The tab whose top frame is `source`, or null. */
    function tabOfSource(source) {
      var list = tabs.getTabs();
      for (var i = 0; i < list.length; i++) {
        try {
          if (list[i].iframe.contentWindow === source) return list[i];
        } catch (err) { /* ignore */ }
      }
      return null;
    }

    /* Name of the internal page the source is showing right now, or null. */
    function internalPageOf(source) {
      try {
        var loc = Y.url.fromLocation(source.location.href);
        return loc.kind === 'internal' ? loc.name : null;
      } catch (err) {
        return null;
      }
    }

    function onMessage(ev) {
      if (ev.origin !== appOrigin) return;
      var msg = Y.validators.validate(SHAPES, ev.data);
      if (!msg) return;

      var tab = ev.source ? tabOfSource(ev.source) : null;
      if (!tab || tab.closed) return;
      var page = internalPageOf(ev.source);
      var from = FROM[msg.type];
      if (!page || (from !== ANY_INTERNAL && from !== page)) return;

      switch (msg.type) {
        case 'yoroxy:submit':
          deps.submitText(msg.text, tab);
          break;
        case 'yoroxy:newTab':
          deps.newTab();
          break;
        case 'yoroxy:settingsChanged':
          deps.settingsChanged();
          break;
      }
    }

    global.addEventListener('message', onMessage);
    return { dispose: function () { global.removeEventListener('message', onMessage); } };
  }

  Y.createBridgeInternal = createBridgeInternal;
})(window);
