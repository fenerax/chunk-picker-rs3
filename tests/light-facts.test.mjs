import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, legacyTaskId, permanentTaskId } from '../app/tasks/identity.mjs';
import { projectIdentityRegistry, projectPlayState } from '../app/play-view.mjs';
import { projectMemberTaskFacts as fullProjection } from '../app/tasks/migration.mjs';
import { projectMemberTaskFacts, resolvePersistedIdentity } from '../app/tasks/fact-projection.mjs';
import { createTaskFactsIndex as fullIndex } from '../app/core/progress.mjs';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress-index.mjs';
import { decodeLegacyText, hasGameplayMigration } from '../app/tasks/gameplay-compat.mjs';

// Exercise the server overlay for every queried identity, including derived rows.
function materialize(state, ids) {
  return { ...state, identityRegistry: projectIdentityRegistry({ ...state, tasks: [...(state.tasks ?? []), ...ids.map(id => ({ id }))] }) };
}

test('materialized resolution preserves authored, custom, ambiguous, historical-category and unknown IDs', () => {
  const old = legacyTaskId('Quest', "~|Cook's Assistant|~ Complete the quest");
  const canonical = permanentTaskId('Quest', "~|Cook's Assistant|~ Complete the quest");
  const a = 'rs3:task:custom:a', b = 'rs3:task:custom:b';
  const state = { identityRegistry: { entries: {
    [a]: { id: a, category: 'Gathering', aliases: [legacyTaskId('Mining', 'Mine')] },
    [b]: { id: b, category: 'Smithing', aliases: [] },
  }, aliases: { [old]: a, custom: a, ambiguous: [a, b], dangling: 'rs3:task:missing' } } };
  const ids = [old, canonical, a, b, 'custom', 'ambiguous', 'dangling', 'unknown'];
  const light = materialize(state, ids);
  for (const id of ids) for (const category of [undefined, 'Quest', 'Gathering', 'Mining', 'Smithing']) {
    assert.deepEqual(resolvePersistedIdentity(id, light.identityRegistry, category), resolveIdentity(id, state.identityRegistry, category));
  }
  assert.equal(resolvePersistedIdentity('ambiguous', light.identityRegistry).status, 'ambiguous');
  assert.equal(resolvePersistedIdentity('ambiguous', light.identityRegistry, 'Mining').id, a);
});

test('light projection preserves aliases, unresolved facts, category renames and canonical false/Automatic precedence', () => {
  const id = 'rs3:task:custom:mine', old = legacyTaskId('Mining', 'Mine');
  const catalogue = [{ id, category: 'Gathering', aliases: [old] }];
  const state = { tasks: [{ id, label: 'Mine', category: 'Gathering' }, { id: 'unknown', label: 'Preserved unknown', category: 'Extra' }],
    identityRegistry: { entries: { [id]: { id, category: 'Gathering', aliases: [old] } }, aliases: { [old]: id } }, members: [{
    id: 'a', completedTasks: [old, id, 'unknown'],
    taskStatus: { [old]: { challengeCompleted: true, note: 'retained', favorite: true }, [id]: { challengeCompleted: false, note: '' }, unknown: { note: 'review' } },
    taskAlternatives: { Mining: { 1: old, 2: null }, Gathering: { 1: null } },
  }] };
  const before = structuredClone(state), light = projectPlayState(state);
  const projected = projectMemberTaskFacts(light, light.members[0], catalogue);
  assert.deepEqual(projected, fullProjection(state, state.members[0], catalogue));
  assert.deepEqual(projected.completedTasks, [id, 'unknown']);
  assert.deepEqual(projected.taskAlternatives, { Gathering: { 1: null, 2: null } });
  assert.equal(projected.taskStatus[id].challengeCompleted, false);
  assert.equal(projected.taskStatus[id].note, '');
  assert.equal(projected.taskStatus[id].favorite, true);
  assert.deepEqual(state, before);
});

