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
import { createServer } from '../app/server.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { datasetDigest } from '../app/datasets.mjs';
import { openRegistry } from '../app/storage/registry.mjs';
import { openInviteStore } from '../app/storage/invites.mjs';
import { createGroupState } from '../app/core/state.mjs';

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

test('server reopens a newly prepared owned save without retained release evidence', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dataset-evidence-server-'));
  let app;
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }); });
  const dataDir = path.join(root, 'legacy'), multiPicker = { registryDir: path.join(root, 'registry'),
    pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'tombstones') };
  const base = selectedDataset;
  const provider = options => {
    // Constructor injection permits local metadata records to differ while
    // retaining the bootstrapped input catalogue. Model source evidence there
    // so both HTTP opens exercise the gate in one process without changing any
    // repository source or bypassing its dataset-switch protection.
    const evidence = syntheticDataset(options).files.filter(row => row.kind === 'evidence')
      .map(row => ({ ...row, path: 'local-map/synthetic-engine.mjs' }));
    const files = [...base.files, ...evidence], digestWithEvidence = rows => datasetDigest(
      [...files.filter(row => row.kind === 'input'), ...rows], base.capabilities, base.definitionOverlays);
    const dataset = { ...base, files, digest: digestWithEvidence(files.filter(row => row.kind === 'evidence')), digestWithEvidence };
    dataset.status = () => ({ id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest });
    return dataset;
  };
  const previous = provider(), next = provider({ evidence: 'new source' });
  await bindDatasetStorage(dataDir, previous);
  const options = storageOptions(dataDir, previous), legacy = await openStore({ ...options, prepareState: undefined,
    initialState: createGroupState([1, 2].map(i => ({ id: `synthetic-legacy-${i}`, name: `Synthetic ${i}` })), options.registry) });
  const registry = await openRegistry({ ...multiPicker, legacyDir: dataDir });
  let login, cookie;
  try {
    login = await registry.firstLogin('discord', 'synthetic-evidence-reopen');
    const invites = await openInviteStore({ dataDir, masterToken: legacy.getAccessToken(), pickerRegistry: registry });
    try { cookie = 'duo_access=' + await invites.issuePickerSession(login.account.id, login.picker.id, 'discord'); }
    finally { await invites.close(); }
  } finally { await registry.close(); await legacy.close(); }
  const directory = path.join(multiPicker.pickerRoot, login.picker.id);
  // No calculator is needed: this regression exercises HTTP routing, the real
  // binding gate and owned store preparation against a tiny synthetic world.
  const start = dataset => createServer({ dataDir, multiPicker, dataset, definitions: { chunks: {} }, taskMap: {},
    world: options.world, port: 0, loopbackPort: undefined, predictionPrewarm: false, retention: false,
    now: () => Date.parse('2026-11-11T12:00:00Z'), random: () => .25 });
  const request = () => fetch(`http://127.0.0.1:${app.address().port}/api/state`, { headers: { Cookie: cookie } });
  app = await start(previous); await app.listen();
  assert.equal((await request()).status, 200); await app.close();
  const before = JSON.parse(await readFile(path.join(directory, 'state.json'))).state;
  assert.ok(before.provenance.datasetEvidence);
  assert.deepEqual(before.provenance.datasetEvidence, datasetEvidenceRecord(previous));
  await assert.rejects(readFile(datasetEvidencePath(directory)), { code: 'ENOENT' });
  const binding = await readFile(bindingPath(directory));
  // A stopped deploy has updated the legacy root receipt; the owned receipt
  // remains the one created by the first real server open.
  const rootBinding = JSON.parse(await readFile(bindingPath(dataDir)));
  rootBinding.digest = next.digest;
  delete rootBinding.datasetEvidence;
  await writeFile(bindingPath(dataDir), JSON.stringify(rootBinding));
  app = await start(next); await app.listen();
  const response = await request();
  assert.equal(response.status, 200, await response.text()); await app.close();
  const store = await openStore({ ...options, dataDir: directory, prepareState: undefined });
  try {
    const state = store.getState();
    assert.equal(state.provenance.dataset.digest, next.digest);
    assert.equal(state.revision, before.revision + 1);
    assert.equal(state.history.at(-1).type, 'catalogue-refresh');
    assert.equal((await store.listBackups()).length, 1);
  } finally { await store.close(); }
  assert.deepEqual(await readFile(bindingPath(directory)), binding);
  assert.deepEqual(JSON.parse(binding).datasetEvidence, before.provenance.datasetEvidence);
  await assert.rejects(readFile(datasetEvidencePath(directory)), { code: 'ENOENT' });
});

test('binding witnesses prove only evidence changes without opening gameplay storage', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'dataset-evidence-binding-')), directory = path.join(root, 'absent-store');
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = syntheticDataset(), next = syntheticDataset({ evidence: 'new source' });
  await bindDatasetStorage(directory, previous);
  const receipt = await readFile(bindingPath(directory));
  assert.equal((await verifyDatasetBinding(directory, next, { evidenceOnly: true })).bound, true);
  await assert.rejects(bindDatasetStorage(directory, next), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(verifyDatasetBinding(directory, syntheticDataset({ input: 'changed data' }), { evidenceOnly: true }),
    { code: 'DATASET_BINDING_MISMATCH' });
  assert.deepEqual(await readFile(bindingPath(directory)), receipt);
  await assert.rejects(readdir(directory), { code: 'ENOENT' }, 'The gate must not create or open a gameplay store.');
  const document = JSON.parse(receipt);
  document.datasetEvidence.files[0].sha256 = 'f'.repeat(64);
  await writeFile(bindingPath(directory), JSON.stringify(document));
  await assert.rejects(verifyDatasetBinding(directory, next, { evidenceOnly: true }), { code: 'DATASET_BINDING_MISMATCH' });
  delete document.datasetEvidence;
  await writeFile(bindingPath(directory), JSON.stringify(document));
  assert.equal((await verifyDatasetBinding(directory, previous)).bound, true, 'Old exact receipts stay valid.');
  await assert.rejects(verifyDatasetBinding(directory, next, { evidenceOnly: true }), { code: 'DATASET_BINDING_MISMATCH' });
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
