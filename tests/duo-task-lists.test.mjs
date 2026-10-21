import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';

const registry = createRuleRegistry();
const task = (id, extra = {}) => ({ id, label: id, category: 'Mining', status: 'available', ...extra });
const state = () => {
  const value = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  value.revision = 7;
  for (const member of value.members) member.taskStatus = {};
  return value;
};
const result = (memberId, tasks, extra = {}) => ({ memberId, stateRevision: 7, tasks, presentation: { tasks: [] }, ...extra });
const select = (snapshot, results, extra = {}) => selectDuoTaskLists({ state: snapshot, results, registry, selectedMemberId: 'actor1', ...extra });
const ids = list => list.rows.map(row => row.id);

test('completed and backlog disclosures include full personal catalogues and apply All, personal and Both filters', () => {
  const s = state(), shared = task('shared', { status: 'blocked' }), own = task('own'), partner = task('partner');
  s.members[0].taskStatus = { shared: { backlogged: true, challengeCompleted: true }, own: { challengeCompleted: true, backlogged: true } };
  s.members[1].taskStatus = { shared: { backlogged: true }, partner: { challengeCompleted: true, backlogged: true } };
  const results = new Map([['actor1', result('actor1', [shared, own])], ['reed', result('reed', [shared, partner])]]);
  const before = structuredClone({ s, results });
  for (const list of ['completed', 'backlog']) {
    const all = select(s, results)[list];
    assert.deepEqual(new Set(ids(all)), new Set(['own', 'partner', 'shared']));
    assert.equal(all.total, 3);
    assert.deepEqual(ids(select(s, results, { ownerFilter: 'both' })[list]), ['shared']);
    assert.deepEqual(new Set(ids(select(s, results, { ownerFilter: 'reed' })[list])), new Set(['partner', 'shared']));
    const both = all.rows.find(row => row.id === 'shared');
    assert.deepEqual(both.memberIds, ['actor1', 'reed']); assert.equal(both.label, 'Both');
    assert.strictEqual(both.task, shared); assert.equal(both.stateRevision, 7);
    assert.deepEqual(both.factsByMember.reed.completedBy, ['actor1']);
  }
  assert.deepEqual(ids(select(s, results, { filter: ' PARTNER ' }).completed), ['partner']);
  assert.equal(select(s, results, { filter: 'missing' }).backlog.total, 3, 'backlog has its own search');
  assert.deepEqual({ s, results }, before);
});

test('completion policies preserve personal attribution and require all owners when configured', () => {
  const s = state(), shared = task('shared');
  s.members[1].completedTasks = ['shared'];
  const results = [result('actor1', [shared]), result('reed', [shared])];
  for (const [mode, expected] of [['any', ['actor1', 'reed']], ['personal', ['reed']], ['all', []]]) {
    s.rules['tasks.completion'] = mode;
    const rows = select(s, results).completed.rows;
    assert.deepEqual(rows[0]?.memberIds ?? [], expected, mode);
    if (rows.length) { assert.deepEqual(rows[0].facts.completedBy, ['reed']); assert.equal(rows[0].factsByMember.reed.actual, true); }
  }
  s.members[0].taskStatus.shared = { challengeCompleted: true };
  assert.deepEqual(select(s, results).completed.rows[0].memberIds, ['actor1', 'reed']);
});

test('saved custom assignments override derived rows and stale deleted custom rows are absent', () => {
  const s = state(), assigned = task('custom:assigned', { memberIds: ['reed'], label: 'Saved assignment' });
  s.tasks = [assigned]; s.rules['tasks.completion'] = 'all';
  for (const owner of s.members) owner.taskStatus = { 'custom:assigned': { challengeCompleted: true, backlogged: true }, 'custom:deleted': { backlogged: true } };
  const results = s.members.map(owner => result(owner.id, [task('custom:assigned'), task('custom:deleted')]));
  for (const list of ['completed', 'backlog']) {
    const rows = select(s, results)[list].rows;
    assert.deepEqual(rows.map(row => row.id), ['custom:assigned']);
    assert.deepEqual(rows[0].memberIds, ['reed']); assert.equal(rows[0].task.label, 'Saved assignment');
    assert.deepEqual(rows[0].facts.requiredBy, ['reed']);
  }
});

test('canonical aliases merge saved statuses without copying partner facts and completion families remain valid', () => {
  const s = state(), canonical = 'rs3:task:ore';
  s.identityRegistry = { entries: { [canonical]: { category: 'Mining' } }, aliases: { old: canonical } };
  s.members[1].taskStatus.old = { challengeCompleted: true, backlogged: true, backlogReason: 'Reed reason' };
  s.members[0].taskStatus[canonical] = { backlogged: true, backlogReason: 'Player reason' };
  const view = select(s, [result('actor1', [task(canonical)]), result('reed', [task('old')])]);
  assert.deepEqual(ids(view.completed), [canonical]); assert.deepEqual(ids(view.backlog), [canonical]);
  assert.equal(view.completed.rows[0].factsByMember.actor1.personal, false);
  assert.equal(view.completed.rows[0].factsByMember.reed.personal, true);
  assert.equal(view.backlog.rows[0].statusByMember.reed.backlogReason, 'Reed reason');
  const family = task('drop:new', { completionGroup: 'drop' });
  s.tasks = [task('drop:old')]; s.members[1].completedTasks = ['drop:old'];
  const collectionPlanning = { completionGroups: { drop: ['drop:new', 'drop:old'] } };
  const families = select(s, s.members.map(owner => result(owner.id, [family], { collectionPlanning })));
  assert.ok(ids(families.completed).includes('drop:new'));
  assert.deepEqual(families.completed.rows.find(row => row.id === 'drop:new').facts.completedBy, ['reed']);
});

test('only current matching member results enter disclosures; hidden and resource rows stay excluded', () => {
  const s = state(), rows = [task('ok'), task('hidden', { hidden: true }), task('resource', { obligation: false })];
  for (const owner of s.members) owner.taskStatus = Object.fromEntries(rows.map(row => [row.id, { backlogged: true, challengeCompleted: true }]));
  const values = [result('actor1', rows), result('reed', rows, { stateRevision: 6 })];
  assert.deepEqual(ids(select(s, values).backlog), ['ok']);
  assert.deepEqual(select(s, values).backlog.rows[0].memberIds, ['actor1']);
  assert.equal(select(s, new Map([['actor1', result('reed', rows)]])).backlog.total, 0);
  s.tasks = [task('preserved')]; s.members[0].taskStatus.preserved = { backlogged: true };
  assert.ok(ids(select(s, values).backlog).includes('preserved'));
});
