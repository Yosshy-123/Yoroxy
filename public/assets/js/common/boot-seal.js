/*
 * Removes the window.Yoroxy namespace once a page has finished starting.
 *
 * Every script of the app registers itself on window.Yoroxy, which is how
 * they find each other while loading. Left in place it would hand a page
 * that reaches this window (see SECURITY.md, R1) every internal function; so
 * this script - which must be the LAST script of every page that loads the
 * others - deletes it. Code that needs the namespace later captured it (or
 * what it needs from it) into a local variable while loading.
 *
 * Test mode (the server sets data-yoroxy-test="1" on <html>, see
 * src/server/pages/page-registry.js) keeps the namespace so the E2E suite can use it.
 */
(function (global) {
  'use strict';

  if (global.document.documentElement.getAttribute('data-yoroxy-test') === '1') return;
  try {
    delete global.Yoroxy;
  } catch (err) { /* not configurable: nothing more to do */ }
})(window);
