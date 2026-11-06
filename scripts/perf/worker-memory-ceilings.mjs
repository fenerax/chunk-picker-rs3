// Synthetic calculator peak-RSS measurement; no server or save files.
// Run under the shared heavy lock. Output is numeric metadata only.
import { writeScaledCompanion } from './scale-dataset.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

if (process.platform !== 'linux') throw new Error('Run this synthetic memory probe on Linux under the shared heavy lock.');
// Never inherit an installed dataset, addon, probe or profiling destination.
for (const key of Object.keys(process.env)) if (key.startsWith('RS3_') && !key.startsWith('RS3_HEAVY_LOCK_')) delete process.env[key];

const directory = path.resolve(process.argv[2] ?? '.local/worker-memory-synthetic');
const scaled = await writeScaledCompanion(directory, { scale: 116, seed: 1 });
Object.assign(process.env, scaled.environment);
const [{ selectedDataset: dataset }, bootstrap, pipeline, { buildWorld }, { ProcessWorker }, core] = await Promise.all([
  import('../../app/dataset-runtime.mjs'), import('../../app/dataset-bootstrap.mjs'), import('../../app/dataset-pipeline.mjs'),
  import('../../app/data/world.mjs'), import('../../app/tasks/process-worker.mjs'), import('../../app/core/state.mjs'),
]);
const loaded = await bootstrap.loadDatasetInputs(dataset, { loadTaskMap: false });
const definitions = pipeline.prepareServerDefinitions(JSON.parse(loaded.definitionBytes), dataset);
// The scaled pack has authored synthetic geography, not a private cache pin.
const datasetOptions = { cacheWalking: false, cacheResources: false, cacheArchaeology: false };
const world = buildWorld(definitions, { dataset, ...datasetOptions });
// Scaled token IDs do not retain the starter pack's tiny surface crop. Give
// them explicit synthetic grid adjacency rather than treating stub pins as real.
const surfaceChunks = [...world.chunks.keys()];
world.surface = new Set(surfaceChunks);
world.neighbors = new Map(surfaceChunks.map((id, i) => [id,
  [i - 64, i + 64, ...(i % 64 ? [i - 1] : []), ...(i % 64 < 63 ? [i + 1] : [])]
    .filter(index => index >= 0 && index < surfaceChunks.length).map(index => surfaceChunks[index])]));
if (surfaceChunks.length < 55) throw new Error('Synthetic probe requires at least 55 surface chunks.');
const bytes = Buffer.from(JSON.stringify(definitions)), shared = new SharedArrayBuffer(bytes.length);
Buffer.from(shared).set(bytes);
const state = core.createGroupState([{ id: 'one', name: 'Explorer 1', unlocked: surfaceChunks.slice(0, 30) },
  { id: 'two', name: 'Explorer 2', unlocked: surfaceChunks.slice(15, 45) }]);
// Trace both host and isolate GC to capture transient heaps, not just retained
// post-GC samples. Consume numeric trace fields only; keep raw logs out of reports.
let peakHeapMiB = 0, worker;
const fork = cp.fork;
cp.fork = (file, args, options) => {
  const child = fork(file, args, { ...options, execArgv: [...options.execArgv, '--trace-gc'], stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  let pending = '';
  child.stdout.on('data', bytes => {
    const lines = (pending + bytes).split('\n'); pending = lines.pop().slice(-4096);
    for (const line of lines) {
      const match = /^\[[^\]]*\]\s+[\d.]+ ms: (?:Scavenge|Mark-Compact|Minor Mark-Sweep|Mark-Sweep)[^\d]*([\d.]+) \(/.exec(line);
      if (match) peakHeapMiB = Math.max(peakHeapMiB, Number(match[1]));
    }
  });
  return child;
};
syncBuiltinESMExports();
try {
  worker = new ProcessWorker({ definitionBytes: shared, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest,
    datasetOptions,
    preparedDatasetStages: pipeline.preparedDefinitionStages(definitions),
    world: { chunks: world.chunks, areas: world.areas, surface: world.surface, neighbors: world.neighbors,
      walkable: world.walkable, f2p: world.f2p, sectionTopology: world.sectionTopology } },
  { probeImport: new URL('./worker-memory-probe.mjs', import.meta.url).href });
} finally { cp.fork = fork; syncBuiltinESMExports(); }
const marks = [];
let rejectWorker;
const failed = new Promise((_, reject) => { rejectWorker = reject; });
worker.on('error', rejectWorker);
worker.once('exit', () => rejectWorker(new Error('Synthetic calculator exited.')));
async function mark(stage) {
  const sample = await worker.getMemoryUsage();
  const status = await readFile(`/proc/${worker.pid}/status`, 'utf8');
  await new Promise(resolve => setImmediate(resolve));
  marks.push({ stage, peakRssMiB: Number(/^VmHWM:\s+(\d+)/m.exec(status)[1]) / 1024, peakHeapMiB,
    hostHeapMiB: sample.main.heapUsed / 1048576, workerHeapMiB: sample.workers[0].memoryUsage.heapUsed / 1048576 });
}
async function measure() {
  await once(worker, 'message'); await mark('ready');
  let id = 0;
  for (const type of ['evaluate', 'predict', 'roll-pool', 'death-estimates', 'area-check', 'sandbox']) {
    const sequence = ++id;
    const response = new Promise((resolve, reject) => {
      const receive = value => {
        if (value.id !== sequence || ['progress', 'prediction-prepared'].includes(value.type)) return;
        clean(); value.error ? reject(new Error(JSON.stringify(value.error))) : resolve();
      };
      const fail = error => { clean(); reject(error); };
      const clean = () => { worker.off('message', receive); worker.off('error', fail); worker.off('exit', exited); clearTimeout(timer); };
      const exited = () => fail(new Error('Synthetic calculator exited before its response.'));
      const timer = setTimeout(() => fail(new Error('Synthetic measurement timed out.')), 180000);
      worker.on('message', receive); worker.once('error', fail); worker.once('exit', exited);
    });
    const chunkId = surfaceChunks[45];
    worker.postMessage({ id: sequence, type, state, memberId: 'one', chunkId: type === 'area-check' ? { chunkIds: [chunkId], asMembers: false }
      : type === 'sandbox' ? { changes: { unlockChunks: [chunkId] } } : type === 'roll-pool' ? undefined : chunkId,
      chunkIds: surfaceChunks.slice(45, 55), reportProgress: true, resultTransport: 'json-shared-v1', resultView: 'play-v1', duoProjection: true });
    await response; await mark(type);
  }
}
let deadline;
try {
  await Promise.race([measure(), failed, new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Synthetic calculator measurement exceeded eight minutes.')), 8 * 60000);
  })]);
} finally {
  clearTimeout(deadline); await worker.terminate({ force: true });
  console.log(JSON.stringify({ node: process.version, inputMiB: scaled.inputBytes / 1048576, chunks: world.chunks.size,
    tasks: Object.values(definitions.challenges).reduce((n, rows) => n + Object.keys(rows).length, 0), completed: marks.length === 7, marks }, null, 2));
}
