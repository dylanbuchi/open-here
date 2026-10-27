import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicMarket } from '../lib/public.mjs';

const market = {
  concept: 'Italian restaurant', city: 'Austin', place: 'Austin, Texas, United States',
  tag: { id: 'urn:tag:category:place:italian_restaurant', name: 'Italian Restaurant' },
  seeds: ['A1', 'B2'],
  competitors: [{ id: 'A1', name: 'Emmer & Rye', address: '51 Rainey St', lat: 30.2, lon: -97.7, popularity: 0.98, rating: 4.5, tags: ['x'] }],
  zones: [{ rank: 1, lat: 30.23, lon: -97.78, lift: 0.14512, affinity: 0.9, popularity: 0.75, geohash: '9v6kpd', cells: 3, neighborhood: 'South Lamar', competitorsWithin1km: 0, landmark: { name: 'Radio Coffee & Beer', address: '4204 Menchaca Rd', km: 0.1 } }],
  heatmap: [{ lat: 30.2, lon: -97.7, intensity: 0.5 }],
  audience: { demographics: { age: { '24_and_younger': 0.0633333 }, gender: { female: 0.0312 } }, artists: ['Randy Rogers Band'], movies: [], brands: ['Central Market'] },
  lowSignal: false,
  stats: { cells: 852 },
};

test('publicMarket removes Qloo IDs and raw scores', () => {
  const json = JSON.stringify(publicMarket(market));
  for (const leak of ['"id"', 'seeds', 'popularity', 'affinity', 'geohash', 'urn:tag', 'rating', '"A1"', '"tags"']) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
});

test('publicMarket keeps everything the page shows', () => {
  const p = publicMarket(market);
  assert.equal(p.competitors[0].name, 'Emmer & Rye');
  assert.equal(p.zones[0].neighborhood, 'South Lamar');
  assert.equal(p.zones[0].lift, 0.15);
  assert.equal(p.zones[0].landmark.name, 'Radio Coffee & Beer');
  assert.equal(p.audience.demographics.age['24_and_younger'], 0.06);
  assert.equal(p.tag.name, 'Italian Restaurant');
  assert.equal(p.heatmap.length, 1);
});
