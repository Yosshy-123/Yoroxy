/*
 * Settings page (yoroxy://settings): wiring only - events, dialog, hash
 * scrolling. Engine rows are rendered by settings-engine-view.js.
 *
 * All changes are saved and applied immediately (through SettingsStore);
 * only adding / editing a custom search engine uses an explicit button.
 */
(function (global) {
  'use strict';

  var Y = global.Yoroxy;
  var C = Y.config;
  var S = Y.settings;
  var View = Y.settingsEngineView;
  var showError = View.showError;
  var setInvalid = View.setInvalid;

  function $(id) {
    return document.getElementById(id);
  }

  var listEl = $('engine-list');
  var noticeEl = $('engine-notice');

  /* ------------------------------------------------------------ utilities */

  function showNotice(message) {
    noticeEl.textContent = message || '';
    noticeEl.hidden = !message;
  }

  /* ------------------------------------------------------------ appearance */

  function renderLayout(settings) {
    var radios = document.querySelectorAll('input[name="tab-layout"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === settings.tabLayout;
  }

  document.querySelectorAll('input[name="tab-layout"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      if (radio.checked) S.setTabLayout(radio.value);
    });
  });

  /* --------------------------------------------------------------- engines */

  var engineView = View.create({ listEl: listEl, showNotice: showNotice, rerender: function () { render(); } });

  /* ---------------------------------------------------------- add engine */

  var addForm = $('add-form');
  var addName = $('add-name');
  addName.maxLength = C.MAX_ENGINE_NAME; /* same limit the schema enforces */
  var addUrl = $('add-url');

  addForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var res = S.addEngine({ name: addName.value, template: addUrl.value });
    showError($('add-name-error'), res.errors && res.errors.name);
    showError($('add-url-error'), res.errors && res.errors.template);
    showError($('add-general-error'), res.errors && res.errors.general);
    setInvalid(addName, !!(res.errors && res.errors.name));
    setInvalid(addUrl, !!(res.errors && res.errors.template));
    if (res.ok) {
      addForm.reset();
      showNotice('');
      addName.focus();
    } else if (res.errors.name) {
      addName.focus();
    } else if (res.errors.template) {
      addUrl.focus();
    }
  });

  /* --------------------------------------------------------------- reset */

  var dialog = $('reset-dialog');

  $('reset-btn').addEventListener('click', function () {
    dialog.showModal();
  });

  dialog.addEventListener('close', function () {
    if (dialog.returnValue === 'reset') doReset();
  });

  function doReset() {
    engineView.stopEditing();
    showNotice('');
    S.reset();
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var settings = S.load();
    renderLayout(settings);
    engineView.render(settings);
    $('storage-warning').hidden = S.isPersistent();
  }

  function scrollToHash() {
    var id = global.location.hash.replace(/^#/, '');
    if (id !== 'appearance' && id !== 'search' && id !== 'about') return;
    var target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: 'start' });
  }

  Y.pages.initDiscordLink($('discord-link'));
  S.onChange(render);
  global.addEventListener('hashchange', scrollToHash);
  render();
  scrollToHash();
})(window);
