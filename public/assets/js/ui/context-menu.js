/*
 * The shell's context menu (#ctxmenu): a list of buttons positioned at the
 * pointer, closed by Escape, an outside click or window blur.
 *
 *   Y.ui.showContextMenu(x, y, [{ label, action, disabled? }])
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  Y.ui = Y.ui || {};

  var menuEl = null;
  var menuCleanup = null;

  function hideContextMenu() {
    if (menuCleanup) menuCleanup();
    menuCleanup = null;
    if (menuEl) {
      menuEl.hidden = true;
      menuEl.textContent = '';
    }
  }

  /* items: [{ label, action, disabled }] */
  function showContextMenu(x, y, items) {
    menuEl = menuEl || document.getElementById('ctxmenu');
    if (!menuEl) return;
    hideContextMenu();
    var buttons = [];
    items.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.disabled = !!item.disabled;
      b.addEventListener('click', function () {
        hideContextMenu();
        item.action();
      });
      menuEl.appendChild(b);
      buttons.push(b);
    });
    menuEl.hidden = false;

    var w = menuEl.offsetWidth;
    var h = menuEl.offsetHeight;
    menuEl.style.left = Math.max(4, Math.min(x, global.innerWidth - w - 4)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, global.innerHeight - h - 4)) + 'px';

    var enabled = buttons.filter(function (b) { return !b.disabled; });
    if (enabled[0]) enabled[0].focus();

    function onKey(ev) {
      if (ev.key === 'Escape') {
        hideContextMenu();
        return;
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        var i = enabled.indexOf(document.activeElement);
        i = ev.key === 'ArrowDown' ? (i + 1) % enabled.length : (i - 1 + enabled.length) % enabled.length;
        enabled[i].focus();
      }
    }
    function onOutside(ev) {
      if (!menuEl.contains(ev.target)) hideContextMenu();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    global.addEventListener('blur', hideContextMenu);
    menuCleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onOutside, true);
      global.removeEventListener('blur', hideContextMenu);
    };
  }

  Y.ui.showContextMenu = showContextMenu;
})(window);
