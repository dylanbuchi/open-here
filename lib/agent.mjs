// The Open Here agent: an LLM that drives Qloo tools to scout a location and
// write a launch playbook. Every list it recommends is checked against the
// names Qloo actually returned, so judges can see what is grounded.
import { analyze } from './analyze.mjs';
import { createQloo } from './qloo.mjs';
import { createLlm } from './llm.mjs';

const MAX_TURNS = 7;
const MAX_TOOL_CALLS = 10;
const DOMAINS = ['artist', 'movie', 'brand', 'tv_show', 'book', 'podcast'];
const AGE_BANDS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

const INSTRUCTIONS = `You are Open Here, a location scout and launch strategist for people opening a local business.
Work in steps:
1. Call analyze_market first.
2. Investigate with zone_taste and audience_taste (2 to 4 calls total). Pick what matters for this founder's brief: for example the top zone's local taste, or the taste of the age group the founder targets.
3. Finish by calling submit_playbook exactly once.
Choosing the best zone: taste lift is the main signal, but check each zone's address against the founder's brief. Airports, malls and highway stops are poor fits for neighborhood concepts, so prefer a lower-ranked zone when it fits the brief better, and say why.
If low_signal is true, say honestly that demand is spread evenly across the city, and choose the zone on competition and fit instead of lift.
Rules: Ground every recommendation in tool results. Playlist artists, partner brands and cultural references must be names the tools returned. Never invent places, numbers or names. Explain "taste lift" plainly: demand for this concept that is higher than the area's general foot traffic predicts. Be specific and concise: keep each text field under 45 words. Write in English.`;

