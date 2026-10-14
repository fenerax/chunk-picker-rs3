import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { prepareGameStorage, defaultGameDirectory, gameArtOptions, unavailableDatasetFeature, requireGameBackup, preserveGameIdentity } from '../app/game-profile.mjs';
import { bindingPath } from '../app/dataset-binding.mjs';

const independent = { datasetId: 'invented-game', datasetContractVersion: 1, digest: 'a'.repeat(64), packed: false,
  capabilities: { independent: true, features: { originalSync: false, training: false } } };
const legacy = { ...independent, datasetId: 'duo-legacy', capabilities: {} };

test('independent storage gets a separate default and binds only fresh directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-profile-'));
  try {
    const directory = defaultGameDirectory(root, independent);
    assert.equal(directory, path.join(root, '.local', 'open-starter'));
    assert.equal(defaultGameDirectory(root, legacy), path.join(root, '.local', 'duo'));
    await prepareGameStorage(directory, independent);
    const before = await readFile(bindingPath(directory));
    await prepareGameStorage(directory, independent);
    assert.deepEqual(await readFile(bindingPath(directory)), before);
    assert.deepEqual(await readdir(path.dirname(directory)), ['open-starter.dataset.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a legacy-bound directory refuses before changing any storage bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-profile-'));
  try {
    const directory = path.join(root, 'saved-game');
    await mkdir(directory); await writeFile(path.join(directory, 'state.json'), 'sentinel save');
    const receipt = `${JSON.stringify({ schemaVersion: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, digest: legacy.digest })}\n`;
    await writeFile(bindingPath(directory), receipt);
    await assert.rejects(prepareGameStorage(directory, independent), { code: 'DATASET_BINDING_MISMATCH' });
    assert.equal(await readFile(bindingPath(directory), 'utf8'), receipt);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), 'sentinel save');
    assert.deepEqual(await readdir(directory), ['state.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the private default and an unbound nonempty directory are refused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-profile-'));
  try {
    await assert.rejects(prepareGameStorage(path.join(root, '.local', 'duo'), independent), { code: 'DATASET_BINDING_MISMATCH' });
    const directory = path.join(root, 'existing');
    await mkdir(directory); await writeFile(path.join(directory, 'state.json'), 'unbound save');
    await assert.rejects(prepareGameStorage(directory, independent), { code: 'DATASET_BINDING_MISMATCH' });
    assert.deepEqual(await readdir(root), ['existing']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('capabilities refuse unavailable integrations and isolate art roots', () => {
  assert.equal(unavailableDatasetFeature(independent, '/api/original-sync/preview'), 'originalSync');
  assert.equal(unavailableDatasetFeature(independent, '/api/command', 'sync-original'), 'originalSync');
  assert.equal(unavailableDatasetFeature(independent, '/api/training-plan'), 'training');
  assert.equal(unavailableDatasetFeature(legacy, '/api/original-sync/preview'), null);
  const configured = { defaults: { legacyResources: 'private' }, overrides: { mapAssets: 'private' } };
  assert.equal(gameArtOptions(legacy, configured), configured);
  assert.deepEqual(gameArtOptions(independent, configured), { selection: { schemaVersion: 1, art: null }, overrides: {}, defaults: {} });
});

test('starter restore accepts matching backups and refuses foreign or unbound backups', async () => {
  const identity = { id: independent.datasetId, contractVersion: independent.datasetContractVersion, digest: independent.digest };
  const backup = { state: { provenance: { dataset: identity } } };
  assert.equal(requireGameBackup(independent, backup), backup);
  for (const document of [{ state: {} }, { state: { provenance: { dataset: { ...identity, id: 'duo-legacy' } } } },
    { state: { provenance: { dataset: { ...identity, digest: 'b'.repeat(64) } } } }]) {
    assert.throws(() => requireGameBackup(independent, document), { code: 'DATASET_BINDING_MISMATCH' });
  }
  assert.equal(requireGameBackup(legacy, { state: {} }).state.provenance, undefined);
  const hook = preserveGameIdentity(independent, state => ({ ...state, provenance: { restore: { incomingRevision: 3 } } }));
  const restored = await hook({ revision: 4 }, { operation: 'replace' });
  assert.deepEqual(restored.provenance, { restore: { incomingRevision: 3 }, dataset: identity });
  assert.equal(unavailableDatasetFeature(independent, '/api/import'), 'originalSync');
  assert.equal(unavailableDatasetFeature(independent, '/api/import/preview'), 'originalSync');
});
