import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNeighborhood, locateAndMeasure, scoreZonesLikeAPoint } from '../lib/baseline.mjs';

test('our spots are scored exactly like the plain AI pick: average lift within 1 km', () => {
  const m = {
    zones: [{ rank: 1, lat: 40.6943, lon: -73.9187 }],
    scored: [{ lat: 40.694, lon: -73.919, lift: 0.08 }, { lat: 40.695, lon: -73.92, lift: 0.1 }, { lat: 40.6, lon: -73.9, lift: 0.5 }],
    competitors: [{ lat: 40.696, lon: -73.918 }, { lat: 40.5, lon: -73.9 }],
  };
  assert.deepEqual(scoreZonesLikeAPoint(m), [{ rank: 1, liftPoints: 9, competitorsWithin1km: 1 }]);
});
import { refineZones, tidyPlace } from '../lib/analyze.mjs';

const market = {
  city: 'Brooklyn',
  center: { lat: 40.69, lon: -73.94 },
  radiusKm: 6,
  scored: [{ lat: 40.694, lon: -73.919, lift: 0.08 }, { lat: 40.695, lon: -73.92, lift: 0.1 }, { lat: 40.6, lon: -73.9, lift: 0.5 }],
  zones: [{ rank: 2, lat: 40.7, lon: -73.92 }],
  competitors: [{ lat: 40.696, lon: -73.918 }, { lat: 40.5, lon: -73.9 }],
};

test('cleanNeighborhood strips the plain AI decorations', () => {
  assert.equal(cleanNeighborhood('East Austin (Manor Road corridor)'), 'East Austin');
  assert.equal(cleanNeighborhood('Little Tokyo / Arts District border'), 'Little Tokyo');
  assert.equal(cleanNeighborhood('Kreis 4, near Helvetiaplatz'), 'Kreis 4');
});

test('locateAndMeasure scores the plain AI spot like our zones', async () => {
  const qloo = { search: async () => [{ name: 'Bushwick', location: { lat: 40.6943, lon: -73.9187 } }] };
  const r = await locateAndMeasure('Bushwick (Morgan Ave L)', market, qloo);
  assert.equal(r.found, true);
  assert.equal(r.liftPoints, 9);
  assert.equal(r.competitorsWithin1km, 1);
  assert.equal(r.agreesWithZone, 2);
});

test('locateAndMeasure rejects a differently named place, then tries the alternative', async () => {
  const qloo = { search: async q => (q.startsWith('Little Osaka') ? [{ name: 'Little Tokyo', location: { lat: 40.694, lon: -73.919 } }] : [{ name: 'Sawtelle', location: { lat: 40.695, lon: -73.92 } }]) };
  const r = await locateAndMeasure('Little Osaka (Sawtelle), West LA', market, qloo);
  assert.equal(r.name, 'Sawtelle');
});

test('locateAndMeasure refuses a match outside the city', async () => {
  const qloo = { search: async () => [{ name: 'Saint-Denis', location: { lat: 48.93, lon: 2.36 } }] };
  const r = await locateAndMeasure('Canal Saint-Martin', market, qloo);
  assert.equal(r.found, false);
});

test('refineZones keeps the searched borough and drops weak tails, never below three', () => {
  const z = (lift, district) => ({ lift, district });
  const zones = [z(0.15, 'Kings County'), z(0.1, 'Kings County'), z(0.09, 'New York County'), z(0.06, 'Kings County'), z(0.02, 'Kings County')];
  const out = refineZones(zones, 'Brooklyn, Kings County, New York, United States');
  assert.deepEqual(out.map(x => x.lift), [0.15, 0.1, 0.06]);
});

test('tidyPlace drops parenthetical duplicates', () => {
  assert.equal(tidyPlace('Paris, Ile-de-France, Metropolitan France, France, France (Landmass)'), 'Paris, Metropolitan France, France');
});
