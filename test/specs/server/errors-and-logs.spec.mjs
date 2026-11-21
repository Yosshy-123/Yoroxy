/*
 * R-ERR-01  Last-resort routing errors answer with JSON, like every other error.
 * R-LOG-01  A malformed request does not put its raw bytes (cookies,
 *           credentials) into the server log.
 * R-VAL-01  Configuration values are validated at their boundaries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import util from 'node:util';
import { covers } from '../../support/traceability.mjs';
import { createServer } from '../../../src/server/create-server.js';
import { handleRoutingError } from '../../../src/server/error-handlers.js';
import { readConfig } from '../../../src/server/config.js';

function fakeResponse({ headersSent = false } = {}) {
  const res = {
    headersSent,
    statusCode: 200,
    headers: {},
    body: null,
    destroyed: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body; },
    destroy() { this.destroyed = true; },
  };
  return res;
}

function silenced(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

describe('server errors, logs and configuration', () => {
  it('R-ERR-01: a routing error is a JSON 500; a dropped connection gets no answer; a started response is destroyed', () => {
    covers('R-ERR-01', ['REFACTOR-ERROR-FORMAT']);
    const res = fakeResponse();
    silenced(() => handleRoutingError(new Error('boom'), res));
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(res.body), { error: 'internal error' });
    assert.ok(!String(res.body).includes('boom'), 'the message of the error is not sent');

    const dropped = fakeResponse();
    handleRoutingError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }), dropped);
    assert.equal(dropped.body, null);
    assert.equal(dropped.destroyed, false);

    const started = fakeResponse({ headersSent: true });
    silenced(() => handleRoutingError(new Error('late'), started));
    assert.equal(started.destroyed, true);
    assert.equal(started.body, null);
  });

  it('R-LOG-01: a malformed request does not leak its raw bytes into the log', async () => {
    covers('R-LOG-01', ['REFACTOR-LOG-SECRETS']);
    const app = createServer({ testOnly: { disableRateLimit: true } });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.address().port;
    const logged = [];
    const originals = {};
    for (const level of ['log', 'info', 'warn', 'error']) {
      originals[level] = console[level];
      console[level] = (...args) => logged.push(util.format(...args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4 })))));
    }
    try {
      await new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write('BAD / HTTP/1.1\r\nCookie: s3cr3t-cookie\r\nAuthorization: Bearer s3cr3t-token\r\n\r\n');
        });
        socket.on('data', () => {});
        socket.on('close', resolve);
        socket.on('error', resolve);
        setTimeout(resolve, 1000);
      });
    } finally {
      for (const [level, fn] of Object.entries(originals)) console[level] = fn;
      await app.close();
    }
    const output = logged.join('\n');
    assert.match(output, /clientError/, 'the problem is still logged');
    assert.match(output, /HPE_INVALID_METHOD/, 'with its error code');
    const hex = Buffer.from('s3cr3t').toString('hex').replace(/(..)/g, '$1 ').trim();
    assert.ok(!output.includes('s3cr3t') && !output.includes(hex) && !/rawPacket/.test(output), 'no raw request bytes in the log');
  });

  it('R-VAL-01: PORT, TRUSTED_PROXY and HOST are validated at their boundaries', () => {
    covers('R-VAL-01', ['REFACTOR-CONFIG-VALIDATION']);
    assert.equal(readConfig({}).port, 8080);
    assert.equal(readConfig({ PORT: '0' }).port, 0);
    assert.equal(readConfig({ PORT: '65535' }).port, 65535);
    for (const bad of ['-1', '65536', '1.5', 'abc', '', ' 80']) assert.throws(() => readConfig({ PORT: bad }), /PORT/, `PORT=${JSON.stringify(bad)}`);
    assert.equal(readConfig({ TRUSTED_PROXY: '10' }).trustedProxy, 10);
    assert.throws(() => readConfig({ TRUSTED_PROXY: '11' }), /TRUSTED_PROXY/);
    assert.equal(readConfig({}).host, undefined, 'without HOST the server listens on every interface');
    assert.equal(readConfig({ HOST: '127.0.0.1' }).host, '127.0.0.1');
    assert.equal(readConfig({ HOST: '::1' }).host, '::1');
    for (const bad of ['', ' ', 'a b', '\t']) assert.throws(() => readConfig({ HOST: bad }), /HOST/, `HOST=${JSON.stringify(bad)}`);
  });
});
