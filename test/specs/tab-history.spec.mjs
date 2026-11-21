/*
 * Unit tests for the per-tab navigation history (container/tab-history.js).
 * Pure logic, so no browser: the module is evaluated in a bare vm context.
 * Test IDs: T-06u.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { covers } from '../support/traceability.mjs';

const source = fs.readFileSync(new URL('../../public/assets/js/container/tab-history.js', import.meta.url), 'utf8');

function newHistory(snapshot) {
  const win = {};
  vm.runInNewContext(source, { window: win });
  return win.Yoroxy.tabHistory.create(snapshot);
}

const state = (h) => [h.canGoBack(), h.canGoForward()];
/* the URL a traversal step heads for (or null when there is none) */
const url = (step) => (step ? step.url : null);

describe('tab history', () => {
  it('T-06u: starts empty and records navigations', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    assert.deepEqual(state(h), [false, false]);
    assert.equal(url(h.beginTraversal(-1)), null);
    h.observe('a');
    assert.deepEqual(state(h), [false, false]);
    h.observe('b');
    assert.deepEqual(state(h), [true, false]);
  });

  it('T-06u: ignores an empty URL and the URL it is already at (reload)', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    h.observe('a');
    h.observe('');
    h.observe('a');
    assert.deepEqual(state(h), [false, false]);
  });

  it('T-06u: back / forward move through entries and report the target URL', () => {
    covers('T-06u', ['FR-URL-05', 'FR-URL-06']);
    const h = newHistory();
    ['a', 'b', 'c'].forEach((u) => h.observe(u));
    assert.equal(url(h.beginTraversal(-1)), 'b');
    h.observe('b');
    assert.deepEqual(state(h), [true, true]);
    assert.equal(url(h.beginTraversal(-1)), 'a');
    h.observe('a');
    assert.deepEqual(state(h), [false, true]);
    assert.equal(url(h.beginTraversal(1)), 'b');
    h.observe('b');
    assert.equal(url(h.beginTraversal(1)), 'c');
    h.observe('c');
    assert.deepEqual(state(h), [true, false]);
  });

  it('T-06u: a traversal that redirects replaces the entry instead of adding one', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b'].forEach((u) => h.observe(u));
    assert.equal(url(h.beginTraversal(-1)), 'a');
    h.observe('a-redirected');
    assert.deepEqual(state(h), [false, true]);
    assert.equal(url(h.beginTraversal(1)), 'b');
  });

  it('T-06u: a new navigation after going back drops the forward entries', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'c'].forEach((u) => h.observe(u));
    h.beginTraversal(-1);
    h.observe('b');
    h.observe('d');
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'b');
  });

  it('T-06u: returning to an earlier URL by navigating is a new entry, not a back step', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'a'].forEach((u) => h.observe(u));
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'b');
  });

  it('T-06u: repeated traversal requests before the load settles compose', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'c', 'd'].forEach((u) => h.observe(u));
    assert.equal(url(h.beginTraversal(-1)), 'c');
    assert.deepEqual(state(h), [true, true]); // measured from the target, before anything settled
    assert.equal(url(h.beginTraversal(-1)), 'b');
    assert.equal(url(h.beginTraversal(-1)), 'a');
    assert.deepEqual(state(h), [false, true]);
    assert.equal(url(h.beginTraversal(-1)), null); // already heading for the first entry
    h.observe('a');
    assert.deepEqual(state(h), [false, true]);
    assert.equal(url(h.beginTraversal(1)), 'b');
  });

  it('T-06u: Back availability follows the position, not the loading state', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b'].forEach((u) => h.observe(u));
    h.beginTraversal(-1);
    assert.deepEqual(state(h), [false, true]); // at the start as soon as the step began
    h.cancelTraversal();
    assert.deepEqual(state(h), [true, false]);
  });

  it('T-06u: a step reports its distance from the committed entry', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'c'].forEach((u) => h.observe(u));
    assert.equal(h.beginTraversal(-2).delta, -2);
    h.cancelTraversal();
    h.beginTraversal(-1);
    assert.equal(h.beginTraversal(-1).delta, -2); // second step while the first is in flight
  });

  it('T-06u: entries made without a page load share a document; a step between them is same-document', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    h.observe('/spa');
    h.observe('/spa/one', { sameDocument: true, key: 'k1' });
    h.observe('/spa/two', { sameDocument: true, key: 'k2' });
    const back = h.beginTraversal(-1);
    assert.deepEqual([back.url, back.key, back.sameDocument], ['/spa/one', 'k1', true]);
    h.observe('/spa/one', { type: 'traverse', sameDocument: true, key: 'k1' });
    assert.deepEqual(state(h), [true, true]);
    h.cancelTraversal();
    h.observe('/other'); // a new document
    assert.equal(h.beginTraversal(-1).sameDocument, false); // leaves the document /spa/one was in
    h.cancelTraversal();
    assert.equal(h.beginTraversal(-2).sameDocument, false);
  });

  it('T-06u: a second step while one is in flight is never a native same-document step', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    h.observe('/spa');
    h.observe('/spa/one', { sameDocument: true });
    h.observe('/spa/two', { sameDocument: true });
    assert.equal(h.beginTraversal(-1).sameDocument, true);
    assert.equal(h.beginTraversal(-1).sameDocument, false);
  });

  it('T-06u: a replacement rewrites the current entry, a reload changes nothing', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    h.observe('a');
    h.observe('b');
    h.observe('b2', { type: 'replace' }); // location.replace, a redirect
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'a');
    h.observe('a');
    assert.equal(url(h.beginTraversal(1)), 'b2');
    h.observe('b2');
    h.observe('b2', { type: 'reload' });
    assert.deepEqual(state(h), [true, false]);
  });

  it('T-06u: a move made by someone else (page history.back, the browser) moves the position', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'c'].forEach((u) => h.observe(u));
    h.observe('b', { type: 'traverse' }); // not through beginTraversal
    assert.deepEqual(state(h), [true, true]);
    h.observe('a', { type: 'traverse' });
    assert.deepEqual(state(h), [false, true]);
    assert.equal(url(h.beginTraversal(1)), 'b'); // nothing was pushed or dropped
    h.cancelTraversal();
    h.observe('c', { type: 'traverse' });
    assert.deepEqual(state(h), [true, false]);
  });

  it('T-06u: a traverse that matches no entry is a new entry', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b'].forEach((u) => h.observe(u));
    h.observe('zzz', { type: 'traverse' });
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'b');
  });

  it('T-06u: the same URL twice in a stack stays two distinct entries', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    h.observe('a');
    h.observe('b');
    h.observe('a');
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'b');
    h.observe('b');
    assert.equal(url(h.beginTraversal(-1)), 'a');
    h.observe('a');
    assert.deepEqual(state(h), [false, true], 'the first "a" is a different entry from the last one');
  });

  it('T-06u: a snapshot starts a new history at the same position (duplicate tab)', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b', 'c'].forEach((u) => h.observe(u));
    h.beginTraversal(-1);
    h.observe('b');
    const copy = newHistory(h.snapshot());
    assert.deepEqual(state(copy), [true, true]);
    assert.equal(url(copy.beginTraversal(-1)), 'a');
    copy.observe('a');
    assert.deepEqual(state(h), [true, true]); // the original is untouched
    copy.observe('b'); // loading the duplicate's current URL is not a new entry
  });

  it('T-06u: a cancelled traversal leaves the position unchanged', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b'].forEach((u) => h.observe(u));
    assert.equal(url(h.beginTraversal(-1)), 'a');
    h.cancelTraversal();
    h.observe('c');
    assert.deepEqual(state(h), [true, false]);
    assert.equal(url(h.beginTraversal(-1)), 'b');
  });

  it('T-06u: cannot go past either end', () => {
    covers('T-06u', ['FR-URL-05']);
    const h = newHistory();
    ['a', 'b'].forEach((u) => h.observe(u));
    assert.equal(url(h.beginTraversal(1)), null);
    assert.equal(url(h.beginTraversal(-2)), null);
  });
});
