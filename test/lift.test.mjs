import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLine, scoreCells, rankZones, normalizeLift } from '../lib/lift.mjs';

test('fitLine recovers a known line', () => {
  const { slope, intercept } = fitLine([0, 1, 2, 3], [1, 3, 5, 7]);
  assert.ok(Math.abs(slope - 2) < 1e-9);
  assert.ok(Math.abs(intercept - 1) < 1e-9);
});

test('lift isolates affinity beyond popularity', () => {
  const cells = [
    { geohash: 'aaaaaa1', lat: 0, lon: 0, popularity: 0.3, affinity: 0.3 },
    { geohash: 'aaaaaa2', lat: 0, lon: 0, popularity: 0.6, affinity: 0.6 },
    { geohash: 'aaaaaa3', lat: 0, lon: 0, popularity: 0.9, affinity: 0.9 },
    { geohash: 'bbbbbb1', lat: 1, lon: 1, popularity: 0.4, affinity: 0.8 },
  ];
  const scored = scoreCells(cells);
  const best = scored.reduce((a, b) => (b.lift > a.lift ? b : a));
  assert.equal(best.geohash, 'bbbbbb1');
});

test('cells below the popularity floor are dropped', () => {
  const scored = scoreCells([
    { geohash: 'x1', lat: 0, lon: 0, popularity: 0.05, affinity: 1 },
    { geohash: 'x2', lat: 0, lon: 0, popularity: 0.5, affinity: 0.5 },
    { geohash: 'x3', lat: 0, lon: 0, popularity: 0.8, affinity: 0.7 },
  ]);
  assert.equal(scored.length, 2);
});

test('rankZones groups by prefix, skips sparse zones, sorts by lift', () => {
  const scored = [
    { geohash: 'aaaaaa1', lat: 0, lon: 0, lift: 0.1, affinity: 0, popularity: 0 },
    { geohash: 'aaaaaa2', lat: 0, lon: 0, lift: 0.3, affinity: 0, popularity: 0 },
    { geohash: 'bbbbbb1', lat: 1, lon: 1, lift: 0.5, affinity: 0, popularity: 0 },
    { geohash: 'bbbbbb2', lat: 1, lon: 1, lift: 0.7, affinity: 0, popularity: 0 },
    { geohash: 'cccccc1', lat: 2, lon: 2, lift: 9, affinity: 0, popularity: 0 },
  ];
  const zones = rankZones(scored);
  assert.deepEqual(zones.map(z => z.geohash), ['bbbbbb', 'aaaaaa']);
  assert.ok(Math.abs(zones[0].lift - 0.6) < 1e-9);
});

test('normalizeLift maps to 0..1', () => {
  const out = normalizeLift([{ lift: -1 }, { lift: 0 }, { lift: 1 }]);
  assert.deepEqual(out.map(c => c.intensity), [0, 0.5, 1]);
});
