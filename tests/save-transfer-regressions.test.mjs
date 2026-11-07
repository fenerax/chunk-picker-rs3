import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGroupState, importBackup, exportBackup, previewRestore, applyCommand } from '../app/core/state.mjs';
import { mapTransferRoster, transferReport } from '../app/save-transfer.mjs';
import { migrateTaskIdentities, migrateOwnedGameplay, stripTaskMarkup } from '../app/tasks/migration.mjs';
import { openStore } from '../app/storage/store.mjs';
import { runImportJob, IMPORT_TIMEOUT_MS } from '../app/import-jobs.mjs';
import { REPORT_RECORDS, REPORT_BYTES } from '../app/import-output.mjs';
import { readBackupRequest } from '../app/backup-transfer.mjs';
import { Readable } from 'node:stream';
import { serialize } from 'node:v8';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { encodeImportBytes } from '../app/import-bytes.mjs';

const roster = [{ id: 'source', name: 'Synthetic player' }];
function largeSave() {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: 5_000 }, (_, i) => ({ id: `custom:synthetic-${i}`, label: `Synthetic task ${i}`, category: 'Custom' }));
  state.members[0].completedTasks = state.tasks.map(task => task.id);
  state.members[0].taskStatus = Object.fromEntries(state.tasks.slice(0, 500).map(task => [task.id, { favorite: true }]));
  return state;
}

test('large hostile synthetic transfer report and restore preview use linear lookups', () => {
  const incoming = largeSave(), before = structuredClone(incoming);
  // Overlap exercises definition comparisons and completion differences in both directions.
  const removedTasks = Array.from({ length: 1_250 }, (_, i) => ({ id: `custom:removed-${i}`, label: `Synthetic removed task ${i}`, category: 'Custom' }));
  before.tasks.push(...removedTasks);
  before.members[0].completedTasks = [...before.members[0].completedTasks.slice(0, 3_750), ...removedTasks.map(task => task.id)];
  const backup = exportBackup(incoming);
  const originals = Object.fromEntries(['find', 'filter', 'includes'].map(name => [name, Array.prototype[name]]));
  let visits = 0;
  for (const name of ['find', 'filter']) Array.prototype[name] = function (predicate, ...args) {
    return originals[name].call(this, (...values) => { if (this.length >= 1_000) { visits++; assert.ok(visits <= incoming.tasks.length * 40, 'Restore/report repeated a full-array scan'); } return predicate.call(args[0], ...values); });
  };
  Array.prototype.includes = function (...args) { if (this.length >= 1_000) { visits += this.length; assert.ok(visits <= incoming.tasks.length * 40, 'Restore/report repeated a full-array scan'); } return originals.includes.apply(this, args); };
  let state, report, preview;
  try {
    state = importBackup(backup);
    report = transferReport(state);
    preview = previewRestore(before, state);
  } finally { Object.assign(Array.prototype, originals); }
  assert.ok(visits <= incoming.tasks.length * 40, `Restore/report must use indexed lookups (${visits} scan visits)`);
  assert.equal(report.records.length, REPORT_RECORDS);
  assert.equal(report.counts.preservedForReview, 5_000);
  assert.equal(report.counts.omitted, 5_000 - REPORT_RECORDS);
  assert.equal(report.records[0].rawValue.completed, true);
  assert.equal(report.records.at(-1).rawValue.completed, true);
  assert.equal(preview.members[0].completedTasks.added.length, 1_250);
  assert.equal(preview.members[0].completedTasks.removed.length, 1_250);
  assert.equal(preview.tasks.changed.length, 0);

});

function editedSave(tasks, edits) {
  const state = createGroupState(roster);
  state.tasks = Array.from({ length: tasks }, (_, i) => ({ id: `custom:synthetic-${i}`, category: 'Custom', label: `Synthetic ${i}` }));
  state.revision = edits;
  for (let i = 0; i < edits; i++) {
    const before = { ...state.tasks[0] }, after = { ...before, label: `Edited ${i}` };
    state.tasks[0] = after;
    state.history.push({ id: `revision-${i + 1}`, revision: i + 1, type: 'edit-task', at: '2026-01-01T00:00:00.000Z',
      undo: { taskChanges: [{ id: before.id, before: { exists: true, value: before, index: 0 }, after: { exists: true, value: after, index: 0 } }] } });
  }
  return { format: 'rs3-chunk-picker', schemaVersion: 1, state };
}

const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} };
const transferOptions = { dataset, route: '/api/restore/preview', world: { chunks: new Map() } };
async function scratchStore(t, initialState = createGroupState(roster)) {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-isolated-import-'));
  const store = await openStore({ dataDir: root, initialState });
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store };
}

