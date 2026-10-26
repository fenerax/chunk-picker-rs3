import { Worker } from 'node:worker_threads';
import { ProcessWorker } from './process-worker.mjs';
import { createHash } from 'node:crypto';
import { deserialize } from 'node:v8';
import { createUnlockResultCache, taskReuseInputKey } from './unlock-reuse.mjs';
import { STATE_SNAPSHOT_LIMIT } from './state-transfer.mjs';
import { PLANNING_BASELINE_BYTES } from './planning-baseline.mjs';
import { TASK_WORKER_RESOURCE_LIMITS } from './worker-limits.mjs';

const unavailable = message => Object.assign(new Error(message), { status: 503 });
const positive = (value, name, minimum = 1) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer of at least ${minimum}.`);
};
const superseded = () => Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 });
// Windows can retain retired isolate allocator pages in the hosting process.
// Give each native calculator an owned process so retirement releases them.
const nativeWorker = data => process.env.RS3_TASK_WORKER_MODE === 'thread'
  || process.platform !== 'win32' && process.env.RS3_TASK_WORKER_MODE !== 'process'
  ? new Worker(new URL('./worker.mjs', import.meta.url), { workerData: data, resourceLimits: TASK_WORKER_RESOURCE_LIMITS }) : new ProcessWorker(data);
const nativePlanningWorker = () => process.env.RS3_TASK_WORKER_MODE === 'thread'
  || process.platform !== 'win32' && process.env.RS3_TASK_WORKER_MODE !== 'process'
  ? new Worker(new URL('./planning-worker.mjs', import.meta.url), { resourceLimits: TASK_WORKER_RESOURCE_LIMITS })
  : new ProcessWorker({}, { planning: true });
// Built-in advisory lanes never read the ready catalogue, so their workers skip
// sending it. The flag is always overwritten: callers cannot strip foreground's.
export const nativeWorkerInput = (workerData, includeReadyCatalogue) => ({ ...workerData, omitReadyCatalogue: !includeReadyCatalogue });
// Rules are included even for direct callers that omit the gameplay fingerprint.
const predictionInput = (state, input) => createHash('sha256').update(JSON.stringify([input,
  state.rules, state.taskRules, state.members?.map(member => [member.id, member.taskRules, state.legacy?.maps?.[member.sourceMapId]?.rules])])).digest('hex');
export const predictionCacheKey = (state, memberId, chunkId, input) => JSON.stringify([state.revision, memberId, String(chunkId), predictionInput(state, input)]);

// Preserve lazy result access when adding per-waiter metadata. Object spread
// would parse the full task result even for callers that only send its bytes.
const evaluationWith = (value, metadata) => Object.defineProperties({ ...metadata }, Object.getOwnPropertyDescriptors(value));
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
  delete descriptors.resultJSON; delete descriptors.result;
  const playJSON = value.playJSON;
  let result;
  return Object.defineProperties({ get result() { return result ??= JSON.parse(playJSON.toString('utf8')); } }, descriptors);
}
function workerEvaluation(message) {
  const metadata = { evaluationMs: message.evaluationMs, timingMs: message.timingMs };
  if (message.sandboxJSON instanceof SharedArrayBuffer) {
    const sandboxJSON = Buffer.from(message.sandboxJSON);
    let result;
    return { sandboxJSON, resultCache: message.resultCache, ...metadata,
      get result() { return result ??= { ...JSON.parse(sandboxJSON.toString('utf8')), cache: message.resultCache }; } };
  }
  if (!(message.playJSON instanceof SharedArrayBuffer)) return { result: message.result, ...metadata };
  const resultJSON = message.resultJSON instanceof SharedArrayBuffer ? Buffer.from(message.resultJSON) : undefined;
  const playJSON = Buffer.from(message.playJSON);
  let result;
  const duoJSON = message.duoJSON instanceof SharedArrayBuffer ? Buffer.from(message.duoJSON) : undefined;
  const duoSidebarJSON = message.duoSidebarJSON instanceof SharedArrayBuffer ? Buffer.from(message.duoSidebarJSON) : undefined;
  return { ...(resultJSON ? { resultJSON } : {}), ...(duoJSON ? { duoJSON } : {}), ...(duoSidebarJSON ? { duoSidebarJSON } : {}), playJSON, cancelled: !!message.cancelled, ...metadata,
    get result() { return result ??= JSON.parse((resultJSON ?? playJSON).toString('utf8')); } };
}
function validStateInput(state, input, stateInput, type) {
  return ['evaluate', 'chunk-planning', 'sandbox', 'area-check'].includes(type) && stateInput.stateJSON instanceof SharedArrayBuffer
    && stateInput.stateJSON.byteLength > 0 && typeof stateInput.inputKey === 'string' && stateInput.inputKey === input
    && Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.members)
    && state.members.length > 0 && state.members.every(member => member && typeof member.id === 'string' && member.id.length > 0)
    && new Set(state.members.map(member => member.id)).size === state.members.length;
}

/** Interactive work and advisory batches have independent bounded workers. */
export async function createTaskScheduler({ maxDeathQueue = 2, deathDeadlineMs = 120000, deathWorkerFactory,
  duoWorkerFactory, maxDuoQueue = 2, duoDeadlineMs = 30000, duoCacheLimit = 4, duoCacheBytes = 32 * 1024 * 1024,
  predictionWorkerFactory, planningWorkerFactory, maxPredictionQueue = 8, predictionDeadlineMs = 120000,
  predictionCacheLimit = 256, predictionCacheBytes = 32 * 1024 * 1024, maxPrewarmQueue = 256, signal, ...options } = {}) {
  positive(maxDeathQueue, 'maxDeathQueue'); positive(deathDeadlineMs, 'deathDeadlineMs');
  for (const [name, value] of Object.entries({ maxPredictionQueue, predictionDeadlineMs, predictionCacheLimit, predictionCacheBytes, maxPrewarmQueue })) positive(value, name);
  for (const [name, value] of Object.entries({ maxDuoQueue, duoDeadlineMs, duoCacheLimit, duoCacheBytes })) positive(value, name);
  const planningBaselines = new Map();
  const planningKey = (state, memberId, input) => typeof input === 'string' ? JSON.stringify([memberId, predictionInput(state, input)]) : undefined;
  const rememberPlanning = (message, entry) => {
    if (entry.type !== 'evaluate' || !entry.planningKey || !ArrayBuffer.isView(message.planningBaseline)
      || message.planningBaseline.byteLength > PLANNING_BASELINE_BYTES) return;
    planningBaselines.delete(entry.planningKey);
    planningBaselines.set(entry.planningKey, message.planningBaseline);
    while (planningBaselines.size > 2 || [...planningBaselines.values()].reduce((n, b) => n + b.byteLength, 0) > PLANNING_BASELINE_BYTES)
      planningBaselines.delete(planningBaselines.keys().next().value);
  };
  const foreground = await createWorkerLane({ ...options, includeReadyCatalogue: true, maxPrewarmQueue, signal,
    onEvaluation: rememberPlanning, onSleep: () => planningBaselines.clear() });
  const unlockResults = createUnlockResultCache({ limit: predictionCacheLimit, byteLimit: Math.floor(predictionCacheBytes / 2) });
  let death, prediction, duo, planning, closed = false, closePromise, latestRevision = -1;
  // Claims/preferences advance HTTP revisions while retaining task identities.
  let taskRevision = -1, savedPredictionSourceRevision = -1;
  const listeners = new Set();
  const residencyListeners = new Set();
  const predictionListeners = new Set();
  const announceResidency = () => { for (const listener of residencyListeners) { try { listener(scheduler.getHealth()); } catch { /* Observers cannot interrupt retirement. */ } } };
  const announce = () => { announceResidency(); for (const listener of listeners) { try { listener(scheduler.getHealth()); } catch { /* Observers cannot interrupt recovery. */ } } };
  foreground.subscribe(announce);
  // Created only by an explicit group peer request. A slow peer never occupies
  // the selected member's foreground queue or the Preview/death lanes.
  function duoLane() {
    if (!duo) void createWorkerLane({ ...options,
      ...(duoWorkerFactory ? { workerFactory: duoWorkerFactory } : {}),
      includeReadyCatalogue: false, onEvaluation: rememberPlanning,
      maxQueue: maxDuoQueue, deadlineMs: duoDeadlineMs, cacheLimit: duoCacheLimit, cacheByteLimit: duoCacheBytes, duoResults: true,
      onCreated(lane) { duo = lane; lane.subscribe(announce); },
    }).catch(() => { /* The lane reports bounded startup/recovery failure. */ });
    return duo;
  }
  function planningLane() {
    if (!planning) void createWorkerLane({ ...options, workerData: undefined, workerFactory: planningWorkerFactory ?? nativePlanningWorker,
      includeReadyCatalogue: false, strictRevision: true, maxQueue: maxPredictionQueue, deadlineMs: predictionDeadlineMs,
      cacheLimit: predictionCacheLimit, cacheByteLimit: Math.floor(predictionCacheBytes / 2),
      onCreated(lane) { planning = lane; lane.subscribe(announceResidency); announceResidency(); },
    }).catch(() => {});
    return planning;
  }
  function predictionLane() {
    if (!prediction) void createWorkerLane({ ...options,
      ...(predictionWorkerFactory ? { workerFactory: predictionWorkerFactory } : {}),
      includeReadyCatalogue: false,
      maxQueue: maxPredictionQueue, deadlineMs: predictionDeadlineMs, cacheLimit: predictionCacheLimit,
      cacheByteLimit: predictionCacheBytes - Math.floor(predictionCacheBytes / 2), maxPrewarmQueue, strictRevision: true, shareSnapshots: true,
      retainActivePrediction: true,
      onEvaluation(message, entry) {
        rememberPlanning(message, entry);
        if (!closed && entry.revision === latestRevision && !entry.discarded && !message.result?.cancelled
          && Array.isArray(message.result?.delta?.tasksAdded)) {
          const state = { ...entry.predictionState, revision: entry.revision };
          for (const listener of predictionListeners) {
            try { listener({ state, input: entry.input, memberId: entry.memberId, chunkId: entry.chunkId, result: message.result }); }
            catch { /* Summary observers cannot interrupt prediction admission. */ }
          }
        }
        const reuse = message.unlockReuse;
        if (!closed && reuse?.memberId === entry.memberId && reuse.sourceRevision === entry.revision
          && (entry.revision === latestRevision || entry.reuseRevision === latestRevision
            && (entry.reuseWaiters?.size || entry.confirmedTaskInputKey === reuse.taskInputKey))) {
          const peer = message.partnerUnlockReuse;
          const pair = peer && peer.memberId !== reuse.memberId && peer.taskInputKey === reuse.taskInputKey && peer.sourceRevision === reuse.sourceRevision;
          unlockResults.admitMany(pair ? [reuse, peer] : [reuse], entry.purpose === 'ranking' ? 0 : entry.warm ? reuse.priority : 3, entry.key);
        }
      },
      onSleep() { unlockResults.clear(); },
      // Background readiness must not announce a new foreground-ready event.
      onCreated(lane) { prediction = lane; lane.subscribe(announceResidency); announceResidency(); },
    }).catch(() => {});
    return prediction;
  }
  const scheduler = {
    catalogue: foreground.catalogue, dynamicCatalogue: foreground.dynamicCatalogue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeResidency(listener) { residencyListeners.add(listener); return () => residencyListeners.delete(listener); },
    subscribePredictions(listener) { predictionListeners.add(listener); return () => predictionListeners.delete(listener); },
    peekPrediction(state, memberId, chunkId, input) {
      if (closed || state.revision < latestRevision) return;
      return prediction?.peekPrediction(predictionCacheKey({ ...state, revision: taskRevision }, memberId, chunkId, input));
    },
    // Only a newly opened ranking view counts as interactive use. Reading its
    // progress and completing background candidates leave the idle clock alone.
    notePredictionUse() { if (!closed) prediction?.noteInteractiveUse(); },
    cancelRankingPrewarm(keepMemberIds) { prediction?.cancelRankingPrewarm(keepMemberIds); },
    preparedEvaluation(taskInputKey, memberId, revision) {
      // The server hashes its captured immutable task input before asking here.
      // A hit needs no serialized worker snapshot or resident foreground worker.
      if (closed || revision !== latestRevision || !unlockResults.getDiagnostics().entries) return;
      if (typeof taskInputKey === 'function') taskInputKey = taskInputKey();
      if (typeof taskInputKey !== 'string' || !/^[a-f0-9]{64}$/.test(taskInputKey) || typeof memberId !== 'string') return;
      const reused = unlockResults.get(taskInputKey, memberId, revision);
      if (reused) prediction?.confirmSavedPrediction(taskInputKey, revision);
      return reused ? evaluationWith(unlockEvaluation(reused), { hit: true }) : undefined;
    },
    prepareRules(rules, revision) {
      if (closed) return Promise.reject(unavailable('The task server is closing.'));
      if (!rules || typeof rules !== 'object' || Array.isArray(rules) || !Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new TypeError('Invalid task preparation input.'));
      const key = JSON.stringify(['prepare-rules', revision, rules]);
      return foreground.evaluate({ revision, rules }, undefined, 'prepare-rules', undefined, key);
    },
    evaluate(state, memberId, type = 'evaluate', chunkId, key, input, signal, chunkIds = [], resultView = 'full', stateInput, evaluationLane = 'foreground', duoSidebarProjection = false) {
      if (closed) return Promise.reject(unavailable('The task server is closing.'));
      if (signal?.aborted) return Promise.reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
      if (stateInput && !validStateInput(state, input, stateInput, type)) return Promise.reject(new TypeError('Invalid serialized task state input.'));
      if (!['foreground', 'duo', 'side'].includes(evaluationLane) || evaluationLane === 'duo' && (type !== 'evaluate' || resultView !== 'play-v1')
        || evaluationLane === 'side' && !(type === 'chunk-planning' || type === 'evaluate' && resultView === 'full')) return Promise.reject(new TypeError('Invalid task evaluation lane.'));
      if (typeof duoSidebarProjection !== 'boolean' || duoSidebarProjection && (type !== 'evaluate' || resultView !== 'play-v1' || evaluationLane !== 'foreground')) return Promise.reject(new TypeError('Invalid duo sidebar projection.'));
      scheduler.supersede(state.revision, input, memberId);
      if (type === 'evaluate' && resultView === 'play-v1' && state.revision >= latestRevision && unlockResults.getDiagnostics().entries) {
        const taskInputKey = stateInput ? stateInput.taskInputKey : taskReuseInputKey(state);
        const reused = unlockResults.get(taskInputKey, memberId, state.revision);
        if (reused) {
          prediction?.confirmSavedPrediction(taskInputKey, state.revision);
          // Both projections were calculated from the complete hypothetical
          // fixed point. Matching saved task inputs makes these authoritative.
          const value = unlockEvaluation(reused);
          if (!value.gzipJSONPrefixes) foreground.admitPlayEvaluation(key, state.revision, value);
          return Promise.resolve(evaluationWith(value, { hit: true }));
        }
      }
      // The old Preview is rejected at the save boundary. Only its complete
      // hypothetical task bytes may race a fresh saved calculation, and only
      // after the worker's fingerprint proves every task input is identical.
      const raceController = type === 'evaluate' && resultView === 'play-v1' ? new AbortController() : undefined;
      const requestSignal = raceController ? signal ? AbortSignal.any([signal, raceController.signal]) : raceController.signal : signal;
      const raceSavedPrediction = ordinary => {
        const following = raceController && prediction?.followSavedPrediction(memberId, state.revision, requestSignal);
        if (!following) return ordinary;
        const projected = following.then(reuse => {
          const taskInputKey = stateInput ? stateInput.taskInputKey : taskReuseInputKey(state);
          if (closed || requestSignal.aborted || state.revision !== latestRevision || reuse?.memberId !== memberId
            || reuse.sourceRevision !== savedPredictionSourceRevision || reuse.taskInputKey !== taskInputKey
            || !['playJSON', 'duoJSON', 'duoSidebarJSON'].every(key => reuse[key] instanceof SharedArrayBuffer)) throw superseded();
          prediction?.confirmSavedPrediction(taskInputKey, state.revision);
          unlockResults.admit(reuse, 3);
          const retained = unlockResults.get(taskInputKey, memberId, state.revision);
          const value = unlockEvaluation(retained ?? Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON'].map(key => [key, Buffer.from(reuse[key])])));
          if (!value.gzipJSONPrefixes) foreground.admitPlayEvaluation(key, state.revision, value);
          return evaluationWith(value, { hit: true });
        });
        return Promise.any([ordinary, projected]).catch(error => { throw error.errors?.[0] ?? error; })
          .finally(() => { raceController.abort(); prediction?.releaseSavedPrediction(state.revision); });
      };
      if (evaluationLane === 'duo') {
        if (state.revision < latestRevision) return Promise.reject(superseded());
        // Keep peer computation compact. A later map switch can reuse its bytes
        // through the normal foreground cache; full details still hydrate normally.
        const cached = foreground.cachedEvaluation(key, resultView);
        if (cached) return Promise.resolve(cached);
        return raceSavedPrediction(duoLane().evaluate(state, memberId, type, chunkId, key, input, requestSignal, chunkIds, resultView, stateInput).then(value => {
          if (!closed && !signal?.aborted && state.revision === latestRevision && !value.cancelled) {
            foreground.admitPlayEvaluation(key, state.revision, value);
          }
          return value;
        }));
      }
      if (type === 'predict') {
        if (state.revision < latestRevision) return Promise.reject(superseded());
        const predictionKey = predictionCacheKey({ ...state, revision: taskRevision }, memberId, chunkId, input);
        const owner = state.members?.find(member => member.id === memberId);
        if (/^\d+$/.test(String(chunkId)) && Array.isArray(owner?.unlocked) && !owner.unlocked.includes(String(chunkId))
          && !unlockResults.hasCompletePrediction(predictionKey, state.members.map(member => member.id))) {
          // A delta may outlive its bounded prepared pair. Explicit interest
          // must prepare missing task bytes before Preview is considered ready.
          prediction?.invalidatePrediction(predictionKey);
        }
        unlockResults.touchPrediction(predictionKey);
        prediction?.cancelPrewarm({ keepActiveKey: predictionKey });
        return predictionLane().evaluate(state, memberId, type, chunkId, predictionKey, input, signal);
      }
      if (type === 'chunk-planning' && state.revision >= latestRevision) {
        const baselineKey = planningKey(state, memberId, input), bytes = planningBaselines.get(baselineKey);
        if (bytes) return planningLane().evaluate({ revision: state.revision, planningKey: baselineKey, planningBaseline: bytes },
          memberId, type, chunkId, key, input, signal);
      }
      if (evaluationLane === 'side' || type === 'chunk-planning') {
        if (state.revision < latestRevision) return Promise.reject(superseded());
        return predictionLane().evaluate(state, memberId, type, chunkId, key, input, signal, chunkIds, resultView, stateInput);
      }
      if (type === 'sandbox' || type === 'area-check') {
        if (state.revision < latestRevision) return Promise.reject(superseded());
        // Drafts use their normalized changes in the key, with the same bounded
        // advisory lane as Preview so foreground saved tasks remain independent.
        return predictionLane().evaluate(state, memberId, type, chunkId, key, input, signal, [], resultView, stateInput);
      }
      if (type !== 'death-estimates') return raceSavedPrediction(foreground.evaluate(state, memberId, type, chunkId, key, input, requestSignal, chunkIds, resultView, stateInput, duoSidebarProjection));
      if (state.revision < latestRevision) return Promise.reject(Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 }));
      if (!death) {
        // Expose the lane before it is ready: startup admissions use its bounded
        // queue and request watchdog, rather than accumulating promise waiters.
        void createWorkerLane({ ...options, ...(deathWorkerFactory ? { workerFactory: deathWorkerFactory } : {}),
          includeReadyCatalogue: false,
          maxQueue: maxDeathQueue, deadlineMs: deathDeadlineMs,
          onCreated(lane) { death = lane; lane.subscribe(announce); },
        }).catch(() => { /* The lane rejects its requests and reports its failure. */ });
      }
      return death.evaluate(state, memberId, type, undefined, JSON.stringify([key, chunkIds]), input, signal, chunkIds);
    },
    supersede(revision, input, memberId) {
      if (revision > latestRevision) {
        savedPredictionSourceRevision = latestRevision;
        // Display revisions share the same prediction origin. Expire only at
        // an actual task change, preserving the preceding hypothetical pair.
        unlockResults.supersede(taskRevision + 1);
        taskRevision = revision;
      }
      latestRevision = Math.max(latestRevision, revision);
      foreground.supersede(revision, input, memberId); death?.supersede(revision, input, memberId);
      prediction?.supersede(revision, input);
      duo?.supersede(revision, input); planning?.supersede(revision, input);
    },
    // Claims and display saves advance HTTP guards without disturbing prediction
    // queues or sending control work to a calculator with identical task inputs.
    supersedeDisplay(revision, input) {
      latestRevision = Math.max(latestRevision, revision);
      foreground.supersedeDisplay(revision); death?.supersedeDisplay(revision);
      prediction?.supersedeDisplay(revision); duo?.supersedeDisplay(revision); planning?.supersedeDisplay(revision);
    },
    setRevision(revision, input) {
      positive(revision, 'revision', 0);
      const changed = revision > latestRevision;
      scheduler.supersede(revision, input);
      if (changed) {
        prediction?.retireObsolete(revision);
        death?.retireObsolete(revision); planning?.retireObsolete(revision);
      }
      return changed;
    },
    prewarm(state, input, groups, { signal } = {}) {
      if (closed || signal?.aborted || state.revision < latestRevision) return { queued: 0 };
      scheduler.supersede(state.revision, input);
      // Ranking deltas may displace a reviewed choice's response from the LRU.
      // Its complete prepared bytes still satisfy automatic preparation, so a
      // refill must not repeat that calculation merely to restore the delta.
      const memberIds = state.members?.map(member => member.id) ?? [];
      if (memberIds.length && unlockResults.getDiagnostics().entries) {
        groups = groups.map(group => group.purpose === 'ranking' ? group : { ...group,
          chunkIds: group.chunkIds.filter(chunkId => !unlockResults.hasCompletePrediction(
            predictionCacheKey({ ...state, revision: taskRevision }, group.memberId, chunkId, input), memberIds)) });
      }
      if (!prediction && !groups.some(group => group.chunkIds.length)) return { queued: 0 };
      return predictionLane().prewarm(state, input, groups, signal, taskRevision);
    },
    // Current task results and arbitrary Preview baselines use the same bounded
    // low-priority admission as candidate warming, without interactive waiters.
    canPrewarmTasks(usePrediction = false) { return !closed && foreground.canPrewarm() && (!usePrediction || !prediction || prediction.canPrewarm()); },
    prewarmTasks(state, input, memberIds, { resultView = 'full', stateInput, prediction: usePrediction = false } = {}) {
      if (closed || state.revision < latestRevision) return { queued: 0 };
      if (!['full', 'play-v1'].includes(resultView)) throw new TypeError('Unknown task result view.');
      if (!Array.isArray(memberIds) || memberIds.some(id => !state.members?.some(member => member.id === id))) throw new TypeError('Choose known players to prepare tasks.');
      if (stateInput && !validStateInput(state, input, stateInput, 'evaluate')) throw new TypeError('Invalid serialized task state input.');
      if (!memberIds.length || usePrediction && !prediction && !foreground.canPrewarm()) return { queued: 0 };
      scheduler.supersede(state.revision, input);
      return (usePrediction ? predictionLane() : foreground).prewarmTasks(state, input, memberIds, resultView, stateInput);
    },
    cancelPrewarm(options) { if (!options?.keepTasks) foreground.cancelPrewarm(); prediction?.cancelPrewarm(options); },
    retireWarmPrediction() { return prediction?.retireWarm() ?? false; },
    resumePrewarm() { prediction?.noteInteractiveUse(); },
    getHealth() {
      const health = foreground.getHealth(), lanes = { death: death?.getHealth() ?? { status: 'idle', ready: false },
        prediction: prediction?.getHealth() ?? { status: 'idle', ready: false }, duo: duo?.getHealth() ?? { status: 'idle', ready: false }, planning: planning?.getHealth() ?? { status: 'idle', ready: false } };
      const all = [health, ...Object.values(lanes)];
      return { ...health, ...lanes, stuck: all.some(lane => lane.stuck), restartRequired: all.some(lane => lane.restartRequired),
        recovering: all.some(lane => ['starting', 'waking', 'restarting'].includes(lane.status)) };
    },
    async restartUnhealthy() {
      if (closed) throw unavailable('The task server is closing.');
      const restarted = [];
      // Inspect only existing lanes. Sleeping and never-created lanes stay asleep.
      for (const [name, lane] of [['foreground', foreground], ['death', death], ['prediction', prediction], ['duo', duo], ['planning', planning]]) {
        if (lane && await lane.restartUnhealthy()) restarted.push(name);
      }
      if (restarted.length) unlockResults.clear();
      return { restarted, worker: scheduler.getHealth() };
    },
    getDiagnostics: () => ({ ...foreground.getDiagnostics(), planningLane: planning?.getDiagnostics(), planningBaselines: { entries: planningBaselines.size, bytes: [...planningBaselines.values()].reduce((n, b) => n + b.byteLength, 0), byteLimit: PLANNING_BASELINE_BYTES }, unlockReuse: unlockResults.getDiagnostics(), deathLane: death?.getDiagnostics() ?? {
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
        closed = true; listeners.clear(); residencyListeners.clear(); unlockResults.clear(); planningBaselines.clear();
        closePromise = Promise.all([foreground.close(timeoutMs), death?.close(timeoutMs), prediction?.close(timeoutMs), duo?.close(timeoutMs), planning?.close(timeoutMs)]).then(() => {});
      }
      return closePromise;
    },
  };
  return scheduler;
}

/** One worker, bounded snapshots, and a bounded lifetime restart budget. */
async function createWorkerLane({ workerData, workerFactory = nativeWorker, includeReadyCatalogue = true, onCreated, onEvaluation, onSleep,
  maxQueue = 8, deadlineMs = 30000, startupDeadlineMs = 30000, maxRestarts = 3, backoffMs = 250, maxBackoffMs = 5000, cacheLimit = 8,
  cacheByteLimit = 128 * 1024 * 1024, maxPrewarmQueue = 256, strictRevision = false, shareSnapshots = false, duoResults = false,
  idleMs = Number(process.env.RS3_WORKER_IDLE_MS ?? 600000), idleClock = { now: () => performance.now(), setTimeout, clearTimeout }, retainActivePrediction = false,
  stuckMs = 120000, signal,
} = {}) {
  for (const [name, value] of Object.entries({ maxQueue, deadlineMs, startupDeadlineMs, backoffMs, maxBackoffMs, cacheLimit })) positive(value, name);
  positive(maxRestarts, 'maxRestarts', 0);
  positive(idleMs, 'idleMs');
  positive(stuckMs, 'stuckMs');
  let worker, generation = 0, sequence = 0, active, closed = false, restartTimer, startupTimer, initialResolve, initialReject, closePromise, idleTimer, prewarmSignal, prewarmAbort, latestRevision = -1;
  let status = 'starting', restarts = 0, failures = 0, nextRetryAt = null, compileMs = 0, lastFailure = null;
  const queue = [], warmQueue = [], sentSnapshots = new Map(), pending = new Map(), cache = new Map(), terminating = new Set(), listeners = new Set();
  const warmCounts = { queued: 0, completed: 0, cancelled: 0, skipped: 0 };
  const counts = { requested: 0, coalesced: 0, cacheHits: 0, completed: 0, errors: 0, expired: 0, cancelled: 0, superseded: 0, rejected: 0, promoted: 0, retired: 0 };
  const timings = {};
  let lastTimingMs = {};
  let sleepTimer, lastRequestAt = idleClock.now(), idleStops = 0;
  let lastProgressAt = idleClock.now(), manualRestart;
  let initialAborted = false;
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
    sleepTimer = idleClock.setTimeout(sleep, Math.min(2147483647, Math.max(0, idleMs - (idleClock.now() - lastRequestAt))));
    sleepTimer?.unref?.();
  }
  function sleep() {
    idleClock.clearTimeout(sleepTimer);
    sleepTimer = undefined;
    if (closed || status !== 'ready') return;
    if (idleClock.now() - lastRequestAt < idleMs) { armSleep(); return; }
    // Idle warming and abandoned work are expendable. Real requests keep their
    // worker until every waiter has received a complete response.
    if (active?.waiters.size || active?.reuseWaiters?.size || queue.length) return;
    scheduler.cancelPrewarm();
    if (active) { clearTimeout(active.timer); active = undefined; }
    clearImmediate(idleTimer); idleTimer = undefined;
    const old = worker; worker = undefined; generation++;
    status = 'sleeping'; idleStops++; sentSnapshots.clear(); cache.clear();
    onSleep?.(); terminate(old); announce();
  }
  function wake() {
    if (closed || status !== 'sleeping') return;
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
  function storeEvaluation(key, revision, type, value) {
    const bytes = value.sandboxJSON ? value.sandboxJSON.length
      + Buffer.byteLength(JSON.stringify({ evaluationMs: value.evaluationMs, timingMs: value.timingMs, resultCache: value.resultCache }))
      : value.playJSON ? (value.resultJSON?.length ?? 0) + (value.duoJSON?.length ?? 0) + (value.duoSidebarJSON?.length ?? 0) + value.playJSON.length
      + Object.values(value.gzipJSONPrefixes ?? {}).reduce((sum, buffer) => sum + buffer.length, 0)
      + Buffer.byteLength(JSON.stringify({ evaluationMs: value.evaluationMs, timingMs: value.timingMs, cancelled: value.cancelled }))
      : Buffer.byteLength(JSON.stringify(value));
    if ((value.playJSON || value.sandboxJSON ? value.cancelled : value.result?.cancelled) || bytes > cacheByteLimit) return false;
    cache.delete(key); cache.set(key, { value, bytes, revision, type });
    while (cache.size > cacheLimit || [...cache.values()].reduce((sum, item) => sum + item.bytes, 0) > cacheByteLimit) cache.delete(cache.keys().next().value);
    return cache.has(key);
  }
  function terminate(target) {
    if (!target) return;
    target.unref?.();
    const operation = Promise.resolve().then(() => target.terminate()).catch(() => {}).finally(() => { terminating.delete(operation); announce(); });
    terminating.add(operation);
  }
  function settle(entry, error, value) {
    if (active !== entry) clearTimeout(entry.timer);
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    const position = queue.indexOf(entry);
    if (position >= 0) queue.splice(position, 1);
    const warmPosition = warmQueue.indexOf(entry);
    if (warmPosition >= 0) warmQueue.splice(warmPosition, 1);
    if (entry.warm && !error) warmCounts.completed++;
    entry.state = undefined;
    entry.predictionState = undefined;
    entry.stateInput = undefined;
    for (const waiter of entry.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      if (error) waiter.reject(error); else waiter.resolve(evaluationWith(value, { hit: waiter.hit }));
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
  function cancel(entry, error) {
    if (active === entry && worker && !entry.reuseRevision) {
      if (entry.cancellation) Atomics.store(new Int32Array(entry.cancellation), 0, 1);
      try { worker.postMessage({ id: entry.id, type: 'cancel' }); } catch { failure('worker-send'); }
    }
    settle(entry, error);
  }
  function retire() {
    if (active) {
      clearTimeout(active.timer); active.reuseRevision = undefined;
      cancel(active, superseded()); active = undefined;
    }
    clearTimeout(startupTimer); clearTimeout(restartTimer); restartTimer = undefined;
    idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
    clearImmediate(idleTimer); idleTimer = undefined;
    const old = worker; worker = undefined; generation++;
    status = 'sleeping'; counts.retired++; sentSnapshots.clear();
    // Idle sleep clears caches; retirement deliberately does not call onSleep.
    // wake() already waits for termination before allocating a replacement.
    terminate(old); announce(); return true;
  }
  function failure(kind) {
    if (closed || status === 'restarting' || status === 'restart-required') return;
    failures++; lastFailure = { kind, at: new Date().toISOString() };
    clearTimeout(startupTimer);
    idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
    const old = worker; worker = undefined; generation++; terminate(old);
    if (active) { clearTimeout(active.timer); counts.errors++; settle(active, unavailable('Task engine interrupted. It is recovering; retry shortly.')); active = undefined; }
    if (restarts >= maxRestarts) {
      status = 'restart-required'; nextRetryAt = null;
      const error = unavailable('Task engine needs a server restart. Saves remain available.');
      for (const entry of [...queue, ...warmQueue]) settle(entry, error);
      initialReject(error);
      announce();
      return;
    }
    status = 'restarting';
    const delay = Math.min(maxBackoffMs, backoffMs * 2 ** restarts);
    restarts++; nextRetryAt = new Date(Date.now() + delay).toISOString();
    announce();
    restartTimer = setTimeout(launch, delay);
  }
  function pump() {
    if (closed || status !== 'ready' || active) return;
    if (!queue.length && idleClock.now() - lastRequestAt >= idleMs) { sleep(); return; }
    if (!queue.length) {
      if (!warmQueue.length || idleTimer) return;
      idleTimer = setImmediate(() => { idleTimer = undefined; dispatch(queue.shift() ?? warmQueue.shift()); });
      return;
    }
    const entry = queue.shift();
    dispatch(entry);
  }
  function deadline(entry) {
    entry.timer = setTimeout(() => {
      counts.expired++; settle(entry, Object.assign(new Error('Task calculation deadline exceeded. Retry shortly.'), { status: 504 }));
      if (active === entry) failure('calculation-deadline'); else pump();
    }, deadlineMs);
  }
  function dispatch(entry) {
    if (closed || status !== 'ready' || active) { if (entry) (entry.warm ? warmQueue : queue).unshift(entry); return; }
    if (!entry) return;
    active = entry; entry.startedAt = idleClock.now(); entry.id = ++sequence;
    entry.cancellation = new SharedArrayBuffer(4);
    entry.sourceRevision = entry.state.revision;
    entry.planningKey = entry.type === 'evaluate' && typeof entry.input === 'string' ? JSON.stringify([entry.memberId, predictionInput(entry.state, entry.input)]) : undefined;
    if (entry.type === 'predict') {
      const { rules, taskRules, members, legacy } = entry.state;
      entry.predictionState = { rules, taskRules, members: members?.map(({ id, taskRules, sourceMapId }) => ({ id, taskRules, sourceMapId })),
        legacy: { maps: Object.fromEntries((members ?? []).filter(member => member.sourceMapId !== undefined)
          .map(member => [member.sourceMapId, { rules: legacy?.maps?.[member.sourceMapId]?.rules }])) } };
    }
    if (!entry.timer) deadline(entry);
    // Coalesced display revisions can update entry.revision while the captured
    // bytes retain their original revision, so the key names that revision.
    // Both LRUs key only its task input: after a display-only save the worker
    // rebinds its equivalent state instead of receiving it again. Predictions
    // read roll bookkeeping for reuse priority, and without a fingerprint only
    // the revision proves equivalence.
    const snapshotInput = entry.type === 'prepare-rules' ? undefined : entry.stateInput ? entry.stateInput.inputKey
      : !shareSnapshots ? undefined : entry.input === undefined ? JSON.stringify([entry.state.revision, predictionInput(entry.state)])
      : predictionInput(entry.state, [entry.input, entry.state.members?.map(member => [member.selected, member.pendingRoll])]);
    const snapshotKey = snapshotInput === undefined ? undefined : JSON.stringify([entry.state.revision, snapshotInput]);
    // Area checks read member preferences, which task inputs exclude, so they
    // reference only a state parsed from their own captured revision.
    const sent = sentSnapshots.get(snapshotInput);
    const sentKind = entry.type === 'area-check' && sent?.revision !== entry.state.revision ? undefined : sent?.kind;
    const fresh = entry.stateInput ? sentKind !== 'json-shared-v1' : !sentKind;
    const state = entry.stateInput || !fresh ? undefined : entry.state;
    const serialized = entry.stateInput ? { stateTransport: 'json-shared-v1', stateRevision: entry.state.revision,
      stateMemberIds: entry.state.members.map(member => member.id), stateJSONBytes: entry.stateInput.stateJSON.byteLength,
      ...(fresh ? { stateJSON: entry.stateInput.stateJSON } : {}) } : {};
    entry.snapshotKey = snapshotKey;
    try { worker.postMessage({ id: entry.id, type: entry.type, reportProgress: true, state, snapshotKey, input: entry.input, memberId: entry.memberId, chunkId: entry.chunkId, chunkIds: entry.chunkIds, cancellation: entry.cancellation,
      ...(entry.type === 'predict' ? { predictionProgress: true } : {}), ...serialized,
      ...(entry.type === 'evaluate' ? { resultTransport: 'json-shared-v1', resultView: entry.resultView, planningBaseline: true,
        ...(duoResults && entry.resultView === 'play-v1' ? { duoProjection: true } : {}),
        ...(entry.duoSidebarProjection ? { duoSidebarProjection: true } : {}) }
        : entry.type === 'sandbox' ? { resultTransport: 'json-shared-v1' } : {}) });
      if (snapshotKey) { sentSnapshots.delete(snapshotInput); sentSnapshots.set(snapshotInput, fresh ? { kind: entry.stateInput ? 'json-shared-v1' : 'object', revision: entry.state.revision } : sent); while (sentSnapshots.size > STATE_SNAPSHOT_LIMIT) sentSnapshots.delete(sentSnapshots.keys().next().value); }
    }
    catch { failure('worker-send'); }
    // The worker now owns its structured clone; do not retain another snapshot.
    entry.state = undefined;
    entry.stateInput = undefined;
  }
  function launch() {
    if (closed) return;
    status = 'starting'; nextRetryAt = null;
    lastProgressAt = idleClock.now();
    const ownGeneration = ++generation;
    sentSnapshots.clear();
    for (const [key, value] of cache) if (value.type === 'prepare-rules') cache.delete(key);
    // Custom factories retain their exact workerData contract. Reapply on every wake/restart.
    try { worker = workerFactory(workerFactory === nativeWorker ? nativeWorkerInput(workerData, includeReadyCatalogue) : workerData); }
    catch { failure('worker-start'); return; }
    startupTimer = setTimeout(() => failure('startup-deadline'), startupDeadlineMs);
    worker.on('error', () => { if (ownGeneration === generation) failure('worker-error'); });
    worker.on('exit', () => { if (ownGeneration === generation && !closed) failure('worker-exit'); });
    worker.on('message', message => {
      if (ownGeneration !== generation || closed) return;
      if (message.type === 'ready') {
        if (workerData?.datasetDigest && (message.datasetDigest !== undefined || workerFactory === nativeWorker)
          && message.datasetDigest !== workerData.datasetDigest) { failure('dataset-mismatch'); return; }
        clearTimeout(startupTimer); status = 'ready';
        signal?.removeEventListener('abort', abortInitial);
        lastProgressAt = idleClock.now();
        compileMs = Number.isFinite(message.compileMs) ? message.compileMs : 0;
        initialResolve(message); announce(); armSleep(); pump(); return;
      }
      if (!active || message.id !== active.id) return;
      lastProgressAt = idleClock.now();
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
          active.preparedReuse = message.unlockReuse;
          onEvaluation?.(message, active);
          if (active.reuseRevision) settleReuse(active, null, message.unlockReuse, true);
        }
        return;
      }
      const entry = active; active = undefined; clearTimeout(entry.timer);
      if (entry.waiters.size || entry.reuseWaiters?.size) lastRequestAt = idleClock.now();
      recordTimings(message.timingMs ?? { totalMs: message.evaluationMs });
      if (message.error) {
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
        if (!entry.discarded && (entry.waiters.size || entry.warm)) {
          onEvaluation?.(message, entry);
          storeEvaluation(entry.key, entry.revision, entry.type, value);
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
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    noteInteractiveUse: touch,
    confirmSavedPrediction(taskInputKey, revision) {
      if (active?.reuseRevision !== revision || active.preparedReuse?.taskInputKey !== taskInputKey) return false;
      active.confirmedTaskInputKey = taskInputKey; return true;
    },
    releaseSavedPrediction(revision) {
      // A partial response may detach its follower before signature validation.
      // Race completion must also release that unconfirmed producer.
      const entry = active;
      if (!entry || entry.reuseRevision !== revision || entry.reuseWaiters?.size || entry.waiters.size
        || entry.warm || entry.confirmedTaskInputKey) return false;
      entry.reuseRevision = undefined; cancel(entry, superseded()); return true;
    },
    followSavedPrediction(memberId, revision, signal) {
      const entry = active;
      if (!entry || entry.reuseRevision !== revision || closed || signal?.aborted) return;
      touch();
      if (entry.preparedReuse?.memberId === memberId) return Promise.resolve(entry.preparedReuse);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, memberId };
        entry.reuseWaiters ??= new Set();
        waiter.abort = () => {
          entry.reuseWaiters.delete(waiter); signal.removeEventListener('abort', waiter.abort);
          reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
          if (active === entry) scheduler.releaseSavedPrediction(revision);
          armSleep();
        };
        entry.reuseWaiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
      });
    },
    // Internal cross-lane access preserves ordinary cache hit accounting and LRU.
    invalidatePrediction(key) {
      if (cache.get(key)?.type !== 'predict') return false;
      return cache.delete(key);
    },
    peekPrediction(key) {
      if (closed) return;
      const entry = cache.get(key);
      return entry?.type === 'predict' ? entry.value.result : undefined;
    },
    cachedEvaluation(key, resultView) {
      if (closed || status === 'restart-required') return;
      const exact = JSON.stringify([resultView, key]), full = JSON.stringify(['full', key]);
      const cacheKey = cache.has(exact) ? exact : resultView === 'play-v1' && cache.has(full) && cache.get(full).value.playJSON ? full : undefined;
      if (!cacheKey) return;
      touch();
      counts.requested++; counts.cacheHits++;
      const entry = cache.get(cacheKey); cache.delete(cacheKey); cache.set(cacheKey, entry);
      return evaluationWith(cacheKey === exact ? entry.value : cachedPlayValue(entry.value), { hit: true });
    },
    admitPlayEvaluation(key, revision, value) {
      if (closed || status === 'restart-required' || status === 'sleeping' || value.cancelled || !Buffer.isBuffer(value.playJSON)) return false;
      touch();
      const stored = storeEvaluation(JSON.stringify(['play-v1', key]), revision, 'evaluate', cachedPlayValue(value));
      if (stored) counts.promoted++;
      return stored;
    },
    evaluate(state, memberId, type, chunkId, key, input, signal, chunkIds = [], resultView = 'full', stateInput, duoSidebarProjection = false) {
      counts.requested++;
      if (stateInput && !validStateInput(state, input, stateInput, type)) return Promise.reject(new TypeError('Invalid serialized task state input.'));
      if (type === 'evaluate') {
        if (!['full', 'play-v1'].includes(resultView)) return Promise.reject(new TypeError('Unknown task result view.'));
        key = JSON.stringify([resultView, key]);
      }
      if (closed || status === 'restart-required') return Promise.reject(unavailable(closed ? 'The task server is closing.' : 'Task engine needs a server restart. Saves remain available.'));
      if (signal?.aborted) return Promise.reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
      touch();
      scheduler.supersede(state.revision, input, memberId);
      if (strictRevision && state.revision < latestRevision) return Promise.reject(superseded());
      if (cache.has(key)) {
        counts.cacheHits++;
        const value = cache.get(key); cache.delete(key); cache.set(key, value);
        return Promise.resolve(evaluationWith(value.value, { hit: true }));
      }
      let entry = pending.get(key), hit = !!entry;
      if (entry) {
        counts.coalesced++; entry.revision = Math.max(entry.revision, state.revision);
        if (entry.purpose === 'ranking') {
          entry.purpose = undefined;
          if (entry.warm) { entry.warm = false; warmCounts.cancelled++; }
        }
        // Queued requests can add the projection before dispatch. Already active
        // normal requests keep their ordinary payload and callers fall back to it.
        entry.duoSidebarProjection ||= duoSidebarProjection;
        const position = warmQueue.indexOf(entry);
        if (position >= 0) {
          if (queue.length >= maxQueue) { counts.rejected++; return Promise.reject(Object.assign(new Error('Task calculation queue is full. Retry shortly.'), { status: 429 })); }
          warmQueue.splice(position, 1); queue.unshift(entry); deadline(entry);
        }
      }
      else {
        if (queue.length >= maxQueue && (active || status !== 'ready')) {
          counts.rejected++;
          return Promise.reject(Object.assign(new Error('Task calculation queue is full. Retry shortly.'), { status: 429 }));
        }
        entry = { key, input, state, stateInput, memberId, type, chunkId, chunkIds, resultView, duoSidebarProjection, revision: state.revision, queuedAt: idleClock.now(), waiters: new Set() };
        pending.set(key, entry);
        if (type === 'predict' || type === 'evaluate' && resultView === 'play-v1') queue.unshift(entry); else queue.push(entry);
        deadline(entry);
      }
      const promise = new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, hit };
        waiter.abort = () => {
          if (!entry.waiters.delete(waiter)) return;
          signal.removeEventListener('abort', waiter.abort);
          reject(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
          if (!entry.waiters.size && !entry.warm) { counts.cancelled++; cancel(entry, unavailable('Calculation abandoned by its requesters.')); }
          armSleep();
        };
        entry.waiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
      });
      wake(); pump(); return promise;
    },
    supersede(revision, input, memberId) {
      if (strictRevision && revision > latestRevision) {
        latestRevision = revision;
        if (active?.reuseRevision) {
          // A saved follower can outlive the obsolete Preview's pending entry.
          // A second save must cancel that detached producer as well.
          active.reuseRevision = undefined; counts.superseded++; cancel(active, superseded());
        }
        if (retainActivePrediction && active?.type === 'predict' && active.revision === revision - 1 && !active.discarded) {
          active.reuseRevision = revision;
          // Settle obsolete Preview waiters below, while allowing the already
          // running synchronous calculation to publish only to saved followers.
          if (active.warm) { active.warm = false; warmCounts.cancelled++; }
        }
        scheduler.cancelPrewarm({ keepActive: true });
        for (const [key, value] of cache) if (value.revision < revision) cache.delete(key);
        sentSnapshots.clear();
        try { worker?.postMessage({ type: 'supersede', revision }); } catch { failure('worker-send'); }
      }
      for (const entry of [...pending.values()]) {
        if (entry.revision >= revision || (memberId && entry.memberId !== memberId) || (entry.type === 'evaluate' && entry.input === input)) continue;
        counts.superseded++;
        cancel(entry, Object.assign(new Error('Calculation superseded by a newer save. Request the current tasks.'), { status: 409 }));
      }
    },
    supersedeDisplay(revision) {
      latestRevision = Math.max(latestRevision, revision);
      for (const entry of new Set([...pending.values(), ...(active ? [active] : [])])) {
        if (entry.reuseRevision) {
          entry.reuseRevision = Math.max(entry.reuseRevision, revision);
        } else {
          entry.revision = Math.max(entry.revision, revision);
          if (entry.preparedReuse) entry.preparedReuse = { ...entry.preparedReuse, sourceRevision: entry.revision };
        }
      }
      for (const value of cache.values()) value.revision = Math.max(value.revision, revision);
    },
    retireObsolete(revision) {
      if (closed || status === 'restart-required') return false;
      const cold = ['starting', 'waking', 'restarting'].includes(status);
      const obsolete = active && active.revision < revision;
      const usefulPrediction = status === 'ready' && retainActivePrediction && active?.type === 'predict'
        && active.reuseRevision === revision;
      if (!cold && (!obsolete || usefulPrediction)) return false;
      // A synchronous obsolete side calculation cannot read its cancel flag
      // until it finishes. Retire its worker at the actual save boundary, while
      // keeping reusable projections and valid cached responses independent.
      for (const entry of [...pending.values()]) if (entry.revision < revision) {
        counts.superseded++; cancel(entry, superseded());
      }
      return retire();
    },
    // Display-only saves keep task inputs, so nothing is obsolete. While
    // someone edits notes, an unrequested calculation still yields its process
    // as a gameplay save would; requested work and an idle worker stay. A
    // cancelled warm-up no longer counts as warm but runs on: a process
    // worker reads its cancel message only after the synchronous work.
    retireWarm() {
      if (closed || status !== 'ready' || !active || active.waiters.size || active.reuseWaiters?.size) return false;
      for (const entry of [...pending.values()]) if (entry.warm && !entry.waiters.size) {
        entry.warm = false; warmCounts.cancelled++; cancel(entry, unavailable('Background prediction cancelled.'));
      }
      return retire();
    },
    canPrewarm() {
      return !closed && ['starting', 'ready'].includes(status) && idleClock.now() - lastRequestAt < idleMs;
    },
    prewarmTasks(state, input, memberIds, resultView, stateInput) {
      if (!scheduler.canPrewarm() || state.revision < latestRevision) return { queued: 0 };
      let queued = 0, snapshot;
      for (const memberId of new Set(memberIds)) {
        const key = JSON.stringify([resultView, JSON.stringify([input, memberId, 'evaluate', undefined, undefined])]);
        if (cache.has(key) || pending.has(key) || warmQueue.length >= maxPrewarmQueue) { warmCounts.skipped++; continue; }
        // A captured serialized snapshot is already immutable. Object callers
        // share one defensive clone across this bounded batch.
        snapshot ??= stateInput ? state : structuredClone(state);
        const entry = { key, input, state: snapshot, stateInput, memberId, type: 'evaluate', resultView,
          revision: state.revision, queuedAt: idleClock.now(), waiters: new Set(), warm: true };
        pending.set(key, entry); warmQueue.push(entry); queued++; warmCounts.queued++;
      }
      pump(); return { queued };
    },
    prewarm(state, input, groups, signal, predictionRevision = state.revision) {
      if (closed || signal?.aborted || status === 'restart-required' || state.revision < latestRevision
        || idleClock.now() - lastRequestAt >= idleMs) return { queued: 0 };
      scheduler.supersede(state.revision, input);
      const desired = new Map(), fingerprint = predictionInput(state, input);
      for (const group of groups) for (const chunkId of group.chunkIds) {
        const key = JSON.stringify([predictionRevision, group.memberId, String(chunkId), fingerprint]);
        if (desired.has(key)) continue;
        // Finished reviewed choices do not consume queue slots ahead of missing
        // pool candidates when a visible comparison refills the bounded batch.
        if (cache.has(key)) { warmCounts.skipped++; continue; }
        if (desired.size < maxPrewarmQueue) desired.set(key, { memberId: group.memberId, chunkId: String(chunkId), purpose: group.purpose });
        else warmCounts.skipped++;
      }
      prewarmSignal?.removeEventListener('abort', prewarmAbort);
      for (const entry of [...pending.values()]) if (entry.warm && entry.type === 'predict' && !desired.has(entry.key)) {
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size) cancel(entry, unavailable('Background prediction cancelled.'));
      }
      let queued = 0, snapshot;
      for (const [key, { memberId, chunkId, purpose }] of desired) {
        const existing = pending.get(key);
        if (existing?.purpose === 'ranking' && purpose !== 'ranking') existing.purpose = purpose;
        if (cache.has(key) || pending.has(key) || warmQueue.length >= maxPrewarmQueue) { warmCounts.skipped++; continue; }
        snapshot ??= structuredClone(state);
        const entry = { key, input, state: snapshot, memberId, type: 'predict', chunkId, revision: state.revision,
          queuedAt: idleClock.now(), waiters: new Set(), warm: true, purpose };
        pending.set(key, entry); warmQueue.push(entry); queued++; warmCounts.queued++;
      }
      prewarmSignal = signal; prewarmAbort = () => scheduler.cancelPrewarm();
      signal?.addEventListener('abort', prewarmAbort, { once: true });
      if (queued) wake();
      pump(); return { queued };
    },
    cancelPrewarm({ keepActive = false, keepActiveKey } = {}) {
      prewarmSignal?.removeEventListener('abort', prewarmAbort); prewarmSignal = undefined; prewarmAbort = undefined;
      for (const entry of [...pending.values()]) if (entry.warm) {
        if (active === entry && (keepActive || keepActiveKey === entry.key)) continue;
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size) cancel(entry, unavailable('Background prediction cancelled.'));
      }
    },
    cancelRankingPrewarm(keepMemberIds = new Set()) {
      for (const entry of [...pending.values()]) if (entry.warm && entry.purpose === 'ranking' && !keepMemberIds.has(entry.memberId)) {
        entry.warm = false; warmCounts.cancelled++;
        if (!entry.waiters.size) cancel(entry, unavailable('Pool ranking cancelled.'));
      }
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
        clearTimeout(restartTimer); clearTimeout(startupTimer); clearImmediate(idleTimer); idleTimer = undefined;
        idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
        status = 'restarting'; generation++;
        scheduler.cancelPrewarm();
        const error = unavailable('Task calculation restarted. Retry shortly.');
        for (const entry of [...pending.values()]) settle(entry, error);
        if (active) { clearTimeout(active.timer); settle(active, error); active = undefined; }
        sentSnapshots.clear(); cache.clear(); onSleep?.();
        const old = worker; worker = undefined; terminate(old); announce();
        // Finish retirement before allocating replacement definitions.
        await Promise.allSettled([...terminating]);
        if (!closed) { restarts = 0; launch(); }
      })();
      try { await manualRestart; return true; } finally { manualRestart = undefined; }
    },
    getDiagnostics() {
      return { worker: scheduler.getHealth(), queue: { depth: queue.length, active: active ? 1 : 0, limit: maxQueue, deadlineMs,
        oldestWaitMs: queue.length ? idleClock.now() - queue[0].queuedAt : 0 }, counts: { ...counts },
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
        closed = true; status = 'closed'; generation++;
        initialReject(unavailable('The task server is closing.'));
        announce(); listeners.clear();
        clearTimeout(restartTimer); clearTimeout(startupTimer);
        idleClock.clearTimeout(sleepTimer); sleepTimer = undefined;
        clearImmediate(idleTimer); scheduler.cancelPrewarm(); sentSnapshots.clear();
        for (const entry of [...pending.values()]) settle(entry, unavailable('The task server is closing.'));
        if (active) { clearTimeout(active.timer); settleReuse(active, unavailable('The task server is closing.')); active = undefined; }
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
