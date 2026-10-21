import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, applyValidatedCommand, createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { previewOriginalSync, originalSyncCommand } from '../app/integrations/original-sync.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';

const capturedAt = '2026-10-07T17:00:00.000Z', appliedAt = '2026-10-07T18:00:00.000Z';
const sourceHash = `sha256:${'a'.repeat(64)}`, now = () => appliedAt;
const row = (name, category = 'Cooking', rawLabel = `Original ${name}`) => ({
  id: `rs3:task:test:${name}`, label: `Task ${name}`, category, rawLabel, kind: 'task',
});
const cooked = row('cooked'), backlog = row('backlog'), empty = row('empty'), local = row('local');
const quest = row('quest', 'Quest', 'Original quest');
const catalogue = [cooked, backlog, empty, local, quest];
function group(rows = catalogue) {
  const state = createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2', sourceMapId: 'qxb' }]);
  state.tasks = rows.map(({ id, label, category }) => ({ id, label, category }));
  state.identityRegistry = { schemaVersion: 1, entries: Object.fromEntries(rows.map(task => [task.id, {
    ...task, aliases: [task.id, task.rawLabel, legacyTaskId(task.category, task.rawLabel)],
  }])), aliases: Object.fromEntries(rows.flatMap(task => [task.id, task.rawLabel, legacyTaskId(task.category, task.rawLabel)].map(alias => [alias, task.id]))), unresolved: [] };
  return state;
}
function map(chunkinfo = {}) { return { chunks: { unlocked: {} }, rules: { F2P: false, Boss: false }, chunkinfo }; }
function document(chunkinfo = {}, partner = {}) {
  return { metadata: { capturedAt, hash: sourceHash }, maps: { qxa: map(chunkinfo), qxb: map(partner) } };
}
function review(state, chunkinfo, options = {}) { return previewOriginalSync(state, document(chunkinfo), [], { catalogue, ...options }); }
function tasks(reviewed, memberId = 'player1') { return reviewed.preview.members.find(member => member.id === memberId).tasks; }
function command(reviewed, memberIds = ['player1']) { return originalSyncCommand(reviewed, memberIds.map(memberId => ({ memberId, groups: ['tasks'] }))); }
function apply(state, payload, options = {}) { return applyCommand(state, payload, { expectedRevision: state.revision, now, taskCatalogue: catalogue, ...options }); }
function batch(complete = [], backlogRows = [], extra = {}) {
  return { type: 'sync-original', capturedAt, sourceHash, members: [{ memberId: 'player1', sourceMapId: 'qxa', groups: ['tasks'],
    tasks: { complete, backlog: backlogRows }, ...extra }] };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('task review unions all three positive check sources, deduplicates aliases, and ignores false checks', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  const reviewed = review(state, {
    checkedAllTasks: { Cooking: { t_cooked: true, [backlog.id]: false } },
    checkedChallenges: { Cooking: { [cooked.rawLabel]: true, [empty.rawLabel]: false } },
    completedChallenges: { Cooking: { [cooked.id]: true } },
  }, { taskMap: { [cooked.rawLabel]: 't_cooked' } });
  assert.deepEqual(tasks(reviewed).complete, [{ id: cooked.id, label: cooked.label, category: cooked.category,
    sources: ['checkedAllTasks', 'checkedChallenges', 'completedChallenges'] }]);
  assert.deepEqual(tasks(reviewed).unmapped, []);
  assert.deepEqual(command(reviewed).members[0], { memberId: 'player1', sourceMapId: 'qxa', groups: ['tasks'], tasks: { complete: [cooked.id], backlog: [] } });
  assert.equal(JSON.stringify(state), before);
});

