import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { canonicalActiveExpression, compareOriginalMap, compareCurrentBiS } from '../scripts/research/original-parity.mjs';

// Pure detached fixtures only: no saves, browser, ports, or network access.
test('BiS tie equivalence stays in its own slot and preserves two-handed peers', () => {
  const current={obtainable:{recommendations:[
    {style:'Melee',slot:'main hand weapon',equipment:'Main',alternatives:['Alternative main']},
    {style:'Melee',slot:'off-hand weapon',equipment:'Off-hand',alternatives:[]},
    {style:'Ranged',slot:'2h weapon',equipment:'Bow',alternatives:['Tied bow']},
  ],loadouts:[
    {style:'Melee',best:{mode:'dual-wield',mainHand:'Main',offHand:'Off-hand',alternatives:[{items:['Alternative main','Off-hand']}]}},
    {style:'Ranged',best:{mode:'two-handed',mainHand:'Bow',offHand:null}},
  ]}};
  const result=compareCurrentBiS({'Melee-main hand weapon':'Alternative main','Melee-off-hand':'Alternative main','Ranged-2h weapon':'Tied bow'},current);
  assert.deepEqual(result.rows.map(row=>row.status),['equivalent-tie','different','equivalent-tie']);
});
const originalRow = (category, rawLabel, value = true, metadata = null) => ({ category, rawLabel, value, metadata });
const task = (id, extra = {}) => ({ id, category: 'Mining', status: 'available', requiredLevel: null,
  effectiveLevel: null, obligation: true, ...extra });
const original = (extra = {}) => ({ active: [], possible: [], completed: [], checked: [], fullListChecked: [], backlog: [],
  chunks: { unlocked: {}, selected: {} }, highestOverall: { melee: 'Original item' }, ...extra });
const local = (extra = {}) => ({ tasks: [], activeTasks: [], eligibleTasks: [], otherAccessibleTasks: [], savedStatuses: {},
  chunks: { saved: { unlocked: [], selected: [] } }, currentBiS: { melee: 'Authored item' }, ...extra });
function lookup(entries) {
  return { resolveOriginal(row) { return entries[`${row.category}:${row.rawLabel}`] ?? { status: 'unmapped', candidates: [] }; } };
}
const resolved = id => ({ status: 'resolved', id, candidates: [id] });

test('canonical active rows recover full Every Drop identities and favorites from builder evidence', () => {
  const fish = 'Obtain ~|Fish|~ from a creature', ore = 'Obtain ~|Ore|~ from a rock', fishing = 'Catch ~|Fish|~';
  const context = {
    activeTasks: { Extra: { Fish: 'Every Drop' }, Favorite: { Extra: { Ore: 'Every Drop' }, Fishing: { [fishing]: '10{2}' } } },
    window: { __parityComputedList: [{ [fish]: 'Extra', prefix: '[Every Drop]' }, { [ore]: 'Extra', prefix: '[Every Drop]' },
      { [fishing]: 'Fishing', prefix: '[8] (+2) Fishing:' }] },
    chunkInfo: { challenges: { Extra: { [fish]: { Label: 'Every Drop' }, [ore]: { Label: 'Every Drop' } }, Fishing: { [fishing]: { Level: 10 } } } },
  };
  const before = structuredClone(context);
  const rows = JSON.parse(JSON.stringify(vm.runInNewContext(canonicalActiveExpression, context)));
  assert.deepEqual(rows.map(({ category, rawLabel, favorite, value }) => ({ category, rawLabel, favorite, value })), [
    { category: 'Extra', rawLabel: fish, favorite: false, value: 'Every Drop' },
    { category: 'Extra', rawLabel: ore, favorite: true, value: 'Every Drop' },
    { category: 'Fishing', rawLabel: fishing, favorite: true, value: '10{2}' },
  ]);
  assert.equal(rows[0].metadata.Label, 'Every Drop');
  assert.equal(rows[2].metadata.Level, 10);
  assert.equal(rows[2].prefix, '[8] (+2) Fishing:');
  assert.deepEqual(context, before);
});

