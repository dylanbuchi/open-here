// Records the plain-AI comparison for a recorded example, so example chips
// can show it without a paid call.
// node --env-file=.env scripts/record-baseline.mjs austin-italian
import { readFile, writeFile } from 'node:fs/promises';
import { runBaseline } from '../lib/baseline.mjs';

const slug = process.argv[2] || 'austin-italian';
if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug must be lowercase letters, digits and dashes');
const dir = new URL('../public/examples/', import.meta.url);
const example = JSON.parse(await readFile(new URL(`${slug}.json`, dir), 'utf8'));
const { concept, city, brief } = example;
const result = await runBaseline({ concept, city, brief });
await writeFile(new URL(`${slug}-baseline.json`, dir), JSON.stringify({ concept, city, brief, recordedAt: new Date().toISOString(), result }));
console.log('neighborhood:', result.neighborhood);
console.log('playlist:', result.playlist.map(p => `${p.name}${p.inQloo ? ' ✓' : ''}`).join(', '));
console.log('partners:', result.partners.map(p => `${p.name}${p.inQloo ? ' ✓' : ''}`).join(', '));
console.log('score:', `${result.score.matched}/${result.score.total}`);
