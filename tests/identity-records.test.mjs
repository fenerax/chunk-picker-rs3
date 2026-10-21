import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { migrateGameplay, migrateTaskIdentities } from '../app/tasks/migration.mjs';
import { buildIdentityIndex, legacyTaskId, permanentTaskId } from '../app/tasks/identity.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';
import { duoFixture } from './fixtures/partner.mjs';

const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
const taskMap = JSON.parse(readFileSync(new URL('../reference/original-picker/tasksMap.json', import.meta.url), 'utf8'));
const smeltLabel = 'Smelt a ~|bronze bar|~';
const questLabel = "~|Cook's Assistant|~ Complete the quest";
const flowerLabel = 'Construct ~|stacked terracotta flower pots (level 16)|~';
const elderLabel = 'Fletch an ~|elder stock|~';
const display = raw => raw.replace(/~\|([^|]+)\|~/g, '$1');
const row = (category, rawLabel) => ({ id: legacyTaskId(category, rawLabel), label: display(rawLabel), category });
const leaves = value => value !== null && typeof value === 'object'
  ? Object.values(value).reduce((count, item) => count + leaves(item), 0) : 1;
function differencePreview(left, right, path = 'state', found = []) {
  if (Object.is(left, right) || found.length >= 8) return found;
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      differencePreview(left[key], right[key], `${path}.${key}`, found);
      if (found.length >= 8) break;
    }
  } else found.push({ path, repeated: String(left).slice(0, 120), previous: String(right).slice(0, 120) });
  return found;
}

