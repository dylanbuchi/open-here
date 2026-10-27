// "Without Qloo" baseline: the same model and brief, but no tools, so it
// answers from general knowledge alone. Its picks are then checked against
// what Qloo's data returned for the same audience, so the comparison is a
// measurement rather than a matter of taste.
import { analyze, liftNear, km } from './analyze.mjs';
import { createQloo } from './qloo.mjs';
import { createLlm, LlmError } from './llm.mjs';

const INSTRUCTIONS = `You are an expert location scout and launch strategist for people opening a local business.
Recommend where to open and how to launch, using only your own knowledge.
Respond with ONLY a JSON object, no prose, with exactly these keys:
{"neighborhood": string, "why_here": string, "target_customer": string,
 "playlist": [4-6 music artist names], "partners": [2-4 brand names]}
Keep each text field under 40 words.`;

const clip = (s, n) => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').slice(0, n);
// Drops hedged non-answers like "Starbucks Alternative? no".
const list = (a, n) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && x.trim() && !x.includes('?')).slice(0, n).map(s => clip(s.trim(), 120));

export function parseBaseline(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const v = JSON.parse(match[0]);
    return {
      neighborhood: clip(v.neighborhood, 160),
      whyHere: clip(v.why_here, 400),
      targetCustomer: clip(v.target_customer, 400),
      playlist: list(v.playlist, 6),
      partners: list(v.partners, 4),
    };
  } catch {
    return null;
  }
}

// Marks each plain-AI pick by whether Qloo's results for this audience
// include it. Absence means "not among Qloo's top results", not "wrong".
export function crossCheck(baseline, market) {
  const artists = new Set(market.audience.artists.map(n => n.toLowerCase()));
  const brands = new Set(market.audience.brands.map(n => n.toLowerCase()));
  const mark = (names, set) => names.map(name => ({ name, inQloo: set.has(name.toLowerCase()) }));
  const playlist = mark(baseline.playlist, artists);
  const partners = mark(baseline.partners, brands);
  return {
    ...baseline,
    playlist,
    partners,
    score: {
      matched: [...playlist, ...partners].filter(x => x.inQloo).length,
      total: playlist.length + partners.length,
    },
  };
}

const outputText = res => (res.output || [])
  .filter(o => o.type === 'message')
  .flatMap(o => o.content || [])
  .filter(c => c.type === 'output_text')
  .map(c => c.text)
  .join('');

// "East Austin (Manor Road corridor)" -> "East Austin"; "Little Tokyo / Arts
// District border" -> "Little Tokyo".
export const cleanNeighborhood = s => String(s || '').split(/[(/,;]| near | around /i)[0].trim();

// Put the plain AI's neighborhood on the same map and measure it the way
// Open Here measures its own zones. A match outside the searched city is
// rejected rather than guessed ("Canal Saint-Martin" once found Saint-Denis).
// A hit counts only if it really is the named place: its name must contain
// the query's most distinctive word ("Little Osaka" once matched Little Tokyo).
const GENERIC = new Set(['little', 'east', 'west', 'north', 'south', 'upper', 'lower', 'new', 'old', 'the', 'saint', 'santa', 'san', 'district', 'village', 'park', 'heights', 'downtown', 'midtown']);

export function sameName(query, hit) {
  const all = String(query).toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const key = (all.filter(w => !GENERIC.has(w)).length ? all.filter(w => !GENERIC.has(w)) : all).sort((a, b) => b.length - a.length)[0];
  return Boolean(key) && String(hit).toLowerCase().includes(key);
}

export async function locateAndMeasure(neighborhood, market, qloo) {
  const name = cleanNeighborhood(neighborhood);
  if (!name) return { found: false, name: neighborhood };
  // Also try an alternative given in parentheses: "Little Osaka (Sawtelle)".
  const alt = cleanNeighborhood(String(neighborhood).match(/\(([^)]+)\)/)?.[1]);
  let spot = null;
  for (const candidate of [name, alt].filter(Boolean)) {
    const hits = await qloo.search(`${candidate}, ${market.city}`, 'urn:entity:locality', 3).catch(() => []);
    spot = hits
      .map(h => ({ name: h.name, lat: h.location?.lat, lon: h.location?.lon }))
      .find(h => Number.isFinite(h.lat) && Number.isFinite(h.lon) && sameName(candidate, h.name) && km(market.center, h) <= market.radiusKm * 1.2);
    if (spot) break;
  }
  if (!spot) return { found: false, name };
  const lift = liftNear(market.scored, spot);
  const agrees = market.zones.find(z => km(z, spot) <= 1.5);
  return {
    found: true,
    name: spot.name,
    lat: spot.lat,
    lon: spot.lon,
    liftPoints: lift == null ? null : Math.round(lift * 100),
    competitorsWithin1km: market.competitors.filter(p => km(spot, p) <= 1).length,
    competitorSample: market.competitors.length,
    agreesWithZone: agrees ? agrees.rank : null,
  };
}

export async function runBaseline({ concept, city, brief = '' }, { qloo = createQloo(), llm = createLlm(), signal } = {}) {
  const [market, res] = await Promise.all([
    analyze({ concept, city }, { qloo, keepScored: true }),
    llm.respond({
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: `Business concept: ${clip(concept, 80)}\nCity: ${clip(city, 80)}\nFounder's brief: ${clip(brief, 240) || '(none)'}` }],
      signal,
    }),
  ]);
  const baseline = parseBaseline(outputText(res));
  if (!baseline) throw new LlmError('The plain AI gave an unreadable answer. Try again.');
  const location = await locateAndMeasure(baseline.neighborhood, market, qloo);
  return { ...crossCheck(baseline, market), location, zoneScores: scoreZonesLikeAPoint(market) };
}

// Score Open Here's spots exactly like the plain AI's pick: the average taste
// lift within 1 km of the point, and competitors within 1 km. (Zone ranking
// itself averages a map area, which gives slightly different numbers.)
export function scoreZonesLikeAPoint(market) {
  return market.zones.map(z => {
    const lift = liftNear(market.scored, z);
    return {
      rank: z.rank,
      liftPoints: lift == null ? null : Math.round(lift * 100),
      competitorsWithin1km: market.competitors.filter(p => km(z, p) <= 1).length,
    };
  });
}
