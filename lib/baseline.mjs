// "Without Qloo" baseline: the same model and brief, but no tools, so it
// answers from general knowledge alone. Its picks are then checked against
// what Qloo's data returned for the same audience, so the comparison is a
// measurement rather than a matter of taste.
import { analyze } from './analyze.mjs';
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

export async function runBaseline({ concept, city, brief = '' }, { qloo = createQloo(), llm = createLlm(), signal } = {}) {
  const [market, res] = await Promise.all([
    analyze({ concept, city }, { qloo }),
    llm.respond({
      instructions: INSTRUCTIONS,
      input: [{ role: 'user', content: `Business concept: ${clip(concept, 80)}\nCity: ${clip(city, 80)}\nFounder's brief: ${clip(brief, 240) || '(none)'}` }],
      signal,
    }),
  ]);
  const baseline = parseBaseline(outputText(res));
  if (!baseline) throw new LlmError('The plain AI gave an unreadable answer. Try again.');
  return crossCheck(baseline, market);
}
