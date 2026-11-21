/* Pages that probe what a proxied page can reach or see: XSS-shaped input, the shell's globals, the CSP. */
import { page, send } from '../http-helpers.mjs';

export function handleXssTitle(res) {
  send(
    res,
    200,
    page(
      'XSS Title (pre)',
      '<h1>XSS Title</h1><script>document.title = "<img src=x onerror=alert(1)>";</script>'
    )
  );
}

export function handleXssFavicon(res) {
  const evilText = '<img src=x onerror=alert(1)>';
  send(
    res,
    200,
    page(
      'XSS Favicon',
      `<h1>XSS Favicon</h1><a id="evil" href="/p2" title="${evilText.replace(/"/g, '&quot;')}">${evilText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`,
      '<link rel="icon" href="/large-favicon.bin">'
    )
  );
}

export function handleTopProbe(res) {
  send(
    res,
    200,
    page(
      'Top Probe (pending)',
      `<h1>Top Probe</h1><pre id="result">pending</pre>
      <script>
        var out = {};
        try { out.hasYoroxyShell = typeof window.top.__yoroxyShell !== 'undefined'; }
        catch (e) { out.topAccessThrew = true; }
        try { out.canSeeAddressBar = !!(window.top.document && window.top.document.getElementById('address')); }
        catch (e) { out.addressAccessThrew = true; }
        document.title = 'Top Probe Done';
        document.getElementById('result').textContent = JSON.stringify(out);
      </script>`
    )
  );
}

/*
 * SEC-T1 probe. The script runs as the page's own <script>, so it goes through
 * Ultraviolet's JS rewriting like any real site's would. For each of 13 ways
 * of getting hold of the shell it reports whether the object it obtained is
 * the shell document (the one containing #address). The numbering is the one
 * in the refactoring spec's appendix A/B.
 */
export function handleReachProbe(res) {
  send(
    res,
    200,
    page(
      'Reach Probe (pending)',
      `<h1>Reach Probe</h1><pre id="result">pending</pre>
      <script>
        var out = {};
        var ui = {};
        // The container document has the interface iframe (#ui); the interface document has the address bar.
        function isContainer(d) { return !!(d && d.getElementById && d.getElementById('ui')); }
        function isInterface(d) { return !!(d && d.getElementById && d.getElementById('address')); }
        // fn returns the document the technique ended up with (or throws / returns nothing)
        function reach(n, fn) {
          var d = null;
          try { d = fn(); } catch (e) { d = null; }
          var c = false, i = false;
          try { c = isContainer(d); } catch (e) {}
          try { i = isInterface(d); } catch (e) {}
          out[n] = c;
          ui[n] = i;
        }
        function viaTop(t) { return t.document; }
        var gopd = Object.getOwnPropertyDescriptor;
        var gopds = Object.getOwnPropertyDescriptors;

        reach(1, function () { return window.frameElement.ownerDocument; });
        reach(2, function () { return viaTop(gopd(window, 'top').get.call(window)); });
        reach(3, function () { return viaTop(Reflect.get(window, 'top')); });
        reach(4, function () { return viaTop(window['to' + 'p']); });
        reach(5, function () { return viaTop(new Function('return top')()); });
        reach(6, function () { return viaTop((0, eval)('top')); });
        reach(7, function () { return viaTop(gopds(window).top.get.call(window)); });
        reach(8, function () { return viaTop(Reflect.get(window, 'parent')); });

        var f = document.createElement('iframe');
        document.body.appendChild(f);
        var w = f.contentWindow;
        reach(9, function () { return w.frameElement.ownerDocument; });
        reach(10, function () { return viaTop(w['to' + 'p']); });
        reach(11, function () { return viaTop(w.Object.getOwnPropertyDescriptor(w, 'top').get.call(w)); });
        reach(12, function () { return viaTop(w.Function('return top')()); });
        reach(13, function () { return viaTop(w.Reflect.get(w, 'parent')); });

        // The interface itself, from the container (what #4 / #10 obtain): every way in must be refused.
        var T = window['to' + 'p'];
        var uiAccess = {};
        function attempt(name, fn) { try { uiAccess[name] = !!fn(); } catch (e) { uiAccess[name] = false; } }
        // control: the interface frame is there and is a window we may talk to, just not read
        attempt('exists', function () { return T.frames.length >= 1 && typeof T.frames[0]['post' + 'Message'] === 'function'; });
        attempt('framesDocument', function () { return isInterface(T.frames[0].document); });
        attempt('namedFrameDocument', function () { return isInterface(T.frames['ui'].document); });
        attempt('contentDocument', function () { return isInterface(T.document.getElementById('ui').contentDocument); });
        attempt('contentWindowDocument', function () { return isInterface(T.document.getElementById('ui').contentWindow.document); });
        attempt('globalYoroxy', function () { return T.frames[0].Yoroxy; });
        attempt('globalDocument', function () { return T.frames[0].document.body; });
        attempt('globalLocationHref', function () { return typeof T.frames[0].location.href === 'string'; });

        document.title = 'Reach Probe Done';
        document.getElementById('result').textContent = JSON.stringify({ container: out, ui: ui, uiAccess: uiAccess });
      </script>`
    )
  );
}

