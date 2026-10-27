// Open Here pipeline: concept + city -> competitors, taste-lift zones,
// audience profile and cross-domain taste, all grounded in Qloo data.
import { createQloo, QlooError } from './qloo.mjs';
import { scoreCells, rankZones, normalizeLift } from './lift.mjs';

const MIN_COMPETITORS = 3;
const AIRPORT = /airport|flughafen|aéroport|aeroport|aeropuerto|aeroporto|flygplats|lufthavn/i;
// Qloo place tags that mark everyday businesses. Hospitality comes first
// because it makes the most recognizable landmark for a new venue.
const HOSPITALITY = /restaurant|cafe|coffee|:bar\b|_bar\b|bakery|pub|brewery|bistro|deli|dessert|ice_cream|night_club|wine/;
const RETAIL = /shop|store|shopping|boutique|market(?!ing)/;
const CHAIN_GROCERY = /supermarket|grocery|discount|gas_station|convenience/;
// Off-topic "coffee shops" (Amsterdam sense) and similar noise.
const NOISE = /cannabis|weed|cbd|hemp/i;
const MIN_ZONE_BUSINESSES = 3;
const MIN_ZONE_POPULARITY = 0.45;

// Places that never make a sensible "open near here" anchor, whatever other
// tags they carry (a museum with a cafe is still a museum).
const NOT_AN_ANCHOR = /zoo|aquarium|museum|arena|stadium|:park$|_park$|mountain|peak|airport|convention|corporate|hotel|casino|university|hospital|church|cemetery/;
const DISCOUNT_CHAINS = /\b(lidl|aldi|walmart|costco|7-eleven)\b/i;
const CHAINS = /\b(starbucks|mcdonald'?s|subway|whataburger|chipotle|dunkin'?|papa john'?s|domino'?s|taco bell|kfc|burger king|wendy'?s|pizza hut|panera|chick-fil-a|in-n-out|five guys|pret)\b/i;

// Qloo places carry dozens of descriptive tags (parking, nearby attractions,
// ambience). Only category and genre tags say what a place *is*.
const kinds = p => p.tags.filter(t => /^urn:tag:(category|genre):place:/.test(t));
const anchorable = p => !kinds(p).some(t => NOT_AN_ANCHOR.test(t) || CHAIN_GROCERY.test(t)) && !DISCOUNT_CHAINS.test(p.name);
const isHospitality = p => anchorable(p) && kinds(p).some(t => HOSPITALITY.test(t));
const isBusiness = p => isHospitality(p) || (anchorable(p) && kinds(p).some(t => RETAIL.test(t)));

function km(a, b) {
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const validCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
export const validCell = c => validCoord(c.lat, c.lon) && unit(c.affinity) && unit(c.popularity) && typeof c.geohash === 'string' && c.geohash.length >= 6;

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
    tags: (e.tags || []).map(t => String(t.id || t.tag_id || t)),
    neighborhood: e.properties?.geocode?.name || null,
  };
}

