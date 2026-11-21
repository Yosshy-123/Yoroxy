/*
 * Tab data model: the initial shape of a tab record and the titles used for
 * internal pages. Pure data, no DOM work and no side effects. Every field a
 * tab ever carries is declared here (none is added implicitly later).
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  var INTERNAL_TITLES = { newtab: 'New Tab', settings: 'Settings', error: 'Error' };

  /*
   * opts: { id, iframe, openerId, origin = 'user', name }
   * `iframe` is stored as given; creating it is the caller's job.
   */
  function createTabRecord(opts) {
    return {
      id: opts.id,
      kind: 'blank',
      internalName: null,
      url: 'about:blank',
      title: 'Loading…',
      favicon: null,
      loading: false,
      openerId: opts.openerId || null,
      origin: opts.origin || 'user',
      name: opts.name || null,
      iframe: opts.iframe,
      history: Y.tabHistory.create(),
      canGoBack: false,
      canGoForward: false,
      navigationEvents: false,
      replaceNext: false,
      pending: null,
      pendingKind: null,
      pendingTitle: null,
      pendingInternal: null,
      awaiting: true,
      wantBlank: false,
      loadStarted: 0,
      navToken: 0,
      faviconSource: null,
      faviconToken: 0,
      popupTimes: [],
      closed: false
    };
  }

  Y.tabModel = { INTERNAL_TITLES: INTERNAL_TITLES, createTabRecord: createTabRecord };
})(window);
