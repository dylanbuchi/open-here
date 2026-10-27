import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../lib/analyze.mjs';

// Fake Qloo: "tabac" finds no tags; only Coffee shop and Bar have places.
const qloo = {
  searchTags: async q => (/tabac/i.test(q) ? [] : [{ id: `urn:tag:genre:place:${q.toLowerCase().replace(/ /g, '_')}`, name: q }]),
  insights: async p => {
    const ok = /:coffee_shop$|:bar$/.test(p['filter.tags'] || '');
    return { entities: ok ? [1, 2, 3].map(i => ({ entity_id: `p${i}`, name: `P${i}`, location: { lat: 46.2 + i / 100, lon: 6.1 } })) : [] };
  },
};

test('no-data searches return concepts that do have data in that city', async () => {
  await assert.rejects(analyze({ concept: 'tabac', city: 'Geneva' }, { qloo }), err => {
    assert.equal(err.status, 404);
    assert.deepEqual(err.suggestions, ['Coffee shop', 'Bar']);
    assert.match(err.message, /English/);
    return true;
  });
});

test('a tag that fails upstream does not crash the search', async () => {
  const flaky = { ...qloo, insights: async () => { throw new Error('upstream 500'); } };
  await assert.rejects(analyze({ concept: 'Sushi', city: 'Zurich' }, { qloo: flaky }), err => err.status === 404);
});