// The zone's neighborhood: the most common one among the places there.
export function neighborhoodOf(local) {
  const counts = new Map();
  for (const p of local) if (p.neighborhood) counts.set(p.neighborhood, (counts.get(p.neighborhood) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Choose the zone's landmark: the best-known hospitality business within a
// short walk (a local favorite reads better than the nearest fast-food
// chain), else the nearest one, else the nearest shop. Never a zoo.
export function pickLandmark(zone, local) {
  const nearest = list => list.reduce((best, p) => (!best || km(zone, p) < km(zone, best) ? p : best), null);
  // Global chains are everywhere, so they say nothing about a neighborhood.
  const hosp = local.filter(p => isHospitality(p) && !CHAINS.test(p.name));
  const walkable = hosp.filter(p => km(zone, p) <= 0.5).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  return walkable[0] || nearest(hosp) || nearest(local.filter(isBusiness));
}

const words = s => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w.replace(/s$/, ''));

// Match a concept to a Qloo tag that says what a place *is*. Dish, amenity,
// decor and hotel tags are rejected ("Vegan bakery" once matched a vegan
// dish tag that Walmart carries). The concept's head noun must match, and
// extra or missing words cost points, so "Italian restaurant" picks Italian,
// not Southern Italian, and "Vegan bakery" picks Bakery.
export function rankTags(tags, query = '') {
  const q = words(query);
  const head = q[q.length - 1];
  const wantsHotel = q.includes('hotel');
  const usable = tags.filter(t =>
    /^urn:tag:((category|genre):place|cuisine:qloo):/.test(t.id) && (wantsHotel || !t.id.includes(':hotel')));
  const score = t => {
    const tw = new Set(words(t.id.split(':').pop().replace(/_/g, ' ')));
    const missing = q.filter(w => !tw.has(w)).length;
    const extra = [...tw].filter(w => !q.includes(w)).length;
    const kind = t.id.includes(':category:') ? 0 : t.id.includes(':genre:') ? 0.5 : 3;
    return (tw.has(head) ? 0 : 5) + missing + extra + kind;
  };
  return usable.sort((a, b) => score(a) - score(b));
}

// "London, London Borough of Lambeth, Inner London - East, …, United
// Kingdom" -> "London, England, United Kingdom".
export function tidyPlace(s) {
  const parts = [...new Set(String(s || '').split(',').map(p => p.trim()).filter(Boolean))];
  if (parts.length <= 3) return parts.join(', ') || null;
  return [parts[0], ...parts.slice(-2)].join(', ');
}

// Qloo can resolve a city name to a wider region ("New York" -> the state,
// "Zurich" -> the canton). Competitors cluster in the actual city, so keep
// cells within the radius that covers most of them around their median.
export function cityFocus(places, { share = 0.8, minKm = 3, maxKm = 15 } = {}) {
  const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const center = { lat: median(places.map(p => p.lat)), lon: median(places.map(p => p.lon)) };
  const dists = places.map(p => km(center, p)).sort((a, b) => a - b);
  const covering = dists[Math.min(dists.length - 1, Math.floor(dists.length * share))];
  return { center, radiusKm: Math.min(maxKm, Math.max(minKm, covering)) };
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

// Concepts with broad Qloo place coverage, checked across nine cities
// (see scripts/coverage.mjs). Offered when a search finds no data.
export const SAFE_CONCEPTS = ['Coffee shop', 'Italian restaurant', 'Bar', 'Bakery', 'Cocktail bar', 'Pizza', 'Brunch', 'Vegan restaurant', 'Thai restaurant', 'Juice bar'];

async function placesFor(qloo, tagId, city) {
  // One tag can fail upstream (seen with Sushi in Zurich); try the next.
  const res = await qloo.insights({ 'filter.type': 'urn:entity:place', 'filter.location.query': city, 'filter.tags': tagId, take: 50 }).catch(() => ({}));
  const places = (res.entities || []).map(toPlace).filter(p => validCoord(p.lat, p.lon) && !NOISE.test(p.name));
  // Tell the user which place Qloo matched ("Springfield" -> Missouri).
  const locality = res.query?.localities?.filter?.[0];
  return { places, place: tidyPlace(locality?.disambiguation || locality?.name) };
}

async function resolveConcept(qloo, concept, city) {
  const tags = rankTags(await qloo.searchTags(concept, 10), concept).slice(0, 5);
  for (const tag of tags) {
    const { places, place } = await placesFor(qloo, tag.id, city);
    if (places.length >= MIN_COMPETITORS) return { tag, places, place };
  }
  return null;
}

// Safe concepts that do have data in this city, for a helpful dead end.
async function suggestionsFor(qloo, city) {
  const checks = await Promise.all(SAFE_CONCEPTS.slice(0, 6).map(async c => ((await resolveConcept(qloo, c, city).catch(() => null)) ? c : null)));
  return checks.filter(Boolean).slice(0, 4);
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
  if (!resolved) {
    const suggestions = await suggestionsFor(qloo, city);
    const err = new QlooError(suggestions.length
      ? `Not enough Qloo data for "${concept}" in ${city}. Concepts are matched in English, so try one of these, which do have data there:`
      : `Qloo has no matching places for "${concept}" in ${city}. Check the city name, or try a bigger nearby city.`, 404);
    err.suggestions = suggestions;
    throw err;
  }
  const { tag, place } = resolved;
  // Keep competitors inside the actual city (Qloo can return suburbs or the
  // wider canton), measured from where they cluster.
  const focus = cityFocus(resolved.places);
  // Drop wrong-kind matches (hotels, supermarkets, discount chains) unless
  // the concept itself is that kind of place.
  const offKind = p => !/hotel|supermarket|grocery/.test(tag.id) && !anchorable(p);
  const inCity = resolved.places.filter(p => km(focus.center, p) <= focus.radiusKm * 1.2);
  const onKind = inCity.filter(p => !offKind(p));
  const places = onKind.length >= MIN_COMPETITORS ? onKind : inCity;
  const seeds = places.slice(0, 3).map(p => p.id);
  const signal = { 'signal.interests.entities': seeds };

  const [heat, demo, artists, movies, brands, airportRes] = await Promise.all([
    qloo.insights({ 'filter.type': 'urn:heatmap', 'filter.location.query': city, 'output.heatmap.boundary': 'urn:geohash', ...signal }),
    qloo.insights({ 'filter.type': 'urn:demographics', ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:artist', 'signal.location.query': city, take: 8, ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:movie', 'signal.location.query': city, take: 6, ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:brand', 'signal.location.query': city, take: 8, ...signal }).catch(() => ({})),
    qloo.insights({ 'filter.type': 'urn:entity:place', 'filter.location.query': city, 'filter.tags': 'urn:tag:category:place:airport', take: 10 }).catch(() => ({})),
  ]);
  const airports = (airportRes.entities || []).map(toPlace).filter(p => validCoord(p.lat, p.lon));

  const cells = (heat.heatmap || []).map(h => ({
    lat: h.location?.latitude,
    lon: h.location?.longitude,
    geohash: h.location?.geohash,
    affinity: h.query?.affinity,
    popularity: h.query?.popularity,
  })).filter(c => validCell(c) && km(focus.center, c) <= focus.radiusKm);
  const scored = scoreCells(cells);
  // Sparse cities rarely have two cells per zone, so fall back to single cells.
  // Only positive lift is hidden demand; never recommend the rest.
  let ranked = rankZones(scored, { top: 60 }).filter(z => z.lift > 0);
  if (ranked.length < 3) ranked = rankZones(scored, { top: 60, minCells: 1 }).filter(z => z.lift > 0);
  // Lift alone favors places with taste but little life (zoos, parks,
  // airports, highway overlooks). Scout extra zones and keep the ones with a
  // real commercial street: enough businesses nearby and enough activity.
  const scouted = await Promise.all(spreadZones(ranked, { top: 15 }).map(async (z) => {
    const local = await qloo.insights({ 'filter.type': 'urn:entity:place', 'filter.location': `POINT(${z.lon} ${z.lat})`, 'filter.location.radius': 700, take: 12 })
      .then(r => (r.entities || []).map(toPlace).filter(p => validCoord(p.lat, p.lon)))
      .catch(() => []);
    const landmark = pickLandmark(z, local);
    return {
      ...z,
      airport: airports.some(a => km(z, a) <= 3) || local.some(p => AIRPORT.test(`${p.name} ${p.address}`)),
      businesses: local.filter(isBusiness).length,
      competitorsWithin1km: places.filter(p => km(z, p) <= 1).length,
      neighborhood: neighborhoodOf(local),
      landmark: landmark ? { name: landmark.name, address: landmark.address, km: Number(km(z, landmark).toFixed(2)) } : null,
    };
  }));
  const viable = minPop => scouted.filter(z => !z.airport && z.landmark && z.businesses >= MIN_ZONE_BUSINESSES && z.popularity >= minPop);
  // Relax the activity floor before giving up, so smaller cities still get spots.
  let kept = viable(MIN_ZONE_POPULARITY);
  if (kept.length < 3) kept = viable(0.3);
  const zones = kept.slice(0, 5).map(({ airport, businesses, ...z }, i) => ({ rank: i + 1, ...z }));

  return {
    concept,
    city,
    place,
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
    // Very dense cities saturate Qloo's scores, leaving almost no lift to rank.
    lowSignal: !zones.length || zones[0].lift < 0.03,
    stats: { cells: cells.length, scoredCells: scored.length, radiusKm: Number(focus.radiusKm.toFixed(1)) },
  };
}
