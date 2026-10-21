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
  const state = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
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

test('personal and duo counts deduplicate chunks, explicit checks, aliases and Every Drop item families', () => {
  const state = fixture(), raw = "~|Cook's Assistant|~ Complete the quest", canonical = permanentTaskId('Quest', raw), alias = legacyTaskId('Quest', raw);
  const first = generatedGoalId('every-drop', 'rs3:entity:source1', 'rs3:entity:item'), second = generatedGoalId('every-drop', 'rs3:entity:source2', 'rs3:entity:item');
  state.members[0].unlocked = ['100', '101']; state.members[1].unlocked = ['101', '102'];
  state.members[0].completedTasks = ['quest', canonical, alias, first];
  state.members[0].taskStatus = { quest: { challengeCompleted: true }, task: { challengeCompleted: true } };
  state.members[1].completedTasks = ['quest', second];
  state.members[1].taskStatus = { task: { challengeCompleted: true } };
  observation(state.members[0]); observation(state.members[1], 40);
  const result = counts(state);
  assert.deepEqual(result.members.map(member => member.metrics.completedTasks), [4, 3]);
  assert.equal(result.duo.metrics.completedTasks, 4);
  assert.equal(result.duo.metrics.unlockedChunks, 3);
  assert.equal(result.duo.metrics.questPoints, 10, 'Per-account quest points sum even when quest task overlaps');
  assert.equal(result.duo.metrics.totalLevel, 29 * 70);
  assert.equal(result.duo.metrics.combatLevel, result.members[0].metrics.combatLevel + result.members[1].metrics.combatLevel);
  state.members[0].completedTasks = []; assert.equal(counts(state).members[0].metrics.questPoints, 0, 'Challenge checks award no points');
});

test('unknown or renamed observations never manufacture account totals', () => {
  const state = fixture(); observation(state.members[0]); delete state.members[0].skillProgress.Invention;
  assert.equal(counts(state).members[0].metrics.totalLevel, null);
  assert.ok(counts(state).members[0].metrics.combatLevel > 1);
  delete state.members[0].skillProgress.Prayer;
  assert.equal(counts(state).members[0].metrics.combatLevel, null);
  state.members[0].runescapeName = 'New account';
  assert.equal(counts(state).members[0].metrics.totalLevel, null);
  assert.equal(counts(state).duo.metrics.totalLevel, null);
});

test('daily tuples upsert, retain unchanged revision/history, bound dates, and survive portable backup', () => {
  const state = fixture(); observation(state.members[0]); observation(state.members[1]);
  let captured = captureProgressSnapshot(state, { questPoints, at: start });
  assert.equal(captureProgressSnapshot(captured, { questPoints, at: '2026-10-12T12:30:00.000Z' }), captured, 'Unchanged same-day counts need no write or new timestamp');
  const previous = structuredClone(captured);
  captured.members[0].completedTasks.push('quest');
  captured = captureProgressSnapshot(captured, { questPoints, at: '2026-10-12T15:00:00.000Z' });
  assert.equal(captured.progressSnapshots.days.length, 1); assert.equal(captured.progressSnapshots.days[0][3][2], 5);
  assert.equal(previous.progressSnapshots.days[0][3][2], 0);
  captured = captureProgressSnapshot(captured, { questPoints, at: '2026-10-13T00:00:00.000Z' });
  assert.equal(captured.progressSnapshots.days.length, 2); assert.equal(captured.revision, 0); assert.deepEqual(captured.history, []);
  assert.deepEqual(importBackup(exportBackup(captured)), captured);
  assert.equal(captureProgressSnapshot(captured, { questPoints, at: '2026-10-12T14:00:00.000Z' }), captured, 'Older same-day observation cannot overwrite latest');
  const snapshot = captured.progressSnapshots, day = snapshot.days[0][0], template = snapshot.days[0];
  snapshot.days = Array.from({ length: MAX_PROGRESS_DAYS }, (_, index) => [day + index, (day + index) * 86400000, structuredClone(template[2]), [...template[3]]]);
  captured = captureProgressSnapshot(captured, { questPoints, at: new Date((day + MAX_PROGRESS_DAYS) * 86400000).toISOString() });
  assert.equal(captured.progressSnapshots.days.length, MAX_PROGRESS_DAYS); assert.equal(captured.progressSnapshots.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(captured.progressSnapshots)) < 400000, 'Ten years of duo counts remain compact');
});

