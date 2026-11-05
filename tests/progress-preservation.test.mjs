import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, validateState, exportBackup, importBackup } from '../app/core/state.mjs';
import { captureProgressSnapshot, buildProgressModel } from '../app/core/progress-timeline.mjs';
import { openStore } from '../app/storage/store.mjs';
import { progressSeries, progressQuestPointLabel } from '../app/web/helper-progress-model.mjs';

const at = '2026-11-04T12:00:00.000Z', later = '2026-11-04T13:00:00.000Z';
const questPoints = new Map([['first-quest', 13], ['second-quest', 5]]);
function legacySave() {
  const state = createGroupState([{ id: 'one', name: 'First', runescapeName: 'SyntheticOne' },
    { id: 'two', name: 'Second', runescapeName: 'SyntheticTwo' }]);
  state.tasks = [{ id: 'first-quest', category: 'Quest', label: 'First quest' }, { id: 'second-quest', category: 'Quest', label: 'Second quest' }];
  state.members[0].completedTasks = ['first-quest']; state.members[1].completedTasks = ['second-quest'];
  state.progressSnapshots = { schemaVersion: 1, memberIds: ['one', 'two'], truncated: false,
    days: [[Math.floor(Date.parse(at) / 86400000), Date.parse(at), [[0, 1, 13, 800, 78], [0, 1, 5, 900, 80]], [0, 2, 18, 1700, 158]]] };
  return state;
}
function observe(state, values = [17, 7]) {
  state.members.forEach((member, index) => { member.questPointProgress = { current: values[index], max: 450,
    source: 'platform-api', runescapeName: member.runescapeName, fetchedAt: later }; });
  return state;
}

test('old saves load and round-trip unchanged, including 13 / 5 QP and duo 18', () => {
  const state = legacySave(), before = structuredClone(state);
  assert.deepEqual(validateState(state), before);
  assert.deepEqual(importBackup(exportBackup(state)), before);
  assert.equal(captureProgressSnapshot(state, { questPoints, at: later }), state);
  assert.deepEqual(state, before);
});

test('unknown daily metrics cannot overwrite known member or duo values', () => {
  const state = legacySave();
  assert.equal(captureProgressSnapshot(state, { at: later }), state, 'Missing dataset and account observations preserve every tuple value');
  const updated = { ...state, members: structuredClone(state.members) };
  updated.members[0].unlocked.push('12850');
  const next = captureProgressSnapshot(updated, { at: later });
  assert.deepEqual(next.progressSnapshots.days[0][2].map(row => row.slice(2)), [[13, 800, 78], [5, 900, 80]]);
  assert.deepEqual(next.progressSnapshots.days[0][3].slice(2), [18, 1700, 158]);
});

test('same-day upgrade and restart leave persisted tuples, revision and History identical without an observation', async t => {
  const parent = path.resolve('.local/progress-tests'); await mkdir(parent, { recursive: true });
  const dataDir = await mkdtemp(path.join(parent, 'qp-upgrade-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const original = legacySave();
  let store = await openStore({ dataDir, initialState: original, now: () => at, retention: false });
  await store.close();
  const file = path.join(dataDir, 'state.json'), bytes = await readFile(file, 'utf8');
  // A different or missing quest index must not reduce saved progress at startup.
  for (const points of [questPoints, new Map(), undefined]) {
    store = await openStore({ dataDir, now: () => later, progressQuestPoints: points, retention: false });
    try {
      assert.deepEqual(store.getState().progressSnapshots, original.progressSnapshots);
      assert.equal(store.getState().revision, 0); assert.deepEqual(store.getState().history, []);
      assert.equal(await readFile(file, 'utf8'), bytes);
      assert.deepEqual((await store.backup()).state.progressSnapshots, original.progressSnapshots);
    } finally { await store.close(); }
  }
});

test('later authoritative observations fill separate daily fields without erasing estimates, including duo and backup', () => {
  const original = legacySave(), state = observe(structuredClone(original));
  const next = captureProgressSnapshot(state, { at: later });
  assert.deepEqual(next.progressSnapshots, original.progressSnapshots);
  assert.deepEqual(next.provenance.progressQuestPoints.days[0].slice(2), [[17, 7], 24]);
  assert.deepEqual(importBackup(exportBackup(next)), next);
  assert.deepEqual(next.progressSnapshots.days[0][2].map(row => row[2]), [13, 5]);
  assert.equal(next.progressSnapshots.days[0][3][2], 18);
  assert.equal(captureProgressSnapshot(next, { at: later, startup: true }), next);
  for (const member of next.members) delete member.questPointProgress;
  assert.equal(captureProgressSnapshot(next, { at: later }), next, 'Unknown account totals cannot erase saved authoritative observations');
  assert.deepEqual(buildProgressModel(next).daily.points[0].members.map(row => row.metrics.questPoints), [17, 7]);
  assert.equal(buildProgressModel(next).daily.points[0].duo.metrics.questPoints, 24);
});

test('same-day startup can add authoritative QP without changing the legacy tuple', () => {
  const state = observe(legacySave()), before = structuredClone(state.progressSnapshots);
  const next = captureProgressSnapshot(state, { questPoints: new Map(), at: later, startup: true });
  assert.deepEqual(next.progressSnapshots, before);
  assert.deepEqual(next.provenance.progressQuestPoints.days[0].slice(2), [[17, 7], 24]);
});

test('Progress prefers authoritative totals, otherwise shows the last saved estimate, including duo and older graphs', () => {
  const state = legacySave(), before = structuredClone(state);
  const model = buildProgressModel(state, { questPoints: new Map(), now: later });
  assert.deepEqual(state, before, 'Viewing Progress never migrates or changes a save');
  assert.deepEqual(model.current.members.map(row => progressQuestPointLabel(row.metrics)), ['13 (estimate)', '5 (estimate)']);
  assert.equal(progressQuestPointLabel(model.current.duo.metrics), '18 (estimate)');
  for (const [scope, value] of [['one', 13], ['two', 5], ['duo', 18]]) {
    assert.deepEqual(progressSeries(model, scope).questPoints[0], { at, value, source: 'estimate' });
  }
  const authoritative = buildProgressModel(observe(state, [0, 7]), { now: later });
  assert.equal(progressQuestPointLabel(authoritative.current.members[0].metrics), '0 (authoritative)');
  assert.equal(progressQuestPointLabel(authoritative.current.duo.metrics), '7 (authoritative)');
  assert.equal(progressSeries(authoritative, 'duo').thisWeek.questPoints, null, 'Switching source cannot become an earned-QP delta');
  assert.equal(progressQuestPointLabel(buildProgressModel(createGroupState([{ id: 'empty', name: 'Empty' }])).current.members[0].metrics), 'Not recorded');
});

test('authoritative daily fields reject malformed counts and inconsistent duo totals in backups', () => {
  const state = captureProgressSnapshot(observe(legacySave()), { at: later });
  for (const mutate of [
    value => { value.days[0][2][0] = -1; },
    value => { value.days[0][3] = 25; },
    value => { value.days[0][2].pop(); },
    value => { value.days[0][0]++; },
    value => { value.extra = true; },
  ]) {
    const bad = structuredClone(state); mutate(bad.provenance.progressQuestPoints);
    assert.throws(() => importBackup(exportBackup(bad)), /Progress snapshots quest points/);
  }
});
