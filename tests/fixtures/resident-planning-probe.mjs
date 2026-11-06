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
    if (locations >= 2) probe.stage('location');
  },
  stage(stage) {
    const selected = workerData.pauseResidentPlanning === true ? 'location' : workerData.pauseResidentPlanning;
    if (selected !== stage || !request?.residentOnly || paused) return;
    paused = true;
    parentPort.postMessage({ id: request.id, type: 'progress', planningPaused: true, stage });
    const cancellation = new Int32Array(request.cancellation), deadline = Date.now() + 15000;
    // Wait for a real scheduler cancellation after at least one location was
    // built. This is a synchronization barrier, never a performance sample.
    while (!Atomics.load(cancellation, 0)) {
      if (Date.now() > deadline) throw new Error('Synthetic planning cancellation did not arrive.');
      Atomics.wait(cancellation, 0, 0, 10);
    }
    // Emulate an uninterruptible native segment. A fake scheduler clock drives
    // retirement, so this checks a work bound rather than elapsed PC time.
    if (workerData.stuckResidentPlanning) for (;;) Atomics.wait(cancellation, 0, 1, 10000);
  },
};
parentPort.on('message', message => {
  if (!['cancel', 'supersede'].includes(message.type)) request = { id: message.id, residentOnly: message.residentOnly, cancellation: message.cancellation };
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
  let patched = source.replace(anchor, replacement);
  if (url.endsWith('/tasks/worker.mjs')) patched = patched.replace('if (cacheSizing) trackSnapshotCore(result);',
    'if (workerData.fixedEngineTiming) result.metrics.elapsedMs = 1.25;\n  if (cacheSizing) trackSnapshotCore(result);');
  if (url.endsWith('/tasks/chunk-planning-index.mjs')) patched = patched.replace('if (Array.isArray(record.SourceLocations)', "globalThis.__residentPlanningProbe.stage('scan');\n        if (Array.isArray(record.SourceLocations)");
  if (url.endsWith('/tasks/snapshot-cache.mjs')) patched = patched.replace('let cost = bytes.byteLength;', "let cost = bytes.byteLength;\n  globalThis.__residentPlanningProbe.stage('charge');");
  if (url.endsWith('/tasks/worker.mjs')) patched = patched.replace('checkpoint();\n    yield row;', "globalThis.__residentPlanningProbe.stage('projection');\n    checkpoint();\n    yield row;");
  return { ...result, source: patched };
} });
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message, ...rest) => post(message.id === undefined || message.type === 'progress' ? message : {
  ...message, probe: { evaluateFull: probe.evaluateFull, locations,
    snapshots: snapshots.flatMap(read => read()), ledger: ledger() },
}, ...rest);
