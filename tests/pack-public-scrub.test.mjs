import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { scrubPublicPack, scrubPublicDocument } from '../scripts/packs/scrub-public-pack.mjs';
import { addFingerprints, loadCorpus } from '../scripts/secret-scan/fingerprints.mjs';
import { scanEntries } from '../scripts/secret-scan/scan.mjs';
import { datasetDigest, resolveDataset } from '../app/datasets.mjs';
import { loadDatasetInputs } from '../app/dataset-bootstrap.mjs';
import { loadArtPack } from '../app/packs.mjs';
import { loadChunkSectionIndex, SECTION_INPUTS } from '../app/core/chunk-sections.mjs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { hasPackHomePath } from '../scripts/secret-scan/pack-patterns.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const repository = fileURLToPath(new URL('../', import.meta.url));
async function put(file, bytes) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); }
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'public-pack-scrub-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputDir = path.join(root, 'source'), rulesTextDir = path.join(root, 'rules');
  const files = [];
  for (const name of ['app/data/one.json', 'app/data/two.json']) {
    const bytes = Buffer.from('{ "synthetic": true, "label": "old" }\n');
    await put(path.join(inputDir, name), bytes);
    files.push({ path: name, kind: 'input', bytes: bytes.length, sha256: sha(bytes) });
  }
  const capabilities = { synthetic: true }, ruleContractHash = 'a'.repeat(64);
  const manifest = { schemaVersion: 1, id: 'duo-data', kind: 'data', version: '1.0.0', distribution: 'private-local',
    capabilities, ruleContractHash, files, datasetDigest: datasetDigest(files, capabilities) };
  await put(path.join(inputDir, 'pack.json'), encode(manifest));
  await put(path.join(rulesTextDir, 'pack.json'), encode({ schemaVersion: 1, id: 'duo-rules-text', kind: 'rules-text',
    version: '1.0.0', distribution: 'private-local', ruleContractHash, files: [] }));
  return { root, manifest, options: { inputDir, rulesTextDir, outputDir: path.join(root, 'clean'), version: '1.0.0-public.1' } };
}
const missing = file => assert.rejects(lstat(file), { code: 'ENOENT' });

test('public account defaults are removed in both mirrors; unrelated personal strings still block', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'public-pack-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinel = 'Invented-Pack-Identity-Sentinel';
  await addFingerprints([sentinel], path.join(root, 'corpus'));
  const corpus = await loadCorpus(path.join(root, 'corpus'));
  const binding = 'app/core/game-progress.mjs#defaultRuneScapeNames';
  for (const relative of ['indexes/values.json', 'app/data/legacy-dataset-values.2026-10-13.v1.json']) {
    const document = { values: { [binding]: { syntheticMember: sentinel }, geometry: { mapId: 28 } } };
    const result = scrubPublicDocument(document, relative);
    assert.equal(result.replacements, 1);
    assert.deepEqual(document.values[binding], {});
    assert.deepEqual(document.values.geometry, { mapId: 28 });
    assert.equal(scanEntries([{ path: relative, bytes: Buffer.from(JSON.stringify(document)) }], { corpus }).status, 'clean');
    assert.equal(scrubPublicDocument(document, relative).replacements, 0);
  }
  const untouched = { values: { [binding]: { syntheticMember: sentinel } } };
  assert.equal(scrubPublicDocument(untouched, 'app/data/game-facts.json').replacements, 0);
  assert.ok(scanEntries([{ path: 'app/data/game-facts.json', bytes: Buffer.from(JSON.stringify(untouched)) }], { corpus }).findings.some(row => row.category === 'private-fingerprint'));
});

test('no-op scrubbing preserves payload bytes and original source', async t => {
  const { options } = await fixture(t);
  const before = await readFile(path.join(options.inputDir, 'pack.json'));
  const result = await scrubPublicPack(options);
  assert.equal(result.changes.length, 0);
  for (const name of ['app/data/one.json', 'app/data/two.json']) {
    assert.deepEqual(await readFile(path.join(options.outputDir, name)), await readFile(path.join(options.inputDir, name)));
  }
  assert.deepEqual(await readFile(path.join(options.inputDir, 'pack.json')), before);
  const manifest = JSON.parse(await readFile(path.join(options.outputDir, 'pack.json')));
  assert.equal(manifest.version, options.version);
  assert.equal(manifest.distribution, 'private-local');
});

