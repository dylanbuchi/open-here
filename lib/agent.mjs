// The Open Here agent: an LLM that drives Qloo tools to scout a location and
// write a launch playbook. Every list it recommends is checked against the
// names Qloo actually returned, so judges can see what is grounded.
import { analyze } from './analyze.mjs';
import { createQloo } from './qloo.mjs';
import { createLlm, LlmError } from './llm.mjs';

const MAX_TURNS = 7;
const MAX_TOOL_CALLS = 10;
const DOMAINS = ['artist', 'movie', 'brand', 'tv_show', 'book', 'podcast'];
const AGE_BANDS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

const INSTRUCTIONS = `You are Open Here, a location scout and launch strategist for people opening a local business.
Work in steps:
1. Call analyze_market first.
2. Investigate with zone_taste and audience_taste (2 to 4 calls total). Pick what matters for this founder's brief: for example compare the taste of two candidate zones, or the taste of the age group the founder targets.
3. Sanity-check before you decide: look for Qloo results that are surprising for this concept and brief (an age peak that doesn't fit, artists that clash with the vibe, a name that isn't really a musician or brand, a zone with heavy competition). Record 1 to 3 of them in sanity_checks, each with what you noticed and what you did about it (kept it and why, or set it aside).
4. Finish by calling submit_playbook exactly once.
Choosing the best zone: taste lift is the main signal, but check each zone's address against the founder's brief. Airports, malls and highway stops are poor fits for neighborhood concepts, so prefer a lower-ranked zone when it fits the brief better, and say why.
If low_signal is true, say honestly that demand is spread evenly across the city, and choose the zone on competition and fit instead of lift.
Fit before data: the playlist must suit the brief and the vibe you describe. Pick only the Qloo artists that fit; if Qloo's top artists clash with the brief, use fewer, then say how to blend them in the vibe.
Partners must be plausible co-marketing partners for this concept (food, drink, local lifestyle, events). Never list media outlets or brands unrelated to the concept.
Describe the audience only with the audience labels as given (age groups like "Under 25", and gender exactly "Balanced", "Leans female" or "Leans male"). Never contradict or paraphrase them into something else.
Taste lift is given in points: say "taste lift +15". Never quote any other raw number or decimal.
Name zones by neighborhood first, e.g. "South Lamar, near Radio Coffee & Beer".
Partners must not be competitors: never list restaurants, bars or cafes as partners for a food or drink concept.
Proofread the headline: one clean, grammatical sentence.
Write plain sentences: never use em dashes.
Only cite evidence the founder can see: zone neighborhoods and landmarks, taste lift points, sampled competitor counts, the audience labels, and the names you put in the playlist and partners. Never claim behavior the data doesn't show (for example "couples already go here").
Rules: Ground every recommendation in tool results. Playlist artists, partner brands and cultural references must be names the tools returned. Never invent places, numbers or names. Explain "taste lift" plainly: Qloo affinity for this concept that is higher than the area's general Qloo popularity predicts. Never call popularity "foot traffic", and never claim zero competitors exist: counts come from a sample. Be specific and concise: keep each text field under 45 words. Write in English.`;

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
        sanity_checks: {
          type: 'array',
          description: '1-3 surprising Qloo results and what you did about each.',
          items: { type: 'object', properties: { noticed: { type: 'string' }, decision: { type: 'string' } }, required: ['noticed', 'decision'], additionalProperties: false },
        },
      },
      required: ['best_zone_rank', 'headline', 'why_here', 'target_customer', 'vibe', 'offer_ideas', 'playlist', 'partners', 'opening_pitch', 'sanity_checks'],
      additionalProperties: false,
    },
  },
];

// Models still slip em dashes in; turn them into commas.
const clip = (s, n = 400) => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').slice(0, n);
const clipList = (a, n = 6) => (Array.isArray(a) ? a : []).slice(0, n).map(s => clip(s, 200));