test('full synthetic legacy catalogue and 2,000 History entries round trip through worker and atomic apply', async t => {
  const { store } = await scratchStore(t);
  const document = editedSave(20_503, 2_000);
  document.state.members[0].completedTasks = document.state.tasks.map(task => task.id);
  const parsed = await readBackupRequest(Object.assign(Readable.from([Buffer.from(JSON.stringify({ backup: document }))]), { headers: { 'content-type': 'application/json' }, complete: true }), { defer: true });
  const result = await store.prepareTransfer(parsed.input, transferOptions);
  assert.equal(result.response.preview.tasks.added.length, REPORT_RECORDS);
  assert.equal(result.response.preview.taskCounts.added, 20_503);
  const applied = await store.applyTransfer(result.ticket, 0);
  const exported = await store.backup();
  const roundTrip = importBackup(exported);
  assert.deepEqual(roundTrip.tasks, document.state.tasks);
  assert.deepEqual(roundTrip.members, document.state.members);
  assert.deepEqual(roundTrip.provenance.restore.incomingHistory, document.state.history);
  t.diagnostic(`20,503 tasks / 2,000 History: worker ${result.workerMs.toFixed(1)} ms; main-thread atomic apply ${applied.applyMs.toFixed(1)} ms`);
});

test('destination History above 500 entries never rejects an incoming restore, including retained saves', async t => {
  const initial = createGroupState(roster);
  initial.members[0].notes = { '100': 'Synthetic even note' };
  const options = { world: { chunks: new Map([['100', {}]]) } };
  const odd = applyCommand(initial, { type: 'set-note', memberId: 'source', chunkId: '100', note: 'Synthetic odd note' }, options);
  const even = applyCommand(odd, { type: 'set-note', memberId: 'source', chunkId: '100', note: 'Synthetic even note' }, options);
  const initialState = structuredClone(odd);
  initialState.revision = 501;
  initialState.history = Array.from({ length: 501 }, (_, i) => ({ ...structuredClone(even.history[i % 2]), id: `revision-${i + 1}`, revision: i + 1 }));
  const { store } = await scratchStore(t, initialState);
  const incoming = editedSave(20_503, 0);
  const prepared = await store.prepareTransfer(serialize({ backup: incoming }), transferOptions);
  await store.applyTransfer(prepared.ticket, 501);
  assert.equal(store.getState().provenance.restore.previousHistory.length, 501);
  const retained = (await store.listBackups()).find(row => row.revision === 501);
  const restored = await store.prepareTransfer(serialize({ backupId: retained.id }), transferOptions);
  await store.applyTransfer(restored.ticket, 502);
  assert.equal(store.getInfo().revision, 503);
  assert.equal(store.getState().provenance.restore.incomingHistory.length, 501);
});

test('hostile warning and repeated long-label report stay bounded through worker parsing', async t => {
  const { store } = await scratchStore(t);
  const document = editedSave(1, 0);
  document.state.tasks[0].label = 'Synthetic '.repeat(40_000);
  document.state.provenance = { taskIdentityMigration: { unresolved: Array.from({ length: 400 }, (_, i) => ({ originalId: document.state.tasks[0].id, path: `synthetic-${i}` })) } };
  document.state.legacy = { gameplayMigration: { warnings: ['Could not migrate source ' + ' for member '.repeat(33_000)] } };
  const bytes = Buffer.from(JSON.stringify({ backup: document }));
  const checking = (async () => {
    const parsed = await readBackupRequest(Object.assign(Readable.from([bytes]), { headers: { 'content-type': 'application/json' }, complete: true }), { defer: true });
    return store.prepareTransfer(parsed.input, { ...transferOptions, importBudget: parsed.budget,
      migration: { definitions: { challenges: {} }, taskMap: {}, catalogue: [] } });
  })();
  const result = await checking;
  assert.ok(Buffer.byteLength(JSON.stringify(result.response.transferReport)) < REPORT_BYTES);
  assert.ok(result.response.warnings.every(warning => warning.length <= 513));
  const total = result.response.transferReport.counts.preservedForReview;
  assert.ok(total >= 400, 'Every unresolved record is counted, even when display warnings repeat.');
  assert.equal(result.response.transferReport.counts.omitted, total - REPORT_RECORDS);
  assert.ok(result.response.transferReport.more.startsWith(`and ${total - REPORT_RECORDS} more`));
});