test('task review uses category-filtered historical mappings and raw-label aliases without guessing collisions', () => {
  const cooking = row('collision-cooking', 'Cooking', 'Shared original label');
  const mining = row('collision-mining', 'Mining', 'Shared original label');
  const ambiguous = row('collision-cooking-other', 'Cooking', 'Other original label');
  const state = group([cooking, mining, ambiguous]);
  const reviewed = review(state, { checkedChallenges: {
    Cooking: { t_shared: true, t_ambiguous: true }, Mining: { t_shared: true }, Fishing: { t_shared: true },
  } }, { catalogue: [cooking, mining, ambiguous], taskMap: { [cooking.rawLabel]: 't_shared' }, taskMapHistory: {
    historical: { [ambiguous.rawLabel]: 't_ambiguous' }, current: { [cooking.rawLabel]: 't_ambiguous' },
  } });
  assert.deepEqual(tasks(reviewed).complete.map(task => task.id), [cooking.id, mining.id]);
  const unknowns = tasks(reviewed).unmapped;
  assert.equal(unknowns.length, 2);
  assert.match(unknowns.find(task => task.originalId === 't_ambiguous').reason, /Ambiguous/);
  assert.equal(unknowns.find(task => task.category === 'Fishing').label, 'Shared original label');
  assert.equal(unknowns.find(task => task.category === 'Fishing').category, 'Fishing');
});

test('catalogue and dynamic catalogue resolve permanent tasks absent from saved rows', () => {
  const state = group([]), dynamic = row('dynamic', 'Extra');
  const reviewed = review(state, { completedChallenges: { Cooking: { [cooked.rawLabel]: true }, Extra: { [dynamic.rawLabel]: true } } },
    { catalogue: [cooked], dynamicCatalogue: [dynamic] });
  assert.deepEqual(tasks(reviewed).complete.map(task => task.id), [cooked.id, dynamic.id]);
  assert.deepEqual(state.tasks, []);
});

test('identities absent from saved and trusted catalogues remain reviewable instead of offering an unapplicable task', () => {
  const state = group(); state.tasks = state.tasks.filter(task => task.id !== cooked.id);
  const reviewed = review(state, { completedChallenges: { Cooking: { t_retired: true } } },
    { catalogue: [], taskMap: { [cooked.rawLabel]: 't_retired' } });
  assert.deepEqual(tasks(reviewed).complete, []);
  assert.deepEqual(command(reviewed).members[0].tasks, { complete: [], backlog: [] });
  const [unmapped] = tasks(reviewed).unmapped;
  assert.equal(unmapped.originalId, 't_retired'); assert.equal(unmapped.label, cooked.rawLabel);
  assert.match(unmapped.reason, /absent from the current saved and generated catalogues/);
});

test('saved historical local completion aliases suppress duplicate original additions without rewriting source facts', () => {
  const state = group();
  state.identityRegistry.aliases.t_old_cooked = cooked.id;
  state.members[0].taskStatus = { t_old_cooked: { challengeCompleted: true, favorite: true } };
  state.members[0].completedTasks = [legacyTaskId(quest.category, quest.rawLabel)];
  const before = structuredClone(state);
  const reviewed = review(freeze(state), { checkedChallenges: { Cooking: { t_current_cooked: true }, Quest: { [quest.rawLabel]: true } } },
    { taskMap: { [cooked.rawLabel]: 't_current_cooked' } });
  assert.deepEqual(tasks(reviewed).complete, []);
  assert.deepEqual(command(reviewed).members[0].tasks.complete, []);
  assert.deepEqual(state, before);
});

test('unknown review rows retain original labels, categories and check provenance when available', () => {
  const reviewed = review(group(), { checkedAllTasks: { Cooking: { t_missing: true, 'Lost original label': true } },
    checkedChallenges: { Cooking: { t_missing: true } }, backlog: { Mining: { t_backlog_missing: '' } } },
  { taskMap: { 'Unavailable original label': 't_missing' }, taskMapHistory: { tombstones: { 'Old backlog label': 't_backlog_missing' } } });
  assert.deepEqual(tasks(reviewed).complete, []);
  assert.deepEqual(tasks(reviewed).backlogAdd, []);
  const unknowns = tasks(reviewed).unmapped;
  assert.deepEqual(unknowns.find(task => task.originalId === 't_missing'), { category: 'Cooking', originalId: 't_missing',
    label: 'Unavailable original label', candidates: ['Unavailable original label'], reason: 'No task identity in this category',
    sources: ['checkedAllTasks', 'checkedChallenges'] });
  assert.equal(unknowns.find(task => task.originalId === 'Lost original label').label, 'Lost original label');
  assert.equal(unknowns.find(task => task.originalId === 't_backlog_missing').label, 'Old backlog label');
});

