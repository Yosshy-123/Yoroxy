/*
 * Unit tests for browser scripts that are pure logic. No browser: each script
 * is evaluated in a bare vm context with a `window` object, as the page would.
 *
 * R-UNIT-01  text.js        truncate
 * R-UNIT-02  validators.js  message validation
 * R-UNIT-03  tab-view.js    the view of a tab given to the interface
 * R-UNIT-04  toast-registry.js
 * R-UNIT-05  settings/engines.js  ids of custom search engines
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { covers } from '../../support/traceability.mjs';

const JS = new URL('../../../public/assets/js/', import.meta.url);

/* Loads the scripts, in order, into one context; returns the Yoroxy namespace. */
function load(...files) {
  const win = { crypto: webcrypto }; // what a page's window has
  const context = vm.createContext({ window: win, console, URL });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(f, JS), 'utf8'), context, { filename: f });
  return win.Yoroxy;
}

/* Objects made inside the vm context have another Object.prototype: compare as data. */
const plain = (v) => JSON.parse(JSON.stringify(v));

describe('browser units', () => {
  it('R-UNIT-01: truncate cuts at the limit and never splits a surrogate pair', () => {
    covers('R-UNIT-01', ['REFACTOR-UNITS']);
    const { truncate } = load('common/text.js').text;
    assert.equal(truncate('', 5), '');
    assert.equal(truncate(null, 5), '');
    assert.equal(truncate(undefined, 5), '');
    assert.equal(truncate(12345, 3), '123');
    assert.equal(truncate('abcd', 0), '');
    assert.equal(truncate('abcd', -1), '');
    assert.equal(truncate('abcd', 4), 'abcd', 'exactly the limit');
    assert.equal(truncate('abcd', 3), 'abc', 'one over the limit');
    assert.equal(truncate('a😀', 3), 'a😀', 'the pair fits');
    assert.equal(truncate('a😀', 2), 'a', 'the limit falls inside the pair: drop the whole pair');
    assert.equal(truncate('😀😀', 1), '');
    for (let max = 0; max <= 12; max++) {
      const out = truncate('x😀y😀z😀😀😀', max);
      assert.ok(out.length <= max, `length ${out.length} <= ${max}`);
      const last = out.charCodeAt(out.length - 1);
      assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'no lone high surrogate at the end');
    }
  });

  it('R-UNIT-02: validate accepts exactly the declared shape and returns a clean copy', () => {
    covers('R-UNIT-02', ['REFACTOR-UNITS']);
    const { validate, V, isPlainObject } = load('protocol/validators.js').validators;
    const table = {
      'm:a': { n: V.int(0, 10), s: V.str(3), flag: V.bool, pick: V.oneOf(['x', 'y']), maybe: V.nullable(V.str(2)) },
      'm:list': { items: V.list(V.int(0, 1), 2) },
      'm:none': {},
    };
    const good = { type: 'm:a', n: 10, s: 'abc', flag: false, pick: 'y', maybe: null };
    const copy = validate(table, good);
    assert.deepEqual(plain(copy), good);
    assert.notEqual(copy, good, 'a copy, not the received object');

    const bad = (patch) => validate(table, { ...good, ...patch });
    assert.equal(bad({ n: 11 }), null, 'int above the limit');
    assert.equal(bad({ n: -1 }), null, 'int below the limit');
    assert.equal(bad({ n: 1.5 }), null, 'not an integer');
    assert.equal(bad({ n: NaN }), null);
    assert.equal(bad({ n: Infinity }), null);
    assert.equal(bad({ n: '1' }), null, 'wrong type');
    assert.equal(bad({ s: 'abcd' }), null, 'string one over the limit');
    assert.equal(bad({ pick: 'z' }), null);
    assert.equal(bad({ maybe: 'abc' }), null);
    assert.equal(bad({ extra: 1 }), null, 'extra field');
    const { n, ...missing } = good;
    assert.equal(validate(table, missing), null, 'missing field');
    void n;

    assert.equal(validate(table, { type: 'nope' }), null, 'unknown type');
    for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(validate(table, { type }), null, `type ${type} is not inherited into the table`);
    }
    assert.equal(validate(table, JSON.parse('{"type":"m:none","__proto__":{"x":1}}')), null, 'an own "__proto__" key counts as an extra field');
    assert.deepEqual(plain(validate(table, { type: 'm:none' })), { type: 'm:none' });
    for (const notAnObject of [null, undefined, 'm:none', 7, [], [{ type: 'm:none' }], new Date(), new Map()]) {
      assert.equal(validate(table, notAnObject), null, String(notAnObject));
    }
    assert.equal(validate(table, Object.assign(Object.create({ inherited: 1 }), { type: 'm:none' })), null, 'not a plain object');
    assert.ok(isPlainObject(Object.create(null)));

    assert.ok(validate(table, { type: 'm:list', items: [1, 0] }), 'list at its limit');
    assert.equal(validate(table, { type: 'm:list', items: [1, 0, 1] }), null, 'list one over the limit');
    assert.equal(validate(table, { type: 'm:list', items: [1, 2] }), null, 'a bad item');
    assert.equal(validate(table, { type: 'm:list', items: 'ab' }), null, 'not an array');
  });

  it('R-UNIT-03: viewOf cuts every string, keeps only sane data: icons, and coerces flags', () => {
    covers('R-UNIT-03', ['REFACTOR-UNITS']);
    const Y = load('common/config.js', 'common/text.js', 'container/tab-view.js');
    const C = Y.config;
    const base = { id: 'tab-1', url: 'https://example.com/', title: 'T', favicon: null, loading: 1, canGoBack: 0, canGoForward: undefined, kind: 'web' };
    const view = (patch) => plain(Y.tabView.viewOf({ ...base, ...patch }));

    assert.deepEqual(view({}), {
      id: 'tab-1', url: 'https://example.com/', title: 'T', favicon: null,
      loading: true, canGoBack: false, canGoForward: false, address: 'https://example.com/',
    });
    assert.equal(view({ title: 'x'.repeat(C.MAX_TAB_TITLE + 100) }).title.length, C.MAX_TAB_TITLE);
    assert.equal(view({ title: 'x'.repeat(C.MAX_TAB_TITLE) }).title.length, C.MAX_TAB_TITLE);
    const long = view({ url: 'u'.repeat(C.MAX_BRIDGE_URL + 5) });
    assert.equal(long.url.length, C.MAX_BRIDGE_URL);
    assert.equal(long.address.length, C.MAX_BRIDGE_URL);
    assert.equal(view({ kind: 'internal', internalName: 'newtab', url: 'https://x/internal/newtab.html' }).address, '');
    assert.equal(view({ kind: 'internal', internalName: 'settings', url: 'https://x/s' }).address, 'https://x/s');

    const prefix = 'data:image/png;base64,';
    const atLimit = prefix + 'A'.repeat(C.MAX_FAVICON_DATA_URL - prefix.length);
    assert.equal(view({ favicon: atLimit }).favicon, atLimit, 'an icon exactly at the limit');
    assert.equal(view({ favicon: atLimit + 'A' }).favicon, null, 'one character over');
    for (const bad of ['javascript:alert(1)', 'http://x/i.png', 'blob:http://x/1', 'data:text/html,<b>', 42, {}]) {
      assert.equal(view({ favicon: bad }).favicon, null, String(bad));
    }
    assert.ok(view({ favicon: 'DATA:IMAGE/png;base64,AAAA' }).favicon, 'the scheme is case-insensitive');
  });

  it('R-UNIT-04: toast actions run once, only the latest eight are kept, dismissed ones are dropped', () => {
    covers('R-UNIT-04', ['REFACTOR-UNITS']);
    const Y = load('common/text.js', 'container/toast-registry.js');
    const sent = [];
    const toasts = Y.toastRegistry.create((m) => sent.push(plain(m)));
    const ran = [];
    for (let i = 1; i <= 9; i++) toasts.toast({ message: 'm' + i, actionLabel: 'Undo', onAction: () => ran.push(i) });
    assert.equal(sent.length, 9);
    assert.deepEqual(sent[0], { type: 'ui:toast', id: 'toast-1', message: 'm1', actionLabel: 'Undo', timeout: 0 });

    toasts.onAction('toast-1');
    assert.deepEqual(ran, [], 'the oldest of nine was dropped');
    toasts.onAction('toast-2');
    toasts.onAction('toast-2');
    assert.deepEqual(ran, [2], 'an action runs once');
    toasts.onDismiss('toast-3');
    toasts.onAction('toast-3');
    assert.deepEqual(ran, [2], 'a dismissed toast has no action');
    toasts.onAction('toast-nope');
    toasts.onAction('constructor');
    toasts.onAction('toast-9');
    assert.deepEqual(ran, [2, 9]);

    toasts.toast({ message: 'x'.repeat(500), actionLabel: 'y'.repeat(100), timeout: 3000 });
    const last = sent.at(-1);
    assert.equal(last.message.length, 300);
    assert.equal(last.actionLabel.length, 60);
    assert.equal(last.timeout, 3000);
    toasts.toast({ message: 'plain' });
    assert.equal(sent.at(-1).actionLabel, null);
  });

  it('R-UNIT-05: custom engine ids have the documented form and do not repeat', () => {
    covers('R-UNIT-05', ['REFACTOR-UNITS']);
    const seen = new Set();
    for (let round = 0; round < 50; round++) {
      const Y = load('common/config.js', 'common/settings/schema.js', 'common/settings/engines.js');
      let state = plain(Y.settingsSchema.defaults());
      const engines = Y.settingsEngines.create({
        load: () => JSON.parse(JSON.stringify(state)),
        save: (s) => { state = JSON.parse(JSON.stringify(s)); },
      });
      const ids = new Set();
      for (let i = 0; i < Y.config.MAX_CUSTOM_ENGINES; i++) {
        const res = engines.addEngine({ name: `Engine ${i}`, template: `https://e${i}.example.com/?q=%s` });
        assert.ok(res.ok, JSON.stringify(res));
        assert.match(res.engine.id, /^custom-[a-z0-9]{8}$/);
        assert.ok(!ids.has(res.engine.id), 'unique within one list');
        ids.add(res.engine.id);
        seen.add(res.engine.id);
      }
      assert.equal(engines.addEngine({ name: 'One too many', template: 'https://x.example.com/?q=%s' }).ok, false, 'the limit still holds');
    }
    assert.equal(seen.size, 1000, 'no repeats across 1000 generated ids');
  });
});
