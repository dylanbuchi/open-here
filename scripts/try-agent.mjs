// Live agent run: node --env-file=.env scripts/try-agent.mjs "Italian restaurant" Austin "cozy date night spot"
import { runAgent } from '../lib/agent.mjs';
import { budgetStatus } from '../lib/llm.mjs';

const [concept = 'Italian restaurant', city = 'Austin', brief = ''] = process.argv.slice(2);
const t = Date.now();
const lap = () => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const pb = await runAgent({ concept, city, brief }, e => {
  if (e.type === 'step') console.log(`[${lap()}] ${e.label}`);
  if (e.type === 'market') console.log(`[${lap()}] market: ${e.data.zones.length} zones`);
});
console.log(`\n[${lap()}] PLAYBOOK`, JSON.stringify(pb, null, 1));
console.log('spent today (est.)', budgetStatus().spentUsd.toFixed(5));
