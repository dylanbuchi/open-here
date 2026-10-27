// Best-effort per-instance throttle to protect the API keys from abuse.
export function createThrottle({ windowMs = 60_000, max }) {
  const hits = new Map();
  return function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    // Drop idle buckets occasionally so memory stays bounded.
    if (hits.size > 1000) for (const [k, ts] of hits) if (now - ts[ts.length - 1] >= windowMs) hits.delete(k);
    return recent.length > max;
  };
}

export const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