function realisticSavedFixture() {
  // Ownership and member controls come from the existing connected-duo fixture.
  // Tasks, colliding decoder IDs and generated objectives use the full retained
  // reference data. Progress is synthetic: this does not claim a live save.
  const state = duoFixture().state;
  state.members.forEach((member, index) => { member.sourceMapId = index ? 'qxb' : 'qxa'; });
  const dynamicCatalogue = [
    ...createCollectionEngine({ challenges: {}, drops: { Cow: definitions.drops.Cow }, chunks: {} }).catalogue,
    equipmentTaskIdentity('Bronze sword', definitions.equipment['Bronze sword']),
  ];
  const every = dynamicCatalogue.find(task => task.rawLabel === 'Cow: ~|Bones|~ (Always)');
  const all = dynamicCatalogue.find(task => task.rawLabel === 'Cow: ~|Bones|~ (1) (Always)');
  const equipment = dynamicCatalogue.find(task => task.kind === 'equipment');
  assert(every && all && equipment);
  const oldEquipment = equipment.aliases[0];
  const smelt = row('Smithing', smeltLabel), quest = row('Quest', questLabel);
  state.tasks = [smelt, quest,
    { id: every.aliases[0], label: every.label, category: 'Extra' },
    { id: all.aliases[0], label: all.label, category: 'Extra' },
    { id: oldEquipment, label: equipment.label, category: 'BiS' },
    { id: permanentTaskId('Smithing', smeltLabel), label: display(smeltLabel), category: 'Smithing' },
  ];
  state.members[0].taskStatus = {
    [smelt.id]: { challengeCompleted: true, favorite: true, backlogged: true, note: 'Old spelling note retained despite canonical conflict' },
    [permanentTaskId('Smithing', smeltLabel)]: { challengeCompleted: false, note: 'Reviewed current note' },
    [every.aliases[0]]: { challengeCompleted: true, note: 'Bones from Cow' },
    [all.aliases[0]]: { challengeCompleted: true, backlogged: false, favorite: false },
    [oldEquipment]: { challengeCompleted: true, note: 'Bronze sword equipped', favorite: true },
  };
  state.members[1].taskStatus = { [quest.id]: { favorite: true, backlogged: true, note: 'Bring milk, flour and an egg' } };
  state.members[0].completedTasks = [quest.id, every.aliases[0], oldEquipment];
  state.members[1].completedTasks = [smelt.id];
  state.members[0].taskAlternatives = { Smithing: { default: smelt.id }, Extra: { 'Every Drop Bones': every.aliases[0] } };
  state.members[0].notes = { '12850': 'Keep the personal map note' };
  state.members[1].notes = { '12851': 'Keep the partner map note' };
  state.members[0].sourceBacklogs = { monsters: { Cow: false }, items: { Bones: true } };

  const selected = [];
  for (const [category, tasks] of Object.entries(definitions.challenges)) {
    const labels = Object.keys(tasks);
    for (const position of new Set([0, Math.floor(labels.length / 2), labels.length - 1])) {
      if (labels[position]) selected.push({ category, label: labels[position] });
    }
  }
  const maps = {};
  for (const [index, member] of state.members.entries()) {
    const chunkinfo = { checkedAllTasks: {}, checkedChallenges: {}, completedChallenges: {}, backlog: {}, favoriteTasks: {} };
    for (const [position, task] of selected.entries()) {
      const key = taskMap[task.label] ?? task.label;
      (chunkinfo.completedChallenges[task.category] ??= {})[key] = (position + index) % 2 === 0;
      (chunkinfo.backlog[task.category] ??= {})[key] = `Retained source note ${member.id} ${position}`;
      (chunkinfo.favoriteTasks[task.category] ??= {})[key] = true;
    }
    chunkinfo.checkedChallenges.Construction = { t_120947: true };
    chunkinfo.checkedChallenges.Fletching = { t_120947: true };
    // Neither category disambiguates the reused ID, so this must stay in review.
    chunkinfo.checkedChallenges.Unrecognized = { t_120947: true, t_missing_saved_decoder: true };
    maps[member.sourceMapId] = { chunks: { unlocked: [...member.unlocked] }, chunkinfo,
      chunkNotes: { [member.unlocked[0]]: `Retained ${member.id} chunk note` },
      rules: { 'Every Drop': true, 'Kill X': true },
      userTasks: { Extra: { 'Keep both maps and all evidence': {} } } };
  }
  state.legacy = { maps };
  // A historical full snapshot also exercises rewriting references used by undo.
  const before = structuredClone(state.members[0]);
  before.completedTasks = before.completedTasks.filter(id => id !== quest.id);
  state.revision = 1;
  state.history = [{ id: 'revision-1', revision: 1, type: 'complete-task', at: '2026-10-07T12:00:00.000Z',
    command: { type: 'complete-task', memberId: 'player1', taskId: quest.id, completed: true }, undo: { members: [before] } }];
  return { state: validateState(state), dynamicCatalogue, selected, every, all, equipment };
}

function accountSavedFacts(original, migrated, index) {
  const archives = migrated.provenance?.taskIdentityMigration?.archives ?? [];
  const archivedMember = (archive, id) => archive.members.find(member => member.id === id);
  let inspected = 0;
  for (const member of original.members) {
    const current = migrated.members.find(value => value.id === member.id);
    for (const id of member.completedTasks) {
      inspected++;
      const target = index.resolve(id).id ?? id;
      assert(current.completedTasks.includes(target) || archives.some(archive => archivedMember(archive, member.id)?.completedTasks.includes(id)), `Lost completion ${member.id}/${id}`);
    }
    for (const [id, status] of Object.entries(member.taskStatus ?? {})) for (const [field, value] of Object.entries(status)) {
      inspected++;
      const target = index.resolve(id).id ?? id;
      const same = entry => entry && Object.hasOwn(entry, field) && JSON.stringify(entry[field]) === JSON.stringify(value);
      assert(same(current.taskStatus?.[target]) || archives.some(archive => same(archivedMember(archive, member.id)?.taskStatus?.[id])), `Lost status field ${member.id}/${id}/${field}`);
    }
    for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const [group, id] of Object.entries(groups)) {
      inspected++;
      const target = index.resolve(id, { category }).id ?? id;
      assert(current.taskAlternatives?.[category]?.[group] === target || archives.some(archive => archivedMember(archive, member.id)?.taskAlternatives?.[category]?.[group] === id), `Lost alternative ${member.id}/${category}/${group}`);
    }
    for (const field of ['notes', 'sourceBacklogs']) if (member[field]) {
      inspected += leaves(member[field]);
      assert.deepEqual(current[field], member[field], `Lost ${member.id}/${field}`);
    }
  }
  assert.deepEqual(migrated.legacy.maps, original.legacy.maps);
  inspected += leaves(original.legacy.maps);
  assert(archives.some(archive => JSON.stringify(archive.history) === JSON.stringify(original.history)), 'Original undo history was not archived intact');
  inspected += leaves(original.history);
  for (const task of original.tasks) assert(archives.some(archive => archive.tasks.some(saved =>
    saved.id === task.id && saved.label === task.label && saved.category === task.category)), `Original catalogue row was not archived intact: ${task.id}`);
  inspected += leaves(original.tasks);
  return inspected;
}

