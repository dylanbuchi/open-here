// Minimal Qloo API client. Reads credentials from the environment only.

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

// Qloo rate-limits bursts (429), and one search fans out to ~25 calls, so
// cap concurrency per instance and retry briefly on 429 and 5xx.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting = [];
async function slot() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise(r => waiting.push(r));
  inFlight++;
}
function release() {
  inFlight--;
  waiting.shift()?.();
}
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class QlooError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createQloo({ baseUrl = process.env.QLOO_BASE_URL, apiKey = process.env.QLOO_API_KEY, fetchImpl = fetch } = {}) {
  if (!baseUrl || !apiKey) throw new QlooError('Qloo is not configured', 500);
  const base = baseUrl.replace(/\/$/, '');

  async function get(path, params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const url = `${base}${path}?${qs}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

    let res, body;
    for (let attempt = 0; ; attempt++) {
      await slot();
      try {
        res = await fetchImpl(url, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(20000) });
        body = await res.json().catch(() => null);
      } finally {
        release();
      }
      if (res.ok || !RETRY_STATUS.has(res.status) || attempt === 2) break;
      const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
      await sleep(Math.min(3000, retryAfter || 500 * 2 ** attempt));
    }
    if (!res.ok) {
      if (res.status === 429) throw new QlooError('Qloo is busy right now. Try again in a minute.', 503);
      const msg = body?.errors?.[0]?.message || body?.error?.message || `Qloo request failed (${res.status})`;
      throw new QlooError(msg, res.status);
    }
    // Bounded cache: Map keeps insertion order, so evict the oldest entry.
    if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  return {
    searchTags: (query, take = 10) => get('/v2/tags', { 'filter.query': query, take }).then(b => b?.results?.tags || []),
    search: (query, types, take = 3) => get('/search', { query, types, take }).then(b => (Array.isArray(b?.results) ? b.results : [])),
    // Keep `query` too: it says which locality a city name resolved to.
    insights: params => get('/v2/insights', params).then(b => ({ ...(b?.results || {}), query: b?.query })),
  };
}