test('malformed markup and diagnostic text use delimiter scans without backtracking', () => {
  const original = RegExp.prototype[Symbol.replace];
  const indexOf = String.prototype.indexOf;
  const patterns = [];
  let searched = 0, allowance = 0;
  String.prototype.indexOf = function (needle, from = 0) {
    const result = indexOf.call(this, needle, from);
    const start = Math.max(0, Math.min(this.length, Number(from) || 0));
    searched += (result < 0 ? this.length : result + String(needle).length) - start;
    assert.ok(searched <= allowance, 'Unterminated delimiters must not repeatedly scan the same suffix.');
    return result;
  };
  RegExp.prototype[Symbol.replace] = function (...args) { patterns.push(this.source);
    assert.ok(!this.source.includes('.*') && !this.source.includes('[^>'), 'Unterminated delimiters must not enter a backtracking replacement');
    return original.apply(this, args); };
  try {
    for (const label of ['<'.repeat(400_000), '~|'.repeat(200_000), '*'.repeat(400_000) + 'x']) {
      searched = 0; allowance = label.length * 8;
      assert.equal(stripTaskMarkup(label), label.replace(/[~|]/g, ''));
      assert.ok(searched <= allowance);
    }
  } finally { RegExp.prototype[Symbol.replace] = original; String.prototype.indexOf = indexOf; }
  assert.ok(patterns.every(source => !source.includes('.*') && !source.includes('[^>')),
    'Unterminated delimiters must use index scans, never a backtracking replacement');
});

test('unsafe prototype keys remain rejected after worker parsing and replay', async t => {
  const { store } = await scratchStore(t);
  const document = editedSave(1, 0), before = store.getState();
  document.state.members[0].taskRules = JSON.parse('{"__proto__":true}');
  const parsed = await readBackupRequest(Object.assign(Readable.from([Buffer.from(JSON.stringify({ backup: document }))]), { headers: { 'content-type': 'application/json' }, complete: true }), { defer: true });
  await assert.rejects(store.prepareTransfer(parsed.input, transferOptions), error => error.status === 400 && /unsafe/.test(error.message));
  assert.deepEqual(store.getState(), before);
  assert.equal(Object.prototype.challengeCompleted, undefined);
});

test('worker imports and exports keep destination credential sidecars outside portable saves', async t => {
  const { root, store } = await scratchStore(t);
  const secret = 'synthetic-sidecar-never-export';
  for (const name of ['sessions.json', 'invitations.json', 'plugin-keys.json']) await writeFile(path.join(root, name), JSON.stringify({ secret }));
  const result = await store.prepareTransfer(serialize({ backup: editedSave(1, 0) }), transferOptions);
  await store.applyTransfer(result.ticket, 0);
  assert.equal(JSON.stringify(await store.backup()).includes(secret), false);
  assert.equal(JSON.stringify(result.response).includes(secret), false);
});

