import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { serialize, deserialize } from 'node:v8';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createTaskScheduler } from '../app/tasks/scheduler.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const environment = log => {
  const env = { ...process.env, RS3_DATASET: 'open-f2p', RS3_TASK_WORKER_MODE: 'process' };
  for (const key of ['RS3_PACKS_DIR', 'RS3_PACK_SELECTION', 'RS3_DATASET_PROFILE', 'RS3_DATASET_PROFILE_SHA256', 'RS3_PRIVATE_ADDON',
    'RS3_PRIVATE_ADDON_SHA256', 'RS3_GAME_DATA_DIR', 'RS3_MAP_ASSETS_DIR', 'RS3_PUBLIC_ORIGIN', 'RS3_LOOPBACK_PORT', 'NODE_OPTIONS', 'RS3_STARTUP_TIMING_LOG']) delete env[key];
  return log ? { ...env, RS3_STARTUP_TIMING_LOG: log } : env;
};

test('opt-in startup log orders every phase and resolves the dataset once in the server process', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-startup-timing-'));
  const log = path.join(directory, 'startup.jsonl'), dataDir = path.join(directory, 'game');
  const child = spawn(process.execPath, [path.join(root, 'app', 'server.mjs'), '--data-dir', dataDir, '--host', '127.0.0.1', '--port', '0'],
    { cwd: root, env: environment(log), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    await rm(directory, { recursive: true, force: true });
  });
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const origin = await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = /ready at (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
      if (match) resolve(match[1]);
    });
    child.once('exit', code => reject(new Error(`Server exited ${code}: ${stderr}`)));
  });
  const token = (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim();
  const health = await (await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(health.ready, true);
  child.kill('SIGTERM'); await exited;

  const rows = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(rows.every(row => typeof row.phase === 'string' && Number.isFinite(row.at) && Number.isInteger(row.pid)));
  const server = rows.filter(row => row.pid === child.pid && row.thread === 0).map(row => row.phase);
  const order = ['modules-start', 'dataset:resolve', 'modules-loaded', 'early-listen', 'create:start', 'create:dataset', 'create:storage',
    'create:browser-payload', 'create:inputs', 'create:definitions', 'create:world', 'create:worker', 'create:store', 'create:sidecars',
    'create:handler', 'listen'];
  assert.deepEqual(server.filter(phase => order.includes(phase)), order);
  // createServer receives the provider verified during module load.
  assert.equal(server.filter(phase => phase === 'dataset:resolve').length, 1);
  const calculator = rows.filter(row => row.pid !== child.pid).map(row => row.phase);
  for (const phase of ['dataset:resolve', 'worker:modules', 'worker:compiled']) assert.ok(calculator.includes(phase), phase);
  const at = phase => rows.find(row => row.pid === child.pid && row.thread === 0 && row.phase === phase).at;
  assert.ok(rows.find(row => row.phase === 'worker:compiled').at <= at('create:worker'));
});

test('startup timing is off unless an absolute log file is named', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rs3-startup-timing-off-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `const { startupPhase } = await import(${JSON.stringify(new URL('../app/startup-timing.mjs', import.meta.url).href)}); startupPhase('probe');`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, env: environment('relative.jsonl'), windowsHide: true });
  await assert.rejects(access(path.join(directory, 'relative.jsonl')), { code: 'ENOENT' });
});

test('the generated catalogue crosses the worker boundary as one structured-clone byte string', async t => {
  const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'],
    challenges: { Quest: { 'Present quest': { Chunks: ['12341'] } } } };
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url),
    { workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }) });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.type, 'ready');
  assert.equal(ready.dynamicCatalogue, undefined);
  assert.ok(ready.dynamicCatalogueBytes instanceof Uint8Array);
  assert.ok(Array.isArray(deserialize(ready.dynamicCatalogueBytes)));
  assert.ok(Array.isArray(ready.catalogue));
});

test('the scheduler decodes catalogue bytes exactly, keeping shared rows shared, and still accepts a plain catalogue', async t => {
  const family = ['task:a', 'task:b'];
  const rows = [{ id: 'task:a', label: 'A', category: 'Collect', completionIds: family, aliases: ['a'] },
    { id: 'task:b', label: 'B', category: 'Collect', completionIds: family, level: undefined }];
  const lanes = [];
  const factory = message => () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {}; worker.terminate = async () => { worker.emit('exit', 0); };
    queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [], ...message }));
    return worker;
  };
  for (const message of [{ dynamicCatalogueBytes: serialize(rows) }, { dynamicCatalogue: rows }]) {
    const scheduler = await createTaskScheduler({ workerFactory: factory(message) });
    lanes.push(scheduler);
    assert.deepStrictEqual(scheduler.dynamicCatalogue, rows);
    assert.equal(scheduler.dynamicCatalogue[0].completionIds, scheduler.dynamicCatalogue[1].completionIds);
    assert.ok(Object.hasOwn(scheduler.dynamicCatalogue[1], 'level'));
  }
  t.after(() => Promise.all(lanes.map(lane => lane.close())));
});

test('the scheduler keeps no copy of the catalogue bytes once it has taken them', async t => {
  let ready;
  const scheduler = await createTaskScheduler({ workerFactory: () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {}; worker.terminate = async () => { worker.emit('exit', 0); };
    queueMicrotask(() => worker.emit('message', ready = { type: 'ready', catalogue: [], dynamicCatalogueBytes: serialize([{ id: 'task:a' }]) }));
    return worker;
  } });
  t.after(() => scheduler.close());
  // The ready message stays reachable through the lane's initial promise.
  assert.equal(Object.hasOwn(ready, 'dynamicCatalogueBytes'), false);
  assert.deepStrictEqual(scheduler.dynamicCatalogue, [{ id: 'task:a' }]);
});
