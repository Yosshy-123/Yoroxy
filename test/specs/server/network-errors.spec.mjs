/*
 * N-01..N-04: classification of ignorable network errors.
 * Pure unit tests - no browser, no server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIgnorableNetworkError, statusForIgnorableError } from '../../../src/server/network-errors.js';
import { covers } from '../../support/traceability.mjs';

const withCode = (code, message = 'x') => Object.assign(new Error(message), { code });

describe('network error classification', () => {
  it('N-01: connection-ended codes are ignorable', () => {
    covers('N-01', ['SERVER-NETWORK-ERRORS']);
    for (const code of ['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'ABORT_ERR']) {
      assert.equal(isIgnorableNetworkError(withCode(code)), true, code);
    }
    const abort = new Error('x');
    abort.name = 'AbortError';
    assert.equal(isIgnorableNetworkError(abort), true, 'AbortError');
    assert.equal(isIgnorableNetworkError(new Error('socket hang up')), true);
    assert.equal(isIgnorableNetworkError(new Error('aborted')), true);
  });

  it('N-02: real bugs are NOT ignorable (no substring matching on messages)', () => {
    covers('N-02', ['SERVER-NETWORK-ERRORS']);
    assert.equal(isIgnorableNetworkError(new TypeError("Cannot read properties of undefined (reading 'x')")), false);
    assert.equal(isIgnorableNetworkError(new Error('transaction aborted by the billing module')), false);
    assert.equal(isIgnorableNetworkError(new Error('the socket hang up handler is missing')), false);
    assert.equal(isIgnorableNetworkError(withCode('ENOENT')), false);
    assert.equal(isIgnorableNetworkError(withCode('ERR_STREAM_DESTROYED')), false);
    assert.equal(isIgnorableNetworkError(withCode('EADDRINUSE')), false);
  });

  it('N-03: odd inputs never throw and are not ignorable', () => {
    covers('N-03', ['SERVER-NETWORK-ERRORS']);
    for (const value of [undefined, null, 0, '', 'aborted', 'ECONNRESET', 42, true, Symbol('s'), () => {}]) {
      assert.equal(isIgnorableNetworkError(value), false, String(typeof value));
    }
    const cyclic = new Error('wrapper');
    cyclic.cause = cyclic;
    assert.equal(isIgnorableNetworkError(cyclic), false, 'cyclic cause chain terminates');
    assert.equal(isIgnorableNetworkError(Object.create(null)), false, 'object without a prototype');
  });

  it('N-04: the cause chain is followed (undici-style "fetch failed")', () => {
    covers('N-04', ['SERVER-NETWORK-ERRORS']);
    const wrapped = new TypeError('fetch failed', { cause: withCode('ECONNRESET') });
    assert.equal(isIgnorableNetworkError(wrapped), true);
    const unrelated = new TypeError('fetch failed', { cause: withCode('ENOTFOUND') });
    assert.equal(isIgnorableNetworkError(unrelated), false);
    assert.equal(statusForIgnorableError(new Error('x', { cause: withCode('ETIMEDOUT') })), 504);
    assert.equal(statusForIgnorableError(withCode('ETIMEDOUT')), 504, 'a timeout is not a client abort');
    assert.equal(statusForIgnorableError(withCode('ECONNRESET')), 499);
    assert.equal(statusForIgnorableError(new Error('aborted')), 499);
  });
});