test('task preview accepts empty backlog reasons and retains local completions and backlogs absent from source', () => {
  const state = group();
  state.members[0].completedTasks = [quest.id];
  state.members[0].taskStatus = { [local.id]: { challengeCompleted: true, backlogged: true, backlogReason: 'Local reason', favorite: true } };
  const reviewed = review(state, { backlog: { Cooking: { [empty.rawLabel]: '', [backlog.rawLabel]: 'Wait for access' } } });
  assert.deepEqual(tasks(reviewed).backlogAdd, [
    { id: empty.id, label: empty.label, category: empty.category, reason: '' },
    { id: backlog.id, label: backlog.label, category: backlog.category, reason: 'Wait for access' },
  ]);
  assert.deepEqual(new Set(tasks(reviewed).keepCompleted.map(task => task.id)), new Set([quest.id, local.id]));
  assert.deepEqual(tasks(reviewed).keepBacklog, [{ id: local.id, label: local.label, category: local.category, reason: 'Local reason' }]);
  const result = apply(state, command(reviewed));
  assert.deepEqual(result.members[0].taskStatus[empty.id], { backlogged: true });
  assert.deepEqual(result.members[0].taskStatus[backlog.id], { backlogged: true, backlogReason: 'Wait for access' });
  assert.deepEqual(result.members[0].taskStatus[local.id], state.members[0].taskStatus[local.id]);
  assert.deepEqual(result.members[0].completedTasks, state.members[0].completedTasks);
});

test('review reports conflicting local reasons and apply preserves local notes and flags', () => {
  const state = group();
  state.members[0].taskStatus = { [cooked.id]: { favorite: true, note: 'Local plan', backlogged: false, challengeCompleted: false },
    [backlog.id]: { backlogged: true, favorite: false, backlogReason: 'Existing backlog' } };
  const reviewed = review(state, { checkedChallenges: { Cooking: { [cooked.rawLabel]: true } },
    backlog: { Cooking: { [cooked.rawLabel]: 'Original plan', [backlog.rawLabel]: 'Original backlog' } } });
  // A task note is not a backlog reason: only the existing backlog reason conflicts, and the note is kept as-is.
  assert.deepEqual(tasks(reviewed).backlogConflicts, [
    { id: backlog.id, label: backlog.label, category: backlog.category, reason: 'Original backlog', localReason: 'Existing backlog' },
  ]);
  const result = apply(state, command(reviewed));
  assert.deepEqual(result.members[0].taskStatus[cooked.id], { favorite: true, note: 'Local plan', backlogged: true, challengeCompleted: true, backlogReason: 'Original plan' });
  assert.deepEqual(result.members[0].taskStatus[backlog.id], state.members[0].taskStatus[backlog.id]);
});

test('conflicting backlog aliases are reported for manual review and never enter the trusted command', () => {
  const reviewed = review(group(), { backlog: { Cooking: { [cooked.rawLabel]: 'First reason', t_cooked: 'Second reason' } } },
    { taskMap: { [cooked.rawLabel]: 't_cooked' } });
  assert.deepEqual(tasks(reviewed).backlogAdd, []);
  assert.equal(tasks(reviewed).unmapped.length, 1);
  assert.match(tasks(reviewed).unmapped[0].reason, /different reasons/);
  assert.equal(tasks(reviewed).unmapped[0].label, cooked.label);
  assert.deepEqual(command(reviewed).members[0].tasks.backlog, []);
});

test('task apply fills absent or empty backlog notes and preserves nonempty notes and positive local evidence', () => {
  const state = group();
  state.members[0].taskStatus = { [cooked.id]: { backlogged: true, backlogReason: '', favorite: true },
    [backlog.id]: { backlogged: true, backlogReason: 'Local reason', challengeCompleted: true },
    [empty.id]: { favorite: false } };
  const result = apply(state, batch([], [
    { taskId: cooked.id, reason: 'Original reason' }, { taskId: backlog.id, reason: 'Different original reason' }, { taskId: empty.id, reason: '' },
  ]));
  assert.deepEqual(result.members[0].taskStatus[cooked.id], { backlogged: true, backlogReason: 'Original reason', favorite: true });
  assert.deepEqual(result.members[0].taskStatus[backlog.id], state.members[0].taskStatus[backlog.id]);
  assert.deepEqual(result.members[0].taskStatus[empty.id], { favorite: false, backlogged: true });
  const negative = review(result, { checkedChallenges: { Cooking: { [backlog.rawLabel]: false } } });
  assert.ok(tasks(negative).keepCompleted.some(task => task.id === backlog.id));
  assert.deepEqual(apply(result, command(negative)).members[0].taskStatus[backlog.id], state.members[0].taskStatus[backlog.id]);
});

