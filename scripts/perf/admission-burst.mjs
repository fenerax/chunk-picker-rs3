// Synthetic scheduler probe, no HTTP, saves, acceptance workflow or timing gates.
// RS3_DATASET=open-f2p node scripts/perf/admission-burst.mjs <report.json> [groups=50]
// Add --acceptance-sized [source-root] for 24k tasks/100k aliases, four members,
// owned inputs, full responses and forced-GC retained-heap receipts.
// Use node --expose-gc for this mode; the source-root selects an unchanged arm.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { createGroupState } from '../../app/core/state.mjs';
import { scaleWorkerDefinitions } from '../../tests/fixtures/why-scale.mjs';
import { genericWorkerData } from '../../tests/helpers/worker-dataset.mjs';

const output = process.argv[2], groups = Number(process.argv[3] ?? 50);
if (!output || !Number.isSafeInteger(groups) || groups < 1 || groups > 100) throw Error('Report path and 1–100 synthetic groups required.');
const acceptance = process.argv[4] === '--acceptance-sized';
if (acceptance && typeof globalThis.gc !== 'function') throw Error('Acceptance-sized memory receipts require --expose-gc.');
const source = process.argv[5] ? pathToFileURL(path.resolve(process.argv[5]) + '/') : new URL('../../', import.meta.url);
const { createTaskScheduler } = await import(new URL('app/tasks/scheduler.mjs', source));
const { ProcessWorker } = await import(new URL('app/tasks/process-worker.mjs', source));
const fixture = acceptance ? await (await import('./snapshot-throughput-fixture.mjs')).snapshotThroughputFixture(groups + 1, source) : undefined;
const workerData = fixture?.workerData ?? genericWorkerData({ definitions: scaleWorkerDefinitions(),
  skillGuideCatalogue: { skills: [], tasks: [] }, datasetOptions: { cacheWalking: false, cacheResources: false,
    cacheArchaeology: false, cacheShops: false, metadataCorrections: false, equipmentCorrections: false,
    retainedTaskCorrections: false, reviewedOverlays: false } });
const started = performance.now();
let worker;
const scheduler = await createTaskScheduler({ maxCalculators: 1, workerData, maxRestarts: 0,
  ...(acceptance ? { workerFactory: data => worker = new ProcessWorker(data, {
    probeImport: new URL('./snapshot-throughput-memory.mjs', import.meta.url).href }) } : {}) });
const startupMs = performance.now() - started;
const state = createGroupState([{ id: 'one', name: 'Synthetic member', unlocked: ['12850'] }]);
const scope = n => scheduler.forPicker('p_' + n.toString(16).padStart(32, '0'));
const memory = async () => {
  if (!acceptance) return;
  await turn(); globalThis.gc?.(); await turn(); globalThis.gc?.(); await turn();
  return { controller: process.memoryUsage(), calculator: await worker.getMemoryUsage() };
};
const calculate = async (lane, key, view = acceptance ? 'full' : 'play-v1', index = 0, input = key) => {
  const at = performance.now();
  try {
    const value = await lane.evaluate(fixture?.states[index] ?? state, acceptance ? `member-${index % 4}` : 'one', 'evaluate', undefined, key, input, undefined, [], view);
    const ms = performance.now() - at, parseAt = performance.now();
    if (acceptance && !value.result) throw Error('Missing full result');
    return { ms, parseMs: performance.now() - parseAt, evaluationMs: value.evaluationMs, bytes: value.resultJSON?.byteLength ?? value.playJSON?.byteLength ?? 0 };
  } catch (error) { return { ms: performance.now() - at, error: error.code ?? error.status ?? error.name }; }
};
try {
  const initialMemory = await memory();
  const cold = await calculate(scope(1), 'cold');
  // Unique response keys with stable task input bypass the controller response
  // cache and exercise the worker's current hot calculation snapshot.
  const warm = [];
  for (let n = 0; n < 8; n++) {
    warm.push(await calculate(scope(1), `warm-${n}`, acceptance ? 'full' : 'play-v1', 0, 'cold'));
  }
  const warmMemory = await memory();
  if (acceptance) console.log(JSON.stringify({ phase: 'warm', snapshotCache: warmMemory.calculator.workers[0]?.memoryUsage.snapshotCache }));
  const everyday = [];
  if (acceptance) for (let n = 0; n < 7; n++) {
    const at = performance.now();
    const value = await scope(1).evaluate(fixture.states[0], 'member-0', 'why-task', fixture.subject, `why-${n}`, 'cold');
    everyday.push({ ms: performance.now() - at, evaluationMs: value.evaluationMs });
  }
  const at = performance.now();
  const pending = Array.from({ length: groups }, (_, n) => calculate(scope(n + 2), `burst-${n}`, acceptance ? 'full' : 'play-v1', n + 1));
  const queued = scheduler.getDiagnostics().queue;
  const burst = await Promise.all(pending);
  const burstMs = performance.now() - at;
  const retainedMemory = await memory();
  const interleaved = [];
  if (acceptance) for (const n of [0, 1, 0, 1, 0])
    interleaved.push(await calculate(scope(n + 2), `repeat-${interleaved.length}`, 'full', n + 1, `burst-${n}`));
  const report = { mechanism: acceptance ? 'owned-calculator-synthetic-24000-tasks-100000-aliases' : 'one-process-calculator-synthetic-20560-tasks',
    source: source.href, node: process.version, groups, shape: fixture?.shape,
    startupMs, cold, warm, everyday, interleaved, initialMemory, warmMemory, retainedMemory,
    burstMs, queued, burst, diagnostics: scheduler.getDiagnostics() };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  console.log(JSON.stringify({ startupMs, coldMs: cold.ms, warmP95Ms: p95(warm.map(row => row.ms)), burstMs: report.burstMs,
    burstP95Ms: p95(burst.map(row => row.ms)), serviceP95Ms: p95(burst.map(row => row.evaluationMs ?? 0)),
    refusals: burst.filter(row => row.error === 429).length, errors: burst.filter(row => row.error).length, queuedInputBytes: queued.inputBytes }));
} finally { await scheduler.close(); }
