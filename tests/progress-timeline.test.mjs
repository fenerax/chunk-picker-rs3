import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState, previewRestore } from '../app/core/state.mjs';
import { progressCounts, buildProgressModel, captureProgressSnapshot, MAX_PROGRESS_DAYS } from '../app/core/progress-timeline.mjs';
import { progressSeries } from '../app/web/helper-progress-model.mjs';
import { createProgressQuestPoints } from '../app/helper-progress.mjs';
import { playerControlSkills } from '../app/core/player-controls.mjs';
import { permanentTaskId, legacyTaskId, generatedGoalId } from '../app/tasks/identity.mjs';
import { openStore } from '../app/storage/store.mjs';

const start = '2026-10-12T12:00:00.000Z';
const questPoints = new Map([['quest', 5]]);
function fixture() {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.members[0].runescapeName = 'DemoExplorer'; state.members[1].runescapeName = 'SecondActor1';
  state.tasks = [{ id: 'quest', category: 'Quest', label: 'Quest' }, { id: 'task', category: 'Mining', label: 'Task' }];
  return state;
}
const counts = state => progressCounts(state, { questPoints });
function observation(member, level = 30, at = start) {
  member.skillProgress = Object.fromEntries(playerControlSkills.map(skill => [skill, { level, xp: 1000, fetchedAt: at, source: 'runemetrics', runescapeName: member.runescapeName }]));
}
function questObservation(member, current = 0, at = start) {
  member.questPointProgress = { current, max: 450, fetchedAt: at, source: 'platform-api', runescapeName: member.runescapeName };
}
function command(state, payload, seconds) {
  return applyCommand(state, payload, { now: () => new Date(Date.parse(start) + seconds * 1000) });
}



test('whole-quest index excludes steps, rewards and mystery rows but retains zero-point miniquests', () => {
  const definitions = { challenges: { Quest: {
    '~|Cook\'s Assistant|~ Complete the quest': { QuestPoints: 1 },
    'Reward': { BaseQuest: "Cook's Assistant", QuestPoints: 5 },
    'Archaeology Mystery: Example': { QuestPoints: 4 },
    '~|Example|~ Reach the door': { QuestPoints: 8 },
    '~|Witch\'s Potion|~ Complete the miniquest': { QuestPoints: 0 },
  } } };
  const index = createProgressQuestPoints(definitions);
  assert.equal(index.size, 2); assert.deepEqual([...index.values()].sort(), [0, 1]);
});

test('history reconstructs selective undo, redo-like checks and net sync changes exactly without mutating save', () => {
  let state = fixture();
  const saved = [];
  state = command(state, { type: 'complete-task', memberId: 'actor1', taskId: 'quest', completed: true }, 1); saved.push(counts(state));
  state = command(state, { type: 'set-task-status', memberId: 'reed', taskId: 'task', challengeCompleted: true }, 2); saved.push(counts(state));
  state = command(state, { type: 'undo', undoRevision: 1 }, 3); saved.push(counts(state));
  state = command(state, { type: 'complete-task', memberId: 'actor1', taskId: 'quest', completed: true }, 4); saved.push(counts(state));
  const original = structuredClone(state), model = buildProgressModel(state, { questPoints, now: start });
  assert.equal(model.history.boundary, null);
  assert.equal(model.history.points[0].type, 'baseline');
  assert.equal(model.history.points[0].at, model.history.points[1].at);
  assert.equal(model.history.points[0].duo.metrics.completedTasks, 0);
  assert.deepEqual(model.history.points.slice(1).map(({ members, duo }) => ({ members, duo })), saved);
  assert.deepEqual(state, original);
});

test('history respects restore boundary, missing dates, retention and incomplete reversible evidence', () => {
  let state = fixture();
  state = command(state, { type: 'complete-task', memberId: 'actor1', taskId: 'quest', completed: true }, 1);
  state = command(state, { type: 'set-task-status', memberId: 'reed', taskId: 'task', challengeCompleted: true }, 2);
  state.history[0].at = 'unknown';
  let model = buildProgressModel(state, { questPoints });
  assert.equal(model.history.undatedEntries, 1); assert.equal(model.history.points.length, 1);
  assert.match(model.history.boundary.reason, /date/, 'Undated changes must never be assigned to a later dated week');
  state.history[1].type = 'restore';
  model = buildProgressModel(state, { questPoints });
  assert.equal(model.history.points.length, 1); assert.match(model.history.boundary.reason, /boundary/);
  state.history[1].type = 'old-import'; delete state.history[1].undo;
  assert.match(buildProgressModel(state).history.boundary.reason, /evidence/);
  state.provenance = { historyArchive: [{}] };
  assert.equal(buildProgressModel(state).history.limited, true);
});


