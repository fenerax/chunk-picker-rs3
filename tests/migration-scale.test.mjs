import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';
import { legacyTaskId, migrateGameplay, resolveSavedTaskId } from '../app/tasks/migration.mjs';

const PAIRS = 4_000;
const HISTORY_EVENTS = 2_000;
const WORKER_ARGUMENT = '--synthetic-migration-scale-worker';

// Every value is generated here. No saved gameplay, private store, or captured
// legacy map is read to construct this fixture.
function syntheticUpgrade() {
  const state = createGroupState([
    { id: 'synthetic-a', name: 'Synthetic A', sourceMapId: 'synthetic-map-a' },
    { id: 'synthetic-b', name: 'Synthetic B', sourceMapId: 'synthetic-map-b' },
  ]);
  const catalogue = [], taskMap = {};
  state.legacy = { maps: {} };
  for (const member of state.members) {
    member.taskStatus = {};
    member.taskAlternatives = {};
    const map = { rules: {}, chunkinfo: { completedChallenges: {}, checkedAllTasks: {},
      backlog: {}, favoriteTasks: {}, altChallenges: {}, manualSections: {},
      backloggedSources: { objects: {} } }, chunks: { stickeredNotes: {} } };
    for (let i = 0; i < 256; i++) map.rules[`Synthetic-_-20rule-_-20${i}`] = i % 2 === 0;
    for (let i = 0; i < 128; i++) {
      map.chunkinfo.manualSections[`*fb*_${20_000 + i}`] = { '*fb*_0': false, '*fb*_1': true };
      map.chunks.stickeredNotes[`*fb*_${20_000 + i}`] = `Synthetic-_-20note-_-20${i}`;
      map.chunkinfo.backloggedSources.objects[`Synthetic-_-20object-_-20${i}`] = true;
    }
    state.legacy.maps[member.sourceMapId] = map;
  }
  for (let i = 0; i < PAIRS; i++) {
    const category = `Synthetic category ${i % 8}`;
    const rawLabel = `Synthetic objective ${i}`;
    const oldId = legacyTaskId(category, rawLabel);
    const id = `rs3:task:synthetic-scale:${i}`;
    catalogue.push({ id, label: `Current synthetic objective ${i}`, rawLabel, category,
      kind: 'task', aliases: [oldId] });
    state.tasks.push({ id: oldId, label: `Saved synthetic objective ${i}`, category });
    taskMap[rawLabel] = `t_synthetic_${i}`;
    for (const member of state.members) {
      member.taskStatus[oldId] = { challengeCompleted: true, favorite: true,
        note: `${member.id}: authored note ${i}` };
      // Explicit false and empty values must mask the imported alias values.
      if (i % 3 === 0) member.taskStatus[id] = { challengeCompleted: false,
        favorite: false, backlogged: false, note: '' };
      if (i % 4 === 0) member.completedTasks.push(oldId);
      if (i % 8 === 0) member.completedTasks.push(id);
      const chunkinfo = state.legacy.maps[member.sourceMapId].chunkinfo;
      for (const source of ['completedChallenges', 'checkedAllTasks', 'backlog', 'favoriteTasks']) {
        chunkinfo[source][category] ??= {};
        chunkinfo[source][category][`t_synthetic_${i}`] = source === 'backlog'
          ? `Imported-_-20note-_-20${i}` : true;
      }
      if (i % 100 === 0) {
        member.taskAlternatives[category] ??= {};
        member.taskAlternatives[category][String(i)] = oldId;
        chunkinfo.altChallenges[category] ??= {};
        chunkinfo.altChallenges[category][`imported-${i}`] = `t_synthetic_${i}`;
      }
    }
  }
  state.members[0].taskStatus.t_synthetic_unknown_status = { note: 'Keep unresolved authored evidence', favorite: true };
  state.members[0].completedTasks.push('t_synthetic_unknown_completion');
  state.identityRegistry = { schemaVersion: 1, entries: {},
    aliases: { 'synthetic-orphan-alias': 'rs3:task:synthetic-missing-target' }, unresolved: [] };
  for (const member of state.members) {
    const map = state.legacy.maps[member.sourceMapId];
    map.chunkinfo.completedChallenges.Unknown = { t_synthetic_unknown_check: false };
    map.chunkinfo.backlog.Unknown = { t_synthetic_unknown_backlog: 'Retain-_-20unknown-_-20backlog' };
  }
  state.revision = HISTORY_EVENTS;
  for (let i = 0; i < HISTORY_EVENTS; i++) {
    const oldId = state.tasks[i].id;
    state.history.push({ id: `revision-${i + 1}`, revision: i + 1, type: 'set-task-status',
      at: '2026-01-01T00:00:00.000Z',
      command: { type: 'set-task-status', memberId: 'synthetic-a', taskId: oldId, favorite: true },
      undo: { memberChanges: [{ id: 'synthetic-a', changes: [{ path: ['taskStatus', oldId],
        kind: 'value', before: { exists: false }, after: { exists: true, value: { favorite: true } } }] }] } });
  }
  return { state, options: { catalogue, taskMap } };
}

