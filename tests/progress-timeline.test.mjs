import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState, previewRestore } from '../app/core/state.mjs';
import { progressCounts, buildProgressModel, captureProgressSnapshot, MAX_PROGRESS_DAYS } from '../app/core/progress-timeline.mjs';
import { createProgressQuestPoints } from '../app/helper-progress.mjs';
import { playerControlSkills } from '../app/core/player-controls.mjs';
import { permanentTaskId, legacyTaskId, generatedGoalId } from '../app/tasks/identity.mjs';
import { openStore } from '../app/storage/store.mjs';

const start = '2026-10-12T12:00:00.000Z';
const questPoints = new Map([['quest', 5]]);
function fixture() {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.tasks = [{ id: 'quest', category: 'Quest', label: 'Quest' }, { id: 'task', category: 'Mining', label: 'Task' }];
  return state;
}
const counts = state => progressCounts(state, { questPoints });
function observation(member, level = 30, at = start) {
  member.skillProgress = Object.fromEntries(playerControlSkills.map(skill => [skill, { level, xp: 1000, fetchedAt: at, source: 'runemetrics', runescapeName: member.runescapeName }]));
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
  const backup = await store.backup(); assert.equal(backup.state.progressSnapshots.days.length, 1); assert.equal(backup.state.progressSnapshots.days[0][3][2], 5);
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
