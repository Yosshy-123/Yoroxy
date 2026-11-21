/*
 * Yoroxy settings schema: default values, the built-in search engines and
 * the validation / sanitising rules. Pure functions only - no storage, no
 * events - so it is safe to use from any other settings module.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  var DEFAULT_ENGINE_ID = 'startpage';
  var LAYOUTS = ['horizontal', 'vertical'];
  var CUSTOM_ID_RE = /^custom-[a-z0-9]{8}$/;

  /* Built-in engines live in code (not in storage) so that a corrected
   * template reaches existing users too. Order matters: it is the UI order. */
  var BUILTIN_ENGINES = Object.freeze([
    Object.freeze({ id: 'startpage', name: 'Startpage', template: 'https://www.startpage.com/sp/search?query=%s', builtin: true }),
    Object.freeze({ id: 'ddg', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s', builtin: true }),
    Object.freeze({ id: 'bing', name: 'Bing', template: 'https://www.bing.com/search?q=%s', builtin: true }),
    Object.freeze({ id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', builtin: true }),
    Object.freeze({ id: 'yahoo', name: 'Yahoo', template: 'https://search.yahoo.com/search?p=%s', builtin: true }),
    Object.freeze({ id: 'brave', name: 'Brave', template: 'https://search.brave.com/search?q=%s', builtin: true })
  ]);

  function nameError(name, takenLower) {
    if (!name) return 'Name is required.';
    if (name.length > C.MAX_ENGINE_NAME) return 'Name must be ' + C.MAX_ENGINE_NAME + ' characters or fewer.';
    if (takenLower[name.toLowerCase()]) return 'A search engine with this name already exists.';
    return null;
  }

  function templateError(template) {
    if (!/^https?:\/\//i.test(template)) return 'URL must start with http:// or https://.';
    if (template.indexOf('%s') === -1) return 'URL must contain %s where the search terms go.';
    if (/\s/.test(template) || template.length > C.MAX_ENGINE_TEMPLATE) return 'URL is not valid.';
    /* The terms belong in the path, query or fragment: a %s in the host part
     * (or in the credentials / port before the path) would let whatever is
     * typed choose which site is contacted. */
    var authority = template.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
    if (authority.indexOf('%s') !== -1) return 'The search terms cannot be part of the host name.';
    try {
      var u = new URL(template.split('%s').join('test'));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'URL is not valid.';
    } catch (err) {
      return 'URL is not valid.';
    }
    return null;
  }

  function takenNames(customEngines, exceptId) {
    var taken = {};
    BUILTIN_ENGINES.forEach(function (e) { taken[e.name.toLowerCase()] = true; });
    customEngines.forEach(function (e) {
      if (e.id !== exceptId) taken[e.name.toLowerCase()] = true;
    });
    return taken;
  }

  function defaults() {
    return {
      tabLayout: 'horizontal',
      search: { defaultEngineId: DEFAULT_ENGINE_ID, customEngines: [] }
    };
  }

  function engineExists(settings, id) {
    var i;
    for (i = 0; i < BUILTIN_ENGINES.length; i++) if (BUILTIN_ENGINES[i].id === id) return true;
    var list = settings.search.customEngines;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }

  /* Fills gaps and drops invalid values; never throws. */
  function sanitize(raw) {
    var out = defaults();
    if (!raw || typeof raw !== 'object') return out;

    if (LAYOUTS.indexOf(raw.tabLayout) !== -1) out.tabLayout = raw.tabLayout;

    var search = raw.search;
    if (search && typeof search === 'object') {
      var list = Array.isArray(search.customEngines) ? search.customEngines : [];
      var ids = {};
      var taken = takenNames([], null);
      list.forEach(function (item) {
        if (out.search.customEngines.length >= C.MAX_CUSTOM_ENGINES) return;
        if (!item || typeof item !== 'object') return;
        var id = typeof item.id === 'string' && CUSTOM_ID_RE.test(item.id) ? item.id : null;
        var name = typeof item.name === 'string' ? item.name.trim() : '';
        var template = typeof item.template === 'string' ? item.template : '';
        if (!id || ids[id] || nameError(name, taken) || templateError(template)) return;
        ids[id] = true;
        taken[name.toLowerCase()] = true;
        out.search.customEngines.push({ id: id, name: name, template: template });
      });
      if (typeof search.defaultEngineId === 'string' && engineExists(out, search.defaultEngineId)) {
        out.search.defaultEngineId = search.defaultEngineId;
      }
    }
    return out;
  }

  Y.settingsSchema = {
    BUILTIN_ENGINES: BUILTIN_ENGINES,
    DEFAULT_ENGINE_ID: DEFAULT_ENGINE_ID,
    LAYOUTS: LAYOUTS,
    defaults: defaults,
    sanitize: sanitize,
    engineExists: engineExists,
    nameError: nameError,
    templateError: templateError,
    takenNames: takenNames
  };
})(window);
