/*
 * The list of open tabs and the lookups on it: by id, by window name, by
 * internal page, by the window a script runs in. It holds data only: it
 * creates no iframes and emits no events (tab-manager.js does both).
 *
 *   var registry = Y.tabRegistry.create();
 *   registry.list()               the live array, in tab-bar order
 *   registry.indexOf(id) / find(id) / findByName(name) / findInternal(name)
 *   registry.tabForWindow(win)    the tab whose iframe contains `win`
 *   registry.insert(tab, opts)    at opts.index, after the opener's tabs, or last
 *   registry.remove(id)           -> the index it had, or -1
 *   registry.move(id, toIndex)    -> true when the tab exists
 *   Y.tabRegistry.frameWindow(tab) the tab's window, or null when it is gone
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function frameWindow(tab) {
    try { return tab.iframe.contentWindow; } catch (err) { return null; }
  }

  function create() {
    var tabs = [];
    var names = {}; // window-name -> tab id

    function indexOf(id) {
      for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return i;
      return -1;
    }
    function find(id) {
      var i = indexOf(id);
      return i === -1 ? null : tabs[i];
    }
    function findByName(name) {
      return names[name] ? find(names[name]) : null;
    }
    function findInternal(name) {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].kind === 'internal' && tabs[i].internalName === name) return tabs[i];
      }
      return null;
    }

    /* The tab whose iframe contains `win` (also for nested frames). */
    function tabForWindow(win) {
      var w = win;
      for (var depth = 0; w && depth < 32; depth++) {
        for (var i = 0; i < tabs.length; i++) {
          try {
            if (tabs[i].iframe.contentWindow === w) return tabs[i];
          } catch (err) { /* ignore */ }
        }
        var p;
        try { p = w.parent; } catch (err) { break; }
        if (!p || p === w) break;
        w = p;
      }
      return null;
    }

    function insertIndex(o) {
      if (typeof o.index === 'number') return Math.max(0, Math.min(o.index, tabs.length));
      if (o.openerId) {
        var oi = indexOf(o.openerId);
        if (oi !== -1) {
          /* right after the opener and after the tabs it already spawned */
          var i = oi + 1;
          while (i < tabs.length && tabs[i].openerId === o.openerId) i++;
          return i;
        }
      }
      return tabs.length;
    }

    /* o: { index, openerId } as given to createTab */
    function insert(tab, o) {
      tabs.splice(insertIndex(o || {}), 0, tab);
      if (tab.name) names[tab.name] = tab.id;
    }

    function remove(id) {
      var i = indexOf(id);
      if (i === -1) return -1;
      var tab = tabs.splice(i, 1)[0];
      if (tab.name && names[tab.name] === id) delete names[tab.name];
      return i;
    }

    function move(id, toIndex) {
      var from = indexOf(id);
      if (from === -1) return false;
      var tab = tabs.splice(from, 1)[0];
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
      return true;
    }

    return {
      list: function () { return tabs; },
      indexOf: indexOf,
      find: find,
      findByName: findByName,
      findInternal: findInternal,
      tabForWindow: tabForWindow,
      insert: insert,
      remove: remove,
      move: move
    };
  }

  Y.tabRegistry = { create: create, frameWindow: frameWindow };
})(window);
