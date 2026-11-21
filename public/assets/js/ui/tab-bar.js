/*
 * The tab bar.
 *
 * It is a single element. Horizontal / vertical is purely a CSS matter
 * (html[data-tab-layout]); the content iframes live elsewhere so a layout
 * change never reloads a tab.
 *
 * Tab titles and URLs come from web pages and are therefore untrusted: they
 * are only ever written with textContent / attributes.
 *
 *   Y.ui.createTabBar(listEl, handlers) -> { render, updateTab, setLayout }
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});
  Y.ui = Y.ui || {};

  /*
   * handlers: { onActivate(id), onClose(id), onNew(), onMove(id, index),
   *             onContext(id, x, y) }
   */
  function createTabBar(listEl, handlers) {
    var elements = {}; // tab id -> element
    var layout = 'horizontal';
    var dragId = null;

    function buildTab(tab) {
      var el = document.createElement('div');
      el.className = 'tab';
      /* role="presentation" here is required, not decorative: without it,
       * #tablist (role="tablist") would see this element - not the real
       * role="tab" one level down - as its direct child, and ARIA requires
       * a tablist's children to expose role="tab". A presentational wrapper
       * is explicitly "seen through" for that purposes. */
      el.setAttribute('role', 'presentation');
      el.setAttribute('data-id', tab.id);
      el.draggable = true;

      /* The actual role="tab" element is this inner wrapper, not `el`
       * itself: a real <button> (the close control below) must never be a
       * DOM descendant of an element exposing an interactive ARIA role —
       * accessibility tools flag that as "nested interactive" regardless
       * of tabindex/aria-hidden on the button. Keeping the button as a
       * *sibling* of `hit`, both under the plain, non-interactive `el`,
       * avoids the nesting entirely while keeping the exact same visual
       * layout (el is still the flex row painting favicon+title+close). */
      var hit = document.createElement('div');
      hit.className = 'tab-hit';
      hit.setAttribute('role', 'tab');
      el.appendChild(hit);

      var fav = document.createElement('span');
      fav.className = 'tab-favicon';
      fav.setAttribute('aria-hidden', 'true');
      hit.appendChild(fav);

      var title = document.createElement('span');
      title.className = 'tab-title';
      hit.appendChild(title);

      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      /* Kept out of normal Tab order on purpose: the tablist uses a roving
       * tabindex (one stop per tab, arrow-key navigated per FR-TAB-14), and
       * adding a second independently-tabbable control per tab would break
       * that. It's a completely ordinary, un-nested button now, so this is
       * just an authoring choice, not a workaround: closing by keyboard
       * still works via Alt+W or the "Close tab" context-menu item. */
      close.tabIndex = -1;
      /* aria-hidden removes it from the accessibility tree entirely: with
       * role="presentation" on `el` (needed so #tablist sees `hit`, not
       * `el`, as its child - see the comment above), an *unhidden* sibling
       * button would itself get "seen through" onto #tablist too, and a
       * bare <button> isn't a child role tablist allows. It stays fully
       * mouse/click operable; keyboard/AT users close a tab via Alt+W or
       * the "Close tab" context-menu item instead. */
      close.setAttribute('aria-hidden', 'true');
      close.setAttribute('aria-label', 'Close tab');
      close.title = 'Close tab';
      close.innerHTML = Y.icons.svg('close');
      el.appendChild(close);

      close.addEventListener('click', function (ev) {
        ev.stopPropagation();
        handlers.onClose(tab.id);
      });
      close.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });

      el.addEventListener('click', function () { handlers.onActivate(tab.id); });
      el.addEventListener('auxclick', function (ev) {
        if (ev.button === 1) {
          ev.preventDefault();
          handlers.onClose(tab.id);
        }
      });
      el.addEventListener('mousedown', function (ev) {
        if (ev.button === 1) ev.preventDefault(); /* no autoscroll */
      });
      el.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        handlers.onContext(tab.id, ev.clientX, ev.clientY);
      });
      hit.addEventListener('keydown', function (ev) { onTabKey(ev, tab.id); });

      el.addEventListener('dragstart', function (ev) {
        dragId = tab.id;
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', tab.id); } catch (err) { /* ignore */ }
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () {
        dragId = null;
        clearDropMarks();
        el.classList.remove('dragging');
      });
      el.tabHit = hit; /* direct reference, avoids a query on every update */
      return el;
    }

    function faviconNode(tab) {
      if (tab.loading) {
        var s = document.createElement('span');
        s.className = 'spin';
        s.innerHTML = Y.icons.svg('spinner');
        return s;
      }
      if (tab.favicon) {
        var img = document.createElement('img');
        img.alt = '';
        img.src = tab.favicon;
        img.addEventListener('error', function () {
          img.replaceWith(globeNode());
        });
        return img;
      }
      return globeNode();
    }

    function globeNode() {
      var g = document.createElement('span');
      g.innerHTML = Y.icons.svg('globe');
      return g;
    }

    function updateTab(tab, activeId) {
      var el = elements[tab.id];
      if (!el) return;
      var hit = el.tabHit;
      var active = tab.id === activeId;
      el.classList.toggle('is-active', active);
      hit.setAttribute('aria-selected', active ? 'true' : 'false');
      hit.tabIndex = active ? 0 : -1;
      el.title = tab.title + (tab.url && tab.url !== 'yoroxy://newtab' ? '\n' + tab.url : '');
      el.querySelector('.tab-title').textContent = tab.title;

      var fav = el.querySelector('.tab-favicon');
      var sig = tab.loading ? 'spin' : (tab.favicon || 'globe');
      if (fav.getAttribute('data-sig') !== sig) {
        fav.setAttribute('data-sig', sig);
        fav.textContent = '';
        fav.appendChild(faviconNode(tab));
      }
    }

    function render(tabs, activeId) {
      var seen = {};
      tabs.forEach(function (tab, index) {
        seen[tab.id] = true;
        var el = elements[tab.id];
        if (!el) {
          el = buildTab(tab);
          elements[tab.id] = el;
        }
        updateTab(tab, activeId);
        if (listEl.children[index] !== el) listEl.insertBefore(el, listEl.children[index] || null);
      });
      Object.keys(elements).forEach(function (id) {
        if (!seen[id]) {
          if (elements[id].parentNode) elements[id].parentNode.removeChild(elements[id]);
          delete elements[id];
        }
      });
      var active = elements[activeId];
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /* --- keyboard navigation (roving tabindex) --- */
    function onTabKey(ev, id) {
      var ids = Array.prototype.map.call(listEl.children, function (c) { return c.getAttribute('data-id'); });
      var i = ids.indexOf(id);
      var vertical = layout === 'vertical';
      var next = null;
      if (ev.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = ids[(i + 1) % ids.length];
      else if (ev.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = ids[(i - 1 + ids.length) % ids.length];
      else if (ev.key === 'Home') next = ids[0];
      else if (ev.key === 'End') next = ids[ids.length - 1];
      else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handlers.onActivate(id);
        return;
      }
      if (next) {
        ev.preventDefault();
        handlers.onActivate(next);
        var el = elements[next];
        if (el && el.tabHit) el.tabHit.focus();
      }
    }

    /* --- drag & drop reordering --- */
    function clearDropMarks() {
      Object.keys(elements).forEach(function (id) {
        elements[id].classList.remove('drop-before', 'drop-after');
      });
    }

    function dropPosition(ev, el) {
      var r = el.getBoundingClientRect();
      var before = layout === 'vertical'
        ? ev.clientY < r.top + r.height / 2
        : ev.clientX < r.left + r.width / 2;
      return before;
    }

    listEl.addEventListener('dragover', function (ev) {
      if (!dragId) return;
      var el = ev.target.closest ? ev.target.closest('.tab') : null;
      if (!el || el.getAttribute('data-id') === dragId) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      el.classList.add(dropPosition(ev, el) ? 'drop-before' : 'drop-after');
    });

    listEl.addEventListener('drop', function (ev) {
      if (!dragId) return;
      var el = ev.target.closest ? ev.target.closest('.tab') : null;
      if (!el) return;
      ev.preventDefault();
      var targetId = el.getAttribute('data-id');
      var before = dropPosition(ev, el);
      var ids = Array.prototype.map.call(listEl.children, function (c) { return c.getAttribute('data-id'); });
      var from = ids.indexOf(dragId);
      var to = ids.indexOf(targetId) + (before ? 0 : 1);
      if (from < to) to -= 1;
      var moved = dragId;
      dragId = null;
      clearDropMarks();
      if (from !== -1 && to !== from) handlers.onMove(moved, to);
    });

    return {
      render: render,
      updateTab: updateTab,
      setLayout: function (value) { layout = value; }
    };
  }

  Y.ui.createTabBar = createTabBar;
})(window);
