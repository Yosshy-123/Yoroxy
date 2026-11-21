/*
 * Yoroxy shared constants. Every tunable number or URL lives here so that it
 * can be changed in a single place.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  var config = {
    /* tabs */
    MAX_TABS: 30,
    SYNC_ACTIVE_MS: 500,
    SYNC_BACKGROUND_MS: 2000,
    LOADING_TIMEOUT_MS: 45000,
    VERTICAL_TAB_WIDTH: 240,
    MAX_TAB_TITLE: 512, // page titles are untrusted and can be arbitrarily long
    MAX_FAVICON_BYTES: 256 * 1024, // larger icons are not shown (and not downloaded further)

    /* service worker */
    SW_SCRIPT: '/uv/sw.js',
    SW_SCOPE: '/uv/service/',
    SW_READY_TIMEOUT_MS: 5000,

    /* pop-up blocking when navigator.userActivation is unavailable */
    POPUP_RATE_LIMIT: 3,
    POPUP_RATE_WINDOW_MS: 10000,

    /* settings */
    MAX_CUSTOM_ENGINES: 20,
    MAX_ENGINE_NAME: 40,
    MAX_ENGINE_TEMPLATE: 2048,
    SETTINGS_KEY: 'yoroxy:settings',

    /* bridge */
    MAX_BRIDGE_URL: 8192,

    /* launcher: where the original tab is sent once the shell has opened */
    CLOAK_REDIRECT_URL: 'https://www.google.com',

    /* community */
    DISCORD_INVITE_URL: 'https://discord.gg/QcrEzNtgVc'
  };

  /*
   * Derived: the longest data: URL a tab icon may have. The container turns an
   * icon into a data: URL (a blob: URL of its origin cannot be loaded by the
   * sandboxed interface), and base64 inflates by 4/3.
   */
  config.MAX_FAVICON_DATA_URL = Math.ceil((config.MAX_FAVICON_BYTES * 4) / 3) + 256;

  Y.config = Object.freeze(config);
})(window);
