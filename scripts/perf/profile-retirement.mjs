// Synthetic lifecycle measurement. No server, store, packs or saved input.
import assert from 'node:assert/strict';
import childProcesses from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || major === 24 && minor >= 20, 'Node 24.20+ required');
const root = path.resolve(process.argv[2] ?? '.'), trials = Number(process.argv[3] ?? 5);
assert.ok(Number.isInteger(trials) && trials > 0 && trials <= 20);
const load = relative => import(pathToFileURL(path.join(root, relative)));
const { ProcessWorker } = await load('app/tasks/process-worker.mjs');
const { genericWorkerData } = await load('tests/helpers/worker-dataset.mjs');
const { createGroupState } = await load('app/core/state.mjs');
const preload = `data:text/javascript;base64,${Buffer.from(`
  import { Worker } from 'node:worker_threads';
  Worker.prototype.startCpuProfile = () => new Promise(() => {});
`).toString('base64')}`;
const probeImport = `data:text/javascript;base64,${Buffer.from(`
  import { parentPort } from 'node:worker_threads';
  parentPort.on('message', message => {
    if (!message.syntheticHold) return;
    parentPort.postMessage({ type: 'progress', id: message.id, syntheticBlocked: true });
    const flag = new Int32Array(message.cancellation), until = Date.now() + 6000;
    while (!Atomics.load(flag, 0) && Date.now() < until) Atomics.wait(flag, 0, 0, 20);
  });
`).toString('base64')}`;
function waitFor(worker, predicate) {
  return new Promise(resolve => {
    const message = value => { if (predicate(value)) finish({ completed: true, value }); };
    const exited = () => finish({ completed: false });
    const finish = result => { worker.off('message', message); worker.off('exit', exited); resolve(result); };
    worker.on('message', message); worker.once('exit', exited);
  });
}
const samples = [];
for (let index = 0; index < trials; index++) {
  const original = childProcesses.fork;
  childProcesses.fork = (module, args, options) => original(module, args, { ...options, execArgv: [...options.execArgv, '--import', preload] });
  syncBuiltinESMExports();
  let worker;
  try { worker = new ProcessWorker(genericWorkerData({ definitions: { chunks: {}, challenges: {}, walkableChunks: [], walkableChunksF2P: [] } }), { probeImport }); }
  finally { childProcesses.fork = original; syncBuiltinESMExports(); }
  let peakRssBytes = 0, sampleRunning = false;
  const sampler = setInterval(async () => {
    if (sampleRunning) return; sampleRunning = true;
    try {
      const text = await readFile(`/proc/${worker.pid}/status`, 'utf8');
      peakRssBytes = Math.max(peakRssBytes, Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { sampleRunning = false; }
  }, 50);
  try {
    await once(worker, 'message');
    const state = createGroupState([{ id: 'synthetic-member', name: 'Synthetic player' }]);
    const blocked = waitFor(worker, message => message.syntheticBlocked);
    const result = waitFor(worker, message => message.id === 1 && message.type !== 'progress');
    worker.postMessage({ id: 1, type: 'evaluate', state, memberId: state.members[0].id, cancellation: new SharedArrayBuffer(4), syntheticHold: true });
    assert.ok((await blocked).completed);
    const retiring = once(worker, 'profile-retiring'), startedAt = performance.now();
    const capture = worker.startCpuProfile({ deadline: Date.now() + 80 }).then(() => false, () => true);
    await retiring;
    const markMs = performance.now() - startedAt;
    // Exceeds the old forced-retirement grace. Release only if still alive.
    await delay(2300);
    try { worker.postMessage({ type: 'cancel', id: 1 }); } catch {}
    const reply = await result;
    const observationMs = performance.now() - startedAt;
    assert.ok(!reply.completed || !reply.value.error);
    await worker.terminate(); await capture;
    samples.push({ completed: reply.completed, markMs, observationMs, peakRssBytes });
  } finally { clearInterval(sampler); await worker.terminate(); }
}
const summarize = key => {
  const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
  return { median: values[Math.floor(values.length / 2)], min: values[0], max: values.at(-1) };
};
console.log(JSON.stringify({ node: process.version, trials, completed: samples.filter(sample => sample.completed).length,
  interrupted: samples.filter(sample => !sample.completed).length, markMs: summarize('markMs'), observationMs: summarize('observationMs'), peakRssBytes: summarize('peakRssBytes'), samples }, null, 2));
