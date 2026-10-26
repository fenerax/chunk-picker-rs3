import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolveDataset, decodeDatasetValue, decodeParsedDatasetValue, encodeDatasetValue } from '../app/datasets.mjs';
import { loadDatasetInputs } from '../app/dataset-bootstrap.mjs';
import { writeScaledCompanion, SCALED_PATHS } from '../scripts/perf/scale-dataset.mjs';

// Synthetic packs from the perf generator exercise the installed-profile seam
// that private datasets use; no private data, network or storage.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let directory;
test.before(async () => { directory = await mkdtemp(path.join(tmpdir(), 'picker-dataset-packs-')); });
test.after(() => rm(directory, { recursive: true, force: true }));
let counter = 0;
const companion = (settings = {}) => writeScaledCompanion(path.join(directory, `companion-${counter++}`), { scale: 1, ...settings });
const options = ({ environment }, extra = {}) => ({ datasetId: 'duo-legacy', profilePath: environment.RS3_DATASET_PROFILE,
  profileSha256: environment.RS3_DATASET_PROFILE_SHA256, packsDir: environment.RS3_PACKS_DIR, selectionPath: environment.RS3_PACK_SELECTION, ...extra });
const refused = promise => assert.rejects(promise, error => error.code === 'DATASET_PACK_INVALID');
const dataFile = (made, relative) => path.join(made.environment.RS3_PACKS_DIR, 'duo-data', `1.0.0-synthetic.1.${made.seed}`, ...relative.split('/'));

test('synthetic scaled packs resolve with every pinned digest and are deterministic', async () => {
  const [made, again] = [await companion(), await companion()];
  assert.equal(made.digest, again.digest);
  assert.equal(await readFile(made.environment.RS3_PACK_SELECTION, 'utf8'), await readFile(again.environment.RS3_PACK_SELECTION, 'utf8'));
  const dataset = await resolveDataset(options(made));
  assert.equal(dataset.digest, made.digest); assert.equal(dataset.packed, true); assert.equal(dataset.ruleContractHash, made.ruleContractHash);
  const { bytes, sha256 } = dataset.verifiedBytes(SCALED_PATHS.definitions);
  assert.equal(sha(bytes), sha256);
  assert.deepEqual(dataset.json(SCALED_PATHS.definitions), JSON.parse(bytes));
  const inputs = await loadDatasetInputs(dataset);
  assert.equal(sha(inputs.definitionBytes), inputs.selection.definitions.sha256);
  assert.equal(sha(inputs.taskBytes), inputs.selection.taskMap.sha256);
  assert.ok(dataset.value('app/tasks/engine.mjs#F2P') instanceof Set);
  assert.deepEqual(dataset.json('app/data/cache-walkability.2026-10-07.v1.json').summary, { doors: 0, conditionalMorphs: 0 });
  assert.deepEqual(dataset.json('app/data/legacy-task-history.json'), {});
  assert.deepEqual(dataset.value('app/data/identity-registry.mjs#authoredGoals'), []);
  const ids = dataset.value('app/data/identity-registry.mjs#authoredTasks').map(([id]) => id);
  assert.ok(ids.every(id => id.startsWith('rs3:task:synthetic:')));
  assert.equal(new Set(ids).size, ids.length);
  // A digest from the same bytes also stands for the repository-text hash.
  const plain = { ...dataset, verifiedBytes: undefined };
  assert.deepEqual(await loadDatasetInputs(plain), inputs);
});

