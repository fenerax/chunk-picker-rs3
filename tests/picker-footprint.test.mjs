import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inventory, encode } from '../scripts/linux/files.mjs';

const appDir = fileURLToPath(new URL('../app', import.meta.url));
const harness = fileURLToPath(new URL('../scripts/perf/picker-footprint.mjs', import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let error = ''; child.stderr.on('data', bytes => { error += bytes; }); child.stdout.resume();
    const timer = setTimeout(() => { child.kill(); reject(new Error('Harness exceeded 55 seconds.')); }, 55000);
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); resolve({ code, error }); });
  });
}
function onlyNumbers(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return value !== null && typeof value === 'object' && Object.values(value).every(onlyNumbers);
}

test('footprint trials use scratch copies, numeric reports, cold/warm tasks and store-only contexts', { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-footprint-test-'));
  try {
    const store = path.join(root, 'source'); await mkdir(store);
    process.env.RS3_DATASET = 'open-f2p';
    const { selectedDataset } = await import('../app/dataset-runtime.mjs');
    const { prepareGameStorage } = await import('../app/game-profile.mjs');
    const { createRuleRegistry } = await import('../app/core/rules.mjs');
    const { createGroupState } = await import('../app/core/state.mjs');
    const { openStore } = await import('../app/storage/store.mjs');
    await prepareGameStorage(store, selectedDataset);
    const registry = createRuleRegistry();
    const seed = await openStore({ dataDir: store, registry, retention: false,
      initialState: createGroupState([{ id: 'player1', name: 'Explorer 1', unlocked: ['12850'] },
        { id: 'player2', name: 'Explorer 2', unlocked: [] }], registry) });
    await seed.close();
    await writeFile(path.join(store, 'sentinel'), 'synthetic source must remain unchanged\n');
    const before = encode(await inventory(store));
    const binding = await readFile(store + '.dataset.json', 'utf8');
    const watched = ['state.json', 'access-token', 'sentinel'].map(name => path.join(store, name)).concat(store + '.dataset.json');
    const modifiedBefore = [];
    for (const file of watched) modifiedBefore.push((await stat(file)).mtimeMs);
    const out = path.join(root, 'report.json');
    const result = await run(['--app-dir', appDir, '--store', store, '--port', '0', '--idle-ms', '250', '--out', out]);
    assert.equal(result.code, 0, result.error);
    const report = JSON.parse(await readFile(out));
    assert.ok(onlyNumbers(report)); assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.nodeVersion, process.versions.node.split('.').map(Number));
    assert.equal(report.trials.length, 2);
    for (const [index, trial] of report.trials.entries()) {
      assert.equal(trial.solo, index);
      assert.equal(trial.datasetDigestBytes.length, 32);
      assert.ok(trial.storeBytes > 0);
      assert.deepEqual(trial.contexts.map(row => row.count), [1, 3]);
      assert.equal(trial.evaluations.length, index ? 2 : 4);
      assert.ok(trial.evaluations.every(row => row.wallMs >= 0 && row.mainCpuUserUs >= 0));
      assert.ok(trial.evaluations.filter(row => row.repeat === 0).every(row => row.workers.some(s => s.thread !== 0 && s.heapPeakBytes > 0)));
      for (const key of ['beforeImport', 'afterImport', 'afterStoreOpen', 'idle', 'asleep']) {
        assert.ok(trial.snapshots[key].memory.rss > 0);
        assert.ok(trial.snapshots[key].heap.used_heap_size > 0);
      }
      assert.ok(trial.rollPool.wallMs >= 0);
    }
    assert.equal(report.trials[0].initialProgress.unlocked, 1);
    assert.deepEqual(report.trials[1].initialProgress, { members: 1, revision: 0, unlocked: 0, completed: 0 });
    assert.equal(encode(await inventory(store)), before);
    assert.equal(await readFile(store + '.dataset.json', 'utf8'), binding);
    for (const [index, file] of watched.entries()) assert.equal((await stat(file)).mtimeMs, modifiedBefore[index]);
    assert.equal((await run(['--app-dir', appDir, '--store', store, '--port', '8788', '--out', path.join(root, 'bad.json')])).code, 1);
    assert.equal((await run(['--app-dir', appDir, '--store', store, '--max-rss-mib', '1', '--out', path.join(root, 'guard.json')])).code, 1);
    await assert.rejects(readFile(path.join(root, 'guard.json')), { code: 'ENOENT' });
    assert.equal(encode(await inventory(store)), before);
    // Keep numeric synthetic evidence only when explicitly requested locally.
    if (process.env.RS3_FOOTPRINT_TEST_REPORT) await writeFile(process.env.RS3_FOOTPRINT_TEST_REPORT, encode(report));
  } finally { await rm(root, { recursive: true, force: true }); }
});