test('restore validation rejects oversized, malformed, inconsistent or unsafe snapshot payloads', () => {
  const state = captureProgressSnapshot(fixture(), { questPoints, at: start });
  for (const mutate of [
    value => { value.extra = 'data'; },
    value => { value.memberIds.reverse(); },
    value => { value.days.push(value.days[0]); },
    value => { value.days[0][2][0][0] = -1; },
    value => { value.days[0][2][0][3] = '818'; },
    value => { value.days[0][0]++; },
    value => { value.days[0][3][2] = 99; },
    value => { value.days[0][4] = 2; },
    value => { value.days[0][4] = '1'; },
    value => { value.days[0].push(1); },
    value => { value.days = Array(MAX_PROGRESS_DAYS + 1).fill(value.days[0]); },
  ]) {
    const bad = structuredClone(state); mutate(bad.progressSnapshots);
    assert.throws(() => validateState(bad), /Progress snapshots/);
  }
});


test('normal store startup/save/restore lifecycle preserves daily counts without startup revisions or history', async t => {
  const parent = path.resolve('.local/progress-tests'); await mkdir(parent, { recursive: true });
  const dataDir = await mkdtemp(path.join(parent, 'store-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  let time = start;
  let store = await openStore({ dataDir, initialState: fixture(), now: () => time, progressQuestPoints: questPoints, retention: false });
  const initial = store.getState(); assert.equal(initial.revision, 0); assert.deepEqual(initial.history, []);
  time = '2026-10-12T13:00:00.000Z';
  await store.command({ type: 'complete-task', memberId: 'actor1', taskId: 'quest', completed: true }, 0);
  const backup = await store.backup(); assert.equal(backup.state.progressSnapshots.days.length, 1); assert.equal(backup.state.progressSnapshots.days[0][3][2], null);
  await store.close();
  time = '2026-10-13T00:00:00.000Z';
  store = await openStore({ dataDir, now: () => time, progressQuestPoints: questPoints, retention: false });
  t.after(() => store.close());
  const loaded = store.getState(); assert.equal(loaded.revision, 1); assert.equal(loaded.history.length, 1); assert.equal(loaded.progressSnapshots.days.length, 2);
  assert.equal(store.getCalculationState().progressSnapshots, undefined);
  await store.replace(backup, 1);
  const restored = store.getState(); assert.equal(restored.revision, 2); assert.equal(restored.history[0].type, 'restore'); assert.equal(restored.progressSnapshots.days.length, 2);
  assert.equal(store.getProgress().stateRevision, 2);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'state.json'), 'utf8')).state.revision, 2);
});




test('restore preview makes daily observation replacement visible', () => {
  const observed = captureProgressSnapshot(fixture(), { questPoints, at: start });
  assert.ok(previewRestore(observed, fixture()).warnings.some(warning => /daily progress counts/.test(warning)));
});



