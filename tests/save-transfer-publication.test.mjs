import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';
process.env.RS3_DATASET = 'open-starter';
const { createGroupState } = await import('../app/core/state.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const { MAX_PORTABLE_BACKUP_BYTES, backupPreviewState } = await import('../app/backup-transfer.mjs');
const { migrateOwnedGameplay } = await import('../app/tasks/migration.mjs');
const { migrationSummary } = await import('../app/picker-context-http.mjs');
const { transferManifest, transferDigest } = await import('../app/save-transfer.mjs');
const { captureProgressSnapshot } = await import('../app/core/progress-timeline.mjs');

const roster = [{ id: 'one', name: 'Synthetic player' }];
const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} };
const options = { dataset, route: '/api/restore/preview', world: { chunks: new Map() } };
const now = '2026-11-05T12:00:00.000Z';
const backup = state => ({ format: 'rs3-chunk-picker', schemaVersion: 1, state });
async function scratch(t, settings = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'synthetic-transfer-publication-'));
  let store = await openStore({ dataDir, initialState: createGroupState(roster), retention: false, now: () => now, ...settings });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, get store() { return store; }, async reopen() {
    await store.close(); store = await openStore({ dataDir, retention: false, now: () => now, ...settings });
  } };
}
async function measuredResponse(work) {
  const result = await work();
  const bytes = Buffer.from(JSON.stringify(result.response));
  createHash('sha256').update(bytes).digest('hex');
  transferDigest(result.response);
  return { result, bytes: bytes.length };
}

test('128 MiB roster labels stay bounded during mapping and prepared HTTP response work', async t => {
  const { store } = await scratch(t);
  let state = createGroupState([{ id: 'source', name: 'x'.repeat(128 * 1024 ** 2) }]);
  const input = serialize({ backup: backup(state) });
  const mappedState = createGroupState([{ id: 'one', name: state.members[0].name.slice(0, 64 * 1024 ** 2) }]);
  const mappedInput = serialize({ backup: backup(mappedState), rosterMapping: { one: 'one' } }); state = undefined;
  const mapping = await measuredResponse(() => store.prepareTransfer(input, options));
  assert.equal(mapping.result.response.mappingRequired, true);
  assert.equal(mapping.result.response.sourceRoster[0].id, 'source');
  assert.equal(mapping.result.response.sourceRoster[0].name.length, 512);
  assert.ok(mapping.bytes < 4096);
  const prepared = await measuredResponse(() => store.prepareTransfer(mappedInput, options));
  assert.equal(prepared.result.response.state.members[0].name.length, 512);
  await store.applyTransfer(prepared.result.ticket, 0);
  assert.equal((await store.backup()).state.members[0].name.length, 64 * 1024 ** 2);
  t.diagnostic(JSON.stringify({ mappingBytes: mapping.bytes, mappingGapMs: mapping.gap, mappingMs: mapping.ms,
    preparedBytes: prepared.bytes, preparedGapMs: prepared.gap, preparedMs: prepared.ms }));
});

test('mapping identifiers remain exact and reject unusable identifiers before returning a roster', async t => {
  const { store } = await scratch(t);
  for (const id of ['x'.repeat(81), 'source\u0000key']) {
    const state = createGroupState([{ id, name: 'Synthetic player' }]);
    await assert.rejects(store.prepareTransfer(serialize({ backup: backup(state) }), options), error => error.status === 422);
    assert.throws(() => backupPreviewState(state), error => error.status === 422);
  }
  const state = createGroupState([{ id: 'x'.repeat(80), name: 'n'.repeat(1024) }]);
  assert.equal(backupPreviewState(state).members[0].id, state.members[0].id);
  assert.equal(backupPreviewState(state).members[0].name.length, 512);
});

