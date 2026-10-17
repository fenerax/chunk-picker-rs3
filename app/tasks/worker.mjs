import { prepareWorkerDefinitions } from '../dataset-pipeline.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { createTaskEngine, taskId, plainLabel } from './engine.mjs';
import { legacyTaskId } from './identity.mjs';
import { applySkillGuideTasks } from '../data/skill-guides.mjs';
import { prepareChunkPrediction } from '../core/planning.mjs';
import { createRuleRegistry } from '../core/rules.mjs';
import { configureAutomaticTransport } from '../core/automatic-transport.mjs';
import { SANDBOX_FORMAT, normalizeSandboxRequest, sandboxTaskCatalogue, applySandboxChanges, sandboxDelta, compactSandboxPrediction } from '../sandbox.mjs';
import { selectPresentedTasks, buildEquipmentCatalogue } from './presentation.mjs';
import { evaluateEquipment, buildCurrentBiS } from './equipment.mjs';
import { buildActivityInfo } from './activity.mjs';
import { createCollectionEngine, selectCollectionGoals } from './collection.mjs';
import { estimateChunk } from './time-estimates.mjs';
import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
import { projectPlayResult, projectPlayTask } from '../play-view.mjs';
import { projectDuoSidebarResult } from '../duo-play-view.mjs';
import { buildChunkPlanningIndex } from './chunk-planning-index.mjs';
import { projectMapTaskLocations } from './map-task-locations.mjs';
import { createTaskReuseFingerprint } from './unlock-reuse.mjs';
import { analyzeAreaCheck, normalizeAreaCheckRequest } from './area-check.mjs';
import { constants as zlibConstants, crc32, gzipSync } from 'node:zlib';

// Definitions compile once in this isolated worker. Evaluation never runs on
// the HTTP/save event loop and receives a structured-cloned state snapshot.
const rawDefinitions = workerData.definitionBytes === undefined ? workerData.definitions
  : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(workerData.definitionBytes));
if (workerData.datasetDigest && workerData.datasetDigest !== selectedDataset.digest) throw new Error('Worker dataset digest mismatch.');
const definitions = prepareWorkerDefinitions(rawDefinitions, selectedDataset, workerData.preparedDatasetStages, workerData.datasetOptions);
const mapLocationResults = new WeakMap();
function mapPlayResult(result) {
  let locations = mapLocationResults.get(result);
  if (!locations) {
    locations = projectMapTaskLocations(definitions, result, workerData.world);
    mapLocationResults.set(result, locations);
  }
  return { ...projectPlayResult(result), taskLocations: locations };
}
const compileStarted = performance.now();
const engineOptions = { dataset: selectedDataset, ...workerData.datasetOptions, skillGuideCatalogue: workerData.skillGuideCatalogue };
const engine = createTaskEngine(definitions, engineOptions);
// Structured cloning removes the world's non-enumerable definitions/provider.
// Worker roll predictions use the same compiled baseline as task evaluation.
if (workerData.world) configureAutomaticTransport(workerData.world, { definitions, engine });
const ordinaryTaskIds = new Set(engine.catalogue.map(row => row.id));
// Register every reviewed identity without eagerly compiling an enabled engine.
// Saved completion is valid while task switches still default off.
const guideDefinitions = applySkillGuideTasks(definitions, { catalogue: workerData.skillGuideCatalogue });
const generatedTaskCatalogue = Object.entries(guideDefinitions.challenges).flatMap(([category, entries]) =>
  Object.entries(entries).flatMap(([rawLabel, record]) => {
    const id = taskId(category, rawLabel, record);
    return ordinaryTaskIds.has(id) ? [] : [{ id, label: plainLabel(rawLabel), category, rawLabel,
      kind: 'task', aliases: [legacyTaskId(category, rawLabel)] }];
  }));
