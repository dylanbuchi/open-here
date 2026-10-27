// GET /api/agent?concept=...&city=...&brief=...
// Streams newline-delimited JSON events: step, market, playbook, error, done.
import { runAgent } from '../lib/agent.mjs';
import { budgetStatus, LlmError } from '../lib/llm.mjs';
import { createThrottle, clientIp } from '../lib/throttle.mjs';

const limited = createThrottle({ max: 4 });

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = event => res.write(JSON.stringify(event) + '\n');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ type: 'error', message: 'Use GET' }) + '\n');
  }
  if (limited(clientIp(req))) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ type: 'error', message: 'Too many agent runs. Wait a minute and try again.' }) + '\n');
  }
  if (!budgetStatus().available) {
    return res.end(JSON.stringify({ type: 'error', code: 'budget', message: 'The AI agent hit today\'s spending cap. The map data still works.' }) + '\n');
  }

  const { concept, city, brief } = req.query || {};
  // Stop paid work as soon as the visitor leaves or starts another search.
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    await runAgent({ concept: String(concept || '').trim().slice(0, 80), city: String(city || '').trim().slice(0, 80), brief }, send, { signal: abort.signal });
  } catch (err) {
    if (abort.signal.aborted) return res.end();
    const known = err instanceof LlmError || (err.status >= 400 && err.status < 500);
    if (!known) console.error(err);
    send({ type: 'error', message: known ? err.message : 'The agent hit a problem. Try again.' });
  }
  send({ type: 'done' });
  res.end();
}