test('full-reference duo migration independently accounts every saved record, aliases and undo through backup restore', t => {
  const fixture = realisticSavedFixture(), original = structuredClone(fixture.state);
  const options = { definitions, taskMap, dynamicCatalogue: fixture.dynamicCatalogue };
  const result = migrateGameplay(fixture.state, options);
  assert.deepEqual(fixture.state, original, 'Migration mutated the input save');
  const index = buildIdentityIndex(fixture.dynamicCatalogue, { taskMap, savedRegistry: result.state.identityRegistry });
  const accounted = accountSavedFacts(original, result.state, index);
  assert(accounted >= 500, `Fixture unexpectedly small: ${accounted} independent evidence records`);
  t.diagnostic(`${accounted} saved facts and evidence leaves independently retained; zero missing`);
  assert.equal(result.report.identities.lostRecords, 0);
  assert.equal(result.state.members[0].taskStatus[permanentTaskId('Smithing', smeltLabel)].challengeCompleted, false);
  assert.equal(result.state.members[0].taskStatus[fixture.every.id].challengeCompleted, true);
  assert.equal(result.state.members[0].taskStatus[fixture.all.id].challengeCompleted, true);
  assert.equal(result.state.members[0].taskStatus[fixture.equipment.id].challengeCompleted, true);
  assert.equal(result.state.members[0].taskStatus[permanentTaskId('Construction', flowerLabel)].challengeCompleted, true);
  assert.equal(result.state.members[0].taskStatus[permanentTaskId('Fletching', elderLabel)].challengeCompleted, true);
  assert(result.report.unresolved.some(entry => entry.legacyKey === 't_missing_saved_decoder'));
  assert(result.report.unresolved.some(entry => entry.category === 'Unrecognized' && entry.legacyKey === 't_120947'));
  assert(result.warnings.some(warning => warning.includes('t_missing_saved_decoder')));
  assert(result.report.identities.conflicts.length > 0, 'Conflicting canonical and alias status fields need provenance');

  const backup = JSON.stringify(exportBackup(result.state));
  const restored = importBackup(backup);
  assert(isDeepStrictEqual(restored.identityRegistry, result.state.identityRegistry), 'Backup changed the alias registry');
  assert(isDeepStrictEqual(restored.provenance.taskIdentityMigration, result.state.provenance.taskIdentityMigration), 'Backup changed identity provenance');
  assert.equal(accountSavedFacts(original, restored, index), accounted);
  const repeated = migrateGameplay(restored, options);
  if (!isDeepStrictEqual(repeated.state, restored)) {
    t.diagnostic(JSON.stringify(differencePreview(repeated.state, restored)));
    t.diagnostic(JSON.stringify({ unresolvedBefore: restored.identityRegistry.unresolved.length,
      unresolvedAfter: repeated.state.identityRegistry.unresolved.length,
      firstUnresolved: repeated.state.identityRegistry.unresolved.slice(0, 3) }));
  }
  assert(isDeepStrictEqual(repeated.state, restored), 'Migration must not accumulate aliases or archive already converted facts');
  assert.equal(restored.history.length, 0, 'Colliding old rows require an explicit undo boundary');
  assert(result.warnings.some(warning => warning.includes('Undo now starts after this import')));
});