// The exact labels the page shows, so the playbook can't contradict the
// charts (it once said "slightly female" beside a "Balanced" chart).
const AGE_LABEL = { '24_and_younger': 'Under 25', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and older' };

export function audienceLabels(demographics = {}) {
  const age = demographics.age || {};
  const ranked = Object.keys(AGE_LABEL).filter(k => typeof age[k] === 'number').sort((a, b) => age[b] - age[a]);
  const f = demographics.gender?.female;
  return {
    highest_affinity_ages: ranked.filter(k => age[k] > 0.05).slice(0, 2).map(k => AGE_LABEL[k]),
    lowest_affinity_ages: ranked.filter(k => age[k] < -0.05).slice(-2).map(k => AGE_LABEL[k]),
    gender: typeof f !== 'number' || Math.abs(f) < 0.05 ? 'Balanced' : f > 0 ? 'Leans female' : 'Leans male',
  };
}

const activity = p => (p >= 0.7 ? 'high' : p >= 0.5 ? 'medium' : 'lower');

function summarizeMarket(m) {
  return {
    concept: m.concept,
    city: m.city,
    qloo_tag: m.tag.name,
    low_signal: m.lowSignal,
    competitors_found: m.competitors.length,
    best_known_competitors: m.competitors.slice(0, 6).map(c => c.name),
    competitor_note: `Competitor counts come from a sample of the ${m.competitors.length} most popular matching places, not a full census.`,
    resolved_place: m.place,
    zones: m.zones.map(z => ({ rank: z.rank, neighborhood: z.neighborhood, near: z.landmark?.name, address: z.landmark?.address, taste_lift_points: Math.round(z.lift * 100), activity: activity(z.popularity), sampled_competitors_within_1km: z.competitorsWithin1km })),
    audience: audienceLabels(m.audience.demographics),
    audience_artists: m.audience.artists,
    audience_movies: m.audience.movies,
    audience_brands: m.audience.brands,
  };
}

const parseArgs = s => {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
};

const isText = v => typeof v === 'string' && v.trim().length > 0;
const isTextList = v => Array.isArray(v) && v.length > 0 && v.every(isText);

// Returns an error string the model can act on, or null when valid.
export function playbookProblem(args, zones) {
  if (!args) return 'Arguments must be a JSON object.';
  if (!zones.some(z => z.rank === args.best_zone_rank)) return `best_zone_rank must be one of ${zones.map(z => z.rank).join(', ')}.`;
  for (const k of ['headline', 'target_customer', 'vibe', 'opening_pitch']) if (!isText(args[k])) return `${k} must be a non-empty string.`;
  for (const k of ['why_here', 'offer_ideas', 'playlist', 'partners']) if (!isTextList(args[k])) return `${k} must be a non-empty list of strings.`;
  const checks = args.sanity_checks;
  if (!Array.isArray(checks) || !checks.length || !checks.every(c => c && isText(c.noticed) && isText(c.decision))) {
    return 'sanity_checks must list 1-3 items, each with noticed and decision.';
  }
  return null;
}

// Runs the agent and reports progress through onEvent({ type, ... }).
// Stops cleanly when `signal` aborts or the deadline is near, so serverless
// hosts never kill it mid-run without a terminal event.
export async function runAgent({ concept, city, brief = '' }, onEvent, { qloo = createQloo(), llm = createLlm(), signal, deadlineMs = 50_000 } = {}) {
  brief = clip(brief, 240);
  const deadline = Date.now() + deadlineMs;
  let market = null;
  // Provenance by domain, so a playlist can only be verified by artist data
  // and partners only by brand data.
  const seen = Object.fromEntries(DOMAINS.map(d => [d, new Set()]));
  const remember = (domain, list) => list.forEach(n => seen[domain].add(n.toLowerCase()));
  const names = res => (res.entities || []).map(e => e.name?.trim()).filter(n => n && /\p{L}/u.test(n));
  let toolCalls = 0;

  async function runTool(name, args) {
    if (name === 'analyze_market') {
      // Always the user's own concept and city, never model-chosen values.
      market = market || await analyze({ concept, city }, { qloo });
      remember('artist', market.audience.artists);
      remember('movie', market.audience.movies);
      remember('brand', market.audience.brands);
      onEvent({ type: 'market', data: market });
      return summarizeMarket(market);
    }
    if (!market) return { error: 'Call analyze_market first.' };
    if (!DOMAINS.includes(args.domain)) return { error: `domain must be one of ${DOMAINS.join(', ')}.` };
    const domain = args.domain;
    const base = { 'filter.type': `urn:entity:${domain}`, 'signal.interests.entities': market.seeds, take: 8 };
    if (name === 'zone_taste') {
      const zone = market.zones.find(z => z.rank === args.rank);
      if (!zone) return { error: `rank must be one of ${market.zones.map(z => z.rank).join(', ') || '(no zones)'}.` };
      const res = await qloo.insights({ ...base, 'signal.location': `POINT(${zone.lon} ${zone.lat})`, 'signal.location.radius': 1500 });
      const list = names(res);
      remember(domain, list);
      return { zone: zone.rank, near: zone.landmark?.name, domain, top: list };
    }
    if (name === 'audience_taste') {
      const bands = (Array.isArray(args.age_bands) ? args.age_bands : []).filter(b => AGE_BANDS.includes(b));
      const res = await qloo.insights({ ...base, 'signal.location.query': city, ...(bands.length && { 'signal.demographics.age': bands }) });
      const list = names(res);
      remember(domain, list);
      return { domain, age_bands: bands, top: list };
    }
    return { error: `Unknown tool ${name}` };
  }

  function finalize(args) {
    const zone = market.zones.find(z => z.rank === args.best_zone_rank);
    const ground = (list, domain) => clipList(list).map(name => ({ name, fromQloo: seen[domain].has(name.toLowerCase()) }));
    return {
      bestZone: zone ? { rank: zone.rank, neighborhood: zone.neighborhood || null, near: zone.landmark?.name, lat: zone.lat, lon: zone.lon } : null,
      headline: clip(args.headline, 240),
      whyHere: clipList(args.why_here, 3).map(s => clip(s, 400)),
      targetCustomer: clip(args.target_customer, 600),
      vibe: clip(args.vibe, 600),
      offerIdeas: clipList(args.offer_ideas, 4).map(s => clip(s, 300)),
      playlist: ground(args.playlist, 'artist'),
      partners: ground(args.partners, 'brand'),
      openingPitch: clip(args.opening_pitch, 500),
      sanityChecks: args.sanity_checks.slice(0, 3).map(c => ({ noticed: clip(c.noticed, 300), decision: clip(c.decision, 300) })),
    };
  }

  const domainText = a => (DOMAINS.includes(a?.domain) ? a.domain.replace('_', ' ') : 'cultural');
  const label = (name, a) => ({
    analyze_market: `Mapping ${concept} demand across ${city}`,
    zone_taste: `Checking ${domainText(a)} taste around zone ${Number.isInteger(a?.rank) ? a.rank : ''}`.trim(),
    audience_taste: `Profiling the audience's ${domainText(a)} taste`,
    submit_playbook: 'Writing your launch playbook',
  }[name] || 'Working');

  const checkTime = () => {
    if (signal?.aborted) throw new LlmError('The search was cancelled.');
    if (deadline - Date.now() < 8000) throw new LlmError('The agent ran out of time. The map data still works.');
  };

  const input = [{ role: 'user', content: `Business concept: ${concept}\nCity: ${city}\nFounder's brief: ${brief || '(none)'}` }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    checkTime();
    const callSignal = AbortSignal.any([AbortSignal.timeout(deadline - Date.now() - 2000), ...(signal ? [signal] : [])]);
    const res = await llm.respond({ instructions: INSTRUCTIONS, input, tools, signal: callSignal });
    const calls = (res.output || []).filter(o => o.type === 'function_call');
    if (!calls.length) {
      input.push(...(res.output || []), { role: 'user', content: 'Use the tools, then call submit_playbook.' });
      continue;
    }
    input.push(...res.output);
    for (const call of calls) {
      checkTime();
      const args = parseArgs(call.arguments);
      onEvent({ type: 'step', tool: call.name, label: label(call.name, args) });
      let output;
      if (call.name === 'submit_playbook') {
        const problem = market ? playbookProblem(args, market.zones) : 'Call analyze_market first.';
        if (!problem) {
          const playbook = finalize(args);
          onEvent({ type: 'playbook', data: playbook });
          return playbook;
        }
        output = { error: `Playbook rejected: ${problem} Fix it and call submit_playbook again.` };
      } else if (!args) output = { error: 'Arguments must be a JSON object.' };
      else if (++toolCalls > MAX_TOOL_CALLS) output = { error: 'Tool limit reached. Call submit_playbook now.' };
      else {
        try { output = await runTool(call.name, args); }
        catch (err) { output = { error: err.status === 404 ? err.message : 'Tool failed.' }; if (call.name === 'analyze_market') throw err; }
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    }
  }
  throw new LlmError('The agent ran out of steps before finishing. The map data still works.');
}
