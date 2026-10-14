import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLegacyText, hasGameplayMigration, migrateGameplay, stableTaskId, stripTaskMarkup } from '../app/tasks/migration.mjs';
import { applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { reachableSections } from '../app/core/rules.mjs';
import { buildAccessIndex, calculateAccess } from '../app/tasks/access.mjs';

const flower = 'Construct ~|stacked ceramic flower pots (level 16)|~';
const elder = 'Fletch an ~|elder stock|~';
const definitions = { challenges: {
  Construction: { [flower]: { Level: 16 } },
  Fletching: { [elder]: { Level: 90 } },
  Quest: { '~|Cook\'s Assistant|~': {} },
} };
const taskMap = { [flower]: 't_120947', [elder]: 't_120947', '~|Cook\'s Assistant|~': 't_10',
  'Magic/Ranged/Melee BiS neck': 't_bis', currentNextIndex: 200000 };

function baseState(map, member = {}) {
  return { schemaVersion: 1, revision: 0, rules: {}, tasks: [], history: [],
    members: [{ id: 'actor1', name: 'Player', sourceMapId: 'old', unlocked: [], selected: [],
      pendingRoll: [], blacklisted: [], completedTasks: [], teleports: [], ...member }],
    legacy: { maps: { old: map } } };
}

test('stable catalogue IDs use exact NFC labels and display labels strip upstream markup', () => {
  assert.equal(stableTaskId('Quest', '~|Cook\'s Assistant|~'),
    "rs3:Quest:~%7CCook's%20Assistant%7C~");
  assert.equal(stableTaskId('Quest', 'Cafe\u0301'), stableTaskId('Quest', 'Café'));
  assert.equal(stripTaskMarkup('Complete ~|Cook\'s Assistant|~ <b>now</b>'), "Complete Cook's Assistant now");
  assert.equal(stripTaskMarkup('~|Ardougne Achievements#Easy|~ Silky Smooth*'), 'Ardougne Achievements Silky Smooth');
});

test('category context resolves the real flower-pot and elder-stock legacy ID collision', () => {
  const input = baseState({ chunkinfo: { completedChallenges: {
    Construction: { t_120947: true }, Fletching: { t_120947: true },
  } } });
  const result = migrateGameplay(input, { definitions, taskMap });
  const status = result.state.members[0].taskStatus;
  assert.equal(status[stableTaskId('Construction', flower)].challengeCompleted, true);
  assert.equal(status[stableTaskId('Fletching', elder)].challengeCompleted, true);
  assert.deepEqual(result.report.unresolved, []);
});

test('challenge progress stays separate from observed personal task completion', () => {
  const personal = stableTaskId('Quest', '~|Cook\'s Assistant|~');
  const input = baseState({ chunkinfo: {
    checkedAllTasks: { Quest: { t_10: true } },
    checkedChallenges: { Quest: { t_10: true } },
  } }, { completedTasks: [personal] });
  input.tasks.push({ id: personal, label: "Cook's Assistant", category: 'Quest' });
  const result = migrateGameplay(input, { definitions, taskMap });
  assert.deepEqual(result.state.members[0].completedTasks, [personal]);
  assert.equal(result.state.members[0].taskStatus[personal].challengeCompleted, true);
  assert.deepEqual(result.state.legacy.gameplayMigration.taskStatusProvenance[0].sources,
    ['checkedAllTasks', 'checkedChallenges']);
});

test('backlog notes, sticker notes, sections and primitive saved rules decode into member fields', () => {
  const input = baseState({
    rules: { Token: false, 'Kill-_-20X-_-20Amount': '3' },
    chunkinfo: {
      backlog: { Quest: { t_10: 'Needs-_-20a-_-20friend-_-2E' } },
      favoriteTasks: { Quest: { t_10: true } },
      manualSections: { '*fb*_12342': { '*fb*_0': false, '*fb*_2': true } },
    },
    chunks: { stickeredNotes: { '*fb*_12342': 'Starting-_-20chunk-_-2E' } },
    chunkNotes: { '*fb*_12343': 'Second-_-20note', '12343-1': 'Subsection-_-20note' },
  });
  const result = migrateGameplay(input, { definitions, taskMap });
  const task = stableTaskId('Quest', '~|Cook\'s Assistant|~');
  assert.deepEqual(result.state.members[0].taskStatus[task], {
    backlogged: true, note: 'Needs a friend.', favorite: true,
  });
  assert.deepEqual(result.state.members[0].notes, { 12342: 'Starting chunk.', 12343: 'Second note' });
  assert.deepEqual(result.state.members[0].sectionOverrides, { '12342-0': false, '12342-2': true });
  assert.deepEqual(result.state.members[0].taskRules, { Token: false, 'Kill X Amount': '3' });
  assert.equal(decodeLegacyText('Magic-_-2G-_-E2-_-80-_-8BRanged'), 'Magic/​Ranged');
  assert.ok(result.warnings.some(message => message.includes('unsupported chunk number 12343-1')));
});

test('user tasks and uniquely named legacy BiS tasks join the catalogue with plain labels', () => {
  const input = baseState({
    userTasks: { Extra: { 'Do-_-20~|something-_-20custom|~': true } },
    chunkinfo: { backlog: { BiS: { t_bis: '' } } },
  });
  const result = migrateGameplay(input, { definitions, taskMap });
  const customId = result.state.identityRegistry.aliases[stableTaskId('Extra', 'Do ~|something custom|~')];
  assert.match(customId, /^rs3:task:custom:/);
  assert.deepEqual(result.state.tasks.find(task => task.id === customId), {
    id: customId, label: 'Do something custom', category: 'Extra',
  });
  assert.equal(result.state.members[0].taskStatus[stableTaskId('BiS', 'Magic/Ranged/Melee BiS neck')].backlogged, true);
});

test('ambiguous and unknown IDs are quarantined visibly while raw legacy data remains exact', () => {
  const raw = { chunkinfo: { completedChallenges: {
    Unknown: { t_120947: true, t_missing: true },
  } }, chunkNotes: 'Map-_-20wide-_-20note' };
  const input = baseState(raw);
  const result = migrateGameplay(input, { definitions, taskMap });
  assert.equal(result.report.unresolved.length, 2);
  assert.deepEqual(result.state.legacy.maps.old, raw);
  assert.deepEqual(result.state.legacy.gameplayMigration.unresolved, result.report.unresolved);
  assert.equal(result.state.members[0].journal, 'Map wide note');
  assert.ok(result.warnings.some(message => message.includes('more than one task matches this original check')));
  assert.ok(result.warnings.some(message => message.includes('no task matches this original check')));
});

test('migration is immutable and idempotent while preserving authored custom tasks and member values', () => {
  const manual = { id: 'custom:manual', label: 'Manual task', category: 'Custom' };
  const input = baseState({
    rules: { Token: false },
    chunkinfo: { backlog: { Quest: { t_10: 'Legacy-_-20note' } },
      manualSections: { '*fb*_12342': { '*fb*_1': true } } },
    chunks: { stickeredNotes: { '*fb*_12342': 'Legacy-_-20chunk-_-20note' } },
  }, { notes: { 12342: 'Authored note' }, sectionOverrides: { '12342-1': false },
    taskRules: { Token: true } });
  input.tasks.push(manual);
  const snapshot = structuredClone(input);
  const first = migrateGameplay(input, { definitions, taskMap });
  const second = migrateGameplay(first.state, { definitions, taskMap });
  assert.deepEqual(input, snapshot);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(first.state.tasks[0], manual);
  assert.equal(first.state.members[0].notes['12342'], 'Authored note');
  assert.equal(first.state.members[0].sectionOverrides['12342-1'], false);
  assert.equal(first.state.members[0].taskRules.Token, true);
});

test('a supplied catalogue is integrated without replacing existing authored catalogue records', () => {
  const supplied = { id: 'actual:catalogue', label: '~|Actual catalogue task|~', category: 'Actual', ignored: true };
  const authored = { id: supplied.id, label: 'Authored label', category: 'Actual' };
  const additional = { id: 'actual:additional', label: '~|Additional task|~', category: 'Actual', ignored: true };
  const input = baseState({});
  input.tasks.push(authored);
  const result = migrateGameplay(input, { definitions: { challenges: {} }, taskMap: {}, catalogue: [supplied, additional] });
  assert.deepEqual(result.state.tasks, [authored,
    { id: 'actual:additional', label: 'Additional task', category: 'Actual' }]);
});

test('conversion runs once per owner and clears survive commands, another preparation, and restart', () => {
  const task = stableTaskId('Quest', '~|Cook\'s Assistant|~');
  const map = { rules: { Token: true }, chunkinfo: {
    completedChallenges: { Quest: { t_10: true } }, backlog: { Quest: { t_10: 'Legacy note' } },
    manualSections: { 12342: { 1: true } }, manualAreas: { 'New-_-20Varrock': false },
    backloggedSources: { objects: { Sawmill: true }, items: { 'Iron-_-20ore': true } },
  }, chunkNotes: { 12342: 'Old chunk note' } };
  const input = baseState(map, { unlocked: ['12342'] });
  const initial = migrateGameplay(input, { definitions, taskMap });
  assert(hasGameplayMigration(initial.state, initial.state.members[0]));
  assert.deepEqual(initial.state.members[0].sourceBacklogs, { objects: { Sawmill: true }, items: { 'Iron ore': true } });
  assert.deepEqual(initial.state.members[0].areaOverrides, { 'New Varrock': false });
  const commands = [
    { type: 'set-note', memberId: 'actor1', chunkId: '12342', note: '' },
    { type: 'set-section', memberId: 'actor1', sectionId: '12342-1', accessible: null },
    { type: 'set-area', memberId: 'actor1', areaId: 'New Varrock', accessible: null },
    { type: 'set-source-backlog', memberId: 'actor1', kind: 'objects', name: 'Sawmill', backlogged: false },
    { type: 'set-task-status', memberId: 'actor1', taskId: task, challengeCompleted: false, backlogged: false, note: '' },
  ];
  const world = { chunks: new Map([['12342', { id: '12342' }]]), sectionTopology: new Map([['12342', new Map([['1', []]])]]) };
  let current = initial.state;
  for (const command of commands) current = migrateGameplay(applyCommand(current, command, { world }), { definitions, taskMap }).state;
  const restarted = migrateGameplay(JSON.parse(JSON.stringify(current)), { definitions, taskMap });
  assert.equal(restarted.state.members[0].notes?.['12342'], undefined);
  assert.equal(restarted.state.members[0].sectionOverrides?.['12342-1'], undefined);
  assert.equal(restarted.state.members[0].areaOverrides?.['New Varrock'], undefined);
  assert.equal(restarted.state.members[0].sourceBacklogs.objects.Sawmill, false);
  assert.deepEqual(restarted.state.members[0].taskStatus[task], { challengeCompleted: false, backlogged: false, note: '' });
  assert.deepEqual(restarted.state.legacy.maps.old, map);
  assert.deepEqual(restarted.report.imported, initial.report.imported);
  assert.deepEqual(reachableSections(world, restarted.state, 'actor1'), []);
  const index = buildAccessIndex({ chunks: { 12342: { Sections: { 1: { Connect: { 'New Varrock': true } } } }, 'New Varrock': {} }, sections: { 12342: { 1: [] } } });
  assert.equal(calculateAccess(index, restarted.state, 'actor1').sections.size, 0);
});

test('an existing version-1 migration does not resurrect edited legacy fields during upgrade', () => {
  const input = baseState({ chunkinfo: { manualSections: { 12342: { 1: true } }, manualAreas: { 'New-_-20Varrock': false }, backloggedSources: { objects: { Sawmill: true } } }, chunkNotes: { 12342: 'Deleted note' }, rules: { Token: true } });
  input.legacy.gameplayMigration = { schemaVersion: 1, unresolved: [], taskStatusProvenance: [] };
  const upgraded = migrateGameplay(input, { definitions, taskMap });
  assert.equal(upgraded.state.members[0].notes, undefined);
  assert.equal(upgraded.state.members[0].sectionOverrides, undefined);
  assert.equal(upgraded.state.members[0].taskRules, undefined);
  assert.deepEqual(upgraded.state.members[0].areaOverrides, { 'New Varrock': false });
  assert.deepEqual(upgraded.state.members[0].sourceBacklogs, { objects: { Sawmill: true } });
  assert.equal(upgraded.state.legacy.gameplayMigration.schemaVersion, 2);
  assert.deepEqual(migrateGameplay(upgraded.state, { definitions, taskMap }).state, upgraded.state);
});

test('a new owner of a retained map migrates once without reviving an existing owner\'s deletions', () => {
  const initial = migrateGameplay(baseState({ chunkNotes: { 12342: 'Shared legacy note' } }), { definitions, taskMap }).state;
  delete initial.members[0].notes;
  initial.members.push({ ...structuredClone(initial.members[0]), id: 'reed', name: 'Reed' });
  const result = migrateGameplay(initial, { definitions, taskMap });
  assert.equal(result.state.members[0].notes, undefined);
  assert.equal(result.state.members[1].notes['12342'], 'Shared legacy note');
  assert(hasGameplayMigration(result.state, result.state.members[1]));
});

test('a large potential catalogue resolves imported identities while saving only referenced dynamic tasks', () => {
  const dynamicCatalogue = Array.from({ length: 100000 }, (_, index) => {
    const raw = `Collect ~|Drop ${index}|~`;
    return { id: stableTaskId('Extra', raw), label: stripTaskMarkup(raw), category: 'Extra' };
  });
  const input = baseState({ chunkinfo: {
    completedChallenges: { Extra: { t_dynamic: true, 'Collect-_-20~|Drop-_-202|~': false } },
    backlog: { Extra: { 'Collect-_-20~|Drop-_-203|~': 'Needs-_-20a-_-20drop' } },
  } }, { completedTasks: [dynamicCatalogue[4].id], taskStatus: { [dynamicCatalogue[5].id]: { challengeCompleted: false } } });
  const snapshot = structuredClone(input), selected = structuredClone(dynamicCatalogue[1]);
  const result = migrateGameplay(input, { definitions, taskMap: { 'Collect ~|Drop 1|~': 't_dynamic' }, dynamicCatalogue });
  assert.deepEqual(input, snapshot);
  assert.deepEqual(dynamicCatalogue[1], selected);
  const persisted = result.state.tasks.filter(task => task.category === 'Extra');
  assert.deepEqual(new Set(persisted.map(task => task.id)), new Set([1, 3, 4, 5].map(index => dynamicCatalogue[index].id)));
  assert(persisted.every(task => Object.keys(task).sort().join(',') === 'category,id,label'));
  const member = result.state.members[0];
  assert.equal(member.taskStatus[dynamicCatalogue[1].id].challengeCompleted, true);
  assert.deepEqual(member.taskStatus[dynamicCatalogue[3].id], { backlogged: true, note: 'Needs a drop' });
  assert.equal(member.taskStatus[dynamicCatalogue[5].id].challengeCompleted, false);
  assert.deepEqual(member.completedTasks, [dynamicCatalogue[4].id]);
  assert.equal(result.report.unresolved.length, 0);
  assert(JSON.stringify(exportBackup(result.state)).length < 10000);
  assert.deepEqual(importBackup(exportBackup(result.state)), validateState(result.state));
});

test('dynamic imports fail closed on ambiguous legacy labels and invalid stable identifiers', () => {
  const rawA = 'Kill X ~|Goblin|~', rawB = 'Kill X ~|Rat|~';
  const dynamicCatalogue = [rawA, rawB].map(raw => ({ id: stableTaskId('Extra', raw), label: stripTaskMarkup(raw), category: 'Extra' }));
  const input = baseState({ chunkinfo: { checkedChallenges: { Extra: { t_both: true } } } });
  const result = migrateGameplay(input, { definitions, taskMap: { [rawA]: 't_both', [rawB]: 't_both' }, dynamicCatalogue });
  assert.equal(result.report.unresolved[0].reason, 'ambiguous legacy task ID');
  assert.equal(result.state.tasks.filter(task => task.category === 'Extra').length, 0);
  assert.equal(result.state.members[0].taskStatus, undefined);
  assert.throws(() => migrateGameplay(input, { dynamicCatalogue: [{ id: 'arbitrary', label: 'Goblin', category: 'Extra' }] }), /canonical stable/);
  assert.throws(() => migrateGameplay(input, { dynamicCatalogue: [{ ...dynamicCatalogue[0], label: '<b></b>' }] }), /nonempty display/);
  assert.throws(() => migrateGameplay(input, { dynamicCatalogue: [dynamicCatalogue[0], { ...dynamicCatalogue[0], label: 'Conflicting label' }] }), /Ambiguous dynamicCatalogue/);
});

test('adding potential dynamic tasks never reimports converted checks or retries quarantined identities', () => {
  const raw = 'Kill X ~|Unregistered fixture creature|~', id = stableTaskId('Extra', raw);
  const input = baseState({ chunkinfo: { completedChallenges: { Extra: { t_generated: true } } } });
  const initial = migrateGameplay(input, { definitions, taskMap: { [raw]: 't_generated' } }).state;
  assert.equal(initial.legacy.gameplayMigration.unresolved.length, 1);
  const dynamicCatalogue = [{ id, label: stripTaskMarkup(raw), category: 'Extra' }];
  const retried = migrateGameplay(initial, { definitions, dynamicCatalogue });
  assert.equal(retried.state.tasks.some(task => task.id === id), false);
  assert.deepEqual(retried.state.legacy.gameplayMigration.unresolved, initial.legacy.gameplayMigration.unresolved);
  assert.equal(retried.state.members[0].taskStatus, undefined);
  initial.members[0].taskStatus = { [id]: { challengeCompleted: false } };
  const authored = migrateGameplay(initial, { definitions, dynamicCatalogue }).state;
  assert.equal(authored.tasks.find(task => task.id === id).id, id);
  assert.equal(authored.members[0].taskStatus[id].challengeCompleted, false);
  delete authored.members[0].taskStatus[id];
  const later = migrateGameplay(authored, { definitions, dynamicCatalogue }).state;
  assert.equal(later.members[0].taskStatus[id], undefined);
  assert(later.tasks.some(task => task.id === id)); // existing catalogue rows are retained.
});

test('dynamic hydration preserves authored catalogue rows and sparse undo history', () => {
  const raw = 'General Store: ~|Hammer|~', id = stableTaskId('Extra', raw);
  const input = applyCommand(baseState({}), { type: 'set-area', memberId: 'actor1', areaId: 'Cave', accessible: true });
  input.tasks.push({ id, label: 'Authored task label', category: 'Extra' });
  input.members[0].taskStatus = { [id]: { favorite: true } };
  const history = structuredClone(input.history);
  const result = migrateGameplay(input, { definitions, dynamicCatalogue: [{ id, label: stripTaskMarkup(raw), category: 'Extra', generated: true }] }).state;
  assert.deepEqual(result.history, history);
  assert.equal(result.tasks.find(task => task.id === id).label, 'Authored task label');
  assert.deepEqual(importBackup(exportBackup(result)).history, history);
  const undone = applyCommand(result, { type: 'undo' });
  assert.equal(undone.members[0].areaOverrides, undefined);
  assert.deepEqual(undone.members[0].taskStatus[id], { favorite: true });
});