test('timeout terminates a wedged worker, releases the global queue, and cannot apply a partial result', async t => {
  const { store } = await scratchStore(t), before = store.getState();
  const partial = editedSave(1, 0);
  const entered = Promise.withResolvers(), hook = Promise.withResolvers();
  const stopped = Promise.withResolvers(), acknowledgeExit = Promise.withResolvers();
  const nativeOn = Worker.prototype.on, nativeTerminate = Worker.prototype.terminate;
  let worker, receive, exitCode, applications = 0, nextStarted = false;
  // Observe the real isolate through its existing EventEmitter API. Restore the
  // prototype as soon as this job installs its result listener.
  const observe = t.mock.method(Worker.prototype, 'on', function (event, listener) {
    if (event === 'message') {
      worker = this;
      receive = listener;
      nativeOn.call(worker, 'exit', code => { exitCode = code; });
      observe.mock.restore();
    }
    return nativeOn.call(this, event, listener);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const wedged = runImportJob({ kind: 'replacement', document: partial }, {
      workerURL: new URL('./fixtures/import-timeout-worker.mjs', import.meta.url),
      prepareHook: input => { entered.resolve(input); return hook.promise; },
    }).then(document => { applications++; return store.replace(document, 0); });
    // Attach the rejection observer before firing the controlled deadline.
    const rejected = assert.rejects(wedged, error => error.status === 422 && /took too long/.test(error.message));
    assert.deepEqual(await entered.promise, partial, 'worker reached preparation with a partial replacement');
    const terminate = t.mock.method(worker, 'terminate', async function () {
      const code = await nativeTerminate.call(this);
      stopped.resolve(code);
      // Hold the termination acknowledgement to prove admission waits for exit.
      await acknowledgeExit.promise;
      return code;
    });
    // Stagger the queued deadline by one virtual millisecond. It can then act as
    // a deterministic failure acknowledgement if timeout cleanup strands it.
    t.mock.timers.tick(1);
    const request = Object.assign(new Readable({ read() {
      nextStarted = true; this.push(Buffer.from('{}')); this.push(null);
    } }), { headers: { 'content-type': 'application/json' }, complete: true });
    const next = runImportJob({ kind: 'parse', headers: request.headers }, { request, maxUploadBytes: 1024 });
    next.catch(() => {});
    assert.equal(nextStarted, false, 'next parser is queued behind the wedged worker');
    t.mock.timers.tick(IMPORT_TIMEOUT_MS - 1);
    await Promise.resolve(); // Run the timeout rejection's finally block.
    assert.ok(terminate.mock.callCount() > 0, 'timeout must terminate the wedged worker');
    const terminatedCode = await stopped.promise;
    assert.equal(exitCode, terminatedCode, 'native worker exit acknowledged termination');
    assert.equal(worker.threadId, -1, 'the wedged isolate has exited');
    assert.equal(nextStarted, false, 'queue waits for the termination acknowledgement');

    hook.resolve(partial);
    // Deliver a valid result after cancellation, as if a message were already
    // queued when the deadline fired. Await the actual production result handler.
    await receive(await encodeImportBytes({ result: partial }));
    acknowledgeExit.resolve();
    await rejected;
    t.mock.timers.tick(1); // An unreleased queue rejects next with its busy error.
    assert.deepEqual((await next).body, {});
    assert.equal(nextStarted, true, 'the next queued parser started and consumed its request');
    assert.equal(applications, 0, 'neither the partial nor the late result reached apply');
    assert.deepEqual(store.getState(), before, 'timeout leaves authoritative state unchanged');
  } finally {
    hook.resolve(partial); acknowledgeExit.resolve();
    // A failed termination assertion must not leave a queued parser behind.
    t.mock.timers.tick(IMPORT_TIMEOUT_MS);
    observe.mock.restore();
    if (worker) await nativeTerminate.call(worker);
    t.mock.timers.reset();
  }
});

test('roster remap preserves the removed preferred-method guard through reload', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-alternative-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createGroupState([{ ...roster[0], sourceMapId: 'synthetic-map' }]);
  state.tasks = [{ id: 'rs3:task:synthetic-method', category: 'Mining', label: 'Synthetic method' }];
  state.legacy = { maps: { 'synthetic-map': { chunkinfo: { altChallenges: { Mining: { group: 'rs3:task:synthetic-method' } } } } } };
  const migrated = migrateTaskIdentities(state).state;
  assert.equal(migrated.members[0].taskAlternatives.Mining.group, 'rs3:task:synthetic-method');
  delete migrated.members[0].taskAlternatives.Mining.group;
  const mapped = mapTransferRoster(migrated, [{ id: 'destination' }], { source: 'destination' });
  assert.deepEqual(mapped.provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'destination', sourceMapId: 'synthetic-map' }]);
  assert.deepEqual(migrated.provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'source', sourceMapId: 'synthetic-map' }]);
  for (let pass = 0; pass < 2; pass++) {
    const store = await openStore({ dataDir: root, initialState: mapped, migrateState: incoming => migrateTaskIdentities(incoming).state });
    try { assert.deepEqual(store.getState().members[0].taskAlternatives ?? {}, {});
      assert.deepEqual(store.getState().provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'destination', sourceMapId: 'synthetic-map' }]); } finally { await store.close(); }
  }
});

