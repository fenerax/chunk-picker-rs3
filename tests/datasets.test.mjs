import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { resolveDataset, datasetDigest, encodeDatasetValue, decodeDatasetValue } from '../app/datasets.mjs';
import { buildDataPack, selectDataPack } from '../scripts/build-data-pack.mjs';
import { bindingPath, verifyDatasetBinding, bindDatasetStorage } from '../app/dataset-binding.mjs';
import { createArtProvider } from '../app/art-provider.mjs';
import { fixtureDataset, emptyMetadataDataset } from './helpers/server-dataset.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('shared server fixtures retain the complete default and absent-metadata dataset contracts', async t => {
  const fresh = await resolveDataset();
  assert.equal(fixtureDataset.digest, fresh.digest);
  assert.deepEqual(fixtureDataset.files, fresh.files);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picker-dataset-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const independent = await resolveDataset({ mapAssetsDir: path.join(directory, 'absent-map'), gameDataDir: path.join(directory, 'absent-game') });
  const shared = await emptyMetadataDataset();
  assert.equal(shared.digest, independent.digest);
  assert.deepEqual(shared.files, independent.files);
  assert.deepEqual(shared.capabilities, independent.capabilities);
  assert.deepEqual(shared.gameDefaults, independent.gameDefaults);
  assert.equal(await emptyMetadataDataset(), shared);
});

test('browser bootstrap uses the selected digest, decodes exact values and caches catalogue requests', async () => {
  const runtimeUrl = new URL('../app/dataset-runtime.mjs', import.meta.url);
  const source = (await readFile(runtimeUrl, 'utf8')).replace(/^export /gm, '')
    .replaceAll('import.meta.url', JSON.stringify(runtimeUrl.href));
  const digest = 'd'.repeat(64), requests = [];
  const payload = { schemaVersion: 1, dataset: { id: 'duo-legacy', version: 'fixture', health: 'healthy', digest }, capabilities: { cacheWalking: true },
    values: { fixture: encodeDatasetValue({ absent: undefined, ids: new Set(['stable:1']), map: new Map([['stable:1', undefined]]) }) } };
  const runtime = await runInNewContext(`(async () => { ${source}\nreturn { selectedDataset, datasetJSON, datasetValue }; })()`, { fetch: async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => url === '/data/dataset-runtime.json' ? payload : { selected: true } };
  } });
  assert.equal(runtime.selectedDataset.status().digest, digest);
  const value = runtime.datasetValue('fixture');
  assert.equal(Object.hasOwn(value, 'absent'), true); assert.equal(value.absent, undefined);
  assert.deepEqual([...value.ids], ['stable:1']); assert.equal(value.map.has('stable:1'), true);
  assert.equal(Object.isFrozen(value), true);
  const first = runtime.datasetJSON('app/data/fixture.json');
  assert.equal(runtime.datasetJSON('app/data/fixture.json'), first); await first;
  await runtime.datasetJSON('app/web/gallery-fixture-data.json');
  await runtime.datasetJSON('reference/original-picker/tasksMap.json');
  assert.deepEqual(requests.map(row => row.url), ['/data/dataset-runtime.json', `/data/fixture.json?digest=${digest}`,
    `/gallery-fixture-data.json?digest=${digest}`, `/api/dataset-input?key=reference%2Foriginal-picker%2FtasksMap.json&digest=${digest}`]);
  assert.ok(requests.every(row => row.options.credentials === 'same-origin' && row.options.cache === 'no-cache'));
});

