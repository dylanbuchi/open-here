// Local dev server: serves public/ and mounts the same API handlers Vercel uses.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import analyzeHandler from './api/analyze.mjs';
import agentHandler from './api/agent.mjs';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const routes = { '/api/analyze': analyzeHandler, '/api/agent': agentHandler };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[url.pathname];
  if (route) {
    req.query = Object.fromEntries(url.searchParams);
    return route(req, res);
  }
  const file = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Open Here on http://127.0.0.1:${PORT}`));