test('comparison retains exact-category misses and ambiguity candidates without guessing', () => {
  const identity = lookup({ 'Mining:Same label': resolved('mining'),
    'Smithing:Same label': resolved('smithing'),
    'Mining:Ambiguous': { status: 'ambiguous', candidates: ['candidate-a', 'candidate-b'] } });
  const authored = task('mining');
  const input = original({ active: [originalRow('Mining', 'Same label'), originalRow('Smithing', 'Same label'),
    originalRow('mining', 'Same label'), originalRow('Mining', 'Ambiguous')] });
  const own = local({ tasks: [authored], activeTasks: [authored] });
  const before = structuredClone({ input, own });
  const result = compareOriginalMap(input, own, identity);
  assert.deepEqual(result.active.common.map(row => row.id), ['mining']);
  assert.deepEqual(result.active.originalOnly.map(row => row.rawLabel), ['Same label', 'Same label', 'Ambiguous']);
  const ambiguous = result.active.unmapped.find(row => row.rawLabel === 'Ambiguous');
  assert.deepEqual(ambiguous.candidates, ['candidate-a', 'candidate-b']);
  assert.equal(ambiguous.local, null);
  assert.equal(result.active.unmapped.length, 2);
  assert.deepEqual({ input, own }, before);
});

test('duplicate aliases collapse canonical counts while distinct tasks remain distinct', () => {
  const identity = lookup({ 'Mining:Historical alias': resolved('first'), 'Mining:Current label': resolved('first'),
    'Smithing:Current label': resolved('second') });
  const first = task('first'), second = task('second', { category: 'Smithing' });
  const result = compareOriginalMap(original({ active: [originalRow('Mining', 'Historical alias'),
    originalRow('Mining', 'Current label'), originalRow('Smithing', 'Current label')] }),
  local({ tasks: [first, second], activeTasks: [first, second] }), identity);
  assert.equal(result.active.originalCount, 3);
  assert.equal(result.active.originalUnique, 2);
  assert.equal(result.active.common.length, 2);
  assert.deepEqual(result.active.originalOnly, []);
  assert.deepEqual(result.active.localOnly, []);
});

test('active goals and possible rows are compared independently of partner convenience rows', () => {
  const first = task('first'), second = task('second'), third = task('third'), partner = task('partner', { obligation: false });
  const identity = lookup({ 'Mining:First': resolved('first'), 'Mining:Second': resolved('second'), 'Mining:Partner': resolved('partner') });
  const result = compareOriginalMap(original({ active: [originalRow('Mining', 'First')],
    possible: [originalRow('Mining', 'First'), originalRow('Mining', 'Second'), originalRow('Mining', 'Partner')] }),
  local({ tasks: [first, second, third], activeTasks: [first], eligibleTasks: [first, second, third], otherAccessibleTasks: [partner] }), identity);
  assert.deepEqual(result.active.common.map(row => row.id), ['first']);
  assert.deepEqual(result.active.localOnly, []);
  assert.deepEqual(result.possible.common.map(row => row.id), ['first', 'second']);
  assert.deepEqual(result.possible.localOnly.map(row => row.id), ['third']);
  assert.deepEqual(result.possible.originalOnly.map(row => row.id), ['partner']);
  assert.equal(result.possible.originalOnly[0].local.obligation, false);
});

test('status and level drift distinguish required from effective boosted levels', () => {
  const definitions = [
    { name: 'Same boosted', id: 'same', required: 10, effective: 8, metadata: 10, value: 10 },
    { name: 'Required drift', id: 'required', required: 11, effective: 8, metadata: 10, value: 10 },
    { name: 'Effective drift', id: 'effective', required: 10, effective: 9, metadata: 10, value: 10 },
    { name: 'Blocked', id: 'blocked', required: 10, effective: 8, metadata: 10, value: 10, status: 'blocked' },
    { name: 'Unknown local level', id: 'unknown', required: null, effective: null, metadata: 10, value: 10 },
    { name: 'Boost floor', id: 'floor', required: 1, effective: 1, metadata: 1, value: 1, boost: 5 },
  ];
  const tasks = definitions.map(row => task(row.id, { requiredLevel: row.required, effectiveLevel: row.effective, status: row.status ?? 'available' }));
  const identity = lookup(Object.fromEntries(definitions.map(row => [`Mining:${row.name}`, resolved(row.id)])));
  const result = compareOriginalMap(original({ possible: definitions.map(row => originalRow('Mining', row.name, row.value, { Level: row.metadata })),
    boosts: { Mining: Object.fromEntries(definitions.map(row => [row.name, row.boost ?? 2])) } }),
    local({ tasks, eligibleTasks: tasks.filter(row => row.status === 'available') }), identity);
  assert.deepEqual(result.statusDifferences.map(row => row.id), ['required', 'effective', 'blocked']);
});