test('catalogue projection does not mistake materialized authored aliases for persisted overrides', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", old = legacyTaskId('Quest', raw);
  const authored = permanentTaskId('Quest', raw), custom = 'rs3:task:custom:catalogue-override';
  const catalogue = [{ id: custom, category: 'Quest', aliases: [old] }];
  const state = { tasks: [{ id: custom, category: 'Quest', label: 'Explicit catalogue task' }],
    identityRegistry: { entries: { [custom]: { id: custom, category: 'Quest' } }, aliases: { [old]: authored } },
    members: [{ id: 'a', completedTasks: [old], taskStatus: { [old]: { challengeCompleted: true } } }] };
  const light = projectPlayState(state);
  assert.deepEqual(projectMemberTaskFacts(light, light.members[0], catalogue), fullProjection(state, state.members[0], catalogue));
  assert.deepEqual(projectMemberTaskFacts(light, light.members[0], catalogue).completedTasks, [custom]);
});

test('light and full progress agree for authored aliases, family evidence and every personal completion scope', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", old = legacyTaskId('Quest', raw), id = permanentTaskId('Quest', raw);
  const generated = { id: 'rs3:goal:test:new', completionGroup: 'family' };
  const unused = 'rs3:task:unreferenced';
  const state = { rules: {}, tasks: [{ id: old, category: 'Quest', label: 'Saved quest' }, { id: unused, category: 'Quest', label: 'Unused quest' }], members: [
    { id: 'a', completedTasks: [old], taskStatus: { [id]: { challengeCompleted: false } } },
    { id: 'b', completedTasks: [], taskStatus: { [old]: { challengeCompleted: true } } },
    { id: 'c', completedTasks: [], taskStatus: {} },
  ] };
  const options = { tasks: [generated], completionGroups: { family: [old, generated.id] } };
  for (const mode of ['any', 'all', 'personal']) for (const memberId of ['a', 'b', 'c']) {
    state.rules['tasks.completion'] = mode;
    const before = structuredClone(state), light = projectPlayState(state);
    assert.deepEqual(light.tasks.map(task => task.id), [old]);
    assert.equal(light.identityRegistry.entries[unused], undefined);
    const full = fullIndex(state, memberId, { resolve: rules => rules }, options);
    const browser = createTaskFactsIndex(light, memberId, { resolve: rules => rules }, options);
    for (const query of [old, id, generated.id]) assert.deepEqual(browser.get(query), full.get(query));
    assert.deepEqual(goalProgress([generated], browser), goalProgress([generated], full));
    assert.equal(browser.get(generated.id).actual, false);
    assert.equal(browser.get(generated.id).personal, false);
    assert.throws(() => browser.get('unrelated'), /Unknown task/);
    assert.throws(() => browser.get(unused), /Unknown task/);
    assert.deepEqual(state, before);
  }
});

test('before calculation, sparse state retains custom and every saved review row with exact labels and false fields', () => {
  const tasks = [
    { id: 'rs3:task:unused', label: 'Unreferenced catalogue row', category: 'Quest' },
    { id: 'custom:manual', label: 'Manual custom goal', category: 'Custom' },
    { id: 't_unresolved', label: 'Original unresolved spelling', category: 'Review' },
    { id: 'rs3:task:false', label: 'Explicit false override', category: 'Quest' },
    { id: 'rs3:task:partner', label: 'Partner completion', category: 'Quest' },
    { id: 'rs3:task:alternative', label: 'Saved alternative', category: 'Mining' },
  ];
  const state = { rules: {}, tasks, members: [
    { id: 'a', completedTasks: [], taskStatus: { t_unresolved: { note: 'review', backlogged: true }, 'rs3:task:false': { challengeCompleted: false, favorite: false, note: '' } },
      taskAlternatives: { Mining: { 1: 'rs3:task:alternative', 2: null } } },
    { id: 'b', completedTasks: ['rs3:task:partner'], taskStatus: {} },
  ] };
  const before = structuredClone(state), light = projectPlayState(state);
  assert.deepEqual(light.tasks, tasks.slice(1));
  assert.deepEqual(light.members, state.members);
  assert.equal(light.tasks.find(task => task.id === 't_unresolved').label, 'Original unresolved spelling');
  const full = fullIndex(state, 'a', { resolve: () => ({ 'tasks.completion': 'any' }) });
  const browser = createTaskFactsIndex(light, 'a', { resolve: () => ({ 'tasks.completion': 'any' }) });
  for (const task of light.tasks) assert.deepEqual(browser.get(task.id), full.get(task.id));
  assert.equal(browser.get('rs3:task:false').personal, false);
  assert.equal(browser.get('rs3:task:partner').group, true);
  assert.deepEqual(state, before);
});


