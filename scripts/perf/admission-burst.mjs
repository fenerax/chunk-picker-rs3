// Synthetic scheduler probe, no HTTP, saves, acceptance workflow or timing gates.
// RS3_DATASET=open-f2p node scripts/perf/admission-burst.mjs <report.json> [groups=50]
import { writeFile } from 'node:fs/promises';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { scaleWorkerDefinitions } from '../../tests/fixtures/why-scale.mjs';
import { genericWorkerData } from '../../tests/helpers/worker-dataset.mjs';

const output = process.argv[2], groups = Number(process.argv[3] ?? 50);
if (!output || !Number.isSafeInteger(groups) || groups < 1 || groups > 100) throw Error('Report path and 1–100 synthetic groups required.');
const workerData = genericWorkerData({ definitions: scaleWorkerDefinitions(),
  skillGuideCatalogue: { skills: [], tasks: [] }, datasetOptions: { cacheWalking: false, cacheResources: false,
    cacheArchaeology: false, cacheShops: false, metadataCorrections: false, equipmentCorrections: false,
    retainedTaskCorrections: false, reviewedOverlays: false } });
const started = performance.now();
const scheduler = await createTaskScheduler({ maxCalculators: 1, workerData, maxRestarts: 0 });
const startupMs = performance.now() - started;
const state = createGroupState([{ id: 'one', name: 'Synthetic member', unlocked: ['12850'] }]);
const scope = n => scheduler.forPicker('p_' + n.toString(16).padStart(32, '0'));
const calculate = async (lane, key, view = 'play-v1') => {
  const at = performance.now();
  try {
    const value = await lane.evaluate(state, 'one', 'evaluate', undefined, key, key, undefined, [], view);
    return { ms: performance.now() - at, evaluationMs: value.evaluationMs, bytes: value.playJSON?.byteLength ?? 0 };
  } catch (error) { return { ms: performance.now() - at, error: error.code ?? error.status ?? error.name }; }
};
try {
  const cold = await calculate(scope(1), 'cold');
  // Unique response keys with stable task input bypass the controller response
  // cache and exercise the worker's current hot calculation snapshot.
  const warm = [];
  for (let n = 0; n < 8; n++) {
    const at = performance.now();
    const value = await scope(1).evaluate(state, 'one', 'evaluate', undefined, `warm-${n}`, 'cold', undefined, [], 'play-v1');
    warm.push({ ms: performance.now() - at, evaluationMs: value.evaluationMs });
  }
  const at = performance.now();
  const pending = Array.from({ length: groups }, (_, n) => calculate(scope(n + 2), `burst-${n}`));
  const queued = scheduler.getDiagnostics().queue;
  const burst = await Promise.all(pending);
  const report = { mechanism: 'one-process-calculator-synthetic-20560-tasks', node: process.version, groups,
    startupMs, cold, warm, burstMs: performance.now() - at, queued, burst, diagnostics: scheduler.getDiagnostics() };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  console.log(JSON.stringify({ startupMs, coldMs: cold.ms, warmP95Ms: p95(warm.map(row => row.ms)), burstMs: report.burstMs,
    burstP95Ms: p95(burst.map(row => row.ms)), serviceP95Ms: p95(burst.map(row => row.evaluationMs ?? 0)),
    refusals: burst.filter(row => row.error === 429).length, errors: burst.filter(row => row.error).length, queuedInputBytes: queued.inputBytes }));
} finally { await scheduler.close(); }
