/*
 * Favicon handling for a tab. The icon is fetched from inside the tab's own
 * frame, so the request goes through the proxy like any other subresource;
 * no third-party favicon service is ever contacted.
 *
 * `onChange(tab)` is called whenever tab.favicon changes.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  var C = Y.config;

  var RETRY_DELAY_MS = 1500;

  /*
   * The icon URL comes from the page and the response from its server, so
   * the size is bounded twice: a declared Content-Length over the limit is
   * refused before reading, and the body is read as a stream that is
   * cancelled the moment it exceeds the limit (a server may omit or lie
   * about Content-Length). Resolves to a Blob, or null when too large.
   */
  function readLimited(res) {
    var max = C.MAX_FAVICON_BYTES;
    var declared = parseInt(res.headers.get('content-length'), 10);
    if (declared > max) {
      if (res.body) res.body.cancel();
      return Promise.resolve(null);
    }
    if (!res.body) return Promise.resolve(null); // an empty response: no icon
    var reader = res.body.getReader();
    var chunks = [];
    var total = 0;
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) return new Blob(chunks, { type: res.headers.get('content-type') || '' });
        total += step.value.length;
        if (total > max) {
          reader.cancel();
          return null;
        }
        chunks.push(step.value);
        return pump();
      });
    }
    return pump();
  }

  function setFavicon(tab, src, onChange) {
    if (tab.favicon === src) return;
    tab.favicon = src;
    onChange(tab);
  }

  /*
   * The icon is kept as a data: URL, not a blob: URL: the browser interface
   * runs in a sandboxed frame with an opaque origin, which is not allowed to
   * load a blob: URL made by this origin.
   */
  function toDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function updateFavicon(tab, onChange) {
    if (tab.closed) return;
    if (tab.kind !== 'web') {
      tab.faviconSource = null;
      setFavicon(tab, null, onChange);
      return;
    }
    var win, doc;
    try {
      win = tab.iframe.contentWindow;
      doc = win.document;
    } catch (err) {
      return;
    }
    var iconUrl = null;
    try {
      var link = doc.querySelector('link[rel~="icon"]');
      if (link && link.href) iconUrl = link.href;
    } catch (err) { /* ignore */ }
    if (!iconUrl) {
      try { iconUrl = new URL('/favicon.ico', tab.url).href; } catch (err) { return; }
    }
    if (iconUrl === tab.faviconSource) return;
    tab.faviconSource = iconUrl;

    if (/^data:image\//i.test(iconUrl)) {
      setFavicon(tab, iconUrl.length <= C.MAX_FAVICON_BYTES ? iconUrl : null, onChange);
      return;
    }
    if (!/^https?:/i.test(iconUrl) || typeof win.fetch !== 'function') {
      setFavicon(tab, null, onChange);
      return;
    }
    var token = ++tab.faviconToken;
    win.fetch(iconUrl).then(function (res) {
      if (!res.ok) throw new Error('favicon ' + res.status);
      return readLimited(res);
    }).then(function (blob) {
      if (tab.closed || token !== tab.faviconToken) return;
      if (!blob) { setFavicon(tab, null, onChange); return; }
      var type = (blob.type || '').toLowerCase();
      var ok = blob.size > 0 && (type.indexOf('image/') === 0 || type === '' || type === 'application/octet-stream');
      if (!ok) { setFavicon(tab, null, onChange); return; }
      /* a missing or generic type is declared as an image; the browser recognises the format itself */
      var image = type.indexOf('image/') === 0 ? blob : new Blob([blob], { type: 'image/x-icon' });
      return toDataUrl(image).then(function (url) {
        if (tab.closed || token !== tab.faviconToken) return;
        setFavicon(tab, url, onChange);
      });
    }).catch(function () {
      if (tab.closed || token !== tab.faviconToken) return;
      setFavicon(tab, null, onChange);
    });
  }

  /*
   * Looks the icon up right away and once more shortly after. Some sites add
   * or change their <link rel="icon"> from JavaScript after the load event,
   * so the first lookup can miss it. Do not "deduplicate" the second call.
   */
  function updateFaviconWithRetry(tab, onChange) {
    updateFavicon(tab, onChange);
    setTimeout(function () {
      if (!tab.closed) updateFavicon(tab, onChange);
    }, RETRY_DELAY_MS);
  }

  Y.tabFavicon = { updateFaviconWithRetry: updateFaviconWithRetry };
})(window);