test('projection resolves each repeated key per category and never reuses a result across changed snapshots', () => {
  const id = 'rs3:task:cache-a', other = 'rs3:task:cache-b', old = 'saved-old';
  const entries = { [id]: { id, category: 'Extra' }, [other]: { id: other, category: 'Extra' } };
  const state = { identityRegistry: { entries, aliases: { [old]: id } } };
  const member = { completedTasks: [old, id], taskStatus: { [old]: { note: 'alias', challengeCompleted: true }, [id]: { note: '', challengeCompleted: false } },
    taskAlternatives: { Extra: { 1: old }, Wrong: { 1: old } } };
  const calls = new Map(), resolve = (value, registry, category) => {
    const key = JSON.stringify([value, category]); calls.set(key, (calls.get(key) ?? 0) + 1);
    return resolveIdentity(value, registry, category);
  };
  const projected = projectMemberTaskFacts(state, member, [], { resolveIdentity: resolve });
  assert.deepEqual(projected, fullProjection(state, member));
  assert.ok([...calls.values()].every(count => count === 1));
  assert.equal(calls.get(JSON.stringify([old, undefined])), 1);
  assert.equal(calls.get(JSON.stringify([old, 'Extra'])), 1);
  assert.equal(calls.get(JSON.stringify([old, 'Wrong'])), 1);
  assert.equal(projected.taskStatus[id].challengeCompleted, false);
  assert.equal(projected.taskStatus[id].note, '');
  const changed = { identityRegistry: { entries, aliases: { [old]: other } } };
  const next = projectMemberTaskFacts(changed, member, [], { resolveIdentity: resolve });
  assert.deepEqual(next, fullProjection(changed, member));
  assert.deepEqual(next.completedTasks, [other, id]);
});

test('light gameplay compatibility retains encoded text and per-owner migration markers', () => {
  assert.equal(decodeLegacyText('Magic-_-2G-_-E2-_-80-_-8BRanged'), 'Magic/\u200bRanged');
  const member = { id: 'a', sourceMapId: 'map' };
  const state = { legacy: { gameplayMigration: { schemaVersion: 1 } } };
  assert.equal(hasGameplayMigration(state, member), true);
  assert.equal(hasGameplayMigration(state, member, 'sourceBacklogs'), false);
  state.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'map' }] };
  assert.equal(hasGameplayMigration(state, member, 'sourceBacklogs'), true);
  assert.equal(hasGameplayMigration(state, { ...member, id: 'b' }), false);
});