const tools = [
  { type: 'function', name: 'analyze_market', description: 'Map the concept in the city: real competitors, top zones ranked by taste lift, audience demographics and cross-domain taste. Call first.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'zone_taste', description: 'What people around one zone love in a domain, from Qloo, localized to that zone.', parameters: { type: 'object', properties: { rank: { type: 'integer', minimum: 1, maximum: 5 }, domain: { type: 'string', enum: DOMAINS } }, required: ['rank', 'domain'], additionalProperties: false } },
  { type: 'function', name: 'audience_taste', description: 'What this concept\'s fans in the city love in a domain, optionally focused on age bands.', parameters: { type: 'object', properties: { domain: { type: 'string', enum: DOMAINS }, age_bands: { type: 'array', items: { type: 'string', enum: AGE_BANDS } } }, required: ['domain'], additionalProperties: false } },
  {
    type: 'function', name: 'submit_playbook', description: 'Submit the final launch playbook.',
    parameters: {
      type: 'object',
      properties: {
        best_zone_rank: { type: 'integer', minimum: 1, maximum: 5 },
        headline: { type: 'string', description: 'One punchy sentence.' },
        why_here: { type: 'array', items: { type: 'string' }, description: '2-3 data-backed reasons for the best zone.' },
        target_customer: { type: 'string' },
        vibe: { type: 'string', description: 'Decor, music and atmosphere direction.' },
        offer_ideas: { type: 'array', items: { type: 'string' }, description: '3-4 menu or product ideas.' },
        playlist: { type: 'array', items: { type: 'string' }, description: '4-6 artist names from tool results.' },
        partners: { type: 'array', items: { type: 'string' }, description: '2-4 brand names from tool results.' },
        opening_pitch: { type: 'string', description: 'A 2 sentence pitch for the opening announcement.' },
      },
      required: ['best_zone_rank', 'headline', 'why_here', 'target_customer', 'vibe', 'offer_ideas', 'playlist', 'partners', 'opening_pitch'],
      additionalProperties: false,
    },
  },
];

const round = n => Math.round(n * 1000) / 1000;
const clip = (s, n = 400) => String(s ?? '').slice(0, n);
const clipList = (a, n = 6) => (Array.isArray(a) ? a : []).slice(0, n).map(s => clip(s, 200));

function summarizeMarket(m) {
  const topBands = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${round(v)}`);
  return {
    concept: m.concept,
    city: m.city,
    qloo_tag: m.tag.name,
    low_signal: m.lowSignal,
    competitors_found: m.competitors.length,
    best_known_competitors: m.competitors.slice(0, 6).map(c => c.name),
    zones: m.zones.map(z => ({ rank: z.rank, near: z.landmark?.name, address: z.landmark?.address, taste_lift: round(z.lift), foot_traffic: round(z.popularity), competitors_within_1km: z.competitorsWithin1km })),
    audience_age_skew: topBands(m.audience.demographics.age),
    audience_gender_skew: topBands(m.audience.demographics.gender),
    audience_artists: m.audience.artists,
    audience_movies: m.audience.movies,
    audience_brands: m.audience.brands,
  };
}

const parseArgs = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Runs the agent and reports progress through onEvent({ type, ... }).
export async function runAgent({ concept, city, brief = '' }, onEvent, { qloo = createQloo(), llm = createLlm() } = {}) {
  brief = clip(brief, 240);
  let market = null;
  const seen = new Set();
  const remember = names => names.forEach(n => seen.add(n.toLowerCase()));
  const names = res => (res.entities || []).map(e => e.name?.trim()).filter(n => n && /\p{L}/u.test(n));
  let toolCalls = 0;

  async function runTool(name, args) {
    if (name === 'analyze_market') {
      // Always the user's own concept and city, never model-chosen values.
      market = market || await analyze({ concept, city }, { qloo });
      remember([...market.audience.artists, ...market.audience.movies, ...market.audience.brands, ...market.competitors.map(c => c.name)]);
      onEvent({ type: 'market', data: market });
      return summarizeMarket(market);
    }
    if (!market) return { error: 'Call analyze_market first.' };
    const domain = DOMAINS.includes(args.domain) ? args.domain : 'artist';
    const base = { 'filter.type': `urn:entity:${domain}`, 'signal.interests.entities': market.seeds, take: 8 };
    if (name === 'zone_taste') {
      const zone = market.zones.find(z => z.rank === args.rank) || market.zones[0];
      if (!zone) return { error: 'No zones available.' };
      const res = await qloo.insights({ ...base, 'signal.location': `POINT(${zone.lon} ${zone.lat})`, 'signal.location.radius': 1500 });
      const list = names(res);
      remember(list);
      return { zone: zone.rank, near: zone.landmark?.name, domain, top: list };
    }
    if (name === 'audience_taste') {
      const bands = (args.age_bands || []).filter(b => AGE_BANDS.includes(b));
      const res = await qloo.insights({ ...base, 'signal.location.query': city, ...(bands.length && { 'signal.demographics.age': bands }) });
      const list = names(res);
      remember(list);
      return { domain, age_bands: bands, top: list };
    }
    return { error: `Unknown tool ${name}` };
  }

  function finalize(args) {
    const zone = market.zones.find(z => z.rank === args.best_zone_rank) || market.zones[0];
    const ground = list => clipList(list).map(name => ({ name, fromQloo: seen.has(name.toLowerCase()) }));
    return {
      bestZone: zone ? { rank: zone.rank, near: zone.landmark?.name, lat: zone.lat, lon: zone.lon } : null,
      headline: clip(args.headline, 240),
      whyHere: clipList(args.why_here, 3).map(s => clip(s, 400)),
      targetCustomer: clip(args.target_customer, 600),
      vibe: clip(args.vibe, 600),
      offerIdeas: clipList(args.offer_ideas, 4).map(s => clip(s, 300)),
      playlist: ground(args.playlist),
      partners: ground(args.partners),
      openingPitch: clip(args.opening_pitch, 500),
    };
  }

  const label = (name, args) => ({
    analyze_market: `Mapping ${concept} demand across ${city}`,
    zone_taste: `Checking ${String(args.domain || '').replace('_', ' ')} taste around zone ${args.rank}`,
    audience_taste: `Profiling the audience's ${String(args.domain || '').replace('_', ' ')} taste${args.age_bands?.length ? ` (${args.age_bands.join(', ').replaceAll('_', ' ')})` : ''}`,
    submit_playbook: 'Writing your launch playbook',
  }[name] || name);

  const input = [{ role: 'user', content: `Business concept: ${concept}\nCity: ${city}\nFounder's brief: ${brief || '(none)'}` }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await llm.respond({ instructions: INSTRUCTIONS, input, tools });
    const calls = (res.output || []).filter(o => o.type === 'function_call');
    if (!calls.length) {
      input.push(...(res.output || []), { role: 'user', content: 'Use the tools, then call submit_playbook.' });
      continue;
    }
    input.push(...res.output);
    for (const call of calls) {
      const args = parseArgs(call.arguments);
      onEvent({ type: 'step', tool: call.name, label: label(call.name, args) });
      if (call.name === 'submit_playbook' && market) {
        const playbook = finalize(args);
        onEvent({ type: 'playbook', data: playbook });
        return playbook;
      }
      let output;
      if (++toolCalls > MAX_TOOL_CALLS) output = { error: 'Tool limit reached. Call submit_playbook now.' };
      else {
        try { output = await runTool(call.name, args); }
        catch (err) { output = { error: err.status === 404 ? err.message : 'Tool failed.' }; if (call.name === 'analyze_market') throw err; }
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  throw new Error('The agent ran out of steps before finishing.');
}
