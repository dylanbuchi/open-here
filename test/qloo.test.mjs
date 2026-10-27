import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQloo } from '../lib/qloo.mjs';

const json = (status, body, headers = {}) => ({ ok: status < 400, status, json: async () => body, headers: { get: k => headers[k] ?? null } });

test('retries a 429 and then succeeds', async () => {
  let calls = 0;
  const qloo = createQloo({ baseUrl: 'http://q', apiKey: 'k', fetchImpl: async () => (++calls === 1 ? json(429, {}, { 'retry-after': '0' }) : json(200, { results: { tags: [{ id: 't' }] } })) });
  assert.deepEqual(await qloo.searchTags('retry-ok'), [{ id: 't' }]);
  assert.equal(calls, 2);
});

test('persistent 429 becomes a friendly busy error', async () => {
  const qloo = createQloo({ baseUrl: 'http://q', apiKey: 'k', fetchImpl: async () => json(429, {}, { 'retry-after': '0' }) });
  await assert.rejects(qloo.searchTags('always-busy'), err => err.status === 503 && /busy/.test(err.message));
});

test('never runs more than 4 requests at once', async () => {
  let live = 0, peak = 0;
  const qloo = createQloo({ baseUrl: 'http://q', apiKey: 'k', fetchImpl: async () => { peak = Math.max(peak, ++live); await new Promise(r => setTimeout(r, 5)); live--; return json(200, { results: {} }); } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => qloo.insights({ n: `burst-${i}` })));
  assert.ok(peak <= 4, `peak ${peak}`);
});
