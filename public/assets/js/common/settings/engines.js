/*
 * Yoroxy search-engine API: listing, lookup, URL building and custom-engine
 * CRUD. Created with the store's load/save so it never touches storage
 * directly:  Y.settingsEngines.create({ load: fn, save: fn }).
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;
  var Schema = Y.settingsSchema;

  function create(store) {
    function allEngines(settings) {
      return Schema.BUILTIN_ENGINES.concat(settings.search.customEngines.map(function (e) {
        return { id: e.id, name: e.name, template: e.template, builtin: false };
      }));
    }

    function getEngineById(id, settings) {
      var list = allEngines(settings || store.load());
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }

    function getDefaultEngine(settings) {
      var s = settings || store.load();
      return getEngineById(s.search.defaultEngineId, s) || Schema.BUILTIN_ENGINES[0];
    }

    function buildSearchUrl(engine, query) {
      var encoded = encodeURIComponent(query);
      /* split/join: never interpret "$&" and friends in the query */
      return engine.template.split('%s').join(encoded);
    }

    function newCustomId(settings) {
      var id;
      do {
        var buf = new Uint32Array(2);
        global.crypto.getRandomValues(buf);
        id = 'custom-' + (buf[0].toString(36) + buf[1].toString(36) + '00000000').slice(0, 8);
      } while (Schema.engineExists(settings, id));
      return id;
    }

    /* Returns { ok, errors: { name?, template?, general? } } */
    function validateEngine(input, settings, exceptId) {
      var errors = {};
      var name = String(input && input.name != null ? input.name : '').trim();
      var template = String(input && input.template != null ? input.template : '').trim();
      var ne = Schema.nameError(name, Schema.takenNames(settings.search.customEngines, exceptId));
      var te = Schema.templateError(template);
      if (ne) errors.name = ne;
      if (te) errors.template = te;
      return { ok: !ne && !te, errors: errors, name: name, template: template };
    }

    function addEngine(input) {
      var s = store.load();
      if (s.search.customEngines.length >= C.MAX_CUSTOM_ENGINES) {
        return { ok: false, errors: { general: 'You can add up to ' + C.MAX_CUSTOM_ENGINES + ' custom search engines.' } };
      }
      var v = validateEngine(input, s, null);
      if (!v.ok) return { ok: false, errors: v.errors };
      var engine = { id: newCustomId(s), name: v.name, template: v.template };
      s.search.customEngines.push(engine);
      store.save(s);
      return { ok: true, engine: engine };
    }

    function updateEngine(id, input) {
      var s = store.load();
      var target = null;
      s.search.customEngines.forEach(function (e) { if (e.id === id) target = e; });
      if (!target) return { ok: false, errors: { general: 'Search engine not found.' } };
      var v = validateEngine(input, s, id);
      if (!v.ok) return { ok: false, errors: v.errors };
      target.name = v.name;
      target.template = v.template;
      store.save(s);
      return { ok: true, engine: target };
    }

    function deleteEngine(id) {
      var s = store.load();
      var before = s.search.customEngines.length;
      s.search.customEngines = s.search.customEngines.filter(function (e) { return e.id !== id; });
      if (s.search.customEngines.length === before) return { ok: false, resetDefault: false };
      var resetDefault = s.search.defaultEngineId === id;
      if (resetDefault) s.search.defaultEngineId = Schema.DEFAULT_ENGINE_ID;
      store.save(s);
      return { ok: true, resetDefault: resetDefault };
    }

    function setDefaultEngine(id) {
      var s = store.load();
      if (!Schema.engineExists(s, id)) return false;
      s.search.defaultEngineId = id;
      store.save(s);
      return true;
    }

    return {
      getEngines: function (settings) { return allEngines(settings || store.load()); },
      getDefaultEngine: getDefaultEngine,
      buildSearchUrl: buildSearchUrl,
      addEngine: addEngine,
      updateEngine: updateEngine,
      deleteEngine: deleteEngine,
      setDefaultEngine: setDefaultEngine
    };
  }

  Y.settingsEngines = { create: create };
})(window);
