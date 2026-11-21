/*
 * Every inline SVG icon of the app, in one place: the shell's toolbar / tab
 * bar icons (stroked line icons) and the filled logos used on the internal
 * pages (New Tab, Settings). They are static, trusted strings, so setting
 * them with innerHTML is fine; a page title or URL must never reach here.
 *
 *   Y.icons.svg(name)             -> markup string ('' for an unknown name)
 *   Y.icons.hydrate(root)         fills every [data-icon="name"] under root
 *   Y.icons.prepend(el, name)     inserts the icon as el's first child
 *
 * Icons inherit colour from CSS (currentColor / `.discord-btn svg`).
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  /* Line icon on a 24x24 grid; the stroke style comes from CSS. */
  function stroke(body) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  var ICONS = {
    back: stroke('<path d="M15 18l-6-6 6-6"/>'),
    forward: stroke('<path d="M9 18l6-6-6-6"/>'),
    reload: stroke('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>'),
    home: stroke('<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>'),
    settings: stroke('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    plus: stroke('<path d="M12 5v14M5 12h14"/>'),
    close: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
    globe: stroke('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>'),
    tabs: stroke('<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 10h16"/>'),
    spinner: stroke('<path d="M12 3a9 9 0 1 0 9 9"/>'),
    discord:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
      '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5a6.5 6.5 0 1 0-6.5 6.5c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zM9.5 14A4.5 4.5 0 1 1 14 9.5 4.505 4.505 0 0 1 9.5 14z"/></svg>'
  };

  function svg(name) {
    return ICONS[name] || '';
  }

  function hydrate(root) {
    var nodes = root.querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) nodes[i].innerHTML = svg(nodes[i].getAttribute('data-icon'));
  }

  function prepend(el, name) {
    el.insertAdjacentHTML('afterbegin', svg(name));
  }

  Y.icons = { svg: svg, hydrate: hydrate, prepend: prepend };
})(window);