test('home provenance is removed without changing geometry, and chained JSON/gzip receipts are repaired', async t => {
  const { manifest, options } = await fixture(t);
  const first = manifest.files[0].path, second = manifest.files[1].path;
  const home = [String.fromCharCode(67, 58), 'Users', 'User', 'cache.json'].join('/');
  const sourceText = encode({ provenance: { path: home }, geometry: { mapId: 28 } });
  const sourceBytes = Buffer.from(sourceText.replaceAll('\n', '\r\n'));
  await put(path.join(options.inputDir, first), sourceBytes);
  Object.assign(manifest.files[0], { sha256: sha(sourceBytes), bytes: sourceBytes.length });
  const mask = Buffer.alloc(512).toString('base64');
  const bundlePath = 'local-game/sections.json.gz', receiptPath = 'local-game/manifest.json';
  const originalBundle = gzipSync(Buffer.from(encode({ components: [{ data: mask }], inputs: { [first]: sha(sourceBytes) } })));
  const secondBytes = Buffer.from(encode({ source: { sha256: sha(sourceBytes), bytes: sourceBytes.length },
    repositorySource: { sha256: sha256RepositoryText(sourceBytes), bytes: Buffer.byteLength(sourceText) },
    prefixed: 'sha256:' + sha(sourceBytes) }));
  await put(path.join(options.inputDir, second), secondBytes);
  Object.assign(manifest.files[1], { sha256: sha(secondBytes), bytes: secondBytes.length });
  const receiptBytes = Buffer.from(encode({ sha256: sha(originalBundle), bytes: originalBundle.length }));
  for (const [name, bytes] of [[bundlePath, originalBundle], [receiptPath, receiptBytes]]) {
    await put(path.join(options.inputDir, name), bytes);
    manifest.files.push({ path: name, bytes: bytes.length, sha256: sha(bytes), kind: 'input' });
  }
  manifest.datasetDigest = datasetDigest(manifest.files, manifest.capabilities);
  await writeFile(path.join(options.inputDir, 'pack.json'), encode(manifest));
  const report = await scrubPublicPack(options);
  const cleanSource = await readFile(path.join(options.outputDir, first));
  assert.equal(hasPackHomePath(cleanSource.toString()), false);
  assert.equal(JSON.parse(cleanSource).geometry.mapId, 28);
  const cleanSecond = JSON.parse(await readFile(path.join(options.outputDir, second)));
  assert.deepEqual(cleanSecond.source, { sha256: sha(cleanSource), bytes: cleanSource.length });
  assert.deepEqual(cleanSecond.repositorySource, { sha256: sha256RepositoryText(cleanSource), bytes: cleanSource.length });
  assert.equal(cleanSecond.prefixed, 'sha256:' + sha(cleanSource));
  const cleanBundle = await readFile(path.join(options.outputDir, bundlePath));
  const expanded = JSON.parse(gunzipSync(cleanBundle));
  assert.equal(expanded.inputs[first], sha(cleanSource));
  assert.equal(expanded.components[0].data, mask);
  assert.deepEqual(JSON.parse(await readFile(path.join(options.outputDir, receiptPath))), { sha256: sha(cleanBundle), bytes: cleanBundle.length });
  assert.ok(report.changes.some(row => row.hashReferences > 0));
  assert.deepEqual(await readFile(path.join(options.inputDir, first)), sourceBytes);
});

test('art metadata can be scrubbed into a separate public version without a rules pack', async t => {
  const { manifest, options } = await fixture(t);
  manifest.id = 'duo-art'; manifest.kind = 'art';
  delete manifest.datasetDigest; delete manifest.ruleContractHash;
  const home = [String.fromCharCode(67, 58), 'Users', 'User', 'art-source.json'].join('/');
  const bytes = Buffer.from(encode({ source: home }));
  await put(path.join(options.inputDir, manifest.files[0].path), bytes);
  Object.assign(manifest.files[0], { sha256: sha(bytes), bytes: bytes.length });
  await writeFile(path.join(options.inputDir, 'pack.json'), encode(manifest));
  const { rulesTextDir, ...artOptions } = options;
  await scrubPublicPack({ ...artOptions, kind: 'art' });
  const after = JSON.parse(await readFile(path.join(options.outputDir, 'pack.json')));
  assert.equal(after.id, 'duo-art');
  assert.equal(hasPackHomePath(await readFile(path.join(options.outputDir, after.files[0].path), 'utf8')), false);
});

