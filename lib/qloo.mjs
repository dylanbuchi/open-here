// Minimal Qloo API client. Reads credentials from the environment only.

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

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

    const res = await fetchImpl(url, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.errors?.[0]?.message || body?.error?.message || `Qloo request failed (${res.status})`;
      throw new QlooError(msg, res.status);
    }
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  return {
    searchTags: (query, take = 10) => get('/v2/tags', { 'filter.query': query, take }).then(b => b?.results?.tags || []),
    insights: params => get('/v2/insights', params).then(b => b?.results || {}),
  };
}