test('inputs are refused unless every byte is valid JSON, even when their hashes match', async () => {
  const edits = {
    [SCALED_PATHS.definitions]: bytes => bytes.subarray(0, bytes.length - 3),
    'app/data/equipment-weights.2026-10-08.v1.json': bytes => Buffer.from(bytes.toString().replace(/}\n$/, ',}\n')),
    'app/data/divination.2026-10-13.v1.json': bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    'app/data/poh-storage.2026-10-08.v1.json': bytes => Buffer.from(bytes.toString().replace('"schemaVersion"', '"schema\u0001Version"')),
    [SCALED_PATHS.gzipCatalogue]: () => gzipSync(Buffer.from('{"schemaVersion":1,"replicas":[]')),
    'generated/dataset-values.json': bytes => bytes.subarray(1),
    // Valid JSON, but the authored transcription no longer matches the snapshot.
    [SCALED_PATHS.dataValues]: bytes => Buffer.from(bytes.toString().replace(/(: |\[)(\d+)/, (_, before, digits) => `${before}${Number(digits) + 1}`)),
  };
  for (const [target, change] of Object.entries(edits)) {
    let edited = false;
    const made = await companion({ edit: (relative, bytes) => {
      if (relative !== target) return bytes;
      const result = change(bytes); edited = !result.equals(bytes); return result;
    } });
    assert.ok(edited, target);
    await refused(resolveDataset(options(made)));
  }
  // Whitespace and non-ASCII string content stay valid, exactly as JSON.parse allows.
  const spaced = await companion({ edit: (relative, bytes) => relative === 'app/data/equipment-weights.2026-10-08.v1.json'
    ? Buffer.from(` \t${bytes.toString().replace('"schemaVersion"', '"schéma":" ",\r\n"schemaVersion"')}\r\n`) : bytes });
  await resolveDataset(options(spaced));
});

test('changed pack files, profiles and selections are refused at load and at use', async () => {
  const made = await companion();
  const catalogue = dataFile(made, 'app/data/synthetic-catalogue-1.v1.json');
  const original = await readFile(catalogue);
  for (const changed of [Buffer.concat([original, Buffer.from(' ')]), original.subarray(0, original.length - 1),
    Buffer.from(original.toString().replace(/[a-z]/, 'q'))]) {
    await writeFile(catalogue, changed);
    await refused(resolveDataset(options(made)));
  }
  await writeFile(catalogue, original);
  await refused(resolveDataset(options(made, { profileSha256: 'f'.repeat(64) })));
  const selection = JSON.parse(await readFile(made.environment.RS3_PACK_SELECTION, 'utf8'));
  const wrong = path.join(directory, `selection-${counter++}.json`);
  await writeFile(wrong, JSON.stringify({ ...selection, data: { ...selection.data, sha256: 'e'.repeat(64) } }));
  await refused(resolveDataset(options(made, { selectionPath: wrong })));
  await refused(resolveDataset(options(made, { digest: '0'.repeat(64) })));
  const dataset = await resolveDataset(options(made));
  const definitions = dataFile(made, SCALED_PATHS.definitions), bytes = await readFile(definitions);
  await writeFile(definitions, Buffer.from(bytes.toString().replace(/[a-z]/, 'q')));
  assert.throws(() => dataset.verifiedBytes(SCALED_PATHS.definitions), error => error.code === 'DATASET_PACK_INVALID');
  await refused(loadDatasetInputs(dataset));
});

test('the in-place snapshot decoder matches the copying decoder, including refusals', () => {
  const value = { list: [1, undefined, new Set(['a', new Map([['k', [undefined, { deep: new Set() }]]])]), null], ['__proto__']: { own: true },
    nested: { map: new Map([[1, 'one'], ['two', new Set([2])]]), empty: {}, text: 'x' } };
  const text = JSON.stringify(encodeDatasetValue(value));
  assert.deepStrictEqual(decodeParsedDatasetValue(JSON.parse(text)), decodeDatasetValue(JSON.parse(text)));
  assert.equal(Object.getPrototypeOf(decodeParsedDatasetValue(JSON.parse(text))), Object.prototype);
  assert.ok(Object.hasOwn(decodeParsedDatasetValue(JSON.parse(text)), '__proto__'));
  for (const bad of ['{"$datasetType":"Set"}', '{"a":[{"$datasetType":"Map","entries":[[1]]}]}', '{"$datasetType":"Other","entries":[]}',
    '{"x":{"$datasetType":"Undefined","extra":1}}']) {
    assert.throws(() => decodeDatasetValue(JSON.parse(bad)), error => error.code === 'DATASET_PACK_INVALID');
    assert.throws(() => decodeParsedDatasetValue(JSON.parse(bad)), error => error.code === 'DATASET_PACK_INVALID');
  }
});

