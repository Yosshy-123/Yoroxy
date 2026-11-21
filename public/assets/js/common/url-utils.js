/*
 * Yoroxy URL helpers, shared by the shell and the internal pages.
 *
 *   resolve()        address-bar input   -> navigation descriptor
 *   internalPath()   descriptor          -> real path of an internal page
 *   encodeProxy()    real URL            -> /uv/service/<encoded>
 *   fromLocation()   iframe location     -> { kind, url } for display
 *   appOrigin()      this app's origin (correct inside about:blank too)
 *
 * Note: the shell may run inside an about:blank document, where
 * location.origin is "null". Use window.origin / document.baseURI instead.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  var INTERNAL_PAGES = Object.freeze({
    newtab: '/internal/newtab.html',
    settings: '/internal/settings.html',
    error: '/internal/error.html'
  });

  var UNSUPPORTED_SCHEME_RE = /^(javascript|data|file|ftp|blob|vbscript|view-source|chrome):/i;
  var HOST_RE = /^((\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z]{2,})(:\d+)?([/?#].*)?$/i;

  function uvConfig() {
    var cfg = global.__uv$config;
    if (!cfg) throw new Error('Ultraviolet config is not loaded');
    return cfg;
  }

  /* Absolute URL for a site-relative path (works inside about:blank + <base>). */
  function abs(path) {
    return new URL(path, document.baseURI).href;
  }

  /*
   * This app's origin, also inside an about:blank document (where
   * location.origin is "null"): the origin of the base URL.
   */
  function appOrigin() {
    return new URL('/', document.baseURI).origin;
  }

  function isInternalName(name) {
    return Object.prototype.hasOwnProperty.call(INTERNAL_PAGES, name);
  }

  /* ------------------------------------------------------------ resolving */

  /*
   * Returns one of
   *   { kind: 'none' }
   *   { kind: 'internal', name, search, hash }
   *   { kind: 'error', type: 'not-found' | 'unsupported-scheme', name?, scheme? }
   *   { kind: 'blank' }
   *   { kind: 'web', url, via: 'url' | 'host' | 'search' }
   */
  function resolve(input, settings) {
    var text = String(input == null ? '' : input).trim();

    /* 1. empty */
    if (!text) return { kind: 'none' };

    /* 2-3. yoroxy:// */
    if (/^yoroxy:\/\//i.test(text) && !/\s/.test(text)) {
      var name = '';
      var search = '';
      var hash = '';
      try {
        var iu = new URL(text);
        name = iu.hostname.toLowerCase();
        search = iu.search;
        hash = iu.hash;
      } catch (err) {
        return { kind: 'error', type: 'not-found', name: '' };
      }
      if (isInternalName(name)) return { kind: 'internal', name: name, search: search, hash: hash };
      return { kind: 'error', type: 'not-found', name: name };
    }

    /* 4. about:blank */
    if (/^about:blank$/i.test(text)) return { kind: 'blank' };

    /* 5. http(s) URL */
    if (/^https?:\/\/\S+$/i.test(text)) {
      try {
        return { kind: 'web', url: new URL(text).href, via: 'url' };
      } catch (err) { /* fall through to search */ }
    } else {
      /* 6. known unsupported schemes */
      var sm = UNSUPPORTED_SCHEME_RE.exec(text);
      if (sm) return { kind: 'error', type: 'unsupported-scheme', scheme: sm[1].toLowerCase() };

      /* 7. host-like input */
      if (!/\s/.test(text) && HOST_RE.test(text)) {
        try {
          return { kind: 'web', url: new URL('https://' + text).href, via: 'host' };
        } catch (err) { /* fall through to search */ }
      }
    }

    /* 8. search */
    var engine = Y.settings.getDefaultEngine(settings);
    return { kind: 'web', url: Y.settings.buildSearchUrl(engine, text), via: 'search', engine: engine };
  }

  /* ----------------------------------------------------- internal / proxy */

  function internalPath(desc) {
    if (desc.kind === 'internal') {
      return INTERNAL_PAGES[desc.name] + (desc.search || '') + (desc.hash || '');
    }
    if (desc.kind === 'error') {
      var p = new URLSearchParams();
      p.set('type', desc.type);
      if (desc.name != null) p.set('name', desc.name);
      if (desc.scheme) p.set('scheme', desc.scheme);
      if (desc.url) p.set('url', desc.url);
      return INTERNAL_PAGES.error + '?' + p.toString();
    }
    return INTERNAL_PAGES.newtab;
  }

  function encodeProxy(url) {
    var cfg = uvConfig();
    return cfg.prefix + cfg.encodeUrl(url);
  }

  function decodeProxy(rest) {
    return uvConfig().decodeUrl(rest);
  }

  /*
   * Maps the real location of a tab's iframe to what the user should see.
   * Returns { kind: 'blank' | 'internal' | 'web', url, name? }.
   */
  function fromLocation(href) {
    if (!href || href === 'about:blank') return { kind: 'blank', url: 'about:blank' };
    var u;
    try {
      u = new URL(href);
    } catch (err) {
      return { kind: 'web', url: String(href) };
    }
    var name;
    for (name in INTERNAL_PAGES) {
      if (Object.prototype.hasOwnProperty.call(INTERNAL_PAGES, name) && u.pathname === INTERNAL_PAGES[name]) {
        return {
          kind: 'internal',
          name: name,
          url: 'yoroxy://' + name + (name === 'error' ? u.search : '') + u.hash
        };
      }
    }
    var prefix = uvConfig().prefix;
    if (u.pathname.indexOf(prefix) === 0) {
      var rest = u.pathname.slice(prefix.length) + u.search + u.hash;
      try {
        return { kind: 'web', url: decodeProxy(rest) };
      } catch (err) {
        return { kind: 'web', url: href };
      }
    }
    return { kind: 'web', url: href };
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (err) {
      return '';
    }
  }

  Y.url = {
    abs: abs,
    appOrigin: appOrigin,
    resolve: resolve,
    internalPath: internalPath,
    encodeProxy: encodeProxy,
    fromLocation: fromLocation,
    hostOf: hostOf
  };
})(window);
