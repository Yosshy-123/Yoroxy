/*
 * Transient notifications (toasts) in the #toasts bar of the interface, at most
 * three at a time. The bar is part of the interface layout (between the toolbar
 * and the page area), not an overlay, so it never covers a page. Message and
 * button text are written with textContent only.
 *
 * A toast goes away when it expires (it waits while the pointer or the focus is
 * on it), when its close button is pressed, on Escape while it has the focus,
 * when its action button is pressed, or when a newer toast pushes it out.
 *
 *   Y.ui.toast({ message, actionLabel?, onAction?, onClose?, timeout? }) -> { dismiss, element } | null
 *
 * onClose is called exactly once, however the toast went away.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  Y.ui = Y.ui || {};

  var MAX_TOASTS = 3;
  var DEFAULT_TIMEOUT = 6000;

  function toast(opts) {
    var host = document.getElementById('toasts');
    if (!host) return null;
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = opts.message;
    el.appendChild(text);

    var closed = false;
    var timer = null;
    var remaining = opts.timeout || DEFAULT_TIMEOUT;
    var startedAt = 0;

    function stopTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function startTimer() {
      stopTimer();
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    }

    function pause() {
      if (timer === null) return;
      remaining = Math.max(1000, remaining - (Date.now() - startedAt));
      stopTimer();
    }

    function dismiss() {
      if (closed) return;
      closed = true;
      stopTimer();
      if (el.parentNode) el.parentNode.removeChild(el);
      if (opts.onClose) opts.onClose();
    }

    if (opts.actionLabel) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', function () {
        if (opts.onAction) opts.onAction();
        dismiss();
      });
      el.appendChild(btn);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.title = 'Dismiss';
    close.textContent = '\u00d7';
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        dismiss();
      }
    });
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', function () { if (!el.contains(document.activeElement)) startTimer(); });
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', function () { if (!el.matches(':hover')) startTimer(); });

    while (host.children.length >= MAX_TOASTS) {
      var oldest = host.firstChild;
      if (oldest && oldest.__dismiss) oldest.__dismiss();
      else host.removeChild(oldest);
    }
    el.__dismiss = dismiss;
    host.appendChild(el);
    startTimer();
    return { dismiss: dismiss, element: el };
  }

  Y.ui.toast = toast;
})(window);
