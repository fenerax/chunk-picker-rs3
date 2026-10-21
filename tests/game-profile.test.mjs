import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { prepareGameStorage, defaultGameDirectory, gameArtOptions, unavailableDatasetFeature, requireGameBackup, preserveGameIdentity } from '../app/game-profile.mjs';
import { bindingPath, verifyDatasetBinding } from '../app/dataset-binding.mjs';

const independent = { datasetId: 'invented-game', datasetContractVersion: 1, digest: 'a'.repeat(64), packed: false,
  capabilities: { independent: true, features: { originalSync: false, training: false } } };
const legacy = { ...independent, datasetId: 'duo-legacy', capabilities: {} };

async function storageStartup(root, started) {
  const source = await readFile(new URL('../app/server.mjs', import.meta.url), 'utf8');
  const entrypoint = source.match(/export function startServer\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(entrypoint, 'The exported startup entrypoint must be exercised.');
  const createServer = () => {};
  return runInNewContext(`(${entrypoint.replace('export ', '')})`, {
    ROOT: root, selectedDataset: independent, defaultGameDirectory, prepareGameStorage, verifyDatasetBinding, createServer,
    startEarlyServer(options, factory) { assert.equal(factory, createServer); started.push(options); return options; },
  });
}

test('exported standby startup refuses missing and unbound storage without preparing files or early listeners', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-profile-'));
  try {
    const started = [], startServer = await storageStartup(root, started);
    const missing = path.join(root, 'missing-parent', 'saved-game');
    await assert.rejects(startServer({ dataDir: missing, liveSwap: { standby: true } }), /existing bound storage/);
    assert.deepEqual(await readdir(root), []);
    const unbound = path.join(root, 'unbound');
    await mkdir(unbound); await writeFile(path.join(unbound, 'state.json'), 'unbound save');
    const before = await stat(path.join(unbound, 'state.json'));
    await assert.rejects(startServer({ dataDir: unbound, liveSwap: { standby: true } }), /existing bound storage/);
    assert.equal(await readFile(path.join(unbound, 'state.json'), 'utf8'), 'unbound save');
    assert.equal((await stat(path.join(unbound, 'state.json'))).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(unbound), ['state.json']);
    assert.deepEqual(await readdir(root), ['unbound']);
    assert.equal(started.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exported bound standby startup preserves storage and forwards options to the early server', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-profile-'));
  try {
    const started = [], startServer = await storageStartup(root, started);
    const dataDir = path.join(root, 'saved-game');
    await prepareGameStorage(dataDir, independent);
    await mkdir(dataDir); await writeFile(path.join(dataDir, 'state.json'), 'bound save');
    const binding = await readFile(bindingPath(dataDir)), before = await stat(bindingPath(dataDir));
    const options = { dataDir, port: 18780, liveSwap: { standby: true, strict: true } };
    const result = await startServer(options);
    assert.equal(started.length, 1); assert.equal(result, started[0]);
    assert.equal(result.dataDir, dataDir); assert.equal(result.port, options.port); assert.equal(result.liveSwap, options.liveSwap);
    assert.deepEqual(await readFile(bindingPath(dataDir)), binding);
    assert.equal((await stat(bindingPath(dataDir))).mtimeMs, before.mtimeMs);
    assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), 'bound save');
    assert.deepEqual(await readdir(dataDir), ['state.json']);
    assert.deepEqual((await readdir(root)).sort(), ['saved-game', 'saved-game.dataset.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