/*
 * SEC-T2 probe. Reaches the shell through the computed-name route that cannot
 * be blocked (window['to'+'p'], residual risk R1) and tries every way of
 * making the shell run code of the attacker's choosing. Each attempt, if it
 * runs, sets a flag on the shell's window; the test reads the flags from there.
 */
export function handleCspProbe(res) {
  send(
    res,
    200,
    page(
      'CSP Probe (pending)',
      `<h1>CSP Probe</h1><pre id="result">pending</pre>
      <script>
        var T = window['to' + 'p'];
        var out = {};
        function attempt(name, fn) {
          try { fn(); } catch (e) { out[name] = e.name; }
        }
        attempt('Function', function () { T.Function('window.__csp_fn = 1')(); });
        attempt('timer', function () { T.setTimeout('window.__csp_timer = 1', 0); });
        attempt('inline', function () {
          var s = T.document.createElement('script');
          s.textContent = 'window.__csp_inline = 1';
          T.document.body.appendChild(s);
        });
        attempt('onerror', function () {
          T.document.body.insertAdjacentHTML('beforeend', '<img src="x:" onerror="window.__csp_onerror = 1">');
        });
        setTimeout(function () {
          document.title = 'CSP Probe Done';
          document.getElementById('result').textContent = JSON.stringify(out);
        }, 500);
      </script>`
    )
  );
}

/* SEC-T3 probe: what does a page that has reached the shell find there? */
export function handleExposureProbe(res) {
  send(
    res,
    200,
    page(
      'Exposure Probe (pending)',
      `<h1>Exposure Probe</h1><pre id="result">pending</pre>
      <script>
        var T = window['to' + 'p'];
        var out = {};
        out.namespace = typeof T.Yoroxy;
        out.keys = Object.keys(T.__yoroxyShell);
        out.names = Object.getOwnPropertyNames(T.__yoroxyShell).sort();
        try { T.__yoroxyShell = { fake: true }; } catch (e) { out.assignThrew = true; }
        out.replaced = !!(T.__yoroxyShell && T.__yoroxyShell.fake);
        out.frozen = Object.isFrozen(T.__yoroxyShell);
        document.title = 'Exposure Probe Done';
        document.getElementById('result').textContent = JSON.stringify(out);
      </script>`
    )
  );
}

/*
 * SEC-T11 probe: a proxied page forging the messages internal pages send to
 * the shell. None may have any effect.
 */
export function handleMsgProbe(res, fixtureOrigin) {
  send(
    res,
    200,
    page(
      'Msg Probe (pending)',
      `<h1>Msg Probe</h1>
      <script>
        var target = ${JSON.stringify(fixtureOrigin)} + '/p3';
        var T = window['to' + 'p']; // the real shell window (see SEC-T1, #4)
        var messages = [
          { type: 'yoroxy:submit', text: target },
          { type: 'yoroxy:newTab' },
          { type: 'yoroxy:settingsChanged' }
        ];
        // (computed name: UV rewrites a literal .postMessage( call into one the real shell lacks)
        messages.forEach(function (m) { T['post' + 'Message'](m, '*'); });
        document.title = 'Msg Probe Done';
      </script>`
    )
  );
}
