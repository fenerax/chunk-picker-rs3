import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProcessWorker } from '../app/tasks/process-worker.mjs';
import { exportBundle, defaultInit } from '../calculator/bundle/export.mjs';
import { createBundleWorker } from '../calculator/bundle/worker.mjs';

process.env.RS3_DATASET = 'open-f2p';
const { selectedDataset: dataset } = await import('../app/dataset-runtime.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof SharedArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value);
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? [...bytes] : canonical(JSON.parse(bytes.toString()));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !['timingMs', 'evaluationMs', 'cache'].includes(key) && value[key] !== undefined)
    .map(key => [key, canonical(value[key])]));
  return value;
};
function request(worker, message) {
  return new Promise((resolve, reject) => {
    const receive = value => { if (value.id === message.id && !['progress', 'prediction-prepared'].includes(value.type)) { cleanup(); resolve(value); } };
    const error = value => { cleanup(); reject(value); };
    const exit = () => error(new Error('Calculator exited.'));
    const cleanup = () => { worker.off('message', receive); worker.off('error', error); worker.off('exit', exit); };
    worker.on('message', receive); worker.on('error', error); worker.on('exit', exit); worker.postMessage(message);
  });
}

test('process and thread calculators run from bundle with source JSON reads forbidden', { timeout: 120000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'calculator-bundle-worker-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = path.join(scratch, 'bundle'), init = await defaultInit(dataset);
  const summary = await exportBundle(directory, { dataset, init });
  const state = createGroupState(dataset.gameDefaults.members.map(member => ({ ...member, unlocked: [dataset.gameDefaults.startingCell] })));
  let id = 0;
  const future = [...init.world.chunks.keys()].find(id => id !== dataset.gameDefaults.startingCell);
  const requests = state.members.flatMap(member => [
    ...['play-v1', 'full'].map(resultView => ({ type: 'evaluate', resultView, resultTransport: 'json-shared-v1', duoProjection: true, duoSidebarProjection: true, memberId: member.id })),
    { type: 'chunk-planning', chunkId: dataset.gameDefaults.startingCell, memberId: member.id },
    { type: 'death-estimates', chunkIds: [dataset.gameDefaults.startingCell], memberId: member.id },
    { type: 'predict', chunkId: future, memberId: member.id },
    { type: 'chunk-planning', chunkId: future, memberId: member.id },
    { type: 'death-estimates', chunkIds: [future], memberId: member.id },
  ]).map(message => ({ ...message, id: ++id, state }));
  // The engine reports elapsedMs inside its public metrics. Freeze only the
  // diagnostic clock in both oracles so that field is compared, not discarded.
  const clock = 'data:text/javascript,' + encodeURIComponent("Object.defineProperty(performance, 'now', { value: () => 0 });");
  const reference = new ProcessWorker(init, { probeImport: clock }), expected = [];
  try {
    const [ready] = await once(reference, 'message'); assert.equal(ready.type, 'ready');
    for (const message of requests) {
      const result = await request(reference, message); assert.equal(result.error, undefined); expected.push(canonical(result));
    }
  } finally { await reference.terminate(); }
  // This preload forbids every JSON read outside the exported bundle. It also
  // gives the worker an invalid environment selection; neither can be a fallback.
  const preload = new URL('../calculator/bundle/preload.mjs', import.meta.url).href;
  const guard = 'data:text/javascript,' + encodeURIComponent(`
    Object.defineProperty(performance, 'now', { value: () => 0 });
    await import(${JSON.stringify(preload)});
    const fs = (await import('node:fs')).default;
    const { syncBuiltinESMExports } = await import('node:module');
    const root = ${JSON.stringify(directory)} + '/';
    const check = file => { const text = String(file); if (text.endsWith('.json') && !text.replace('file://', '').startsWith(root)) throw new Error('Source JSON forbidden.'); };
    const read = fs.readFileSync; fs.readFileSync = function(file, ...args) { check(file); return read.call(this, file, ...args); };
    const asyncRead = fs.promises.readFile; fs.promises.readFile = function(file, ...args) { check(file); return asyncRead.call(this, file, ...args); };
    syncBuiltinESMExports();
    process.env.RS3_DATASET = 'unavailable'; process.env.RS3_PACKS_DIR = '/unavailable'; process.env.RS3_GAME_DEFAULTS_FILE = '/unavailable';
  `);
  const apiWorker = createBundleWorker(directory, { datasetDigest: dataset.digest, manifestSha256: summary.manifestSha256 });
  try {
    const [ready] = await once(apiWorker, 'message'); assert.equal(ready.datasetDigest, dataset.digest);
    const memory = await apiWorker.getMemoryUsage();
    assert.equal(memory.pid, apiWorker.pid); assert.ok(memory.main.rss > 0);
    assert.equal(memory.workers.length, 1); assert.ok(memory.workers[0].memoryUsage.rss > 0);
  }
  finally { await apiWorker.terminate(); }
  for (const mode of ['process', 'thread']) {
    const worker = mode === 'process' ? new ProcessWorker({ calculatorBundle: directory, datasetDigest: dataset.digest, bundleManifestSha256: summary.manifestSha256 }, { probeImport: guard })
      : new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
        workerData: { calculatorBundle: directory, bundleManifestSha256: summary.manifestSha256 }, execArgv: ['--import', guard] });
    try {
      const [ready] = await once(worker, 'message'); assert.equal(ready.type, 'ready'); assert.equal(ready.datasetDigest, dataset.digest);
      for (let index = 0; index < requests.length; index++) {
        const actual = await request(worker, requests[index]); assert.equal(actual.error, undefined);
        assert.deepEqual(canonical(actual), expected[index]);
      }
    } finally { await worker.terminate(); }
  }
});
