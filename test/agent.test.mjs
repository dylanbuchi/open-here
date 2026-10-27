import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, playbookProblem } from '../lib/agent.mjs';
import { costOf } from '../lib/llm.mjs';

// Fake Qloo with just enough data for analyze() and the taste tools.
function fakeQloo(calls = []) {
  const place = (i) => ({ entity_id: `p${i}`, name: `Place ${i}`, properties: { address: `${i} Main St` }, location: { lat: 30 + i / 100, lon: -97 }, popularity: 0.9 });
  return {
    searchTags: async () => [{ id: 'urn:tag:genre:place:restaurant:test', name: 'Test' }],
    insights: async (p) => {
      calls.push(p);
      const type = p['filter.type'];
      if (type === 'urn:entity:place' && String(p['filter.tags']).includes('airport')) return { entities: [] };
      if (type === 'urn:entity:place') return { entities: [1, 2, 3, 4].map(place) };
      if (type === 'urn:heatmap') return { heatmap: Array.from({ length: 30 }, (_, i) => ({ location: { latitude: 30 + i / 1000, longitude: -97 + (i % 5) / 1000, geohash: `9v6k${String(i).padStart(3, '0')}` }, query: { affinity: 0.5 + (i % 7) / 20, popularity: 0.3 + i / 60 } })) };
      if (type === 'urn:demographics') return { demographics: [] };
      if (type === 'urn:entity:artist') return { entities: [{ name: 'Real Artist' }] };
      return { entities: [{ name: 'Real Brand' }] };
    },
  };
}

// Fake LLM that plays back a scripted list of tool calls.
function scriptedLlm(script) {
  let i = 0;
  return { respond: async () => ({ output: script[i++].map((c, j) => ({ type: 'function_call', call_id: `c${i}${j}`, name: c.name, arguments: JSON.stringify(c.args || {}) })) }) };
}

const playbookArgs = { best_zone_rank: 1, headline: 'h', why_here: ['w'], target_customer: 't', vibe: 'v', offer_ideas: ['o'], playlist: ['Real Artist', 'Made Up Band'], partners: ['Real Brand'], opening_pitch: 'p' };

test('agent flags names that did not come from Qloo', async () => {
  const llm = scriptedLlm([[{ name: 'analyze_market' }], [{ name: 'audience_taste', args: { domain: 'artist' } }], [{ name: 'submit_playbook', args: playbookArgs }]]);
  const events = [];
  const pb = await runAgent({ concept: 'Test food', city: 'Austin' }, e => events.push(e.type), { qloo: fakeQloo(), llm });
  assert.deepEqual(pb.playlist, [{ name: 'Real Artist', fromQloo: true }, { name: 'Made Up Band', fromQloo: false }]);
  assert.deepEqual(pb.partners, [{ name: 'Real Brand', fromQloo: true }]);
  assert.ok(events.includes('market') && events.includes('playbook'));
});

test('analyze_market always uses the user city, not model arguments', async () => {
  const calls = [];
  const llm = scriptedLlm([[{ name: 'analyze_market', args: { city: 'Elsewhere' } }], [{ name: 'submit_playbook', args: playbookArgs }]]);
  await runAgent({ concept: 'Test food', city: 'Austin' }, () => {}, { qloo: fakeQloo(calls), llm });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(p => !p['filter.location.query'] || p['filter.location.query'] === 'Austin'));
});

test('a brand name in the playlist is not verified, even though Qloo returned it', async () => {
  const args = { ...playbookArgs, playlist: ['Real Brand'] };
  const llm = scriptedLlm([[{ name: 'analyze_market' }], [{ name: 'submit_playbook', args }]]);
  const pb = await runAgent({ concept: 'Test food', city: 'Austin' }, () => {}, { qloo: fakeQloo(), llm });
  assert.deepEqual(pb.playlist, [{ name: 'Real Brand', fromQloo: false }]);
});

test('an invalid playbook is rejected and the model gets a chance to fix it', async () => {
  const outputs = [];
  let i = 0;
  const script = [[{ name: 'analyze_market' }], [{ name: 'submit_playbook', args: { headline: 'only this' } }], [{ name: 'submit_playbook', args: playbookArgs }]];
  const llm = { respond: async ({ input }) => { outputs.push(input.at(-1)); i++; return { output: script[i - 1].map((c, j) => ({ type: 'function_call', call_id: `c${i}${j}`, name: c.name, arguments: JSON.stringify(c.args || {}) })) }; } };
  const pb = await runAgent({ concept: 'Test food', city: 'Austin' }, () => {}, { qloo: fakeQloo(), llm });
  assert.equal(pb.headline, 'h');
  assert.match(outputs[2].output, /Playbook rejected/);
});

test('playbookProblem catches bad ranks and missing lists', () => {
  const zones = [{ rank: 1 }, { rank: 2 }];
  assert.match(playbookProblem({ ...playbookArgs, best_zone_rank: 9 }, zones), /best_zone_rank/);
  assert.match(playbookProblem({ ...playbookArgs, partners: [] }, zones), /partners/);
  assert.equal(playbookProblem(null, zones), 'Arguments must be a JSON object.');
  assert.equal(playbookProblem(playbookArgs, zones), null);
});

test('an aborted search stops before calling the model', async () => {
  let called = false;
  const llm = { respond: async () => { called = true; return { output: [] }; } };
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(runAgent({ concept: 'x', city: 'y' }, () => {}, { qloo: fakeQloo(), llm, signal: ac.signal }), /cancelled/);
  assert.equal(called, false);
});

test('costOf prices cached input tokens separately', () => {
  const c = costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000, input_tokens_details: { cached_tokens: 0 } });
  assert.ok(Math.abs(c - 1.5) < 1e-9);
});
