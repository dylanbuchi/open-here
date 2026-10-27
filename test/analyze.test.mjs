import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTags, spreadZones } from '../lib/analyze.mjs';

test('rankTags prefers the tag named in the query over a narrower one', () => {
  const tags = [
    { id: 'urn:tag:genre:place:restaurant:northern_italian', name: 'Northern Italian' },
    { id: 'urn:tag:cuisine:qloo:italian', name: 'Italian' },
    { id: 'urn:tag:genre:place:restaurant:italian', name: 'Italian' },
  ];
  assert.equal(rankTags(tags, 'Italian restaurant')[0].id, 'urn:tag:genre:place:restaurant:italian');
});

test('spreadZones skips zones too close to a better one', () => {
  const zones = [
    { lat: 30.25, lon: -97.75 },
    { lat: 30.251, lon: -97.751 },
    { lat: 30.35, lon: -97.75 },
  ];
  assert.deepEqual(spreadZones(zones).map(z => z.lat), [30.25, 30.35]);
});
