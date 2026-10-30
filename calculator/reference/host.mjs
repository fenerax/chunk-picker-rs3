import { Worker, parentPort, workerData as bundle } from 'node:worker_threads';
import { deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { selectedDataset } from '../../app/dataset-runtime.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { createRuleRegistry, evaluateRollPool } from '../../app/core/rules.mjs';
import { normalizeSandboxRequest, applySandboxChanges } from '../../app/sandbox.mjs';
import '../../app/tasks/engine.mjs';
import { STATE_SNAPSHOT_LIMIT } from '../../app/tasks/state-transfer.mjs';
import { parse } from './codec.mjs';

export const supports = ['evaluate', 'predict', 'death-estimates', 'chunk-planning', 'sandbox', 'area-check', 'prepare-rules', 'roll-pool'];
const engine = { name: 'javascript-reference', version: createHash('sha256').update(['./host.mjs', './main.mjs', './codec.mjs', '../../app/tasks/worker.mjs', '../../app/tasks/engine.mjs', '../../app/core/rules.mjs', '../../app/core/planning.mjs'].map(file => readFileSync(new URL(file, import.meta.url))).join('\0')).digest('hex') };
if (bundle.datasetDigest !== selectedDataset.digest) throw new TypeError('invalid');
const registry = createRuleRegistry(bundle.extraRules ?? []);
const poolWorld = buildWorld(bundle.definitions, { dataset: selectedDataset, ...bundle.datasetOptions });
const world = bundle.world;
for (const key of ['chunks', 'areas']) if (!(world[key] instanceof Map)) world[key] = new Map(Array.isArray(world[key]) ? world[key] : Object.entries(world[key] ?? {}));
if (world.surface && !(world.surface instanceof Set)) world.surface = new Set(world.surface);
const inputBundle = { ...bundle, world };
const snapshots = new Map(), sentSnapshots = new Map(), latest = new Map(), queue = [];
let worker, workerRevision = -1, active, ready = false, catalogue = [], first = true, needCatalogue = false;
const emit = message => parentPort.postMessage(message);
const fail = (id, kind) => emit({ type: 'error', id, error: { kind, message: kind } });
function raw(name, value) { return { name, chunks: [value] }; }
function reuse(value, name) {
  const { memberId, taskInputKey, sourceRevision, priority } = value;
  return { name, chunks: [JSON.stringify({ memberId, taskInputKey, sourceRevision, priority }).slice(0, -1),
    ',"play":', value.playJSON, ',"duo":', value.duoJSON, ',"duo-sidebar":', value.duoSidebarJSON, '}'] };
}
function start() {
  ready = false; workerRevision = -1; sentSnapshots.clear();
  worker = new Worker(new URL('../../app/tasks/worker.mjs', import.meta.url), { workerData: { ...inputBundle, omitReadyCatalogue: needCatalogue ? false : inputBundle.omitReadyCatalogue }, stdout: true, stderr: true });
  worker.stdout.resume(); worker.stderr.resume();
  worker.on('error', () => { fail(active?.header.id, 'failed'); process.exit(1); });
  worker.on('message', message => {
    if (message.type === 'ready') {
      if (message.datasetDigest !== bundle.datasetDigest) { fail(undefined, 'failed'); process.exit(1); }
      catalogue = [...message.catalogue ?? [], ...(message.dynamicCatalogueBytes ? deserialize(message.dynamicCatalogueBytes) : [])];
      ready = true;
      if (first) {
        first = false;
        emit({ type: 'ready', datasetDigest: message.datasetDigest, engine, supports, compileMs: message.compileMs,
          ...(bundle.omitReadyCatalogue ? {} : { values: { catalogue } }) });
      }
      void pump(); return;
    }
    if (!active || message.id !== active.header.id) return;
    const { header } = active;
    if (message.type === 'progress') {
      const now = performance.now();
      if (now - active.progressAt >= 1000) { active.progressAt = now; emit({ type: 'progress', id: header.id }); }
      return;
    }
    if (message.type === 'prediction-prepared') {
      const owner = message.unlockReuse;
      if (!active.cancelled) emit({ type: 'prediction-prepared', id: header.id, memberId: owner.memberId,
        taskInputKey: owner.taskInputKey, sourceRevision: owner.sourceRevision, priority: owner.priority,
        rawParts: [reuse(owner, 'owner-reuse')] });
      return;
    }
    if (message.error) fail(header.id, message.error.name === 'TypeError' ? 'invalid' : 'failed');
    else {
      const values = {};
      let rawParts = [], timingMs = message.timingMs, evaluationMs = message.evaluationMs;
      if (header.type === 'evaluate') {
        rawParts.push(raw('play', message.playJSON));
        if (message.resultJSON) rawParts.push(raw('full', message.resultJSON));
        if (message.duoJSON) rawParts.push(raw('duo', message.duoJSON));
        if (message.duoSidebarJSON) rawParts.push(raw('duo-sidebar', message.duoSidebarJSON));
        if (header.view === 'full' && header.projections?.length && !active.full) {
          active.full = rawParts; active.fullTiming = timingMs; active.fullEvaluationMs = evaluationMs;
          worker.postMessage({ ...active.message, resultView: 'play-v1' }); return;
        }
        if (active.full) {
          rawParts = [...new Map([...rawParts, ...active.full].map(part => [part.name, part])).values()];
          timingMs = Object.fromEntries([...new Set([...Object.keys(active.fullTiming), ...Object.keys(timingMs)])]
            .map(key => [key, (active.fullTiming[key] ?? 0) + (timingMs[key] ?? 0)]));
          evaluationMs += active.fullEvaluationMs;
        }
      } else if (header.type === 'predict') {
        values.delta = message.result;
        if (message.unlockReuse) rawParts.push(reuse(message.unlockReuse, 'owner-reuse'));
        if (message.partnerUnlockReuse) rawParts.push(reuse(message.partnerUnlockReuse, 'partner-reuse'));
      } else if (message.sandboxJSON) rawParts.push(raw('sandbox', message.sandboxJSON));
      else values[{ 'death-estimates': 'estimates', 'chunk-planning': 'planning', 'area-check': 'area-check', 'prepare-rules': 'prepared' }[header.type]] = message.result;
      emit({ type: 'result', id: header.id, values, rawParts, timingMs, evaluationMs,
        ...(message.resultCache ? { cache: message.resultCache } : {}),
        cancelled: active.cancelled || !!message.cancelled || !!message.result?.cancelled });
    }
    active = undefined; void pump();
  });
}
function cancel(request) {
  request.cancelled = true;
  if (request === active) { Atomics.store(new Int32Array(request.cancellation), 0, 1); worker.postMessage({ type: 'cancel', id: request.header.id }); }
}
parentPort.on('message', ({ header, body }) => {
  try {
    if (header.type === 'cancel') {
      if (!Number.isSafeInteger(header.id) || body.length) throw new TypeError();
      if (active?.header.id === header.id) cancel(active);
      for (const entry of queue) if (entry.header.id === header.id) cancel(entry);
      return;
    }
    if (header.type === 'supersede') {
      if (!validPicker(header.pickerId) || !Number.isSafeInteger(header.revision) || header.revision < 0 || body.length) throw new TypeError();
      latest.set(header.pickerId, Math.max(latest.get(header.pickerId) ?? -1, header.revision));
      for (const entry of [active, ...queue]) if (entry?.header.pickerId === header.pickerId && entry.header.revision < header.revision) cancel(entry);
      return;
    }
    if (!supports.includes(header.type) || !Number.isSafeInteger(header.id) || header.id < 0 || !validPicker(header.pickerId)
      || !Number.isSafeInteger(header.revision) || header.revision < 0 || typeof header.input !== 'string'
      || header.snapshotKey !== JSON.stringify([header.revision, header.input]) || !['body', 'ref'].includes(header.state)) throw new TypeError();
    if (header.type !== 'prepare-rules' && typeof header.memberId !== 'string') throw new TypeError();
    if (header.type === 'evaluate' && (!['full', 'play-v1'].includes(header.view) || !Array.isArray(header.projections ?? [])
      || (header.projections ?? []).some(p => !['duo', 'duo-sidebar'].includes(p)))) throw new TypeError();
    const key = JSON.stringify([header.pickerId, header.input]);
    let state;
    if (header.state === 'body') state = parse(body);
    else {
      if (body.length) throw new TypeError();
      state = snapshots.get(key);
      if (!state) { fail(header.id, 'snapshot-missing'); return; }
      state = { ...state, revision: header.revision };
    }
    const ids = header.memberIds ?? header.stateMemberIds;
    if (state?.schemaVersion !== 1 || state.revision !== header.revision || !Array.isArray(state.tasks) || !Array.isArray(state.history)
      || !Array.isArray(state.members) || !state.members.length || state.members.some(m => typeof m?.id !== 'string')
      || new Set(state.members.map(m => m.id)).size !== state.members.length
      || ids !== undefined && (!Array.isArray(ids) || JSON.stringify(ids) !== JSON.stringify(state.members.map(m => m.id)))
      || header.memberId !== undefined && !state.members.some(m => m.id === header.memberId)) throw new TypeError();
    snapshots.delete(key); snapshots.set(key, state);
    while (snapshots.size > STATE_SNAPSHOT_LIMIT) snapshots.delete(snapshots.keys().next().value);
    if (queue.length >= 64 || active?.header.id === header.id || queue.some(e => e.header.id === header.id)) throw new TypeError();
    queue.push({ header, state, cancellation: new SharedArrayBuffer(4), cancelled: header.revision < (latest.get(header.pickerId) ?? -1), progressAt: performance.now() });
    void pump();
  } catch { fail(header.id, 'invalid'); }
});
function validPicker(id) { return id === 'legacy-shared' || /^p_[a-f0-9]{32}$/.test(id ?? ''); }
async function pump() {
  if (active || !ready || !queue.length) return;
  const entry = queue[0];
  // Only death-estimates consults today's worker's global high-water mark.
  // Reset that lane for older inputs; supersession stays per picker here.
  if (entry.header.type === 'death-estimates' && entry.header.revision < workerRevision) {
    ready = false; await worker.terminate(); start(); return;
  }
  if (entry.header.type === 'roll-pool' && !needCatalogue && entry.header.draft?.changes?.doneTasks?.some(id => !entry.state.tasks.some(task => task.id === id) && !catalogue.some(task => task.id === id))) {
    needCatalogue = true; ready = false; await worker.terminate(); start(); return;
  }
  active = queue.shift();
  const { header, state } = active;
  if (active.cancelled) { emit({ type: 'result', id: header.id, values: {}, cancelled: true }); active = undefined; void pump(); return; }
  workerRevision = Math.max(workerRevision, header.revision);
  if (header.type === 'roll-pool') {
    const began = performance.now();
    try {
      let hypothetical = state;
      if (header.draft) {
        const draft = normalizeSandboxRequest({ ...header.draft, memberId: header.memberId, baseRevision: state.revision }, { state, world: poolWorld, catalogue });
        hypothetical = applySandboxChanges(state, header.memberId, draft.changes, catalogue);
      }
      emit({ type: 'result', id: header.id, values: { pool: evaluateRollPool(poolWorld, hypothetical, header.memberId, registry) }, timingMs: { totalMs: performance.now() - began } });
    } catch (error) { fail(header.id, error instanceof TypeError ? 'invalid' : 'failed'); }
    active = undefined; void pump(); return;
  }
  const input = JSON.stringify([header.pickerId, header.input]);
  const fresh = header.state === 'body' || !sentSnapshots.has(input);
  sentSnapshots.delete(input); sentSnapshots.set(input, true);
  while (sentSnapshots.size > STATE_SNAPSHOT_LIMIT) sentSnapshots.delete(sentSnapshots.keys().next().value);
  active.message = { id: header.id, type: header.type, ...(fresh ? { state } : {}), memberId: header.memberId, input,
    snapshotKey: JSON.stringify([header.revision, input]), chunkId: ['sandbox', 'area-check'].includes(header.type) ? header.draft : header.chunkId,
    chunkIds: header.chunkIds, reportProgress: true, predictionProgress: true, cancellation: active.cancellation,
    ...(['evaluate', 'sandbox'].includes(header.type) ? { resultTransport: 'json-shared-v1', resultView: header.view,
      duoProjection: header.projections?.includes('duo'), duoSidebarProjection: header.projections?.includes('duo-sidebar') } : {}) };
  worker.postMessage(active.message);
}
start();
