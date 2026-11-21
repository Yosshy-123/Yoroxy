/*
 * New Tab page (yoroxy://newtab).
 *
 * Inside the shell the search box posts its text to the shell (see
 * common/shell-client.js) so that the address bar rules apply. When the page is opened on its own it resolves
 * the input itself and navigates.
 */
(function (global) {
  'use strict';

  var Y = global.Yoroxy;

  var input = document.getElementById('search-input');
  var form = document.getElementById('search-form');
  Y.pages.initDiscordLink(document.getElementById('discord-link'));
  Y.icons.prepend(document.querySelector('.search-icon'), 'search');

  /* Idempotent: makes sure the proxy service worker exists. */
  Y.sw.register().catch(function () { /* reported when a navigation needs it */ });

  if (!Y.shellClient.inShell()) input.focus();

  function standalone(text) {
    var desc = Y.url.resolve(text, Y.settings.load());
    if (desc.kind === 'none') return;
    if (desc.kind === 'web') {
      Y.sw.register().then(function () {
        global.location.href = Y.url.encodeProxy(desc.url);
      }, function () {
        global.location.href = Y.url.internalPath({ kind: 'error', type: 'sw-failed', url: desc.url });
      });
    } else if (desc.kind === 'blank') {
      global.location.href = 'about:blank';
    } else {
      global.location.href = Y.url.internalPath(desc);
    }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = input.value;
    if (!text.trim()) return;
    if (!Y.shellClient.submit(text)) standalone(text);
  });
})(window);
