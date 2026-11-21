/*
 * The message layer between the container (container.html: tabs, state,
 * logic) and the browser interface (shell-ui.html, in a sandboxed iframe with
 * an opaque origin). Both documents load this file.
 *
 * The interface cannot be reached by script from any page of this app's
 * origin, and it cannot reach them: postMessage is the only connection. Both
 * ends therefore treat every message as untrusted input:
 *
 *   - the sender must be the one expected window (the interface frame, or the
 *     parent), and its origin the expected one;
 *   - the message must be a plain object whose `type` is on the allow-list
 *     below, whose fields are exactly the declared ones, each of the declared
 *     kind and within its length limit;
 *   - the handler receives a fresh copy built from the validated fields, never
 *     the received object.
 *
 * Anything that fails a check is dropped without a reply.
 *
 *   Y.uiChannel.createContainerEnd({ frame, handlers }) -> { send(msg), dispose() }
 *   Y.uiChannel.createUiEnd({ handlers })               -> { send(msg) }
 *
 * The message tables are in ui-messages.js, the checks in validators.js.
 *
 * handlers: { 'ui:type': function (cleanMessage) {} }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var validate = Y.validators.validate;
  var hasOwn = Y.validators.hasOwn;
  var FROM_UI = Y.uiMessages.FROM_UI;
  var FROM_CONTAINER = Y.uiMessages.FROM_CONTAINER;

  function dispatch(handlers, table, data) {
    var msg = validate(table, data);
    if (msg && hasOwn(handlers, msg.type)) handlers[msg.type](msg);
  }

  /* ---------------------------------------------------------------- ends */

  /*
   * Container side. `frame` is the <iframe> element of the interface. The
   * interface has an opaque origin, so its messages carry the origin "null" and
   * the only way to address it is targetOrigin "*": what is sent is tab
   * state, which any script on the container's origin can read anyway.
   * Messages sent before the interface has said "ui:ready" are held back.
   */
  function createContainerEnd(opts) {
    var frame = opts.frame;
    var handlers = opts.handlers;
    var ready = false;
    var queue = [];

    function post(msg) {
      try {
        frame.contentWindow.postMessage(msg, '*');
      } catch (err) { /* frame gone */ }
    }

    function onMessage(ev) {
      if (!frame.contentWindow || ev.source !== frame.contentWindow) return;
      if (ev.origin !== 'null') return;
      var msg = validate(FROM_UI, ev.data);
      if (!msg) return;
      if (msg.type === 'ui:ready' && !ready) {
        ready = true;
        queue.forEach(post);
        queue = [];
      }
      if (hasOwn(handlers, msg.type)) handlers[msg.type](msg);
    }

    global.addEventListener('message', onMessage);

    return {
      send: function (msg) {
        var clean = validate(FROM_CONTAINER, msg);
        if (!clean) throw new Error('ui-channel: invalid container message ' + String(msg && msg.type));
        if (ready) post(clean);
        else queue.push(clean);
      },
      dispose: function () { global.removeEventListener('message', onMessage); }
    };
  }

  /*
   * Interface side. The container is the parent window; its origin is the
   * origin of this document's URL (the page is served from the same server),
   * which is also the only targetOrigin used when sending.
   */
  function createUiEnd(opts) {
    var handlers = opts.handlers;
    var containerOrigin = new URL(global.location.href).origin;

    global.addEventListener('message', function (ev) {
      if (ev.source !== global.parent || ev.origin !== containerOrigin) return;
      dispatch(handlers, FROM_CONTAINER, ev.data);
    });

    return {
      send: function (msg) {
        var clean = validate(FROM_UI, msg);
        if (!clean) throw new Error('ui-channel: invalid interface message ' + String(msg && msg.type));
        global.parent.postMessage(clean, containerOrigin);
      }
    };
  }

  Y.uiChannel = {
    createContainerEnd: createContainerEnd,
    createUiEnd: createUiEnd
  };
})(window);