test('trustworthy dated records use saved observation timestamps, never completion play dates', () => {
  const state = fixture(); observation(state.members[0]); state.members[0].completedTasks = ['quest'];
  state.members[0].questProgress = { quest: { title: 'Quest', source: 'runemetrics', fetchedAt: start, runescapeName: state.members[0].runescapeName } };
  let records = buildProgressModel(state, { questPoints }).datedRecords;
  assert.equal(records.length, 2); assert.ok(records.every(record => record.at === start));
  assert.match(records.find(record => record.kind === 'quest').label, /observation/);
  state.members[0].skillProgress.Attack.fetchedAt = '2026-10-13T00:00:00.000Z';
  records = buildProgressModel(state, { questPoints }).datedRecords;
  assert.equal(records.filter(record => record.kind === 'skills').length, 0, 'Mixed-time totals must not get a fabricated observation date');
});

test('RuneMetrics history records net saved changes at sync time and reconstructs prior skill absence', () => {
  let state = fixture();
  const syncedAt = '2026-10-04T12:00:00.000Z';
  state = command(state, { type: 'apply-runemetrics', memberId: 'player1', runescapeName: state.members[0].runescapeName, fetchedAt: syncedAt,
    skills: playerControlSkills.map(skill => ({ skill, level: 20, xp: 1000 })), quests: [{ taskId: 'quest', title: 'Quest' }] }, 1);
  const model = buildProgressModel(state, { questPoints });
  assert.equal(model.history.points[0].members[0].metrics.totalLevel, null);
  assert.equal(model.history.points[1].members[0].metrics.totalLevel, 580);
  assert.equal(model.history.points[1].at, '2026-10-12T12:00:01.000Z');
  assert.ok(model.datedRecords.every(record => record.at === syncedAt));
  const undone = command(state, { type: 'undo' }, 2);
  const timeline = buildProgressModel(undone, { questPoints });
  assert.deepEqual(timeline.history.points.map(point => point.members[0].metrics.totalLevel), [null, 580, null]);
});

test('rule undo reconstructs prior F2P combat semantics and full-snapshot undo stops explicitly', () => {
  let state = fixture(); observation(state.members[0], 80); observation(state.members[1], 80);
  state = command(state, { type: 'set-rule', ruleId: 'content.f2p', value: false }, 1);
  const memberCombat = counts(state).members[0].metrics.combatLevel;
  state = command(state, { type: 'undo' }, 2);
  const model = buildProgressModel(state, { questPoints });
  assert.equal(model.history.boundary, null); assert.equal(model.history.points[1].members[0].metrics.combatLevel, memberCombat);
  state.history[0].undo = { members: [fixture().members[0]] };
  assert.match(buildProgressModel(state, { questPoints }).history.boundary.reason, /after-values/);
});

test('a newly observed quest batch never masquerades as the account quest-point total', () => {
  const state = fixture(), points = new Map([['quest', 12], ['new-quest', 1]]);
  const member = state.members[0]; member.completedTasks = ['quest', 'new-quest'];
  member.questProgress = { 'new-quest': { title: 'New quest', source: 'runemetrics', fetchedAt: start, runescapeName: member.runescapeName } };
  const model = buildProgressModel(state, { questPoints: points });
  assert.equal(model.current.members[0].metrics.questPoints, 13);
  assert.equal(model.datedRecords.filter(record => record.kind === 'quest').length, 0, 'One observed point is not the known 13-point total');
  member.questProgress.quest = { title: 'Prior quest', source: 'runemetrics', fetchedAt: start, runescapeName: member.runescapeName };
  assert.equal(buildProgressModel(state, { questPoints: points }).datedRecords[0].metrics.questPoints, 13);
  member.questProgress.quest.fetchedAt = '2026-10-11T12:00:00.000Z';
  assert.equal(buildProgressModel(state, { questPoints: points }).datedRecords.length, 0, 'Mixed-time partial batches are not cumulative total observations');
});