test('custom transformations run sequentially and produce new receipts and a value-free report', async t => {
  const { root, options } = await fixture(t), calls = [];
  let active = 0;
  const reportFile = path.join(root, 'report.json');
  const result = await scrubPublicPack({ ...options, reportFile, scrub: async (document, relative) => {
    assert.equal(active++, 0);
    await Promise.resolve();
    calls.push(relative); document.label = 'new'; active--;
    return { document, replacements: 1 };
  } });
  assert.deepEqual(calls, ['app/data/one.json', 'app/data/two.json']);
  assert.equal(result.changes.length, 2);
  const report = await readFile(reportFile, 'utf8');
  assert.equal(report.includes('"old"'), false); assert.equal(report.includes('"new"'), false);
  const manifest = JSON.parse(await readFile(path.join(options.outputDir, 'pack.json')));
  for (const record of manifest.files) {
    const bytes = await readFile(path.join(options.outputDir, record.path));
    assert.equal(record.sha256, sha(bytes)); assert.equal(record.bytes, bytes.length);
    assert.equal(JSON.parse(await readFile(path.join(options.inputDir, record.path))).label, 'old');
  }
  assert.equal(manifest.datasetDigest, datasetDigest(manifest.files, manifest.capabilities));
});

test('existing outputs, input overlaps, bad receipts and traversal fail before output', async t => {
  for (const mode of ['exists', 'overlap', 'receipt', 'traversal', 'extra']) await t.test(mode, async t => {
    const { manifest, options } = await fixture(t);
    if (mode === 'exists') { await mkdir(options.outputDir); await put(path.join(options.outputDir, 'keep.txt'), 'keep'); }
    if (mode === 'overlap') options.outputDir = options.inputDir;
    if (mode === 'receipt') await writeFile(path.join(options.inputDir, manifest.files[0].path), '{}');
    if (mode === 'traversal') { manifest.files[0].path = '../outside.json'; await writeFile(path.join(options.inputDir, 'pack.json'), encode(manifest)); }
    if (mode === 'extra') await put(path.join(options.inputDir, 'extra.json'), '{}');
    await assert.rejects(scrubPublicPack(options), /Public pack scrub refused/);
    if (mode === 'exists') assert.equal(await readFile(path.join(options.outputDir, 'keep.txt'), 'utf8'), 'keep');
    else if (mode !== 'overlap') await missing(options.outputDir);
  });
});

test('a failed transformation cleans only its newly created output', async t => {
  const { options } = await fixture(t);
  const before = await readFile(path.join(options.inputDir, 'pack.json'));
  let calls = 0;
  await assert.rejects(scrubPublicPack({ ...options, scrub: document => {
    if (++calls === 2) throw new Error('synthetic recipe failure');
    document.label = 'new'; return { document, replacements: 1 };
  } }), /Public pack scrub refused/);
  await missing(options.outputDir);
  assert.deepEqual(await readFile(path.join(options.inputDir, 'pack.json')), before);
});

