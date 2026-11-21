/*
 * What the interface may know about a tab: a small, size-limited view of the
 * tab record (container/tab-model.js). The page's own strings are untrusted
 * and arbitrarily long, so every one is cut here, and an icon that is not a
 * data:image/ URL of a sane size is dropped. ui-messages.js validates the same
 * limits again on the way out.
 *
 *   Y.tabView.viewOf(tab) -> { id, url, title, favicon, loading, canGoBack,
 *                              canGoForward, address }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var truncate = Y.text.truncate;

  function addressFor(tab) {
    if (tab.kind === 'internal' && tab.internalName === 'newtab') return '';
    return tab.url;
  }

  /* Tab icons are data: URLs (see tab-favicon.js); anything else is not shown. */
  function iconFor(tab) {
    var icon = tab.favicon;
    return typeof icon === 'string' && /^data:image\//i.test(icon) && icon.length <= C.MAX_FAVICON_DATA_URL ? icon : null;
  }

  function viewOf(tab) {
    return {
      id: tab.id,
      url: truncate(tab.url, C.MAX_BRIDGE_URL),
      title: truncate(tab.title, C.MAX_TAB_TITLE),
      favicon: iconFor(tab),
      loading: !!tab.loading,
      canGoBack: !!tab.canGoBack,
      canGoForward: !!tab.canGoForward,
      address: truncate(addressFor(tab), C.MAX_BRIDGE_URL)
    };
  }

  Y.tabView = { viewOf: viewOf };
})(window);