test('selective catalogue queries extend for later members and saves, including cached misses', () => {
  const a = 'rs3:task:custom:selective-a', b = 'rs3:task:custom:selective-b';
  const catalogue = Object.freeze([
    Object.freeze({ id: a, category: 'Extra', aliases: ['first-alias'] }),
    Object.freeze({ id: b, category: 'Extra', aliases: ['later-alias'] }),
  ]);
  const state = { identityRegistry: { entries: { [a]: { category: 'Extra' }, [b]: { category: 'Extra' } }, aliases: {} } };
  assert.deepEqual(fullProjection(state, { completedTasks: ['first-alias', 'registry-only'] }, catalogue).completedTasks, [a, 'registry-only']);
  assert.deepEqual(fullProjection(state, { completedTasks: ['later-alias'] }, catalogue).completedTasks, [b]);
  const changed = { identityRegistry: { ...state.identityRegistry, aliases: { 'registry-only': b } } };
  const member = { completedTasks: ['registry-only', 'later-alias'], taskStatus: { 'later-alias': { challengeCompleted: true }, [b]: { challengeCompleted: false, note: '' } } };
  const projected = fullProjection(changed, member, catalogue);
  assert.deepEqual(projected.completedTasks, [b]);
  assert.deepEqual(projected.taskStatus[b], { challengeCompleted: false, note: '' });
  const light = materialize(changed, member.completedTasks);
  assert.deepEqual(projectMemberTaskFacts(light, member, catalogue), projected);
});

test('permanent IDs remain exact catalogue aliases and retain competing candidates', () => {
  const queried = 'rs3:task:custom:permanent-alias', a = 'rs3:task:custom:target-a', b = 'rs3:task:custom:target-b';
  const state = { identityRegistry: { entries: { [queried]: { category: 'Extra' } }, aliases: {} } };
  const member = { completedTasks: [queried], taskAlternatives: { Mining: { 1: queried } } };
  const single = [{ id: a, category: 'Mining', aliases: [queried] }];
  assert.deepEqual(fullProjection(state, member, single).completedTasks, [a]);
  const ambiguous = [...single, { id: b, category: 'Smithing', aliases: [queried] }];
  const projected = fullProjection(state, member, ambiguous);
  assert.deepEqual(projected.completedTasks, [queried]);
  assert.deepEqual(projected.taskAlternatives, { Mining: { 1: a } });
  assert.deepEqual(projectMemberTaskFacts(materialize(state, [queried]), member, ambiguous), projected);
});

test('selective Automatic categories preserve encoded-prefix ambiguity and canonical overrides', () => {
  const catalogue = [
    { id: 'rs3:task:custom:one', category: 'Gathering', aliases: ['rs3:%4Dining:old', 'rs3:Fishing:old', 'rs3:%GG:malformed'] },
    { id: 'rs3:task:custom:two', category: 'Smithing', aliases: ['rs3:Mining:other'] },
  ];
  const first = fullProjection({}, { completedTasks: [], taskAlternatives: { Fishing: { 1: null } } }, catalogue);
  assert.deepEqual(first.taskAlternatives, { Gathering: { 1: null } });
  const later = { completedTasks: [], taskAlternatives: { Mining: { 1: null }, Fishing: { 2: null }, Gathering: { 2: 'unresolved' }, '%GG': { 1: null } } };
  const projected = fullProjection({}, later, catalogue);
  assert.deepEqual(projected.taskAlternatives, { Gathering: { 2: 'unresolved' }, Mining: { 1: null }, '%GG': { 1: null } });
  assert.deepEqual(projectMemberTaskFacts({}, later, catalogue), projected);
});

test('selective task categories retain the last catalogue row while alias categories retain their own occurrence', () => {
  const id = 'rs3:task:custom:duplicate-row', alias = 'duplicate-row-alias';
  const catalogue = [{ id, category: 'First', aliases: [alias] }, { id, category: 'Last', aliases: ['different-alias'] }];
  const member = { completedTasks: [alias], taskAlternatives: { First: { 1: alias } } };
  const projected = fullProjection({}, member, catalogue);
  assert.deepEqual(projected.completedTasks, [id]);
  assert.deepEqual(projected.taskAlternatives, { Last: { 1: id } });
  assert.deepEqual(projectMemberTaskFacts({}, member, catalogue), projected);
  const overwritten = [...catalogue, { id, category: 'Last', aliases: [alias] }];
  assert.deepEqual(fullProjection({}, member, overwritten).taskAlternatives, { First: { 1: alias } });
});
