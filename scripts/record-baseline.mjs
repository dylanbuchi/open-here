// Records the plain-AI comparison for the bundled example, so the first
// page load can show it without a paid call.
// node --env-file=.env scripts/record-baseline.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { runBaseline } from '../lib/baseline.mjs';

const dir = new URL('../public/examples/', import.meta.url);
const example = JSON.parse(await readFile(new URL('austin-italian.json', dir), 'utf8'));
const { concept, city, brief } = example;
const result = await runBaseline({ concept, city, brief });
await writeFile(new URL('austin-italian-baseline.json', dir), JSON.stringify({ concept, city, brief, recordedAt: new Date().toISOString(), result }));
console.log('neighborhood:', result.neighborhood);
console.log('playlist:', result.playlist.map(p => `${p.name}${p.inQloo ? ' ✓' : ''}`).join(', '));
console.log('partners:', result.partners.map(p => `${p.name}${p.inQloo ? ' ✓' : ''}`).join(', '));
console.log('score:', `${result.score.matched}/${result.score.total}`);