test('a collision-free historical undo continues to use the permanent task reference after backup restore', () => {
  const state = duoFixture().state, quest = row('Quest', questLabel);
  state.tasks = [quest];
  const before = structuredClone(state.members[0]);
  state.members[0].completedTasks = [quest.id];
  state.revision = 1;
  state.history = [{ id: 'revision-1', revision: 1, type: 'complete-task', at: '2026-10-07T12:00:00.000Z',
    command: { type: 'complete-task', memberId: 'player1', taskId: quest.id, completed: true }, undo: { members: [before] } }];
  const migrated = migrateTaskIdentities(validateState(state)).state;
  assert.equal(migrated.history[0].command.taskId, permanentTaskId('Quest', questLabel));
  const undone = applyCommand(importBackup(JSON.stringify(exportBackup(migrated))), { type: 'undo' });
  assert(!undone.members[0].completedTasks.includes(permanentTaskId('Quest', questLabel)));
});

test('reviewed clears survive identity migration, backup restore and retained legacy challenge maps', () => {
  const fixture = realisticSavedFixture();
  const options = { definitions, taskMap, dynamicCatalogue: fixture.dynamicCatalogue };
  const initial = migrateGameplay(fixture.state, options).state;
  let changed = applyCommand(initial, { type: 'set-task-status', memberId: 'player1', taskId: fixture.every.id,
    challengeCompleted: false, backlogged: false, favorite: false, note: '' });
  changed = applyCommand(changed, { type: 'complete-task', memberId: 'player1', taskId: fixture.every.id, completed: false });
  const restarted = migrateGameplay(importBackup(JSON.stringify(exportBackup(changed))), options).state;
  assert.deepEqual(restarted.members[0].taskStatus[fixture.every.id], { challengeCompleted: false, backlogged: false, favorite: false, note: '' });
  assert(!restarted.members[0].completedTasks.includes(fixture.every.id));
  assert.deepEqual(restarted.legacy.maps, initial.legacy.maps);
  assert(isDeepStrictEqual(restarted.provenance.taskIdentityMigration.archives, changed.provenance.taskIdentityMigration.archives), 'Restart re-archived already converted facts');
});

test('unknown saved aliases remain visible with exact values and backup evidence, including retained catalogue rows', () => {
  for (const hasHistoricalRow of [false, true]) {
    const state = duoFixture().state;
    const missing = 't_removed_goal_without_known_decoder';
    state.members[0].taskStatus = { [missing]: { note: 'Do not lose this old note', challengeCompleted: false, backlogged: true, favorite: false } };
    state.members[0].completedTasks = [missing];
    if (hasHistoricalRow) {
      state.tasks.push({ id: missing, label: 'Historical task label without a decoder', category: 'Extra' });
      validateState(state); // This is a valid previous-version backup, not malformed input.
    }
    const result = migrateTaskIdentities(state);
    assert.deepEqual(result.state.members[0].taskStatus[missing], state.members[0].taskStatus[missing]);
    assert.deepEqual(result.state.members[0].completedTasks, [missing]);
    assert(result.state.tasks.some(task => task.id === missing && (hasHistoricalRow || task.label.includes('Unresolved'))));
    assert(result.report.unresolved.some(entry => entry.originalId === missing), 'An unknown alias must be visible even when its historical row is retained');
    assert(result.warnings.some(warning => warning.includes(missing)));
    const restored = importBackup(exportBackup(result.state));
    assert.deepEqual(restored.identityRegistry.unresolved, result.state.identityRegistry.unresolved);
    assert.deepEqual(restored.members[0].taskStatus[missing], state.members[0].taskStatus[missing]);
  }
});
