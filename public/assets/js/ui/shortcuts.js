/*
 * The shell's keyboard shortcuts. They work while focus is in the browser
 * interface (not inside a tab's page). Ctrl+T/W/N are reserved by browsers, so
 * Alt-based keys are used:
 *
 *   Alt+T         new tab            Alt+W   close the active tab
 *   Alt+L         focus the address bar
 *   Alt+1..8      tab by position    Alt+9   the last tab
 *   Escape        close the tab drawer
 *
 *   Y.installShortcuts({ newTab(), closeActive(), focusAddress(),
 *                        closeDrawer(), activateAt(n) })
 *
 * activateAt(n): n is 1..8 for that position, 9 for the last tab.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function installShortcuts(deps) {
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        deps.closeDrawer();
        return;
      }
      if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      if (ev.code === 'KeyT') {
        ev.preventDefault();
        deps.newTab();
      } else if (ev.code === 'KeyW') {
        ev.preventDefault();
        deps.closeActive();
      } else if (ev.code === 'KeyL') {
        ev.preventDefault();
        deps.focusAddress();
      } else if (/^Digit[1-9]$/.test(ev.code)) {
        ev.preventDefault();
        deps.activateAt(Number(ev.code.slice(5)));
      }
    });
  }

  Y.installShortcuts = installShortcuts;
})(window);
