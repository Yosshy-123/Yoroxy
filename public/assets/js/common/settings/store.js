/*
 * Yoroxy settings store.
 *
 * The only module allowed to read or write settings. Used by the browser
 * shell, the New Tab page and the Settings page.
 *
 * This file is a thin facade: it composes
 *   schema.js       defaults, built-in engines, validation
 *   persistence.js  localStorage / in-memory fallback
 *   engines.js      search-engine API and custom-engine CRUD
 * and owns the one thing none of them do: change notification.
 *
 * Load order: config.js, shell-client.js, then schema.js, persistence.js,
 * engines.js and store.js of this directory.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var Schema = Y.settingsSchema;
  var Persistence = Y.settingsPersistence;

  function load() {
    var text = Persistence.readRaw();
    if (!text) return Schema.defaults();
    try {
      return Schema.sanitize(JSON.parse(text));
    } catch (err) {
      return Schema.defaults(); /* corrupted JSON: fall back to defaults */
    }
  }

  /* ---------------------------------------------------------- change events */

  var listeners = [];

  function notifyListeners() {
    listeners.slice().forEach(function (cb) {
      try { cb(load()); } catch (err) { /* keep going */ }
    });
  }

  function notify() {
    notifyListeners();
    /* A page inside the shell: tell the shell directly (needed when storage
     * is unavailable, and faster than waiting for the storage event). */
    Y.shellClient.settingsChanged();
  }

  function save(settings) {
    var clean = Schema.sanitize(settings);
    Persistence.writeRaw(JSON.stringify(clean));
    notify();
    return clean;
  }

  global.addEventListener('storage', function (ev) {
    if (ev.key !== null && ev.key !== C.SETTINGS_KEY) return;
    notifyListeners();
  });

  function onChange(cb) {
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  /* ------------------------------------------------------------ simple setters */

  function setTabLayout(layout) {
    if (Schema.LAYOUTS.indexOf(layout) === -1) return false;
    var s = load();
    s.tabLayout = layout;
    save(s);
    return true;
  }

  function reset() {
    return save(Schema.defaults());
  }

  var engines = Y.settingsEngines.create({ load: load, save: save });

  Y.settings = {
    defaults: Schema.defaults,
    load: load,
    save: save,
    isPersistent: Persistence.isPersistent,
    getEngines: engines.getEngines,
    getDefaultEngine: engines.getDefaultEngine,
    buildSearchUrl: engines.buildSearchUrl,
    addEngine: engines.addEngine,
    updateEngine: engines.updateEngine,
    deleteEngine: engines.deleteEngine,
    setDefaultEngine: engines.setDefaultEngine,
    setTabLayout: setTabLayout,
    reset: reset,
    onChange: onChange
  };
})(window);
