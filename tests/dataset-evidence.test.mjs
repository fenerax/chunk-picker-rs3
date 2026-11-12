// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { bindDatasetStorage, verifyDatasetBinding, bindingPath } from '../app/dataset-binding.mjs';
import { datasetEvidencePath, datasetEvidenceRecord, datasetWithEvidenceHistory, provesEvidenceOnly } from '../app/dataset-evidence.mjs';
import { prepareOwnedPickerState, preserveGameIdentity, requireGameBackup } from '../app/game-profile.mjs';
import { inventory } from '../scripts/linux/files.mjs';
import { storageOptions, syntheticDataset, pickerId, pickerRegistry } from './helpers/dataset-evidence.mjs';

async function fixture(t, { proof = true, savedProof = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dataset-evidence-')), dataDir = path.join(root, 'save');
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = syntheticDataset(), next = syntheticDataset({ evidence: 'new source' });
  await bindDatasetStorage(dataDir, previous);
  const options = storageOptions(dataDir, previous);
  if (savedProof) options.initialState.provenance.datasetEvidence = datasetEvidenceRecord(previous);
  // Model a save written before owned preparation acquired the evidence proof.
  const first = await openStore({ ...options, prepareState: undefined }); await first.close();
  if (proof) await writeFile(datasetEvidencePath(dataDir), JSON.stringify({ schemaVersion: 1, records: [datasetEvidenceRecord(previous)] }));
  const before = await readFile(path.join(dataDir, 'state.json'));
  const current = await datasetWithEvidenceHistory(dataDir, next);
  return { root, dataDir, previous, next: current, before, options: storageOptions(dataDir, current) };
}

test('evidence-only opening uses the backed-up revision/event migration and is idempotent', async t => {
  const f = await fixture(t), binding = await readFile(bindingPath(f.dataDir));
  assert.equal((await verifyDatasetBinding(f.dataDir, f.next, { evidenceOnly: true })).bound, true);
  await assert.rejects(bindDatasetStorage(f.dataDir, f.next), { code: 'DATASET_BINDING_MISMATCH' });
  let store = await openStore(f.options);
  const state = store.getState(), backups = await store.listBackups();
  assert.equal(state.provenance.dataset.digest, f.next.digest);
  assert.deepEqual(state.provenance.datasetEvidence, datasetEvidenceRecord(f.next));
  assert.equal(state.revision, 1);
  assert.deepEqual(state.history.map(row => row.type), ['catalogue-refresh']);
  assert.equal(backups.length, 1); assert.equal(backups[0].revision, 0);
  await store.close();
  const published = await readFile(path.join(f.dataDir, 'state.json'));
  store = await openStore(f.options);
  assert.equal(store.getState().revision, 1); assert.equal((await store.listBackups()).length, 1);
  await store.close();
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), published);
  assert.deepEqual(await readFile(bindingPath(f.dataDir)), binding);
});

test('new provenance itself proves an evidence-only transition', async t => {
  const f = await fixture(t, { proof: false, savedProof: true });
  const store = await openStore(f.options);
  assert.equal(store.getState().provenance.dataset.digest, f.next.digest); await store.close();
});

test('changed inputs, capabilities, definition overlays, id and contract remain refused', async t => {
  const f = await fixture(t);
  for (const dataset of [syntheticDataset({ input: 'different game data', evidence: 'new source' }),
    syntheticDataset({ capabilities: { changed: true } }), syntheticDataset({ overlays: ['synthetic/input.json'] }),
    { ...f.next, datasetId: 'other' }, { ...f.next, datasetContractVersion: 2 }]) {
    dataset.evidenceHistory = [datasetEvidenceRecord(f.previous)];
    await assert.rejects(openStore(storageOptions(f.dataDir, dataset)), /Choose a backup/);
  }
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), f.before);
});

test('an unprovable old stamp and forged evidence remain refused', async t => {
  const f = await fixture(t, { proof: false });
  await assert.rejects(openStore(f.options), /Choose a backup/);
  assert.equal(provesEvidenceOnly(f.next, f.options.initialState.provenance.dataset,
    [{ ...datasetEvidenceRecord(f.previous), digest: f.next.digest }]), false);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), f.before);
});

test('read-only opening refuses migration without writing any file', async t => {
  const f = await fixture(t), before = await inventory(f.dataDir);
  await assert.rejects(openStore({ ...f.options, readOnly: true }), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
  assert.deepEqual(await inventory(f.dataDir), before);
});

test('process death after the durable backup recovers with one committed refresh', async t => {
  const f = await fixture(t);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/dataset-evidence-crash.mjs', import.meta.url)), f.dataDir], { windowsHide: true, encoding: 'utf8' });
  assert.equal(child.status, 73, child.stderr);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), f.before);
  const interrupted = (await readdir(path.join(f.dataDir, 'backups'))).filter(name => name.endsWith('.json.gz'));
  assert.equal(interrupted.length, 1);
  const store = await openStore(f.options);
  assert.equal(store.getState().revision, 1);
  assert.deepEqual(store.getState().history.map(row => row.type), ['catalogue-refresh']);
  assert.equal((await store.listBackups()).length, 2, 'each attempt preserves its preimage');
  await store.close();
});

test('restore authorization stays exact and the duo legacy wrapper has no stamp gate', async t => {
  const f = await fixture(t), state = storageOptions(f.dataDir, f.previous).initialState;
  assert.throws(() => prepareOwnedPickerState(f.next, pickerRegistry, pickerId)(state, { operation: 'replace' }), /Choose a backup/);
  assert.throws(() => requireGameBackup({ ...f.next, capabilities: { independent: true } }, { state }), { code: 'DATASET_BINDING_MISMATCH' });
  assert.equal(preserveGameIdentity(f.next, undefined), undefined);
  const store = await openStore({ ...f.options, prepareState: preserveGameIdentity(f.next, undefined) });
  assert.equal(store.getState().revision, 0); await store.close();
});