test('the full preparation pipeline applies every synthetic correction once without changing its input', async () => {
  const made = await companion();
  const url = file => new URL(`../app/${file}`, import.meta.url).href;
  const script = `
    const { selectedDataset } = await import(${JSON.stringify(url('dataset-runtime.mjs'))});
    const { prepareServerDefinitions } = await import(${JSON.stringify(url('dataset-pipeline.mjs'))});
    const { loadDatasetInputs } = await import(${JSON.stringify(url('dataset-bootstrap.mjs'))});
    const input = await loadDatasetInputs(selectedDataset);
    const parsed = JSON.parse(input.definitionBytes), before = JSON.stringify(parsed);
    const rows = Object.values(prepareServerDefinitions(parsed, selectedDataset).challenges).flatMap(Object.values);
    const count = test => rows.filter(test).length;
    console.log(JSON.stringify({ digest: selectedDataset.digest, unchanged: JSON.stringify(parsed) === before,
      notes: count(row => row.Description?.endsWith(' Synthetic note.')), doubled: count(row => row.Description?.endsWith('note. Synthetic note.')),
      reviews: count(row => row.Description?.endsWith(' Synthetic review.')), difficulty: count(row => row.Difficulty === 'Synthetic') }));`;
  const environment = { ...process.env, ...made.environment };
  for (const key of ['RS3_PRIVATE_ADDON', 'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR']) delete environment[key];
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: environment, windowsHide: true });
  assert.deepEqual(JSON.parse(stdout), { digest: made.digest, unchanged: true, notes: made.corrections.retained + made.corrections.selected,
    doubled: 0, reviews: made.corrections.overlay, difficulty: made.corrections.metadata });
});


test('synthetic installed packs support production process workers and repeated planning for both members', { timeout: 120000 }, async () => {
  const made = await companion();
  const script = `
    import assert from 'node:assert/strict';
    import { startServer } from ${JSON.stringify(new URL('../app/server.mjs', import.meta.url).href)};
    import { createGroupState } from ${JSON.stringify(new URL('../app/core/state.mjs', import.meta.url).href)};
    import { loadDatasetInputs } from ${JSON.stringify(new URL('../app/dataset-bootstrap.mjs', import.meta.url).href)};
    import { selectedDataset } from ${JSON.stringify(new URL('../app/dataset-runtime.mjs', import.meta.url).href)};
    const inputs = await loadDatasetInputs(selectedDataset);
    const defs = JSON.parse(inputs.definitionBytes);
    const ids = Object.keys(defs.chunks).filter(id => /^[1-9]\\d*$/.test(id));
    const initialState = createGroupState([{id:'a',name:'A',unlocked:[ids[0]]},{id:'b',name:'B',unlocked:[ids[1]]}]);
    const app = await startServer({port:0,host:'127.0.0.1',dataDir:process.env.SYNTHETIC_TEST_STORE,initialState,predictionPrewarm:false});
    try {
      await app.ready;
      const url = new URL(app.inviteUrl);
      const get = async route => {
        const response = await fetch(url.origin + route, {headers:{Authorization:'Bearer ' + url.pathname.slice('/join/'.length)}});
        assert.equal(response.status,200); return response.json();
      };
      for (const member of initialState.members) {
        await get('/api/tasks?memberId='+member.id+'&view=play-v1');
        for (const id of [ids[0],ids[1],ids.at(-1)]) {
          const one = await get('/api/chunk-planning?memberId='+member.id+'&chunkId='+id);
          const two = await get('/api/chunk-planning?memberId='+member.id+'&chunkId='+id);
          delete one.cache; delete two.cache;
          assert.equal(one.format,'chunk-planning-v1'); assert.deepEqual(two,one);
        }
      }
    } finally { await app.close(); }
  `;
  // Process workers inherit execArgv: a real entry file prevents --eval from
  // being inherited and recursively running the parent observer.
  const entry = path.join(made.root, 'server-check.mjs');
  await writeFile(entry, script);
  const env = { ...process.env, ...made.environment, RS3_TASK_WORKER_MODE: 'process',
    SYNTHETIC_TEST_STORE: path.join(made.root, 'server-test'), RS3_PRIVATE_ADDON: '', RS3_PRIVATE_ADDON_SHA256: '' };
  delete env.NODE_TEST_CONTEXT;
  await promisify(execFile)(process.execPath, [entry], {
    env,
    timeout: 110000, maxBuffer: 1024 * 1024,
  });
});
