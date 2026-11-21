/*
 * Text helpers shared by the container and the pages.
 *
 *   Y.text.truncate(text, max) -> string of at most `max` UTF-16 units
 *
 * Page titles, URLs and the like come from other sites and can be arbitrarily
 * long, so they are cut before they are stored or sent. The cut never leaves
 * half of a surrogate pair (one emoji, say) at the end.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function truncate(text, max) {
    text = String(text == null ? '' : text);
    if (!(max > 0)) return '';
    if (text.length <= max) return text;
    var end = max;
    var last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1; // a high surrogate: its pair would be cut off
    return text.slice(0, end);
  }

  Y.text = Object.freeze({ truncate: truncate });
})(window);
