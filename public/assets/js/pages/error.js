(function (global) {
  'use strict';

  /* Taken at load time: the global is removed once the page has started. */
  var Y = global.Yoroxy;

  var params = new URLSearchParams(location.search);
  var type = params.get('type');
  var name = params.get('name') || '';
  var scheme = params.get('scheme') || '';

  var pages = {
    'not-found': {
      heading: "This page doesn't exist",
      detail: 'yoroxy://' + name + ' is not a valid internal page.'
    },
    'unsupported-scheme': {
      heading: "This address can't be opened",
      detail: 'The "' + scheme + ':" scheme isn\'t supported.'
    },
    'sw-failed': {
      heading: "The proxy couldn't start",
      detail: 'The service worker failed to start. Reload the page and try again.'
    }
  };
  var page = pages[type] || {
    heading: 'Something went wrong',
    detail: 'An unknown error occurred.'
  };

  /* textContent only: the parameters come from the address bar */
  document.getElementById('code').textContent = type && pages[type] ? type : 'error';
  document.getElementById('heading').textContent = page.heading;
  document.getElementById('detail').textContent = page.detail;

  document.getElementById('new-tab').addEventListener('click', function () {
    if (!Y.shellClient.newTab()) location.href = '/internal/newtab.html';
  });
  document.getElementById('reload').addEventListener('click', function () {
    /* sw-failed: start the worker again and retry the address that failed */
    var retry = params.get('url');
    if (type === 'sw-failed' && retry && /^https?:\/\//i.test(retry)) {
      Y.sw.register().then(function () {
        location.href = Y.url.encodeProxy(retry);
      }, function () {
        location.reload();
      });
      return;
    }
    location.reload();
  });
})(window);