const collectionEngine = createCollectionEngine(definitions, { dataset: selectedDataset });
const registry = createRuleRegistry(workerData.extraRules ?? []);
const equipmentCatalogue = buildEquipmentCatalogue(definitions), equipmentNames = Object.keys(definitions.equipment ?? {});
const equipmentById = new Map(equipmentCatalogue.map((row, index) => [row.id, equipmentNames[index]]));
const houseStorageCatalogue = engine.catalogue.filter(row => row.kind === 'house-storage').map(({ slotId, ...identity }) => identity);
const derivedIds = new Set([...equipmentCatalogue, ...collectionEngine.catalogue, ...houseStorageCatalogue, ...generatedTaskCatalogue].map(row => row.id));
const sandboxCatalogue = [...engine.catalogue, ...equipmentCatalogue, ...collectionEngine.catalogue, ...houseStorageCatalogue, ...generatedTaskCatalogue];
const sandboxTaskIndexes = new WeakMap();
const progressRequests = new WeakMap();
function timed(timingMs, stage, operation) {
  const started = performance.now();
  try { return operation(); }
  finally {
    if (timingMs) timingMs[stage] = (timingMs[stage] ?? 0) + performance.now() - started;
    const progress = progressRequests.get(timingMs), time = performance.now();
    if (progress && time - progress.at >= 1000) {
      progress.at = time; parentPort.postMessage({ type: 'progress', id: progress.id });
    }
  }
}
function evaluateCore(state, memberId, timingMs) {
  const member = state.members.find(owner => owner.id === memberId), savedIds = [...new Set([...Object.keys(member?.taskStatus ?? {}), ...member?.completedTasks ?? []])];
  const result = timed(timingMs, 'engineMs', () => engine.evaluate(state, memberId, { ownItemQueries: savedIds.filter(id => equipmentById.has(id)).map(id => equipmentById.get(id)) }));
  const collection = timed(timingMs, 'collectionMs', () => collectionEngine.evaluate(state, memberId, result, { obligationQueries: savedIds }));
  result.tasks.push(...collection.tasks);
  result.collectionPlanning = { completionGroups: collection.completionGroups, obligationIds: collection.obligationIds, diagnostics: collection.diagnostics, coverage: collection.coverage };
  result.diagnostics.push(...collection.diagnostics);
  result.metrics.availableCount = result.tasks.filter(task => task.status === 'available' && task.obligation !== false).length;
  return result;
}
const viewContexts = new WeakMap();
function appendViews(result, timingMs) {
  const context = viewContexts.get(result);
  if (!context) return result;
  const { equipment, state, memberId } = context;
  const personalResult = { ...result, equipment: result.equipment.filter(row => row.obligation !== false) };
  result.currentBiS = timed(timingMs, 'currentBiSMs', () => buildCurrentBiS(result, equipment, state, memberId, definitions, personalResult));
  result.activityInfo = timed(timingMs, 'activityMs', () => buildActivityInfo(result, state, memberId, definitions));
  viewContexts.delete(result);
  return result;
}
function evaluateFull(state, memberId, { includeViews = true, timingMs } = {}) {
  const result = evaluateCore(state, memberId, timingMs);
  const equipment = timed(timingMs, 'equipmentMs', () => evaluateEquipment(result, state, memberId, definitions));
  const member = state.members.find(owner => owner.id === memberId);
  const legacyRules = hasGameplayMigration(state, member) ? {} : Object.fromEntries(Object.entries(state.legacy?.maps?.[member.sourceMapId]?.rules ?? {}).map(([key, value]) => [decodeLegacyText(key), value]));
  const equipmentRules = { ...legacyRules, ...state.taskRules, ...member.taskRules };
  let dutyEquipment = equipment;
  if ([false, 'false', 0].includes(equipmentRules['Show Best in Slot Tasks'])) {
    // The global display switch hides goals; it does not waive their grind.
    // Only reveal it for duty selection, retaining BIS and all actual gates.
    const dutyState = { ...state, members: state.members.map(owner => owner.id === memberId
      ? { ...owner, taskRules: { ...owner.taskRules, 'Show Best in Slot Tasks': true } } : owner) };
    dutyEquipment = timed(timingMs, 'equipmentMs', () => evaluateEquipment(result, dutyState, memberId, definitions));
  }
  result.presentation = timed(timingMs, 'presentationMs', () => selectCollectionGoals(selectPresentedTasks({ ...result, tasks: [...result.tasks, ...equipment.tasks] }, state, memberId, definitions), state, memberId));
  result.presentation.alternatives = { ...result.presentation.alternatives, ...equipment.alternatives };
  const visibleEquipmentIds = new Set(equipment.catalogue.map(task => task.id));
  const hiddenDuties = dutyEquipment.catalogue.filter(task => !visibleEquipmentIds.has(task.id)).map(task => ({ ...task,
    hidden: true, hiddenReasons: [...(task.hiddenReasons ?? []), 'Hidden by the Show Best in Slot Tasks display setting.'] }));
  result.tasks = [...new Map([...result.tasks, ...equipment.catalogue, ...hiddenDuties].map(task => [task.id, task])).values()];
  const present = new Set(result.tasks.map(task => task.id));
  // Saved checks/backlogs remain facts, but a missing known derived row
  // must not be resurrected by the browser's unresolved-import fallback.
  const ownSaved = new Set(result.collectionPlanning.obligationIds), ownItems = new Set(result.ownItemOrigins);
  const savedIds = new Set([...Object.keys(member.taskStatus ?? {}), ...member.completedTasks ?? []]);
  result.tasks.push(...state.tasks.filter(task => savedIds.has(task.id) && derivedIds.has(task.id) && !present.has(task.id)).map(task => {
    const own = ownSaved.has(task.id) || ownItems.has(equipmentById.get(task.id));
    const detail = own ? 'The defining source is on this member’s own map; current requirements, rules or backlog prevent an active goal.' : 'No defining source on this member’s own reachable map.';
    return { ...task, obligation: own, hidden: !own, hiddenReasons: own ? [] : ['Outside your own reachable map.'], status: 'blocked', explanation: detail, blockers: [{ kind: 'access', detail }], sources: [] };
  }));
  result.equipmentPlanning = { obligationIds: dutyEquipment.tasks.map(task => task.id), loadouts: equipment.loadouts, recommendations: equipment.recommendations, specialist: equipment.specialist, diagnostics: equipment.diagnostics, coverage: equipment.coverage };
  viewContexts.set(result, { equipment, state, memberId });
  if (includeViews) appendViews(result, timingMs);
  result.metrics.availableCount = result.tasks.filter(task => task.status === 'available' && task.obligation !== false).length;
  return result;
}

