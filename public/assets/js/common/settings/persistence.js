/*
 * Yoroxy settings persistence: reads and writes the raw settings JSON.
 *
 * Storage: localStorage[C.SETTINGS_KEY]. The "yoroxy:" prefix keeps it apart
 * from Ultraviolet's own "__uv$<origin>@" namespace. When storage is
 * unavailable the data is kept in memory (shared between same-origin frames
 * through the top window) and isPersistent() reports false.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  var ls = null;
  try {
    ls = global.localStorage;
    var probe = '__yoroxy_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
  } catch (err) {
    ls = null;
  }
  var persistent = !!ls;

  function memoryHolder() {
    try {
      var t = global.top;
      if (t && !t.__yoroxySettingsMemory) t.__yoroxySettingsMemory = { raw: null };
      if (t && t.__yoroxySettingsMemory) return t.__yoroxySettingsMemory;
    } catch (err) { /* cross-origin top */ }
    global.__yoroxySettingsMemory = global.__yoroxySettingsMemory || { raw: null };
    return global.__yoroxySettingsMemory;
  }

  function readRaw() {
    if (ls) {
      try {
        return ls.getItem(C.SETTINGS_KEY);
      } catch (err) {
        persistent = false;
      }
    }
    return memoryHolder().raw;
  }

  function writeRaw(text) {
    if (ls && persistent) {
      try {
        ls.setItem(C.SETTINGS_KEY, text);
        return;
      } catch (err) {
        persistent = false;
      }
    }
    memoryHolder().raw = text;
  }

  Y.settingsPersistence = {
    readRaw: readRaw,
    writeRaw: writeRaw,
    isPersistent: function () { return persistent; }
  };
})(window);
