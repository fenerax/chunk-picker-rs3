// Synthetic calculator code-path probe, without HTTP or a writable store.
// Uses a synthetic port in the main isolate to force GC between requests;
// eligibility compaction differs from production worker threads. Compare only
// matching runs. Small samples are diagnostics, not acceptance or latency gates.
// Usage: node --expose-gc scripts/perf/calculation-retention.mjs <app-dir> <report.json>
import { EventEmitter, once } from 'node:events';
import { registerHooks } from 'node:module';
import { setImmediate as turn } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createGroupState } from '../../app/core/state.mjs';
import { scaleWorkerDefinitions } from '../../tests/fixtures/why-scale.mjs';
import { taskId } from '../../app/tasks/engine.mjs';
if (!process.argv[2] || !process.argv[3] || typeof globalThis.gc !== 'function') throw Error('Explicit app directory, report path and --expose-gc required.');
const app = path.resolve(process.argv[2]), port = new EventEmitter(), pending = new Map();
let readyValue;
port.postMessage = message => {
  if (message.type === 'ready') { readyValue = message; port.emit('ready'); }
  else if (message.id !== undefined && message.type !== 'progress' && message.type !== 'prediction-prepared') {
    const resolve = pending.get(message.id); pending.delete(message.id); resolve(message);
  }
};
globalThis.__cacheProbe = { parentPort: port, workerData: { definitions: scaleWorkerDefinitions(),
  skillGuideCatalogue: { skills: [], tasks: [] }, omitReadyCatalogue: true,
  datasetOptions: { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
    metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false, reviewedOverlays: false } } };
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url !== pathToFileURL(path.join(app, 'tasks/worker.mjs')).href) return result;
  return { ...result, source: 'const { parentPort, workerData } = globalThis.__cacheProbe;\n' + String(result.source)
    .replace("import { parentPort, workerData } from 'node:worker_threads';", '') };
} });
const ready = once(port, 'ready'); await import(pathToFileURL(path.join(app, 'tasks/worker.mjs')).href); await ready;
let sequence = 0;
async function send(request) {
  const id = ++sequence, reply = new Promise(resolve => pending.set(id, resolve));
  const started = performance.now(); port.emit('message', { id, memberId: 'one', ...request });
  const message = await reply;
  if (message.error) throw Error(message.error.message);
  const row = { type: request.type, ms: performance.now() - started, evaluationMs: message.evaluationMs };
  await turn(); return row;
}
async function memory() { await turn(); globalThis.gc(); await turn(); return process.memoryUsage(); }
const initial = await memory(), cold = [], checkpoints = [];
for (let index = 0; index < 8; index++) {
  const state = createGroupState([{ id: 'one', name: 'Synthetic ' + index, unlocked: ['12850'] }]);
  cold.push(await send({ type: 'evaluate', state, input: 'group-' + index, pickerId: 'group-' + index,
    resultTransport: 'json-shared-v1', resultView: 'play-v1' }));
  if (index === 0 || index === 7) checkpoints.push({ groups: index + 1, memory: await memory() });
}
const state = createGroupState([{ id: 'one', name: 'Synthetic 7', unlocked: ['12850'] }]);
const warm = [];
for (const index of [16, 17, 18, 19, 20, 21]) warm.push(await send({ type: 'why-task', state, input: 'group-7', pickerId: 'group-7',
  chunkId: taskId('Extra', 'Regional objective ' + index) }));
warm.push(await send({ type: 'evaluate', state, input: 'group-7', pickerId: 'group-7', resultTransport: 'json-shared-v1', resultView: 'play-v1' }));
const report = { mechanism: 'main-isolate-synthetic-port', syntheticTasks: 20560, initial, cold, checkpoints, warm, final: await memory(), node: process.version };
await writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ heapGrowthMiB: (checkpoints.at(-1).memory.heapUsed - initial.heapUsed) / 1024 ** 2,
  firstGroupMiB: (checkpoints[0].memory.heapUsed - initial.heapUsed) / 1024 ** 2,
  coldMaxMs: Math.max(...cold.map(row => row.ms)), warmMaxMs: Math.max(...warm.map(row => row.ms)) }));
