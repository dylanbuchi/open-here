import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/analyze.mjs';

function call(req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); },
    };
    handler({ method: 'GET', headers: {}, socket: {}, ...req }, res);
  });
}

test('rejects non-GET', async () => {
  const r = await call({ method: 'POST', query: {} });
  assert.equal(r.status, 405);
});

test('missing input returns a readable 400 before any Qloo call', async () => {
  process.env.QLOO_BASE_URL ||= 'http://qloo.invalid';
  process.env.QLOO_API_KEY ||= 'test';
  const r = await call({ query: { concept: '', city: 'Austin' }, headers: { 'x-forwarded-for': '10.0.0.1' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /concept and a city/);
});