test('task-only apply records challenge evidence while preserving personal game progress, rules and partner', () => {
  const state = group();
  state.rules['content.f2p'] = true;
  state.members[0].taskRules = { Boss: true };
  state.members[0].completedTasks = [quest.id];
  state.members[0].questProgress = { [quest.id]: { title: quest.label, source: 'runemetrics', fetchedAt: capturedAt, runescapeName: 'exampleGIMab' } };
  state.members[0].skillProgress = { Cooking: { level: 30, xp: 13400, source: 'runemetrics', fetchedAt: capturedAt, runescapeName: 'exampleGIMab' } };
  const baseline = validateState(state), reviewed = review(freeze(baseline), { completedChallenges: { Cooking: { [cooked.rawLabel]: true } } });
  const result = apply(baseline, command(reviewed));
  assert.deepEqual(result.members[0].taskStatus[cooked.id], { challengeCompleted: true });
  for (const field of ['completedTasks', 'questProgress', 'skillProgress', 'taskRules']) assert.deepEqual(result.members[0][field], baseline.members[0][field]);
  assert.deepEqual(result.rules, baseline.rules);
  assert.deepEqual(result.members[1], baseline.members[1]);
  assert.deepEqual(result.members[0].originalPickerSync, { sourceMapId: 'qxa', capturedAt, appliedAt, sourceHash, groups: ['tasks'] });
});

test('real F2P engine keeps membership and visibility gates while original checks satisfy the duo challenge only', () => {
  const freeTask = row('engine-free', 'Extra'), memberTask = row('engine-member', 'Extra');
  const rows = [freeTask, memberTask];
  const engine = createTaskEngine({
    chunks: { '1': { Object: { Furnace: true } } }, sections: {}, codeItems: {}, walkableChunksF2P: ['1'],
    challenges: { Extra: {
      [freeTask.rawLabel]: { PickerId: freeTask.id, Chunks: ['1'] },
      [memberTask.rawLabel]: { PickerId: memberTask.id, Chunks: ['1'], 'Not F2P': true },
    } },
  });
  const state = group(rows);
  state.rules['content.f2p'] = true;
  for (const owner of state.members) owner.unlocked = ['1'];
  const before = engine.evaluate(state, 'player2');
  const reviewed = review(state, { completedChallenges: { Extra: { [freeTask.rawLabel]: true, [memberTask.rawLabel]: true } } }, { catalogue: rows });
  const result = apply(state, command(reviewed), { taskCatalogue: rows });
  const after = engine.evaluate(result, 'player2');
  const gates = evaluation => evaluation.tasks.map(({ id, status, hidden, hiddenReasons, blockers }) => ({ id, status, hidden, hiddenReasons, blockers }));
  assert.deepEqual(gates(after), gates(before));
  const find = (evaluation, id) => evaluation.tasks.find(task => task.id === id);
  assert.equal(find(before, freeTask.id).status, 'available');
  assert.equal(find(after, memberTask.id).status, 'blocked');
  assert.ok(find(after, memberTask.id).blockers.some(blocker => blocker.kind === 'membership'));
  assert.equal(find(before, freeTask.id).challengeSatisfied, false);
  assert.equal(find(after, freeTask.id).challengeSatisfied, true);
  assert.equal(find(after, freeTask.id).personalCompleted, false);
  assert.equal(find(engine.evaluate(result, 'player1'), freeTask.id).personalCompleted, false);
  assert.deepEqual(result.members.map(owner => owner.completedTasks), [[], []]);
  assert.equal(result.members[1].taskStatus, undefined);
  assert.deepEqual(result.rules, state.rules);
});

