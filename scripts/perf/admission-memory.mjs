// Synthetic paused-calculator memory probe. No HTTP or writable save store.
// RS3_DATASET=open-f2p node --expose-gc scripts/perf/admission-memory.mjs <report.json>
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { setImmediate as turn } from 'node:timers/promises';
import { makeCatalogue } from './owned-acceptance/fixture.mjs';
import { shapes } from './owned-acceptance/profile.mjs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { createGroupState, createResidentState } from '../../app/core/state.mjs';
import { createTaskScheduler } from '../../app/tasks/scheduler.mjs';
import { registerOwnedCalculatorBase, ownedCalculatorInput } from '../../app/tasks/owned-transport.mjs';

const output = process.argv[2];
if (!output || !globalThis.gc) throw Error('Report path and --expose-gc required.');
const data = makeCatalogue(shapes.acceptance, { id: selectedDataset.datasetId,
  contractVersion: selectedDataset.datasetContractVersion, digest: selectedDataset.digest });
registerOwnedCalculatorBase(data.base, data.pin);
const inputs = Array.from({ length: 50 }, (_, n) => {
  const state = createGroupState([{ id: 'one', name: `Synthetic ${n}`, unlocked: ['12850'] }]);
  state.tasks = [...data.base.tasks]; state.identityRegistry = data.base.identityRegistry;
  return { state: { revision: 0, members: [{ id: 'one' }] }, stateInput: {
    owned: ownedCalculatorInput(createResidentState(state, data.base)), inputKey: `input-${n}` } };
});
const clock = { now: () => 0, setTimeout: () => ({ unref() {} }), clearTimeout() {} };
const scheduler = await createTaskScheduler({ idleClock: clock, deadlineClock: clock, workerFactory() {
  const worker = new EventEmitter(); worker.postMessage = () => {}; worker.terminate = async () => {};
  queueMicrotask(() => worker.emit('message', { type: 'ready', catalogue: [] })); return worker;
} });
async function heap() { await turn(); globalThis.gc(); await turn(); globalThis.gc(); return process.memoryUsage().heapUsed; }
let promises = [];
try {
  const before = await heap();
  promises = inputs.map(({ state, stateInput }, n) => scheduler.forPicker('p_' + (n + 1).toString(16).padStart(32, '0'))
    .evaluate(state, 'one', 'evaluate', undefined, `key-${n}`, stateInput.inputKey, undefined, [], 'full', stateInput).catch(() => {}));
  const after = await heap(), diagnostics = scheduler.getDiagnostics();
  const report = { tasks: shapes.acceptance.tasks, aliases: shapes.acceptance.aliases, groups: 50,
    queued: diagnostics.queue.depth, queuedInputBytes: diagnostics.queue.inputBytes, controllerHeapDeltaBytes: after - before };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await scheduler.close(); await Promise.all(promises); }