test('unlocked membership, selected membership, and selected ordinal order remain separate', () => {
  const input = original({ chunks: { unlocked: { 101: true, 102: true }, selected: { 201: 2, 202: 1 } } });
  const own = local({ chunks: { saved: { unlocked: ['102', '103'], selected: ['201', '202'] } } });
  const result = compareOriginalMap(input, own, lookup({}));
  assert.deepEqual(result.chunks.unlocked, { original: 2, local: 2, originalOnly: ['101'], localOnly: ['103'] });
  assert.deepEqual(result.chunks.selected, { original: 2, local: 2, originalOnly: [], localOnly: [] });
  assert.equal(result.chunks.selectedOrderMatches, false);
  own.chunks.saved.selected = ['202', '201'];
  assert.equal(compareOriginalMap(input, own, lookup({})).chunks.selectedOrderMatches, true);
  assert.deepEqual(input.chunks.selected, { 201: 2, 202: 1 });
  assert.deepEqual(result.originalCurrentBiS, input.highestOverall);
  assert.deepEqual(result.localCurrentBiS, own.currentBiS);
});

test('saved progress matches unavailable or archived tasks and preserves distinct original check sets', () => {
  const identity = lookup({ 'Quest:Completed': resolved('completed'), 'Mining:Checked': resolved('checked'),
    'Mining:All checked': resolved('all'), 'Mining:Deferred': resolved('deferred'), 'Quest:Personal only': resolved('personal') });
  const personal = task('personal', { status: 'completed', personalCompleted: true, challengeSatisfied: true });
  const input = original({
    completed: [originalRow('Quest', 'Completed'), originalRow('Quest', 'Personal only'), originalRow('Quest', 'False check', false)],
    checked: [originalRow('Mining', 'Checked'), originalRow('Mining', 'False check', 0)],
    fullListChecked: [originalRow('Mining', 'All checked')],
    backlog: [originalRow('Mining', 'Deferred', 'source reason')],
  });
  const own = local({ tasks: [personal], savedStatuses: {
    completed: { challengeCompleted: true }, checked: { challengeCompleted: true },
    all: { challengeCompleted: true }, deferred: { backlogged: true },
  } });
  const result = compareOriginalMap(input, own, identity);
  assert.equal(result.progress.completed.original, 2);
  assert.equal(result.progress.completed.mapped, 2);
  assert.equal(result.progress.completed.matched, 1);
  assert.deepEqual(result.progress.completed.missing.map(row => row.id), ['personal']);
  assert.equal(result.progress.checked.original, 1);
  assert.equal(result.progress.checked.matched, 1);
  assert.equal(result.progress.fullListChecked.original, 1);
  assert.equal(result.progress.fullListChecked.matched, 1);
  assert.equal(result.progress.backlog.matched, 1);
});

test('unresolved positive progress retains candidates and false check entries do not manufacture completion', () => {
  const identity = lookup({ 'Quest:Collision': { status: 'ambiguous', candidates: ['quest-a', 'quest-b'] } });
  const result = compareOriginalMap(original({ checked: [originalRow('Quest', 'Collision'), originalRow('Quest', 'Unchecked', false)] }),
    local({ savedStatuses: { 'quest-a': { challengeCompleted: true }, 'quest-b': { challengeCompleted: true } } }), identity);
  assert.equal(result.progress.checked.original, 1);
  assert.equal(result.progress.checked.mapped, 0);
  assert.equal(result.progress.checked.matched, 0);
  assert.deepEqual(result.progress.checked.missing[0].candidates, ['quest-a', 'quest-b']);
});