const actualRoot = process.env.RS3_PUBLIC_SCRUB_PACKS_DIR;
const actualData = process.env.RS3_PUBLIC_SCRUB_DATA_VERSION;
const actualRules = process.env.RS3_PUBLIC_SCRUB_RULES_VERSION;
const actualArt = process.env.RS3_PUBLIC_SCRUB_ART_VERSION;
test('actual scrubbed packs resolve with the current runtime', { skip: !actualRoot && !actualData && !actualRules }, async t => {
  assert.ok(actualRoot && actualData && actualRules, 'All three public scrub test settings are required.');
  assert.ok(path.isAbsolute(actualRoot), 'The public scrub packs root must be absolute.');
  assert.ok(!/(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(actualRoot), 'Protected pack roots are forbidden.');
  assert.match(actualData, /^\d+\.\d+\.\d+-public\.\d+$/);
  assert.match(actualRules, /^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*$/);
  const choice = async (id, version) => ({ id, version, sha256: sha(await readFile(path.join(actualRoot, id, version, 'pack.json'))) });
  const selection = { schemaVersion: 1, data: await choice('duo-data', actualData), rulesText: await choice('duo-rules-text', actualRules) };
  const absent = path.join(actualRoot, 'not-installed-public-scrub-test');
  // The final defaults loader has its own environment fallback, separate from
  // resolveDataset's explicit profile options. Never open local operator config.
  const names = ['RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_GAME_DEFAULTS_FILE'];
  const inherited = names.map(name => [name, process.env[name]]);
  for (const name of names) delete process.env[name];
  try {
    const dataset = await resolveDataset({ datasetId: 'duo-legacy', root: repository, packsDir: actualRoot, selection,
      profilePath: '', profileSha256: '', legacyMetadataMapAssetsDir: null,
      mapAssetsDir: path.join(absent, 'map'), gameDataDir: path.join(absent, 'game') });
    assert.equal(dataset.packed, true); assert.equal(dataset.status().health, 'healthy');
    const inputs = await loadDatasetInputs(dataset);
    assert.ok(inputs.definitionBytes.length > 0); assert.ok(inputs.taskBytes.length > 0);
    const bundleKey = 'local-game/chunk-sections.cache-audit-2026-10-07-v4-v1/sections.v1.json.gz';
    const bundleBytes = dataset.bytes(bundleKey), catalogue = JSON.parse(gunzipSync(bundleBytes));
    const bundleManifest = dataset.json(bundleKey.replace('sections.v1.json.gz', 'manifest.json'));
    assert.equal(bundleManifest.sha256, sha(bundleBytes));
    if (bundleManifest.bytes !== undefined) assert.equal(bundleManifest.bytes, bundleBytes.length);
    for (const key of SECTION_INPUTS) assert.equal(catalogue.provenance.repositoryHashes[key], sha256RepositoryText(dataset.bytes(key)));
    const surface = dataset.json('app/data/cache-surface-corrections.2026-10-08.v1.json');
    const components = new Map(catalogue.components.map(row => [row.id, { tiles: row.walkableTileCount }]));
    const world = { cacheWalking: { components, surfaceCorrections: { provenance: surface.provenance, invalidRegionIds: [], nonWalkingComponentIds: [] } } };
    const geometry = await loadChunkSectionIndex(null, null, world, { dataset });
    assert.equal(geometry.reason, undefined);
    assert.ok(geometry.components.size > 0);
    if (process.env.RS3_PUBLIC_SCRUB_SOURCE_DIR) {
      const source = path.resolve(process.env.RS3_PUBLIC_SCRUB_SOURCE_DIR);
      assert.ok(!/(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(source));
      const before = JSON.parse(gunzipSync(await readFile(path.join(source, bundleKey))));
      assert.equal(sha(JSON.stringify(catalogue.components)), sha(JSON.stringify(before.components)));
    }
    t.diagnostic(`Validation peak RSS: ${process.resourceUsage().maxRSS} KiB`);
  } finally {
    for (const [name, value] of inherited) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('actual scrubbed art resolves all metadata and image samples from every component without fallback', { skip: !actualArt }, async () => {
  assert.ok(actualRoot && path.isAbsolute(actualRoot));
  assert.ok(!/(?:^|[/\\])(?:kits|operator|release-v2)(?:[/\\]|$)|[/\\]\.local[/\\]duo(?:[/\\]|$)/i.test(actualRoot));
  assert.match(actualArt, /^\d+\.\d+\.\d+-public\.\d+$/);
  const selection = { schemaVersion: 1, art: { id: 'duo-art', version: actualArt,
    sha256: sha(await readFile(path.join(actualRoot, 'duo-art', actualArt, 'pack.json'))) } };
  const provider = await loadArtPack({ packsDir: actualRoot, selection });
  assert.equal(provider.status().health, 'healthy');
  let files = 0;
  for (const component of provider.status().components) {
    const available = provider.files(component), samples = new Set(available.filter(relative => /\.json$/i.test(relative)));
    for (const extension of ['png', 'webp', 'svg', 'woff2']) {
      const images = available.filter(relative => relative.toLowerCase().endsWith('.' + extension));
      if (images.length) { samples.add(images[0]); samples.add(images.at(-1)); }
    }
    for (const relative of samples) {
      assert.ok(await provider.file(component, relative), 'Every metadata file and image sample must resolve.'); files++;
    }
  }
  assert.ok(files > 0);
  assert.equal(provider.status().health, 'healthy');
});
