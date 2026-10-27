// Open Here pipeline: concept + city -> competitors, taste-lift zones,
// audience profile and cross-domain taste, all grounded in Qloo data.
import { createQloo, QlooError } from './qloo.mjs';
import { scoreCells, rankZones, normalizeLift } from './lift.mjs';

const MIN_COMPETITORS = 3;

function km(a, b) {
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toPlace(e) {
  return {
    id: e.entity_id,
    name: e.name,
    address: e.properties?.address || '',
    lat: e.location?.lat,
    lon: e.location?.lon,
    popularity: e.popularity,
    rating: e.properties?.business_rating ?? null,
    priceLevel: e.properties?.price_level ?? null,
  };
}

// Prefer tags whose name appears verbatim in the query (so "Italian
// restaurant" picks Italian, not Northern Italian), then place genre tags,
// which carry the best place coverage.
export function rankTags(tags, query = '') {
  const q = query.toLowerCase();
  const score = t =>
    (q.includes(String(t.name || '').toLowerCase()) ? 0 : 3) +
    (t.id.includes(':genre:place:') ? 0 : t.id.includes(':place') ? 1 : 2);
  return [...tags].sort((a, b) => score(a) - score(b));
}

// Greedy pick of the best zones that sit at least minKm apart.
export function spreadZones(zones, { minKm = 1.5, top = 5 } = {}) {
  const picked = [];
  for (const z of zones) {
    if (picked.every(p => km(p, z) >= minKm)) picked.push(z);
    if (picked.length === top) break;
  }
  return picked;
}

async function resolveConcept(qloo, concept, city) {
  const tags = rankTags(await qloo.searchTags(concept, 10), concept).slice(0, 5);
  for (const tag of tags) {
    const res = await qloo.insights({
      'filter.type': 'urn:entity:place',
      'filter.location.query': city,
      'filter.tags': tag.id,
      take: 50,
    });
    const places = (res.entities || []).map(toPlace).filter(p => p.lat != null);
    if (places.length >= MIN_COMPETITORS) return { tag, places };
  }
  return null;
}

function averageDemographics(rows) {
  const sum = { age: {}, gender: {} };
  for (const r of rows) {
    for (const k of ['age', 'gender']) {
      for (const [band, v] of Object.entries(r.query?.[k] || {})) sum[k][band] = (sum[k][band] || 0) + v / rows.length;
    }
  }
  return sum;
}

const names = res => (res.entities || []).map(e => e.name?.trim()).filter(n => n && /\p{L}/u.test(n));

export async function analyze({ concept, city }, { qloo = createQloo() } = {}) {
  concept = String(concept || '').trim().slice(0, 80);
  city = String(city || '').trim().slice(0, 80);
  if (!concept || !city) throw new QlooError('Enter a concept and a city', 400);

  const resolved = await resolveConcept(qloo, concept, city);
  if (!resolved) throw new QlooError(`Not enough Qloo data for "${concept}" in ${city}. Try a broader concept like "Italian restaurant" or "coffee shop".`, 404);
  const { tag, places } = resolved;
  const seeds = places.slice(0, 3).map(p => p.id);
  const signal = { 'signal.interests.entities': seeds };

  const [heat, demo, artists, movies, brands] = await Promise.all([
    qloo.insights({ 'filter.type': 'urn:heatmap', 'filter.location.query': city, 'output.heatmap.boundary': 'urn:geohash', ...signal }),
    qloo.insights({ 'filter.type': 'urn:demographics', ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:artist', 'signal.location.query': city, take: 8, ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:movie', 'signal.location.query': city, take: 6, ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:brand', 'signal.location.query': city, take: 8, ...signal }).catch(() => ({})),
  ]);

  const cells = (heat.heatmap || []).map(h => ({
    lat: h.location.latitude,
    lon: h.location.longitude,
    geohash: h.location.geohash,
    affinity: h.query.affinity,
    popularity: h.query.popularity,
  }));
  const scored = scoreCells(cells);
  // Sparse cities rarely have two cells per zone, so fall back to single cells.
  let ranked = rankZones(scored, { top: 60 });
  if (ranked.length < 3) ranked = rankZones(scored, { top: 60, minCells: 1 });
  const zones = spreadZones(ranked).map((z, i) => {
    const nearby = places.filter(p => km(z, p) <= 1);
    const nearest = places.reduce((best, p) => (!best || km(z, p) < km(z, best) ? p : best), null);
    return {
      rank: i + 1,
      ...z,
      competitorsWithin1km: nearby.length,
      landmark: nearest ? { name: nearest.name, address: nearest.address, km: Number(km(z, nearest).toFixed(2)) } : null,
    };
  });

  return {
    concept,
    city,
    tag: { id: tag.id, name: tag.name },
    seeds,
    competitors: places,
    zones,
    heatmap: normalizeLift(scored).map(c => ({ lat: c.lat, lon: c.lon, intensity: Number(c.intensity.toFixed(3)) })),
    audience: {
      demographics: averageDemographics(demo.demographics || []),
      artists: names(artists),
      movies: names(movies),
      brands: names(brands),
    },
    stats: { cells: cells.length, scoredCells: scored.length },
  };
}
