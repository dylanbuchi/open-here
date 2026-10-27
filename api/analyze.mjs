// GET /api/analyze?concept=...&city=...
import { analyze } from '../lib/analyze.mjs';
import { createThrottle, clientIp } from '../lib/throttle.mjs';

const limited = createThrottle({ max: 12 });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Use GET' }));
  }
  if (limited(clientIp(req))) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: 'Too many searches. Wait a minute and try again.' }));
  }
  try {
    const { concept, city } = req.query || {};
    const result = await analyze({ concept, city });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    res.statusCode = status;
    // 4xx messages are written for users; hide upstream details otherwise.
    res.end(JSON.stringify({ error: status === 502 ? 'Qloo is not responding right now. Try again shortly.' : err.message }));
    if (status === 502) console.error(err);
  }
}
