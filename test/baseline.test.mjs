import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBaseline, crossCheck } from '../lib/baseline.mjs';

test('parseBaseline reads JSON even when wrapped in a code fence', () => {
  const b = parseBaseline('```json\n{"neighborhood":"Little Italy","why_here":"w","target_customer":"t","playlist":["Dean Martin",3,""],"partners":["San Pellegrino"]}\n```');
  assert.equal(b.neighborhood, 'Little Italy');
  assert.deepEqual(b.playlist, ['Dean Martin']);
});

test('parseBaseline returns null for prose', () => {
  assert.equal(parseBaseline('Sure! Open near downtown.'), null);
});

test('crossCheck marks picks found in Qloo results, case-insensitively', () => {
  const market = { audience: { artists: ['Randy Rogers Band'], brands: ['Central Market'] } };
  const r = crossCheck({ neighborhood: 'n', whyHere: '', targetCustomer: '', playlist: ['Dean Martin', 'randy rogers band'], partners: ['San Pellegrino'] }, market);
  assert.deepEqual(r.playlist.map(p => p.inQloo), [false, true]);
  assert.deepEqual(r.score, { matched: 1, total: 3 });
});
