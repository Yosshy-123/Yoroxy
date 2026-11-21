/*
 * The Discord invite link shown on the New Tab and Settings pages.
 *
 *   Y.pages.initDiscordLink(linkElement)   sets its address and adds the icon
 *
 * Needs common/config.js and common/icons.js. Does nothing without an element.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  Y.pages = Y.pages || {};

  Y.pages.initDiscordLink = function (link) {
    if (!link) return;
    link.href = Y.config.DISCORD_INVITE_URL;
    Y.icons.prepend(link, 'discord');
  };
})(window);
