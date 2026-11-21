/*
 * How an internal page (New Tab, Error, Settings) talks to the browser shell
 * that hosts it. Internal pages run in a tab's iframe, so the shell is their
 * parent window; they send it a message and it decides what to do.
 *
 *   Y.shellClient.submit(text)       "navigate this tab to what was typed"
 *   Y.shellClient.newTab()           "open a new tab"
 *   Y.shellClient.settingsChanged()  "settings were saved, re-read them"
 *   Y.shellClient.inShell()          true when there is a parent window
 *
 * Each call returns true if the message was posted and false when the page
 * is open on its own (no parent), in which case the caller does what it
 * always did outside the shell. The messages carry no window references: the
 * shell works out which tab sent a message from the message's own source.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function inShell() {
    return !!global.parent && global.parent !== global;
  }

  function post(message) {
    if (!inShell()) return false;
    try {
      global.parent.postMessage(message, global.location.origin);
      return true;
    } catch (err) {
      return false;
    }
  }

  Y.shellClient = {
    inShell: inShell,
    submit: function (text) { return post({ type: 'yoroxy:submit', text: String(text) }); },
    newTab: function () { return post({ type: 'yoroxy:newTab' }); },
    settingsChanged: function () { return post({ type: 'yoroxy:settingsChanged' }); }
  };
})(window);
