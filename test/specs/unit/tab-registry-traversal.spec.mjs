/*
 * Unit tests for the two scripts split out of tab-manager.js. No browser:
 * each script is evaluated in a bare vm context, as in browser-units.spec.mjs.
 *
 * R-UNIT-06  container/tab-registry.js   the list of tabs and its lookups
 * R-UNIT-07  container/tab-traversal.js  Back / Forward for one tab
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { covers } from '../../support/traceability.mjs';

const JS = new URL('../../../public/assets/js/', import.meta.url);

function load(...files) {
  const win = {};
  const context = vm.createContext({ window: win, console, URL, setTimeout, clearTimeout });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(f, JS), 'utf8'), context, { filename: f });
  return win.Yoroxy;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (reg) => Array.from(reg.list(), (t) => t.id); // an array of this realm, comparable by deepEqual

describe('tab registry', () => {
  it('R-UNIT-06: insertion position, lookups, window names, removal and moves', () => {
    covers('R-UNIT-06', ['REFACTOR-UNITS']);
    const Y = load('container/tab-registry.js');
    const reg = Y.tabRegistry.create();
    for (const id of ['a', 'b', 'c']) reg.insert({ id }, {});
    assert.deepEqual(ids(reg), ['a', 'b', 'c'], 'no options: appended');

    reg.insert({ id: 'd' }, { index: 1 });
    reg.insert({ id: 'e' }, { index: 99 });
    reg.insert({ id: 'f' }, { index: -5 });
    assert.deepEqual(ids(reg), ['f', 'a', 'd', 'b', 'c', 'e'], 'an index is clamped into range');

    const reg2 = Y.tabRegistry.create();
    for (const id of ['a', 'b', 'c']) reg2.insert({ id }, {});
    reg2.insert({ id: 'x', openerId: 'a' }, { openerId: 'a' });
    reg2.insert({ id: 'y', openerId: 'a' }, { openerId: 'a' });
    assert.deepEqual(ids(reg2), ['a', 'x', 'y', 'b', 'c'], 'a spawned tab goes after the opener and the tabs it already spawned');
    reg2.insert({ id: 'z' }, { openerId: 'gone' });
    assert.equal(ids(reg2).at(-1), 'z', 'an unknown opener: appended');

    assert.equal(reg2.indexOf('b'), 3);
    assert.equal(reg2.indexOf('nope'), -1);
    assert.equal(reg2.find('b').id, 'b');
    assert.equal(reg2.find('nope'), null);

    const named = { id: 'n1', name: 'w' };
    reg2.insert(named, {});
    assert.equal(reg2.findByName('w'), named);
    assert.equal(reg2.findByName('other'), null);
    assert.equal(reg2.findByName('constructor'), null, 'names are not looked up in the prototype');
    const newer = { id: 'n2', name: 'w' };
    reg2.insert(newer, {});
    assert.equal(reg2.findByName('w'), newer, 'a reused name points at the newest tab');
    reg2.remove('n1');
    assert.equal(reg2.findByName('w'), newer, 'removing the older tab keeps the newer mapping');
    reg2.remove('n2');
    assert.equal(reg2.findByName('w'), null, 'removing the owner drops the name');

    reg2.insert({ id: 'i1', kind: 'internal', internalName: 'settings' }, {});
    reg2.insert({ id: 'w1', kind: 'web', internalName: 'settings' }, {});
    assert.equal(reg2.findInternal('settings').id, 'i1');
    assert.equal(reg2.findInternal('newtab'), null);

    assert.equal(reg2.remove('nope'), -1);
    assert.equal(reg2.remove('x'), 1, 'remove returns the index the tab had');

    const reg3 = Y.tabRegistry.create();
    for (const id of ['a', 'b', 'c', 'd']) reg3.insert({ id }, {});
    assert.equal(reg3.move('a', 99), true);
    assert.deepEqual(ids(reg3), ['b', 'c', 'd', 'a'], 'moved past the end: last');
    assert.equal(reg3.move('a', -3), true);
    assert.deepEqual(ids(reg3), ['a', 'b', 'c', 'd'], 'moved before the start: first');
    assert.equal(reg3.move('c', 1), true);
    assert.deepEqual(ids(reg3), ['a', 'c', 'b', 'd']);
    assert.equal(reg3.move('nope', 0), false);
  });

  it('R-UNIT-06: tabForWindow finds the tab of a nested frame and stops on odd parents', () => {
    covers('R-UNIT-06b', ['REFACTOR-UNITS']);
    const Y = load('container/tab-registry.js');
    const reg = Y.tabRegistry.create();
    const top1 = {};
    const top2 = {};
    reg.insert({ id: 't1', iframe: { contentWindow: top1 } }, {});
    reg.insert({ id: 't2', iframe: { contentWindow: top2 } }, {});
    const nested = { parent: { parent: top2 } };
    assert.equal(reg.tabForWindow(top1).id, 't1');
    assert.equal(reg.tabForWindow(nested).id, 't2', 'a frame inside a frame of the tab');
    assert.equal(reg.tabForWindow({ parent: null }), null);
    const self = {};
    self.parent = self;
    assert.equal(reg.tabForWindow(self), null, 'a window that is its own parent ends the search');
    const hostile = { get parent() { throw new Error('cross-origin'); } };
    assert.equal(reg.tabForWindow(hostile), null, 'a parent that cannot be read ends the search');
    assert.equal(reg.tabForWindow(null), null);
    assert.equal(Y.tabRegistry.frameWindow({ iframe: { get contentWindow() { throw new Error('gone'); } } }), null);
    assert.equal(Y.tabRegistry.frameWindow({ iframe: { contentWindow: top1 } }), top1);
  });
});

describe('tab traversal', () => {
  function setup(win = {}) {
    const Y = load('common/config.js', 'common/url-utils.js', 'container/tab-history.js', 'container/tab-registry.js', 'container/tab-traversal.js');
    const calls = { navigate: [], refresh: 0, update: 0 };
    const traversal = Y.tabTraversal.create({
      navigate: (_tab, desc) => calls.navigate.push(JSON.parse(JSON.stringify(desc))),
      refresh: () => { calls.refresh++; },
      emitUpdate: () => { calls.update++; },
    });
    const tab = { closed: false, history: Y.tabHistory.create(), iframe: { contentWindow: win } };
    return { Y, calls, traversal, tab };
  }

  it('R-UNIT-07: a step to another document loads its URL; no step, or a closed tab, does nothing', () => {
    covers('R-UNIT-07', ['REFACTOR-UNITS']);
    const { calls, traversal, tab } = setup();
    assert.equal(traversal.traverse(tab, -1), false, 'empty history');
    tab.history.observe('https://a.test/', {});
    tab.history.observe('https://b.test/', {});
    assert.equal(traversal.traverse(tab, -1), true);
    assert.deepEqual(calls.navigate, [{ kind: 'web', url: 'https://a.test/', via: 'url' }]);
    assert.equal(traversal.traverse(tab, -1), false, 'already heading for the first entry');
    assert.equal(calls.navigate.length, 1);
    assert.equal(traversal.traverse({ ...tab, closed: true }, 1), false, 'a closed tab');
  });

  it('R-UNIT-07: a step inside the document goes through the browser; the URL is loaded only if that does not settle', async () => {
    covers('R-UNIT-07b', ['REFACTOR-UNITS']);
    const keys = [];
    const win = { navigation: { traverseTo: (k) => { keys.push(k); return { committed: Promise.resolve(), finished: Promise.resolve() }; } } };
    const first = setup(win);
    first.tab.history.observe('https://a.test/', { key: 'k1' });
    first.tab.history.observe('https://a.test/#x', { sameDocument: true, key: 'k2' });
    assert.equal(first.traversal.traverse(first.tab, -1), true);
    assert.deepEqual(keys, ['k1'], 'the entry is traversed natively');
    assert.deepEqual([first.calls.refresh, first.calls.update, first.calls.navigate.length], [1, 1, 0], 'nothing is loaded yet');
    await sleep(500);
    assert.deepEqual(first.calls.navigate, [{ kind: 'web', url: 'https://a.test/', via: 'url' }], 'it did not settle: the URL is loaded');

    const settled = setup({ navigation: { traverseTo: () => ({}) } });
    settled.tab.history.observe('https://a.test/', { key: 'k1' });
    settled.tab.history.observe('https://a.test/#x', { sameDocument: true, key: 'k2' });
    assert.equal(settled.traversal.traverse(settled.tab, -1), true);
    settled.tab.history.observe('https://a.test/', { type: 'traverse', sameDocument: true, key: 'k1' });
    await sleep(500);
    assert.equal(settled.calls.navigate.length, 0, 'it settled in time: nothing more to load');

    const rejected = setup({ navigation: { traverseTo: () => ({ committed: Promise.reject(new Error('no')), finished: Promise.resolve() }) } });
    rejected.tab.history.observe('https://a.test/', { key: 'k1' });
    rejected.tab.history.observe('https://a.test/#x', { sameDocument: true, key: 'k2' });
    rejected.traversal.traverse(rejected.tab, -1);
    await sleep(50);
    assert.equal(rejected.calls.navigate.length, 1, 'a refused traversal loads the URL at once');
  });

  it('R-UNIT-07: without the Navigation API history.go is used, and with neither the URL is loaded', () => {
    covers('R-UNIT-07c', ['REFACTOR-UNITS']);
    const gone = [];
    const viaHistory = setup({ history: { go: (d) => gone.push(d) } });
    viaHistory.tab.history.observe('https://a.test/', {});
    viaHistory.tab.history.observe('https://a.test/#x', { sameDocument: true });
    assert.equal(viaHistory.traversal.traverse(viaHistory.tab, -1), true);
    assert.deepEqual(gone, [-1]);

    const neither = setup({});
    neither.tab.history.observe('https://a.test/', {});
    neither.tab.history.observe('https://a.test/#x', { sameDocument: true });
    assert.equal(neither.traversal.traverse(neither.tab, -1), true);
    assert.deepEqual(neither.calls.navigate, [{ kind: 'web', url: 'https://a.test/', via: 'url' }]);
  });

  it('R-UNIT-07: describeUrl reopens web URLs as typed, and internal addresses as their page', () => {
    covers('R-UNIT-07d', ['REFACTOR-UNITS']);
    const { Y } = setup();
    assert.deepEqual(JSON.parse(JSON.stringify(Y.tabTraversal.describeUrl('https://a.test/p?q=1'))), { kind: 'web', url: 'https://a.test/p?q=1', via: 'url' });
    assert.equal(Y.tabTraversal.describeUrl('yoroxy://newtab').kind, 'internal');
    assert.equal(Y.tabTraversal.describeUrl('').kind, 'none');
  });
});