function runSyntheticUpgrade() {
  const { state: original, options } = syntheticUpgrade();
  const snapshot = structuredClone(original);
  const originalFilter = Array.prototype.filter;
  let catalogueFilterVisits = 0;
  // Count predicate visits, not elapsed CPU time. The preceding implementation
  // filtered/resolved the entire task array for EACH colliding canonical row.
  // Permit several complete scans, but reject the quadratic regression early.
  Array.prototype.filter = function (predicate, thisArg) {
    if (this.length >= PAIRS && this[0]?.id && typeof this[0]?.label === 'string'
      && typeof this[0]?.category === 'string') {
      return originalFilter.call(this, (value, index, array) => {
        assert(++catalogueFilterVisits <= PAIRS * 8,
          'Migration repeatedly scans the whole catalogue while merging identity collisions');
        return predicate.call(thisArg, value, index, array);
      });
    }
    return originalFilter.call(this, predicate, thisArg);
  };
  const started = performance.now();
  let result;
  try {
    result = migrateGameplay(original, options);
  } finally {
    Array.prototype.filter = originalFilter;
  }
  const elapsedMs = performance.now() - started;
  const { state, report, warnings } = result;
  assert.deepEqual(original, snapshot, 'Migration must not mutate its input');
  assert.deepEqual(state.legacy.maps, snapshot.legacy.maps, 'Both exact imported maps must survive');
  assert.equal(report.catalogueTasks, PAIRS * 2, 'Gameplay upgrade must exercise old/new row collisions');
  assert.equal(report.identities.lostRecords, 0);
  assert.equal(report.identities.recordsBefore,
    report.identities.recordsPreservedInActiveState + report.identities.recordsPreservedInArchives);
  assert(report.identities.recordsPreservedInArchives > 0, 'Overridden alias fields need retained originals');
  const archive = state.provenance.taskIdentityMigration.archives[0];
  assert.deepEqual(archive.tasks.slice(0, PAIRS), snapshot.tasks);
  assert.deepEqual(archive.tasks.slice(PAIRS), options.catalogue);
  assert.deepEqual(archive.history, snapshot.history, 'Long original undo history must remain exact');
  assert.deepEqual(archive.identityRegistry, snapshot.identityRegistry);
  assert.equal(archive.members.length, 2);
  assert.deepEqual(state.history, [], 'Colliding rows must establish the documented undo boundary');
  assert(warnings.some(warning => warning.includes('Undo now starts after this import')));
  const tasks = new Map(state.tasks.map(task => [task.id, task]));
  assert.equal(tasks.size, state.tasks.length, 'Canonical rows must have unique IDs');
  assert.equal(tasks.size, PAIRS + 2, 'All canonical objectives and both unresolved authored objectives must remain');
  for (let i = 0; i < PAIRS; i++) {
    const current = options.catalogue[i], oldId = snapshot.tasks[i].id;
    assert.deepEqual(tasks.get(current.id), { id: current.id, label: current.label, category: current.category });
    assert(!tasks.has(oldId));
    assert.equal(resolveSavedTaskId(state.identityRegistry, oldId), current.id);
    assert.equal(resolveSavedTaskId(state.identityRegistry, `t_synthetic_${i}`, current.category), current.id);
    for (let memberIndex = 0; memberIndex < 2; memberIndex++) {
      const member = state.members[memberIndex], before = snapshot.members[memberIndex];
      const expected = { backlogged: true, ...before.taskStatus[oldId], ...before.taskStatus[current.id] };
      assert.deepEqual(member.taskStatus[current.id], expected);
      assert.deepEqual(archive.members[memberIndex].taskStatus[oldId], { backlogged: true, ...before.taskStatus[oldId] });
      if (before.taskStatus[current.id]) assert.deepEqual(archive.members[memberIndex].taskStatus[current.id], before.taskStatus[current.id]);
      if (i % 100 === 0) {
        assert.equal(member.taskAlternatives[current.category][String(i)], current.id);
        assert.equal(member.taskAlternatives[current.category][`imported-${i}`], current.id);
      }
    }
  }
  for (let memberIndex = 0; memberIndex < 2; memberIndex++) {
    const member = state.members[memberIndex];
    assert.deepEqual(member.completedTasks,
      [...options.catalogue.filter((_, i) => i % 4 === 0).map(task => task.id),
        ...(memberIndex === 0 ? ['t_synthetic_unknown_completion'] : [])]);
    assert.equal(Object.keys(member.taskStatus).length, PAIRS + (memberIndex === 0 ? 1 : 0));
    assert.equal(Object.keys(member.taskRules).length, 256);
    assert.equal(member.taskRules['Synthetic rule 0'], true);
    assert.equal(member.taskRules['Synthetic rule 1'], false);
    assert.equal(Object.keys(member.sectionOverrides).length, 256);
    assert.equal(Object.keys(member.notes).length, 128);
    assert.equal(Object.keys(member.sourceBacklogs.objects).length, 128);
  }
  assert.deepEqual(state.members[0].taskStatus.t_synthetic_unknown_status,
    snapshot.members[0].taskStatus.t_synthetic_unknown_status);
  assert.match(tasks.get('t_synthetic_unknown_completion').label, /Unresolved task ID/);
  assert.match(tasks.get('t_synthetic_unknown_status').label, /Unresolved task ID/);
  assert.equal(state.identityRegistry.aliases['synthetic-orphan-alias'], 'rs3:task:synthetic-missing-target');
  for (const id of ['t_synthetic_unknown_completion', 't_synthetic_unknown_status', 'synthetic-orphan-alias']) {
    assert(report.identities.unresolved.some(row => row.originalId === id));
    assert(warnings.some(warning => warning.includes(id)));
  }
  for (const id of ['t_synthetic_unknown_check', 't_synthetic_unknown_backlog']) {
    assert.equal(report.unresolved.filter(row => row.legacyKey === id).length, 2);
    assert(warnings.some(warning => warning.includes(id)));
  }
  assert.deepEqual(importBackup(exportBackup(state)), state, 'Portable restore must retain active data and exact archives');
  return { pairs: PAIRS, historyEvents: HISTORY_EVENTS, elapsedMs: Math.round(elapsedMs), catalogueFilterVisits };
}

if (process.argv.includes(WORKER_ARGUMENT)) {
  process.stdout.write(JSON.stringify(runSyntheticUpgrade()));
} else {
  test('large synthetic legacy upgrade retains all facts without repeated catalogue scans', { timeout: 65_000 }, async t => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath,
      [fileURLToPath(import.meta.url), WORKER_ARGUMENT], {
        cwd: root, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, TEMP: root, TMP: root },
      });
    const measurement = JSON.parse(stdout);
    t.diagnostic(`${measurement.pairs} collision pairs, ${measurement.historyEvents} history events: ${measurement.elapsedMs} ms; ${measurement.catalogueFilterVisits} catalogue filter predicate visits`);
  });
}
