// GET /api/baseline?concept=...&city=...&brief=...
// What a plain LLM recommends without Qloo, cross-checked against Qloo data.
import { runBaseline } from '../lib/baseline.mjs';
import { LlmError } from '../lib/llm.mjs';
import { createThrottle, clientIp } from '../lib/throttle.mjs';

const limited = createThrottle({ max: 4 });

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Use GET' }));
  }
  if (limited(clientIp(req))) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many comparisons. Wait a minute and try again.' }));
  }
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    const { concept, city, brief } = req.query || {};
    if (!String(concept || '').trim() || !String(city || '').trim()) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Enter a concept and a city' }));
    }
    const result = await runBaseline({ concept: String(concept).trim(), city: String(city).trim(), brief: String(brief || '') }, { signal: abort.signal });
    res.end(JSON.stringify(result));
  } catch (err) {
    const known = err instanceof LlmError || (err.status >= 400 && err.status < 500);
    if (!known) console.error(err);
    res.statusCode = known && err.status ? err.status : known ? 503 : 502;
    res.end(JSON.stringify({ error: known ? err.message : 'The comparison failed. Try again.' }));
  }
}