// Keep two coherent member/revision results. Each retains a complete graph,
// including collections and equipment goals; older revisions can be rebuilt.
// This bound is independent of the four-entry state-transfer protocol below.
const snapshots = new Map();
const stateSnapshots = new Map();
let latestRevision = -1;
function snapshotFor(state, memberId, timingMs, input, includeViews = true) {
  // The scheduler supplies the conservative input fingerprint. Direct worker
  // callers still distinguish effective rules at an unchanged revision.
  const key = JSON.stringify([state.revision, memberId, input ?? null, state.rules, state.taskRules,
    state.members.map(owner => [owner.id, owner.taskRules, state.legacy?.maps?.[owner.sourceMapId]?.rules])]);
  let snapshot = snapshots.get(key), hit = !!snapshot;
  if (!snapshot) {
    // Release the oldest graph before allocating its replacement.
    while (snapshots.size >= 2) snapshots.delete(snapshots.keys().next().value);
    snapshot = { baseline: evaluateFull(state, memberId, { includeViews, timingMs }), includeViews, estimates: new Map() };
  }
  else if (includeViews && !snapshot.includeViews) {
    // Advisory lanes need the complete obligations, but not the separate BiS
    // and activity panels. A later full caller must receive both views.
    appendViews(snapshot.baseline, timingMs);
    snapshot.includeViews = true;
  }
  snapshots.delete(key); snapshots.set(key, snapshot);
  return { snapshot, hit };
}
const taskReuseFingerprint = createTaskReuseFingerprint();
function predictionFor(state, memberId, chunkId, snapshot, timingMs) {
  let evaluations = 0;
  const planningEngine = { ...engine, evaluate: (input, member) => evaluations++ === 0 ? snapshot.baseline : evaluateFull(input, member, { includeViews: false, timingMs }) };
  return timed(timingMs, 'predictionMs', () => {
    snapshot.predict ??= prepareChunkPrediction(state, registry);
    return snapshot.predict(memberId, chunkId, { world: workerData.world, engine: planningEngine });
  });
}
function chunkPlanningFor(snapshot, chunkId) {
  const index = snapshot.planningIndex ??= buildChunkPlanningIndex(definitions, snapshot.baseline, workerData.world);
  return { format: 'chunk-planning-v1', chunkId, rows: [...(index.byLocation.get(String(chunkId))?.values() ?? [])].map(({ task, evidence }) => ({
    task: { ...projectPlayTask(task, { retainHiddenDisplay: true }), ...(task.record?.ClueTier !== undefined ? { record: { ClueTier: task.record.ClueTier } } : {}) }, evidence,
  })), clueLocations: index.clueLocations.get(String(chunkId)) ?? [], access: snapshot.baseline.access };
}
const sandboxSnapshots = new Map();
function sandboxFor(state, memberId, draft, timingMs, input) {
  let taskIndex = sandboxTaskIndexes.get(state);
  if (!taskIndex) { taskIndex = sandboxTaskCatalogue(state, sandboxCatalogue); sandboxTaskIndexes.set(state, taskIndex); }
  const normalized = timed(timingMs, 'sandboxInputMs', () => normalizeSandboxRequest(
    { memberId, baseRevision: state.revision, ...draft }, { state, world: workerData.world, catalogue: sandboxCatalogue, taskIndex }));
  const { snapshot, hit } = snapshotFor(state, memberId, timingMs, input, false);
  // Hypothetical inputs never enter the saved member/revision snapshot cache.
  const empty = !normalized.changes.unlockChunks.length && !normalized.changes.lockChunks.length
    && !normalized.changes.doneTasks.length && !normalized.changes.taskRules;
  const key = JSON.stringify([state.revision, memberId, input, state.rules, state.taskRules,
    state.members.map(owner => [owner.id, owner.taskRules, state.legacy?.maps?.[owner.sourceMapId]?.rules]), normalized.changes]);
  let draftSnapshot = empty ? snapshot : sandboxSnapshots.get(key);
  const hypotheticalHit = !!draftSnapshot;
  if (!draftSnapshot) {
    const hypothetical = applySandboxChanges(state, memberId, normalized.changes, sandboxCatalogue, taskIndex);
    draftSnapshot = { state: hypothetical, baseline: evaluateFull(hypothetical, memberId, { includeViews: false, timingMs }) };
  }
  if (!empty) {
    sandboxSnapshots.delete(key); sandboxSnapshots.set(key, draftSnapshot);
    while (sandboxSnapshots.size > 2) sandboxSnapshots.delete(sandboxSnapshots.keys().next().value);
  }
  const hypothetical = empty ? state : draftSnapshot.state, result = draftSnapshot.baseline;
  const output = { format: SANDBOX_FORMAT, memberId, stateRevision: state.revision, changes: normalized.changes,
    result: draftSnapshot.playResult ??= timed(timingMs, 'sandboxProjectionMs', () => ({ ...mapPlayResult(result), memberId, stateRevision: state.revision })), possibleCount: result.metrics.availableCount,
    delta: draftSnapshot.sandboxDelta ??= timed(timingMs, 'sandboxDeltaMs', () => sandboxDelta(snapshot.baseline, result,
      { beforeState: state, afterState: hypothetical, memberId, registry })), cache: { baselineHit: hit, hypotheticalHit } };
  if (normalized.previewChunkId !== undefined) output.prediction = compactSandboxPrediction(
    predictionFor(hypothetical, memberId, normalized.previewChunkId, draftSnapshot, timingMs));
  if (normalized.planningChunkId !== undefined) output.planning = chunkPlanningFor(draftSnapshot, normalized.planningChunkId);
  return output;
}
const yieldToRequests = () => new Promise(resolve => setImmediate(resolve));
async function deathEstimates(state, memberId, chunkIds, timingMs, request, input) {
  const { snapshot, hit } = snapshotFor(state, memberId, timingMs, input, false);
  // A disconnect received during cold baseline work can stop before we pay
  // for the first candidate. Each later synchronous candidate is also bounded
  // by the scheduler's independent death-lane watchdog.
  await yieldToRequests();
  const estimates = [];
  let estimateHits = 0, estimatedCount = 0;
  for (const chunkId of chunkIds) {
    if (request.cancelled || state.revision < latestRevision) break;
    if (snapshot.estimates.has(chunkId)) estimateHits++;
    else {
      const prediction = predictionFor(state, memberId, chunkId, snapshot, timingMs);
      snapshot.estimates.set(chunkId, timed(timingMs, 'deathMs', () => estimateChunk(state, memberId, chunkId, { prediction, baseline: snapshot.baseline })));
      estimatedCount++;
    }
    const estimate = snapshot.estimates.get(chunkId);
    snapshot.estimates.delete(chunkId); snapshot.estimates.set(chunkId, estimate);
    while (snapshot.estimates.size > 256) snapshot.estimates.delete(snapshot.estimates.keys().next().value);
    estimates.push(estimate);
    // A large candidate pool must not delay a newer task/info request until the
    // entire batch finishes. New revisions cancel the remaining old candidates.
    await yieldToRequests();
  }
  return { memberId, stateRevision: state.revision, estimates,
    cancelled: request.cancelled || state.revision < latestRevision || estimates.length !== chunkIds.length,
    cache: { baselineHit: hit, estimateHits, estimatedCount, baselineEvaluations: hit ? 0 : 1, predictionEvaluations: estimatedCount } };
}

