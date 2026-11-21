/*
 * The message tables of the container <-> interface protocol: which messages
 * exist in each direction and the exact shape of each. The rules that apply
 * them are in validators.js; the delivery is in ui-channel.js.
 *
 *   Y.uiMessages.FROM_UI          interface -> container
 *   Y.uiMessages.FROM_CONTAINER   container -> interface
 *
 * Both documents (container.html and shell-ui.html) load this file.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var V = Y.validators.V;
  var ok = Y.validators.ok;
  var NO = Y.validators.NO;

  var ID = function (v) { return typeof v === 'string' && /^tab-\d{1,9}$/.test(v) ? ok(v) : NO; };
  var TOAST_ID = function (v) { return typeof v === 'string' && /^toast-\d{1,9}$/.test(v) ? ok(v) : NO; };

  /* A tab icon is a data:image/ URL (or none); see config.js MAX_FAVICON_DATA_URL. */
  var FAVICON = V.nullable(function (v) {
    return typeof v === 'string' && v.length <= C.MAX_FAVICON_DATA_URL && /^data:image\//i.test(v) ? ok(v) : NO;
  });

  var TAB_VIEW = V.obj({
    id: ID,
    url: V.str(C.MAX_BRIDGE_URL),
    title: V.str(C.MAX_TAB_TITLE),
    favicon: FAVICON,
    loading: V.bool,
    canGoBack: V.bool,
    canGoForward: V.bool,
    address: V.str(C.MAX_BRIDGE_URL)
  });

  /* A rectangle in CSS pixels of the container window. */
  var RECT = V.obj({
    x: V.num(-100000, 100000),
    y: V.num(-100000, 100000),
    w: V.num(0, 100000),
    h: V.num(0, 100000)
  });

  var NONE = {};

  var FROM_UI = {
    'ui:ready': NONE,
    'ui:geometry': { content: RECT, modal: V.bool },
    'ui:new': NONE,
    'ui:activate': { id: ID },
    'ui:close': { id: ID },
    'ui:move': { id: ID, index: V.int(0, C.MAX_TABS) },
    'ui:context': { id: ID, action: V.oneOf(['reload', 'duplicate', 'close', 'closeOthers', 'closeAfter']) },
    'ui:back': NONE,
    'ui:forward': NONE,
    'ui:reload': NONE,
    'ui:stop': NONE,
    'ui:home': NONE,
    'ui:settings': NONE,
    'ui:submit': { text: V.str(C.MAX_BRIDGE_URL), newTab: V.bool },
    'ui:toastAction': { id: TOAST_ID },
    'ui:toastDismiss': { id: TOAST_ID }
  };

  var FROM_CONTAINER = {
    'ui:tabs': { tabs: V.list(TAB_VIEW, C.MAX_TABS), activeId: V.nullable(ID) },
    'ui:active': { tabs: V.list(TAB_VIEW, C.MAX_TABS), activeId: V.nullable(ID) },
    'ui:update': { tab: TAB_VIEW, activeId: V.nullable(ID) },
    'ui:layout': { layout: V.oneOf(['horizontal', 'vertical']) },
    'ui:toast': { id: TOAST_ID, message: V.str(300), actionLabel: V.nullable(V.str(60)), timeout: V.int(0, 60000) },
    'ui:focusAddress': NONE,
    'ui:closeDrawer': NONE
  };

  Y.uiMessages = Object.freeze({ FROM_UI: FROM_UI, FROM_CONTAINER: FROM_CONTAINER });
})(window);
