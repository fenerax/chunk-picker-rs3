import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoolRanking, summarizePoolPrediction } from '../app/tasks/pool-ranking.mjs';

const prediction = (tasksAdded = []) => ({ delta: { tasksAdded, itemsAdded: [{ name: 'Iron ore' }],
  shopsAdded: ['Ore shop'], objectsAdded: ['Oak tree', 'Varrock lodestone'] } });
test('pool summaries count exactly new available tasks and keep named skill and opening examples', () => {
  const row = summarizePoolPrediction('12342', prediction([{ label: '<b>Mine iron</b>', category: 'Mining' },
    { label: 'Mine silver', category: 'Mining' }, { label: 'A new quest', category: 'Quest' },
    { label: 'Teleport to Varrock', category: 'Magic' }]));
  assert.equal(row.count, 4); assert.equal(row.status, 'checked');
  assert.deepEqual(row.bySkill.Mining, { count: 2, examples: ['Mine iron', 'Mine silver'] });
  assert.equal(row.examples.length, 3); assert.deepEqual(row.notable.quests, ['A new quest']);
  assert.deepEqual(row.notable.resources, ['Iron ore', 'Oak tree']);
  assert.deepEqual(row.notable.shops, ['Ore shop']);
  assert.deepEqual(row.notable.teleports, ['Varrock lodestone', 'Teleport to Varrock']);
  assert.equal(summarizePoolPrediction('12342', { cancelled: true, delta: { tasksAdded: [] } }), undefined);
  assert.equal(summarizePoolPrediction('12342', { delta: {} }), undefined);
});
test('all pool rows appear, saved zero is checked, missing rows stay unknown and sorted last', () => {
  const cache = createPoolRanking(); cache.sync('input');
  const ids = Array.from({ length: 300 }, (_, index) => String(10000 + index));
  cache.remember('input', 'reed', ids[0], prediction());
  cache.remember('input', 'reed', ids[299], prediction([{ label: 'Mine ore', category: 'Mining' }]));
  const value = cache.read('input', 'reed', 4, ids);
  assert.equal(value.total, 300); assert.equal(value.rows.length, 300); assert.equal(value.checked, 2);
  assert.equal(value.rows[0].id, ids[299]); assert.equal(value.rows[1].count, 0);
  assert.equal(value.rows[2].status, 'estimated'); assert.equal(value.rows[2].count, null);
  assert.equal(cache.read('input', 'actor1', 4, ids).checked, 0);
});
test('saved predictions are read once without recalculating, and summaries survive worker cache sleep', () => {
  const cache = createPoolRanking(); let reads = 0;
  assert.equal(cache.read('input', 'reed', 1, ['12342'], () => { reads++; return prediction(); }).checked, 1);
  assert.equal(cache.read('input', 'reed', 2, ['12342'], () => { throw new Error('Should not read worker cache again'); }).checked, 1);
  assert.equal(reads, 1);
  assert.equal(cache.remember('old', 'reed', '12343', prediction()), false);
  assert.equal(cache.read('new', 'reed', 3, ['12342']), undefined);
  cache.sync('new');
  assert.equal(cache.read('new', 'reed', 3, ['12342']).checked, 0);
});
test('interest expires, multiple tabs stay independent, heartbeat does not count as new use', () => {
  let time = 0; const cache = createPoolRanking({ now: () => time, leaseMs: 30 });
  assert.equal(cache.interest('input', 'tab1', 'reed', true), true);
  assert.equal(cache.interest('input', 'tab1', 'reed', true), false);
  cache.interest('input', 'tab2', 'reed', true); cache.interest('input', 'tab1', 'reed', false);
  assert.deepEqual([...cache.interestedMembers()], ['reed']);
  time = 30; assert.equal(cache.interestedMembers().size, 0);
  cache.interest('input', 'tab1', 'reed', true); cache.sync('changed');
  assert.equal(cache.interestedMembers().size, 0);
});
test('compact cache obeys count and byte budgets without holding prediction graphs', () => {
  const cache = createPoolRanking({ limit: 2, byteLimit: 2000 }); cache.sync('input');
  for (const id of ['1', '2', '3']) cache.remember('input', 'reed', id, prediction());
  assert.equal(cache.diagnostics().entries, 2); assert.ok(cache.diagnostics().bytes <= 2000);
  assert.deepEqual(cache.missing('reed', ['1', '2', '3']), ['1']);
  const tiny = createPoolRanking({ byteLimit: 1 }); tiny.sync('input');
  assert.equal(tiny.remember('input', 'reed', '1', prediction()), false);
});
test('a complete pool larger than queue and summary budgets retains every count without repeating work', () => {
  const cache = createPoolRanking({ limit: 2, byteLimit: 600 });
  const ids = Array.from({ length: 600 }, (_, index) => String(10000 + index));
  cache.read('input', 'reed', 0, ids);
  for (const id of ids) cache.remember('input', 'reed', id, prediction([{ label: 'Mine iron', category: 'Mining' }]));
  const value = cache.read('input', 'reed', 0, ids, () => { throw new Error('Checked counts must not read or recompute predictions'); });
  assert.equal(value.checked, 600); assert.ok(value.rows.every(row => row.count === 1 && row.bySkill.Mining.count === 1));
  assert.deepEqual(cache.missing('reed', ids), []); assert.ok(cache.diagnostics().bytes <= 600);
  assert.equal(cache.diagnostics().countedRows, 600);
});

test('pool summaries keep a space where task names had line breaks', () => {
  const row = summarizePoolPrediction('1', { delta: { tasksAdded: [{ category: 'Quest', label: 'One Piercing Note<br>Complete the quest' }] } });
  assert.deepEqual(row.examples, ['One Piercing Note Complete the quest']);
});

test('an old captured reader cannot clear a newer owner or prune its complete counts', () => {
  const cache = createPoolRanking({ byteLimit: 1 });
  cache.sync('B'); cache.read('B', 'reed', 2, ['1', '2']);
  cache.remember('B', 'reed', '1', prediction());
  cache.remember('B', 'reed', '2', prediction([{ category: 'Mining', label: 'Option' }]));
  const before = cache.diagnostics();
  assert.equal(cache.read('A', 'reed', 1, ['1']), undefined);
  assert.deepEqual(cache.diagnostics(), before);
  assert.equal(cache.read('B', 'reed', 2, ['1', '2']).checked, 2);
});
