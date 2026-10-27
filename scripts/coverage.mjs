// Which concepts resolve to enough competitors in which cities? Free Qloo
// calls only (tag search + place lookups), no LLM.
// node --env-file=.env scripts/coverage.mjs
import { createQloo } from '../lib/qloo.mjs';
import { rankTags } from '../lib/analyze.mjs';

const qloo = createQloo();
const concepts = (process.env.CONCEPTS || 'Italian restaurant,Coffee shop,Bakery,Bar,Cocktail bar,Wine bar,Brewery,Pizza,Sushi,Ramen,Taqueria,Burger,Vegan restaurant,Ice cream,Bookstore,Gym,Yoga studio,Barbershop,Tobacco shop,Brunch,Thai restaurant,Indian restaurant,French restaurant,Juice bar,Record store').split(',');
const cities = (process.env.CITIES || 'Austin,New York City,Los Angeles,Chicago,London,Paris,Zurich,Geneva,Geneve,Berlin').split(',');

async function count(concept, city) {
  const tags = rankTags(await qloo.searchTags(concept, 10), concept).slice(0, 5);
  for (const tag of tags) {
    const r = await qloo.insights({ 'filter.type': 'urn:entity:place', 'filter.location.query': city, 'filter.tags': tag.id, take: 50 });
    const n = (r.entities || []).length;
    if (n >= 3) return n;
  }
  return 0;
}

console.log(['concept', ...cities].join('\t'));
for (const c of concepts) {
  const row = [];
  for (const city of cities) row.push(await count(c, city).catch(() => 'err'));
  console.log([c, ...row].join('\t'));
}
