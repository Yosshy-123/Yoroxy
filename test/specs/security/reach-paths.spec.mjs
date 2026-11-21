/*
 * SEC-T1 / SEC-T10: ways a proxied page can get hold of the shell.
 *
 * The fixture's /reach-probe page tries 13 techniques from its own script
 * (see handleReachProbe in the fixture server) and reports, per technique,
 * whether it ended up with the container's document (the page that holds the
 * tab frames) and whether it ended up with the interface's document (the tab
 * bar and address bar, in a sandboxed frame). The expected map is what the
 * hardening of uv.handler.js achieves:
 *
 *   - 11 techniques are blocked by yoroxyHarden() in uv.handler.js (or never
 *     worked: #5, #6, #9, #12, #13);
 *   - #4 and #10 (window['to'+'p'], also from a fresh iframe) cannot be
 *     blocked while the shell and the proxied page share an origin. They are
 *     the known residual risk R1 (see SECURITY.md); the shell's own
 *     protection against them is the CSP and the small bridge surface.
 *
 * The snapshot is exact on purpose: if #4 or #10 ever stop reaching the
 * shell, that is a change worth noticing and the spec must be updated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withFailureArtifacts } from '../../support/failure-artifacts.mjs';
import { covers } from '../../support/traceability.mjs';
import { activeFrame, withShellTest } from '../../support/shell.mjs';

const REACHED = new Set([4, 10]);
const EXPECTED = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, REACHED.has(i + 1)]));

describe('security: reaching the shell from a proxied page', () => {
  it('SEC-T1 / SEC-T10: only the two known residual techniques reach the container, none reaches the interface', async () => {
    covers('SEC-T1', ['SECURITY-REACH-PATHS']);
    covers('SEC-T10', ['SECURITY-UI-ISOLATION']);
    await withShellTest({ loadPath: '/reach-probe' }, async (page) => {
      await withFailureArtifacts('SEC-T1', page, async () => {
        const frame = await activeFrame(page);
        await frame.waitForFunction(() => document.title === 'Reach Probe Done');
        const seen = JSON.parse(await frame.textContent('#result'));
        assert.deepEqual(seen.container, EXPECTED, 'which techniques obtain the container document');
        // SEC-T10: none of the 13 reaches the interface document, residual ones included
        assert.deepEqual(seen.ui, Object.fromEntries(Object.keys(EXPECTED).map((k) => [k, false])), 'the interface is unreachable');
        // ... and neither is it reachable from the container the residual techniques do reach
        const refused = Object.fromEntries(Object.keys(seen.uiAccess).map((k) => [k, false]));
        assert.equal(seen.uiAccess.exists, true, 'control: the interface frame exists and can be addressed');
        refused.exists = true;
        assert.deepEqual(seen.uiAccess, refused, 'frames[0], #ui.contentDocument/contentWindow.document and the interface globals are cross-origin');
      });
    });
  });

  it('SEC-T1b: hardening leaves unrelated window properties alone', async () => {
    covers('SEC-T1b', ['SECURITY-REACH-PATHS']);
    await withShellTest({ loadPath: '/reach-probe' }, async (page) => {
      await withFailureArtifacts('SEC-T1b', page, async () => {
        const frame = await activeFrame(page);
        await frame.waitForFunction(() => document.title === 'Reach Probe Done');
        // 'constructor' / 'toString' / '__proto__' are inherited names that a plain-object lookup would wrongly treat as guarded.
        const same = await frame.evaluate(() => ({
          constructor: Reflect.get(window, 'constructor') === window.constructor,
          toString: Reflect.get(window, 'toString') === window.toString,
          proto: Reflect.get(window, '__proto__') === Object.getPrototypeOf(window),
          document: Reflect.get(window, 'document') === window.document,
          descConstructor: Object.getOwnPropertyDescriptor(window, 'document') !== undefined,
          symbol: Reflect.get(window, Symbol.toStringTag) === window[Symbol.toStringTag],
          guardedSelf: Reflect.get(window, 'top') === window && Reflect.get(window, 'parent') === window,
          frameElement: window.frameElement === null,
        }));
        assert.deepEqual(same, Object.fromEntries(Object.keys(same).map((k) => [k, true])));
      });
    });
  });
});
