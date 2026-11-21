/*
 * Registers the Ultraviolet service worker for the container.
 *
 *   Y.containerSw.register() -> Promise (rejects when no way of registering works)
 *
 * about:blank documents do not reliably expose navigator.serviceWorker. When
 * registering here fails, a hidden real document (the New Tab page) performs
 * the registration instead. The registration is origin-wide.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function registerViaFrame() {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.hidden = true;
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      frame.addEventListener('load', function () {
        var done = function () { if (frame.parentNode) frame.parentNode.removeChild(frame); };
        try {
          Y.sw.register(frame.contentWindow).then(function () {
            done();
            resolve();
          }, function (err) {
            done();
            reject(err);
          });
        } catch (err) {
          done();
          reject(err);
        }
      }, { once: true });
      frame.src = Y.url.abs('/internal/newtab.html');
      document.body.appendChild(frame);
    });
  }

  function register() {
    return Y.sw.register().then(function () {}, function () {
      return registerViaFrame();
    });
  }

  Y.containerSw = { register: register };
})(window);
