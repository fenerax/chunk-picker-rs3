// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { datasetEvidenceRecord, datasetWithEvidenceHistory } from '../app/dataset-evidence.mjs';
import { DATASET_CONTRACT, DATASET_OVERLAY_ORDER } from '../app/datasets.mjs';
import { bindDatasetStorage, verifyDatasetBinding } from '../app/dataset-binding.mjs';
import { openStore } from '../app/storage/store.mjs';
import { releaseEvidenceDataset, retainReleaseDatasetEvidence, checkSavedDatasetEvidence, serviceEvidenceBinding } from '../scripts/linux/dataset-evidence.mjs';
import { checkStoppedCompatibility, storeIdentity } from '../scripts/linux/recovery.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { encode, sha } from '../scripts/linux/files.mjs';
import { compatibilityReports } from './helpers/release-compatibility.mjs';
import { storageOptions, syntheticDataset } from './helpers/dataset-evidence.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dataset-deploy-')), dataDir = path.join(root, 'save');
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = syntheticDataset(), next = syntheticDataset({ evidence: 'new source' });
  await bindDatasetStorage(dataDir, old);
  const first = await openStore({ ...storageOptions(dataDir, old), prepareState: undefined }); await first.close();
  async function release(name, dataset, supportsEvidence = true) {
    const coreRoot = path.join(root, name); await mkdir(path.join(coreRoot, 'app'), { recursive: true });
    if (supportsEvidence) await writeFile(path.join(coreRoot, 'app/dataset-evidence.mjs'), '// synthetic capability marker');
    const put = async (name, value) => { const file = path.join(coreRoot, name), bytes = encode(value); await writeFile(file, bytes); return { path: file, sha256: sha(bytes) }; };
    const data = await put('data.json', { requires: DATASET_CONTRACT, overlayOrder: DATASET_OVERLAY_ORDER,
      files: dataset.files, capabilities: dataset.capabilities, datasetDigest: dataset.digest });
    const rulesText = await put('text.json', { files: [] });
    const profile = await put('profile.json', { catalogue: { definitionOverlays: dataset.definitionOverlays } });
    const config = await put('config.json', { coreRoot, dataDir, packs: { data, rulesText }, profile });
    const pointer = await put('pointer.json', { config });
    return readRelease(pointer.path, dataDir);
  }
  return { root, dataDir, old, next, release, current: await release('old', old), candidate: await release('new', next) };
}

test('stopped compatibility proves old saves from pinned release manifests on copies only', async t => {
  const f = await fixture(t), before = await storeIdentity(f.dataDir), calls = [];
  assert.deepEqual(datasetEvidenceRecord(await releaseEvidenceDataset(f.current)), datasetEvidenceRecord(f.old));
  const result = await checkStoppedCompatibility({ ...f, scratchRoot: path.join(f.root, 'scratch'), minFreeBytes: 0,
    assertStopped: async () => {}, probe: async (_release, copy) => {
      const dataset = await datasetWithEvidenceHistory(copy, f.next);
      assert.equal((await verifyDatasetBinding(copy, dataset, { evidenceOnly: true })).bound, true);
      calls.push(copy); return compatibilityReports().before;
    } });
  assert.equal(result.steps, 4); assert.equal(calls.length, 4);
  assert.deepEqual(await storeIdentity(f.dataDir), before);
  await retainReleaseDatasetEvidence(f.dataDir, f.current, f.candidate);
  const dataset = await datasetWithEvidenceHistory(f.dataDir, f.next), store = await openStore(storageOptions(f.dataDir, dataset));
  assert.equal(store.getState().provenance.dataset.digest, f.next.digest); await store.close();
  assert.equal((await verifyDatasetBinding(f.dataDir, dataset, { evidenceOnly: true })).bound, true);
});

test('stopped preflight refuses changed game data and unknown old stamps before probing', async t => {
  const f = await fixture(t), before = await storeIdentity(f.dataDir);
  const input = await f.release('input-change', syntheticDataset({ input: 'different data' }));
  await assert.rejects(checkSavedDatasetEvidence(f.dataDir, f.current, input), /cannot be proven evidence-only/);
  assert.deepEqual(await storeIdentity(f.dataDir), before);
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
  document.state.provenance.dataset.digest = 'f'.repeat(64);
  await writeFile(path.join(f.dataDir, 'state.json'), encode(document));
  await assert.rejects(checkSavedDatasetEvidence(f.dataDir, f.current, f.candidate), /cannot be proven evidence-only/);
});

test('rollback to a release without evidence-stamp support fails closed after a migrated write', async t => {
  const f = await fixture(t);
  await retainReleaseDatasetEvidence(f.dataDir, f.current, f.candidate);
  const dataset = await datasetWithEvidenceHistory(f.dataDir, f.next), store = await openStore(storageOptions(f.dataDir, dataset));
  await store.close();
  const oldReceiver = await f.release('old-receiver', f.old, false);
  await assert.rejects(checkSavedDatasetEvidence(f.dataDir, f.candidate, oldReceiver), /Receiving release cannot open/);
});

test('stopped proof checks hydrate compact provenance instead of treating it as an unstamped duo', async t => {
  const f = await fixture(t), options = storageOptions(f.dataDir, f.old);
  const store = await openStore({ ...options, prepareState: undefined });
  const state = store.getState(); state.provenance.syntheticPadding = 'x'.repeat(300000);
  await store.replace({ format: 'rs3-chunk-picker', schemaVersion: 1, state }, state.revision); await store.close();
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
  assert.equal(document.state.provenance, undefined); assert.ok(document.storage.fields.provenance);
  await checkSavedDatasetEvidence(f.dataDir, f.current, f.candidate);
  const input = await f.release('compact-input-change', syntheticDataset({ input: 'different data' }));
  await assert.rejects(checkSavedDatasetEvidence(f.dataDir, f.current, input), /cannot be proven evidence-only/);
});

test('service pack preflight admits only evidence-compatible manifests and keeps art/addon restrictions', async t => {
  const f = await fixture(t);
  assert.equal(JSON.parse(await serviceEvidenceBinding(f.current, f.candidate)).digest, f.next.digest);
  assert.equal(await serviceEvidenceBinding(f.current, f.current), undefined);
  const input = await f.release('service-input-change', syntheticDataset({ input: 'different data' }));
  await assert.rejects(serviceEvidenceBinding(f.current, input), /not proven evidence-only/);
  await assert.rejects(serviceEvidenceBinding({ config: { ...f.current.config, packs: undefined, profile: undefined } }, f.candidate), /not proven evidence-only/);
  for (const config of [{ ...f.candidate.config, addons: { sha256: 'changed' } },
    { ...f.candidate.config, packs: { ...f.candidate.config.packs, art: { sha256: 'changed' } } }])
    await assert.rejects(serviceEvidenceBinding(f.current, { config }), /sequential recovery/);
});
