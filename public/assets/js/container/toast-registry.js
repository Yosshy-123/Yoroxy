/*
 * Toasts are shown by the interface; a toast's action stays here and comes
 * back as a message naming the toast.
 *
 *   var toasts = Y.toastRegistry.create(send);   send(message) -> delivers a 'ui:toast'
 *   toasts.toast({ message, actionLabel?, onAction?, timeout? })
 *   toasts.onAction(id)    runs the action once and forgets it
 *   toasts.onDismiss(id)   forgets the action (the toast is gone: closed, expired)
 *
 * Only the most recent MAX_ACTIONS actions are kept, so toasts that nobody
 * answers cannot pile up.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var truncate = Y.text.truncate;

  var MAX_ACTIONS = 8;

  function create(send) {
    var seq = 0;
    var actions = {}; // "toast-N" -> function
    var order = [];

    function toast(opts) {
      var id = 'toast-' + (++seq);
      if (typeof opts.onAction === 'function') {
        actions[id] = opts.onAction;
        order.push(id);
        while (order.length > MAX_ACTIONS) delete actions[order.shift()];
      }
      send({
        type: 'ui:toast',
        id: id,
        message: truncate(opts.message, 300),
        actionLabel: opts.actionLabel ? truncate(opts.actionLabel, 60) : null,
        timeout: opts.timeout || 0
      });
    }

    function onAction(id) {
      var action = actions[id];
      delete actions[id];
      var i = order.indexOf(id);
      if (i !== -1) order.splice(i, 1);
      if (action) action();
    }

    function onDismiss(id) {
      delete actions[id];
      var i = order.indexOf(id);
      if (i !== -1) order.splice(i, 1);
    }

    return { toast: toast, onAction: onAction, onDismiss: onDismiss };
  }

  Y.toastRegistry = { create: create };
})(window);
