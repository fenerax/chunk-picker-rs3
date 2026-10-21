import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIdentityRegistry, projectPlayState, projectPlayResult, projectPlayTask } from '../app/play-view.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { resolveIdentity, authoredIdentityRegistry } from '../app/tasks/identity.mjs';
import { resolvePersistedIdentity } from '../app/tasks/fact-projection.mjs';

test('compact visible task levels retain cross-skill goals without copying full records', () => {
  const task = { id: 'quest:gate', category: 'Quest', label: 'A quest', status: 'available', level: 1, record: { Skills: { Mining: 30 }, Requirements: { Mining: 20, Smithing: 15, Quest: 'Finished quest' } } };
  const projected = projectPlayTask(task);
  assert.deepEqual(projected.skillRequirements, { Mining: 30, Smithing: 15 });
  assert.equal(Object.hasOwn(projected, 'record'), false);
  assert.equal(Object.hasOwn(projectPlayTask({ ...task, hidden: true }), 'skillRequirements'), false);
});

test('display identities retain static and saved ambiguity and historical categories', () => {
  const registry = authoredIdentityRegistry();
  const [id, entry] = Object.entries(registry.entries).find(([, value]) => value.category && value.aliases.length);
  const alias = entry.aliases[0], other = 'rs3:task:display-other';
  const state = createGroupState([{ id: 'one', name: 'One' }]);
  state.tasks = [{ id, category: entry.category, label: 'Known' }];
  state.members[0].completedTasks = [alias];
  state.identityRegistry = { schemaVersion: 1, entries: { [other]: { id: other, category: entry.category, aliases: ['rs3:Historical:old'] } }, aliases: { [alias]: other }, unresolved: [] };
  state.members[0].taskAlternatives = { Historical: { old: alias } };
  const overlay = projectIdentityRegistry(state);
  for (const category of [undefined, entry.category, 'Historical']) assert.deepEqual(resolvePersistedIdentity(alias, overlay, category), resolveIdentity(alias, state.identityRegistry, category));
  assert.deepEqual(resolvePersistedIdentity(id, overlay), resolveIdentity(id, state.identityRegistry));
  assert.deepEqual(overlay.savedAliases[alias], [other]);
});
test('play state excludes archives while leaving gameplay and raw imports unchanged', () => {
  const state = createGroupState([{ id: 'one', name: 'One' }]);
  state.legacy = { maps: { example: { settings: { recent: true }, chunkOrder: { '1': '12341' }, unexplained: { original: true } } } };
  state.provenance = { restore: { previousHistory: ['archive'] } };
  state.progressSnapshots = { schemaVersion: 1, memberIds: ['one'], days: [], truncated: false };
  const before = structuredClone(state), view = projectPlayState(state);
  assert.equal(view.provenance, undefined);
  assert.equal(view.progressSnapshots, undefined);
  for (const key of ['members', 'tasks', 'rules', 'legacy', 'history']) assert.deepEqual(view[key], state[key]);
  assert.deepEqual(state, before);
});
test('play result retains render and completion evidence, full details remain available', () => {
  const task = { id: 'fixture', label: 'Fixture', status: 'blocked', obligation: true, completionGroup: 'group', completionIds: ['a'],
    record: { item: 'large' }, sources: ['source'], explanation: 'detail', hiddenReasons: ['detail'], blockers: [{ kind: 'level', detail: 'Need a level' }, { kind: 'item' }] };
  const full = { tasks: [task, { ...task, id: 'hidden', status: 'available', hidden: true, obligation: false }],
    presentation: { tasks: [task], alternatives: { group: ['fixture'] } }, currentBiS: {}, activityInfo: {}, items: ['heavy'], equipmentPlanning: {},
    collectionPlanning: { completionGroups: { group: ['a'] }, diagnostics: ['detail'] }, access: { bases: ['12341'] }, partnerConnections: { byChunk: {} }, metrics: { availableCount: 0 } };
  const compact = projectPlayResult(full);
  assert.equal(compact.format, 'play-v1'); assert.equal(compact.currentBiS, undefined); assert.equal(compact.activityInfo, undefined);
  assert.deepEqual(compact.presentation.tasks, [{ id: 'fixture' }]); assert.equal(compact.presentation.alternatives, undefined);
  assert.deepEqual(compact.tasks[0].blockers, [{ detail: task.blockers[0].detail }]); assert.deepEqual(compact.collectionPlanning, { completionGroups: full.collectionPlanning.completionGroups });
  const evidence = rows => rows.map(({ id, status, hidden, obligation, completionGroup, completionIds }) => ({ id, status, hidden, obligation, completionGroup, completionIds }));
  assert.deepEqual(evidence(compact.tasks), evidence(full.tasks));
  assert.equal(compact.tasks.filter(row => row.hidden).length, full.tasks.filter(row => row.hidden).length);
  assert.equal(compact.tasks.filter(row => row.status === 'blocked').length, full.tasks.filter(row => row.status === 'blocked').length);
  assert.equal(compact.items, undefined); assert.equal(compact.equipmentPlanning, undefined);
  assert.equal(compact.tasks[0].completionGroup, 'group'); assert.deepEqual(compact.tasks[0].completionIds, ['a']); assert.equal(compact.tasks[0].record, undefined);
  assert.equal(full.tasks[0].record.item, 'large');
});
test('sparse state retains both members facts, false and empty status, ambiguous candidates and custom rows in catalogue order', () => {
  const state = createGroupState([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]);
  const rows = ['unused', 'first', 'custom:manual', 'rs3:task:custom:manual', 'second', 'alternative', 'false', 'empty'].map(id => ({ id, label: id, category: 'Extra' }));
  state.tasks = rows;
  state.identityRegistry = { entries: Object.fromEntries(rows.map(row => [row.id, { ...row, aliases: [] }])), aliases: { ambiguous: ['first', 'second'], old: 'alternative' } };
  state.members[0].completedTasks = ['ambiguous']; state.members[0].taskStatus = { false: { challengeCompleted: false }, empty: {} };
  state.members[1].taskAlternatives = { Extra: { group: 'old', automatic: null } };
  const before = structuredClone(state), play = projectPlayState(state);
  assert.deepEqual(play.tasks, rows.slice(1)); assert.equal(play.identityRegistry.entries.unused, undefined);
  assert.deepEqual(resolvePersistedIdentity('ambiguous', play.identityRegistry), resolveIdentity('ambiguous', state.identityRegistry));
  assert.deepEqual(play.members, state.members); assert.deepEqual(state, before);
});
test('compact task whitelist retains empty completion evidence and hidden search fields; planning restores hidden display fields', () => {
  const row = { id: 'one', label: 'One', category: 'Quest', status: 'blocked', hidden: true, obligation: false,
    completionIds: [], completionGroup: 'family', aliases: ['old'], rawLabel: 'Raw', wiki: 'wiki', level: 40, primary: false,
    generated: true, equipmentName: 'Item', blockers: [{ kind: 'item', detail: 'Missing', private: true }],
    selected: true, sourceCount: 200, alternativeGroup: 'large', personalCompleted: false, record: { ClueTier: 1 } };
  assert.deepEqual(projectPlayTask(row), { id: 'one', label: 'One', category: 'Quest', status: 'blocked', hidden: true,
    obligation: false, aliases: ['old'], completionGroup: 'family', completionIds: [] });
  const planning = projectPlayTask(row, { retainHiddenDisplay: true });
  assert.equal(planning.rawLabel, 'Raw'); assert.equal(planning.primary, false); assert.equal(planning.generated, true);
  assert.deepEqual(planning.blockers, [{ detail: 'Missing' }]); assert.equal(planning.record, undefined); assert.equal(planning.selected, undefined);
});

test('play presentation recovers completed rows only when completion is their sole suppression', () => {
  const tasks = ['active', 'done', 'done-hidden', 'hidden', 'alternative'].map(id => ({ id, label: id, category: 'Extra', status: 'available' }));
  const result = { tasks, presentation: { tasks: [tasks[0]], suppressed: {
    done: ['Challenge already satisfied.'],
    'done-hidden': ['Challenge already satisfied.', 'Hidden by the engine display filters.'],
    hidden: ['Task metadata excludes it from the active view.'],
    alternative: ['An alternative at the current goal level.'],
  } } };
  const before = structuredClone(result), compact = projectPlayResult(result);
  assert.deepEqual(compact.presentation, { tasks: [{ id: 'active' }], completedTasks: [{ id: 'done' }] });
  assert.deepEqual(result, before);
});
