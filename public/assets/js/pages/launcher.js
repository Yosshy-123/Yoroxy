/*
 * Launcher (loaded by /index.html).
 *
 * Opens the browser shell in a fresh about:blank tab (so the shell never
 * shows this site's URL), then sends the original tab to a neutral page.
 * If the pop-up is blocked, a button offers to retry from a user gesture (and
 * keeps working for as many tries as it takes). /container.html is a real page
 * (the E2E suite opens it directly), but this launcher is the way in: only an
 * about:blank window keeps the shell's address out of the address bar, so no
 * link to /container.html is ever offered.
 */
(function (global) {
  'use strict';

  var Y = global.Yoroxy;
  var C = Y.config;
  var FRAME_URL = '/container.html';

  var doc = global.document;
  var message = doc.getElementById('message');
  var button = doc.getElementById('goButton');
  var notice = doc.getElementById('popup-blocked-notice');

  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = false;
  }

  /* Opens the shell in a new tab and injects the frame HTML. Returns true on success. */
  function openNewShellTab(frameHtml) {
    try {
      var tab = global.open('about:blank', '_blank');
      if (!tab) return false;
      var base = '<base href="' + global.location.origin + '">';
      var withBase = frameHtml.replace(/<head\b[^>]*>/i, function (open) { return open + base; });
      tab.document.open();
      tab.document.write(withBase);
      tab.document.close();
      return true;
    } catch (err) {
      console.error('openNewShellTab error', err);
      return false;
    }
  }

  function cloakOriginalTab() {
    global.location.replace(C.CLOAK_REDIRECT_URL);
  }

  /*
   * What the button does now. There is deliberately no link to open
   * /container.html by hand (see the note at the top).
   */
  var onButton = null;

  button.addEventListener('click', function () {
    if (onButton) onButton();
  });

  function showButton(action) {
    onButton = action;
    button.disabled = false;
    button.hidden = false;
    button.focus();
  }

  function handlePopupBlocked(frameHtml) {
    message.textContent = 'Popup was blocked. Please click the button to open the new tab.';
    showButton(function () {
      button.disabled = true;
      if (openNewShellTab(frameHtml)) {
        cloakOriginalTab();
      } else {
        showNotice('Popup is still blocked. Please allow popups for this site.');
        button.disabled = false;
      }
    });
  }

  function handleLoadFailure(err) {
    console.error('Failed to load ' + FRAME_URL, err);
    message.textContent = 'Failed to load content. Click the button to try again.';
    showButton(function () {
      button.disabled = true;
      notice.hidden = true;
      start();
    });
  }

  function start() {
    global.fetch(FRAME_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (html) {
        if (openNewShellTab(html)) cloakOriginalTab();
        else handlePopupBlocked(html);
      })
      .catch(handleLoadFailure);
  }

  /* Register the proxy service worker from this real document, before the
     about:blank shell opens (the registration is shared by the whole origin). */
  Y.sw.register().catch(function () {});

  start();
})(window);
