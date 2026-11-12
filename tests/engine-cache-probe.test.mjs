// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createGroupState } from '../app/core/state.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

for (const sizes of [false, true]) test(`cache diagnostic preload observes the current worker caches (sizes=${sizes})`, async t => {
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    execArgv: ['--import', new URL('../scripts/perf/engine-cache-probe.mjs', import.meta.url).href],
    env: { ...process.env, RS3_CACHE_PROFILE_SIZES: sizes ? '1' : '0' },
    workerData: genericWorkerData({ definitions: {
      chunks: { '12850': {} }, walkableChunks: ['12850'], walkableChunksF2P: ['12850'],
      challenges: { Extra: { Synthetic: { Chunks: ['12850'] } } }, equipment: {}, codeItems: {}, drops: {},
    }, skillGuideCatalogue: { skills: [], tasks: [] } }),
  });
  t.after(() => worker.terminate());
  const inbox = new Map(); let failure;
  worker.on('error', error => { failure = error; for (const { reject } of inbox.values()) reject(error); });
  worker.on('message', message => {
    const key = message.type === 'ready' ? 'ready' : message.id;
    if (message.type === 'progress' || !inbox.has(key)) return;
    const { resolve } = inbox.get(key); inbox.delete(key); resolve(message);
  });
  const receive = key => {
    if (failure) return Promise.reject(failure);
    const result = Promise.withResolvers(); inbox.set(key, result); return result.promise;
  };
  await receive('ready');
  const state = createGroupState([{ id: 'one', name: 'Synthetic explorer', unlocked: ['12850'] }]);
  const bytes = Buffer.from(JSON.stringify(state)), stateJSON = new SharedArrayBuffer(bytes.length);
  Buffer.from(stateJSON).set(bytes);
  const result = receive(1);
  worker.postMessage({ id: 1, type: 'evaluate', memberId: 'one', input: 'synthetic', snapshotKey: JSON.stringify([state.revision, 'synthetic']),
    stateTransport: 'json-shared-v1', stateJSON, stateJSONBytes: bytes.length,
    stateRevision: state.revision, stateMemberIds: ['one'] });
  const reply = await result;
  assert.equal(reply.error, undefined);
  assert(reply.__cacheBudget.bytes > 0);
  assert.equal(reply.__cacheBudget.byteLimit, 384 * 1024 ** 2);
  for (const name of ['/tasks/worker.mjs:snapshots', '/tasks/worker.mjs:sandboxSnapshots', '/tasks/retained-data.mjs:rows']) {
    const row = reply.__cacheProbe[name]; assert(row, name);
    if (name.endsWith(':snapshots') || name.endsWith(':rows')) assert(row.sets > 0, name);
    if (sizes && row.sets) assert(row.entryBytes.some(n => n > 0), name);
  }
});
