/* A page that attacks the browser interface with crafted messages. */
import { page, send } from '../http-helpers.mjs';

/*
 * SEC-T10 probe: a proxied page reaches the container (window['to'+'p'], R1) and
 * from there the interface frame, and posts forged messages in both directions:
 * "container -> interface" ones to the interface frame, "interface -> container"
 * ones to the container. The sender is the tab page in every case, which is
 * what both ends must refuse.
 */
export function handleUiAttack(res, fixtureOrigin) {
  send(
    res,
    200,
    page(
      'UI Attack (pending)',
      `<h1>UI Attack</h1>
      <script>
        var target = ${JSON.stringify(fixtureOrigin)} + '/p3';
        var T = window['to' + 'p'];
        function post(w, m) { w['post' + 'Message'](m, '*'); } // computed: UV rewrites a literal .postMessage
        var ui = T.frames[0];
        var tab = { id: 'tab-9', url: 'https://forged.example/', title: 'FORGED TAB', favicon: null, loading: false, canGoBack: false, canGoForward: false, address: 'https://forged.example/' };
        post(ui, { type: 'ui:toast', id: 'toast-1', message: 'FORGED TOAST', actionLabel: null, timeout: 0 });
        post(ui, { type: 'ui:tabs', tabs: [tab], activeId: 'tab-9' });
        post(ui, { type: 'ui:active', tabs: [tab], activeId: 'tab-9' });
        post(ui, { type: 'ui:layout', layout: 'vertical' });
        post(ui, { type: 'ui:focusAddress' });
        post(T, { type: 'ui:new' });
        post(T, { type: 'ui:close', id: 'tab-1' });
        post(T, { type: 'ui:submit', text: target, newTab: true });
        post(T, { type: 'ui:geometry', content: { x: 0, y: 0, w: 10, h: 10 }, regions: [] });
        post(T, { type: 'ui:ready' });
        document.title = 'UI Attack Done';
      </script>`
    )
  );
}
