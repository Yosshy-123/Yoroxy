/*
 * Service worker registration for the Ultraviolet proxy.
 *
 * Idempotent and safe to call from several documents (the launcher, the
 * shell and the New Tab page all do): the registration itself is shared, and
 * every caller simply waits for the worker to become active.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var SCRIPT = C.SW_SCRIPT;
  var TIMEOUT = C.SW_READY_TIMEOUT_MS;

  function scope() {
    return (global.__uv$config && global.__uv$config.prefix) || C.SW_SCOPE;
  }

  function whenActivated(registration) {
    return new Promise(function (resolve, reject) {
      var worker = registration.installing || registration.waiting || registration.active;
      if (!worker) {
        reject(new Error('No service worker instance'));
        return;
      }
      if (worker.state === 'activated') {
        resolve(registration);
        return;
      }
      function settle(fn, arg) {
        clearTimeout(timer);
        worker.removeEventListener('statechange', onStateChange);
        fn(arg);
      }
      function onStateChange() {
        if (worker.state === 'activated') settle(resolve, registration);
        else if (worker.state === 'redundant') settle(reject, new Error('Service worker became redundant'));
      }
      var timer = setTimeout(function () {
        settle(reject, new Error('Service worker activation timed out'));
      }, TIMEOUT);
      worker.addEventListener('statechange', onStateChange);
    });
  }

  /*
   * Resolves once an active worker controls the proxy scope. `win` is the
   * window whose navigator.serviceWorker does the registering (default: this
   * one). The shell passes a hidden real document's window when it runs inside
   * about:blank, where registering is unreliable; the registration itself is
   * shared by the whole origin.
   */
  function register(win) {
    win = win || global;
    if (!win.navigator || !win.navigator.serviceWorker) {
      return Promise.reject(new Error('Service workers are not available in this document'));
    }
    var base = win.document.baseURI;
    return win.navigator.serviceWorker
      .register(new URL(SCRIPT, base).href, { scope: new URL(scope(), base).href })
      .then(whenActivated);
  }

  Y.sw = { register: register };
})(window);