test('public and validated task batches register trusted rows and one backup-roundtrip undo restores both members and tasks', () => {
  const state = freeze(validateState(group([local])));
  const reviewed = previewOriginalSync(state, document({ checkedChallenges: { Cooking: { [cooked.rawLabel]: true, [backlog.rawLabel]: true } } },
    { backlog: { Cooking: { [backlog.rawLabel]: 'Partner reason' } } }), [], { catalogue });
  const payload = command(reviewed, ['player1', 'player2']);
  const publicResult = apply(state, payload), validated = applyValidatedCommand(state, payload, { expectedRevision: 0, now, taskCatalogue: new Map(catalogue.map(task => [task.id, task])) });
  assert.deepEqual(validated, publicResult);
  assert.deepEqual(publicResult.tasks.map(task => task.id), [local.id, cooked.id, backlog.id]);
  assert.equal(publicResult.history.length, 1);
  assert.deepEqual(publicResult.members[0].taskStatus[cooked.id], { challengeCompleted: true });
  assert.deepEqual(publicResult.members[0].taskStatus[backlog.id], { challengeCompleted: true });
  assert.deepEqual(publicResult.members[1].taskStatus[backlog.id], { backlogged: true, backlogReason: 'Partner reason' });
  assert.equal(publicResult.identityRegistry.aliases[legacyTaskId(cooked.category, cooked.rawLabel)], cooked.id);
  const restored = importBackup(exportBackup(publicResult));
  for (const path of [applyCommand, applyValidatedCommand]) {
    const undone = path(restored, { type: 'undo' }, { expectedRevision: 1, now });
    assert.deepEqual(undone.members, state.members);
    assert.deepEqual(undone.tasks, state.tasks);
    assert.deepEqual(undone.rules, state.rules);
    assert.deepEqual(validateState(undone), undone);
  }
  assert.deepEqual(state.tasks.map(task => task.id), [local.id]);
});

test('malformed task batches reject atomically before requesting time on both command paths', () => {
  const state = freeze(validateState(group([local]))), before = JSON.stringify(state);
  const invalid = [
    batch(undefined), batch([cooked.id, cooked.id]), batch([3]), batch(['__proto__']), batch(['rs3:task:test:unknown']),
    batch([], [{ taskId: backlog.id, reason: 3 }]), batch([], [{ taskId: backlog.id }]),
    batch([], [{ taskId: backlog.id, reason: '', label: 'Injected metadata' }]),
    batch([], [{ taskId: backlog.id, reason: '' }, { taskId: backlog.id, reason: 'Duplicate' }]),
    batch([], [], { tasks: { complete: [], backlog: [], completedTasks: [quest.id] } }),
    batch([], [], { tasks: { complete: [], backlog: {} } }),
    batch([], [], { tasks: { backlog: [] } }),
    batch([], [], { taskCatalogue: [cooked] }),
    { type: 'sync-original', capturedAt, sourceHash, members: [
      { memberId: 'player1', sourceMapId: 'qxa', groups: ['tasks'], tasks: { complete: [cooked.id], backlog: [] } },
      { memberId: 'player2', sourceMapId: 'qxb', groups: ['tasks'], tasks: { complete: ['rs3:task:test:unknown'], backlog: [] } },
    ] },
  ];
  // Supplying undefined to the helper takes its default; delete explicitly.
  delete invalid[0].members[0].tasks.complete;
  for (const path of [applyCommand, applyValidatedCommand]) for (const payload of invalid) {
    assert.throws(() => path(state, payload, { taskCatalogue: catalogue, now: () => { throw Error('Rejected task batch requested time'); } }), TypeError);
    assert.equal(JSON.stringify(state), before);
  }
});

test('malformed original check/backlog structures reject before creating any task proposal', () => {
  const state = freeze(group()), before = JSON.stringify(state);
  const invalid = [
    { checkedAllTasks: [] }, { checkedChallenges: { Cooking: [] } }, { completedChallenges: { Cooking: { t_cooked: 'true' } } },
    { checkedAllTasks: { Cooking: { t_cooked: 1 } } }, { backlog: [] }, { backlog: { Cooking: { t_backlog: false } } },
    { backlog: { Cooking: { t_backlog: {} } } },
  ];
  for (const chunkinfo of invalid) assert.throws(() => review(state, chunkinfo), /unexpected data/);
  assert.equal(JSON.stringify(state), before);
});
