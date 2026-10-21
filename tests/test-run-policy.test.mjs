import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GiB, loadTestPolicy, runAdaptive } from '../scripts/adaptive-test-runner.mjs';
import { classifyTest, discoverTests, openF2PTests, soloTests, testRunPolicy } from '../scripts/test-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('solo files run first and alone; policy env replaces or removes lane variables', async () => {
  const policies = { 'big.test.mjs': { solo: true }, 'huge.test.mjs': { solo: true },
    'small.test.mjs': { env: { RS3_DATASET: 'open-f2p', RS3_GAME_DATA_DIR: undefined } } };
  const events = [], environments = new Map();
  let active = 0;
  const runFile = async ({ file, env }) => {
    events.push({ file, start: true, active: ++active });
    environments.set(file, env);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
    events.push({ file, start: false });
    return { file, passed: true, processWallMs: 1, fileWallMs: 1, bodyMs: 1, summary: { counts: {} } };
  };
  const files = ['a', 'big', 'small', 'huge', 'z'].map(name => `tests/${name}.test.mjs`);
  const result = await runAdaptive({ files, cwd: root, env: { RS3_GAME_DATA_DIR: 'game', KEEP: '1' },
    memory: () => 64 * GiB, minConcurrency: 3, maxConcurrency: 3, pollMs: 1, rampMs: 0,
    policy: name => policies[name] ?? {}, runFile });
  assert.equal(result.passed, true);
  assert.equal(result.files.length, files.length);
  const starts = events.filter(event => event.start).map(event => event.file);
  assert.deepEqual(starts.slice(0, 2), ['tests/big.test.mjs', 'tests/huge.test.mjs']);
  // Each solo file starts with nothing else running and ends before anything else starts.
  for (const solo of starts.slice(0, 2)) {
    const from = events.findIndex(event => event.start && event.file === solo);
    assert.equal(events[from].active, 1, solo);
    assert.deepEqual(events[from + 1], { file: solo, start: false }, solo);
  }
  assert.equal(result.maxActive, 3);
  assert.deepEqual(environments.get('tests/small.test.mjs'), { KEEP: '1', RS3_DATASET: 'open-f2p' });
  for (const name of ['a', 'big', 'huge', 'z']) assert.deepEqual(environments.get(`tests/${name}.test.mjs`), { RS3_GAME_DATA_DIR: 'game', KEEP: '1' }, name);
});

test('the runner reads the tree policy and a tree without one runs every file plainly', async () => {
  assert.equal(await loadTestPolicy(root), testRunPolicy);
  assert.deepEqual((await loadTestPolicy(path.join(root, 'tests')))('server.test.mjs'), {});
  assert.deepEqual(testRunPolicy('state.test.mjs'), { solo: false });
});

test('policy entries name existing full-suite files and open-f2p mirrors core lane environment', async () => {
  const full = await discoverTests(undefined, 'full');
  for (const name of [...soloTests, ...openF2PTests]) {
    assert.ok(full.includes(name), name);
    assert.ok(classifyTest(name), name);
  }
  for (const name of openF2PTests) {
    const { env } = testRunPolicy(name);
    assert.equal(env.RS3_DATASET, 'open-f2p', name);
    for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_MAP_ASSETS_DIR', 'RS3_GAME_DATA_DIR', 'RS3_DATASET_PROFILE']) {
      assert.ok(Object.hasOwn(env, key) && env[key] === undefined, `${name} ${key}`);
    }
  }
});
