import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scrubPublicPack, scrubPublicDocument } from '../scripts/packs/scrub-public-pack.mjs';
import { addFingerprints, loadCorpus } from '../scripts/secret-scan/fingerprints.mjs';
import { scanEntries } from '../scripts/secret-scan/scan.mjs';
import { datasetDigest, resolveDataset } from '../app/datasets.mjs';
import { loadDatasetInputs } from '../app/dataset-bootstrap.mjs';

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
    t.diagnostic(`Validation peak RSS: ${process.resourceUsage().maxRSS} KiB`);
  } finally {
    for (const [name, value] of inherited) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
