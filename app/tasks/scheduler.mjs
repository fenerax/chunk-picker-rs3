const PROFILE_ENABLED = process.env.RS3_PROFILE === '1';
const profile = PROFILE_ENABLED ? await import('../profile-spans.mjs') : undefined;
import { WarmStoreWorker } from './warm-store-worker.mjs';
import path from 'node:path';
import { ProcessWorker } from './process-worker.mjs';
import { createCalculatorPool } from './calculator-pool.mjs';
import { createSessionResidency } from './session-residency.mjs';
import { createHash } from 'node:crypto';
import { deserialize } from 'node:v8';
import { createUnlockResultCache, taskReuseInputKey } from './unlock-reuse.mjs';
import { STATE_SNAPSHOT_LIMIT } from './state-transfer.mjs';
import { TASK_WORKER_RESOURCE_LIMITS } from './worker-limits.mjs';
import { hasRandomStartChoices } from '../core/state.mjs';
import { createWorkerPreparation } from './prepared-collection.mjs';
import { eligibilityTransferList, releaseEligibilityChunk } from './eligibility-transfer.mjs';

// The server's compatibility context has one protocol identity.
export function pickerJobId(pickerId = 'legacy-shared') {
  if (pickerId === 'legacy') return 'legacy-shared';
  if (typeof pickerId !== 'string' || pickerId !== 'legacy-shared' && !/^p_[a-f0-9]{32}$/.test(pickerId)) throw new TypeError('Invalid calculator pickerId.');
  return pickerId;
}
const pickerKey = (pickerId, key) => JSON.stringify([pickerId, key]);
// Keep the established positional API for legacy callers. Contexts borrow a
// bound facade; all lanes and their admission/memory limits remain shared.
const pickerArguments = { peekPrediction: 4, cancelRankingPrewarm: 1, preparedEvaluation: 3, prepareRules: 2,
  evaluate: 12, supersede: 3, supersedeDisplay: 2, setRevision: 2, prewarm: 4, prewarmTasks: 4,
  cancelPrewarm: 1, retireWarmPrediction: 0, noteActivity: 0, openSession: 0, getDiagnostics: 0, getClientHealth: 0 };