test('startup rejects mismatched snapshot roster before changing the saved state', async t => {
  const parent = path.resolve('.local/progress-tests'); await mkdir(parent, { recursive: true });
  const dataDir = await mkdtemp(path.join(parent, 'roster-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const state = captureProgressSnapshot(fixture(), { questPoints, at: start });
  const store = await openStore({ dataDir, initialState: state, retention: false }); await store.close();
  const file = path.join(dataDir, 'state.json'), document = JSON.parse(await readFile(file, 'utf8'));
  document.state.members.reverse(); const bytes = JSON.stringify(document); await writeFile(file, bytes);
  await assert.rejects(openStore({ dataDir, progressQuestPoints: questPoints, now: () => start, retention: false }), /Progress snapshots member IDs/);
  assert.equal(await readFile(file, 'utf8'), bytes);
});

test('a changed roster starts a new snapshot series instead of blocking saves', () => {
  const state = captureProgressSnapshot(fixture(), { questPoints, at: start });
  const reordered = { ...state, members: [...state.members].reverse() };
  const next = captureProgressSnapshot(reordered, { questPoints, at: '2026-10-12T12:00:00.000Z' });
  assert.deepEqual(next.progressSnapshots.memberIds, reordered.members.map(member => member.id));
  assert.equal(next.progressSnapshots.days.length, 1);
  assert.equal(next.progressSnapshots.truncated, true);
});

test('legacy daily quest-award sums stay portable without becoming an observed gameplay gain', () => {
  let state = captureProgressSnapshot(fixture(), { questPoints, at: '2026-10-11T12:00:00.000Z' });
  const legacy = state.progressSnapshots.days[0];
  legacy.length = 4;
  legacy[2][0][2] = 5; legacy[2][1][2] = 0; legacy[3][2] = 5;
  state = command(state, { type: 'apply-runemetrics', source: 'platform-api', memberId: 'actor1',
    runescapeName: state.members[0].runescapeName, fetchedAt: start, skills: [], quests: [], questPoints: { current: 42, max: 450 } }, 1);
  state = captureProgressSnapshot(state, { at: '2026-10-12T13:00:00.000Z' });
  const model = buildProgressModel(state, { now: '2026-10-12T13:00:00.000Z' });
  assert.equal(model.daily.points[0].members[0].metrics.questPoints, null);
  assert.equal(model.daily.points[1].members[0].metrics.questPoints, 42);
  assert.equal(progressSeries(model, 'actor1').thisWeek.questPoints, null, 'First observation is a baseline, never a 37-point gain');
  assert.equal(state.progressSnapshots.days[0][2][0][2], 5, 'Original portable daily evidence is preserved');
  assert.deepEqual(importBackup(exportBackup(state)), state);
});

test('safe-integer quest-point observations survive snapshots and overflowing combined totals remain unknown', () => {
  const state = fixture();
  for (const member of state.members) {
    questObservation(member, Number.MAX_SAFE_INTEGER);
    member.questPointProgress.max = Number.MAX_SAFE_INTEGER;
  }
  const captured = captureProgressSnapshot(state, { at: start });
  assert.equal(counts(captured).members[0].metrics.questPoints, Number.MAX_SAFE_INTEGER);
  assert.equal(counts(captured).duo.metrics.questPoints, null);
  assert.deepEqual(importBackup(exportBackup(captured)), captured);
});

test('authoritative daily quest points survive History archival and current-account changes', () => {
  let state = fixture();
  for (const [day, current] of [[12, 17], [13, 22]]) {
    const at = `2026-10-${day}T12:00:00.000Z`;
    state = applyCommand(state, { type: 'apply-runemetrics', source: 'platform-api', memberId: 'actor1',
      runescapeName: state.members[0].runescapeName, fetchedAt: at, skills: [], quests: [], questPoints: { current, max: 450 } }, { now: () => at });
    state = captureProgressSnapshot(state, { at });
  }
  state.history = [];
  state.members[0].runescapeName = 'New account';
  state = importBackup(exportBackup(state));
  const model = buildProgressModel(state);
  assert.equal(model.current.members[0].metrics.questPoints, null, 'Current totals remain bound to the current account');
  assert.deepEqual(model.daily.points.map(point => point.members[0].metrics.questPoints), [17, 22]);
  assert.ok(state.progressSnapshots.days.every(row => row.length === 5 && row[4] === 1));
  delete state.members[0].questPointProgress;
  assert.deepEqual(buildProgressModel(state).daily.points.map(point => point.members[0].metrics.questPoints), [17, 22]);
});

test('only a fresh current-day snapshot replaces legacy provenance, even when counts match', () => {
  let state = fixture(); questObservation(state.members[0], 17);
  state = captureProgressSnapshot(state, { at: start });
  state.progressSnapshots.days[0].length = 4;
  const legacy = structuredClone(state);
  const replaced = captureProgressSnapshot(state, { at: start });
  assert.equal(replaced.progressSnapshots.days[0][4], 1);
  assert.equal(legacy.progressSnapshots.days[0].length, 4);
  assert.equal(buildProgressModel(legacy).daily.points[0].members[0].metrics.questPoints, null);
  assert.equal(buildProgressModel(replaced).daily.points[0].members[0].metrics.questPoints, 17);
});


test('Progress requires account QP, ignores challenge awards and rewinds QP with sync undo', () => {
  let state = fixture(); state.members[0].completedTasks = ['quest'];
  assert.equal(counts(state).members[0].metrics.questPoints, null);
  state = command(state, { type: 'apply-runemetrics', source: 'platform-api', memberId: 'actor1',
    runescapeName: state.members[0].runescapeName, fetchedAt: start, skills: [], quests: [], questPoints: { current: 17, max: 450 } }, 1);
  assert.equal(counts(state).members[0].metrics.questPoints, 17);
  assert.equal(buildProgressModel(state).datedRecords.find(row => row.kind === 'quest').metrics.questPoints, 17);
  assert.deepEqual(buildProgressModel(state).history.points.map(point => point.members[0].metrics.questPoints), [null, 17]);
  const undo = command(state, { type: 'undo' }, 2);
  assert.deepEqual(buildProgressModel(undo).history.points.map(point => point.members[0].metrics.questPoints), [null, 17, null]);
});
