// Re-applies the public-data filter to recorded examples, so published files
// never carry Qloo entity IDs or raw scores. New recordings are already clean.
// node scripts/sanitize-examples.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { publicMarket } from '../lib/public.mjs';

const dir = new URL('../public/examples/', import.meta.url);
for (const file of (await readdir(dir)).filter(f => f.endsWith('.json') && !f.endsWith('-baseline.json'))) {
  const url = new URL(file, dir);
  const ex = JSON.parse(await readFile(url, 'utf8'));
  ex.events = ex.events.map(e => (e.type === 'market' ? { ...e, data: publicMarket(e.data) } : e));
  await writeFile(url, JSON.stringify(ex));
  console.log('sanitized', file);
}
