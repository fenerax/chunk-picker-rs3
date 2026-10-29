import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encode, decode } from '../calculator/bundle/codec.mjs';
import { exportBundle } from '../calculator/bundle/export.mjs';
import { loadBundle, sha256 } from '../calculator/bundle/load.mjs';

process.env.RS3_DATASET = 'open-f2p';
const { selectedDataset: dataset } = await import('../app/dataset-runtime.mjs');

test('bundle codec preserves maps, sets, undefined and own data keys without V8', () => {
  const value = { world: new Map([['12341', { id: '12341' }]]), surface: new Set(['12341']), missing: undefined,
    ordinary: JSON.parse('{"__proto__":{"safe":true}}') };
  assert.deepEqual(decode(JSON.parse(JSON.stringify(encode(value)))), value);
  for (const invalid of [{ $datasetType: 'Unknown' }, { $datasetType: 'Map', entries: [1] }]) assert.throws(() => decode(invalid));
  assert.throws(() => encode({ executable() {} }));
});

test('bundle verifies identity, bytes, paths, versions and externally pinned provenance', async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'calculator-bundle-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = path.join(scratch, 'bundle');
  const summary = await exportBundle(directory, { dataset });
  const loaded = await loadBundle(directory, { expectedDatasetDigest: dataset.digest, expectedManifestSha256: summary.manifestSha256 });
  assert.equal(loaded.bytes, summary.bytes);
  assert.ok(loaded.init.world.chunks instanceof Map);
  assert.ok(loaded.init.world.surface instanceof Set);
  assert.equal(loaded.provider.digest, dataset.digest);
  for (const input of loaded.audit.inputs) {
    assert.deepEqual(input.kind === 'value' ? loaded.provider.value(input.key) : loaded.provider.json(input.key),
      input.kind === 'value' ? dataset.value(input.key) : await dataset.json(input.key));
  }
  assert.throws(() => loaded.provider.json('missing'), /unavailable/);
  assert.throws(() => loaded.provider.value('missing'), /unavailable/);
  await assert.rejects(exportBundle(directory, { dataset }), { code: 'EEXIST' });
  await assert.rejects(loadBundle(directory, { expectedDatasetDigest: '0'.repeat(64) }), /verification/);
  await assert.rejects(loadBundle(directory, { expectedManifestSha256: '0'.repeat(64) }), /verification/);
  const manifestPath = path.join(directory, 'manifest.json'), original = await readFile(manifestPath), manifest = JSON.parse(original);
  const saveManifest = value => writeFile(manifestPath, JSON.stringify(value));
  for (const bad of [
    { ...manifest, contractVersion: 2 },
    { ...manifest, files: [...manifest.files, manifest.files[0]] },
    { ...manifest, files: [{ ...manifest.files[0], file: '../escape.json' }, ...manifest.files.slice(1)] },
    { ...manifest, files: manifest.files.filter(row => row.file !== 'init.json') },
  ]) {
    await saveManifest(bad); await assert.rejects(loadBundle(directory), /verification/);
  }
  await writeFile(manifestPath, original);
  const initPath = path.join(directory, 'init.json'), initBytes = await readFile(initPath);
  await writeFile(initPath, Buffer.concat([initBytes, Buffer.from(' ')]));
  await assert.rejects(loadBundle(directory), /verification/);
  await writeFile(initPath, initBytes);
  const packRecord = manifest.files.find(row => row.file.startsWith('app/data/'));
  const packPath = path.join(directory, packRecord.file), packBytes = await readFile(packPath);
  const alteredPack = Buffer.concat([packBytes, Buffer.from(' ')]);
  await writeFile(packPath, alteredPack);
  await saveManifest({ ...manifest, files: manifest.files.map(row => row === packRecord
    ? { ...row, sha256: sha256(alteredPack), bytes: alteredPack.length } : row) });
  await assert.rejects(loadBundle(directory), /verification/);
  await writeFile(packPath, packBytes); await writeFile(manifestPath, original);
  // A new hash alone cannot disguise a changed dataset identity.
  const metadataPath = path.join(directory, 'dataset.json'), metadata = JSON.parse(await readFile(metadataPath));
  metadata.capabilities.independent = !metadata.capabilities.independent;
  metadata.gameDefaults.title += ' changed';
  const changed = Buffer.from(JSON.stringify(metadata));
  await writeFile(metadataPath, changed);
  await saveManifest({ ...manifest, files: manifest.files.map(row => row.file === 'dataset.json'
    ? { ...row, sha256: sha256(changed), bytes: changed.length } : row) });
  await assert.rejects(loadBundle(directory), /verification/);
  const linked = path.join(scratch, 'linked'); await symlink(directory, linked, 'dir');
  await assert.rejects(loadBundle(linked), /verification/);
});


test('native definition bytes and optional worker inputs survive portable export', async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'calculator-bundle-init-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const definitions = { chunks: { '12341': {} }, challenges: {} };
  const bytes = Buffer.from(JSON.stringify(definitions)), definitionBytes = new SharedArrayBuffer(bytes.length);
  Buffer.from(definitionBytes).set(bytes);
  const init = { definitionBytes, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions: { reviewedOverlays: false, cacheWalking: false }, preparedDatasetStages: ['equipmentCorrections'],
    world: { chunks: new Map([['12341', { id: '12341' }]]), areas: new Map(), surface: new Set(['12341']) },
    extraRules: [{ id: 'fixture.rule', type: 'boolean', default: false }],
    skillGuideCatalogue: { entries: [], generatedTasks: [] }, omitReadyCatalogue: true };
  const directory = path.join(scratch, 'bundle');
  await exportBundle(directory, { dataset, init });
  const loaded = await loadBundle(directory);
  const { definitionBytes: ignored, ...fields } = init;
  assert.deepEqual(loaded.init, { ...fields, definitions, datasetSelection: { datasetId: dataset.datasetId, digest: dataset.digest } });
});
