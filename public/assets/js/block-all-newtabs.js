(() => {
  'use strict';

  window.open = function (url) {
    if (url) location.href = url;
    return null;
  };

  function block(e) {
    if (e.button === 1) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }

  document.addEventListener('auxclick', block, true);
  document.addEventListener('mousedown', block, true);

  document.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;

    if (a.target === '_blank') {
      e.preventDefault();
      location.href = a.href;
    }
  }, true);

  const _set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) {
    if (k === 'target' && v === '_blank') v = '_self';
    return _set.call(this, k, v);
  };
})();
