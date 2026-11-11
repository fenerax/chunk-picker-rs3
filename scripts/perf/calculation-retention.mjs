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
const profiling = process.argv.includes('--profile');
globalThis.__retentionProfile = { timings: {}, measure(name, operation) {
  const started = performance.now();
  try { return operation(); } finally { this.timings[name] = (this.timings[name] ?? 0) + performance.now() - started; }
} };
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
  if (url !== pathToFileURL(path.join(app, 'tasks/worker.mjs')).href
    && !(profiling && ['serialized-snapshot-cache.mjs', 'snapshot-hot-set.mjs']
      .some(name => url === pathToFileURL(path.join(app, 'tasks', name)).href))) return result;
  let source = String(result.source);
  if (profiling && url === pathToFileURL(path.join(app, 'tasks/snapshot-hot-set.mjs')).href)
    source = source.replace('canHold(cost) {', 'canHold(cost) { globalThis.__retentionProfile.timings.hotHeapChargeMiB = cost / 1024 ** 2;');
  if (profiling && url === pathToFileURL(path.join(app, 'tasks/serialized-snapshot-cache.mjs')).href) {
    source = source.replace('serialize, DefaultDeserializer', 'serialize as rawSerialize, DefaultDeserializer')
      .replace('encodeSnapshotBytes, decodeSnapshotBytes,', 'encodeSnapshotBytes as rawEncode, decodeSnapshotBytes as rawDecode,')
      .replace('return reader.readValue();', "return globalThis.__retentionProfile.measure('deserialize', () => reader.readValue());");
    source += `\nconst serialize = value => globalThis.__retentionProfile.measure('serialize', () => rawSerialize(value));
const encodeSnapshotBytes = value => globalThis.__retentionProfile.measure('compress', () => rawEncode(value));
const decodeSnapshotBytes = value => globalThis.__retentionProfile.measure('decompress', () => rawDecode(value));\n`;
  }
  if (url === pathToFileURL(path.join(app, 'tasks/worker.mjs')).href) {
    source = 'const { parentPort, workerData } = globalThis.__cacheProbe;\n' + source
      .replace("import { parentPort, workerData } from 'node:worker_threads';", '');
    if (source.includes('const completeCache = createSerializedSnapshotCache')) source = source.replace('const snapshots = completeCache.entries;',
      `const snapshots = completeCache.entries;
globalThis.__cacheProbe.read = () => ({ hotEntries: snapshotOptions.hotSet.size, hotHeapBytes: snapshotOptions.hotSet.bytes,
  ledgerBytes: snapshotBudget.bytes, snapshots: [...snapshots.values()].map(record => ({ heap: !!record.value, cost: record.cost })) });`);
    if (profiling) {
      for (const name of ['mapPlayResult', 'sharedJSON']) {
        source = source.replace('function ' + name + '(', 'function raw_' + name + '(');
        source += `\nfunction ${name}(...args) { return globalThis.__retentionProfile.measure('${name}', () => raw_${name}(...args)); }\n`;
      }
      source = source.replace('taskWhyDisplay, createTaskWhyIndex }', 'taskWhyDisplay, createTaskWhyIndex as rawWhyIndex }');
      source += "\nfunction createTaskWhyIndex(...args) { return globalThis.__retentionProfile.measure('whyIndex', () => rawWhyIndex(...args)); }\n";
    }
  }
  return { ...result, source };
} });
const ready = once(port, 'ready'); await import(pathToFileURL(path.join(app, 'tasks/worker.mjs')).href); await ready;
let sequence = 0;
async function send(request, capture) {
  const id = ++sequence, reply = new Promise(resolve => pending.set(id, resolve));
  globalThis.__retentionProfile.timings = {};
  const started = performance.now(); port.emit('message', { id, memberId: 'one', ...request });
  const message = await reply;
  if (message.error) throw Error(message.error.message);
  const row = { type: request.type, ms: performance.now() - started, evaluationMs: message.evaluationMs,
    timingMs: message.timingMs, ...(profiling ? { profile: globalThis.__retentionProfile.timings } : {}) };
  if (capture) await writeFile(capture, Buffer.from(message.resultJSON));
  await turn(); return row;
}
// Separate collections let weak metadata/last-turn WeakRefs settle before the
// receipt. These are memory checkpoints, outside every latency sample.
async function memory() { await turn(); globalThis.gc(); await turn(); globalThis.gc(); await turn(); return process.memoryUsage(); }
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
const report = { mechanism: 'main-isolate-synthetic-port', syntheticTasks: 20560, initial, cold, checkpoints, warm, final: await memory(),
  accounting: globalThis.__cacheProbe.read?.(), node: process.version };
await writeFile(process.argv[3], JSON.stringify(report, null, 2));
const wireFixture = process.argv.indexOf('--wire-fixture');
if (wireFixture !== -1) await send({ type: 'evaluate', state, input: 'group-7', pickerId: 'group-7',
  resultTransport: 'json-shared-v1', resultView: 'full' }, process.argv[wireFixture + 1]);
console.log(JSON.stringify({ heapGrowthMiB: (checkpoints.at(-1).memory.heapUsed - initial.heapUsed) / 1024 ** 2,
  firstGroupMiB: (checkpoints[0].memory.heapUsed - initial.heapUsed) / 1024 ** 2,
  coldMaxMs: Math.max(...cold.map(row => row.ms)), warmMaxMs: Math.max(...warm.map(row => row.ms)) }));