test('raw migration warnings survive same-roster restore, reload and portable export', async t => {
  const migration = { definitions: { challenges: {} }, taskMap: {}, catalogue: [] };
  const fixture = await scratch(t, { migrateState: state => migrateOwnedGameplay(state, migration).state });
  const state = createGroupState(roster), warning = 'Synthetic saved diagnostic: ' + 'evidence '.repeat(160) + 'retained tail';
  state.legacy = { gameplayMigration: { warnings: [warning] } };
  const before = await readFile(path.join(fixture.dataDir, 'state.json'));
  const prepared = await fixture.store.prepareTransfer(serialize({ backup: backup(state) }), { ...options, migration });
  assert.deepEqual(await readFile(path.join(fixture.dataDir, 'state.json')), before);
  assert.ok(prepared.response.warnings.every(text => text.length <= 512));
  await fixture.store.applyTransfer(prepared.ticket, fixture.store.getInfo().revision);
  await fixture.reopen();
  const exported = JSON.parse((await fixture.store.exportBackup({ dataset })).bytes.toString());
  assert.ok(exported.state.legacy.gameplayMigration.warnings.includes(warning));
  assert.ok(migrationSummary(exported.state).warnings.every(text => text.length <= 512));
});

test('capacity includes the publication snapshot, manifest and hydrated retained History', async t => {
  const initialState = createGroupState(roster);
  initialState.revision = 6;
  initialState.history = Array.from({ length: 6 }, (_, index) => ({ id: `revision-${index + 1}`, revision: index + 1, type: 'edit-task', at: now }));
  const fixture = await scratch(t, { initialState, progressQuestPoints: new Map(), retention: { historyEntries: 1, backupDays: 90 },
    world: { chunks: new Map([['100', {}]]) } });
  await fixture.store.command({ type: 'set-note', memberId: 'one', chunkId: '100', note: 'Synthetic destination note' }, 6);
  assert.ok(fixture.store.getInfo().retention.historyArchives > 0);
  const state = createGroupState(roster);
  state.provenance = { syntheticPadding: [] };
  // Determine exact metadata cost using the same complete prepared state, then
  // place the pre-snapshot envelope 32 bytes below the portable ceiling.
  const small = await fixture.store.prepareTransfer(serialize({ backup: backup(state) }), options);
  const ready = small.response.state; assert.equal(ready.revision, 8);
  const { previewReplacement } = fixture.store;
  const replacement = await previewReplacement(backup(state));
  const portable = { ...backup(replacement.state), state: { ...replacement.state,
    provenance: { ...replacement.state.provenance, dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } } },
    transfer: transferManifest(dataset, replacement.state.members) };
  let remaining = MAX_PORTABLE_BACKUP_BYTES - 32 - Buffer.byteLength(JSON.stringify(portable));
  while (remaining >= 4) {
    const cost = state.provenance.syntheticPadding.length ? 3 : 2;
    const text = 'x'.repeat(Math.min(64 * 1024, remaining - cost));
    state.provenance.syntheticPadding.push(text); remaining -= text.length + cost;
  }
  assert.ok(Buffer.byteLength(JSON.stringify(backup(state))) < MAX_PORTABLE_BACKUP_BYTES);
  const disk = await readFile(path.join(fixture.dataDir, 'state.json'));
  await assert.rejects(fixture.store.prepareTransfer(serialize({ backup: backup(state) }), options), error => error.status === 413);
  assert.deepEqual(await readFile(path.join(fixture.dataDir, 'state.json')), disk);
  // Leave only a small amount more than today's snapshot. Accepted means both
  // portable encodings work after apply, including History compacted to disk.
  state.provenance.syntheticPadding.pop();
  const prepared = await fixture.store.prepareTransfer(serialize({ backup: backup(state) }), options);
  await fixture.store.applyTransfer(prepared.ticket, fixture.store.getInfo().revision);
  const exported = await fixture.store.exportBackup({ dataset });
  const compressed = await fixture.store.exportBackup({ dataset, gzip: true });
  assert.ok(exported.plainBytes <= MAX_PORTABLE_BACKUP_BYTES);
  assert.equal(compressed.plainBytes, exported.plainBytes);
  const saved = JSON.parse(exported.bytes.toString());
  assert.equal(saved.state.provenance.restore.previousHistory.length, 7);
  assert.equal(saved.state.provenance.restore.previousHistory[0].revision, 1);
  assert.deepEqual(saved.state.progressSnapshots, captureProgressSnapshot(saved.state, { questPoints: new Map(), at: now }).progressSnapshots);
  t.diagnostic(JSON.stringify({ acceptedBytes: exported.plainBytes, portableLimit: MAX_PORTABLE_BACKUP_BYTES }));
});
