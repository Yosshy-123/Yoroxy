/*
 * Settings page: search-engine list rendering (rows and the inline edit
 * form) plus the small DOM helpers the page shares with it.
 *
 *   Y.settingsEngineView.showError / setInvalid        DOM helpers
 *   Y.settingsEngineView.create(opts)                  -> { render(settings), stopEditing() }
 *     opts = { listEl, showNotice(message), rerender() }
 */
(function (global) {
  'use strict';

  var Y = global.Yoroxy;
  var C = Y.config;
  var S = Y.settings;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === false || value == null) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function showError(node, message) {
    node.textContent = message || '';
    node.hidden = !message;
  }

  function setInvalid(input, invalid) {
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function create(opts) {
    var editingId = null;

    function renderEngineRow(engine, settings) {
      var isDefault = settings.search.defaultEngineId === engine.id;

      if (editingId === engine.id) return renderEditRow(engine);

      var radio = el('input', { type: 'radio', name: 'default-engine', value: engine.id });
      radio.checked = isDefault;
      radio.addEventListener('change', function () {
        if (radio.checked) {
          opts.showNotice('');
          S.setDefaultEngine(engine.id);
        }
      });

      var nameLine = el('span', { class: 'engine-name' }, [el('span', { text: engine.name })]);
      if (engine.builtin) nameLine.appendChild(el('span', { class: 'pill', text: 'Built-in' }));
      if (isDefault) nameLine.appendChild(el('span', { class: 'pill pill-default', text: 'Default' }));

      var urlLine = el('span', { class: 'engine-url', text: engine.template });
      var row = el('div', { class: 'engine', 'data-id': engine.id }, [
        el('label', { class: 'engine-main' }, [radio, nameLine, urlLine])
      ]);

      if (!engine.builtin) {
        var edit = el('button', { type: 'button', class: 'btn btn-small', text: 'Edit', 'aria-label': 'Edit ' + engine.name });
        edit.addEventListener('click', function () {
          editingId = engine.id;
          opts.rerender();
        });
        var del = el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Delete', 'aria-label': 'Delete ' + engine.name });
        del.addEventListener('click', function () {
          var res = S.deleteEngine(engine.id);
          opts.showNotice(res.resetDefault ? 'The default search engine was reset to Startpage.' : '');
        });
        row.appendChild(el('span', { class: 'engine-actions' }, [edit, del]));
      }
      return row;
    }

    function renderEditRow(engine) {
      var nameInput = el('input', { type: 'text', id: 'edit-name', value: engine.name, maxlength: String(C.MAX_ENGINE_NAME), autocomplete: 'off', spellcheck: 'false' });
      var urlInput = el('input', { type: 'text', id: 'edit-url', value: engine.template, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
      var nameError = el('p', { class: 'field-error', role: 'alert', hidden: true });
      var urlError = el('p', { class: 'field-error', role: 'alert', hidden: true });
      var generalError = el('p', { class: 'field-error', role: 'alert', hidden: true });

      var form = el('form', { class: 'engine-edit', novalidate: true }, [
        el('div', { class: 'field' }, [el('label', { for: 'edit-name', text: 'Name' }), nameInput, nameError]),
        el('div', { class: 'field' }, [
          el('label', { for: 'edit-url', text: 'Search URL' }),
          urlInput,
          el('p', { class: 'field-help', text: 'Use %s where the search terms should go. Example: https://example.com/search?q=%s' }),
          urlError
        ]),
        generalError,
        el('div', { class: 'actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-small', text: 'Save' }),
          el('button', { type: 'button', class: 'btn btn-small', text: 'Cancel', 'data-action': 'cancel' })
        ])
      ]);

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var res = S.updateEngine(engine.id, { name: nameInput.value, template: urlInput.value });
        if (res.ok) {
          editingId = null;
          opts.rerender();
          return;
        }
        showError(nameError, res.errors.name);
        showError(urlError, res.errors.template);
        showError(generalError, res.errors.general);
        setInvalid(nameInput, !!res.errors.name);
        setInvalid(urlInput, !!res.errors.template);
        (res.errors.name ? nameInput : urlInput).focus();
      });
      form.querySelector('[data-action="cancel"]').addEventListener('click', function () {
        editingId = null;
        opts.rerender();
      });

      var row = el('div', { class: 'engine', 'data-id': engine.id }, [form]);
      setTimeout(function () { nameInput.focus(); }, 0);
      return row;
    }

    function renderEngines(settings) {
      opts.listEl.textContent = '';
      S.getEngines(settings).forEach(function (engine) {
        opts.listEl.appendChild(renderEngineRow(engine, settings));
      });
    }

    return {
      render: renderEngines,
      stopEditing: function () { editingId = null; }
    };
  }

  Y.settingsEngineView = { showError: showError, setInvalid: setInvalid, create: create };
})(window);