const requests = new Map();
const serializedStateSizes = new WeakMap();
function sharedJSON(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const shared = new SharedArrayBuffer(bytes.length);
  Buffer.from(shared).set(bytes);
  return shared;
}
function compressUnlockReuse(value) {
  value.gzipJSONPrefixMetadata = {};
  value.gzipJSONPrefixes = Object.fromEntries(['playJSON', 'duoJSON', 'duoSidebarJSON'].map(key => {
    const prefix = Buffer.from(value[key]).subarray(0, value[key].byteLength - 1);
    value.gzipJSONPrefixMetadata[key] = { crc32: crc32(prefix), rawLength: prefix.length };
    const bytes = gzipSync(prefix, { level: 1, finishFlush: zlibConstants.Z_SYNC_FLUSH });
    const shared = new SharedArrayBuffer(bytes.length); Buffer.from(shared).set(bytes);
    return [key, shared];
  }));
  return value;
}
function serializedState({ stateJSON, stateJSONBytes, stateRevision, stateMemberIds, snapshotKey, input }) {
  if (typeof input !== 'string' || !Number.isSafeInteger(stateRevision) || stateRevision < 0
    || typeof snapshotKey !== 'string' || snapshotKey !== JSON.stringify([stateRevision, input])
    || !Number.isSafeInteger(stateJSONBytes) || stateJSONBytes < 1
    || !Array.isArray(stateMemberIds) || stateMemberIds.length < 1 || !stateMemberIds.every(id => typeof id === 'string' && id.length > 0)
    || new Set(stateMemberIds).size !== stateMemberIds.length) throw new TypeError('Worker serialized state metadata is invalid.');
  let state;
  if (stateJSON !== undefined) {
    if (!(stateJSON instanceof SharedArrayBuffer) || stateJSON.byteLength !== stateJSONBytes) throw new TypeError('Worker serialized state bytes are invalid.');
    try { state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stateJSON)); }
    catch { throw new TypeError('Worker state JSON is invalid.'); }
  } else state = stateSnapshots.get(snapshotKey);
  if (!state) throw new RangeError('Worker state snapshot is missing; resend its full state.');
  if (state.schemaVersion !== 1 || state.revision !== stateRevision || !Array.isArray(state.tasks) || !Array.isArray(state.history)
    || !Array.isArray(state.members) || state.members.length !== stateMemberIds.length
    || state.members.some((member, index) => !member || member.id !== stateMemberIds[index])) throw new TypeError('Worker serialized state does not match its metadata.');
  if (stateJSON === undefined && serializedStateSizes.get(state) !== stateJSONBytes) throw new TypeError('Worker serialized state bytes are invalid.');
  serializedStateSizes.set(state, stateJSONBytes);
  return state;
}
parentPort.on('message', async ({ id, type = 'evaluate', state, memberId, chunkId, chunkIds = [], revision, input, snapshotKey, resultTransport, resultView = 'full', cancellation, predictionProgress = false,
  stateTransport, stateJSON, stateJSONBytes, stateRevision, stateMemberIds, duoProjection = false, duoSidebarProjection = false, reportProgress = false }) => {
  if (type === 'cancel') { if (requests.has(id)) requests.get(id).cancelled = true; return; }
  if (type === 'supersede') { latestRevision = Math.max(latestRevision, revision); return; }
  const started = performance.now();
  // Fixed stage names and durations never expose personal state.
  const timingMs = { engineMs: 0, collectionMs: 0, equipmentMs: 0, presentationMs: 0, currentBiSMs: 0, activityMs: 0, predictionMs: 0, deathMs: 0, totalMs: 0 };
  if (reportProgress) progressRequests.set(timingMs, { id, at: started });
  const request = { cancelled: false };
  const abandoned = () => request.cancelled || cancellation instanceof SharedArrayBuffer && Atomics.load(new Int32Array(cancellation), 0) !== 0;
  requests.set(id, request);
  try {
    if (stateTransport !== undefined || stateJSON !== undefined) {
      if (stateTransport !== 'json-shared-v1' || !['evaluate', 'chunk-planning', 'sandbox', 'area-check'].includes(type) || state !== undefined) throw new TypeError('Worker state transport is invalid.');
      state = serializedState({ stateJSON, stateJSONBytes, stateRevision, stateMemberIds, snapshotKey, input });
    }
    if (snapshotKey !== undefined) {
      if (typeof snapshotKey !== 'string') throw new TypeError('Worker snapshotKey must be a string.');
      state ??= stateSnapshots.get(snapshotKey);
      if (!state) throw new RangeError('Worker state snapshot is missing; resend its full state.');
      stateSnapshots.delete(snapshotKey); stateSnapshots.set(snapshotKey, state);
      while (stateSnapshots.size > 4) stateSnapshots.delete(stateSnapshots.keys().next().value);
    }
    latestRevision = Math.max(latestRevision, state.revision);
    let result, unlockReuse, partnerUnlockReuse;
    if (type === 'prepare-rules') {
      timed(timingMs, 'preparationMs', () => engine.prepare(state.rules));
      result = { prepared: true };
    } else if (type === 'sandbox') result = sandboxFor(state, memberId, chunkId, timingMs, input);
    else if (type === 'area-check') result = timed(timingMs, 'areaCheckMs', () => {
      const { baselineTaskIds, ...requested } = chunkId;
      const draft = normalizeAreaCheckRequest(requested, { state, memberId, world: workerData.world });
      const cached = baselineTaskIds ? undefined : snapshotFor(state, memberId, timingMs, input, false);
      return { ...analyzeAreaCheck(state, memberId, draft, {
        engine: { evaluate: (input, member) => evaluateFull(input, member, { includeViews: false, timingMs }) },
        baseline: cached?.snapshot.baseline, baselineTaskIds, definitions, world: workerData.world,
      }), cache: { baselineHit: !!baselineTaskIds || cached.hit, baselineSource: baselineTaskIds ? 'current-list' : 'worker' } };
    });
    else if (type === 'death-estimates') result = await deathEstimates(state, memberId, chunkIds, timingMs, request, input);
    else {
      const compact = type === 'evaluate' && resultTransport === 'json-shared-v1' && resultView === 'play-v1';
      const { snapshot } = snapshotFor(state, memberId, timingMs, input, type !== 'predict' && type !== 'chunk-planning' && !compact);
      if (type === 'predict') {
        // Let panel closure cancel a completed baseline before starting the
        // separate hypothetical fixed point. Keep a normal final lane response.
        await yieldToRequests();
        if (abandoned()) {
          timingMs.totalMs = performance.now() - started;
          parentPort.postMessage({ id, result: { cancelled: true }, evaluationMs: timingMs.totalMs, timingMs });
          return;
        }
      }
      const prediction = type === 'predict' ? predictionFor(state, memberId, chunkId, snapshot, timingMs) : null;
      if (prediction && !state.members.find(owner => owner.id === memberId).unlocked.includes(chunkId)) {
        // Reuse only this exact hypothetical task input after a durable save.
        // The HTTP scheduler retains bounded compact bytes, not the full graph.
        const play = mapPlayResult(prediction.result);
        const member = state.members.find(owner => owner.id === memberId);
        const duoSidebarJSON = sharedJSON(projectDuoSidebarResult(play, prediction.state, registry, memberId));
        unlockReuse = compressUnlockReuse({ taskInputKey: taskReuseFingerprint(prediction.state), memberId, sourceRevision: state.revision,
          priority: member.pendingRoll.includes(chunkId) ? 2 : member.selected.includes(chunkId) ? 1 : 0,
          playJSON: sharedJSON(play), duoJSON: duoSidebarJSON, duoSidebarJSON });
        // Publish the owner's complete result first. A save during partner work
        // may reuse these exact bytes while the same worker finishes the pair.
        if (predictionProgress) parentPort.postMessage({ id, type: 'prediction-prepared', unlockReuse });
        await yieldToRequests();
        if (!abandoned()) {
          const partner = prediction.state.members.find(owner => owner.id !== memberId);
          if (partner) {
            const peer = evaluateFull(prediction.state, partner.id, { includeViews: false, timingMs });
            const peerPlay = mapPlayResult(peer);
            const peerSidebarJSON = sharedJSON(projectDuoSidebarResult(peerPlay, prediction.state, registry, partner.id));
            partnerUnlockReuse = compressUnlockReuse({ taskInputKey: unlockReuse.taskInputKey, memberId: partner.id, sourceRevision: state.revision,
              priority: unlockReuse.priority, playJSON: sharedJSON(peerPlay), duoJSON: peerSidebarJSON, duoSidebarJSON: peerSidebarJSON });
          }
        }
      }
      result = prediction ? { delta: prediction.delta, coverage: prediction.result.coverage, metrics: prediction.result.metrics }
        : type === 'chunk-planning' ? chunkPlanningFor(snapshot, chunkId) : snapshot.baseline;
    }
    // The HTTP thread can cache and send these immutable bytes without cloning
    // or serializing the full task graph. Direct worker clients keep objects.
    const playResult = type === 'evaluate' && resultTransport === 'json-shared-v1' ? mapPlayResult(result) : undefined;
    // Both group lanes need the owner's ordinary Completed and Backlog rows,
    // including completion families absent from the active presentation.
    const duoSidebarJSON = playResult && resultView === 'play-v1' && (duoProjection || duoSidebarProjection)
      ? sharedJSON(projectDuoSidebarResult(playResult, state, registry, memberId)) : undefined;
    const payload = type === 'sandbox' && resultTransport === 'json-shared-v1'
      ? { sandboxJSON: timed(timingMs, 'sandboxSerializationMs', () => sharedJSON({ ...result, cache: undefined })), resultCache: result.cache }
      : type === 'evaluate' && resultTransport === 'json-shared-v1'
      ? { ...(resultView !== 'play-v1' ? { resultJSON: sharedJSON(result) } : {}), playJSON: sharedJSON(playResult),
        ...(duoProjection && duoSidebarJSON ? { duoJSON: duoSidebarJSON } : {}),
        ...(duoSidebarProjection && duoSidebarJSON ? { duoSidebarJSON } : {}), cancelled: !!result.cancelled }
      : { result };
    timingMs.totalMs = performance.now() - started;
    parentPort.postMessage({ id, ...payload, ...(unlockReuse ? { unlockReuse } : {}), ...(partnerUnlockReuse ? { partnerUnlockReuse } : {}), evaluationMs: timingMs.totalMs, timingMs });
  } catch (error) {
    timingMs.totalMs = performance.now() - started;
    parentPort.postMessage({ id, error: { name: error.name, message: error.message }, evaluationMs: timingMs.totalMs, timingMs });
  } finally { requests.delete(id); }
});

// Module dependencies include top-level await. Let ESM finish its fulfillment
// callbacks before the scheduler can retire this isolate, even with idleMs=1.
// Terminating during that fulfillment can abort the host in V8 on Linux.
const compileMs = performance.now() - compileStarted;
setImmediate(() => parentPort.postMessage({ type: 'ready', datasetDigest: selectedDataset.digest,
  catalogue: [...engine.catalogue.filter(row => row.kind !== 'house-storage'), ...equipmentCatalogue],
  dynamicCatalogue: [...collectionEngine.catalogue, ...houseStorageCatalogue, ...generatedTaskCatalogue], compileMs }));
