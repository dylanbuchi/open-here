// Records one live agent run as a replayable example for the first page load,
// so visitors see a full result instantly without a paid call.
// node --env-file=.env scripts/record-example.mjs austin-italian "Italian restaurant" Austin "cozy date-night spot for young couples"
import { writeFile, mkdir } from 'node:fs/promises';
import { runAgent } from '../lib/agent.mjs';

const [slug = 'austin-italian', concept = 'Italian restaurant', city = 'Austin', brief = 'cozy date-night spot for young couples'] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug must be lowercase letters, digits and dashes');
const t0 = Date.now();
const events = [];
await runAgent({ concept, city, brief }, e => events.push({ ms: Date.now() - t0, ...e }));
events.push({ ms: Date.now() - t0, type: 'done' });

const out = new URL('../public/examples/', import.meta.url);
await mkdir(out, { recursive: true });
const file = new URL(`${slug}.json`, out);
await writeFile(file, JSON.stringify({ concept, city, brief, recordedAt: new Date().toISOString(), events }));
const pb = events.find(e => e.type === 'playbook')?.data;
console.log(`recorded ${events.length} events in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('steps:', events.filter(e => e.type === 'step').map(e => e.label).join(' | '));
console.log('headline:', pb?.headline);
console.log('best zone:', pb?.bestZone?.rank, pb?.bestZone?.near);
console.log('verified playlist:', pb?.playlist.map(p => `${p.name}${p.fromQloo ? '' : ' (AI)'}`).join(', '));
console.log('verified partners:', pb?.partners.map(p => `${p.name}${p.fromQloo ? '' : ' (AI)'}`).join(', '));
