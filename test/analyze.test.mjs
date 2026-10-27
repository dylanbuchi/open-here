import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTags, spreadZones, cityFocus, pickLandmark, tidyPlace, neighborhoodOf } from '../lib/analyze.mjs';

const ids = list => list.map(id => ({ id, name: id.split(':').pop() }));

test('rankTags picks the place kind, not a dish tag that supermarkets carry', () => {
  const tags = ids(['urn:tag:specialty_dish:place:bakery_vegan', 'urn:tag:offerings:place:vegan_options', 'urn:tag:genre:place:restaurant:bakery', 'urn:tag:category:place:bakery', 'urn:tag:category:place:vegan_restaurant', 'urn:tag:category:place:wedding_bakery']);
  const ranked = rankTags(tags, 'Vegan bakery');
  assert.equal(ranked[0].id, 'urn:tag:category:place:bakery');
  assert.ok(ranked.every(t => !t.id.includes('specialty_dish') && !t.id.includes('offerings')));
});

test('rankTags never matches a boutique concept to hotels', () => {
  const tags = ids(['urn:tag:genre:place:hotel:boutique', 'urn:tag:decor:qloo:boutique', 'urn:tag:category:place:boutique']);
  assert.deepEqual(rankTags(tags, 'Sneaker boutique').map(t => t.id), ['urn:tag:category:place:boutique']);
});

test('rankTags keeps cuisine tags as a fallback (Taqueria, Ramen)', () => {
  assert.equal(rankTags(ids(['urn:tag:cuisine:qloo:taqueria']), 'Taqueria')[0].id, 'urn:tag:cuisine:qloo:taqueria');
});

test('tidyPlace shortens long locality strings', () => {
  assert.equal(tidyPlace('London, London Borough of Lambeth, Inner London - East, Surrey, Greater London, England, United Kingdom'), 'London, England, United Kingdom');
  assert.equal(tidyPlace('Springfield, Greene County, Missouri, United States'), 'Springfield, Missouri, United States');
  assert.equal(tidyPlace('Zurich, Switzerland'), 'Zurich, Switzerland');
});

test('neighborhoodOf picks the most common neighborhood', () => {
  assert.equal(neighborhoodOf([{ neighborhood: 'South Lamar' }, { neighborhood: 'Zilker' }, { neighborhood: 'South Lamar' }, {}]), 'South Lamar');
});

test('pickLandmark prefers a cafe over a zoo, a museum cafe or a discount grocer', () => {
  const zone = { lat: 47.38, lon: 8.57 };
  const at = (name, tags, d) => ({ name, tags, lat: 47.38 + d, lon: 8.57 });
  const local = [
    at('Zoo Zürich', ['urn:tag:category:place:zoo', 'urn:tag:category:place:restaurant'], 0),
    at('Museum Café', ['urn:tag:category:place:museum', 'urn:tag:genre:place:cafe'], 0.0005),
    at('Lidl', ['urn:tag:category:place:shopping'], 0.001),
    // Descriptive tags like parking or nearby attractions must not disqualify.
    at('Café Bärenbohl', ['urn:tag:genre:place:restaurant:coffee_shop', 'urn:tag:amenity:qloo:parking', 'urn:tag:nearby_attraction:qloo:zoo'], 0.004),
  ];
  assert.equal(pickLandmark(zone, local).name, 'Café Bärenbohl');
  assert.equal(pickLandmark(zone, local.slice(0, 3)), null);
});

test('cityFocus centers on the competitor cluster and ignores far outliers', () => {
  const city = Array.from({ length: 9 }, (_, i) => ({ lat: 40.7 + i * 0.005, lon: -74 }));
  const outlier = { lat: 43.05, lon: -76.15 }; // Syracuse, about 300 km away
  const { center, radiusKm } = cityFocus([...city, outlier]);
  assert.ok(Math.abs(center.lat - 40.72) < 0.01);
  assert.ok(radiusKm >= 3 && radiusKm <= 15);
});

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
