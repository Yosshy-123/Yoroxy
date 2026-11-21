/*
 * Toolbar: Back / Forward / Reload(Stop) / Home / address bar / Settings.
 *
 * The address bar shows the *real* URL of the active tab (decoded from the
 * proxy path) and only overwrites what the user typed when they are not
 * editing.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  /*
   * els: { back, forward, reload, home, settings, tabs, form, input, tabCount, main }
   * handlers: { onBack, onForward, onReload, onStop, onHome, onSettings,
   *             onTabsToggle, onSubmit(text, { newTab }) }
   */
  function createToolbar(els, handlers) {
    var currentUrl = '';
    var editing = false;
    var loading = false;

    var reloadIcon = els.reload.querySelector('[data-icon]');

    els.back.addEventListener('click', function () { handlers.onBack(); });
    els.forward.addEventListener('click', function () { handlers.onForward(); });
    els.reload.addEventListener('click', function () {
      if (loading) handlers.onStop();
      else handlers.onReload();
    });
    els.home.addEventListener('click', function () { handlers.onHome(); });
    els.settings.addEventListener('click', function () { handlers.onSettings(); });
    els.tabs.addEventListener('click', function () { handlers.onTabsToggle(); });

    /* --- address bar --- */
    els.input.addEventListener('focus', function () {
      els.input.select();
    });
    /* keep the select-all from focus when the focusing click is released */
    els.input.addEventListener('mouseup', function (ev) {
      if (els.input.getAttribute('data-just-focused') === '1') {
        ev.preventDefault();
        els.input.removeAttribute('data-just-focused');
      }
    });
    els.input.addEventListener('mousedown', function () {
      if (document.activeElement !== els.input) els.input.setAttribute('data-just-focused', '1');
    });

    els.input.addEventListener('input', function () { editing = true; });

    els.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        revert();
        els.input.select();
      } else if (ev.key === 'Enter') {
        /* Take full manual control of Enter rather than relying on the
         * input's native "submit the form" default action: Chromium does
         * not perform that default action while Alt is held, so Alt+Enter
         * would otherwise silently do nothing. Plain Enter is handled here
         * too, for one consistent code path. */
        ev.preventDefault();
        var newTab = ev.altKey;
        editing = false;
        handlers.onSubmit(els.input.value, { newTab: newTab });
      }
    });

    els.input.addEventListener('blur', function () {
      if (editing) revert();
    });

    /* Fallback for submissions that don't go through the keydown handler
     * above (e.g. a mobile virtual keyboard's "Go" action firing `submit`
     * directly without a synthesized Enter keydown). No Alt information is
     * available on this path, so it's always treated as a plain Enter. */
    els.form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var text = els.input.value;
      editing = false;
      handlers.onSubmit(text, { newTab: false });
    });

    function revert() {
      editing = false;
      els.input.value = currentUrl;
    }

    /* --- state setters --- */
    function setUrl(url, force) {
      currentUrl = url || '';
      if (force) editing = false;
      if (!editing) els.input.value = currentUrl;
    }

    function setNav(state) {
      els.back.disabled = !state.canGoBack;
      els.forward.disabled = !state.canGoForward;
    }

    function setLoading(value) {
      loading = !!value;
      els.main.setAttribute('data-loading', loading ? 'true' : 'false');
      var label = loading ? 'Stop' : 'Reload';
      els.reload.setAttribute('aria-label', label);
      els.reload.title = label;
      reloadIcon.setAttribute('data-icon', loading ? 'close' : 'reload'); /* "stop" is the same cross as "close" */
      reloadIcon.innerHTML = Y.icons.svg(loading ? 'close' : 'reload');
    }

    function setTabCount(n) {
      els.tabCount.textContent = String(n);
    }

    function focusAddress() {
      els.input.focus();
      els.input.select();
    }

    return {
      setUrl: setUrl,
      setNav: setNav,
      setLoading: setLoading,
      setTabCount: setTabCount,
      focusAddress: focusAddress
    };
  }

  Y.createToolbar = createToolbar;
})(window);
