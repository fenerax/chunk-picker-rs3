// Test-only instrumentation, loaded from a file in the synthetic calculator.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const snapshots = [];
let ledger = () => [], request, locations = 0, paused = false;
const probe = globalThis.__residentPlanningProbe = {
  evaluateFull: 0,
  snapshots,
  setLedger: value => { ledger = value; },
  location() {
    locations++;
    if (!workerData.pauseResidentPlanning || !request?.residentOnly || paused || locations < 2) return;
    paused = true;
    parentPort.postMessage({ id: request.id, type: 'progress', planningPaused: true });
    const cancellation = new Int32Array(request.cancellation), deadline = Date.now() + 15000;
    // Wait for a real scheduler cancellation after at least one location was
    // built. This is a synchronization barrier, never a performance sample.
    while (!Atomics.load(cancellation, 0)) {
      if (Date.now() > deadline) throw new Error('Synthetic planning cancellation did not arrive.');
      Atomics.wait(cancellation, 0, 0, 10);
    }
  },
};
parentPort.on('message', message => {
  if (!['cancel', 'supersede'].includes(message.type)) request = message;
});
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  let anchor, replacement;
  if (url.endsWith('/tasks/worker.mjs')) {
    anchor = 'function evaluateFull(state, memberId, { includeViews = true, timingMs, cacheSizing = false } = {}) {';
    replacement = anchor + '\n  globalThis.__residentPlanningProbe.evaluateFull++;';
  } else if (url.endsWith('/tasks/chunk-planning-index.mjs')) {
    anchor = 'const add = (task, location, reason) => {';
    replacement = anchor + '\n    globalThis.__residentPlanningProbe.location();';
  } else if (url.endsWith('/tasks/snapshot-cache.mjs')) {
    anchor = 'const metadata = new WeakMap(), results = new WeakMap(), slots = new Map();';
    replacement = anchor + `
  globalThis.__residentPlanningProbe.snapshots.push(() => [...entries].map(([key, value]) => {
    const entry = metadata.get(value);
    return { owner: 'picker:' + entry.owner, revision: value.revision, planning: !!value.planningIndex,
      charge: entry.measuredCost, planningCharge: entry.costs?.planning ?? 0,
      measured: snapshotBytes(value, entry.state, context(value.baseline), locations(value.baseline), entry.predictionBytes)
        + Buffer.byteLength(key) + Buffer.byteLength(entry.owner) };
  }));`;
  } else if (url.endsWith('/tasks/eligibility-cache.mjs')) {
    anchor = 'const retained = new Map();';
    replacement = anchor + `
  globalThis.__residentPlanningProbe.setLedger(() => [...retained.values()].map(({ cost, owner }) => ({ cost, owner })));`;
  } else return result;
  const source = String(result.source);
  if (!source.includes(anchor)) throw new Error('Resident planning probe anchor changed.');
  return { ...result, source: source.replace(anchor, replacement) };
} });
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message, ...rest) => post(message.id === undefined || message.type === 'progress' ? message : {
  ...message, probe: { evaluateFull: probe.evaluateFull, locations,
    snapshots: snapshots.flatMap(read => read()), ledger: ledger() },
}, ...rest);
