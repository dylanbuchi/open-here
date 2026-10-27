// Live smoke run: node --env-file=.env scripts/try.mjs "Italian restaurant" Austin
import { analyze } from '../lib/analyze.mjs';

const [concept = 'Italian restaurant', city = 'Austin'] = process.argv.slice(2);
const t = Date.now();
const r = await analyze({ concept, city });
console.log(`${r.concept} in ${r.city} via ${r.tag.id} (${Date.now() - t} ms)`);
console.log(`place: ${r.place} | competitors ${r.competitors.length}: ${r.competitors.slice(0, 6).map(c => c.name).join(', ')}`);
for (const z of r.zones) console.log(`#${z.rank} ${z.neighborhood || '?'} · near ${z.landmark?.name} | lift +${Math.round(z.lift * 100)} pop ${z.popularity.toFixed(2)} comp1km ${z.competitorsWithin1km}`);
console.log('age', JSON.stringify(r.audience.demographics.age));
console.log('artists', r.audience.artists.join(', '));
console.log('movies', r.audience.movies.join(', '));
console.log('brands', r.audience.brands.join(', '));