test('data-only values retain own undefined properties and ordered Map/Set entries', () => {
  const original = { absent: undefined, entries: [undefined, { value: undefined }], map: new Map([['first', undefined], ['second', 3]]), set: new Set([undefined, 'value']) };
  const restored = decodeDatasetValue(JSON.parse(JSON.stringify(encodeDatasetValue(original))));
  assert.deepEqual(restored, original);
  assert.equal(Object.hasOwn(restored, 'absent'), true);
  assert.equal(Object.hasOwn(restored.entries[1], 'value'), true);
  assert.deepEqual([...restored.map.keys()], ['first', 'second']);
});
async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'picker-dataset-test-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const sourceRoot = path.join(temp, 'source'), packsDir = path.join(temp, 'packs');
  const inputs = ['app/data/catalogue.json', 'app/data/original-rules-ui.2026-10-08.v1.json', 'local-map/optional.json', 'app/data/legacy-dataset-values.2026-10-13.v1.json', 'app/data/legacy-rules-text-values.2026-10-13.v1.json'];
  const sourceInputs = ['app/data/authored.mjs'];
  inputs.push('app/data/rule-explanations.2026-10-17.v1.json');
  const values = { contract: { enabled: true }, ids: new Set(['stable:1']), labels: { enabled: 'Fixture label' } };
  const contents = new Map([[inputs[0], Buffer.from('{"chunks":{"1":{"name":"Fixture"}}}\r\n')], [inputs[1], Buffer.from('{"rules":[{"key":"enabled","default":true,"label":"Fixture rule"}],"presets":[{"name":"fixture","values":{"enabled":true}}]}\r\n')], [sourceInputs[0], Buffer.from('throw new Error("Pack evidence must never execute");\r\n')],
    [inputs[3], Buffer.from(`${JSON.stringify({ schemaVersion: 1, values: encodeDatasetValue({ contract: values.contract, ids: values.ids }) })}\r\n`)],
    [inputs[4], Buffer.from(`${JSON.stringify({ schemaVersion: 1, values: { labels: values.labels } })}\r\n`)],
    [inputs[5], Buffer.from('{"schemaVersion":1,"entries":{}}\r\n')]]);
  for (const [relative, bytes] of contents) { const filename = path.join(sourceRoot, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); }
  return { temp, sourceRoot, root: sourceRoot, packsDir, mapAssetsDir: path.join(temp, 'missing-map'), gameDataDir: path.join(temp, 'missing-game'), inputs, sourceInputs, valueKeys: ['contract', 'ids', 'labels'], ruleTextValueKeys: ['labels'], ruleContractValueKeys: ['contract'], values, contents, environment: {} };
}
async function tamperManifest(options, built, kind, mutate) {
  for (const [root, original] of [[built.directory, built.manifest], [built.rulesTextDirectory, built.rulesTextManifest]])
    await writeFile(path.join(root, 'pack.json'), `${JSON.stringify(original, null, 2)}\n`);
  const directory = kind === 'data' ? built.directory : built.rulesTextDirectory;
  const manifest = JSON.parse(await readFile(path.join(directory, 'pack.json'), 'utf8')); mutate(manifest);
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`); await writeFile(path.join(directory, 'pack.json'), bytes);
  const selection = structuredClone(built.selection); selection[kind === 'data' ? 'data' : 'rulesText'].sha256 = hash(bytes);
  return { ...options, selection };
}

test('paired builder includes explanations only in Rules text, independently versions it, and retains the combined dataset digest', async t => {
  const options = await fixture(t);
  const explanations = 'app/data/rule-explanations.2026-10-17.v1.json';
  options.inputs = options.inputs.filter(key => key !== explanations);
  await writeFile(path.join(options.sourceRoot,explanations), JSON.stringify({schemaVersion:1,rules:[]}));
  const built = await buildDataPack({...options,version:'2.0.0',rulesTextVersion:'3.0.0',includeExplanations:true});
  assert.equal(built.manifest.version,'2.0.0');
  assert.equal(built.rulesTextManifest.version,'3.0.0');
  assert.ok(built.rulesTextManifest.files.some(record=>record.path===explanations));
  assert.ok(!built.manifest.files.some(record=>record.path===explanations));
  const provider = await resolveDataset({...options,inputs:[...options.inputs,explanations]});
  assert.deepEqual(provider.json(explanations),{schemaVersion:1,rules:[]});
  assert.equal(provider.digest,built.digest);
  await assert.rejects(resolveDataset(options),{code:'DATASET_PACK_INVALID'},'old catalogue cannot silently accept extra text inputs');
  await assert.rejects(buildDataPack({...options,version:'4.0.0',rulesTextVersion:'3.0.0',includeExplanations:true}),{code:'EEXIST'});
});

test('tracked and packed providers preserve raw bytes, values, digest, and separate rule presentation', async t => {
  const options = await fixture(t), tracked = await resolveDataset({ ...options, selection: null });
  assert.equal(tracked.status().version, 'tracked');
  assert.equal(tracked.value('contract', () => options.values.contract), options.values.contract);
  assert.deepEqual(tracked.value('ids'), options.values.ids);
  const built = await buildDataPack(options), packed = await resolveDataset(options);
  assert.equal(packed.digest, tracked.digest); assert.equal(packed.digest, built.digest);
  assert.deepEqual(packed.value('ids', () => assert.fail('pack fallback invoked')), options.values.ids);
  assert.deepEqual(packed.value('labels'), options.values.labels);
  assert.throws(() => packed.value('missing', () => 1), { code: 'DATASET_PACK_INVALID' });
  for (const relative of options.inputs.filter(key => options.contents.has(key))) assert.deepEqual(packed.bytes(relative), options.contents.get(relative));
  assert.deepEqual(packed.json(options.inputs[0]).chunks, { 1: { name: 'Fixture' } });
  assert.throws(() => packed.bytes(options.sourceInputs[0]), { code: 'DATASET_PACK_INVALID' });
  assert(built.manifest.files.some(record => record.kind === 'evidence'));
  assert(!built.manifest.files.some(record => record.path.includes('original-rules-ui')));
  assert(built.rulesTextManifest.files.some(record => record.path.includes('original-rules-ui')));
  assert(!built.manifest.files.some(record => record.path.includes('rule-explanations')));
  assert(built.rulesTextManifest.files.some(record => record.path.includes('rule-explanations')));
  assert.equal(JSON.stringify(packed.status()).includes(options.temp), false);
  await assert.rejects(buildDataPack(options), { code: 'EEXIST' });
});

test('absent or valid art-only selection uses tracked provider; malformed present selection fails closed', async t => {
  const options = await fixture(t);
  assert.equal((await resolveDataset(options)).packed, false);
  await mkdir(options.packsDir);
  for (const value of [{ schemaVersion: 1, art: null }, { schemaVersion: 1, art: { id: 'duo-art', version: '1.0.0', sha256: 'a'.repeat(64) } }]) {
    await writeFile(path.join(options.packsDir, 'selection.json'), JSON.stringify(value)); assert.equal((await resolveDataset(options)).packed, false);
  }
  for (const value of ['{', JSON.stringify({ schemaVersion: 2, art: null }), JSON.stringify({ schemaVersion: 1, data: {} }), JSON.stringify({ schemaVersion: 1 })]) {
    await writeFile(path.join(options.packsDir, 'selection.json'), value); await assert.rejects(resolveDataset(options), { code: 'DATASET_PACK_INVALID' });
  }
});

test('invalid or missing art choices retain artwork fallback without blocking tracked or selected gameplay data', async t => {
  const options = await fixture(t); await mkdir(options.mapAssetsDir);
  const fallback = Buffer.from('{"source":"synthetic-local-fallback"}'); await writeFile(path.join(options.mapAssetsDir, 'optional.json'), fallback);
  const baseline = await resolveDataset({ ...options, selection: { schemaVersion: 1, art: null } });
  for (const art of [{}, 'invalid', { id: 'different-art', version: '1.0.0', sha256: 'a'.repeat(64) }, { id: 'duo-art', version: 'invalid', sha256: 'a'.repeat(64) }, { id: 'duo-art', version: '1.0.0', sha256: 'bad-hash' }, { id: 'duo-art', version: '99.0.0', sha256: 'a'.repeat(64) }]) {
    const selection = { schemaVersion: 1, art }, provider = await resolveDataset({ ...options, selection });
    assert.equal(provider.packed, false); assert.equal(provider.digest, baseline.digest);
    assert.deepEqual(provider.bytes('local-map/optional.json'), fallback);
    const artwork = await createArtProvider({ packsDir: options.packsDir, selection, overrides: { mapAssets: options.mapAssetsDir } });
    assert.equal(artwork.pack.status().health, 'invalid');
    assert.equal(await artwork.file('mapAssets', 'optional.json'), path.join(options.mapAssetsDir, 'optional.json'));
  }
  const built = await buildDataPack({ ...options, select: false });
  const selected = await resolveDataset({ ...options, selection: { ...built.selection, art: {} } });
  assert.equal(selected.packed, true); assert.equal(selected.digest, baseline.digest);
  await assert.rejects(resolveDataset({ ...options, selection: { ...built.selection, art: {}, data: {} } }), { code: 'DATASET_PACK_INVALID' });
});

test('required rule text, receipt hashes, contract compatibility and all selected bytes fail before activation', async t => {
  const options = await fixture(t), built = await buildDataPack(options);
  for (const selection of [{ schemaVersion: 1, data: built.selection.data }, { ...built.selection, data: { ...built.selection.data, sha256: '0'.repeat(64) } }]) await assert.rejects(resolveDataset({ ...options, selection }), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset(await tamperManifest(options, built, 'rulesText', manifest => manifest.ruleContractHash = 'f'.repeat(64))), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset(await tamperManifest(options, built, 'data', manifest => manifest.overlayOrder.tasks.reverse())), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset(await tamperManifest(options, built, 'data', manifest => manifest.requires.datasetId = 'other')), { code: 'DATASET_PACK_INVALID' });
});

test('eager validation includes unused evidence; reopen catches changed inputs and refuses pack links', async t => {
  const options = await fixture(t), built = await buildDataPack(options), provider = await resolveDataset(options);
  await writeFile(path.join(built.directory, options.inputs[0]), '{"corrupt":true}');
  assert.throws(() => provider.bytes(options.inputs[0]), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset(options), { code: 'DATASET_PACK_INVALID' });
  await writeFile(path.join(built.directory, options.inputs[0]), options.contents.get(options.inputs[0]));
  await writeFile(path.join(built.directory, options.sourceInputs[0]), 'console.log("unexpected");');
  await assert.rejects(resolveDataset(options), { code: 'DATASET_PACK_INVALID' });
  const file = path.join(built.directory, options.sourceInputs[0]); await rm(file);
  await symlink(path.join(options.sourceRoot, options.sourceInputs[0]), file, 'file');
  await assert.rejects(resolveDataset(options), { code: 'DATASET_PACK_INVALID' });
});

test('re-pinned generated indexes and semantic rules cannot bypass the raw input contract', async t => {
  const options = await fixture(t), built = await buildDataPack(options);
  const target = path.join(built.directory, 'indexes/values.json'), snapshot = JSON.parse(await readFile(target, 'utf8'));
  snapshot.values.contract.enabled = false; const changed = Buffer.from(JSON.stringify(snapshot)); await writeFile(target, changed);
  const tampered = await tamperManifest(options, built, 'data', manifest => { const record = manifest.files.find(record => record.path === 'indexes/values.json'); record.bytes = changed.length; record.sha256 = hash(changed); });
  await assert.rejects(resolveDataset(tampered), { code: 'DATASET_PACK_INVALID' });
  const second = await buildDataPack({ ...options, version: '1.0.1' });
  const capturePath = options.inputs[1], capture = JSON.parse(options.contents.get(capturePath)); capture.rules[0].default = false;
  const captureBytes = Buffer.from(JSON.stringify(capture)); await writeFile(path.join(second.rulesTextDirectory, capturePath), captureBytes);
  const alteredText = await tamperManifest(options, second, 'rulesText', manifest => { const record = manifest.files.find(record => record.path === capturePath); record.bytes = captureBytes.length; record.sha256 = hash(captureBytes); });
  await assert.rejects(resolveDataset(alteredText), { code: 'DATASET_PACK_INVALID' });
  await writeFile(path.join(second.rulesTextDirectory, capturePath), options.contents.get(capturePath));
  const missingInput = await tamperManifest(options, second, 'data', manifest => { manifest.files = manifest.files.filter(record => record.path !== options.inputs[0]); });
  await assert.rejects(resolveDataset(missingInput), { code: 'DATASET_PACK_INVALID' });
});

test('worker descriptor pins receipt and environment even after operator selection changes', async t => {
  const options = await fixture(t), first = await buildDataPack({ ...options, environment: { RS3_CACHE_SHOP_CONTENTS: '1' } });
  const selected = await resolveDataset(options), descriptor = selected.workerSelection();
  await buildDataPack({ ...options, version: '1.0.1' });
  const worker = await resolveDataset({ ...options, ...descriptor });
  assert.equal(worker.status().version, '1.0.0'); assert.equal(worker.capabilities.cacheShops, true); assert.equal(worker.digest, first.digest);
  assert.equal((await resolveDataset(options)).status().version, '1.0.1');
  await assert.rejects(resolveDataset({ ...options, ...descriptor, digest: '0'.repeat(64) }), { code: 'DATASET_PACK_INVALID' });
});

test('selection update keeps art and exact rollback bytes; no-select leaves receipt untouched', async t => {
  const options = await fixture(t); await mkdir(options.packsDir);
  const prior = Buffer.from('{ "schemaVersion": 1, "art": null }\r\n'); await writeFile(path.join(options.packsDir, 'selection.json'), prior);
  const built = await buildDataPack({ ...options, select: false });
  assert.deepEqual(await readFile(path.join(options.packsDir, 'selection.json')), prior);
  const next = await selectDataPack({ ...options, selection: built.selection });
  assert.equal(next.art, null); assert.deepEqual(await readFile(path.join(options.packsDir, 'selection.json.previous')), prior);
  await buildDataPack({ ...options, version: '1.0.1' });
  const previous = JSON.parse(await readFile(path.join(options.packsDir, 'selection.json.previous'), 'utf8'));
  assert.equal(previous.data.sha256, built.selection.data.sha256);
});

test('operator binding only creates sibling receipt and refuses mismatched provider before touching storage', async t => {
  const options = await fixture(t), dataset = await resolveDataset({ ...options, selection: null }), dataDir = path.join(options.temp, 'disposable-store');
  await mkdir(dataDir); const save = Buffer.from('{"revision":12,"synthetic":true}\r\n'); await writeFile(path.join(dataDir, 'state.json'), save);
  assert.equal((await verifyDatasetBinding(dataDir, dataset)).bound, false);
  assert.equal((await bindDatasetStorage(dataDir, dataset)).bound, true);
  const receipt = await readFile(bindingPath(dataDir));
  await bindDatasetStorage(dataDir, dataset); assert.deepEqual(await readFile(bindingPath(dataDir)), receipt);
  const mismatch = { ...dataset, digest: 'f'.repeat(64) };
  await assert.rejects(verifyDatasetBinding(dataDir, mismatch), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(bindDatasetStorage(dataDir, mismatch), { code: 'DATASET_BINDING_MISMATCH' });
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), save); assert.deepEqual(await readFile(bindingPath(dataDir)), receipt);
});

test('storage directory aliases cannot bypass the physical directory sibling binding', async t => {
  const options = await fixture(t), target = path.join(options.temp, 'physical-synthetic-storage'), alias = path.join(options.temp, 'alias-synthetic-storage');
  const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'a'.repeat(64), packed: true };
  await mkdir(target); const save = Buffer.from('{"synthetic":true,"revision":17}\r\n'); await writeFile(path.join(target, 'state.json'), save);
  await bindDatasetStorage(target, dataset); const receipt = await readFile(bindingPath(target));
  await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const storageEntries = (await readdir(target)).sort(), parentEntries = (await readdir(options.temp)).sort();
  assert.notEqual(bindingPath(alias), bindingPath(target));
  await assert.rejects(verifyDatasetBinding(alias, { ...dataset, packed: false }), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(verifyDatasetBinding(alias, dataset), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(bindDatasetStorage(alias, dataset), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(readFile(bindingPath(alias)), { code: 'ENOENT' });
  assert.equal((await verifyDatasetBinding(target, dataset)).bound, true);
  assert.deepEqual(await readFile(path.join(target, 'state.json')), save); assert.deepEqual(await readFile(bindingPath(target)), receipt);
  assert.deepEqual((await readdir(target)).sort(), storageEntries); assert.deepEqual((await readdir(options.temp)).sort(), parentEntries);
  const ordinary = path.join(options.temp, 'ordinary-unbound-storage'); await mkdir(ordinary);
  assert.equal((await verifyDatasetBinding(ordinary, dataset)).bound, false);
  assert.equal((await verifyDatasetBinding(path.join(options.temp, 'not-created-storage'), dataset)).bound, false);
});

test('tag codec preserves nested maps and sets without interpreting plain JSON as executable content', () => {
  const value = { nested: new Map([['key', new Set(['one', 'two'])]]) };
  assert.deepEqual(decodeDatasetValue(JSON.parse(JSON.stringify(encodeDatasetValue(value)))), value);
  assert.throws(() => decodeDatasetValue({ $datasetType: 'Code', entries: [] }), { code: 'DATASET_PACK_INVALID' });
});

async function metadataArtPack(options) {
  const directory = path.join(options.packsDir, 'duo-art', '1.0.0'), records = [];
  for (const [relative, value] of [['map-assets/optional.json', { source: 'pack' }], ['indexes/art-bindings.json', { schemaVersion: 1, bindings: [] }], ['provenance.json', { source: 'synthetic' }]]) {
    const filename = path.join(directory, relative), bytes = Buffer.from(`${JSON.stringify(value)}\r\n`);
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); records.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { schemaVersion: 1, id: 'duo-art', kind: 'art', version: '1.0.0', distribution: 'private-local',
    requires: { corePackApi: 1, datasetId: 'duo-legacy', datasetContractVersion: 1, coordinateSystem: 'surface-grid-v1' },
    roots: { mapAssets: 'map-assets' }, catalogues: { artBindings: 'indexes/art-bindings.json' }, provenance: 'provenance.json', files: records };
  const bytes = Buffer.from(JSON.stringify(manifest)); await writeFile(path.join(directory, 'pack.json'), bytes);
  const selection = { schemaVersion: 1, art: { id: manifest.id, version: manifest.version, sha256: hash(bytes) } };
  await writeFile(path.join(options.packsDir, 'selection.json'), JSON.stringify(selection)); return { directory, selection };
}

test('tracked local metadata preserves override, selected art and tracked fallback order per file', async t => {
  const operatorMapAssets = process.env.RS3_MAP_ASSETS_DIR;
  try {
    delete process.env.RS3_MAP_ASSETS_DIR;
    const options = await fixture(t), art = await metadataArtPack(options), defaultDir = path.join(options.sourceRoot, '.local', 'map-assets'), overrideDir = path.join(options.temp, 'override-map');
    delete options.mapAssetsDir;
    await mkdir(defaultDir, { recursive: true }); await mkdir(overrideDir);
    await writeFile(path.join(defaultDir, 'optional.json'), '{"source":"default"}');
    options.inputs.push('local-map/fallback.json'); await writeFile(path.join(defaultDir, 'fallback.json'), '{"source":"per-file-default"}');
    await writeFile(path.join(options.packsDir, 'selection.json'), '{"schemaVersion":1,"art":null}');
    const packedMetadata = await resolveDataset({ ...options, selection: art.selection });
    assert.deepEqual(packedMetadata.json('local-map/optional.json'), { source: 'pack' });
    assert.deepEqual(packedMetadata.json('local-map/fallback.json'), { source: 'per-file-default' });
    assert.equal(packedMetadata.sourceFile('local-map/optional.json'), path.join(art.directory, 'map-assets', 'optional.json'));
    assert.equal(packedMetadata.sourceFile(options.sourceInputs[0]), path.join(options.sourceRoot, options.sourceInputs[0]));
    await writeFile(path.join(overrideDir, 'optional.json'), '{"source":"override"}');
    const overridden = await resolveDataset({ ...options, mapAssetsDir: overrideDir, selection: art.selection });
    assert.deepEqual(overridden.json('local-map/optional.json'), { source: 'override' });
    assert.throws(() => overridden.json('local-map/fallback.json'), { code: 'DATASET_PACK_INVALID' });
    const defaults = await resolveDataset({ ...options, selection: { schemaVersion: 1, art: null } });
    assert.deepEqual(defaults.json('local-map/optional.json'), { source: 'default' });
  } finally {
    if (operatorMapAssets === undefined) delete process.env.RS3_MAP_ASSETS_DIR;
    else process.env.RS3_MAP_ASSETS_DIR = operatorMapAssets;
  }
});

test('worker metadata snapshots and absence remain frozen after operator art receipt changes', async t => {
  const options = await fixture(t), art = await metadataArtPack(options), provider = await resolveDataset({ ...options, selection: art.selection }), descriptor = provider.workerSelection();
  assert.equal(Object.isFrozen(descriptor.legacyMetadataFiles), true);
  await writeFile(path.join(options.packsDir, 'selection.json'), '{"schemaVersion":1,"art":null}');
  const worker = await resolveDataset({ ...options, ...descriptor });
  assert.equal(worker.digest, provider.digest); assert.deepEqual(worker.json('local-map/optional.json'), { source: 'pack' });
  await writeFile(path.join(art.directory, 'map-assets', 'optional.json'), '{"source":"modified"}');
  const unchangedWorker = await resolveDataset({ ...options, ...descriptor });
  assert.equal(unchangedWorker.digest, provider.digest); assert.deepEqual(unchangedWorker.json('local-map/optional.json'), { source: 'pack' });
  assert.throws(() => provider.sourceFile('local-map/optional.json'), { code: 'DATASET_PACK_INVALID' });
  const absentOptions = await fixture(t), absent = await resolveDataset({ ...absentOptions, selection: null }), absentDescriptor = absent.workerSelection();
  await mkdir(absentOptions.mapAssetsDir); await writeFile(path.join(absentOptions.mapAssetsDir, 'optional.json'), '{"source":"appeared-later"}');
  const absentWorker = await resolveDataset({ ...absentOptions, ...absentDescriptor });
  assert.equal(absentWorker.digest, absent.digest); assert.throws(() => absentWorker.bytes('local-map/optional.json'), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset({ ...absentOptions, ...absentDescriptor, legacyMetadataFiles: { 'app/data/catalogue.json': path.join(absentOptions.sourceRoot, absentOptions.inputs[0]) } }), { code: 'DATASET_PACK_INVALID' });
});

test('builder preserves selected art metadata ahead of conflicting local defaults when no override is configured', async t => {
  const operatorMapAssets = process.env.RS3_MAP_ASSETS_DIR;
  try {
    delete process.env.RS3_MAP_ASSETS_DIR;
    const options = await fixture(t); delete options.mapAssetsDir;
    await metadataArtPack(options);
    const defaults = path.join(options.sourceRoot, '.local', 'map-assets'); await mkdir(defaults, { recursive: true });
    await writeFile(path.join(defaults, 'optional.json'), '{"source":"conflicting-local-default"}');
    const tracked = await resolveDataset(options); assert.deepEqual(tracked.json('local-map/optional.json'), { source: 'pack' });
    const built = await buildDataPack({ ...options, select: false }), selected = await resolveDataset({ ...options, selection: built.selection });
    assert.equal(built.digest, tracked.digest); assert.equal(selected.digest, tracked.digest);
    assert.deepEqual(selected.bytes('local-map/optional.json'), tracked.bytes('local-map/optional.json'));
    assert.deepEqual(selected.json('local-map/optional.json'), { source: 'pack' });
  } finally {
    if (operatorMapAssets === undefined) delete process.env.RS3_MAP_ASSETS_DIR;
    else process.env.RS3_MAP_ASSETS_DIR = operatorMapAssets;
  }
});

test('legacy display metadata can appear after startup while startup input receipts remain frozen', async t => {
  const options = await fixture(t);
  options.inputs.push('local-map/manifest.json', 'local-map/pins.normalized.json');
  const provider = await resolveDataset({ ...options, selection: { schemaVersion: 1, art: null } }), before = provider.digest;
  assert.equal(await provider.metadataBytes('local-map/manifest.json'), null);
  await mkdir(options.mapAssetsDir);
  const manifest = Buffer.from('{"pins":{"path":"pins.normalized.json"}}\r\n'), pins = Buffer.from('[{"id":"late-synthetic-pin"}]\r\n');
  await writeFile(path.join(options.mapAssetsDir, 'manifest.json'), manifest);
  await writeFile(path.join(options.mapAssetsDir, 'pins.normalized.json'), pins);
  assert.deepEqual(await provider.metadataBytes('local-map/manifest.json'), manifest);
  assert.deepEqual(await provider.metadataBytes('local-map/pins.normalized.json'), pins);
  assert.equal(await provider.metadataBytes('local-map/not-declared.json'), null);
  assert.equal(provider.files.some(record => record.path === 'local-map/manifest.json'), false);
  assert.throws(() => provider.bytes('local-map/manifest.json'), { code: 'DATASET_PACK_INVALID' });
  assert.equal(provider.digest, before);
  const changed = Buffer.from('[{"id":"updated-synthetic-pin"}]'); await writeFile(path.join(options.mapAssetsDir, 'pins.normalized.json'), changed);
  assert.deepEqual(await provider.metadataBytes('local-map/pins.normalized.json'), changed);
});

test('legacy display metadata retains fixed art selection and override roots across receipt or environment edits', async t => {
  const options = await fixture(t), art = await metadataArtPack(options), provider = await resolveDataset({ ...options, selection: art.selection });
  await writeFile(path.join(options.packsDir, 'selection.json'), '{"schemaVersion":1,"art":null}');
  assert.deepEqual(JSON.parse((await provider.metadataBytes('local-map/optional.json')).toString('utf8')), { source: 'pack' });
  const alternate = path.join(options.temp, 'unselected-map'); await mkdir(alternate); await writeFile(path.join(alternate, 'optional.json'), '{"source":"unselected"}');
  const operatorMapAssets = process.env.RS3_MAP_ASSETS_DIR;
  try {
    process.env.RS3_MAP_ASSETS_DIR = alternate;
    await mkdir(options.mapAssetsDir); await writeFile(path.join(options.mapAssetsDir, 'optional.json'), '{"source":"captured-override"}');
    assert.deepEqual(JSON.parse((await provider.metadataBytes('local-map/optional.json')).toString('utf8')), { source: 'captured-override' });
  } finally {
    if (operatorMapAssets === undefined) delete process.env.RS3_MAP_ASSETS_DIR;
    else process.env.RS3_MAP_ASSETS_DIR = operatorMapAssets;
  }
});

test('tracked worker metadata snapshots survive updates and deletion without changing raw startup receipts', async t => {
  const options = await fixture(t), key = 'local-map/optional.json'; await mkdir(options.mapAssetsDir);
  const original = Buffer.from('{"source":"original-display-metadata"}\r\n'); await writeFile(path.join(options.mapAssetsDir, 'optional.json'), original);
  const provider = await resolveDataset({ ...options, selection: { schemaVersion: 1, art: null } }), digest = provider.digest;
  const initialRecords = structuredClone(provider.files), descriptor = provider.workerSelection();
  assert.equal(Object.isFrozen(descriptor.legacyMetadataSnapshots), true);
  const updated = Buffer.from('{"source":"updated-display-metadata"}'); await writeFile(path.join(options.mapAssetsDir, 'optional.json'), updated);
  const lazyWorker = await resolveDataset({ ...options, ...descriptor });
  assert.equal(lazyWorker.digest, digest); assert.deepEqual(lazyWorker.bytes(key), original);
  assert.deepEqual(lazyWorker.json(key), { source: 'original-display-metadata' });
  assert.deepEqual(await provider.metadataBytes(key), updated);
  assert.deepEqual(await lazyWorker.metadataBytes(key), updated);
  assert.throws(() => provider.bytes(key), { code: 'DATASET_PACK_INVALID' });
  assert.throws(() => provider.sourceFile(key), { code: 'DATASET_PACK_INVALID' });
  await rm(path.join(options.mapAssetsDir, 'optional.json'));
  const restartedWorker = await resolveDataset({ ...options, ...provider.workerSelection() });
  assert.equal(restartedWorker.digest, digest); assert.deepEqual(restartedWorker.bytes(key), original);
  assert.equal(await restartedWorker.metadataBytes(key), null);
  assert.deepEqual(provider.files, initialRecords); assert.equal(provider.digest, digest);
  const damaged = structuredClone(descriptor); damaged.legacyMetadataSnapshots[key].sha256 = '0'.repeat(64);
  await assert.rejects(resolveDataset({ ...options, ...damaged }), { code: 'DATASET_PACK_INVALID' });
  const wrongKey = structuredClone(descriptor); wrongKey.legacyMetadataSnapshots['app/data/catalogue.json'] = wrongKey.legacyMetadataSnapshots[key];
  await assert.rejects(resolveDataset({ ...options, ...wrongKey }), { code: 'DATASET_PACK_INVALID' });
});

test('selected dataset metadata absence never falls back to newly available local metadata', async t => {
  const options = await fixture(t), built = await buildDataPack({ ...options, select: false }), packed = await resolveDataset({ ...options, selection: built.selection });
  await mkdir(options.mapAssetsDir); await writeFile(path.join(options.mapAssetsDir, 'optional.json'), '{"source":"unselected-local"}');
  assert.equal(await packed.metadataBytes('local-map/optional.json'), null);
  assert.equal(await packed.metadataBytes('app/data/catalogue.json'), null);
  assert.throws(() => packed.bytes('local-map/optional.json'), { code: 'DATASET_PACK_INVALID' });
  const tracked = await resolveDataset({ ...options, selection: null });
  await assert.rejects(resolveDataset({ ...options, selection: built.selection, legacyMetadataSnapshots: tracked.workerSelection().legacyMetadataSnapshots }), { code: 'DATASET_PACK_INVALID' });
});

test('eager selected validation rejects malformed unused JSON and gzipped JSON after legitimate receipt repinning', async t => {
  for (const compressed of [false, true]) {
    const options = await fixture(t), key = compressed ? 'local-game/lazy.json.gz' : 'app/data/lazy.json'; options.inputs.push(key);
    const source = compressed ? path.join(options.gameDataDir, 'lazy.json.gz') : path.join(options.sourceRoot, key);
    await mkdir(path.dirname(source), { recursive: true }); await writeFile(source, compressed ? gzipSync('{"valid":true}') : '{"valid":true}');
    const built = await buildDataPack(options), before = await resolveDataset(options), invalid = compressed ? gzipSync('{"broken":') : Buffer.from('{"broken":');
    await writeFile(path.join(built.directory, key), invalid);
    const records = before.files.map(record => record.path === key ? { ...record, bytes: invalid.length, sha256: hash(invalid) } : record);
    const tampered = await tamperManifest(options, built, 'data', manifest => {
      Object.assign(manifest.files.find(record => record.path === key), { bytes: invalid.length, sha256: hash(invalid) });
      manifest.datasetDigest = datasetDigest(records, before.capabilities);
    });
    await assert.rejects(resolveDataset(tampered), { code: 'DATASET_PACK_INVALID' });
  }
});

test('selected-pack binding requires a pack even when tracked inputs have the identical digest', async t => {
  const options = await fixture(t), tracked = await resolveDataset({ ...options, selection: null }); await buildDataPack(options);
  const packed = await resolveDataset(options), dataDir = path.join(options.temp, 'bound-synthetic-storage');
  assert.equal(packed.digest, tracked.digest);
  await bindDatasetStorage(dataDir, packed); const receipt = await readFile(bindingPath(dataDir));
  assert.equal(JSON.parse(receipt).requiresPack, true);
  assert.equal((await verifyDatasetBinding(dataDir, packed)).bound, true);
  await assert.rejects(verifyDatasetBinding(dataDir, tracked), { code: 'DATASET_BINDING_MISMATCH' });
  await assert.rejects(bindDatasetStorage(dataDir, tracked), { code: 'DATASET_BINDING_MISMATCH' });
  assert.deepEqual(await readFile(bindingPath(dataDir)), receipt);
  const oldDir = path.join(options.temp, 'old-tracked-binding'); await bindDatasetStorage(oldDir, tracked);
  const oldReceipt = await readFile(bindingPath(oldDir)); assert.equal(Object.keys(JSON.parse(oldReceipt)).length, 4);
  assert.equal((await verifyDatasetBinding(oldDir, tracked)).bound, true);
  assert.equal((await verifyDatasetBinding(oldDir, packed)).bound, true);
  assert.deepEqual(await readFile(bindingPath(oldDir)), oldReceipt);
  await bindDatasetStorage(oldDir, packed); const promoted = JSON.parse(await readFile(bindingPath(oldDir), 'utf8'));
  assert.deepEqual(promoted, { ...JSON.parse(oldReceipt), requiresPack: true });
  await assert.rejects(verifyDatasetBinding(oldDir, tracked), { code: 'DATASET_BINDING_MISMATCH' });
});
