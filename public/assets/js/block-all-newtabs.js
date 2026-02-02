(() => {
  'use strict';

  function forceSameTabNavigation(e) {
    if (e.type === 'auxclick' || (e.button && e.button === 1)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }

    const a = e.target.closest('a');
    if (!a) return;

    if (a.target === '_blank' || a.hasAttribute('target')) {
      e.preventDefault();
      window.top.location.href = a.href;
    }
  }

  document.addEventListener('click', forceSameTabNavigation, true);
  document.addEventListener('auxclick', forceSameTabNavigation, true);
  document.addEventListener('mousedown', forceSameTabNavigation, true);

  const originalWindowOpen = window.open;
  window.open = function(url, name, specs) {
    if (url) window.top.location.href = url;
    return null;
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (name === 'target' && value === '_blank') {
      value = '_self';
    }
    return originalSetAttribute.call(this, name, value);
  };

})();
