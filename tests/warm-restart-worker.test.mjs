import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonical } from '../tools/calc-check/compare.mjs';
process.env.RS3_DATASET = 'open-f2p';
const { ProcessWorker } = await import('../app/tasks/process-worker.mjs');
const { createWorkerPreparation } = await import('../app/tasks/prepared-collection.mjs');
const { createGroupState } = await import('../app/core/state.mjs');
const { genericWorkerData } = await import('./helpers/worker-dataset.mjs');
const { buildWorld } = await import('../app/data/world.mjs');
const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  challenges: { Test: { 'Synthetic task': { Chunks: ['12342'] } } } };
const world = buildWorld(definitions);
const data = directory => genericWorkerData({ definitions, world: { chunks: world.chunks, areas: world.areas }, extraRules: [], ...(directory ? { warmStoreDirectory: directory } : {}) });
const state = createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }, { id: 'b', name: 'B', unlocked: ['12341'] }]);
async function run(directory) {
  const input = data(directory), preparation = createWorkerPreparation(input, { persistentDirectory: directory });
  const worker = new ProcessWorker(preparation.input());
  try {
    const [ready] = await once(worker, 'message'); preparation.accept(ready); await preparation.settled();
    const replies = [];
    for (const extra of [{ type: 'evaluate' }, { type: 'evaluate', resultView: 'play-v1', resultTransport: 'json-shared-v1', duoSidebarProjection: true },
      { type: 'roll-pool' }, { type: 'predict', chunkId: '12342', predictionProgress: true, previewProgress: true }]) {
      const id = replies.length + 1, progress = [];
      const reply = new Promise((resolve, reject) => {
        const listener = message => { if (message.id !== id) return; if (message.type === 'prediction-prepared') { progress.push(message); return; } worker.off('message', listener); resolve(message); };
        worker.on('message', listener); worker.once('error', reject);
      });
      worker.postMessage({ id, state, memberId: 'a', input: 'input', ...extra });
      const message = await reply; assert.equal(message.error, undefined);
      const normalize = message => {
        delete message.id; delete message.evaluationMs; delete message.timingMs;
        for (const name of ['playJSON', 'duoSidebarJSON']) if (message[name]) message[name] = JSON.parse(Buffer.from(message[name]));
        for (const role of ['unlockReuse', 'partnerUnlockReuse']) if (message[role]) for (const name of ['playJSON', 'duoJSON', 'duoSidebarJSON']) message[role][name] = JSON.parse(Buffer.from(message[role][name]));
        return canonical(message);
      };
      replies.push({ final: normalize(message), progress: progress.map(normalize) });
    }
    return replies;
  } finally { await worker.terminate(); await preparation.clear(); }
}
test('process restart restores collection, full/play lists, pool and complete paired Preview without result differences', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-restart-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cold = await run(), seeded = await run(directory), warm = await run(directory);
  assert.deepEqual(seeded, cold); assert.deepEqual(warm, cold);
  const files = [];
  for (const partition of ['collections', 'results']) for (const file of await readdir(path.join(directory, partition))) files.push(path.join(directory, partition, file));
  assert.ok(files.length >= 5);
  for (const file of files) await writeFile(file, 'truncated');
  assert.deepEqual(await run(directory), cold, 'corrupt artifacts safely rebuild');
  assert.deepEqual(await run(directory), cold, 'rebuilt artifacts can be restored');
});

test('scheduler startup/task warm queues restore exact list bytes and revision changes miss', async t => {
  process.env.RS3_TASK_WORKER_MODE = 'process';
  const { createTaskScheduler } = await import('../app/tasks/scheduler.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'warm-restart-scheduler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const open = () => createTaskScheduler({ workerData: data(), warmStoreDirectory: directory, maxCalculators: 1 });
  let scheduler = await open();
  const first = await scheduler.evaluate(state, 'a', 'evaluate', undefined, 'list', 'input');
  await scheduler.close();
  scheduler = await open();
  t.after(() => scheduler.close());
  const admitted = scheduler.prewarmTasks(state, 'input', ['a']);
  assert.equal(admitted.queued, 1);
  const deadline = Date.now() + 10000;
  while (scheduler.getDiagnostics().queue.active || scheduler.getDiagnostics().prewarm.pending) {
    assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10));
  }
  const second = await scheduler.evaluate(state, 'a', 'evaluate', undefined, 'restored', 'input');
  assert.deepEqual(second.resultJSON, first.resultJSON, 'the full serialized result is byte-identical');
  assert.deepEqual(second.playJSON, first.playJSON);
  assert.equal(second.timingMs.engineMs, 0, 'restoration does not evaluate the engine');
  const changed = await scheduler.evaluate({ ...state, revision: state.revision + 1 }, 'a', 'evaluate', undefined, 'new-revision', 'input');
  assert.ok(changed.timingMs.engineMs > 0, 'even an unchanged input label cannot reuse another revision');
  assert.deepEqual(canonical(changed.result), canonical(first.result));
});
