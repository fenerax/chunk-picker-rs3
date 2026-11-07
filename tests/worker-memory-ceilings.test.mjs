// @test solo dataset=open-f2p
import './helpers/file-safety-stop.mjs';
import { createManualClock } from './helpers/manual-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import workerThreads from 'node:worker_threads';
import cp, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once, EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { runImportJob } from '../app/import-jobs.mjs';
import { TASK_WORKER_RESOURCE_LIMITS, IMPORT_WORKER_RESOURCE_LIMITS, WORKER_OLD_GENERATION_MB, CALCULATOR_PROCESS_RSS_BYTES } from '../app/tasks/worker-limits.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const parse = () => runImportJob({ kind: 'parse', chunks: [Buffer.from('{}')], headers: { 'content-type': 'application/json' } });
const definitions = { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] };

test('an import isolate exhausting a small test heap fails alone and releases the import queue', async () => {
  const OriginalWorker = workerThreads.Worker;
  workerThreads.Worker = class extends OriginalWorker {
    constructor(url, options) {
      assert.deepEqual(options.resourceLimits, IMPORT_WORKER_RESOURCE_LIMITS);
      super(url, { ...options, resourceLimits: { ...options.resourceLimits, maxOldGenerationSizeMb: 32 } });
    }
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(runImportJob({ kind: 'parse' }, { clock: createManualClock(),
      workerURL: new URL('./fixtures/worker-memory-exhaustion.mjs', import.meta.url) }),
    error => error.status === 422 && /available memory.*No records were imported/.test(error.message));
  } finally { workerThreads.Worker = OriginalWorker; syncBuiltinESMExports(); }
  assert.deepEqual((await parse()).body, {});
});

test('process relay and calculator heap ceilings survive parent flag inheritance; isolate OOM preserves its code', async t => {
  const fork = cp.fork;
  const probeImport = new URL('./fixtures/worker-memory-exhaustion.mjs', import.meta.url).href;
  cp.fork = (file, args, options) => {
    assert(options.execArgv.includes(`--max-old-space-size=${WORKER_OLD_GENERATION_MB}`));
    return fork(file, args, { ...options, execArgv: [...options.execArgv, '--max-old-space-size=32'] });
  };
  syncBuiltinESMExports();
  let worker;
  try { worker = new ProcessWorker(genericWorkerData({ definitions }), { probeImport }); }
  finally { cp.fork = fork; syncBuiltinESMExports(); }
  t.after(() => worker.terminate());
  const error = await new Promise(resolve => worker.once('error', resolve));
  assert.equal(error.code, 'ERR_WORKER_OUT_OF_MEMORY');
  await worker.terminate();
  // A fresh real calculator still starts after the failed owned process exits.
  const next = new ProcessWorker(genericWorkerData({ definitions }));
  t.after(() => next.terminate());
  assert.equal((await once(next, 'message'))[0].type, 'ready');
});

test('RSS ceiling kills only the owned calculator immediately, including a native-allocation overrun', async () => {
  const fork = cp.fork, child = new EventEmitter(), signals = [];
  child.pid = 123; child.connected = true;
  child.send = () => {};
  child.kill = signal => { signals.push(signal); child.emit('exit', null, signal); };
  cp.fork = (_file, _args, options) => {
    assert(options.execArgv.includes(`--max-old-space-size=${WORKER_OLD_GENERATION_MB}`)); return child;
  };
  syncBuiltinESMExports();
  try {
    const worker = new ProcessWorker({ definitions: {} });
    const error = new Promise(resolve => worker.once('error', resolve));
    child.emit('message', { kind: 'memory-rss', rssBytes: CALCULATOR_PROCESS_RSS_BYTES + 1 });
    assert.equal((await error).code, 'ERR_WORKER_OUT_OF_MEMORY');
    assert.deepEqual(signals, ['SIGKILL']); await worker.terminate();
  } finally { cp.fork = fork; syncBuiltinESMExports(); }
});

test('oversized inherited V8 flags reject imports and disable optional publication safely', () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=8192', fileURLToPath(new URL('./fixtures/worker-memory-override.mjs', import.meta.url))], { encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const smallOverride = spawnSync(process.execPath, [`--max-old-space-size=${WORKER_OLD_GENERATION_MB + 2}`, fileURLToPath(new URL('./fixtures/worker-memory-override.mjs', import.meta.url))], { encoding: 'utf8'});
  assert.equal(smallOverride.status, 0, smallOverride.stderr);
  const inherited = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/worker-memory-override.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.equal(TASK_WORKER_RESOURCE_LIMITS.maxOldGenerationSizeMb, WORKER_OLD_GENERATION_MB);
});
