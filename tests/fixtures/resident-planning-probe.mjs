// Test-only instrumentation, loaded from a file in the synthetic calculator.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { serialize } from 'node:v8';
import { createHash } from 'node:crypto';

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
    anchor = 'function evaluateFull(state, memberId, { includeViews = true, timingMs, cacheSizing = false, pickerId } = {}) {';
    replacement = anchor + '\n  globalThis.__residentPlanningProbe.evaluateFull++;';
  } else if (url.endsWith('/tasks/chunk-planning-index.mjs')) {
    anchor = 'const add = (task, location, reason) => {';
    replacement = anchor + '\n    globalThis.__residentPlanningProbe.location();';
  } else if (url.endsWith('/tasks/serialized-snapshot-cache.mjs')) {
    anchor = 'const stage = (key, value, _state, owner) => {';
    replacement = `
  globalThis.__residentPlanningProbe.snapshots.push(() => [...entries].map(([key, record]) => {
    const { snapshot: value } = decode(record.bytes);
    return { owner: 'picker:' + record.owner, revision: value.revision, planning: !!value.planningIndex,
      whyIndexId: globalThis.__residentPlanningProbe.indexId(value.whyIndex),
      whyIndexCharge: globalThis.__residentPlanningProbe.indexBytes(value.whyIndex),
      charge: record.cost, planningCharge: globalThis.__residentPlanningProbe.indexBytes(value.planningIndex),
      measured: serializedSnapshotBytes(key, record.owner, record.bytes) };
  }));` + anchor;
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
  if (url.endsWith('/tasks/serialized-snapshot-cache.mjs')) patched = patched.replace('const raw = serialize(', "globalThis.__residentPlanningProbe.stage('charge');\n      const raw = serialize(");
  if (url.endsWith('/tasks/worker.mjs')) patched = patched.replace('checkpoint();\n    yield row;', "globalThis.__residentPlanningProbe.stage('projection');\n    checkpoint();\n    yield row;");
  return { ...result, source: patched };
} });
// Identity now means the persisted index bytes, rather than a resident graph.
probe.indexId = value => value ? createHash('sha256').update(serialize(value)).digest('hex') : undefined;
probe.indexBytes = value => value ? serialize(value).byteLength : 0;
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message, ...rest) => post(message.id === undefined || message.type === 'progress' ? message : {
  ...message, probe: { evaluateFull: probe.evaluateFull, locations,
    snapshots: snapshots.flatMap(read => read()), ledger: ledger() },
}, ...rest);