test('remap then store load preserves cleared legacy fields and original migration attribution', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-roster-guards-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = createGroupState([{ ...roster[0], sourceMapId: 'synthetic-map' }]);
  state.legacy = { maps: { 'synthetic-map': { chunks: { stickeredNotes: { '100': 'Archived synthetic note' } },
    chunkNotes: 'Archived synthetic journal', rules: { SyntheticRule: false } } } };
  const options = { definitions: { challenges: {} }, taskMap: {}, catalogue: [] };
  const migrated = migrateOwnedGameplay(state, options).state;
  assert.equal(migrated.members[0].notes['100'], 'Archived synthetic note');
  assert.equal(migrated.members[0].taskRules.SyntheticRule, false);
  delete migrated.members[0].notes['100'];
  delete migrated.members[0].taskRules.SyntheticRule;
  delete migrated.members[0].journal;
  migrated.legacy.gameplayMigration.unresolved = [{ memberId: 'source', sourceMapId: 'synthetic-map', source: 'checkedAllTasks', category: 'Custom', legacyKey: 'synthetic-unknown', reason: 'unknown legacy task ID' }];
  migrated.legacy.gameplayMigration.taskStatusProvenance = [{ memberId: 'source', taskId: 'custom:synthetic', sources: [] }];
  const originalMigration = structuredClone(migrated.legacy.gameplayMigration);
  const mapped = mapTransferRoster(migrated, [{ id: 'destination' }], { source: 'destination' });
  for (const field of ['migratedMembers', 'journalMigratedMembers', 'unresolved', 'taskStatusProvenance']) {
    assert.equal(mapped.legacy.gameplayMigration[field][0].memberId, 'destination');
  }
  assert.deepEqual(mapped.provenance.transferRoster.gameplayMigration, originalMigration);
  assert.deepEqual(migrated.legacy.gameplayMigration, originalMigration);
  const open = () => openStore({ dataDir: root, initialState: mapped, migrateState: incoming => migrateOwnedGameplay(incoming, options).state });
  let store = await open();
  try {
    const loaded = store.getState();
    assert.deepEqual(loaded.members[0].notes, {});
    assert.deepEqual(loaded.members[0].taskRules, {});
    assert.equal(loaded.members[0].journal, undefined);
    assert.deepEqual(loaded.provenance.transferRoster.gameplayMigration, originalMigration);
  } finally { await store.close(); }
  store = await open();
  try {
    assert.deepEqual(store.getState().members[0].notes, {});
    assert.deepEqual(store.getState().members[0].taskRules, {});
    assert.equal(store.getState().members[0].journal, undefined);
  } finally { await store.close(); }
});

test('member restore carries remapped guards before migration and preserves Undo across reload', async t => {
  const options = { definitions: { challenges: {} }, taskMap: {}, catalogue: [] };
  const source = createGroupState([{ id: 'two', name: 'Source', sourceMapId: 'map-two' }]);
  source.legacy = { maps: { 'map-two': { chunks: { stickeredNotes: { '100': 'Archived synthetic note' } },
    chunkNotes: 'Archived synthetic journal', rules: { SyntheticRule: false } } } };
  const incoming = migrateOwnedGameplay(source, options).state;
  incoming.members[0].notes = {}; incoming.members[0].taskRules = {}; delete incoming.members[0].journal;
  incoming.provenance = { taskIdentityMigration: { legacyAlternativeMembers: [{ memberId: 'two', sourceMapId: 'map-two' }] } };
  const destination = createGroupState([{ id: 'one', name: 'Destination', sourceMapId: 'map-one' }]);
  destination.members[0].notes = { '100': 'Destination synthetic note' };
  destination.legacy = { maps: { ...structuredClone(source.legacy.maps), 'map-one': {} } };
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-member-guards-'));
  let store = await openStore({ dataDir: root, initialState: destination, retention: false,
    migrateState: state => migrateOwnedGameplay(state, options).state });
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const prepared = await store.prepareTransfer(serialize({ backup: { format: 'rs3-chunk-picker', schemaVersion: 1, state: incoming }, memberId: 'one', sourceMemberId: 'two' }),
    { ...transferOptions, route: '/api/member-restore/preview', world: { chunks: new Map([['100', {}]]) }, migration: options });
  const { state } = await store.applyTransfer(prepared.ticket, 0);
  assert.deepEqual(state.members[0].notes, {}); assert.deepEqual(state.members[0].taskRules, {});
  assert.equal(state.members[0].journal, undefined);
  for (const field of ['migratedMembers', 'journalMigratedMembers']) assert.ok(state.legacy.gameplayMigration[field].some(row => row.memberId === 'one' && row.sourceMapId === 'map-two'));
  assert.deepEqual(state.provenance.taskIdentityMigration.legacyAlternativeMembers, [{ memberId: 'one', sourceMapId: 'map-two' }]);
  await store.close();
  store = await openStore({ dataDir: root, retention: false, migrateState: state => migrateOwnedGameplay(state, options).state });
  assert.deepEqual(store.getState().members[0].notes, {});
  const undone = await store.command({ type: 'undo' }, 1);
  assert.equal(undone.members[0].notes['100'], 'Destination synthetic note');
});

test('prepared import cannot overwrite a same-revision action-session checkpoint', async t => {
  const { root, store } = await scratchStore(t);
  const prepared = await store.prepareTransfer(serialize({ backup: editedSave(1, 0) }), transferOptions);
  await store.openActionSession(randomUUID(), { actor: { kind: 'master', label: 'Synthetic operator' } });
  const { readFile } = await import('node:fs/promises');
  const file = path.join(root, 'state.json'), before = await readFile(file);
  assert.equal(store.getInfo().revision, 0);
  await assert.rejects(store.applyTransfer(prepared.ticket, 0), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await readFile(file), before);
});