const unavailable = message => Object.assign(new Error(message), { status: 503 });
const queueFull = () => Object.assign(new Error('Task calculation budget is full. Wait for pending tasks and retry.'), { status: 429, retryAfter: 1 });
const positive = (value, name, minimum = 1) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer of at least ${minimum}.`);
};
const superseded = () => Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 });
const residentPlanningUnavailable = () => Object.assign(new Error('Resident planning yielded or missed.'), { code: 'RESIDENT_PLANNING_UNAVAILABLE' });
// Isolate native allocations and relay heaps on every server platform. Explicit
// thread mode is retained for diagnostics; production uses owned processes.
const nativeWorker = data => process.env.RS3_TASK_WORKER_MODE === 'thread'
  ? new WarmStoreWorker(new URL('./worker.mjs', import.meta.url), { workerData: { ...data, enforceMemoryLimit: true }, resourceLimits: TASK_WORKER_RESOURCE_LIMITS },
    typeof data?.warmStoreDirectory === 'string' ? [path.join(data.warmStoreDirectory, 'results')] : []) : new ProcessWorker(data);
// Built-in advisory lanes never read the ready catalogue, so their workers skip
// sending it. The flag is always overwritten: callers cannot strip foreground's.
export const nativeWorkerInput = (workerData, includeReadyCatalogue) => ({ ...workerData, omitReadyCatalogue: !includeReadyCatalogue });
// Rules are included even for direct callers that omit the gameplay fingerprint.
const predictionInput = (state, input) => createHash('sha256').update(JSON.stringify([input,
  state.rules, state.taskRules, state.members?.map(member => [member.id, member.taskRules, state.legacy?.maps?.[member.sourceMapId]?.rules,
    hasRandomStartChoices(state, member) ? member.pendingRoll : []])])).digest('hex');
export const predictionCacheKey = (state, memberId, chunkId, input) => JSON.stringify([state.revision, memberId, String(chunkId), predictionInput(state, input)]);

// Preserve lazy result access when adding per-waiter metadata. Object spread
// would parse the full task result even for callers that only send its bytes.
const evaluationWith = (value, metadata) => {
  const result = Object.defineProperties({ ...metadata }, Object.getOwnPropertyDescriptors(value));
  // Observability must not change serialized scheduler replies or cache sizes.
  for (const key of ['coalesced', 'calculatorStarted']) if (Object.hasOwn(result, key)) Object.defineProperty(result, key, { enumerable: false });
  return result;
};
function unlockEvaluation(reused) {
  let result;
  const value = { evaluationMs: 0, timingMs: {}, cancelled: false, resultCache: { unlockPredictionHit: true },
    get result() { return result ??= JSON.parse(value.playJSON.toString('utf8')); } };
  return Object.defineProperties(value, Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON', 'gzipJSONPrefixes', 'gzipJSONPrefixMetadata']
    .filter(key => key in reused).map(key => [key, Object.getOwnPropertyDescriptor(reused, key)])));
}
// Strip waiter metadata without spreading the lazy result getter. Compact cache
// entries retain only play bytes, so evicting full entries releases their buffer.
function cachedPlayValue(value) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  delete descriptors.hit;
  delete descriptors.coalesced; delete descriptors.calculatorStarted;
  delete descriptors.resultJSON; delete descriptors.result;
  const playJSON = value.playJSON;
  let result;
  return Object.defineProperties({ get result() { return result ??= JSON.parse(playJSON.toString('utf8')); } }, descriptors);
}
function workerEvaluation(message) {
  const metadata = { evaluationMs: message.evaluationMs, timingMs: message.timingMs };
  const observed = value => Object.defineProperty(value, 'eligibilitySeeded', { value: message.timingMs?.eligibilitySeeded === true });
  if (message.sandboxJSON instanceof SharedArrayBuffer) {
    const sandboxJSON = Buffer.from(message.sandboxJSON);
    let result;
    return observed({ sandboxJSON, resultCache: message.resultCache, ...metadata,
      get result() { return result ??= { ...JSON.parse(sandboxJSON.toString('utf8')), cache: message.resultCache }; } });
  }
  if (!(message.playJSON instanceof SharedArrayBuffer)) return observed({ result: message.result, ...metadata });
  const resultJSON = message.resultJSON instanceof SharedArrayBuffer ? Buffer.from(message.resultJSON) : undefined;
  const playJSON = Buffer.from(message.playJSON);
  let result;
  const duoJSON = message.duoJSON instanceof SharedArrayBuffer ? Buffer.from(message.duoJSON) : undefined;
  const duoSidebarJSON = message.duoSidebarJSON instanceof SharedArrayBuffer ? Buffer.from(message.duoSidebarJSON) : undefined;
  return observed({ ...(resultJSON ? { resultJSON } : {}), ...(duoJSON ? { duoJSON } : {}), ...(duoSidebarJSON ? { duoSidebarJSON } : {}), playJSON, cancelled: !!message.cancelled, ...metadata,
    get result() { return result ??= JSON.parse((resultJSON ?? playJSON).toString('utf8')); } });
}
function validStateInput(state, input, stateInput, type) {
  return ['evaluate', 'chunk-planning', 'sandbox', 'area-check', 'how-task', 'why-task', 'roll-pool'].includes(type) && stateInput.stateJSON instanceof SharedArrayBuffer
    && stateInput.stateJSON.byteLength > 0 && typeof stateInput.inputKey === 'string' && stateInput.inputKey === input
    && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.members)
    && state.members.length > 0 && state.members.every(member => member && typeof member.id === 'string' && member.id.length > 0)
    && new Set(state.members.map(member => member.id)).size === state.members.length;
}

/** Interactive work and advisory batches have independent bounded workers. */
export async function createTaskScheduler({ maxDeathQueue = 2, deathDeadlineMs = 120000, deathWorkerFactory,
  duoWorkerFactory, maxDuoQueue = 2, duoDeadlineMs = 30000, duoCacheLimit = 4, duoCacheBytes = 32 * 1024 * 1024,
  predictionWorkerFactory, maxPredictionQueue = 8, predictionDeadlineMs = 120000,
  predictionCacheLimit = 256, predictionCacheBytes = 32 * 1024 * 1024, maxPrewarmQueue = 256, signal, maxCalculators, residency, eligibilityProofSeeding = true, ...options } = {}) {
  positive(maxDeathQueue, 'maxDeathQueue'); positive(deathDeadlineMs, 'deathDeadlineMs');
  for (const [name, value] of Object.entries({ maxPredictionQueue, predictionDeadlineMs, predictionCacheLimit, predictionCacheBytes, maxPrewarmQueue })) positive(value, name);
  for (const [name, value] of Object.entries({ maxDuoQueue, duoDeadlineMs, duoCacheLimit, duoCacheBytes })) positive(value, name);
  if (options.fairness) {
    const { maxOutstandingJobsPerPicker = 4, maxWaitersPerJob = 64 } = options.fairness;
    positive(maxOutstandingJobsPerPicker, 'maxOutstandingJobsPerPicker'); positive(maxWaitersPerJob, 'maxWaitersPerJob');
    const outstanding = new Map();
    options.fairness = { maxOutstandingJobsPerPicker, maxWaitersPerJob, admit(pickerId, interactive = false) {
      if (maxCalculators !== undefined && interactive && (outstanding.get(pickerId) ?? 0) >= maxOutstandingJobsPerPicker) options.fairness.displaceWarm?.(pickerId);
      const count = outstanding.get(pickerId) ?? 0;
      if (count >= maxOutstandingJobsPerPicker) return;
      outstanding.set(pickerId, count + 1);
      let released = false;
      return () => {
        if (released) return; released = true;
        const remaining = outstanding.get(pickerId) - 1;
        if (remaining) outstanding.set(pickerId, remaining); else outstanding.delete(pickerId);
      };
    } };
  }
  const sessions = residency ? createSessionResidency(residency, options.idleClock) : undefined;
  options.sessions = sessions;
  if (sessions?.memoryBytes === 0) throw unavailable('Insufficient memory for a task calculator.');
  // Ordinary retirement keeps its own short default; the session grace only
  // applies while keep-warm is enabled (disabled or memory-suspended pools retire).
  if (sessions) options.idleMs ??= Number(process.env.RS3_WORKER_IDLE_MS ?? 600000);
  if (sessions) maxCalculators = Math.min(maxCalculators ?? sessions.maxResident, sessions.maxResident, Math.max(1, Math.floor(sessions.memoryBytes / sessions.estimatedBytes)));
  if (options.warmStoreDirectory) options.workerData = { ...options.workerData, warmStoreDirectory: options.warmStoreDirectory };
  options.workerPreparation = createWorkerPreparation(options.workerData, { persistentDirectory: options.warmStoreDirectory });
  if (maxCalculators !== undefined) {
    positive(maxCalculators, 'maxCalculators');
    // RSS accounting and emergency retirement need an owned process. Thread
    // RSS belongs to the server and cannot be bounded per physical calculator.
    const factory = options.workerFactory ?? (sessions ? data => new ProcessWorker(data) : nativeWorker);
    const native = !options.workerFactory;
    options.calculatorPool = createCalculatorPool({ limit: maxCalculators, workerFactory: factory,
      workerData: (includeCatalogue, group) => native
        ? nativeWorkerInput(group === 'foreground' || options.workerPreparation.persistent ? options.workerPreparation.input() : options.workerData, includeCatalogue) : options.workerData,
      sessions, clock: options.idleClock, memoryUsage: options.calculatorMemoryUsage,
      onWorker: options.onWorker,
      onReady: native ? message => options.workerPreparation.accept(message) : undefined,
      idleMs: options.idleMs ?? Number(process.env.RS3_WORKER_IDLE_MS ?? 600000), startupDeadlineMs: options.startupDeadlineMs });
  }
  let foreground;
  try { foreground = await createWorkerLane({ ...options, includeReadyCatalogue: true, maxPrewarmQueue, signal }); }
  catch (error) { await options.calculatorPool?.close(); await options.workerPreparation.clear(); throw error; }
  options.calculatorPool?.releaseCatalogue();
  const pickers = new Map();
  function pickerState(pickerId) {
    pickerId = pickerJobId(pickerId);
    if (!pickers.has(pickerId)) pickers.set(pickerId, { latestRevision: -1, taskRevision: -1, savedPredictionSourceRevision: -1, closed: false,
      unlockResults: createUnlockResultCache({ limit: predictionCacheLimit, byteLimit: Math.floor(predictionCacheBytes / 2) }) });
    return pickers.get(pickerId);
  }
  function clearUnlockResults() { for (const picker of pickers.values()) picker.unlockResults.clear(); }
  // Preserve the shared reuse budget even when several picker caches are live.
  function boundUnlockResults(keep) {
    const total = () => [...pickers.values()].reduce((sum, picker) => {
      const d = picker.unlockResults.getDiagnostics(); return { entries: sum.entries + d.entries, bytes: sum.bytes + d.bytes };
    }, { entries: 0, bytes: 0 });
    for (const picker of pickers.values()) {
      const d = total();
      if (d.entries <= predictionCacheLimit && d.bytes <= Math.floor(predictionCacheBytes / 2)) break;
      if (picker !== keep) picker.unlockResults.clear();
    }
  }
  let death, prediction, duo, closed = false, closePromise;
  if (options.calculatorPool) options.fairness && (options.fairness.displaceWarm = pickerId => {
    for (const lane of [foreground, death, prediction, duo]) lane?.yieldQueuedWarm(pickerId);
  });
  const listeners = new Set();
  const residencyListeners = new Set();
  const predictionListeners = new Set();
  const preparationListeners = new Set();
  const announceResidency = () => { for (const listener of residencyListeners) { try { listener(scheduler.getHealth()); } catch { /* Observers cannot interrupt retirement. */ } } };
  const announce = () => { announceResidency(); for (const listener of listeners) { try { listener(scheduler.getHealth()); } catch { /* Observers cannot interrupt recovery. */ } } };
  foreground.subscribe(announce);
  // Created only by an explicit group peer request. A slow peer never occupies
  // the selected member's foreground queue or the Preview/death lanes.
  function duoLane() {
    if (!duo) void createWorkerLane({ ...options,
      ...(duoWorkerFactory ? { workerFactory: duoWorkerFactory } : {}),
      includeReadyCatalogue: false,
      maxQueue: maxDuoQueue, deadlineMs: duoDeadlineMs, cacheLimit: duoCacheLimit, cacheByteLimit: duoCacheBytes, duoResults: true,
      onCreated(lane) { duo = lane; lane.subscribe(announce); },
    }).catch(() => { /* The lane reports bounded startup/recovery failure. */ });
    return duo;
  }
  function predictionLane() {
    if (!prediction) void createWorkerLane({ ...options,
      ...(predictionWorkerFactory ? { workerFactory: predictionWorkerFactory } : {}),
      includeReadyCatalogue: false,
      maxQueue: maxPredictionQueue, deadlineMs: predictionDeadlineMs, cacheLimit: predictionCacheLimit,
      cacheByteLimit: predictionCacheBytes - Math.floor(predictionCacheBytes / 2), maxPrewarmQueue, strictRevision: true, shareSnapshots: true,
      retainActivePrediction: true,
      ...(eligibilityProofSeeding ? { onEligibilitySeedRequest: (entry, proof) => foreground.exportEligibilityProof(entry, proof) } : {}),
      onEvaluation(message, entry) {
        const picker = pickerState(entry.pickerId);
        if (picker.closed) return;
        // Preview can arrive before its partner releases admission. Refill only
        // after that final reply too, without publishing the same delta twice.
        if (entry.warm && message.type !== 'prediction-prepared') for (const listener of preparationListeners) {
          try { listener({ pickerId: entry.pickerId, memberId: entry.memberId, chunkId: entry.chunkId, input: entry.input }); } catch { /* Optional warming cannot interrupt a reply. */ }
        }
        if (!closed && !entry.previewValue && entry.revision === picker.latestRevision && !entry.discarded && !message.result?.cancelled
          && Array.isArray(message.result?.delta?.tasksAdded)) {
          const state = { ...entry.predictionState, revision: entry.revision };
          for (const listener of predictionListeners) {
            try { listener({ pickerId: entry.pickerId, state, input: entry.input, memberId: entry.memberId, chunkId: entry.chunkId, result: message.result }); }
            catch { /* Summary observers cannot interrupt prediction admission. */ }
          }
        }
        const reuse = message.unlockReuse;
        if (!closed && reuse?.memberId === entry.memberId && reuse.sourceRevision === entry.revision
          && (entry.revision === picker.latestRevision || entry.reuseRevision === picker.latestRevision
            && (entry.reuseWaiters?.size || entry.confirmedTaskInputKey === reuse.taskInputKey))) {
          const peer = message.partnerUnlockReuse;
          const pair = peer && peer.memberId !== reuse.memberId && peer.taskInputKey === reuse.taskInputKey && peer.sourceRevision === reuse.sourceRevision;
          picker.unlockResults.admitMany(pair ? [reuse, peer] : [reuse], entry.purpose === 'ranking' ? 0 : entry.warm ? reuse.priority : 3, entry.originalKey);
          boundUnlockResults(picker);
        }
      },
      onSleep: clearUnlockResults,
      // Background readiness must not announce a new foreground-ready event.
      onCreated(lane) { prediction = lane; lane.subscribe(announceResidency); announceResidency(); },
    }).catch(() => {});
    return prediction;
  }
  const scheduler = {
    forPicker(id) {
      const pickerId = pickerJobId(id);
      pickerState(pickerId).closed = false;
      for (const lane of [foreground, death, prediction, duo]) lane?.openPicker(pickerId);
      let abandoned = false;
      const facade = Object.create(scheduler);
      for (const [name, count] of Object.entries(pickerArguments)) facade[name] = (...args) => {
        if (abandoned) {
          if (name === 'evaluate' || name === 'prepareRules') return Promise.reject(unavailable('The picker is closing.'));
          return name === 'prewarm' || name === 'prewarmTasks' ? { queued: 0 } : undefined;
        }
        args.length = count; return scheduler[name](...args, pickerId);
      };
      facade.subscribePrepared = listener => scheduler.subscribePrepared(event => { if (!abandoned && event.pickerId === pickerId) listener(event); });
      facade.subscribePredictions = listener => scheduler.subscribePredictions(event => { if (!abandoned && event.pickerId === pickerId) listener(event); });
      facade.canPrewarmTasks = (usePrediction = false) => !abandoned && scheduler.canPrewarmTasks(usePrediction, pickerId);
      facade.notePredictionUse = () => { if (!abandoned) scheduler.notePredictionUse(); };
      facade.resumePrewarm = () => { if (!abandoned) scheduler.resumePrewarm(); };
      facade.cancelPicker = () => { if (!abandoned) { abandoned = true; scheduler.cancelPicker(pickerId); } };
      return facade;
    },
    cancelPicker(id) {
      const pickerId = pickerJobId(id), picker = pickerState(pickerId);
      picker.closed = true; picker.unlockResults.clear(); sessions?.forget(pickerId);
      for (const lane of [foreground, death, prediction, duo]) lane?.cancelPicker(pickerId);
    },
    noteActivity(pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      if (closed || pickerState(pickerId).closed) return;
      sessions?.note(pickerId);
      for (const lane of [foreground, prediction, death, duo]) lane?.sessionChanged(pickerId);
      options.calculatorPool?.sessionChanged(pickerId);
    },
    openSession(pickerId = 'legacy-shared') {
      if (closed || pickerState(pickerId).closed || !sessions) return () => {};
      const release = sessions.open(pickerId);
      scheduler.noteActivity(pickerId);
      let released = false;
      return () => {
        if (released) return; released = true; release();
        for (const lane of [foreground, prediction, death, duo]) lane?.sessionChanged();
        options.calculatorPool?.sessionChanged();
      };
    },
    catalogue: foreground.catalogue, dynamicCatalogue: foreground.dynamicCatalogue,
    supports: type => foreground.supports(type),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeResidency(listener) { residencyListeners.add(listener); return () => residencyListeners.delete(listener); },
    subscribePrepared(listener) { preparationListeners.add(listener); return () => preparationListeners.delete(listener); },
    subscribePredictions(listener) { predictionListeners.add(listener); return () => predictionListeners.delete(listener); },
    peekPrediction(state, memberId, chunkId, input, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed || state.revision < picker.latestRevision) return;
      return prediction?.peekPrediction(predictionCacheKey({ ...state, revision: picker.taskRevision }, memberId, chunkId, input), pickerId);
    },
    // Only a newly opened ranking view counts as interactive use. Reading its
    // progress and completing background candidates leave the idle clock alone.
    notePredictionUse() { if (!closed) prediction?.noteInteractiveUse(); },
    cancelRankingPrewarm(keepMemberIds, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      prediction?.cancelRankingPrewarm(keepMemberIds, pickerId);
    },
    preparedEvaluation(taskInputKey, memberId, revision, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      // The server hashes its captured immutable task input before asking here.
      // A hit needs no serialized worker snapshot or resident foreground worker.
      if (closed || picker.closed || revision !== picker.latestRevision || !picker.unlockResults.getDiagnostics().entries) return;
      if (typeof taskInputKey === 'function') taskInputKey = taskInputKey();
      if (typeof taskInputKey !== 'string' || !/^[a-f0-9]{64}$/.test(taskInputKey) || typeof memberId !== 'string') return;
      const reused = picker.unlockResults.get(taskInputKey, memberId, revision);
      if (reused) {
        foreground.preemptResidentPlanning();
        prediction?.confirmSavedPrediction(taskInputKey, revision, pickerId);
      }
      return reused ? evaluationWith(unlockEvaluation(reused), { hit: true }) : undefined;
    },
    prepareRules(rules, revision, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed) return Promise.reject(unavailable('The task server is closing.'));
      if (!rules || typeof rules !== 'object' || Array.isArray(rules) || !Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new TypeError('Invalid task preparation input.'));
      const key = JSON.stringify(['prepare-rules', revision, rules]);
      return foreground.evaluate({ revision, rules }, undefined, 'prepare-rules', undefined, key, undefined, undefined, [], 'full', undefined, false, pickerId);
    },
    evaluate(state, memberId, type = 'evaluate', chunkId, key, input, signal, chunkIds = [], resultView = 'full', stateInput, evaluationLane = 'foreground', duoSidebarProjection = false, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed) return Promise.reject(unavailable('The task server is closing.'));
      if (signal?.aborted) return Promise.reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
      if (stateInput && !validStateInput(state, input, stateInput, type)) return Promise.reject(new TypeError('Invalid serialized task state input.'));
      if (!['foreground', 'duo', 'side'].includes(evaluationLane) || evaluationLane === 'duo' && (type !== 'evaluate' || resultView !== 'play-v1')
        || evaluationLane === 'side' && !(type === 'chunk-planning' || type === 'evaluate' && resultView === 'full')) return Promise.reject(new TypeError('Invalid task evaluation lane.'));
      if (typeof duoSidebarProjection !== 'boolean' || duoSidebarProjection && (type !== 'evaluate' || resultView !== 'play-v1' || evaluationLane !== 'foreground')) return Promise.reject(new TypeError('Invalid duo sidebar projection.'));
      if (evaluationLane === 'foreground' && !['predict', 'chunk-planning', 'sandbox', 'area-check', 'death-estimates'].includes(type)) foreground.preemptResidentPlanning();
      if (type !== 'roll-pool') scheduler.supersede(state.revision, input, memberId, pickerId);
      if (type === 'evaluate' && resultView === 'play-v1' && state.revision >= picker.latestRevision && picker.unlockResults.getDiagnostics().entries) {
        const taskInputKey = stateInput ? stateInput.taskInputKey : taskReuseInputKey(state);
        const reused = picker.unlockResults.get(taskInputKey, memberId, state.revision);
        if (reused) {
          prediction?.confirmSavedPrediction(taskInputKey, state.revision, pickerId);
          // Both projections were calculated from the complete hypothetical
          // fixed point. Matching saved task inputs makes these authoritative.
          const value = unlockEvaluation(reused);
          if (!value.gzipJSONPrefixes) foreground.admitPlayEvaluation(key, state.revision, value, pickerId);
          return Promise.resolve(evaluationWith(value, { hit: true }));
        }
      }
      // The old Preview is rejected at the save boundary. Only its complete
      // hypothetical task bytes may race a fresh saved calculation, and only
      // after the worker's fingerprint proves every task input is identical.
      const raceController = type === 'evaluate' && resultView === 'play-v1' ? new AbortController() : undefined;
      const requestSignal = raceController ? signal ? AbortSignal.any([signal, raceController.signal]) : raceController.signal : signal;
      const raceSavedPrediction = ordinary => {
        const following = raceController && prediction?.followSavedPrediction(memberId, state.revision, requestSignal, pickerId);
        if (!following) return ordinary;
        const projected = following.then(reuse => {
          const taskInputKey = stateInput ? stateInput.taskInputKey : taskReuseInputKey(state);
          if (closed || picker.closed || requestSignal.aborted || state.revision !== picker.latestRevision || reuse?.memberId !== memberId
            || reuse.sourceRevision !== picker.savedPredictionSourceRevision || reuse.taskInputKey !== taskInputKey
            || !['playJSON', 'duoJSON', 'duoSidebarJSON'].every(key => reuse[key] instanceof SharedArrayBuffer)) throw superseded();
          prediction?.confirmSavedPrediction(taskInputKey, state.revision, pickerId);
          picker.unlockResults.admit(reuse, 3);
          boundUnlockResults(picker);
          const retained = picker.unlockResults.get(taskInputKey, memberId, state.revision);
          const value = unlockEvaluation(retained ?? Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON'].map(key => [key, Buffer.from(reuse[key])])));
          if (!value.gzipJSONPrefixes) foreground.admitPlayEvaluation(key, state.revision, value, pickerId);
          return evaluationWith(value, { hit: true });
        });
        return Promise.any([ordinary, projected]).catch(error => { throw error.errors?.[0] ?? error; })
          .finally(() => { raceController.abort(); prediction?.releaseSavedPrediction(state.revision, pickerId); });
      };
      if (evaluationLane === 'duo') {
        if (state.revision < picker.latestRevision) return Promise.reject(superseded());
        // Keep peer computation compact. A later map switch can reuse its bytes
        // through the normal foreground cache; full details still hydrate normally.
        const cached = foreground.cachedEvaluation(key, resultView, pickerId);
        if (cached) return Promise.resolve(cached);
        return raceSavedPrediction(duoLane().evaluate(state, memberId, type, chunkId, key, input, requestSignal, chunkIds, resultView, stateInput, false, pickerId).then(value => {
          if (!closed && !picker.closed && !signal?.aborted && state.revision === picker.latestRevision && !value.cancelled) {
            foreground.admitPlayEvaluation(key, state.revision, value, pickerId);
          }
          return value;
        }));
      }
      if (type === 'predict') {
        if (state.revision < picker.latestRevision) return Promise.reject(superseded());
        const predictionKey = predictionCacheKey({ ...state, revision: picker.taskRevision }, memberId, chunkId, input);
        const owner = state.members?.find(member => member.id === memberId);
        if (/^\d+$/.test(String(chunkId)) && Array.isArray(owner?.unlocked) && !owner.unlocked.includes(String(chunkId))
          && !picker.unlockResults.hasCompletePrediction(predictionKey, state.members.map(member => member.id))) {
          // A delta may outlive its bounded prepared pair. Explicit interest
          // must also prepare missing task bytes while its delta is displayed.
          prediction?.invalidatePrediction(predictionKey, pickerId);
        }
        picker.unlockResults.touchPrediction(predictionKey);
        prediction?.cancelPrewarm({ keepActiveKey: predictionKey }, pickerId);
        return predictionLane().evaluate(state, memberId, type, chunkId, predictionKey, input, signal, [], 'full', undefined, false, pickerId);
      }
      if (evaluationLane === 'side' || type === 'chunk-planning') {
        if (state.revision < picker.latestRevision) return Promise.reject(superseded());
        const fallback = () => {
          if (closed || picker.closed) return Promise.reject(unavailable('The task server is closing.'));
          if (signal?.aborted) return Promise.reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
          if (state.revision < picker.latestRevision) return Promise.reject(superseded());
          return predictionLane().evaluate(state, memberId, type, chunkId, key, input, signal, chunkIds, resultView, stateInput, false, pickerId);
        };
        const resident = type === 'chunk-planning' && foreground.tryResidentPlanning(state, memberId, chunkId, key, input, signal, chunkIds, resultView, stateInput, pickerId);
        return resident ? resident.catch(error => { if (error.code === 'RESIDENT_PLANNING_UNAVAILABLE') return fallback(); throw error; }) : fallback();
      }
      if (type === 'sandbox' || type === 'area-check') {
        if (state.revision < picker.latestRevision) return Promise.reject(superseded());
        // Drafts use their normalized changes in the key, with the same bounded
        // advisory lane as Preview so foreground saved tasks remain independent.
        return predictionLane().evaluate(state, memberId, type, chunkId, key, input, signal, [], resultView, stateInput, false, pickerId);
      }
      if (type === 'why-task') {
        const read = lane => lane
          ? lane.readSnapshot(state, memberId, chunkId, key, input, signal, stateInput, pickerId)
          : Promise.resolve({ result: { unavailable: true } });
        return read(foreground).then(value => {
          // Group peers may have been evaluated on the existing duo lane.
          // Read it only if already present; never allocate a lane for Why.
          return value.result?.unavailable ? read(duo) : value;
        });
      }
      if (type !== 'death-estimates') return raceSavedPrediction(foreground.evaluate(state, memberId, type, chunkId, key, input, requestSignal, chunkIds, resultView, stateInput, duoSidebarProjection, pickerId));
      if (state.revision < picker.latestRevision) return Promise.reject(Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 }));
      if (!death) {
        // Expose the lane before it is ready: startup admissions use its bounded
        // queue and request watchdog, rather than accumulating promise waiters.
        void createWorkerLane({ ...options, ...(deathWorkerFactory ? { workerFactory: deathWorkerFactory } : {}),
          includeReadyCatalogue: false,
          maxQueue: maxDeathQueue, deadlineMs: deathDeadlineMs,
          onCreated(lane) { death = lane; lane.subscribe(announce); },
        }).catch(() => { /* The lane rejects its requests and reports its failure. */ });
      }
      return death.evaluate(state, memberId, type, undefined, JSON.stringify([key, chunkIds]), input, signal, chunkIds, 'full', undefined, false, pickerId);
    },
    supersede(revision, input, memberId, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed) return;
      if (revision > picker.latestRevision) {
        picker.savedPredictionSourceRevision = picker.latestRevision;
        // Display revisions share the same prediction origin. Expire only at
        // an actual task change, preserving the preceding hypothetical pair.
        picker.unlockResults.supersede(picker.taskRevision + 1);
        picker.taskRevision = revision;
      }
      picker.latestRevision = Math.max(picker.latestRevision, revision);
      foreground.supersede(revision, input, memberId, pickerId); death?.supersede(revision, input, memberId, pickerId);
      prediction?.supersede(revision, input, undefined, pickerId);
      duo?.supersede(revision, input, undefined, pickerId);
    },
    // Claims and display saves advance HTTP guards without disturbing prediction
    // queues or sending control work to a calculator with identical task inputs.
    supersedeDisplay(revision, input, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed) return;
      picker.latestRevision = Math.max(picker.latestRevision, revision);
      foreground.supersedeDisplay(revision, pickerId); death?.supersedeDisplay(revision, pickerId);
      prediction?.supersedeDisplay(revision, pickerId); duo?.supersedeDisplay(revision, pickerId);
    },
    setRevision(revision, input, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      positive(revision, 'revision', 0);
      const changed = revision > picker.latestRevision;
      scheduler.supersede(revision, input, undefined, pickerId);
      if (changed) {
        prediction?.retireObsolete(revision, pickerId);
        death?.retireObsolete(revision, pickerId);
      }
      return changed;
    },
    prewarm(state, input, groups, { signal } = {}, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed || signal?.aborted || state.revision < picker.latestRevision
        || options.calculatorPool?.canPrewarm(pickerId) === false) return { queued: 0 };
      scheduler.supersede(state.revision, input, undefined, pickerId);
      // Ranking deltas may displace a reviewed choice's response from the LRU.
      // Its complete prepared bytes still satisfy automatic preparation, so a
      // refill must not repeat that calculation merely to restore the delta.
      const memberIds = state.members?.map(member => member.id) ?? [];
      if (memberIds.length && picker.unlockResults.getDiagnostics().entries) {
        groups = groups.map(group => group.purpose === 'ranking' ? group : { ...group,
          chunkIds: group.chunkIds.filter(chunkId => !picker.unlockResults.hasCompletePrediction(
            predictionCacheKey({ ...state, revision: picker.taskRevision }, group.memberId, chunkId, input), memberIds)) });
      }
      if (!prediction && !groups.some(group => group.chunkIds.length)) return { queued: 0 };
      return predictionLane().prewarm(state, input, groups, signal, picker.taskRevision, pickerId);
    },
    // Current task results and arbitrary Preview baselines use the same bounded
    // low-priority admission as candidate warming, without interactive waiters.
    canPrewarmTasks(usePrediction = false, pickerId = 'legacy-shared') { return !closed && foreground.canPrewarm()
      && options.calculatorPool?.canPrewarm(pickerId) !== false && (!usePrediction || !prediction || prediction.canPrewarm()); },
    prewarmTasks(state, input, memberIds, { resultView = 'full', stateInput, prediction: usePrediction = false } = {}, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      const picker = pickerState(pickerId);
      if (closed || picker.closed || state.revision < picker.latestRevision
        || options.calculatorPool?.canPrewarm(pickerId) === false) return { queued: 0 };
      if (!['full', 'play-v1'].includes(resultView)) throw new TypeError('Unknown task result view.');
      if (!Array.isArray(memberIds) || memberIds.some(id => !state.members?.some(member => member.id === id))) throw new TypeError('Choose known players to prepare tasks.');
      if (stateInput && !validStateInput(state, input, stateInput, 'evaluate')) throw new TypeError('Invalid serialized task state input.');
      if (!memberIds.length || usePrediction && !prediction && !foreground.canPrewarm()) return { queued: 0 };
      scheduler.supersede(state.revision, input, undefined, pickerId);
      return (usePrediction ? predictionLane() : foreground).prewarmTasks(state, input, memberIds, resultView, stateInput, pickerId);
    },
    cancelPrewarm(options, pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      if (!options?.keepTasks) foreground.cancelPrewarm({}, pickerId);
      prediction?.cancelPrewarm(options, pickerId);
    },
    retireWarmPrediction(pickerId = 'legacy-shared') {
      pickerId = pickerJobId(pickerId);
      return prediction?.retireWarm(pickerId) ?? false;
    },
    resumePrewarm() { prediction?.noteInteractiveUse(); },
    getClientHealth(pickerId = 'legacy-shared') { return foreground.getClientHealth(pickerJobId(pickerId)); },
    getHealth() {
      const health = foreground.getHealth(), lanes = { death: death?.getHealth() ?? { status: 'idle', ready: false },
        prediction: prediction?.getHealth() ?? { status: 'idle', ready: false }, duo: duo?.getHealth() ?? { status: 'idle', ready: false } };
      const all = [health, ...Object.values(lanes)];
      return { ...health, ...lanes, stuck: all.some(lane => lane.stuck), restartRequired: all.some(lane => lane.restartRequired),
        recovering: all.some(lane => ['starting', 'waking', 'restarting'].includes(lane.status)) };
    },
    async restartUnhealthy() {
      if (closed) throw unavailable('The task server is closing.');
      const restarted = [];
      // Inspect only existing lanes. Sleeping and never-created lanes stay asleep.
      for (const [name, lane] of [['foreground', foreground], ['death', death], ['prediction', prediction], ['duo', duo]]) {
        if (lane && await lane.restartUnhealthy()) restarted.push(name);
      }
      if (restarted.length) clearUnlockResults();
      return { restarted, worker: scheduler.getHealth() };
    },
    getDiagnostics: pickerId => ({ ...foreground.getDiagnostics(), ...(options.calculatorPool ? { calculators: options.calculatorPool.diagnostics(pickerId) } : {}), unlockReuse: pickerState(pickerId ?? 'legacy-shared').unlockResults.getDiagnostics(), deathLane: death?.getDiagnostics() ?? {
      worker: { status: 'idle', ready: false }, queue: { depth: 0, active: 0, limit: maxDeathQueue, deadlineMs: deathDeadlineMs },
    }, duoLane: duo?.getDiagnostics() ?? {
      worker: { status: 'idle', ready: false }, queue: { depth: 0, active: 0, limit: maxDuoQueue, deadlineMs: duoDeadlineMs },
      cache: { entries: 0, bytes: 0, limit: duoCacheLimit, byteLimit: duoCacheBytes },
    }, predictionLane: prediction?.getDiagnostics() ?? {
      worker: { status: 'idle', ready: false }, queue: { depth: 0, active: 0, limit: maxPredictionQueue, deadlineMs: predictionDeadlineMs },
      cache: { entries: 0, bytes: 0, limit: predictionCacheLimit, byteLimit: predictionCacheBytes },
      prewarm: { pending: 0, active: 0, limit: maxPrewarmQueue, queued: 0, completed: 0, cancelled: 0, skipped: 0 },
      ranking: { pending: 0, active: 0 },
    } }),
    close(timeoutMs = 10000) {
      if (!closePromise) {
        closed = true; sessions?.clear(); listeners.clear(); residencyListeners.clear(); predictionListeners.clear(); preparationListeners.clear(); clearUnlockResults();
        closePromise = Promise.all([foreground.close(timeoutMs), death?.close(timeoutMs), prediction?.close(timeoutMs), duo?.close(timeoutMs),
          options.calculatorPool?.close(timeoutMs)]).finally(() => options.workerPreparation.clear());
      }
      return closePromise;
    },
  };
  return scheduler;
}

/** One worker, bounded snapshots, and a bounded lifetime restart budget. */
async function createWorkerLane({ workerData, workerPreparation, workerFactory = nativeWorker, includeReadyCatalogue = true, onCreated, onEvaluation, onSleep, onEligibilitySeedRequest,
  maxQueue = 8, deadlineMs = 30000, firstCalculationDeadlineMs = Math.max(120000, deadlineMs), startupDeadlineMs = 30000, maxRestarts = 3, backoffMs = 250, maxBackoffMs = 5000, cacheLimit = 8,
  cacheByteLimit = 128 * 1024 * 1024, maxPrewarmQueue = 256, strictRevision = false, shareSnapshots = false, duoResults = false,
  idleMs = Number(process.env.RS3_WORKER_IDLE_MS ?? 600000), idleClock = { now: () => performance.now(), setTimeout, clearTimeout }, retainActivePrediction = false,
  stuckMs = 120000, signal, fairness, calculatorPool, sessions, timings: liveTimings, onWorker, deadlineClock = { setTimeout, clearTimeout },
} = {}) {
  for (const [name, value] of Object.entries({ maxQueue, deadlineMs, firstCalculationDeadlineMs, startupDeadlineMs, backoffMs, maxBackoffMs, cacheLimit })) positive(value, name);
  positive(maxRestarts, 'maxRestarts', 0);
  positive(idleMs, 'idleMs');
  positive(stuckMs, 'stuckMs');
  let worker, generation = 0, sequence = 0, active, closed = false, restartTimer, startupTimer, initialResolve, initialReject, closePromise, idleTimer;
  const profileLane = PROFILE_ENABLED ? profile.lane() : undefined;
  const latestRevisions = new Map(), prewarmSubscriptions = new Map(), closedPickers = new Set();
  const revisionFor = pickerId => latestRevisions.get(pickerId) ?? -1;
  let firstCalculation = true;
  let receivedCatalogue = false, recovering = false;
  let supported = new Set();
  let status = 'starting', restarts = 0, failures = 0, nextRetryAt = null, compileMs = 0, lastFailure = null;
  let sentSnapshots = new Map();
  const queue = [], warmQueue = [], pending = new Map(), cache = new Map(), terminating = new Set(), listeners = new Set();
  function forgetPickerSnapshots(pickerId) {
    calculatorPool?.forgetPicker(pickerId);
    // The worker still has these LRU slots. Keep their positions until normal
    // eviction, but force a body if this picker is used again. Deleting slots
    // here could leave another picker's evicted state looking referenceable.
    for (const key of sentSnapshots.keys()) if (JSON.parse(key)[0] === pickerId) sentSnapshots.set(key, {});
  }
  const turns = [];
  function fairTake() {
    const candidates = calculatorPool && queue.length ? queue : [...queue, ...warmQueue];
    const waiting = new Set(candidates.map(entry => entry.pickerId));
    for (let index = turns.length - 1; index >= 0; index--) if (!waiting.has(turns[index])) turns.splice(index, 1);
    for (const id of waiting) if (!turns.includes(id)) turns.push(id);
    const id = turns.shift();
    if (id === undefined) return;
    const selected = queue.some(entry => entry.pickerId === id) ? queue : warmQueue;
    const entry = selected.splice(selected.findIndex(entry => entry.pickerId === id), 1)[0];
    if ([...queue, ...warmQueue].some(entry => entry.pickerId === id)) turns.push(id);
    return entry;
  }
  function admitFair(pickerId, { interactive = false } = {}) {
    if (!fairness) return () => {};
    // Leave room for another picker even in the small advisory queues.
    const limit = Math.min(fairness.maxOutstandingJobsPerPicker, Math.max(1, Math.floor(maxQueue / 2)));
    const count = () => [...pending.values()].filter(entry => entry.pickerId === pickerId).length;
    // Automatic warming never refuses the same picker's own request: queued,
    // unrequested warm jobs yield, newest first.
    for (let i = warmQueue.length - 1; interactive && i >= 0 && count() >= limit; i--) {
      const entry = warmQueue[i];
      if (entry.pickerId === pickerId && entry.warm && !entry.waiters.size) { warmCounts.cancelled++; cancel(entry, superseded()); }
    }
    if (count() >= limit) return;
    return fairness.admit(pickerId, interactive);
  }
  const warmCounts = { queued: 0, completed: 0, cancelled: 0, skipped: 0 };
  const counts = { requested: 0, coalesced: 0, cacheHits: 0, completed: 0, errors: 0, expired: 0, cancelled: 0, superseded: 0, rejected: 0, promoted: 0, retired: 0 };
  const timings = {};
  let lastTimingMs = {};
  const residentPickers = new Set();
  const sessionRemaining = () => calculatorPool?.keepWarm() === false ? 0
    : [...residentPickers].reduce((maximum, id) => Math.max(maximum, sessions?.remaining(id) ?? 0), 0);
  let sleepTimer, lastRequestAt = idleClock.now(), idleStops = 0;
  let lastProgressAt = idleClock.now(), manualRestart;
  let initialAborted = false, cancelledGrace;
  function clearCancelledGrace(entry) {
    if (cancelledGrace && (!entry || cancelledGrace.entry === entry)) {
      deadlineClock.clearTimeout(cancelledGrace.timer); cancelledGrace = undefined;
    }
  }
  function armCancelledGrace(entry) {
    if (closed || active !== entry || cancelledGrace) return;
    const timer = deadlineClock.setTimeout(() => {
      if (cancelledGrace?.entry !== entry) return;
      cancelledGrace = undefined;
      if (!closed && active === entry && entry.discarded && !entry.waiters.size && !entry.reuseWaiters?.size) retire();
    }, 25);
    timer?.unref?.(); cancelledGrace = { entry, timer };
  }
  function abortInitial() {
    initialAborted = true;
    initialReject(Object.assign(new Error('Task worker initialization cancelled.'), { name: 'AbortError', status: 503 }));
    void scheduler.close();
  }
  function touch() {
    lastRequestAt = idleClock.now();
    armSleep();
  }
  function armSleep() {
    idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
    if (closed || !['ready', 'starting'].includes(status)) return;
    // Native timers cap their delay at signed 32-bit milliseconds. Long custom
    // intervals use several bounded timers instead of overflowing to 1 ms.
    sleepTimer = idleClock.setTimeout(sleep, Math.min(2147483647, Math.max(0, idleMs - (idleClock.now() - lastRequestAt), sessionRemaining())));
    sleepTimer?.unref?.();
  }
  function sleep() {
    idleClock.clearTimeout(sleepTimer);
    sleepTimer = undefined;
    if (closed || status !== 'ready') return;
    if (idleClock.now() - lastRequestAt < idleMs || sessionRemaining() > 0) { armSleep(); return; }
    // Idle warming and abandoned work are expendable. Real requests keep their
    // worker until every waiter has received a complete response.
    if (active?.waiters.size || served(active) || active?.reuseWaiters?.size || queue.length) return;
    clearCancelledGrace();
    scheduler.cancelPrewarm();
    if (active) { deadlineClock.clearTimeout(active.timer); active = undefined; }
    clearImmediate(idleTimer); idleTimer = undefined;
    const old = worker; worker = undefined; generation++;
    firstCalculation = true;
    status = 'sleeping'; idleStops++; sentSnapshots.clear(); cache.clear();
    onSleep?.(); terminate(old); announce();
  }
  let wakeStarted;
  function wake() {
    if (closed || status !== 'sleeping') return;
    wakeStarted = idleClock.now();
    status = 'waking'; announce();
    // Termination completes before a replacement allocates its catalogue.
    // Requests admitted during this await share the bounded startup queue.
    void Promise.allSettled([...terminating]).then(() => { if (!closed && status === 'waking') launch(); });
  }
  const initial = new Promise((resolve, reject) => { initialResolve = resolve; initialReject = reject; });
  function announce() { for (const listener of listeners) { try { listener(scheduler.getHealth()); } catch { /* Observers cannot interrupt recovery. */ } } }
  function recordTimings(values) {
    lastTimingMs = {};
    for (const [stage, value] of Object.entries(values ?? {})) {
      if (!/^[a-zA-Z]+Ms$/.test(stage) || !Number.isFinite(value) || value < 0) continue;
      lastTimingMs[stage] = value;
      const aggregate = timings[stage] ??= { count: 0, totalMs: 0, maxMs: 0 };
      aggregate.count++; aggregate.totalMs += value; aggregate.maxMs = Math.max(aggregate.maxMs, value);
    }
  }
  function storeEvaluation(key, revision, type, value, pickerId) {
    if (type === 'how-task') return false; // Proofs have a separate small worker cache.
    if (type === 'why-task' && value.result?.unavailable) return false;
    const bytes = value.sandboxJSON ? value.sandboxJSON.length
      + Buffer.byteLength(JSON.stringify({ evaluationMs: value.evaluationMs, timingMs: value.timingMs, resultCache: value.resultCache }))
      : value.playJSON ? (value.resultJSON?.length ?? 0) + (value.duoJSON?.length ?? 0) + (value.duoSidebarJSON?.length ?? 0) + value.playJSON.length
      + Object.values(value.gzipJSONPrefixes ?? {}).reduce((sum, buffer) => sum + buffer.length, 0)
      + Buffer.byteLength(JSON.stringify({ evaluationMs: value.evaluationMs, timingMs: value.timingMs, cancelled: value.cancelled }))
      : Buffer.byteLength(JSON.stringify(value));
    if ((value.playJSON || value.sandboxJSON ? value.cancelled : value.result?.cancelled) || bytes > cacheByteLimit) return false;
    cache.delete(key); cache.set(key, { value, bytes, revision, type, pickerId });
    while (cache.size > cacheLimit || [...cache.values()].reduce((sum, item) => sum + item.bytes, 0) > cacheByteLimit) cache.delete(cache.keys().next().value);
    return cache.has(key);
  }
  function terminate(target) {
    if (!target) return;
    target.unref?.();
    const operation = Promise.resolve().then(() => target.terminate()).then(() => drainSource(target), () => {}).finally(() => { terminating.delete(operation); announce(); });
    terminating.add(operation);
  }
  // Metadata only. A rejected waiter does not prove its native export drained.
  const sourceDrains = new Map();
  function drainSource(target, id) {
    const drains = sourceDrains.get(target);
    if (!drains) return;
    for (const [key, resolve] of drains) if (id === undefined || key === id) { drains.delete(key); resolve(); }
    if (!drains.size) sourceDrains.delete(target);
  }
  // A producer that already answered Preview still prepares its partner. It is
  // requested work until it finishes or is cancelled (discarded), never idle warm-up.
  function served(entry) { return !!entry?.previewServed && !entry.discarded; }
  function settle(entry, error, value) {
    entry.releaseFair?.();
    if (active !== entry) deadlineClock.clearTimeout(entry.timer);
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    const position = queue.indexOf(entry);
    if (position >= 0) queue.splice(position, 1);
    const warmPosition = warmQueue.indexOf(entry);
    if (warmPosition >= 0) warmQueue.splice(warmPosition, 1);
    if (entry.warm && !error) warmCounts.completed++;
    entry.state = undefined;
    entry.predictionState = undefined;
    entry.previewValue = undefined;
    entry.stateInput = undefined;
    for (const waiter of entry.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      if (error) waiter.reject(error); else waiter.resolve(evaluationWith(value, { hit: waiter.hit, coalesced: waiter.hit, calculatorStarted: entry.calculatorStarted }));
    }
    entry.waiters.clear();
    entry.discarded = !!error;
    if (error) settleReuse(entry, error);
  }
  function settleReuse(entry, error, value, partial = false) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const waiter of entry.reuseWaiters ?? []) {
      const reuse = values.find(result => result?.memberId === waiter.memberId);
      if (!error && !reuse && partial) continue;
      waiter.signal?.removeEventListener('abort', waiter.abort);
      if (error || !reuse) waiter.reject(error ?? superseded()); else waiter.resolve(reuse);
      entry.reuseWaiters.delete(waiter);
    }
  }
  function cancel(entry, error, retiring = false) {
    if (active === entry && worker && !entry.reuseRevision) {
      if (entry.cancellation) Atomics.store(new Int32Array(entry.cancellation), 0, 1);
      try { worker.postMessage({ id: entry.id, type: 'cancel', pickerId: entry.pickerId }); } catch { failure('worker-send'); }
    }
    settle(entry, error);
    // Every resident cancellation is bounded, including disconnects, saves and
    // another picker's request, with or without a physical calculator pool.
    if (entry.residentOnly && !retiring) armCancelledGrace(entry);
  }
  function retire(error = superseded()) {
    clearCancelledGrace();
    if (active) {
      deadlineClock.clearTimeout(active.timer); active.reuseRevision = undefined;
      cancel(active, error, true); active = undefined;
    }
    clearTimeout(startupTimer); clearTimeout(restartTimer); restartTimer = undefined;
    idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
    clearImmediate(idleTimer); idleTimer = undefined;
    const old = worker; worker = undefined; generation++;
    firstCalculation = true;
    status = 'sleeping'; counts.retired++; sentSnapshots.clear();
    // Idle sleep clears caches; retirement deliberately does not call onSleep.
    // wake() already waits for termination before allocating a replacement.
    terminate(old); announce();
    // Retirement belongs to the obsolete active job. Already admitted work
    // (including other pickers) must wake on the replacement, with its original
    // queue position and deadline.
    if (queue.length || warmQueue.length) wake();
    return true;
  }
  function failure(kind) {
    if (closed || status === 'restarting' || status === 'restart-required') return;
    recovering = true;
    clearCancelledGrace();
    firstCalculation = true;
    const profiling = kind === 'profile-retired';
    if (!profiling) failures++;
    if (!profiling) lastFailure = { kind, at: new Date().toISOString() };
    clearTimeout(startupTimer);
    idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
    const old = worker; worker = undefined; generation++; terminate(old);
    if (active) { deadlineClock.clearTimeout(active.timer); counts.errors++; settle(active, unavailable(kind === 'worker-memory'
      ? 'Task calculation exceeded its memory limit. It is recovering; retry shortly. Saves remain available.'
      : 'Task engine interrupted. It is recovering; retry shortly.')); active = undefined; }
    if (!profiling && restarts >= maxRestarts) {
      status = 'restart-required'; nextRetryAt = null;
      const error = unavailable('Task engine needs a server restart. Saves remain available.');
      for (const entry of [...queue, ...warmQueue]) settle(entry, error);
      initialReject(error);
      announce();
      return;
    }
    status = 'restarting';
    const delay = Math.min(maxBackoffMs, backoffMs * 2 ** restarts);
    if (!profiling) restarts++;
    nextRetryAt = new Date(Date.now() + delay).toISOString();
    announce();
    restartTimer = setTimeout(launch, delay);
  }
  function canReadResident(type, pickerId) {
    return !closed && !closedPickers.has(pickerId) && status === 'ready' && worker && !worker.profileRetiring
      && !active && !queue.length && !warmQueue.length && supported.has(type);
  }
  function pump() {
    if (closed || status !== 'ready') return;
    if (!active && worker.profileRetiring) { retire(); return; }
    if (active) {
      if (calculatorPool && queue.length) scheduler.yieldForInteractive();
      return;
    }
    if (calculatorPool) {
      const candidates = queue.length ? queue : warmQueue;
      const id = turns.find(id => candidates.some(entry => entry.pickerId === id));
      const next = candidates.find(entry => entry.pickerId === id) ?? candidates[0];
      if (next?.type === 'why-task') {
        if (!worker.tryReadSnapshot(next.pickerId, () => {
          sentSnapshots = worker.snapshotHints;
          dispatch(fairness ? fairTake() : queue.shift());
        })) {
          settle(next, undefined, { result: { unavailable: true } });
          pump();
        }
        return;
      }
      worker.schedule(() => {
        if (closed || status !== 'ready' || active) return;
        // Expired optional work must not hide another picker's warm queue.
        for (const entry of [...warmQueue]) if (!calculatorPool.canPrewarm(entry.pickerId)
          && !entry.waiters.size && !served(entry) && !entry.reuseWaiters?.size) {
          entry.warm = false; warmCounts.cancelled++;
          cancel(entry, unavailable('Background prediction cancelled.'));
        }
        const candidates = queue.length ? queue : warmQueue;
        const id = turns.find(id => candidates.some(entry => entry.pickerId === id));
        const entry = candidates.find(entry => entry.pickerId === id) ?? candidates[0];
        return entry && { pickerId: entry.pickerId, interactive: !!queue.length };
      }, () => {
        // Hints belong to this physical calculator, shared across its lanes.
        // They contain only bounded metadata, never another retained state body.
        sentSnapshots = worker.snapshotHints;
        dispatch(fairness ? fairTake() : queue.shift() ?? warmQueue.shift());
      }, () => scheduler.yieldForInteractive(), () => scheduler.isBackground(), () => scheduler.stopForMemory(), () => scheduler.yieldWhileStarting());
      return;
    }
    if (fairness && (queue.length || warmQueue.length)) { dispatch(fairTake()); return; }
    if (!queue.length && idleClock.now() - lastRequestAt >= idleMs && !sessionRemaining()) { sleep(); return; }
    if (!queue.length) {
      if (!warmQueue.length || idleTimer) return;
      idleTimer = setImmediate(() => { idleTimer = undefined; dispatch(queue.shift() ?? warmQueue.shift()); });
      return;
    }
    const entry = queue.shift();
    dispatch(entry);
  }
  function deadline(entry, allowance = !active && firstCalculation && queue.length <= 1 && entry.type !== 'prepare-rules' && !entry.residentOnly
    ? Math.max(deadlineMs, firstCalculationDeadlineMs) : deadlineMs) {
    entry.deadlineStartedAt ??= idleClock.now();
    deadlineClock.clearTimeout(entry.timer);
    entry.timer = deadlineClock.setTimeout(() => {
      counts.expired++; settle(entry, Object.assign(new Error('Task calculation deadline exceeded. Retry shortly.'), { status: 504 }));
      if (active === entry) failure('calculation-deadline'); else pump();
    }, Math.max(0, allowance - (idleClock.now() - entry.deadlineStartedAt)));
  }
  function dispatch(entry) {
    if (closed || status !== 'ready' || active) { if (entry) (entry.warm ? warmQueue : queue).unshift(entry); return; }
    if (!entry) return;
    residentPickers.add(entry.pickerId);
    if (wakeStarted !== undefined) { liveTimings?.record('calculator-wake', idleClock.now() - wakeStarted, { source: 'computed', calculatorStarted: !calculatorPool || !!worker.startedCalculator }); wakeStarted = undefined; }
    entry.calculatorStarted ||= !!worker.startedCalculator;
    active = entry; entry.startedAt = idleClock.now(); entry.id = ++sequence;
    if (entry.sourceDrain) {
      entry.sourceDrain.dispatched = true;
      if (!sourceDrains.has(worker)) sourceDrains.set(worker, new Map());
      sourceDrains.get(worker).set(entry.id, entry.sourceDrain.resolve);
    }
    if (PROFILE_ENABLED) profile.dispatch(entry);
    entry.cancellation = new SharedArrayBuffer(4);
    entry.sourceRevision = entry.state.revision;
    if (entry.type === 'predict') {
      const { rules, taskRules, members, legacy } = entry.state;
      entry.predictionState = { rules, taskRules, members: members?.map(({ id, taskRules, sourceMapId }) => ({ id, taskRules, sourceMapId })),
        legacy: { maps: Object.fromEntries((members ?? []).filter(member => member.sourceMapId !== undefined)
          .map(member => [member.sourceMapId, { rules: legacy?.maps?.[member.sourceMapId]?.rules }])) } };
    }
    if (firstCalculation && entry.type !== 'prepare-rules' && !entry.residentOnly) {
      firstCalculation = false;
      deadline(entry, Math.max(deadlineMs, firstCalculationDeadlineMs));
    } else if (!entry.timer) deadline(entry);
    // Coalesced display revisions can update entry.revision while the captured
    // bytes retain their original revision, so the key names that revision.
    // Both LRUs key only its task input: after a display-only save the worker
    // rebinds its equivalent state instead of receiving it again. Predictions
    // read roll bookkeeping for reuse priority, and without a fingerprint only
    // the revision proves equivalence.
    const snapshotInput = entry.type === 'prepare-rules' || entry.type === 'eligibility-proof-export' ? undefined : entry.stateInput ? entry.stateInput.inputKey
      : !shareSnapshots ? undefined : entry.input === undefined ? JSON.stringify([entry.state.revision, predictionInput(entry.state)])
      : predictionInput(entry.state, [entry.input, entry.state.members?.map(member => [member.selected, member.pendingRoll])]);
    const snapshotKey = snapshotInput === undefined ? undefined : JSON.stringify([entry.state.revision, snapshotInput]);
    // Area checks read member preferences, which task inputs exclude, so they
    // reference only a state parsed from their own captured revision.
    const sentKey = pickerKey(entry.pickerId, snapshotInput);
    const sent = sentSnapshots.get(sentKey);
    const sentKind = entry.type === 'area-check' && sent?.revision !== entry.state.revision ? undefined : sent?.kind;
    const fresh = entry.stateInput ? sentKind !== 'json-shared-v1' : !sentKind;
    const state = entry.stateInput || !fresh ? undefined : entry.state;
    const serialized = entry.stateInput ? { stateTransport: 'json-shared-v1', stateRevision: entry.state.revision,
      stateMemberIds: entry.state.members.map(member => member.id), stateJSONBytes: entry.stateInput.stateJSON.byteLength,
      ...(fresh ? { stateJSON: entry.stateInput.stateJSON } : {}) } : {};
    entry.snapshotKey = snapshotKey;
    try { const workerMessage = { id: entry.id, pickerId: entry.pickerId, type: entry.type, reportProgress: true, state, snapshotKey, input: entry.input, memberId: entry.memberId, chunkId: entry.chunkId, chunkIds: entry.chunkIds, cancellation: entry.cancellation,
      ...(entry.residentOnly ? { residentOnly: true } : {}),
      ...(entry.type === 'predict' ? { predictionProgress: true, previewProgress: true, seedEligibility: !!onEligibilitySeedRequest } : {}),
      ...(entry.type === 'roll-pool' && entry.chunkId !== undefined ? { draft: entry.chunkId } : {}), ...serialized,
      ...(entry.type === 'evaluate' ? { resultTransport: 'json-shared-v1', resultView: entry.resultView,
        ...(duoResults && entry.resultView === 'play-v1' ? { duoProjection: true } : {}),
        ...(entry.duoSidebarProjection ? { duoSidebarProjection: true } : {}) }
        : entry.type === 'sandbox' ? { resultTransport: 'json-shared-v1' } : {}) };
      if (PROFILE_ENABLED) { profile.sending(entry); if (entry._profile) workerMessage._profile = entry._profile; profile.span('worker.message.send', () => worker.postMessage(workerMessage), entry._profile); }
      else worker.postMessage(workerMessage);
      if (snapshotKey) { sentSnapshots.delete(sentKey); sentSnapshots.set(sentKey, fresh ? { kind: entry.stateInput ? 'json-shared-v1' : 'object', revision: entry.state.revision } : sent); while (sentSnapshots.size > STATE_SNAPSHOT_LIMIT) sentSnapshots.delete(sentSnapshots.keys().next().value); }
    }
    catch { failure('worker-send'); }
    // The worker now owns its structured clone; do not retain another snapshot.
    entry.state = undefined;
    entry.stateInput = undefined;
  }
  function launch() {
    if (closed) return;
    firstCalculation = true;
    status = 'starting'; nextRetryAt = null;
    lastProgressAt = idleClock.now();
    const ownGeneration = ++generation;
    sentSnapshots.clear();
    for (const [key, value] of cache) if (value.type === 'prepare-rules') cache.delete(key);
    // Custom factories retain their exact workerData contract. Reapply on every wake/restart.
    if (PROFILE_ENABLED) profile.workerStarting(profileLane);
    try { worker = calculatorPool ? calculatorPool.createEndpoint(includeReadyCatalogue)
      : workerFactory(workerFactory === nativeWorker
        ? nativeWorkerInput(includeReadyCatalogue || workerPreparation?.persistent ? workerPreparation?.input() ?? workerData : workerData, includeReadyCatalogue && !receivedCatalogue) : workerData); }
    catch { failure('worker-start'); return; }
    if (!calculatorPool) onWorker?.(worker);
    const launchedWorker = worker;
    if (PROFILE_ENABLED) profile.workerSpawned(profileLane, worker);
    startupTimer = setTimeout(() => failure('startup-deadline'), startupDeadlineMs);
    worker.on('error', error => { if (ownGeneration === generation) failure(worker.profileRetiring ? 'profile-retired'
      : error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'worker-memory' : 'worker-error'); });
    worker.on('exit', () => { drainSource(launchedWorker); if (ownGeneration === generation && !closed) failure(launchedWorker.profileRetiring ? 'profile-retired' : 'worker-exit'); });
    worker.on('profile-retiring', () => { if (ownGeneration === generation && !closed) pump(); });
    worker.on('profile-retired', () => { if (ownGeneration === generation && !closed) failure('profile-retired'); });
    worker.on('message', message => {
      const final = !['ready', 'progress', 'prediction-prepared'].includes(message.type);
      if (ownGeneration !== generation || closed || !active || message.id !== active.id) {
        releaseEligibilityChunk(message);
        if (final) drainSource(launchedWorker, message.id);
        if (ownGeneration !== generation || closed || message.type !== 'ready') return;
      }
      if (PROFILE_ENABLED && (message._rs3ProfileReply || message._rs3ProfileRelayReply)) return;
      if (message.type === 'ready') {
        if (PROFILE_ENABLED) { profile.workerReady(profileLane, worker); profile.attach(worker); }
        supported = new Set(message.supports ?? []);
        if (workerData?.datasetDigest && (message.datasetDigest !== undefined || workerFactory === nativeWorker)
          && message.datasetDigest !== workerData.datasetDigest) { failure('dataset-mismatch'); return; }
        if (workerFactory === nativeWorker) workerPreparation?.accept(message);
        receivedCatalogue ||= Array.isArray(message.catalogue);
        clearTimeout(startupTimer); status = 'ready'; recovering = false;
        signal?.removeEventListener('abort', abortInitial);
        lastProgressAt = idleClock.now();
        compileMs = Number.isFinite(message.compileMs) ? message.compileMs : 0;
        initialResolve(message); announce(); armSleep(); pump(); return;
      }
      if (final && active.discarded) releaseEligibilityChunk(message);
      if (final) drainSource(launchedWorker, message.id);
      lastProgressAt = idleClock.now();
      if (message.type === 'progress' && message.eligibilitySeedRequest && !active.seedPending) {
        const entry = active, recipient = worker;
        entry.seedPending = true;
        const reply = proof => {
          const packet = { id: entry.id, pickerId: entry.pickerId, type: 'eligibility-seed', proof };
          entry.seedPending = false;
          if (active !== entry || worker !== recipient) { releaseEligibilityChunk(packet); return; }
          if (entry.discarded) { releaseEligibilityChunk(packet); packet.proof = undefined; }
          try { recipient.postMessage(packet, eligibilityTransferList(packet)); }
          catch {
            // A packet clone failure is an ordinary miss. A broken control
            // channel is handled by the existing worker recovery path.
            releaseEligibilityChunk(packet);
            try { recipient.postMessage({ id: entry.id, pickerId: entry.pickerId, type: 'eligibility-seed' }); }
            catch { failure('worker-send'); }
          }
        };
        // The source API admits only an immediately idle resident calculator.
        // Nothing joins its queue and no proof bytes enter a parent cache.
        Promise.resolve().then(() => entry.discarded ? undefined
          : onEligibilitySeedRequest?.(entry, message.eligibilitySeedRequest))
          .then(reply, () => reply());
        return;
      }
      if (message.type === 'progress') return;
      // A display save can advance admission metadata while the immutable
      // worker snapshot retains its captured revision. Validate that origin
      // before promoting equivalent results to the current task revision.
      for (const key of ['unlockReuse', 'partnerUnlockReuse']) {
        if (!message[key]) continue;
        if (message[key].sourceRevision === active.sourceRevision) message[key] = { ...message[key], sourceRevision: active.revision };
        else delete message[key];
      }
      if (message.type === 'prediction-prepared') {
        if (!active.discarded || active.reuseRevision) {
          if (message.unlockReuse) active.preparedReuse = message.unlockReuse;
          onEvaluation?.(message, active);
          if (active.reuseRevision) settleReuse(active, null, message.unlockReuse, true);
          if (!active.discarded && active.type === 'predict' && !active.previewValue
            && Array.isArray(message.result?.delta?.tasksAdded) && !message.result.cancelled) {
            // The owner's immutable Preview is complete. Keep the pending entry,
            // deadline and calculator lease until its partner preparation ends.
            const value = active.previewValue = workerEvaluation(message);
            storeEvaluation(active.key, active.revision, active.type, value, active.pickerId);
            for (const waiter of active.waiters) {
              waiter.signal?.removeEventListener('abort', waiter.abort);
              waiter.resolve(evaluationWith(value, { hit: waiter.hit, coalesced: waiter.hit, calculatorStarted: active.calculatorStarted }));
            }
            // Served early: refill, sleep and interactive yield must not mistake the
            // waiter-less producer for abandoned warm work while its partner runs.
            if (active.waiters.size) { lastRequestAt = idleClock.now(); active.previewServed = true; }
            active.waiters.clear();
          }
        }
        return;
      }
      const entry = active; active = undefined; deadlineClock.clearTimeout(entry.timer);
      if (entry.previewServed) liveTimings?.record('preview-partner', idleClock.now() - entry.queuedAt, { source: 'computed', calculatorStarted: entry.calculatorStarted, eligibilitySeeded: message.timingMs?.eligibilitySeeded === true, failed: !!message.error, stages: message.timingMs?.stages ?? message.timingMs });
      if (PROFILE_ENABLED) profile.completed(entry, message);
      clearCancelledGrace(entry);
      if (entry.waiters.size || entry.reuseWaiters?.size) lastRequestAt = idleClock.now();
      recordTimings(message.timingMs ?? { totalMs: message.evaluationMs });
      if (entry.residentOnly && message.residentPlanningMiss) {
        settle(entry, residentPlanningUnavailable());
      } else if (message.error) {
        // An error may occur before or after the worker touches its snapshot
        // LRU. Resend bodies until both caches have a known common order.
        sentSnapshots.clear();
        counts.errors++;
        const error = message.error.name === 'TypeError' ? new TypeError(message.error.message)
          : message.error.name === 'RangeError' ? new RangeError(message.error.message) : unavailable('Task calculation failed. Retry the calculation.');
        settle(entry, error);
      } else {
        counts.completed++;
        const value = workerEvaluation(message);
        if (!entry.discarded && (entry.waiters.size || entry.warm || entry.previewValue)) {
          onEvaluation?.(message, entry);
          if (!entry.residentOnly) storeEvaluation(entry.key, entry.revision, entry.type, value, entry.pickerId);
          settle(entry, null, value);
        }
        if (entry.reuseRevision) {
          onEvaluation?.(message, entry);
          settleReuse(entry, message.unlockReuse ? null : superseded(), [message.unlockReuse, message.partnerUnlockReuse]);
        }
      }
      pump();
      if (status === 'ready' && !active && !queue.length) armSleep();
    });
  }
  const scheduler = {
    exportEligibilityProof(entry, proof) {
      if (!canReadResident('eligibility-proof-export', entry.pickerId)) return;
      const sourceDrain = Promise.withResolvers();
      return scheduler.evaluate({ revision: entry.sourceRevision }, entry.memberId, 'eligibility-proof-export', proof,
        `eligibility-proof:${entry.id}`, undefined, undefined, [], 'full', undefined, false, entry.pickerId, true, sourceDrain)
        .then(value => value.result, async error => {
          if (sourceDrain.dispatched) await sourceDrain.promise;
          throw error;
        });
    },
    yieldWhileStarting() {
      if (closed || active || queue.length) return false;
      scheduler.cancelPrewarm();
      return retire();
    },
    isBackground() {
      return !!active && !active.waiters.size && !served(active) && !active.reuseWaiters?.size;
    },
    stopForMemory() {
      if (closed || !active) return false;
      scheduler.cancelPrewarm();
      return retire(unavailable('Task calculator exceeded its memory budget. Retry shortly.'));
    },
    yieldForInteractive() {
      // Retain cooperative workers briefly; cancel() also arms retirement for
      // native operations that cannot observe the atomic cancellation flag.
      if (active?.residentOnly) {
        if (!active.discarded) cancel(active, residentPlanningUnavailable());
        return false;
      }
      if (closed || status !== 'ready' || !active || !(active.warm || active.discarded)
        || active.waiters.size || served(active) || active.reuseWaiters?.size) return false;
      if (calculatorPool && active.discarded) {
        // An abandoned native calculation already received its atomic cancel.
        // Let a cooperative reply release the existing host before paying for
        // replacement compilation. A stuck producer still retires promptly.
        armCancelledGrace(active);
        return false;
      }
      if (active.warm) { active.warm = false; warmCounts.cancelled++; }
      return retire();
    },
    yieldQueuedWarm(pickerId) {
      for (const entry of [...warmQueue]) if (entry.pickerId === pickerId && !entry.waiters.size) {
        warmCounts.cancelled++; cancel(entry, superseded());
      }
    },
    openPicker(pickerId) { closedPickers.delete(pickerId); },
    cancelPicker(pickerId) {
      closedPickers.add(pickerId); residentPickers.delete(pickerId); armSleep();
      scheduler.cancelPrewarm({}, pickerId);
      for (const entry of new Set([...pending.values(), ...(active ? [active] : [])])) {
        if (entry.pickerId !== pickerId) continue;
        entry.reuseRevision = undefined;
        counts.cancelled++; cancel(entry, unavailable('The picker is closing.'));
      }
      for (const [key, entry] of cache) if (entry.pickerId === pickerId) cache.delete(key);
      forgetPickerSnapshots(pickerId);
      pump();
    },
    supports: type => supported.has(type),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    noteInteractiveUse: touch,
    sessionChanged(pickerId) { if (sessions && pickerId) residentPickers.add(pickerId); armSleep(); },
    confirmSavedPrediction(taskInputKey, revision, pickerId) {
      if (active?.pickerId !== pickerId || active.reuseRevision !== revision || active.preparedReuse?.taskInputKey !== taskInputKey) return false;
      active.confirmedTaskInputKey = taskInputKey; return true;
    },
    releaseSavedPrediction(revision, pickerId) {
      // A partial response may detach its follower before signature validation.
      // Race completion must also release that unconfirmed producer.
      const entry = active;
      if (!entry || entry.pickerId !== pickerId || entry.reuseRevision !== revision || entry.reuseWaiters?.size || entry.waiters.size
        || entry.warm || entry.confirmedTaskInputKey) return false;
      entry.reuseRevision = undefined; cancel(entry, superseded()); return true;
    },
    followSavedPrediction(memberId, revision, signal, pickerId) {
      const entry = active;
      if (!entry || entry.pickerId !== pickerId || entry.reuseRevision !== revision || closed || signal?.aborted) return;
      touch();
      if (entry.preparedReuse?.memberId === memberId) return Promise.resolve(entry.preparedReuse);
      if (fairness && (entry.reuseWaiters?.size ?? 0) >= fairness.maxWaitersPerJob) return;
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, memberId };
        entry.reuseWaiters ??= new Set();
        waiter.abort = () => {
          entry.reuseWaiters.delete(waiter); signal.removeEventListener('abort', waiter.abort);
          reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
          if (active === entry) scheduler.releaseSavedPrediction(revision, pickerId);
          armSleep();
        };
        entry.reuseWaiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
      });
    },
    // Internal cross-lane access preserves ordinary cache hit accounting and LRU.
    invalidatePrediction(key, pickerId) {
      key = pickerKey(pickerId, key);
      if (cache.get(key)?.type !== 'predict') return false;
      return cache.delete(key);
    },
    peekPrediction(key, pickerId) {
      key = pickerKey(pickerId, key);
      if (closed) return;
      const entry = cache.get(key);
      return entry?.type === 'predict' ? entry.value.result : undefined;
    },
    cachedEvaluation(key, resultView, pickerId) {
      key = pickerKey(pickerId, key);
      if (closed || status === 'restart-required') return;
      const exact = JSON.stringify([resultView, key]), full = JSON.stringify(['full', key]);
      const cacheKey = cache.has(exact) ? exact : resultView === 'play-v1' && cache.has(full) && cache.get(full).value.playJSON ? full : undefined;
      if (!cacheKey) return;
      touch();
      counts.requested++; counts.cacheHits++;
      const entry = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, entry);
      return evaluationWith(cacheKey === exact ? entry.value : cachedPlayValue(entry.value), { hit: true });
    },
    admitPlayEvaluation(key, revision, value, pickerId) {
      if (closed || status === 'restart-required' || status === 'sleeping' || value.cancelled || !Buffer.isBuffer(value.playJSON)) return false;
      touch();
      const stored = storeEvaluation(JSON.stringify(['play-v1', pickerKey(pickerId, key)]), revision, 'evaluate', cachedPlayValue(value), pickerId);
      if (stored) counts.promoted++;
      return stored;
    },
    readSnapshot(state, memberId, taskId, key, input, signal, stateInput, pickerId) {
      if (!canReadResident('why-task', pickerId))
        return Promise.resolve({ result: { unavailable: true } });
      return scheduler.evaluate(state, memberId, 'why-task', taskId, key, input, signal, [], 'full', stateInput, false, pickerId);
    },
    tryResidentPlanning(state, memberId, chunkId, key, input, signal, chunkIds, resultView, stateInput, pickerId) {
      if (!canReadResident('resident-chunk-planning', pickerId)) return;
      return scheduler.evaluate(state, memberId, 'chunk-planning', chunkId, key, input, signal, chunkIds, resultView, stateInput, false, pickerId, true);
    },
    preemptResidentPlanning() {
      if (active?.residentOnly && !active.discarded) cancel(active, residentPlanningUnavailable());
    },
    evaluate(state, memberId, type, chunkId, key, input, signal, chunkIds = [], resultView = 'full', stateInput, duoSidebarProjection = false, pickerId = 'legacy-shared', residentOnly = false, sourceDrain) {
      if (!residentOnly) scheduler.preemptResidentPlanning();
      counts.requested++;
      if (stateInput && !validStateInput(state, input, stateInput, type)) return Promise.reject(new TypeError('Invalid serialized task state input.'));
      const originalKey = key;
      key = pickerKey(pickerId, key);
      if (type === 'evaluate') {
        if (!['full', 'play-v1'].includes(resultView)) return Promise.reject(new TypeError('Unknown task result view.'));
        key = JSON.stringify([resultView, key]);
      }
      if (closed || closedPickers.has(pickerId) || status === 'restart-required') return Promise.reject(unavailable(closed ? 'The task server is closing.' : 'Task engine needs a server restart. Saves remain available.'));
      if (signal?.aborted) return Promise.reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
      touch();
      if (type !== 'roll-pool') scheduler.supersede(state.revision, input, memberId, pickerId);
      if (strictRevision && state.revision < revisionFor(pickerId)) return Promise.reject(superseded());
      if (!residentOnly && cache.has(key)) {
        counts.cacheHits++;
        const value = cache.get(key); cache.delete(key); cache.set(key, value);
        return Promise.resolve(evaluationWith(value.value, { hit: true }));
      }
      if (type === 'how-task' && [...pending.values()].some(entry => entry.type === type && entry.pickerId === pickerId && entry.memberId === memberId && entry.key !== key)) return Promise.reject(queueFull());
      let entry = pending.get(key), hit = !!entry;
      if (entry) {
        if (fairness && entry.waiters.size >= fairness.maxWaitersPerJob) { counts.rejected++; return Promise.reject(queueFull()); }
        counts.coalesced++; entry.revision = Math.max(entry.revision, state.revision);
        if (entry.purpose === 'ranking') {
          entry.purpose = undefined;
          if (entry.warm) { entry.warm = false; warmCounts.cancelled++; }
        }
        // A bounded response cache can reject/evict the delta while the same
        // active prediction is still preparing its partner. Follow its result.
        if (entry.previewValue && !entry.discarded) { entry.previewServed = true; return Promise.resolve(evaluationWith(entry.previewValue, { hit: true, coalesced: true, calculatorStarted: entry.calculatorStarted })); }
        // Queued requests can add the projection before dispatch. Already active
        // normal requests keep their ordinary payload and callers fall back to it.
        entry.duoSidebarProjection ||= duoSidebarProjection;
        const position = warmQueue.indexOf(entry);
        if (position >= 0) {
          if (queue.length >= maxQueue) { counts.rejected++; return Promise.reject(fairness ? queueFull() : Object.assign(new Error('Task calculation queue is full. Retry shortly.'), { status: 429 })); }
          warmQueue.splice(position, 1); queue.unshift(entry); deadline(entry);
        }
      }
      else {
        // A ready pooled lane can still be queued behind another lane's lease.
        if (queue.length >= maxQueue && (calculatorPool || active || status !== 'ready')) {
          counts.rejected++;
          return Promise.reject(fairness ? queueFull() : Object.assign(new Error('Task calculation queue is full. Retry shortly.'), { status: 429 }));
        }
        const releaseFair = admitFair(pickerId, { interactive: !residentOnly });
        if (!releaseFair) { if (residentOnly) return Promise.reject(residentPlanningUnavailable()); counts.rejected++; return Promise.reject(queueFull()); }
        entry = { releaseFair, key, originalKey, pickerId, input, state, stateInput, memberId, type, chunkId, chunkIds, resultView, duoSidebarProjection, residentOnly, sourceDrain, revision: state.revision, queuedAt: idleClock.now(), waiters: new Set() };
        entry.calculatorStarted = !calculatorPool && (!worker || ['starting', 'waking', 'sleeping'].includes(status));
        if (PROFILE_ENABLED) profile.queued(entry, profileLane);
        pending.set(key, entry);
        if (!fairness && (type === 'predict' || type === 'evaluate' && resultView === 'play-v1')) queue.unshift(entry); else queue.push(entry);
        deadline(entry);
      }
      const promise = new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, hit };
        waiter.abort = () => {
          if (!entry.waiters.delete(waiter)) return;
          signal.removeEventListener('abort', waiter.abort);
          reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
          if (!entry.waiters.size && !entry.warm) { counts.cancelled++; cancel(entry, unavailable('Calculation abandoned by its requesters.')); pump(); }
          armSleep();
        };
        entry.waiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
      });
      if (residentOnly) {
        queue.splice(queue.indexOf(entry), 1);
        const run = () => { if (calculatorPool) sentSnapshots = worker.snapshotHints; dispatch(entry); };
        if (calculatorPool) {
          if (!worker.tryIdle(pickerId, run)) settle(entry, residentPlanningUnavailable());
        } else run();
      } else { wake(); pump(); }
      return promise;
    },
    supersede(revision, input, memberId, pickerId = 'legacy-shared') {
      if (strictRevision && revision > revisionFor(pickerId)) {
        const previousRevision = revisionFor(pickerId);
        latestRevisions.set(pickerId, revision);
        if (active?.pickerId === pickerId && active.reuseRevision) {
          // A saved follower can outlive the obsolete Preview's pending entry.
          // A second save must cancel that detached producer as well.
          active.reuseRevision = undefined; counts.superseded++; cancel(active, superseded());
        }
        if (retainActivePrediction && active?.pickerId === pickerId && active.type === 'predict' && active.revision === revision - 1 && !active.discarded) {
          active.reuseRevision = revision;
          // Settle obsolete Preview waiters below, while allowing the already
          // running synchronous calculation to publish only to saved followers.
          if (active.warm) { active.warm = false; warmCounts.cancelled++; }
        }
        scheduler.cancelPrewarm({ keepActive: true }, pickerId);
        for (const [key, value] of cache) if (value.pickerId === pickerId && value.revision < revision) cache.delete(key);
        // A newly created logical lane has no older state to supersede.
        // Another lane may already have valid hints on the same calculator.
        if (!calculatorPool || previousRevision >= 0) forgetPickerSnapshots(pickerId);
        try { worker?.postMessage({ type: 'supersede', revision, pickerId }); } catch { failure('worker-send'); }
      }
      for (const entry of [...pending.values()]) {
        if (entry.pickerId !== pickerId || entry.revision >= revision || (memberId && entry.memberId !== memberId) || (entry.type === 'evaluate' && entry.input === input)) continue;
        counts.superseded++;
        cancel(entry, Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 }));
      }
    },
    supersedeDisplay(revision, pickerId) {
      latestRevisions.set(pickerId, Math.max(revisionFor(pickerId), revision));
      for (const entry of new Set([...pending.values(), ...(active ? [active] : [])])) {
        if (entry.pickerId !== pickerId) continue;
        if (entry.reuseRevision) {
          entry.reuseRevision = Math.max(entry.reuseRevision, revision);
        } else {
          entry.revision = Math.max(entry.revision, revision);
          if (entry.preparedReuse) entry.preparedReuse = { ...entry.preparedReuse, sourceRevision: entry.revision };
        }
      }
      for (const value of cache.values()) if (value.pickerId === pickerId) value.revision = Math.max(value.revision, revision);
    },
    retireObsolete(revision, pickerId) {
      if (closed || status === 'restart-required') return false;
      if (active && active.pickerId !== pickerId) return false;
      const cold = ['starting', 'waking', 'restarting'].includes(status)
        && [...pending.values()].every(entry => entry.pickerId === pickerId);
      const obsolete = active && active.revision < revision;
      const usefulPrediction = status === 'ready' && retainActivePrediction && active?.pickerId === pickerId && active.type === 'predict'
        && active.reuseRevision === revision;
      if (!cold && (!obsolete || usefulPrediction)) return false;
      // A synchronous obsolete side calculation cannot read its cancel flag
      // until it finishes. Retire its worker at the actual save boundary, while
      // keeping reusable projections and valid cached responses independent.
      for (const entry of [...pending.values()]) if (entry.pickerId === pickerId && entry.revision < revision) {
        counts.superseded++; cancel(entry, superseded());
      }
      return retire();
    },
    // Display-only saves keep task inputs, so nothing is obsolete. While
    // someone edits notes, an unrequested calculation still yields its process
    // as a gameplay save would; requested work and an idle worker stay. A
    // cancelled warm-up no longer counts as warm but runs on: a process
    // worker reads its cancel message only after the synchronous work.
    retireWarm(pickerId) {
      if (closed || status !== 'ready' || !active || active.pickerId !== pickerId || active.waiters.size || served(active) || active.reuseWaiters?.size) return false;
      for (const entry of [...pending.values()]) if (entry.pickerId === pickerId && entry.warm && !entry.waiters.size && !served(entry)) {
        entry.warm = false; warmCounts.cancelled++; cancel(entry, unavailable('Background prediction cancelled.'));
      }
      return retire();
    },
    canPrewarm() {
      return !closed && ['starting', 'ready'].includes(status) && (idleClock.now() - lastRequestAt < idleMs || sessionRemaining() > 0);
    },
    prewarmTasks(state, input, memberIds, resultView, stateInput, pickerId) {
      if (closedPickers.has(pickerId) || !scheduler.canPrewarm() || state.revision < revisionFor(pickerId)) return { queued: 0 };
      let queued = 0, snapshot;
      for (const memberId of new Set(memberIds)) {
        const originalKey = JSON.stringify([input, memberId, 'evaluate', undefined, undefined]);
        const key = JSON.stringify([resultView, pickerKey(pickerId, originalKey)]);
        if (cache.has(key) || pending.has(key) || warmQueue.length >= maxPrewarmQueue) { warmCounts.skipped++; continue; }
        // A captured serialized snapshot is already immutable. Object callers
        // share one defensive clone across this bounded batch.
        const releaseFair = admitFair(pickerId);
        if (!releaseFair) { warmCounts.skipped++; continue; }
        snapshot ??= stateInput ? state : structuredClone(state);
        const entry = { calculatorStarted: !calculatorPool && (!worker || ['starting', 'waking', 'sleeping'].includes(status)), releaseFair, key, originalKey, pickerId, input, state: snapshot, stateInput, memberId, type: 'evaluate', resultView,
          revision: state.revision, queuedAt: idleClock.now(), waiters: new Set(), warm: true };
        if (PROFILE_ENABLED) profile.queued(entry, profileLane);
        pending.set(key, entry); warmQueue.push(entry); queued++; warmCounts.queued++;
      }
      pump(); return { queued };
    },
    prewarm(state, input, groups, signal, predictionRevision = state.revision, pickerId = 'legacy-shared') {
      if (closed || closedPickers.has(pickerId) || signal?.aborted || status === 'restart-required' || state.revision < revisionFor(pickerId)
        || idleClock.now() - lastRequestAt >= idleMs && !sessions?.remaining(pickerId)) return { queued: 0 };
      scheduler.supersede(state.revision, input, undefined, pickerId);
      const desired = new Map(), fingerprint = predictionInput(state, input);
      for (const group of groups) for (const chunkId of group.chunkIds) {
        const key = pickerKey(pickerId, JSON.stringify([predictionRevision, group.memberId, String(chunkId), fingerprint]));
        if (desired.has(key)) continue;
        // Finished reviewed choices do not consume queue slots ahead of missing
        // pool candidates when a visible comparison refills the bounded batch.
        if (cache.has(key)) { warmCounts.skipped++; continue; }
        if (desired.size < maxPrewarmQueue) desired.set(key, { memberId: group.memberId, chunkId: String(chunkId), purpose: group.purpose });
        else warmCounts.skipped++;
      }
      const previous = prewarmSubscriptions.get(pickerId);
      previous?.signal?.removeEventListener('abort', previous.abort);
      for (const entry of [...pending.values()]) if (entry.pickerId === pickerId && entry.warm && entry.type === 'predict' && !desired.has(entry.key)) {
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size && !served(entry)) cancel(entry, unavailable('Background prediction cancelled.'));
      }
      let queued = 0, snapshot;
      for (const [key, { memberId, chunkId, purpose }] of desired) {
        const existing = pending.get(key);
        if (existing?.purpose === 'ranking' && purpose !== 'ranking') existing.purpose = purpose;
        if (cache.has(key) || pending.has(key) || warmQueue.length >= maxPrewarmQueue) { warmCounts.skipped++; continue; }
        const releaseFair = admitFair(pickerId);
        if (!releaseFair) { warmCounts.skipped++; continue; }
        snapshot ??= structuredClone(state);
        const entry = { releaseFair, key, originalKey: JSON.parse(key)[1], pickerId, input, state: snapshot, memberId, type: 'predict', chunkId, revision: state.revision,
          queuedAt: idleClock.now(), waiters: new Set(), warm: true, purpose };
        if (PROFILE_ENABLED) profile.queued(entry, profileLane);
        pending.set(key, entry); warmQueue.push(entry); queued++; warmCounts.queued++;
      }
      const abort = () => scheduler.cancelPrewarm({}, pickerId);
      prewarmSubscriptions.set(pickerId, { signal, abort });
      signal?.addEventListener('abort', abort, { once: true });
      if (queued) wake();
      pump(); return { queued };
    },
    cancelPrewarm({ keepActive = false, keepActiveKey } = {}, pickerId) {
      const previous = prewarmSubscriptions.get(pickerId);
      previous?.signal?.removeEventListener('abort', previous.abort);
      prewarmSubscriptions.delete(pickerId);
      if (pickerId === undefined) {
        for (const subscription of prewarmSubscriptions.values()) subscription.signal?.removeEventListener('abort', subscription.abort);
        prewarmSubscriptions.clear();
      }
      for (const entry of [...pending.values()]) if (entry.warm && (pickerId === undefined || entry.pickerId === pickerId)) {
        if (active === entry && (keepActive || pickerKey(entry.pickerId, keepActiveKey) === entry.key)) continue;
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size && !served(entry)) cancel(entry, unavailable('Background prediction cancelled.'));
      }
    },
    cancelRankingPrewarm(keepMemberIds = new Set(), pickerId) {
      for (const entry of [...pending.values()]) if (entry.pickerId === pickerId && entry.warm && entry.purpose === 'ranking' && !keepMemberIds.has(entry.memberId)) {
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size && !served(entry)) cancel(entry, unavailable('Pool ranking cancelled.'));
      }
    },
    // Browser recovery needs readiness, not shared lane activity or lifetimes.
    // An idle picker can submit work even when another picker's lane is waking.
    // Lane failures affect everyone, including after failed requests settle.
    getClientHealth(pickerId) {
      const ownWork = [...pending.values()].some(entry => entry.pickerId === pickerId)
        || active?.pickerId === pickerId;
      const clientStatus = closed ? 'closed' : recovering ? status === 'restart-required' ? status : 'restarting' : ownWork ? status : 'ready';
      return { status: clientStatus, ready: clientStatus === 'ready', restartRequired: clientStatus === 'restart-required' };
    },
    getHealth() {
      const time = idleClock.now(), oldest = queue[0]?.queuedAt ?? warmQueue[0]?.queuedAt;
      const activeMs = active ? Math.max(0, time - active.startedAt) : 0;
      const queuedMs = oldest === undefined ? 0 : Math.max(0, time - oldest);
      const busySince = active?.startedAt ?? oldest ?? (['starting', 'waking', 'restarting'].includes(status) ? lastProgressAt : undefined);
      const noProgressMs = busySince === undefined ? 0 : Math.max(0, time - Math.max(busySince, lastProgressAt));
      // Compilation has its own bounded allowance. A busy startup is not a
      // stalled calculation merely because that allowance exceeds stuckMs.
      const noProgressLimit = ['starting', 'waking'].includes(status) ? Math.max(stuckMs, startupDeadlineMs) : stuckMs;
      return { status: closed ? 'closed' : status, ready: !closed && status === 'ready', restartRequired: status === 'restart-required',
        stuck: !closed && status !== 'sleeping' && noProgressMs > noProgressLimit, activeMs, queuedMs, noProgressMs, stuckMs,
        restarts, maxRestarts, failures, nextRetryAt, compileMs, lastFailure, idleMs, idleStops, resident: !!worker, retiring: terminating.size };
    },
    async restartUnhealthy() {
      if (manualRestart) { await manualRestart; return false; }
      if (closed || !(scheduler.getHealth().stuck || status === 'restart-required')) return false;
      manualRestart = (async () => {
        clearCancelledGrace();
        clearTimeout(restartTimer); clearTimeout(startupTimer); clearImmediate(idleTimer); idleTimer = undefined;
        idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
        status = 'restarting'; recovering = true; generation++;
        scheduler.cancelPrewarm();
        const error = unavailable('Task calculation restarted. Retry shortly.');
        for (const entry of [...pending.values()]) settle(entry, error);
        if (active) { deadlineClock.clearTimeout(active.timer); settle(active, error); active = undefined; }
        sentSnapshots.clear(); cache.clear(); onSleep?.();
        const old = worker; worker = undefined; terminate(old); announce();
        // Finish retirement before allocating replacement definitions.
        await Promise.allSettled([...terminating]);
        if (!closed) { restarts = 0; launch(); }
      })();
      try { await manualRestart; return true; } finally { manualRestart = undefined; }
    },
    getDiagnostics() {
      return { worker: scheduler.getHealth(), queue: { depth: queue.length, active: active ? 1 : 0, limit: maxQueue, deadlineMs, firstCalculationDeadlineMs,
        oldestWaitMs: queue.length ? idleClock.now() - queue[0].queuedAt : 0 }, counts: { ...counts },
      retainedWork: { pending: pending.size, cancellationGrace: cancelledGrace ? 1 : 0,
        stateInputs: [...pending.values()].filter(entry => entry.state || entry.stateInput).length },
      cache: { entries: cache.size, limit: cacheLimit, byteLimit: cacheByteLimit, bytes: [...cache.values()].reduce((sum, value) => sum + value.bytes, 0) },
      prewarm: { ...warmCounts, pending: warmQueue.length, active: active?.warm ? 1 : 0, limit: maxPrewarmQueue },
      ranking: { pending: warmQueue.filter(entry => entry.warm && entry.purpose === 'ranking').length,
        active: active?.warm && active.purpose === 'ranking' ? 1 : 0 },
      timingMs: { last: { ...lastTimingMs }, stages: Object.fromEntries(Object.entries(timings).map(([stage, value]) => [stage, { ...value, meanMs: value.totalMs / value.count }])) } };
    },
    close(timeoutMs = 10000) {
      if (closePromise) return closePromise;
      signal?.removeEventListener('abort', abortInitial);
      if (!closed) {
        clearCancelledGrace();
        closed = true; status = 'closed'; generation++;
        initialReject(unavailable('The task server is closing.'));
        announce(); listeners.clear();
        clearTimeout(restartTimer); clearTimeout(startupTimer);
        idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
        clearImmediate(idleTimer); scheduler.cancelPrewarm(); sentSnapshots.clear();
        for (const entry of [...pending.values()]) settle(entry, unavailable('The task server is closing.'));
        if (active) { deadlineClock.clearTimeout(active.timer); settleReuse(active, unavailable('The task server is closing.')); active = undefined; }
        terminate(worker); worker = undefined; cache.clear();
      }
      closePromise = (async () => {
        let timer;
        await Promise.race([Promise.allSettled([...terminating]), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
        clearTimeout(timer);
      })();
      return closePromise;
    },
  };
  onCreated?.(scheduler);
  if (signal?.aborted) abortInitial();
  else { signal?.addEventListener('abort', abortInitial, { once: true }); launch(); }
  try {
    const ready = await initial;
    if (workerData?.datasetDigest && ready.datasetDigest !== undefined && ready.datasetDigest !== workerData.datasetDigest) throw new Error('Worker dataset digest mismatch.');
    scheduler.datasetDigest = ready.datasetDigest ?? workerData?.datasetDigest;
    scheduler.catalogue = ready.catalogue;
    // Background lanes never read the generated catalogue, so they skip decoding it.
    // The initial promise keeps `ready` reachable for the lane's lifetime, so take
    // the bytes off it; the getter drops them once decoded and never holds `ready`.
    let dynamicCatalogueBytes = ready.dynamicCatalogueBytes; delete ready.dynamicCatalogueBytes;
    let dynamicCatalogue = dynamicCatalogueBytes === undefined ? ready.dynamicCatalogue ?? [] : undefined;
    Object.defineProperty(scheduler, 'dynamicCatalogue', { enumerable: true, configurable: true,
      get: () => { dynamicCatalogue ??= deserialize(dynamicCatalogueBytes); dynamicCatalogueBytes = undefined; return dynamicCatalogue; } });
    if (!onCreated) void scheduler.dynamicCatalogue;
    return scheduler;
  } catch (error) { if (initialAborted || !onCreated) await scheduler.close(); throw error; }
  finally { signal?.removeEventListener('abort', abortInitial); }
}
