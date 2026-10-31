import { verifyDatasetBinding } from './dataset-binding.mjs';
import { snapshotStore, withStoreWrite } from './storage/snapshot.mjs';
import { startupPhase } from './startup-timing.mjs';
import { projectTeleportRoute } from './teleports-response.mjs';
import { createLiveSwapAdmission } from './live-swap-admission.mjs';
import { reportActivationTiming } from './live-swap-timing.mjs';
import { prepareGameStorage, datasetFeature, unavailableDatasetFeature, requireGameBackup, preserveGameIdentity } from './game-profile.mjs';
import { datasetCatalogueKey, datasetLocalMetadataBytes } from './dataset-catalogues.mjs';
import { serveGallery } from './gallery-route.mjs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isImportRoute, readBackupRequest, sendGzipBackup, backupPreviewState } from './backup-transfer.mjs';
import { createTaskReuseFingerprint } from './tasks/unlock-reuse.mjs';
import { createPoolRanking } from './tasks/pool-ranking.mjs';
import { openStore } from './storage/store.mjs';
import { openInviteStore } from './storage/invites.mjs';
import { openAccountStore } from './storage/accounts.mjs';
import { openSignIn } from './signin.mjs';
import { openFeedbackStore } from './storage/feedback.mjs';
import { openUsageRoute } from './usage-route.mjs';
import { openUsageStore } from './storage/usage.mjs';
import { openOverlays } from './overlays.mjs';
import { openGamePlugin } from './game-plugin.mjs';
import { readBackupStatus } from './storage/backup-status.mjs';
import { transportRouteById } from './data/transport-routes.mjs';
import { requestContext, checkRequestOrigin, writeEvent } from './security/request.mjs';
import { evaluateTransportRoutes } from './core/transport-access.mjs';
import { personalTeleportRows } from './core/teleport-returns.mjs';
import { importBackup, previewRestore, BACKUP_FORMAT, SCHEMA_VERSION } from './core/state.mjs';
import { TICK_ACTIVE_TASKS, tickActiveTasksDenied } from './core/tick-active-tasks.mjs';
import { evaluateRollPool, partnerConnections, createRollPoolCache, workerRollRules } from './core/rules.mjs';
import { previewRuleProfile } from './core/planning.mjs';
import { buildIdentityIndex, isPermanentId } from './tasks/identity.mjs';
import { createQuestMapping } from './integrations/quest-mapping.mjs';
import { createProgressSources, previewProgress } from './integrations/progress-sources.mjs';
import { planTraining, trainingPreferences } from './tasks/training-planner.mjs';
import { createBankingRoutes } from './training/banking-routes.mjs';
import { createGatheringRouteLookup } from './tasks/banking-plan.mjs';
import { MINING_PICKAXES, MINING_PROFILES } from './training/mining-rates.mjs';
import { WOODCUTTING_HATCHETS } from './training/woodcutting-rates.mjs';
import { buildTrainingAvailability, createTrainingSourceIndex, trainingProgress } from './tasks/training-availability.mjs';
import { houseStorageCatalogue } from './data/poh-storage.mjs';
import { skillGuideCatalogue } from './data/skill-guides.mjs';
import { ICON_MANIFEST_PATH } from './data/icons.mjs';
import { TERRAIN_MANIFEST_PATH } from './data/terrain-assets.mjs';
import { getInteriorArea } from './core/interior-maps.mjs';
import { chunkSectionsPayload } from './core/chunk-sections.mjs';
import { projectDisplayWorld } from './display-world.mjs';
import { projectMapLayerData } from './map-layer-data.mjs';
import { projectPlayState, projectPlayResult, PLAY_VIEW } from './play-view.mjs';
import { projectBrowserState } from './web/browser-state.mjs';
import { projectDuoPlayResult, projectDuoInspectionJSON, DUO_INSPECTION_VIEW } from './duo-play-view.mjs';
import { selectDuoTasks } from './web/duo-tasks.mjs';
import { createRepresentation, sendRepresentation, createResponseCache, negotiateEncoding, PRIVATE_NO_STORE, PRIVATE_REVALIDATE } from './http-response.mjs';
import { crc32, deflateRawSync } from 'node:zlib';
import { normalizeSandboxRequest, sandboxTaskCatalogue, applySandboxChanges } from './sandbox.mjs';
import { normalizeAreaCheckRequest } from './tasks/area-check.mjs';
import { helperDrops } from './helper-drops.mjs';
import { backlogSearchTasks } from './tasks/backlog-search.mjs';
import { createProgressQuestPoints } from './helper-progress.mjs';
import { createStartupWarmup } from './tasks/startup-warmup.mjs';
import { createIdleMemoryReclaimer } from './idle-memory.mjs';
import { releaseAutomaticTransportCaches } from './core/automatic-transport.mjs';
import { buildXpChoiceView } from './core/xp-choices.mjs';
import { artBinding } from './art-bindings.mjs';

import { MAX_BODY, NOTE_PREWARM_QUIET_MS, MIME, httpError, commandPermissions, apiPermission, redactInviteTokens, savedTaskSuffix, gzipSavedTaskResult, redactInviteFields, coordinationView, routeIsRuneMetrics, json, acceptsFastGzip, jsonBytes, commandJSON, bodyJSON, routedBody, sendCached, containedFile, migrationSummary, convertLegacyCapture } from './picker-context-http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Private resources for one saved picker. The caller owns the shared runtime. */
export async function createPickerContext({ pickerId, dataDir, runtime,
  initialState, prepareState, beforeCommit, now, random, retention, initialImport,
  runeMetrics = {}, progressSources = {}, originalSync = {},
  idleMemoryOptions, predictionPrewarm = true,
  schedulingClock = { now: () => performance.now(), setTimeout, clearTimeout },
  publicOrigin, signIn = 'off', signInProvider, pickerRouting, liveSwap, pluginItemsBetaAsLive = false,
  startupSignal, startupTimingMs = {},
  backupStatusDir = pickerId === 'legacy' ? path.dirname(path.resolve(dataDir)) : path.resolve(dataDir),
  transport = {},
}) {
  if (typeof pickerId !== 'string' || !pickerId) throw new TypeError('pickerId is required.');
  const { dataset, indexedWorld, ruleRegistry, taskWorker: sharedTaskWorker, taskWorkerOptions, parsedDefinitions,
    parsedTaskMap, identityHistory, migrateState, registry, xpChoiceCatalogue, sandboxCatalogue,
    originalSyncIntegration: configuredOriginalSync, privateAddon, appVersion, browserDataset: sharedBrowserDataset, webRoot, art,
    loadChunkSections, loadMapInfo, loadNpcShopInfo, loadArchaeology, loadInteriors,
    iconCatalogue, terrainCatalogue, trainingCatalogue, membersStartBanks,
    limits, admitStream: legacyAdmitStream, usageAdmission, requestContextFor, pickerLimits,
  } = runtime;
  // Uploaded gameplay (whole-save restore, member restore and import) is never
  // authority to use the operator's source integration. Only legacy owns it.
  const originalSyncIntegration = pickerId === 'legacy' ? configuredOriginalSync : null;
  const browserDataset = pickerId === 'legacy' || !sharedBrowserDataset ? sharedBrowserDataset : {
    ...sharedBrowserDataset,
    capabilities: { ...sharedBrowserDataset.capabilities,
      features: { ...sharedBrowserDataset.capabilities.features, originalSync: false } },
    // The browser learns its roster from authenticated state, not operator data.
    gameDefaults: { members: [], masterLabel: 'Administrator' },
  };
  const admitStream = pickerLimits ? (key, response) => pickerLimits.stream({ accountId: key }, pickerId, response) : legacyAdmitStream;
  const taskWorker = sharedTaskWorker?.forPicker?.(pickerId) ?? sharedTaskWorker;
  if (typeof usageAdmission !== 'function') throw new TypeError('A shared usage admission limiter is required.');
  const usageClock = now === undefined ? Date.now : () => typeof now === 'function' ? now() : now;
  // Verify the selected runtime before touching this picker's gameplay files.
  if (liveSwap?.standby) {
    const binding = await verifyDatasetBinding(dataDir, dataset);
    if (dataset.capabilities.independent && !binding.bound) throw new Error('Standby requires existing bound storage.');
  } else await prepareGameStorage(dataDir, dataset);
  transport.savingConnections ??= new Map();
  transport.requestClose ??= () => context.close();
  transport.inviteUrl ??= () => `/join/${token}`;
  const requests = new Set(), jobs = new Set();
  function track(set, operation) {
    const pending = Promise.resolve(operation());
    set.add(pending);
    pending.then(() => set.delete(pending), () => set.delete(pending));
    return pending;
  }
  const trackJob = operation => track(jobs, operation);
  const evaluatedRollPool = (...args) => trackJob(() => evaluatedRollPoolWork(...args));
  const evaluatedTasks = (...args) => trackJob(() => evaluatedTasksWork(...args));
  const rememberTaskResult = (...args) => trackJob(() => rememberTaskResultWork(...args));
  let rollPoolCache = createRollPoolCache(indexedWorld, ruleRegistry, { inputKey: createTaskReuseFingerprint() });
  async function evaluatedRollPoolWork(state, memberId, draft) {
    const cached = draft === undefined && rollPoolCache.get(state, memberId);
    if (cached?.partnerConnections !== undefined) return cached;
    let value;
    if (taskWorker?.supports('roll-pool') && workerRollRules(ruleRegistry)) try {
      // Pool snapshots must include selections, pending offers and blacklists;
      // the ordinary task-input snapshot intentionally excludes those fields.
      const input = rollPoolCache.input(state), key = JSON.stringify(['roll-pool', memberId, input, draft]);
      const candidate = store?.getInfo().revision === state.revision ? store.getCalculationSnapshot() : undefined;
      const captured = candidate?.rollInputKey === input ? candidate : undefined;
      const stateInput = captured ? { get stateJSON() { return captured.stateJSON; }, inputKey: input } : undefined;
      value = (await taskWorker.evaluate(stateInput ? { revision: state.revision, members: captured.members } : state,
        memberId, 'roll-pool', draft, key, input, undefined, [], 'full', stateInput)).result;
    } catch {
      // A restarting or unavailable calculator must not block a roll or a state send.
      value = undefined;
    }
    if (value === undefined) {
      // Injected workers and custom JavaScript hooks retain their inline API.
      const hypothetical = draft === undefined ? state : applySandboxChanges(state, memberId, draft.changes, sandboxCatalogue);
      value = { pool: evaluateRollPool(indexedWorld, hypothetical, memberId, ruleRegistry),
        partnerConnections: partnerConnections(indexedWorld, hypothetical, memberId, ruleRegistry) };
    }
    return draft === undefined ? rollPoolCache.set(state, memberId, value) : value;
  }
  const storeStarted = performance.now();
  const handover = createLiveSwapAdmission();
  let store;
  prepareState = preserveGameIdentity(dataset, prepareState);
  store = await openStore({ dataDir, world: indexedWorld, registry: ruleRegistry, initialState, migrateState, prepareState, beforeCommit, now, random, retention, membersStartBanks, xpChoiceCatalogue, progressQuestPoints: createProgressQuestPoints(parsedDefinitions), rollPoolCache, computeRollPool: evaluatedRollPool,
    // Only rows carrying a level need a copy without it; generated goal rows are read as they are.
    taskCatalogue: taskWorker ? new Map([...taskWorker.catalogue, ...taskWorker.dynamicCatalogue].map(row => {
      if (!Object.hasOwn(row, 'level')) return [row.id, row];
      const { level, ...task } = row; return [task.id, task];
    })) : undefined,
    readOnly: liveSwap?.standby === true, liveSwapStrict: liveSwap?.strict === true, expectedCheckpoint: liveSwap?.checkpoint, onActivationTiming: liveSwap?.onActivationTiming });
  try {
    startupSignal?.throwIfAborted();
    if (initialImport) {
      const current = store.getState();
      if (current.revision || current.history.length || current.members.some(member => member.unlocked.length || member.selected.length || member.completedTasks.length)) throw new TypeError('This store already has gameplay. Start without --import and use the reviewed import in Backup & Import.');
      const document = typeof initialImport === 'string' ? JSON.parse(await readFile(initialImport, 'utf8')) : initialImport;
      const converted = document?.format === 'rs3-chunk-picker' ? importBackup(document, registry)
        : convertLegacyCapture(document, { members: dataset.gameDefaults.members, registry: ruleRegistry }).state;
      await store.replace(converted, store.getState().revision);
    }
    startupSignal?.throwIfAborted();
  } catch (error) { await store.close(); throw error; }
  startupTimingMs.storeMs = performance.now() - storeStarted;
  startupPhase('create:store');
  const questMapping = createQuestMapping(parsedDefinitions);
  const authStarted = performance.now();
  const token = store.getAccessToken();
  // The first map belongs to the master owner. Feedback aliases her private
  // master sessions to linked owner invitations without changing History actors.
  let feedbackOwnerId = store.getCalculationSnapshot().members[0]?.id;
  const feedbackActor = identity => identity.kind === 'master' && feedbackOwnerId
    ? { ...identity.actor, memberId: feedbackOwnerId } : identity.actor;
  let invites, accounts, signInFlow, feedback, overlays, usage, usageStorage, gamePlugin;
  async function openSidecars() {
    accounts = await openAccountStore({ dataDir });
    invites = await openInviteStore({ dataDir, masterToken: token, masterLabel: dataset.gameDefaults.masterLabel, accounts, signInMode: signIn, pickerRegistry: pickerRouting?.registry });
    if (pickerRouting?.authenticate) invites.authenticate = (request, security) => pickerRouting.authenticate(request, security, pickerId);
    signInFlow = await openSignIn({ publicOrigin, mode: signIn, accounts, invites, provider: signInProvider,
      unauthenticated: key => limits.unauthenticated(key), checkRequestOrigin, serializeMutation, webRoot, pickerRegistry: pickerLimits && pickerRouting?.registry ? pickerLimits.provisioningRegistry(pickerRouting.registry) : pickerRouting?.registry, syncLegacy: pickerRouting?.syncLegacy, reclaimIdentity: pickerRouting?.reclaimIdentity });
    feedback = await openFeedbackStore({ dataDir });
    const usageMembers = store.getCalculationSnapshot().members;
    usageStorage = await openUsageStore({ dataDir, readOnly: liveSwap?.standby === true,
      actors: usageMembers.map(member => member.id), now: usageClock });
    usage = await openUsageRoute({ members: usageMembers, storage: usageStorage, admission: usageAdmission,
      authenticate: (request, security) => invites.authenticate(request, security), bodyJSON, json });
    overlays = await openOverlays({ dataDir, store, world: indexedWorld, webRoot, publicOrigin,
      authenticateAdmin: (request, security) => invites.authenticate(request, security), checkRequestOrigin, serializeMutation,
      unauthenticated: key => limits.unauthenticated(key), admitStream });
    gamePlugin = await openGamePlugin({ pickerLimits, pickerId, dataDir, store, world: indexedWorld, registry: ruleRegistry, questMapping, bodyJSON, json,
      serializeMutation, checkRequestOrigin, unauthenticated: key => limits.unauthenticated(key),
      indexKey: pickerRouting?.indexKey, removeKey: pickerRouting?.removeKey, authorizeKey: pickerRouting?.authenticateKey,
      // In-game lists read the saved task result only; they never start an evaluation.
      savedTasks: memberId => { const entry = savedTaskResults.get(memberId); return entry?.playJSON ? { bytes: entry.playJSON, revision: entry.revision } : null; },
      // Read the exact prediction cache used by Chunk Info and pool ranking.
      // A peek neither admits work nor touches the worker idle clock.
      peekPrediction: (memberId, chunkId) => {
        if (!taskWorker) return null;
        const captured = calculationState();
        return taskWorker.peekPrediction(captured.state, memberId, chunkId, captured.input);
      },
      ...(progressSources.clock ? { clock: progressSources.clock } : {}),
      itemsBetaAsLive: pluginItemsBetaAsLive,
      // Item evidence may propose generated Obtain goals, which live in the catalogue until ticked.
      taskCatalogue: () => [...(taskWorker?.catalogue ?? []), ...(taskWorker?.dynamicCatalogue ?? [])],
      notify: () => broadcast('event: game-plugin\ndata: {}\n\n') });
  }
  try { await openSidecars(); }
  catch (error) { await Promise.all([signInFlow?.close(), accounts?.close(), invites?.close(), feedback?.close(), usage?.close(), overlays?.close(), gamePlugin?.close(), store.close()]); throw error; }
  if (startupSignal?.aborted) { await Promise.all([overlays.close(), gamePlugin.close()]); await Promise.all([store.close(), signInFlow.close(), accounts.close(), invites.close(), feedback.close(), usage.close()]); startupSignal.throwIfAborted(); }
  startupTimingMs.authMs = performance.now() - authStarted;
  startupPhase('create:sidecars');
  // Compile the static fingerprint before readiness; subsequent saves hash
  // only changed gameplay fields rather than the large migration archives.
  if (taskWorker) {
    store.getGameplayFingerprint();
    // Warm immutable catalogue/legacy digests before readiness. Later exact
    // saved reuse hashes only the changed small fields on the Unlock path.
    void store.getCalculationSnapshot().taskInputKey;
  }
  const progressClient = createProgressSources({ ...progressSources, runeMetrics, pluginSnapshot: owner => gamePlugin.progressSnapshot(owner) });
  const runeMetricsPreviews = new Map();
  const originalSyncClient = originalSyncIntegration?.createOriginalSyncClient(originalSync), originalSyncPreviews = new Map();
  const originalSyncNow = () => (originalSync.now?.() ?? new Date()).getTime();
  const previewLifetimeMs = 10 * 60 * 1000;
  const stateEnvelope = async state => {
    const values = [];
    for (const member of state.members) values.push([member.id, await evaluatedRollPool(state, member.id)]);
    return { state: projectBrowserState(state), pools: Object.fromEntries(values.map(([id, value]) => [id, value.pool])), values: new Map(values) };
  };
  const responseCache = createResponseCache({ maxEntries: 32, maxBytes: 48 * 1024 * 1024 });
  const sandboxPools = createResponseCache({ maxEntries: 32, maxBytes: 4 * 1024 * 1024 });
  const poolRanking = createPoolRanking(), rankingPools = new Map();
  let rankingPoolInput, rankingLeaseTimer;
  async function rankingPoolIds(state, memberId) {
    const input = rollPoolCache.input(state);
    if (rankingPoolInput !== input) { rankingPools.clear(); rankingPoolInput = input; }
    const cached = rankingPools.get(memberId);
    if (cached) return cached;
    const ids = (await evaluatedRollPool(state, memberId)).pool.eligible.map(row => row.id);
    if (rankingPoolInput === input) rankingPools.set(memberId, ids);
    return ids;
  }
  const viewFor = request => new URL(request.url, 'http://localhost').searchParams.get('view') === PLAY_VIEW ? PLAY_VIEW : undefined;
  async function restoreBackup(body) {
    if (!Object.hasOwn(body, 'backupId')) {
      // Keep the public envelope checks while storage owns deep validation.
      let backup = body.backup;
      if (typeof backup === 'string') {
        try { backup = JSON.parse(backup); } catch { throw httpError(400, 'Backup is not valid JSON.'); }
      }
      if (backup === undefined) { if (!datasetFeature(dataset, 'originalSync')) throw httpError(422, 'Choose a backup from this starter game dataset.'); return undefined; }
      if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw httpError(400, 'Backup must be a JSON object.');
      if (backup.format !== BACKUP_FORMAT) throw httpError(400, 'Unsupported backup format.');
      if (backup.schemaVersion !== SCHEMA_VERSION) throw httpError(400, 'Unsupported backup schema version.');
      return requireGameBackup(dataset, backup);
    }
    if (Object.hasOwn(body, 'backup') || Object.hasOwn(body, 'document')) throw httpError(400, 'Choose either a retained save or an uploaded backup.');
    return requireGameBackup(dataset, await store.readBackup(body.backupId));
  }
  function cachedValue(key, value) {
    key = `${dataset.digest}:${key}`;
    return responseCache.get(key) ?? responseCache.set(key, createRepresentation(Buffer.from(JSON.stringify(value()))));
  }
  async function stateRepresentation(view, info = store.getInfo()) {
    const key = `state:${info.revision}:${view ?? 'full'}`;
    let cached = responseCache.get(key);
    if (!cached) {
      const saved = await store.getStateSnapshot({ view });
      if (saved.revision !== info.revision) return stateRepresentation(view);
      cached = responseCache.set(key, createRepresentation(Buffer.from(`{"state":${saved.stateJSON},"pools":${JSON.stringify(saved.pools)},"store":${JSON.stringify(info)}${view ? ',"format":"play-v1","schemaVersion":1' : ''}}`)));
    }
    return cached;
  }
  async function viewEnvelope(state, view) {
    const { values, ...envelope } = await stateEnvelope(state);
    if (view !== PLAY_VIEW) return envelope;
    return { format: PLAY_VIEW, schemaVersion: 1, state: projectPlayState(state),
      pools: Object.fromEntries(state.members.map(member => [member.id, { ...envelope.pools[member.id],
        partnerConnections: values.get(member.id).partnerConnections }])) };
  }
  let identityLookupRevision = -1, identityLookup;
  const lookupIdentity = id => {
    if (identityLookupRevision !== store.getInfo().revision) {
      const state = store.getState();
      identityLookup = buildIdentityIndex([...state.tasks, ...(taskWorker?.catalogue ?? []), ...(taskWorker?.dynamicCatalogue ?? [])],
        { savedRegistry: state.identityRegistry, taskMap: parsedTaskMap, history: identityHistory });
      identityLookupRevision = state.revision;
    }
    return identityLookup.lookup(id);
  };
  const clients = new Set();
  const clientCredentials = new Map();
  function broadcast(bytes) {
    if (pickerRouting?.authenticate) endInactiveClients();
    for (const client of clients) if (!writeEvent(client, bytes)) {
      clients.delete(client); clientCredentials.delete(client);
    }
  }
  // Preserve completed bytes while calculators sleep. Viewers only read these;
  // they never touch scheduler admission, cache LRU, prewarming or worker timers.
  const savedTaskResults = new Map();
  const retainedFullBytes = row => row.fullGzip?.length ?? 0;
  const taskFingerprint = () => calculationState().input;
  let savedTaskFingerprint = store.getCalculationSnapshot().taskInputKey;
  poolRanking.sync(savedTaskFingerprint);
  let knownTaskMembers = new Set(store.getCalculationSnapshot().members.map(member => member.id));
  function rebindTaskRevision(entry, revision) {
    entry.revision = revision;
  }
  let neverShowIds;
  function inspectionMetadata() {
    neverShowIds ??= [...new Set([...(taskWorker?.catalogue ?? []), ...(taskWorker?.dynamicCatalogue ?? [])]
      .filter(task => parsedDefinitions.challenges?.[task.category]?.[task.rawLabel]?.NeverShow).map(task => task.id))];
    return { neverShowIds };
  }
  function inspectionBytes(entry) {
    if (entry.duoInspectionJSON) return entry.duoInspectionJSON;
    if (!entry.playJSON) return undefined;
    const bytes = projectDuoInspectionJSON(entry.playJSON, inspectionMetadata());
    // Optional inspection bytes never evict another player's ordinary list.
    const retained = [...savedTaskResults.values()].reduce((sum, row) => sum + row.bytes, 0);
    if (retained + bytes.length <= 32 * 1024 * 1024) {
      entry.duoInspectionJSON = bytes; entry.bytes += bytes.length;
    }
    return bytes;
  }
  async function rememberTaskResultWork(revision, memberId, evaluation, input, retainFull = false) {
    if (input !== savedTaskFingerprint || evaluation.cancelled || (!evaluation.playJSON && evaluation.result?.cancelled)) return;
    const resultJSON = retainFull ? evaluation.resultJSON ?? (!evaluation.playJSON ? Buffer.from(JSON.stringify(evaluation.result)) : undefined) : undefined;
    const playJSON = evaluation.playJSON ?? Buffer.from(JSON.stringify(projectPlayResult(evaluation.result)));
    const fullBodyRevision = revision;
    const fullGzip = resultJSON ? await gzipSavedTaskResult(resultJSON, fullBodyRevision, memberId) : undefined;
    if (input !== savedTaskFingerprint || closed) return;
    revision = store.getInfo().revision;
    const previous = savedTaskResults.get(memberId);
    const entry = { ...(previous?.revision === revision ? previous : {}), revision, memberId,
      ...(fullGzip ? { fullGzip, fullBytes: resultJSON.length,
        fullBodyRevision,
        fullResponseBytes: resultJSON.length - 1 + savedTaskSuffix(fullBodyRevision, memberId).length,
        fullETag: `"${createHash('sha256').update(fullGzip).digest('hex')}"` } : {}),
      ...(playJSON ? { playJSON } : {}),
      ...(evaluation.duoJSON ? { duoJSON: evaluation.duoJSON } : {}),
      ...(evaluation.duoSidebarJSON ? { duoSidebarJSON: evaluation.duoSidebarJSON } : {}) };
    entry.bytes = ['playJSON', 'duoJSON', 'duoSidebarJSON', 'duoInspectionJSON'].reduce((sum, key) => sum + (entry[key]?.length ?? 0), 0);
    rebindTaskRevision(entry, revision);
    savedTaskResults.delete(memberId);
    if (entry.bytes > 32 * 1024 * 1024 && entry.duoInspectionJSON) {
      entry.bytes -= entry.duoInspectionJSON.length; delete entry.duoInspectionJSON;
    }
    if (entry.bytes > 32 * 1024 * 1024) return;
    savedTaskResults.set(memberId, entry);
    gamePlugin?.rememberTasks(memberId, entry.playJSON);
    for (const row of savedTaskResults.values()) {
      if ([...savedTaskResults.values()].reduce((sum, result) => sum + result.bytes, 0) <= 32 * 1024 * 1024) break;
      if (row.duoInspectionJSON) { row.bytes -= row.duoInspectionJSON.length; delete row.duoInspectionJSON; }
    }
    while (savedTaskResults.size > 8 || [...savedTaskResults.values()].reduce((sum, result) => sum + result.bytes, 0) > 32 * 1024 * 1024) {
      savedTaskResults.delete(savedTaskResults.keys().next().value);
    }
    // Full-detail retention never evicts the task list for another player.
    for (const result of savedTaskResults.values()) {
      if ([...savedTaskResults.values()].reduce((sum, row) => sum + retainedFullBytes(row), 0) <= 16 * 1024 * 1024) break;
      delete result.fullGzip; delete result.fullBytes; delete result.fullResponseBytes; delete result.fullETag; delete result.fullBodyRevision;
    }
    endInactiveClients();
    broadcast(`event: task-ready\ndata: ${JSON.stringify({ revision, memberId })}\n\n`);
  }
  async function readSavedTasks(request, response) {
    const query = new URL(request.url, 'http://localhost').searchParams;
    const memberId = query.get('memberId'), revision = store.getInfo().revision;
    if (!knownTaskMembers.has(memberId)) throw httpError(400, 'Choose a known player to view tasks.');
    const lane = query.get('lane') ?? 'foreground', projection = query.get('projection'), view = viewFor(request);
    if (!['foreground', 'duo-v1'].includes(lane)) throw httpError(400, 'This task request is not supported. Reload the picker and try again.');
    if (projection !== null && (!['duo-sidebar-v1', DUO_INSPECTION_VIEW].includes(projection) || lane !== 'foreground' || view !== PLAY_VIEW)) throw httpError(400, 'This task view is not supported. Reload the picker and try again.');
    if (lane === 'duo-v1' && (view !== PLAY_VIEW || query.get('peerFor') === memberId || !knownTaskMembers.has(query.get('peerFor')))) throw httpError(400, 'Choose two different saved players to view both task lists.');
    if ((lane === 'duo-v1' || projection) && query.get('revision') !== String(revision)) throw httpError(409, 'Saved state changed. Request the current tasks.');
    const entry = savedTaskResults.get(memberId);
    // A full result is compressed once. Display-only revisions reuse its exact
    // evidence; the viewer applies this authoritative current revision header.
    response.setHeader('X-RS3-State-Revision', String(revision));
    if (entry?.revision === revision && view !== PLAY_VIEW && entry.fullGzip) {
      // Only retained gzip and streamed identity are available here. A br-only
      // client can get 406 rather than forcing a fresh large encoding.
      const encoding = negotiateEncoding(`${request.headers['accept-encoding'] ?? ''},br;q=0`);
      if (encoding === 'gzip') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': PRIVATE_NO_STORE,
          Vary: 'Accept-Encoding', ETag: `"gzip:${entry.fullETag.slice(1, -1)}"`, 'Content-Encoding': 'gzip', 'Content-Length': retainedFullBytes(entry) });
        if (request.method === 'HEAD') response.end();
        else await pipeline(Readable.from([entry.fullGzip]), response);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': PRIVATE_NO_STORE,
        Vary: 'Accept-Encoding', ETag: `"identity:${entry.fullETag.slice(1, -1)}"`, 'Content-Length': entry.fullResponseBytes });
      if (request.method === 'HEAD') response.end();
      else await pipeline(Readable.from([entry.fullGzip]), createGunzip(), response);
      return;
    }
    const bytes = entry?.revision === revision ? view === PLAY_VIEW
      ? lane === 'duo-v1' ? entry.duoJSON ?? entry.playJSON : projection === DUO_INSPECTION_VIEW ? inspectionBytes(entry) : projection ? entry.duoSidebarJSON ?? entry.playJSON : entry.playJSON
      : undefined : undefined;
    if (!bytes) throw Object.assign(httpError(409, 'Current tasks are not ready yet. They will appear after a player loads them.'), { code: 'TASK_RESULTS_UNAVAILABLE' });
    const suffix = JSON.stringify({ stateRevision: revision, memberId, cache: { hit: true, savedResult: true, worker: false } });
    await jsonBytes(request, response, 200, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(`,${suffix.slice(1)}`)]));
  }
  function endInactiveClients() {
    for (const [client, { request, security }] of clientCredentials) {
      if (invites.authenticate(request, security)) continue;
      clients.delete(client); clientCredentials.delete(client); client.end();
    }
  }
  let mutationQueue = Promise.resolve();
  function serializeMutation(operation) {
    if (closed) return Promise.reject(httpError(503, 'The picker is stopping. Retry after it restarts.'));
    const pending = mutationQueue.then(() => withStoreWrite(dataDir, operation));
    mutationQueue = pending.catch(() => {});
    return pending;
  }
  let closed = false;
  let closePromise;
  let calculationSnapshot;
  let claimCleanupImmediate, claimCleanupRun, claimCleanupAgain = false, lastClaimCheckKey;
  // Only transient compact projections are parsed. The existing viewer cache
  // owns the bytes; no additional full task results remain resident for claims.
  function claimCleanupCandidates() {
    const claims = store.getTaskClaimSnapshot();
    const ids = Object.keys(claims.taskClaims).sort();
    if (!ids.length) return;
    const input = taskFingerprint(), key = `${input}:${ids.join(',')}`;
    if (key === lastClaimCheckKey || input !== savedTaskFingerprint) return;
    const state = store.getTaskClaimState();
    const ready = state.members.map(member => ({ member, entry: savedTaskResults.get(member.id) }));
    if (ready.some(({ entry }) => entry?.revision !== claims.revision || !(entry.duoSidebarJSON ?? entry.duoJSON ?? entry.playJSON))) return;
    lastClaimCheckKey = key;
    const results = new Map();
    for (const { member, entry } of ready) {
      const bytes = entry.duoSidebarJSON ?? entry.duoJSON ?? entry.playJSON;
      results.set(member.id, { ...projectDuoPlayResult(JSON.parse(bytes.toString()), state),
        memberId: member.id, stateRevision: claims.revision });
    }
    const selected = selectDuoTasks({ state, results, registry: ruleRegistry, selectedMemberId: state.members[0].id, showCompleted: true });
    const activeTaskIds = selected.allRows.filter(row => row.memberIds.some(id => !row.factsByMember[id].group)).map(row => row.id);
    return { activeTaskIds, revision: claims.revision, key };
  }
  function scheduleClaimCleanup() {
    if (closed || handover.frozen || liveSwap?.standby) return;
    if (claimCleanupRun) { claimCleanupAgain = true; return; }
    if (claimCleanupImmediate) return;
    claimCleanupImmediate = setImmediate(() => {
      claimCleanupImmediate = undefined;
      claimCleanupRun = Promise.resolve().then(async () => {
        if (closed || handover.frozen || liveSwap?.standby) return;
        const candidates = claimCleanupCandidates();
        if (!candidates) return;
        lastClaimCheckKey = candidates.key;
        const lease = handover.begin();
        try { await serializeMutation(() => closed ? undefined : store.reconcileTaskClaims(candidates.activeTaskIds, candidates.revision)); }
        finally { lease.finish(); }
      }).catch(error => {
        if (error.code === 'REVISION_CONFLICT') lastClaimCheckKey = undefined;
        else console.error('Could not tidy task claims.', { code: error.code ?? 'CLAIM_CLEANUP_FAILED' });
      }).finally(() => {
        claimCleanupRun = undefined;
        if (claimCleanupAgain) { claimCleanupAgain = false; scheduleClaimCleanup(); }
      });
    });
    claimCleanupImmediate.unref();
  }
  const nativeForegroundState = !taskWorkerOptions?.workerFactory || taskWorkerOptions?.serializedStateInput === true;
  const startupPrepared = { variant: false, stateResponse: false };
  let readinessPrepared;
  let startupWarmup;
  let trainingSourceIndex, bankingRouteProvider;
  let prewarmTimer;
  let noteQuietUntil = -Infinity;
  let foregroundActive = 0, foregroundLastActivity = schedulingClock.now(),foregroundCompletedRevision = -1, foregroundAwaitedRevision = -1, awaitingForeground;
  let automaticDeathActive = 0;
  let requiredTaskMembers = new Set(), settledTaskMembers = new Set();
  const activeTaskMembers = new Map();
  let activePreviews = 0;
  const foregroundWaiters = new Set();
  function notifyForeground() { for (const notify of [...foregroundWaiters]) notify(); }
  function listPending(revision) {
    return revision === store.getInfo().revision && (activePreviews > 0
      || [...requiredTaskMembers].some(id => activeTaskMembers.get(JSON.stringify([revision, id])) > 0)
      || requiredTaskMembers.size > 0 && [...requiredTaskMembers].some(id => !settledTaskMembers.has(id))
      || awaitingForeground && awaitingForeground.revision === revision && schedulingClock.now() < awaitingForeground.until);
  }
  async function waitForList(revision, signal, taskInput) {
    // Panel preparation can follow identical task inputs across display saves;
    // keep the original gate deadline and quiet window while rebinding guards.
    if (revision !== store.getInfo().revision && taskInput !== undefined && taskInput === taskFingerprint()) revision = store.getInfo().revision;
    if (!requiredTaskMembers.size || !listPending(revision)) return;
    await new Promise((resolve, reject) => {
      let timer;
      const deadline = schedulingClock.now() + 30000;
      const finish = error => { schedulingClock.clearTimeout(timer); foregroundWaiters.delete(check); signal?.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
      const aborted = () => finish(Object.assign(new Error('Requester disconnected.'), { name: 'AbortError' }));
      const check = () => {
        schedulingClock.clearTimeout(timer);
        if (closed) { finish(httpError(409, 'The saved map changed. Request the current list.')); return; }
        if (revision !== store.getInfo().revision) {
          if (taskInput === undefined || taskInput !== taskFingerprint()) { finish(httpError(409, 'The saved map changed. Request the current list.')); return; }
          revision = store.getInfo().revision;
        }
        if (!listPending(revision)) { finish(); return; }
        if (schedulingClock.now() >= deadline) { finish(httpError(503, 'The task list is still loading. Try again when the current tasks are shown.')); return; }
        timer = schedulingClock.setTimeout(check, 250); timer.unref?.();
      };
      foregroundWaiters.add(check); signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted(); else check();
    });
  }
  function awaitForeground(revision) {
    if (!taskWorker || closed) return;
    // Bound startup/save gating even when an authenticated client never asks
    // for tasks. Repeated state reads do not extend the same revision's gate.
    if (revision <= foregroundAwaitedRevision) return;
    foregroundAwaitedRevision = revision;
    settledTaskMembers = new Set();
    awaitingForeground = { revision, until: schedulingClock.now() + 15000 };
    schedulingClock.clearTimeout(prewarmTimer); taskWorker.cancelPrewarm({ keepTasks: true }); schedulePredictions();
  }
  function calculationState() {
    if (!calculationSnapshot || calculationSnapshot.metadata.revision !== store.getInfo().revision) {
      const captured = store.getCalculationSnapshot();
      let taskIndex;
      calculationSnapshot = { metadata: { revision: captured.revision, members: captured.members }, input: captured.taskInputKey,
        get state() { return captured.state; },
        get sandboxTaskIndex() { return taskIndex ??= sandboxTaskCatalogue(captured.state, sandboxCatalogue); },
        get stateInput() { return { get stateJSON() { return captured.stateJSON; }, inputKey: captured.taskInputKey,
          get taskInputKey() { return captured.taskInputKey; } }; } };
    }
    return calculationSnapshot;
  }
  function schedulePredictions(delay = 1000) {
    if (!taskWorker || closed || liveSwap?.standby || !predictionPrewarm && !poolRanking.interestedMembers().size) return;
    schedulingClock.clearTimeout(prewarmTimer);
    // Cheap guards run before cloning state, computing pools, or starting the
    // prediction worker. Foreground loading wins even on slow state transfers.
    prewarmTimer = schedulingClock.setTimeout(() => { void trackJob(async () => {
      if (closed) return;
      const time = schedulingClock.now();
      if (startupWarmup && ['pending', 'running'].includes(startupWarmup.diagnostics().status)) { schedulePredictions(); return; }
      if (foregroundActive || automaticDeathActive) { schedulePredictions(); return; }
      if (requiredTaskMembers.size && [...requiredTaskMembers].some(id => !settledTaskMembers.has(id))) { schedulePredictions(); return; }
      if (awaitingForeground && time < awaitingForeground.until) { schedulePredictions(Math.min(1000, awaitingForeground.until - time)); return; }
      awaitingForeground = undefined;
      const quietRemaining = Math.max(1000 - (time - foregroundLastActivity), noteQuietUntil - time);
      if (quietRemaining > 0) { schedulePredictions(quietRemaining); return; }
      const { state, input } = calculationState();
      const valid = ids => [...new Set(ids)].filter(id => /^[1-9]\d*$/.test(id)
        && indexedWorld.chunks.has(id) && (!indexedWorld.surface || indexedWorld.surface.has(id)));
      // Reviewed choices precede visible pool comparisons. Pools never start
      // merely because a server or a task list opened.
      const groups = [];
      const interleave = lists => {
        for (let index = 0; index < Math.max(0, ...lists.map(ids => ids.length)); index++) {
          state.members.forEach((member, owner) => { if (lists[owner][index]) groups.push({ memberId: member.id, chunkIds: [lists[owner][index]] }); });
        }
      };
      if (predictionPrewarm) {
        interleave(state.members.map(member => valid(member.pendingRoll)));
        interleave(state.members.map(member => valid(member.selected)));
      }
      const interested = poolRanking.interestedMembers();
      const pools = await Promise.all(state.members.map(async member => interested.has(member.id)
        ? poolRanking.missing(member.id, valid(await rankingPoolIds(state, member.id))) : []));
      if (closed || input !== taskFingerprint()) return;
      for (let index = 0; index < Math.max(0, ...pools.map(ids => ids.length)); index++) {
        state.members.forEach((member, owner) => { if (pools[owner][index]) groups.push({ memberId: member.id,
          chunkIds: [pools[owner][index]], purpose: 'ranking' }); });
      }
      taskWorker.prewarm(state, input, groups);
    }).catch(() => { /* A newer save or worker failure abandons background warming. */ }); }, delay);
    prewarmTimer.unref?.();
  }
  function watchRankingLeases() {
    clearTimeout(rankingLeaseTimer);
    if (closed) return;
    const interested = poolRanking.interestedMembers();
    taskWorker?.cancelRankingPrewarm(interested);
    if (!interested.size) {
      schedulePredictions(); return;
    }
    rankingLeaseTimer = setTimeout(watchRankingLeases, 1000);
    rankingLeaseTimer.unref?.();
  }
  const unsubscribePredictions = taskWorker?.subscribePredictions(({ input, memberId, chunkId, result }) => {
    if (closed || input !== savedTaskFingerprint) return;
    poolRanking.remember(input, memberId, chunkId, result);
    if (poolRanking.interestedMembers().size) schedulePredictions();
  });
  async function evaluatedTasksWork(state, memberId, type = 'evaluate', chunkId, signal, chunkIds = [], resultView = 'full', stateInput, evaluationLane = 'foreground', duoSidebarProjection = false, retainFull = false, afterRemembered) {
    const side = type === 'chunk-planning' || type === 'death-estimates' || type === 'evaluate' && resultView === 'full' && nativeForegroundState && requiredTaskMembers.size > 0;
    // Share the task-input boundary with unlock predictions. Pool selections,
    // pending offers and blacklists cannot change these calculation results.
    // Read it with the caller's state: workers reuse baselines by this input.
    const input = stateInput?.inputKey ?? calculationState().input;
    if (side) await waitForList(state.revision, signal);
    // Explicit Preview needs the same quiet window as the current task list:
    // queued bulk predictions must not start between its answer and Unlock.
    const foreground = type === 'evaluate' && !side || type === 'predict';
    const activeTaskKey = foreground && type === 'evaluate' ? JSON.stringify([state.revision, memberId]) : undefined;
    const automaticDeath = type === 'death-estimates' && state.rules?.['travel.automatic'] === true;
    if (foreground) {
      foregroundActive++; foregroundLastActivity = schedulingClock.now();
      if (activeTaskKey) activeTaskMembers.set(activeTaskKey, (activeTaskMembers.get(activeTaskKey) ?? 0) + 1);
      else activePreviews++;
      schedulingClock.clearTimeout(prewarmTimer); taskWorker.cancelPrewarm({ keepTasks: type === 'evaluate', keepActive: type === 'predict' });
    }
    if (automaticDeath) {
      // Bulk warming and death estimates otherwise calculate the same future
      // chunks on separate workers. Pause only unsolicited warming; explicit
      // Preview requests retain their own lane and existing waiters.
      automaticDeathActive++;
      schedulingClock.clearTimeout(prewarmTimer); taskWorker.cancelPrewarm();
    }
    let completed = false;
    try {
      if (type === 'evaluate') chunkId = undefined;
      const key = JSON.stringify([type === 'evaluate' ? input : state.revision, memberId, type, chunkId, type === 'death-estimates' ? chunkIds : undefined]);
      const reused = type === 'evaluate' && resultView === PLAY_VIEW && stateInput
        ? taskWorker.preparedEvaluation?.(() => stateInput.taskInputKey, memberId, state.revision) : undefined;
      const evaluation = reused ?? await taskWorker.evaluate(state, memberId, type, chunkId, key, input, signal, chunkIds, resultView, stateInput,
        side && type !== 'death-estimates' ? 'side' : evaluationLane, duoSidebarProjection);
      completed = !evaluation.cancelled;
      // Compress off the response path. Current lists survive retirement within
      // the existing quota, so reading them need not compile another worker.
      if (type === 'evaluate') {
        trackJob(async () => {
          await new Promise(resolve => setImmediate(resolve));
          await rememberTaskResult(state.revision, memberId, evaluation, input, retainFull);
          await afterRemembered?.();
        }).catch(() => {});
      }
      return evaluation;
    } finally {
      if (foreground) {
        foregroundActive--; foregroundLastActivity = schedulingClock.now();
        if (activeTaskKey) {
          const remaining = activeTaskMembers.get(activeTaskKey) - 1;
          if (remaining) activeTaskMembers.set(activeTaskKey, remaining); else activeTaskMembers.delete(activeTaskKey);
        } else activePreviews--;
        taskWorker.resumePrewarm();
        if (type === 'evaluate' && completed && input === savedTaskFingerprint) {
          const revision = store.getInfo().revision;
          settledTaskMembers.add(memberId);
          foregroundCompletedRevision = Math.max(foregroundCompletedRevision, revision);
          if (awaitingForeground && revision >= awaitingForeground.revision && [...requiredTaskMembers].every(id => settledTaskMembers.has(id))) awaitingForeground = undefined;
        }
        notifyForeground();
        schedulePredictions();
      }
      if (automaticDeath) {
        automaticDeathActive--;
        schedulePredictions();
      }
    }
  }
  let lastUnchangedTaskRevision, refreshMemberId;
  const unsubscribe = store.subscribe(({ revision, ownershipChanged, noteEdit }) => {
    const gameplay = taskFingerprint(), taskResultsUnchanged = gameplay === savedTaskFingerprint;
    lastUnchangedTaskRevision = taskResultsUnchanged ? revision : undefined;
    if (taskResultsUnchanged) {
      for (const entry of savedTaskResults.values()) rebindTaskRevision(entry, revision);
    } else { savedTaskResults.clear(); lastClaimCheckKey = undefined; }
    savedTaskFingerprint = gameplay;
    poolRanking.sync(gameplay);
    knownTaskMembers = new Set(calculationState().metadata.members.map(member => member.id));
    sandboxPools.clear();
    if (!taskResultsUnchanged) {
      if (taskWorker) (taskWorker.setRevision ?? taskWorker.supersede).call(taskWorker, revision, gameplay);
      awaitForeground(revision);
      // Refresh the active play view from the durable revision while the store
      // independently rebuilds travel/pools. Existing scheduler keys coalesce
      // the following HTTP reads; sleeping foreground workers are not woken.
      if (ownershipChanged && nativeForegroundState && refreshMemberId && taskWorker?.getHealth().resident) {
        const captured = calculationState(), group = requiredTaskMembers.size > 1;
        for (const memberId of requiredTaskMembers) {
          if (!knownTaskMembers.has(memberId)) continue;
          void evaluatedTasks(captured.metadata, memberId, 'evaluate', undefined, undefined, [], PLAY_VIEW,
            captured.stateInput, memberId === refreshMemberId ? 'foreground' : 'duo',
            group && memberId === refreshMemberId).catch(() => {});
        }
      }
    } else {
      if (foregroundCompletedRevision >= revision - 1) {
        foregroundCompletedRevision = revision;
        foregroundAwaitedRevision = Math.max(foregroundAwaitedRevision, revision);
        awaitingForeground = undefined;
      } else if (awaitingForeground) {
        awaitingForeground.revision = revision;
        foregroundAwaitedRevision = revision;
      }
      taskWorker?.supersedeDisplay(revision, gameplay);
      // A pending warm-up reads the latest state when it fires.
      // Claim-only saves must preserve the quiet window scheduled by the task response.
      if (noteEdit && taskWorker) {
        // Someone is typing notes. Their tasks stay valid, but queued warm-up
        // yields to the next save; epoch-keyed entries requeue after the quiet.
        // Its process yields as a gameplay save's would, and warm-up restarts no
        // sooner than after a recalculation: an edit and a correction often follow.
        foregroundLastActivity = schedulingClock.now(); noteQuietUntil = foregroundLastActivity + NOTE_PREWARM_QUIET_MS;
        taskWorker.retireWarmPrediction?.();
        schedulingClock.clearTimeout(prewarmTimer); taskWorker.cancelPrewarm({ keepTasks: true }); schedulePredictions();
      }
    }
    notifyForeground();
    endInactiveClients();
    broadcast(`event: revision\ndata: ${JSON.stringify({ revision, ...(taskResultsUnchanged ? { taskResultsUnchanged: true } : {}) })}\n\n`);
  });
  const idleMemory = createIdleMemoryReclaimer({ ...idleMemoryOptions,
    idle() {
      const health = taskWorker?.getHealth();
      if (closed || foregroundActive || activePreviews || automaticDeathActive || health?.status !== 'sleeping') return false;
      return [health, health.death, health.duo, health.prediction].filter(Boolean)
        .every(lane => ['sleeping', 'idle'].includes(lane.status) && !lane.resident && !lane.retiring) ? true : null;
    },
    release() {
      calculationSnapshot = undefined; store.releaseTaskCaches();
      releaseAutomaticTransportCaches(indexedWorld);
    },
  });
  let memorySleeping = false;
  const unsubscribeResidency = taskWorker?.subscribeResidency(worker => {
    const sleeping = [worker, worker.death, worker.duo, worker.prediction].filter(Boolean)
      .every(lane => ['sleeping', 'idle'].includes(lane.status) && !lane.resident && !lane.retiring);
    if (worker.status === 'sleeping' && sleeping) {
      if (!memorySleeping) { memorySleeping = true; idleMemory.sleep(); }
    } else { memorySleeping = false; idleMemory.wake(); }
  });
  const unsubscribeWorker = taskWorker?.subscribe(worker => {
    if (worker.status === 'sleeping') {
      schedulingClock.clearTimeout(prewarmTimer);
      calculationSnapshot = undefined; store.releaseTaskCaches();
      clearImmediate(claimCleanupImmediate); claimCleanupImmediate = undefined;
      responseCache.clear(); runtime.staticCache.clear(); sandboxPools.clear();
      runtime.releaseReferences();
      identityLookup = undefined; identityLookupRevision = -1; trainingSourceIndex = undefined;
    }
    endInactiveClients();
    broadcast(`event: worker\ndata: ${JSON.stringify(worker)}\n\n`);
  });
  let importingBackup = false;
  const admittedImports = new WeakSet();
  const importBodyChecks = new WeakMap();
  const applicationRequestHandler = async (request, response, lease, listener) => {
    // Listener policy is supplied by the socket dispatcher, never HTTP input.
    const listenerOptions = { ...listener, publicOrigin };
    const security = listener.ingressRole === 'public' ? requestContext(request, listenerOptions) : requestContextFor(request, listenerOptions);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', PRIVATE_NO_STORE);
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (security.secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    let savingSocket, ownsImport;
    function saveFinished() {
      if (!savingSocket) return;
      const socket = savingSocket; savingSocket = undefined;
      const remaining = (transport.savingConnections.get(socket) ?? 1) - 1;
      if (remaining) transport.savingConnections.set(socket, remaining); else transport.savingConnections.delete(socket);
      if (transport.connectionDeadlinePassed && !remaining) socket.destroySoon();
    }
    response.once('finish', saveFinished); response.once('close', saveFinished);
    try {
      let identity;
      const rawPath = (request.url ?? '/').split('?')[0];
      let route;
      try { route = decodeURIComponent(rawPath); } catch { throw httpError(400, 'Invalid URL.'); }
      if (route.includes('\\') || route.includes('\0') || route.split('/').some(part => part === '..' || part === '.')) throw httpError(404, 'Not found.');
      const ownerRestore = pickerId !== 'legacy' && /^\/api\/(?:restore|import)(?:\/preview)?$/.test(route);
      if (security.publicRequest && apiPermission(request.method, route) === 'admin' && !ownerRestore) throw httpError(403, 'Administrator access requires a private connection.');
      if (await gamePlugin.handle(request, response, { route, security, closed })) return;
      if (await overlays.handle(request, response, { route, security, closed })) return;
      const authRoute = route.startsWith('/auth/');
      if (authRoute) limits.unauthenticated(security.rateKey);
      try { identity = invites.authenticate(request, security); } catch (failure) {
        // A browser that once opened admin through the public link still sends
        // that cookie. Page visits drop it and reload as a visitor; API calls and
        // bearer credentials keep the explicit refusal.
        if (failure.status !== 403 || !security.publicRequest || request.headers.authorization || route.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) throw failure;
        const location = /^\/(?![/\\])/.test(request.url ?? '') ? request.url : '/';
        response.writeHead(303, { Location: location, 'Cache-Control': PRIVATE_NO_STORE,
          'Set-Cookie': invites.cookie('', security).replace(/Max-Age=\d+/, 'Max-Age=0') });
        response.end(); return;
      }
      if (await signInFlow.handle(request, response, { route, security, identity, budgeted: authRoute })) { endInactiveClients(); return; }
      if (!identity) limits.unauthenticated(security.rateKey);
      if (request.method === 'GET' && route.startsWith('/join/')) {
        if (closed) throw httpError(503, 'Please try again later.');
        const finishJoin = limits.beginJoin(security.rateKey);
        if (signIn !== 'off' && security.publicRequest) {
          const invite = invites.inspectToken(route.slice('/join/'.length), security);
          if (invite && !invite.admin && !invite.viewer && await signInFlow.join(request, response, { invite, security, identity })) {
            finishJoin(true); return;
          }
        }
        const session = await invites.join(route.slice('/join/'.length), security);
        finishJoin(!!session);
        if (!session) throw httpError(401, 'Access required.');
        endInactiveClients();
        response.writeHead(303, { Location: '/', 'Cache-Control': PRIVATE_NO_STORE,
          'Set-Cookie': invites.cookie(session, security) });
        response.end(); return;
      }
      if (await serveGallery(request, response, { route, identity, dataset, privateAddon: privateAddon?.features.gallery ? privateAddon : null })) return;
      if (!identity) {
        if (route.startsWith('/api/')) throw httpError(401, 'Access required.');
        if (route === '/' && signIn !== 'off' && security.publicRequest && await signInFlow.join(request, response, { invite: null, security, identity: null })) return;
        response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': PRIVATE_NO_STORE });
        response.end('Access required.'); return;
      }
      // Health probes must remain read only while standby/freeze is active.
      if (route !== '/api/health' && !liveSwap?.standby && !identity.pickerId) await invites.touch(identity);
      // A concurrent revoke can finish while persisting the usage timestamp.
      identity = invites.authenticate(request, security);
      if (!identity) throw httpError(401, 'Access required.');
      // Aggregate usage is the sole viewer POST exception; gameplay stays read only.
      const usageWrite = route === '/api/usage' && request.method === 'POST';
      if (identity.readOnly && !['GET', 'HEAD'].includes(request.method) && !usageWrite) throw httpError(403, 'This link is view only.');
      function requireAdmin() {
        if (security.publicRequest) throw httpError(403, 'Administrator access requires a private connection.');
        if (!identity.admin) throw httpError(403, 'Administrator access required.');
      }
      function requirePermission() {
        const permission = apiPermission(request.method, route);
        if (!permission) {
          const methodRejected = route === '/api/chunk-sections' || route === '/api/usage';
          throw httpError(methodRejected ? 405 : 404, methodRejected ? 'Method not allowed.' : 'API route not found.');
        }
        if (identity.readOnly && !usageWrite && (!['GET', 'HEAD'].includes(request.method) || !['read', 'saved-tasks'].includes(permission))) throw httpError(403, 'This link is view only.');
        if (permission === 'admin' && !(ownerRestore && identity.role === 'owner')) requireAdmin();
      }
      if (!originalSyncIntegration && (route.startsWith('/api/original-sync/') || unavailableDatasetFeature(dataset, route) === 'originalSync')) {
        throw httpError(404, 'Not found.');
      }
      if (privateAddon?.features.originalSync && route.startsWith('/api/original-sync/')) await privateAddon.verify();
      if (route.startsWith('/api/')) {
        requirePermission();
        // Stable invitation identity: opening new sessions or changing IP cannot reset it.
        const expensiveRead = ['GET', 'HEAD'].includes(request.method)
          && ['/api/tasks', '/api/helper-drops', '/api/teleports', '/api/training-plan', '/api/area-check', '/api/predict', '/api/death-estimates', '/api/chunk-planning'].includes(route)
          && !(identity.readOnly && route === '/api/tasks');
        const expensiveWrite = request.method === 'POST'
          && ['/api/sandbox/evaluate', '/api/prediction-intent', '/api/pool-ranking-intent', '/api/profile/preview', '/api/runemetrics/preview', '/api/original-sync/preview'].includes(route);
        if (expensiveRead || expensiveWrite) pickerLimits ? pickerLimits.expensive(identity, pickerId) : limits.expensive(identity.pickerId ? `account:${identity.accountId}` : identity.inviteId ?? identity.kind);
        if (unavailableDatasetFeature(dataset, route)) throw httpError(422, 'This feature is unavailable in this game.');
        if (closed && route !== '/api/health') throw httpError(503, 'The picker is stopping. Retry after it restarts.');
        if (await usage.handle(request, response, { route, security, identity, closed: () => closed, checkRequestOrigin })) return;
        if (route === '/api/chunk-sections' && request.method !== 'GET') throw httpError(405, 'Method not allowed.');
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (route === '/api/game-plugin') { await json(request, response, 200, gamePlugin.list(identity)); return; }
          if (route === '/api/game-plugin/review') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            if ([...query.keys()].some(key => key !== 'memberId') || query.getAll('memberId').length !== 1) throw httpError(400, 'Choose a player for game progress review.');
            await json(request, response, 200, gamePlugin.review(identity, query.get('memberId'))); return;
          }
          if (route === '/api/session') { await json(request, response, 200, { ...(pickerRouting ? { multiPicker: true, pickerId: identity.pickerId ?? pickerRouting.registry?.listPickers().find(p => p.kind === 'legacy-shared')?.id ?? pickerId, pickerRoute: pickerId } : {}), admin: identity.admin, ...(security.publicRequest ? { adminAvailable: false } : {}), readOnly: identity.readOnly, capabilities: identity.capabilities, label: identity.label, kind: identity.kind, memberId: identity.memberId ?? null, actor: identity.actor, ...(identity.pickerId ? { accountId: identity.accountId, pickerId: identity.pickerId } : {}), ...(pickerRouting?.sessionView ?? signInFlow.sessionView)(identity, security, request) }); return; }
          if (route === '/api/accounts') { requireAdmin(); await json(request, response, 200, { accounts: accounts.list() }); return; }
          if (route === '/api/pool-ranking') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const captured = calculationState(), state = captured.state, memberId = query.get('memberId');
            if (!state.members.some(member => member.id === memberId)) throw httpError(400, 'Choose a known player to compare the roll pool.');
            const ids = await rankingPoolIds(state, memberId);
            // Like the map's pool membership, this read is available to viewers.
            // It only reads saved prediction deltas; no worker admission or touch.
            const ranking = poolRanking.read(captured.input, memberId, state.revision, ids,
              id => taskWorker?.peekPrediction(state, memberId, id, captured.input));
            await json(request, response, 200, ranking); return;
          }
          if (route === '/api/tasks' && identity.readOnly) { await readSavedTasks(request, response); return; }
          if (route === '/api/backlog-search') {
            const memberId = new URL(request.url, 'http://localhost').searchParams.get('memberId'), state = store.getTaskClaimState();
            const member = state.members.find(member => member.id === memberId);
            if (!member) throw httpError(400, 'Choose a known player to search the Backlog.');
            const taskIds = Object.keys(member.taskStatus ?? {}).filter(id => member.taskStatus[id].backlogged);
            const tasks = backlogSearchTasks({ definitions: parsedDefinitions, catalogue: taskWorker?.catalogue, dynamicCatalogue: taskWorker?.dynamicCatalogue,
              registry: state.identityRegistry, taskIds, sourceLocations: trainingSourceIndex ??= createTrainingSourceIndex(parsedDefinitions) });
            await json(request, response, 200, { memberId, stateRevision: state.revision, tasks }); return;
          }
          if (route === '/api/coordination') { await json(request, response, 200, coordinationView(store, identity)); return; }
          if (route === '/api/invites') { requireAdmin(); await json(request, response, 200, { invites: invites.list(), publicOrigin }); return; }
          if (route === '/api/feedback') { requireAdmin(); await json(request, response, 200, { items: redactInviteFields(feedback.list()), ...feedback.counts() }); return; }
          if (route === '/api/feedback/summary') { await json(request, response, 200, feedback.summary(feedbackActor(identity), identity.admin)); return; }
          if (route === '/api/feedback/own') { await json(request, response, 200, { items: redactInviteFields(feedback.own(feedbackActor(identity))) }); return; }
          if (route === '/api/backup-status') { requireAdmin(); await json(request, response, 200, await readBackupStatus(dataDir, { directory: backupStatusDir })); return; }
          if (route === '/api/admin/master-link') { requireAdmin(); await json(request, response, 200, { link: transport.inviteUrl() }); return; }
          if (route === '/api/icons') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const kind = query.get('kind'), name = query.get('name');
            if (!['skill', 'item'].includes(kind) || !name?.trim()) throw httpError(400, 'Use kind=skill or kind=item and a name.');
            const icon = (await iconCatalogue()).lookup(kind, name);
            await json(request, response, 200, { kind, name, url: icon?.url ?? null, canonicalName: icon?.name ?? null }); return;
          }
          if (route.startsWith('/api/ids/')) {
            let id;
            try { id = decodeURIComponent(route.slice('/api/ids/'.length)); } catch { throw httpError(400, 'Malformed picker ID.'); }
            if (!isPermanentId(id)) throw httpError(400, 'Use a permanent picker ID.');
            const identity = lookupIdentity(id);
            if (!identity) throw httpError(404, 'Unknown permanent picker ID.');
            await json(request, response, 200, { schemaVersion: 1, id: identity.id, label: identity.label, kind: identity.kind,
              ...(identity.category ? { category: identity.category } : {}), aliases: identity.aliases }); return;
          }
          if (route === '/api/state') {
            const view = viewFor(request), info = store.getInfo();
            if (!identity.readOnly && request.method === 'GET' && foregroundCompletedRevision < info.revision && lastUnchangedTaskRevision !== info.revision) awaitForeground(info.revision);
            await sendCached(request, response, await stateRepresentation(view, info)); return;
          }
          if (route === '/api/dataset-status') { await json(request, response, 200, dataset.status()); return; }
          if (route === '/api/dataset-runtime') { await sendCached(request, response, cachedValue(`dataset-runtime:${dataset.digest}`, () => browserDataset)); return; }
          if (route === '/api/dataset-input') {
            if (new URL(request.url, 'http://localhost').searchParams.get('digest') !== dataset.digest) throw httpError(409, 'Game data changed. Reload the picker.');
            const key = new URL(request.url, 'http://localhost').searchParams.get('key');
            if (!dataset.files.some(file => file.path === key && file.kind === 'input' && file.path.endsWith('.json'))) throw httpError(404, 'Not found.');
            await jsonBytes(request, response, 200, dataset.bytes(key)); return;
          }
          if (route === '/api/art-status') {
            await json(request, response, 200, await art.status()); return;
          }
          if (route === '/api/roll-stats') {
            const query = new URL(request.url, 'http://localhost').searchParams, anchor = query.get('stateRevision');
            if (query.getAll('stateRevision').length > 1 || (anchor !== null && (!/^\d+$/.test(anchor) || !Number.isSafeInteger(Number(anchor))))) throw httpError(400, 'Roll stats stateRevision must be a nonnegative safe integer.');
            await json(request, response, 200, await store.getRollStats({ stateRevision: anchor === null ? undefined : Number(anchor) })); return;
          }
          if (route === '/api/history') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const keys = ['limit', 'before', 'player', 'type', 'q', 'stateRevision'];
            if (!keys.some(key => query.has(key))) { await json(request, response, 200, store.getHistory()); return; }
            for (const key of keys) if (query.getAll(key).length > 1) throw httpError(400, `History ${key} may only be specified once.`);
            const integer = key => {
              if (!query.has(key)) return undefined;
              const value = query.get(key);
              if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw httpError(400, `History ${key} must be a nonnegative safe integer.`);
              return Number(value);
            };
            const result = await store.queryHistory({ limit: integer('limit'), before: integer('before'), stateRevision: integer('stateRevision'),
              player: query.get('player') || undefined, type: query.get('type') || undefined, q: query.get('q') ?? '',
              labels: { chunkName: id => indexedWorld.chunks.get(id)?.name ?? indexedWorld.areas.get(id)?.name ?? id,
                ruleLabel: id => ruleRegistry.get(id)?.label ?? id, routeLabel: id => transportRouteById.get(id)?.name ?? id } });
            await json(request, response, 200, result); return;
          }
          if (route.startsWith('/api/history/')) {
            const revision = route.slice('/api/history/'.length), query = new URL(request.url, 'http://localhost').searchParams;
            const anchor = query.get('stateRevision');
            if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw httpError(400, 'History revision must be a nonnegative safe integer.');
            if (query.getAll('stateRevision').length > 1 || (anchor !== null && (!/^\d+$/.test(anchor) || !Number.isSafeInteger(Number(anchor))))) throw httpError(400, 'History stateRevision must be a nonnegative safe integer.');
            await json(request, response, 200, await store.readHistoryEvent(Number(revision), { stateRevision: anchor === null ? undefined : Number(anchor) })); return;
          }
          if (route === '/api/display-world') {
            await sendCached(request, response, cachedValue('display-world', () => projectDisplayWorld(indexedWorld))); return;
          }
          if (route === '/api/health') {
            const worker = taskWorker?.getHealth() ?? { status: 'not-configured', ready: true, restartRequired: false };
            const warming = startupWarmup && ['pending', 'running'].includes(startupWarmup.diagnostics().status);
            await json(request, response, 200, { ready: !closed && !handover.frozen && worker.ready && !worker.stuck && !worker.restartRequired, status: closed ? 'stopping' : handover.frozen ? 'updating' : worker.stuck ? 'stuck' : worker.restartRequired ? 'restart-required' : warming ? 'warming' : worker.ready ? 'ready'
              : ['sleeping', 'waking'].includes(worker.status) ? worker.status : 'degraded',
              savesReady: !closed && !handover.frozen && !liveSwap?.standby, standby: liveSwap?.standby === true, worker, local: true, revision: store.getInfo().revision, version: appVersion, schemaVersion: 1,
              liveSwapProtocol: 2, actionReceiptFormat: 2, saveSchemaVersion: store.getInfo().schemaVersion }); return;
          }
          if (route === '/api/changelog' || route === '/api/roadmap') {
            const filename = route === '/api/changelog' ? 'changelog.json' : 'roadmap.json';
            let value = route === '/api/changelog' ? { entries: [] } : { items: [] };
            if (datasetFeature(dataset, 'projectUpdates')) value = privateAddon?.features.projectUpdates
              ? await privateAddon.json(`app/data/${filename}`)
              : JSON.parse(await readFile(path.join(ROOT, 'app', 'data', filename), 'utf8'));
            await json(request, response, 200, value); return;
          }
          if (route === '/api/diagnostics') {
            await json(request, response, 200, { status: closed ? 'stopping' : 'running', ...(taskWorker?.getDiagnostics() ?? { worker: { status: 'not-configured' } }),
              poolRanking: poolRanking.diagnostics(),
              referenceCache: { entries: 2, bytes: runtime.definitionCache.retainedBytes + runtime.taskCache.retainedBytes },
              startupTimingMs: { ...startupTimingMs },
              startupPrepared: { ...startupPrepared },
              startupWarmup: startupWarmup?.diagnostics() ?? { status: 'disabled' },
              idleGc: idleMemory.diagnostics(),
              viewerTaskCache: { entries: savedTaskResults.size,
                playBytes: [...savedTaskResults.values()].reduce((sum, row) => sum + row.bytes, 0),
                fullCompressedBytes: [...savedTaskResults.values()].reduce((sum, row) => sum + retainedFullBytes(row), 0) },
              responseCache: { entries: responseCache.size, bytes: responseCache.bytes }, staticCache: { entries: runtime.staticCache.size, bytes: runtime.staticCache.bytes } }); return;
          }
          if (route === '/api/definitions') {
            const view = new URL(request.url, 'http://localhost').searchParams.get('view');
            if (view === 'map-layers-v1') { await sendCached(request, response, cachedValue('map-layer-definitions', () => projectMapLayerData(parsedDefinitions))); return; }
            const display = view === 'display-v1';
            await sendCached(request, response, display ? cachedValue('display-definitions', () => ({ chunks: parsedDefinitions.chunks })) : runtime.definitionCache); return;
          }
          if (route === '/api/map-info') { await sendCached(request, response, await loadMapInfo(store.getRules()['content.f2p'] !== false)); return; }
          if (route === '/api/npcs-and-shops') { await sendCached(request, response, await loadNpcShopInfo()); return; }
          if (route === '/api/archaeology-catalogue') { await sendCached(request, response, await loadArchaeology()); return; }
          if (route === '/api/chunk-sections') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const chunk = query.get('chunk');
            if (query.getAll('chunk').length !== 1 || !/^[1-9]\d*$/.test(chunk ?? '') || !Number.isSafeInteger(Number(chunk))) throw httpError(400, 'Use an exact base chunk ID.');
            if (!indexedWorld.chunks.has(chunk)) throw httpError(404, 'Unknown picker chunk.');
            await json(request, response, 200, chunkSectionsPayload(indexedWorld, chunk, await loadChunkSections())); return;
          }
          if (route === '/api/interior-maps') {
            const interiors = await loadInteriors();
            const query = new URL(request.url, 'http://localhost').searchParams;
            if (!query.has('area')) { await sendCached(request, response, interiors.cache); return; }
            const id = query.get('area');
            if (!id?.trim()) throw httpError(400, 'Use an exact picker area ID.');
            const area = getInteriorArea(interiors.index, id);
            if (!area) throw httpError(404, 'Unknown picker interior area.');
            await json(request, response, 200, { schemaVersion: 1, version: interiors.payload.version, displayOnly: true, accessEffect: 'none',
              assets: interiors.payload.assets, area }); return;
          }
          if (route === '/api/task-map') { await sendCached(request, response, runtime.taskCache); return; }
          if (route === '/api/training-catalogue') { await json(request, response, 200, { ...trainingCatalogue,
            mining: { pickaxes: MINING_PICKAXES, profiles: MINING_PROFILES },
            woodcutting: { hatchets: WOODCUTTING_HATCHETS } }); return; }
          if (route === '/api/helper-progress') { await json(request, response, 200, store.getProgress()); return; }
          if (route === '/api/xp-choices') {
            const state = store.getState(), memberId = new URL(request.url, 'http://localhost').searchParams.get('memberId');
            if (!state.members.some(member => member.id === memberId)) throw httpError(400, 'Choose a known player to view XP choices.');
            await json(request, response, 200, { stateRevision: state.revision, ...buildXpChoiceView(state, memberId, xpChoiceCatalogue) }); return;
          }
          if (route === '/api/helper-drops') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const state = calculationState().state, memberId = query.get('memberId');
            if (!state.members.some(member => member.id === memberId)) throw httpError(400, 'Choose a known player.');
            if (!taskWorker) throw httpError(503, 'Drop data is unavailable. Enter a drop rate yourself.');
            if (state.rules?.['content.f2p'] === false) { await json(request, response, 200, { memberId, stateRevision: state.revision, drops: [], f2p: false }); return; }
            const controller = new AbortController();
            const disconnected = () => { if (!response.writableEnded) controller.abort(); };
            request.once('aborted', disconnected); response.once('close', disconnected);
            let evaluation;
            try { evaluation = await evaluatedTasks(state, memberId, 'evaluate', undefined, controller.signal); }
            finally { request.off('aborted', disconnected); response.off('close', disconnected); }
            if (response.destroyed) return;
            await json(request, response, 200, { memberId, stateRevision: state.revision, f2p: true, drops: helperDrops(evaluation.result) }); return;
          }
          if (route === '/api/house-storage-catalogue') { await json(request, response, 200, houseStorageCatalogue); return; }
          if (route === '/api/teleports') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const state = calculationState().state, memberId = query.get('member');
            if (!state.members.some(member => member.id === memberId)) throw httpError(400, 'Choose a known player to review Teleports.');
            // The off-state catalogue is a read-only preview. No fact or rule is
            // persisted by opening this panel.
            const preview = state.rules?.['travel.automatic'] === true ? state
              : { ...state, rules: { ...state.rules, 'travel.automatic': true } };
            const travelRows = evaluateTransportRoutes(indexedWorld, preview, memberId);
            const personalTeleports = personalTeleportRows(indexedWorld, state, memberId,
              state.rules?.['travel.automatic'] === true ? travelRows : []).map(({ id, available, reason }) => ({ id, available, reason }));
            const rows = travelRows.map(row => projectTeleportRoute(row, indexedWorld));
            await json(request, response, 200, { stateRevision: state.revision, memberId,
              automatic: state.rules?.['travel.automatic'] === true, rows, personalTeleports,
              counts: { usable: rows.filter(row => row.available).length, total: rows.length } }); return;
          }
          if (route === '/api/skill-guide-catalogue') { await json(request, response, 200, skillGuideCatalogue); return; }
          if (route === '/api/training-plan') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const state = calculationState().state, memberId = query.get('memberId');
            const member = state.members.find(value => value.id === memberId);
            if (!member) throw httpError(400, `Choose a saved player.`);
            const skill = query.get('skill'), preference = query.get('preference') ?? 'all';
            if (preference !== 'all' && !trainingPreferences.includes(preference)) throw httpError(400, `Choose one of the available training plans.`);
            const level = (name, required) => {
              const raw = query.get(name);
              if (raw === null && !required) return undefined;
              if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 120) throw httpError(400, `${name === 'fromLevel' ? 'Starting level' : 'Target level'} must be a whole number from 1 to 120.`);
              return Number(raw);
            };
            const targetLevel = level('targetLevel', true), progress = trainingProgress(member, skill, level('fromLevel', false));
            const gatheringOptions = skill === 'Mining' ? {
              miningPickaxe: query.get('miningPickaxe') ?? member.preferences?.miningPickaxe ?? 'auto',
              miningAttention: query.get('miningAttention') ?? member.preferences?.miningAttention ?? 'active',
            } : skill === 'Woodcutting' ? {
              woodcuttingHatchet: query.get('woodcuttingHatchet') ?? member.preferences?.woodcuttingHatchet ?? 'auto',
            } : {};
            // Validate skill/cap and return unknown progress without calculating
            // tasks or inventing an account level from training capabilities.
            let plan;
            try { plan = planTraining(skill, progress.level, targetLevel, { members: state.rules?.['content.f2p'] === false, ...gatheringOptions }, preference); }
            catch (error) { throw httpError(400, error.message); }
            if (progress.level !== null && !plan.issues?.some(issue => issue.code === 'skill-cap')) {
              if (!taskWorker) throw httpError(503, 'Task data is unavailable for this save.');
              const controller = new AbortController();
              const disconnected = () => { if (!response.writableEnded) controller.abort(); };
              request.once('aborted', disconnected); response.once('close', disconnected);
              let evaluation;
              try { evaluation = await evaluatedTasks(state, memberId, 'evaluate', undefined, controller.signal); }
              finally { request.off('aborted', disconnected); response.off('close', disconnected); }
              if (response.destroyed) return;
              trainingSourceIndex ??= createTrainingSourceIndex(parsedDefinitions);
              const availability = buildTrainingAvailability(evaluation.result, { state, memberId, definitions: parsedDefinitions, sourceLocations: trainingSourceIndex });
              Object.assign(availability, gatheringOptions);
              if (['Mining', 'Woodcutting', 'Fishing'].includes(skill)) {
                bankingRouteProvider ??= createBankingRoutes({ world: indexedWorld,
                  interiorCandidates: privateAddon?.features.bankingInteriors
                    ? await privateAddon.json('app/data/banking-interiors.json') : undefined });
                availability.bankingRoutes = createGatheringRouteLookup(bankingRouteProvider, availability);
                availability.bankingAdvanced = member.preferences?.advanced === true;
              }
              if (progress.xp !== null) availability.currentXp = progress.xp;
              try { plan = planTraining(skill, progress.level, targetLevel, availability, preference); }
              catch (error) { throw httpError(400, error.message); }
            }
            await json(request, response, 200, { ...plan, memberId, stateRevision: state.revision, progress }); return;
          }
          if (route === '/api/area-check') {
            if (!taskWorker) throw httpError(503, 'Task data is unavailable for this save.');
            const query = new URL(request.url, 'http://localhost').searchParams;
            const allowed = new Set(['memberId', 'chunks', 'asMembers', 'revision']);
            if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)) throw httpError(400, 'Use a supported Area check request.');
            const revisionText = query.get('revision');
            if (!revisionText || !/^(0|[1-9]\d*)$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))) throw httpError(400, 'Use the current saved revision.');
            const captured = calculationState(), revision = Number(revisionText);
            if (revision !== captured.metadata.revision) throw httpError(409, 'Your saved map changed. Run Area check again with the latest map.');
            const memberId = query.get('memberId'), membersText = query.get('asMembers') ?? 'false';
            if (!['true', 'false'].includes(membersText)) throw httpError(400, 'Choose whether to check as members.');
            const chunks = query.get('chunks');
            const draft = normalizeAreaCheckRequest({ chunkIds: chunks ? chunks.split(',') : [], asMembers: membersText === 'true' },
              { state: captured.metadata, world: indexedWorld, memberId });
            // Advisory workers are isolated from the live list worker. Only
            // its ordinary presented IDs are needed for the task difference.
            const currentList = savedTaskResults.get(memberId);
            if (currentList?.revision === revision && currentList.playJSON) {
              draft.baselineTaskIds = JSON.parse(currentList.playJSON.toString('utf8')).presentation?.tasks.map(task => task.id);
            }
            const started = performance.now(), controller = new AbortController();
            const disconnected = () => { if (!response.writableEnded) controller.abort(); };
            request.once('aborted', disconnected); response.once('close', disconnected);
            let evaluation;
            try {
              evaluation = await evaluatedTasks(nativeForegroundState ? captured.metadata : captured.state, memberId, 'area-check',
                draft, controller.signal, [], 'full', nativeForegroundState ? captured.stateInput : undefined);
            } finally { request.off('aborted', disconnected); response.off('close', disconnected); }
            if (response.destroyed) return;
            if (store.getInfo().revision !== revision) throw httpError(409, 'Your saved map changed during Area check. Run it again with the latest map.');
            if (!invites.authenticate(request, security)) throw httpError(401, 'Access required.');
            await json(request, response, 200, { ...evaluation.result, memberId, stateRevision: revision,
              cache: { ...evaluation.result.cache, hit: evaluation.hit, evaluationMs: evaluation.evaluationMs,
                timingMs: evaluation.timingMs, requestMs: performance.now() - started, worker: true } }); return;
          }
          if (route === '/api/tasks' || route === '/api/predict' || route === '/api/death-estimates' || route === '/api/chunk-planning') {
            if (!taskWorker) throw httpError(503, 'Task data is unavailable for this save.');
            const query = new URL(request.url, 'http://localhost').searchParams;
            const memberId = query.get('memberId');
            const chunkId = query.get('chunkId');
            const type = route === '/api/predict' ? 'predict' : route === '/api/death-estimates' ? 'death-estimates' : route === '/api/chunk-planning' ? 'chunk-planning' : 'evaluate';
            const savedTasks = savedTaskResults.get(memberId), revision = store.getInfo().revision;
            if (route === '/api/tasks' && taskWorker.getHealth().status === 'sleeping' && savedTasks?.revision === revision
              && (viewFor(request) === PLAY_VIEW ? savedTasks.playJSON : savedTasks.fullGzip && savedTasks.fullBodyRevision === revision)) {
              await readSavedTasks(request, response); return;
            }
            if (route === '/api/tasks' && query.get('projection') === DUO_INSPECTION_VIEW
              && savedTaskResults.get(memberId)?.revision === store.getInfo().revision) {
              await readSavedTasks(request, response); return;
            }
            const captured = calculationState(), serialized = nativeForegroundState && (type === 'evaluate' || type === 'chunk-planning');
            const metadata = captured.metadata;
            if (!memberId || !metadata.members.some(member => member.id === memberId)) throw httpError(400, `Choose a saved player.`);
            const requestedLane = query.get('lane') ?? 'foreground';
            if (!['foreground', 'duo-v1'].includes(requestedLane)) throw httpError(400, 'This task request is not supported. Reload the picker and try again.');
            const evaluationLane = requestedLane === 'duo-v1' ? 'duo' : 'foreground';
            const projection = query.get('projection');
            if (projection !== null && (!['duo-sidebar-v1', DUO_INSPECTION_VIEW].includes(projection) || route !== '/api/tasks' || evaluationLane !== 'foreground' || viewFor(request) !== PLAY_VIEW)) throw httpError(400, 'This task view is not supported. Reload the picker and try again.');
            const duoSidebarProjection = projection === 'duo-sidebar-v1';
            const duoInspectionProjection = projection === DUO_INSPECTION_VIEW;
            if (projection && query.get('revision') !== String(metadata.revision)) throw httpError(409, 'Saved state changed before the duo calculation. Request the current tasks.');
            if (evaluationLane === 'duo') {
              const peerFor = query.get('peerFor');
              if (route !== '/api/tasks' || viewFor(request) !== PLAY_VIEW || peerFor === memberId || !metadata.members.some(member => member.id === peerFor)) throw httpError(400, 'Choose two different saved players to view both task lists.');
              if (query.get('revision') !== String(metadata.revision)) throw httpError(409, 'Saved state changed before the duo calculation. Request the current tasks.');
            }
            if (type === 'evaluate' && viewFor(request) === PLAY_VIEW && evaluationLane === 'foreground' && !duoInspectionProjection) {
              refreshMemberId = memberId;
              requiredTaskMembers = new Set(duoSidebarProjection ? metadata.members.map(member => member.id) : [memberId]);
            }
            const state = serialized ? metadata : captured.state;
            if (route === '/api/chunk-planning' && (!chunkId || chunkId.length > 256 || !(indexedWorld.chunks.has(chunkId) || indexedWorld.areas?.has(chunkId)))) {
              throw httpError(400, 'Use an exact known picker chunk or area ID.');
            }
            let chunkIds = [];
            if (route === '/api/death-estimates') {
              if (chunkId !== null) chunkIds = [chunkId];
              else {
                const member = state.members.find(owner => owner.id === memberId);
                const excluded = new Set([...member.unlocked, ...member.pendingRoll, ...member.blacklisted]);
                const selected = member.selected.filter(id => !excluded.has(id) && indexedWorld.chunks.has(id) && (!indexedWorld.surface || indexedWorld.surface.has(id)));
                chunkIds = [...new Set([...(await evaluatedRollPool(state, memberId)).pool.eligible.map(row => row.id), ...selected])].sort();
              }
            }
            const started = performance.now();
            const controller = new AbortController();
            const disconnected = () => { if (!response.writableEnded) controller.abort(); };
            request.once('aborted', disconnected); response.once('close', disconnected);
            let evaluation;
            const afterRemembered = type === 'evaluate' ? () => {
              if (duoInspectionProjection) {
                const entry = savedTaskResults.get(memberId);
                if (entry?.revision === metadata.revision) inspectionBytes(entry);
              }
              if (response.writableFinished) scheduleClaimCleanup();
              else if (!response.destroyed) response.once('finish', scheduleClaimCleanup);
            } : undefined;
            try { evaluation = await evaluatedTasks(state, memberId, type, chunkId, controller.signal, chunkIds, type === 'evaluate' && viewFor(request) === PLAY_VIEW ? PLAY_VIEW : 'full', serialized ? captured.stateInput : undefined, evaluationLane, duoSidebarProjection, type === 'evaluate' && viewFor(request) !== PLAY_VIEW, afterRemembered); }
            finally { request.off('aborted', disconnected); response.off('close', disconnected); }
            if (response.destroyed) return;
            if (duoInspectionProjection) {
              if (query.get('revision') !== String(store.getInfo().revision)) throw httpError(409, 'Saved state changed during the duo calculation. Request the current tasks.');
              const playBytes = evaluation.playJSON ?? Buffer.from(JSON.stringify(projectPlayResult(evaluation.result)));
              const bytes = projectDuoInspectionJSON(playBytes, inspectionMetadata());
              const suffix = JSON.stringify({ stateRevision: state.revision, memberId, cache: { hit: evaluation.hit,
                evaluationMs: evaluation.evaluationMs, timingMs: evaluation.timingMs, requestMs: performance.now() - started, worker: true } });
              await jsonBytes(request, response, 200, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(`,${suffix.slice(1)}`)])); return;
            }
            const suffix = JSON.stringify({ stateRevision: state.revision, memberId, cache: { ...evaluation.resultCache,
              hit: evaluation.hit, evaluationMs: evaluation.evaluationMs, timingMs: evaluation.timingMs, requestMs: performance.now() - started, worker: true } });
            if (type === 'evaluate') {
              const projectionKey = evaluationLane === 'duo' ? 'duoJSON' : duoSidebarProjection ? 'duoSidebarJSON' : 'playJSON';
              const prefix = viewFor(request) === PLAY_VIEW && evaluation.gzipJSONPrefixes?.[projectionKey];
              const prefixMetadata = evaluation.gzipJSONPrefixMetadata?.[projectionKey];
              // Complete one gzip member. Chrome's HTTP decoder can stop after
              // the first of concatenated members, so the worker leaves its
              // prefix at a flushed block boundary without a final trailer.
              const preparedGzip = prefix && prefixMetadata && acceptsFastGzip(request);
              if (preparedGzip) {
                const suffixBytes = Buffer.from(`,${suffix.slice(1)}`);
                const ending = deflateRawSync(suffixBytes, { level: 1 });
                const trailer = Buffer.alloc(8);
                trailer.writeUInt32LE(crc32(suffixBytes, prefixMetadata.crc32), 0);
                trailer.writeUInt32LE((prefixMetadata.rawLength + suffixBytes.length) >>> 0, 4);
                response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': PRIVATE_NO_STORE,
                  Vary: 'Accept-Encoding', 'Content-Encoding': 'gzip', 'Content-Length': prefix.length + ending.length + trailer.length });
                response.end(request.method === 'HEAD' ? undefined : Buffer.concat([prefix, ending, trailer])); return;
              }
            }
            const bytes = type === 'evaluate' ? viewFor(request) === PLAY_VIEW
              ? evaluationLane === 'duo' ? evaluation.duoJSON ?? evaluation.playJSON : duoSidebarProjection ? evaluation.duoSidebarJSON ?? evaluation.playJSON : evaluation.playJSON
              : evaluation.resultJSON : undefined;
            if (bytes) {
              await jsonBytes(request, response, 200, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(`,${suffix.slice(1)}`)])); return;
            }
            const result = type === 'evaluate' && viewFor(request) === PLAY_VIEW ? projectPlayResult(evaluation.result) : evaluation.result;
            await json(request, response, 200, { ...result, stateRevision: state.revision, memberId,
              ...(type === 'death-estimates' ? { candidateIds: chunkIds } : {}),
              cache: { ...evaluation.result.cache, hit: evaluation.hit, evaluationMs: evaluation.evaluationMs, timingMs: evaluation.timingMs, requestMs: performance.now() - started, worker: true } }); return;
          }
          if (route === '/api/migration') { await json(request, response, 200, migrationSummary(store.getState())); return; }
          if (route === '/api/rules') {
            await sendCached(request, response, cachedValue(`rules:${store.getInfo().revision}`, () => ({ cacheResources: dataset.capabilities.cacheResources, cacheArchaeology: dataset.capabilities.cacheArchaeology, definitions: ruleRegistry.definitions.map(({ candidates, exclude, ...metadata }) => metadata), defaults: ruleRegistry.defaults,
              settings: ruleRegistry.resolve(store.getRules()) }))); return;
          }
          if (route === '/api/backup') {
            const backup = await store.backup();
            if (new URL(request.url, 'http://localhost').searchParams.get('download') === 'gzip') await sendGzipBackup(response, backup, { head: request.method === 'HEAD' });
            else await json(request, response, 200, backup, { 'Content-Disposition': 'attachment; filename="rs3-duo-backup.json"' });
            return;
          }
          if (route === '/api/backups') { await json(request, response, 200, { backups: await store.listBackups() }); return; }
          if (route === '/api/members-start') { await json(request, response, 200, { data: membersStartBanks }); return; }
          if (route.startsWith('/api/backups/')) {
            const id = route.slice('/api/backups/'.length);
            await json(request, response, 200, await store.readBackup(id), { 'Content-Disposition': `attachment; filename="${id.replace(/\.gz$/, '')}"` }); return;
          }
          if (route === '/api/events') {
            if (request.method !== 'HEAD' && !(pickerLimits ? pickerLimits.stream(identity, pickerId, response) : admitStream(identity.pickerId ? `account:${identity.accountId}` : `invite:${identity.inviteId ?? identity.kind}`, response))) return;
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': PRIVATE_NO_STORE, Connection: 'keep-alive' });
            if (request.method === 'HEAD') { response.end(); return; }
            response.write(`event: revision\ndata: ${JSON.stringify({ revision: store.getInfo().revision })}\n\n`);
            response.write(`event: version\ndata: ${JSON.stringify({ version: appVersion })}\n\n`);
            if (taskWorker) response.write(`event: worker\ndata: ${JSON.stringify(taskWorker.getHealth())}\n\n`);
            clients.add(response);
            clientCredentials.set(response, { request, security });
            const heartbeat = setInterval(() => { endInactiveClients(); if (clients.has(response)) writeEvent(response, ': keepalive\n\n'); }, 20000);
            heartbeat.unref();
            const stop = () => { clearInterval(heartbeat); clients.delete(response); clientCredentials.delete(response); };
            request.once('close', stop); response.once('close', stop);
            return;
          }
        } else if (request.method === 'POST') {
          checkRequestOrigin(request, security);
          if (isImportRoute(route) && !admittedImports.has(request)) {
            if (importingBackup) throw httpError(503, 'Another backup is being checked or imported. Wait for it to finish, then try again.');
            importingBackup = ownsImport = true;
          }
          const importedFile = isImportRoute(route) ? (routedBody(request)?.imported ?? await readBackupRequest(request)) : null;
          if (importedFile) importBodyChecks.get(request)?.(importedFile.body);
          const body = importedFile ? importedFile.body : await bodyJSON(request, route === '/api/sandbox/evaluate' ? 64 * 1024 : route === '/api/worker-restart' || route === '/api/prediction-intent' || route === '/api/pool-ranking-intent' || route.startsWith('/api/game-plugin/') || route.startsWith('/api/runemetrics/') || route.startsWith('/api/invites') ? 8192 : route.startsWith('/api/feedback') ? 16384 : MAX_BODY);
          if (importedFile?.uploaded && body.document && route.startsWith('/api/restore')) route = route.replace('/api/restore', '/api/import');
          // Keep slow uploads and reviewed sync-original commands excluded. Only
          // ordinary accepted commands may drain across the freeze boundary.
          if (route === '/api/command' && Object.hasOwn(commandPermissions, body.command?.type)
            && !['sync-original', 'replace-member', 'apply-runemetrics', 'apply-game-progress'].includes(body.command.type)) lease.ordinary();
          if (route === '/api/operator/snapshot') {
            requireAdmin();
            if (!security.masterAllowed || identity.kind !== 'master' || !/^Bearer /i.test(request.headers.authorization ?? '')) throw httpError(403, 'Private operator credentials required.');
            if (closed || liveSwap?.standby || handover.frozen) throw httpError(503, 'The writer is unavailable.');
            if (Object.keys(body).length !== 1 || typeof body.id !== 'string') throw httpError(400, 'Use a snapshot ID.');
            // Flush shutdown-only maintenance while the writer still serves, so
            // an idle final stop can match the checked snapshot byte for byte.
            await store.prepareSnapshot(); await gamePlugin.prepareSnapshot();
            await json(request, response, 200, await snapshotStore(dataDir, body.id)); return;
          }
          const execute = async () => {
            if (closed) throw httpError(503, 'The picker is stopping. Retry after it restarts.');
            // A session may have been revoked while a slow body was arriving.
            identity = invites.authenticate(request, security);
            if (!identity) throw httpError(401, 'Access required.');
            requirePermission();
            if (route === '/api/action-session') {
              if (Object.keys(body).some(key => !['clientId', 'acknowledge'].includes(key))) throw httpError(400, 'Use a client ID and optional acknowledgement.');
              const session = Object.hasOwn(body, 'acknowledge')
                ? await store.acknowledgeActionSession(body.clientId, body.acknowledge, { actor: identity.actor })
                : await store.openActionSession(body.clientId, { actor: identity.actor });
              await json(request, response, 200, session); return;
            }
            const knownMember = value => value === undefined || value === null || store.getState().members.some(member => member.id === value);
            if (route === '/api/pool-ranking-intent') {
              if (!taskWorker) throw httpError(503, 'Task data is unavailable for this save.');
              const captured = calculationState();
              if (typeof body.visible !== 'boolean' || typeof body.watchId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.watchId)
                || typeof body.memberId !== 'string' || !captured.metadata.members.some(member => member.id === body.memberId)) {
                throw httpError(400, 'Choose a player and whether the roll pool is open.');
              }
              if (body.visible && body.revision !== captured.metadata.revision) throw httpError(409, 'The saved map changed.');
              const watcher = JSON.stringify([identity.inviteId ?? identity.kind, body.watchId]);
              const fresh = poolRanking.interest(captured.input, watcher, body.memberId, body.visible);
              if (fresh) taskWorker.notePredictionUse();
              watchRankingLeases();
              schedulePredictions();
              await json(request, response, 200, { memberId: body.memberId, stateRevision: captured.metadata.revision, visible: body.visible }); return;
            }
            if (route === '/api/worker-restart') {
              requireAdmin();
              await json(request, response, 200, taskWorker ? await taskWorker.restartUnhealthy()
                : { restarted: [], worker: { status: 'not-configured', ready: true, stuck: false, restartRequired: false, recovering: false } }); return;
            }
            if (route === '/api/prediction-intent') {
              if (!taskWorker) throw httpError(503, 'The supplied reference data has no task catalogue.');
              const captured = calculationState(), state = captured.state;
              if (!Number.isSafeInteger(body.revision) || body.revision !== state.revision) throw httpError(409, 'The saved map changed.');
              const member = state.members.find(owner => owner.id === body.memberId);
              if (!member || typeof body.chunkId !== 'string' || !/^[1-9]\d*$/.test(body.chunkId)
                || !indexedWorld.chunks.has(body.chunkId) || member.unlocked.includes(body.chunkId)) throw httpError(400, 'Choose a locked chunk for this player.');
              const controller = new AbortController();
              const disconnected = () => { if (!response.writableEnded) controller.abort(); };
              request.once('aborted', disconnected); response.once('close', disconnected);
              try {
                await waitForList(state.revision, controller.signal, captured.input);
                const current = calculationState();
                if (current.input !== captured.input) throw httpError(409, 'The saved map changed.');
                await evaluatedTasks(current.state, member.id, 'predict', body.chunkId, controller.signal);
              } finally { request.off('aborted', disconnected); response.off('close', disconnected); }
              if (response.destroyed) return;
              if (taskFingerprint() !== captured.input) throw httpError(409, 'The saved map changed.');
              if (!invites.authenticate(request, security)) throw httpError(401, 'Access required.');
              await json(request, response, 200, { memberId: member.id, chunkId: body.chunkId, stateRevision: store.getInfo().revision, prepared: true }); return;
            }
            if (route === '/api/sandbox/evaluate') {
              if (!taskWorker) throw httpError(503, 'Task data is unavailable for this save.');
              const started = performance.now();
              const captured = calculationState();
              if (Number.isSafeInteger(body.baseRevision) && body.baseRevision >= 0 && body.baseRevision !== captured.metadata.revision) {
                throw httpError(409, 'Your saved map changed. Reset Sandbox to use the latest map.');
              }
              const state = captured.state;
              const draft = normalizeSandboxRequest(body, { state, world: indexedWorld,
                catalogue: sandboxCatalogue, taskIndex: captured.sandboxTaskIndex });
              const sandboxValidationMs = performance.now() - started, controller = new AbortController();
              const disconnected = () => { if (!response.writableEnded) controller.abort(); };
              request.once('aborted', disconnected); response.once('close', disconnected);
              let evaluation;
              try {
                evaluation = await evaluatedTasks(nativeForegroundState ? captured.metadata : state, draft.memberId, 'sandbox',
                  { changes: draft.changes, ...(draft.previewChunkId !== undefined ? { previewChunkId: draft.previewChunkId } : {}),
                    ...(draft.planningChunkId !== undefined ? { planningChunkId: draft.planningChunkId } : {}) }, controller.signal,
                  [], 'full', nativeForegroundState ? captured.stateInput : undefined);
              } finally { request.off('aborted', disconnected); response.off('close', disconnected); }
              if (response.destroyed) return;
              if (store.getInfo().revision !== draft.baseRevision) throw httpError(409, 'Your saved map changed during the Sandbox preview. Reset Sandbox to use the latest map.');
              // Recheck credentials before releasing a delayed advisory result.
              if (!invites.authenticate(request, security)) throw httpError(401, 'Access required.');
              const poolStarted = performance.now(), poolKey = JSON.stringify([rollPoolCache.input(state), draft.memberId, draft.changes]);
              let pool = sandboxPools.get(poolKey); const poolHit = !!pool;
              if (!pool) {
                const value = await evaluatedRollPool(state, draft.memberId, { changes: draft.changes });
                const rollPool = { ...value.pool, partnerConnections: value.partnerConnections };
                pool = sandboxPools.set(poolKey, createRepresentation(Buffer.from(JSON.stringify(rollPool))));
              }
              const sandboxPoolMs = performance.now() - poolStarted;
              if (response.destroyed) return;
              if (store.getInfo().revision !== draft.baseRevision) throw httpError(409, 'Your saved map changed during the Sandbox preview. Reset Sandbox to use the latest map.');
              if (!invites.authenticate(request, security)) throw httpError(401, 'Access required.');
              const cache = { ...(evaluation.resultCache ?? evaluation.result.cache), hit: evaluation.hit, poolHit,
                evaluationMs: evaluation.evaluationMs, timingMs: { ...evaluation.timingMs, sandboxValidationMs, sandboxPoolMs },
                requestMs: performance.now() - started, worker: true };
              if (evaluation.sandboxJSON) {
                // Native advisory bytes stay serialized through the HTTP/cache
                // thread, just like the ordinary compact task response.
                const bytes = evaluation.sandboxJSON;
                await jsonBytes(request, response, 200, Buffer.concat([bytes.subarray(0, bytes.length - 1),
                  Buffer.from(',"rollPool":'), pool.bytes, Buffer.from(`,"cache":${JSON.stringify(cache)}}`)])); return;
              }
              await json(request, response, 200, { ...evaluation.result, rollPool: JSON.parse(pool.bytes.toString('utf8')), cache }); return;
            }
            // Players can read their own feedback; only admins read all or handle it.
            if (route === '/api/feedback') { await json(request, response, 201, { item: await feedback.add(redactInviteFields(body), redactInviteFields(feedbackActor(identity))) }); return; }
            if (route === '/api/feedback/seen') { await json(request, response, 200, await feedback.markSeen(body.ids, feedbackActor(identity), identity.admin)); return; }
            const feedbackStatus = /^\/api\/feedback\/([a-f0-9-]{36})\/status$/.exec(route);
            if (feedbackStatus) { requireAdmin(); await json(request, response, 200, { item: redactInviteFields(await feedback.setStatus(feedbackStatus[1], body.status)) }); return; }
            const accountAction = /^\/api\/accounts\/([a-f0-9-]{36})\/(unlink|revoke-sessions|delete)$/.exec(route);
            if (accountAction) {
              requireAdmin();
              const [, id, action] = accountAction;
              if (Object.keys(body).some(key => action !== 'unlink' || key !== 'provider')) throw httpError(400, 'Use only the requested account action.');
              if (!accounts.get(id)) throw httpError(404, 'Account not found.');
              if (action === 'unlink' && !['discord', 'google'].includes(body.provider)) throw httpError(400, 'Choose a sign-in provider.');
              // Identity removal also invalidates existing sessions; re-entry uses a remaining identity.
              await invites.revokeAccountSessions(id);
              if (action === 'unlink') {
                await accounts.unlinkIdentity(id, body.provider);
                if (pickerRouting?.registry?.getAccount(id)) await pickerRouting.registry.unlinkIdentity(id, body.provider);
              }
              if (action === 'delete') {
                await accounts.delete(id);
                // Retires the registry copy of a deleted shared-only account so its subjects can rejoin.
                await pickerRouting?.syncLegacy?.();
              }
              endInactiveClients();
              await json(request, response, 200, { status: action === 'delete' ? 'deleted' : 'updated' }); return;
            }
            if (route === '/api/invites') {
              requireAdmin();
              if (!knownMember(body.memberId)) throw httpError(400, 'Choose a known player for the invite.');
              pickerLimits?.invitation(identity, pickerId);
              const created = await invites.create(body);
              const inviteOrigin = created.invite.admin ? security.origin : publicOrigin ?? security.origin;
              await json(request, response, 201, { invite: created.invite, link: `${inviteOrigin}/join/${created.token}` }); return;
            }
            const player = /^\/api\/invites\/([a-f0-9-]{36})\/player$/.exec(route);
            if (player) {
              requireAdmin();
              if (Object.keys(body).some(key => key !== 'memberId') || !knownMember(body.memberId)) throw httpError(400, 'Choose a known player for the invite.');
              await json(request, response, 200, { invite: await invites.setMember(player[1], body.memberId) }); return;
            }
            const revoke = /^\/api\/invites\/([a-f0-9-]{36})\/revoke$/.exec(route);
            if (revoke) {
              requireAdmin();
              if (Object.keys(body).length) throw httpError(400, 'Revoke takes no fields.');
              const invite = await invites.revoke(revoke[1]);
              endInactiveClients();
              await json(request, response, 200, { invite }); return;
            }
            if (['/api/command', '/api/restore', '/api/import', '/api/member-restore', '/api/runemetrics/apply', '/api/game-plugin/apply'].includes(route)) {
              savingSocket = request.socket;
              transport.savingConnections.set(savingSocket, (transport.savingConnections.get(savingSocket) ?? 0) + 1);
            }
            if (route === '/api/game-plugin/keys') { await json(request, response, 201, await gamePlugin.create(identity, body)); return; }
            const pluginRevoke = /^\/api\/game-plugin\/keys\/([a-f0-9-]{36})\/revoke$/.exec(route);
            if (pluginRevoke) { await json(request, response, 200, await gamePlugin.revoke(identity, pluginRevoke[1], body)); return; }
            if (route === '/api/game-plugin/apply' || route === '/api/game-plugin/dismiss') {
              const applying = route.endsWith('/apply'), review = gamePlugin.findReview(identity, body, applying);
              if (applying) {
                const state = await store.command(review.command, body.expectedRevision, { actor: identity.actor });
                await gamePlugin.finish(review.command.memberId);
                await json(request, response, 200, await viewEnvelope(state, viewFor(request)));
              } else { await gamePlugin.finish(review.command.memberId); await json(request, response, 200, { dismissed: true }); }
              return;
            }
            if (route === '/api/shutdown') {
              requireAdmin();
              await json(request, response, 202, { status: 'stopping' });
              void transport.requestClose().catch(() => { process.exitCode = 1; }); return;
            }
            if (route === '/api/runemetrics/preview') {
              if (Object.keys(body).some(key => key !== 'memberId')) throw httpError(400, 'RuneMetrics preview accepts only memberId.');
              const owner = store.getState().members.find(member => member.id === body.memberId);
              if (!owner) throw httpError(400, 'Choose a known player for RuneMetrics sync.');
              let snapshot = await progressClient.snapshot(owner);
              const current = store.getState(), latest = current.members.find(member => member.id === owner.id);
              if (!latest || latest.runescapeName !== owner.runescapeName) throw Object.assign(httpError(409, 'The RuneScape name changed while fetching. Review a new sync.'), { code: 'REVISION_CONFLICT', state: current });
              // A plugin report arriving during a web fetch wins too.
              snapshot = gamePlugin.progressSnapshot(latest) ?? snapshot;
              if (snapshot.available === false) { await json(request, response, 200, { ...snapshot, memberId: owner.id, runescapeName: owner.runescapeName ?? '' }); return; }
              const proposal = previewProgress(current, owner.id, snapshot, questMapping);
              const previewId = randomUUID(), createdAt = Date.now();
              for (const [id, review] of runeMetricsPreviews) if (createdAt - review.createdAt >= previewLifetimeMs) runeMetricsPreviews.delete(id);
              runeMetricsPreviews.set(previewId, { ...proposal, createdAt });
              while (runeMetricsPreviews.size > 20) runeMetricsPreviews.delete(runeMetricsPreviews.keys().next().value);
              await json(request, response, 200, { ...proposal.preview, previewId }); return;
            }
            if (route === '/api/original-sync/preview') {
              if (Object.keys(body).length) throw httpError(400, 'Original-picker preview takes no fields; saved source map IDs identify the players.');
              const snapshot = await originalSyncClient.snapshot();
              const syncState = store.getInfo().retention.historyArchives ? (await store.backup()).state : store.getState();
              const proposal = originalSyncIntegration.previewOriginalSync(syncState, snapshot.document, snapshot.warnings, {
                taskMap: parsedTaskMap, taskMapHistory: identityHistory,
                catalogue: taskWorker?.catalogue ?? [], dynamicCatalogue: taskWorker?.dynamicCatalogue ?? [],
              });
              const previewId = randomUUID(), createdAt = originalSyncNow();
              for (const [id, review] of originalSyncPreviews) if (createdAt - review.createdAt >= previewLifetimeMs) originalSyncPreviews.delete(id);
              originalSyncPreviews.set(previewId, { ...proposal, createdAt });
              while (originalSyncPreviews.size > 20) originalSyncPreviews.delete(originalSyncPreviews.keys().next().value);
              await json(request, response, 200, { ...proposal.preview, previewId, cached: snapshot.cached,
                expiresAt: new Date(createdAt + previewLifetimeMs).toISOString() }); return;
            }
            if (route === '/api/runemetrics/apply') {
              if (Object.keys(body).some(key => !['previewId', 'expectedRevision'].includes(key))) throw httpError(400, 'RuneMetrics apply accepts only previewId and expectedRevision.');
              if (typeof body.previewId !== 'string' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw httpError(400, 'A reviewed preview ID and revision are required.');
              const review = runeMetricsPreviews.get(body.previewId);
              if (!review || Date.now() - review.createdAt >= previewLifetimeMs) {
                runeMetricsPreviews.delete(body.previewId);
                throw httpError(410, 'This RuneMetrics preview expired or was already applied. Fetch and review again.');
              }
              if (review.preview.stateRevision !== body.expectedRevision) throw Object.assign(httpError(409, 'The reviewed revision does not match. Fetch and review RuneMetrics again.'), { code: 'REVISION_CONFLICT', state: store.getState() });
              const state = await store.command(review.command, body.expectedRevision, { actor: identity.actor });
              runeMetricsPreviews.delete(body.previewId);
              await json(request, response, 200, await viewEnvelope(state, viewFor(request))); return;
            }
            if (route === '/api/profile/preview') {
              const state = store.getState();
              await json(request, response, 200, { ...previewRuleProfile(state, body.profile, body.memberId, ruleRegistry), stateRevision: state.revision }); return;
            }
            if (route === '/api/command') {
              if (body.command?.type === 'prune-task-claims') throw httpError(400, 'Task claims are tidied up automatically.');
              if (!Object.hasOwn(commandPermissions, body.command?.type)) throw httpError(400, 'Unknown gameplay command.');
              if (body.command?.type === 'replace-member') throw httpError(400, 'To replace a player’s map, review the backup in Backup & Import first.');
              if (body.command?.type === 'apply-game-progress') throw httpError(400, 'Review game plugin progress before applying it.');
              if (body.command?.type === 'apply-runemetrics') throw httpError(400, 'Review the RuneMetrics sync preview before saving progress.');
              let command = body.command;
              if (command.type !== 'sync-original') {
                // Resolve committed Undo before checking its now-changed target.
                const replay = await store.replayCommandSerialized(command, body.requestId, { actor: identity.actor, view: viewFor(request), requestAck: body.requestAck });
                if (replay) { await commandJSON(request, response, replay); return; }
              } else if (body.requestId !== undefined || body.requestAck !== undefined) throw httpError(400, 'Sync requires its reviewed preview.');
              if (unavailableDatasetFeature(dataset, route, command?.type)) throw httpError(422, 'This feature is unavailable in this game.');
              if (command?.type === 'set-transport-facts' && !identity.admin && (!identity.memberId || command.memberId !== identity.memberId)) {
                throw httpError(403, 'You can only change travel facts for your signed-in player.');
              }
              if (command?.type === 'set-xp-choices' && !identity.admin && (!identity.memberId || command.memberId !== identity.memberId)) {
                throw httpError(403, 'You can only change XP choices for your signed-in player.');
              }
              if (command?.type === 'set-finish-line-custom' && !identity.admin && (!identity.memberId || command.memberId !== identity.memberId)) {
                throw httpError(403, 'You can only tick custom finish line items for your signed-in player.');
              }
              if (command?.type === TICK_ACTIVE_TASKS) { const denied = tickActiveTasksDenied(identity, command); if (denied) throw httpError(403, denied); }
              if (command?.type === 'undo' && !identity.admin) {
                const target = store.getHistoryEvent(command.undoRevision ?? store.getUndoEligibility().undoRevision);
                const tickDenied = tickActiveTasksDenied(identity, command, target);
                if (tickDenied) throw httpError(403, tickDenied);
                if (target?.type === 'set-finish-line-custom' && (!identity.memberId || target.command?.memberId !== identity.memberId)) {
                  throw httpError(403, 'You can only undo finish line ticks for your signed-in player.');
                }
                if (target?.type === 'set-transport-facts' && (!identity.memberId || target.command?.memberId !== identity.memberId)) {
                  throw httpError(403, 'You can only undo travel facts for your signed-in player.');
                }
                if (target?.type === 'set-xp-choices' && (!identity.memberId || target.command?.memberId !== identity.memberId)) {
                  throw httpError(403, 'You can only undo XP choices for your signed-in player.');
                }
              }
              if (command?.type === 'set-obtained-equipment') {
                if (!identity.admin && command.memberId !== identity.memberId) throw httpError(403, 'You can only record obtained equipment for your signed-in player.');
                if (typeof command.equipmentName !== 'string' || !Object.hasOwn(parsedDefinitions.equipment ?? {}, command.equipmentName)) throw httpError(400, 'Choose known equipment from the catalogue.');
              }
              if (['claim-task', 'clear-task-claim'].includes(command?.type) && identity.memberId && command.memberId !== identity.memberId) {
                throw httpError(403, 'You can only mark or stop tasks as your signed-in player.');
              }
              if (command?.type === 'undo' && identity.memberId) {
                const revision = command.undoRevision ?? store.getUndoEligibility().undoRevision;
                const target = store.getHistoryEvent(revision);
                if (target?.type === 'set-obtained-equipment' && !identity.admin && target.command?.memberId !== identity.memberId) throw httpError(403, 'You can only undo obtained equipment records for your signed-in player.');
                if (['claim-task', 'clear-task-claim'].includes(target?.type) && target.command?.memberId !== identity.memberId) {
                  throw httpError(403, 'You can only undo task claims made by your signed-in player.');
                }
              }
              response.once('finish', scheduleClaimCleanup);
              if (command?.type === 'sync-original') {
                if (!originalSyncIntegration) throw httpError(404, 'Not found.');
                if (privateAddon?.features.originalSync) await privateAddon.verify();
                if (Object.keys(command).some(key => !['type', 'previewId', 'members'].includes(key)) || typeof command.previewId !== 'string') throw httpError(400, 'Original-picker sync requires a reviewed preview ID and group selections.');
                const review = originalSyncPreviews.get(command.previewId);
                if (!review || originalSyncNow() - review.createdAt >= previewLifetimeMs) {
                  originalSyncPreviews.delete(command.previewId);
                  throw httpError(410, 'This original-picker preview expired or was already applied. Fetch and review again.');
                }
                if (review.preview.currentRevision !== body.expectedRevision) throw Object.assign(httpError(409, 'The reviewed revision does not match. Fetch and review the original picker again.'), { code: 'REVISION_CONFLICT', state: store.getState() });
                const previewId = command.previewId;
                command = originalSyncIntegration.originalSyncCommand(review, command.members);
                const saved = await store.commandSerialized(command, body.expectedRevision, { omitUnchanged: true, actor: identity.actor, view: viewFor(request) });
                originalSyncPreviews.delete(previewId);
                await commandJSON(request, response, saved); return;
              }
              await commandJSON(request, response, await store.commandSerialized(command, body.expectedRevision, { omitUnchanged: true, actor: identity.actor, view: viewFor(request), requestId: body.requestId, requestAck: body.requestAck })); return;
            }
            // One player's map: admins choose any player; an invite only its own player.
            if (route === '/api/member-restore/preview' || route === '/api/member-restore') {
              if (!identity.admin && (!identity.memberId || identity.memberId !== body.memberId)) throw httpError(403, 'This link can only restore its own player’s map.');
              const current = store.getState();
              const owner = current.members.find(member => member.id === body.memberId);
              if (!owner) throw httpError(400, 'Choose a known player.');
              const backup = await restoreBackup(body), retained = Object.hasOwn(body, 'backupId');
              const legacy = backup === undefined;
              const imported = legacy ? convertLegacyCapture(body.document, { members: body.members, capturedAt: body.capturedAt, registry: ruleRegistry }) : null;
              const incoming = legacy ? imported.state : importBackup(backup, registry);
              const member = incoming.members.find(item => item.id === owner.id);
              if (!member) throw httpError(400, `This backup has no map for ${owner.name}.`);
              if (legacy) member.obtainedEquipment = [...(owner.obtainedEquipment ?? [])];
              const command = { type: 'replace-member', memberId: owner.id, member, source: legacy ? 'Original picker import' : 'Backup' };
              const warnings = imported?.warnings ?? [];
              if (route.endsWith('/preview')) {
                const next = { ...current, members: current.members.map(item => item.id === owner.id ? member : item) };
                // This comparison is a hypothetical map, before the actual
                // replace-member command adds its inverse. Existing undo
                // after-values belong to current, so do not replay them on it.
                const preview = previewRestore({ ...current, history: [] }, { ...next, history: [] }, registry);
                await json(request, response, 200, { preview, warnings,
                  ...(importedFile?.uploaded ? { state: backupPreviewState(next) } : retained ? { state: projectPlayState(next) } : {}) }); return;
              }
              await json(request, response, 200, { ...await viewEnvelope(await store.command(command, body.expectedRevision, { actor: identity.actor }), viewFor(request)), warnings }); return;
            }
            // Replacing the whole save is an administrator action; invites keep normal gameplay.
            if (/^\/api\/(?:restore|import)(?:\/preview)?$/.test(route) && !(ownerRestore && identity.role === 'owner')) requireAdmin();
            if (route === '/api/restore/preview') {
              // Storage validates the complete public backup at its replacement boundary.
              const replacement = await store.previewReplacement(await restoreBackup(body));
              const preview = previewRestore(replacement.current, replacement.state, registry);
              await json(request, response, 200, importedFile?.uploaded ? { preview, state: backupPreviewState(replacement.state) }
                : Object.hasOwn(body, 'backupId') ? { preview, state: projectPlayState(replacement.state) } : preview); return;
            }
            if (route === '/api/restore') { await json(request, response, 200, await viewEnvelope(await store.replace(await restoreBackup(body), body.expectedRevision, { actor: identity.actor }), viewFor(request))); return; }
            if (route === '/api/import/preview' || route === '/api/import') {
              const imported = convertLegacyCapture(body.document, { members: body.members, capturedAt: body.capturedAt, registry: ruleRegistry });
              const current = store.getState();
              for (const member of imported.state.members) member.obtainedEquipment = [...(current.members.find(owner => owner.id === member.id)?.obtainedEquipment ?? [])];
              if (route.endsWith('/preview')) {
                const replacement = await store.previewReplacement(imported.state);
                await json(request, response, 200, { preview: previewRestore(replacement.current, replacement.state, registry), warnings: [...imported.warnings, ...migrationSummary(replacement.state).warnings],
                  ...(importedFile?.uploaded ? { format: PLAY_VIEW, schemaVersion: 1, state: backupPreviewState(replacement.state) } : await viewEnvelope(replacement.state, viewFor(request))) });
              } else {
                const state = await store.replace(imported.state, body.expectedRevision, { actor: identity.actor });
                await json(request, response, 200, { ...await viewEnvelope(state, viewFor(request)), warnings: [...imported.warnings, ...migrationSummary(state).warnings] });
              }
              return;
            }
            throw httpError(404, 'API route not found.');
          };
          // Order revocation with accepted saves. Once revoke returns, a queued
          // request cannot commit using the revoked session or admin capability.
          const durable = ['/api/action-session', '/api/command', '/api/restore', '/api/import', '/api/member-restore', '/api/runemetrics/apply', '/api/game-plugin/apply', '/api/game-plugin/dismiss', '/api/shutdown'].includes(route)
            || route === '/api/game-plugin/keys' || /^\/api\/game-plugin\/keys\/[^/]+\/revoke$/.test(route)
            || route === '/api/invites' || /^\/api\/invites\/[^/]+\/(?:revoke|player)$/.test(route)
            || /^\/api\/accounts\/[^/]+\/(?:unlink|revoke-sessions|delete)$/.test(route);
          await (durable ? serializeMutation(execute) : execute());
          return;
        }
        throw httpError(404, 'API route not found.');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw httpError(405, 'Method not allowed.');
      let file;
      let iconFile;
      let interiorFile;
      let terrainFile;
      if (route === TERRAIN_MANIFEST_PATH) {
        const catalogue = await terrainCatalogue();
        catalogue.response ??= createRepresentation(Buffer.from(JSON.stringify(catalogue.payload)),
          { cacheControl: catalogue.available ? PRIVATE_REVALIDATE : PRIVATE_NO_STORE });
        await sendRepresentation(request, response, catalogue.response, { conditional: catalogue.available }); return;
      }
      if (route === ICON_MANIFEST_PATH) {
        const catalogue = await iconCatalogue();
        catalogue.response ??= createRepresentation(catalogue.bytes, { cacheControl:
          catalogue.complete && catalogue.manifest.available ? PRIVATE_REVALIDATE : PRIVATE_NO_STORE });
        await sendRepresentation(request, response, catalogue.response, { conditional: catalogue.complete && catalogue.manifest.available }); return;
      }
      if (route === '/') file = await containedFile(webRoot, 'index.html');
      else if (['/overlay-panel.mjs', '/overlay-panel.css', '/game-plugin.mjs', '/game-plugin.css', '/signin.css', '/account-panel.mjs', '/accounts-panel.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/core/chunk-colours.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'chunk-colours.mjs');
      else if (['/chunk-colour-picker.mjs', '/map-chunk-colours.mjs', '/chunk-colours.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/lamp-choices.mjs', '/lamp-choices.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/core/xp-choices.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'xp-choices.mjs');
      else if (['/members-start.mjs', '/members-start.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/core/members-start.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'members-start.mjs');
      else if (route === '/mining-settings.mjs') file = await containedFile(webRoot, 'mining-settings.mjs');
      else if (route === '/woodcutting-settings.mjs') file = await containedFile(webRoot, 'woodcutting-settings.mjs');
      else if (route === '/fishing-display.mjs') file = await containedFile(webRoot, 'fishing-display.mjs');
      else if (route === '/core/mining-settings.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'mining-settings.mjs');
      else if (route === '/core/woodcutting-settings.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'woodcutting-settings.mjs');
      else if (route === '/core/banking-settings.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'banking-settings.mjs');
      else if (route === '/core/gathering-settings.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'gathering-settings.mjs');
      else if (route === '/core/top-bar-settings.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'top-bar-settings.mjs');
      else if (['/top-bar-buttons.mjs', '/top-bar.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/banking-settings.mjs', '/banking-display.mjs', '/banking.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/training/mining-rates.mjs', '/training/mining-rules.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'training'), route.slice('/training/'.length));
      else if (route === '/dataset-runtime.mjs') file = await containedFile(path.join(ROOT, 'app'), 'dataset-runtime.mjs');
      else if (route === '/data/dataset-runtime.json') {
        await sendCached(request, response, cachedValue(`dataset-runtime:${dataset.digest}`, () => browserDataset)); return;
      }
      else if (route.startsWith('/data/') && route.endsWith('.json')) {
        const requestedDigest = new URL(request.url, 'http://localhost').searchParams.get('digest');
        if (requestedDigest && requestedDigest !== dataset.digest) throw httpError(409, 'Game data changed. Reload the picker.');
        const key = datasetCatalogueKey(route, dataset);
        if (!key) throw httpError(404, 'Not found.');
        await sendCached(request, response, createRepresentation(dataset.bytes(key))); return;
      }
      else if (['/training/woodcutting-rates.mjs', '/training/woodcutting-rules.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'training'), route.slice('/training/'.length));
      else if (route === '/pool-ranking.mjs') file = await containedFile(webRoot, 'pool-ranking.mjs');
      else if (['/activity-filters.mjs', '/activity-view.mjs', '/activity-filters.css', '/chunk-quest-filters.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/bis-preferences.mjs', '/bis-recorded.mjs', '/bis-comparison-view.mjs', '/bis-compare.mjs', '/bis-results.mjs', '/bis-compare.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/task-hover.mjs', '/task-why.mjs', '/task-focus.mjs', '/task-methods.mjs', '/task-equipment.mjs', '/task-artwork.mjs', '/task-ui.css', '/bis-panel.css', '/duo-tasks.mjs', '/duo-task-view.mjs', '/duo-tasks.css', '/task-claims.mjs', '/task-filters.mjs', '/task-filters-model.mjs', '/task-filters.css', '/custom-tasks-model.mjs', '/screen-custom-tasks.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/art-status.mjs', '/art-status.css', '/dataset-status.mjs', '/dataset-features.mjs', '/browser-task-icons.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (/^\/placeholder-art\/(?:skill-[a-z]+|task-(?:quest|achievements|minigame|clue|music)|pin-(?:general|transport|skilling|combat-slayer|quests-achievements|minigames|other)|item)\.svg$/.test(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/display-world.mjs') file = await containedFile(path.join(ROOT, 'app'), 'display-world.mjs');
      else if (route === '/data/access-policy.mjs') file = await containedFile(path.join(ROOT, 'app', 'data'), 'access-policy.mjs');
      else if (['/map-activity-layers.mjs', '/map-activity-layer-model.mjs', '/map-activity-layer-renderer.mjs', '/map-activity-layers.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      // Optional full-state tools share these small, pure travel helpers. Their
      // catalogue dependencies already use the selected dataset's static routes.
      else if (['/core/rule-registry.mjs', '/core/progress-index.mjs', '/core/automatic-transport.mjs', '/core/travel-inputs.mjs', '/core/progress-snapshots.mjs', '/core/teleport-returns.mjs', '/core/teleport-return-cache.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/teleports.mjs', '/teleports.css', '/backup-status.mjs', '/backup-transfer.mjs', '/map-display.mjs', '/map-display.css', '/map-task-counts.mjs', '/map-task-count-renderer.mjs', '/map-task-count-obstacles.mjs', '/map-place-labels.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/stream-safe.mjs', '/stream-safe.css', '/feedback-badge.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-roll-stats.mjs', '/roll-stats.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/profile-view.mjs', '/profile-model.mjs', '/profile-copy.mjs', '/profile.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/group-goals.mjs', '/group-goals.css', '/finish-line-view.mjs', '/finish-line-model.mjs', '/finish-line-copy.mjs', '/finish-line.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/screen-chunk-notes.mjs') file = await containedFile(webRoot, 'screen-chunk-notes.mjs');
      else if (['/screen-journal.mjs', '/journal.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/screen-backlog.mjs') file = await containedFile(webRoot, 'screen-backlog.mjs');
      else if (['/duo-task-lists.mjs', '/duo-backlog-view.mjs', '/duo-task-preferences.mjs', '/task-view-preferences.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-search.mjs', '/screen-search-data.mjs', '/search.css', '/map-search-layer.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/phone-layout.css', '/phone-layout.mjs', '/screen-phone-layout.mjs', '/chunk-long-press.mjs', '/map-control-discovery.mjs', '/calculation-feedback.mjs', '/screen-task-guidance.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-usage.mjs', '/usage-client.mjs', '/usage-model.mjs', '/usage-catalogue.mjs', '/usage.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/quest-map.mjs', '/quest-map-model.mjs', '/quest-map.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/live-swap-client.mjs', '/screen-context.mjs', '/browser-state.mjs', '/save-address.mjs', '/http-session-lock.mjs', '/screen-ui.mjs', '/screen-save-status.mjs', '/screen-save-recovery.mjs', '/screen-settings.mjs', '/screen-commands.mjs', '/screen-roll.mjs', '/screen-map.mjs', '/screen-loading.mjs', '/screen-tasks.mjs', '/screen-task-dialogs.mjs', '/screen-chunks.mjs', '/screen-dialogs.mjs', '/screen-history.mjs', '/screen-live.mjs', '/screen-startup.mjs', '/screen-controls.mjs', '/screen-panels.mjs', '/dataset-panels.mjs', '/original-sync-loader.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/map-capture.mjs', '/screen-capture.mjs', '/map-capture.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/area-check.mjs', '/area-check-selection.mjs', '/area-check.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/partner-supply-model.mjs', '/partner-supply-view.mjs', '/partner-supply.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/boss-gates-view.mjs', '/boss-gates.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/tasks/rule-defaults.mjs', '/tasks/task-provenance.mjs', '/tasks/fact-projection.mjs', '/tasks/gameplay-compat.mjs', '/tasks/gameplay-facts.mjs', '/tasks/chunk-planning-index.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'tasks'), route.slice('/tasks/'.length));
      else if (['/data/surface-grid.mjs', '/data/world-connections.mjs', '/data/boss-gates.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
      else if (['/data/cache-archaeology.mjs', '/data/cache-interiors.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
      else if (['/rules-panel.mjs', '/rules-model.mjs', '/rules-review.mjs', '/rules-review-model.mjs', '/rules-review-preview.mjs', '/rule-explanations.mjs', '/rules-review.css', '/kept-rules.mjs', '/sandbox.mjs', '/sandbox.css', '/sandbox-rules.mjs', '/duo-coordination.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/completed-view.mjs', '/completed-model.mjs', '/completed-range.mjs', '/completed-range-preference.mjs', '/completed-view.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/helper.mjs', '/helper.css', '/helper-model.mjs', '/helper-training.mjs', '/helper-goals.mjs', '/helper-drops.mjs', '/helper-charts.mjs', '/helper-utilities.mjs', '/helper-progress.mjs', '/helper-progress-model.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/amount-input.mjs') file = await containedFile(webRoot, 'amount-input.mjs');
      else if (['/core/interior-maps.mjs', '/core/archaeology.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/core/experience.mjs', '/core/combat-level.mjs', '/core/f2p-skill-caps.mjs', '/core/finish-line.mjs', '/core/group-goals.mjs', '/core/group-goal-types.mjs', '/core/tick-active-tasks.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/copy-lists.mjs', '/copy-list-control.mjs', '/copy-list-model.mjs', '/copy-lists.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/tick-active-tasks.mjs', '/tick-active-tasks-model.mjs', '/tick-active-tasks.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/setup-guide.mjs', '/setup-guide.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/core/setup-guide.mjs') file = await containedFile(path.join(ROOT, 'app', 'core'), 'setup-guide.mjs');
      else if (route === '/original-sync.mjs' && privateAddon?.features.originalSync) {
        const bytes = await privateAddon.read('app/web/original-sync.mjs');
        await sendCached(request, response, createRepresentation(bytes, { type: MIME['.mjs'] })); return;
      }
      else if (['/style.css', '/map-pin-groups.css', '/main.mjs', '/command-state.mjs', '/map.mjs', '/map-tools.mjs', '/map-pins.mjs', '/map-info.mjs', '/map-terrain.mjs', '/map-pin-renderer.mjs', '/chunk-planning.mjs', '/death-chunks.mjs', '/death-settings.mjs', '/info-panels.mjs', '/settings-panel.mjs', '/runemetrics.mjs', '/original-sync.mjs', '/invites.mjs', '/favicon.svg'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/style.css', '/map-pin-groups.css', '/main.mjs', '/command-state.mjs', '/map.mjs', '/map-tools.mjs', '/map-pins.mjs', '/map-terrain.mjs', '/map-pin-renderer.mjs', '/chunk-planning.mjs', '/death-chunks.mjs', '/death-settings.mjs', '/info-panels.mjs', '/settings-panel.mjs', '/runemetrics.mjs', '/original-sync.mjs', '/icons.mjs', '/interior-view.mjs', '/chunk-sections.mjs', '/sticker-picker.mjs', '/history-text.mjs', '/feedback.mjs', '/updates.mjs', '/task-icon-painter.mjs', '/favicon.svg'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/core/territory.mjs', '/core/state.mjs', '/core/rule-reviews.mjs', '/core/rules.mjs', '/core/cache-surface.mjs', '/core/transport-access.mjs', '/core/map-boundaries.mjs', '/core/tasks.mjs', '/core/planning.mjs', '/core/preferences.mjs', '/core/death-settings.mjs', '/core/progress.mjs', '/core/player-controls.mjs', '/core/game-progress.mjs', '/core/map-markers.mjs', '/core/task-alternatives.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/tasks/migration.mjs', '/tasks/rates.mjs', '/tasks/identity.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'tasks'), route.slice('/tasks/'.length));
      else if (['/task-icons.mjs', '/tasks/task-icons.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'tasks'), 'task-icons.mjs');
      else if (route === '/data/skill-guide-rules.mjs') file = await containedFile(path.join(ROOT, 'app', 'data'), 'skill-guide-rules.mjs');
      else if (['/data/world.mjs', '/data/cache-resources.mjs', '/data/cache-topology.mjs', '/data/cache-entry-policy.mjs', '/data/transport-routes.mjs', '/data/settings.mjs', '/data/lodestones.mjs', '/data/map-corrections.mjs', '/data/map-pins.mjs', '/data/map-pin-categories.mjs', '/data/identity-registry.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
      else if (['/assets/map/manifest.json', '/assets/map/pins.normalized.json', '/assets/map/pins.cache-2026-10-08-05932552f7af-v1.json', '/assets/map/manifest.cache-2026-10-08-05932552f7af-v1.json'].includes(route)) {
        const bytes = await datasetLocalMetadataBytes(route, dataset);
        if (!bytes) { if (route.endsWith('/manifest.json')) { await json(request, response, 200, { available: false }); return; } throw httpError(404, 'Not found.'); }
        await sendCached(request, response, createRepresentation(bytes)); return;
      }
      else if (/^\/assets\/map\/sprites\.cache-2026-10-08-05932552f7af-v1\/\d+-\d+\.png$/.test(route)
        || /^\/assets\/map\/terrain\.cache-[a-zA-Z0-9_-]+\/28\/2\/0_\d+_\d+\.png$/.test(route)
        || /^\/assets\/map\/terrain\/28\/2\/0_\d+_\d+\.png$/.test(route)
        || /^\/assets\/map\/icons\/[a-zA-Z0-9_-]+\.png$/.test(route)) file = await art.required('mapAssets', route.slice('/assets/map/'.length));
      else if (route.startsWith('/assets/map/icons-skills.') || route.startsWith('/assets/map/icons-items.')) {
        const catalogue = await iconCatalogue();
        const provenance = catalogue.provenance.get(route);
        if (provenance) {
          await sendCached(request, response, cachedValue(`icon-provenance:${route}`, () => provenance)); return;
        }
        iconFile = catalogue.files.get(route);
        if (!iconFile) throw httpError(404, 'Not found.');
        file = await art.required('iconAssets', iconFile.relative);
      }
      else if (route.startsWith('/assets/map/interiors.cache-')) {
        const interiors = await loadInteriors();
        interiorFile = interiors.available ? interiors.assets.files.get(route) : undefined;
        if (!interiorFile) throw httpError(404, 'Not found.');
        file = await art.required('mapAssets', interiorFile.relative);
      }
      else if (route.startsWith('/assets/map/terrain.optimized-')) {
        const catalogue = await terrainCatalogue();
        terrainFile = catalogue.available ? catalogue.assets.files.get(route) : undefined;
        if (!terrainFile) throw httpError(404, 'Not found.');
        file = await art.required('terrainAssets', terrainFile.relative);
      }
      else if (route === '/assets/fontawesome/fa-solid-900.woff2') {
        // The separately licensed UI font remains available with empty art roots.
        file = await art.file('legacyResources', 'fontawesome/webfonts/fa-solid-900.woff2')
          ?? (dataset.capabilities.independent ? null : await containedFile(path.join(ROOT, 'resources'), 'fontawesome/webfonts/fa-solid-900.woff2'));
        if (!file) throw httpError(404, 'Not found.');
      }
      else if (artBinding(route)) {
        const binding = artBinding(route);
        file = await art.required(binding.component, binding.relative);
      }
      else throw httpError(404, 'Not found.');
      const metadata = await stat(file);
      const expected = iconFile ?? interiorFile ?? terrainFile ?? art.pack.expected(file);
      const key = `${file}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}:${expected?.sha256 ?? ''}`;
      let cached = runtime.staticCache.get(key);
      if (!cached) {
        const bytes = await readFile(file);
        if (expected && (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256)) throw httpError(404, `${iconFile ? 'Icon' : terrainFile ? 'Terrain asset' : 'Interior tile'} does not match its manifest.`);
        const extension = path.extname(file).toLowerCase();
        // Dates and v1 names are revalidated. Only paths carrying a content
        // digest can advertise immutable bytes across application updates.
        const immutable = route.startsWith('/assets/') && /[.-][a-f0-9]{12,}(?:[./-]|$)/i.test(route);
        cached = runtime.staticCache.set(key, createRepresentation(bytes, { type: MIME[extension] ?? 'application/octet-stream',
          cacheControl: immutable ? 'private, max-age=31536000, immutable' : PRIVATE_REVALIDATE,
          compress: ['.html', '.css', '.mjs', '.json', '.svg'].includes(extension) }));
      }
      await sendRepresentation(request, response, cached);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) { response.end(); return; }
      const status = error.code === 'REVISION_CONFLICT' ? 409 : error.status ?? (error.code === 'ENOENT' ? 404 : error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 400 : 500);
      if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
      // Refuse unread/slow uploads without keeping their socket alive.
      if (!request.complete) response.setHeader('Connection', 'close');
      if (signInFlow.errorPage(request, response, security, error, status)) return;
      await json(request, response, status, { message: status === 500 ? 'The save could not be completed. Your previous save remains available.' : error.code === 'ENOENT' ? 'Not found.' : redactInviteTokens(error.message),
        ...(error.code === 'TASK_RESULTS_UNAVAILABLE' || error.code === 'PICKER_UPDATING' || /^(?:REQUEST_|ACTION_SESSION_)/.test(error.code ?? '') ? { code: error.code } : {}),
        ...(error.code === 'ACTION_SESSION_RETIRED' && error.safeToRetry === true ? { safeToRetry: true } : {}),
        ...(error.code === 'REVISION_CONFLICT' ? await viewEnvelope(error.state, viewFor(request)) : {}),
        ...(error.code === 'REVISION_CONFLICT' && error.claimOnlyChanges === true ? { claimOnlyChanges: true } : {}),
        ...((routeIsRuneMetrics(request) || (request.url ?? '').startsWith('/api/original-sync/')) && error.code !== 'REVISION_CONFLICT' && error.code ? { code: error.code } : {}) });
    } finally { if (ownsImport) importingBackup = false; }
  };
  const requestHandler = async (request, response, listener) => {
    let route, lease;
    try {
      if (closed) throw httpError(503, 'The picker is stopping. Retry after it restarts.');
      route = decodeURIComponent((request.url ?? '/').split('?')[0]);
      const health = ['GET', 'HEAD'].includes(request.method) && route === '/api/health';
      const safeStandbyRead = ['GET', 'HEAD'].includes(request.method) && !route.startsWith('/join/')
        && (['/', '/api/health', '/api/art-status', '/api/overlays', '/api/state'].includes(route)
          || (!route.startsWith('/api/') && (route.startsWith('/overlay/') || /\.(?:mjs|css|html|json|svg|png|jpg|webp|woff2)$/.test(route))));
      if ((handover.frozen && !health) || (liveSwap?.standby && !safeStandbyRead)) {
        throw Object.assign(httpError(503, 'Please try again in a moment.'), { code: 'PICKER_UPDATING', retryAfter: 1 });
      }
      // All handlers, including overlays, join, usage retention and invitation
      // touches, enter this exclusion before their first asynchronous operation.
      if (!health) lease = handover.begin();
      await applicationRequestHandler(request, response, lease, listener);
    } catch (error) {
      request.resume();
      if (response.destroyed || response.headersSent) return;
      response.setHeader('Cache-Control', PRIVATE_NO_STORE);
      if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
      await json(request, response, error.status ?? 400, { message: error.status ? error.message : 'Invalid URL.', ...(error.code ? { code: error.code } : {}) });
    } finally { lease?.finish(); }
  };
  let activationPending;
  const context = {
    pickerId, store,
    withEmptyDefault(work) {
      return serializeMutation(() => {
        if (closed || store.getInfo().revision !== 0) throw httpError(409, 'This sign-in already has gameplay.');
        return work();
      });
    },
    fenceRevokedSessions: () => endInactiveClients(),
    revokeDeletionSessions: scope => invites.revokeDeletion(scope),
    async revokeDeletedAccount(accountId) {
      endInactiveClients();
      await invites.revokeDeletion({ accountId });
      await accounts.revokeDeletion(accountId);
      endInactiveClients();
    },
    fenceDeletion() {
      closed = true;
      taskWorker?.cancelPicker?.();
      for (const client of clients) client.end();
      clients.clear(); clientCredentials.clear();
      overlays.fenceDeletion();
    },
    async revokeDeletion() {
      context.fenceDeletion();
      await Promise.all([invites.revokeDeletion({ all: true }), gamePlugin.revokeDeletion(), overlays.revokeDeletion()]);
    },
    sessionView: (identity, security) => signInFlow.sessionView(identity, security),
    checkImportBody(request, check) { importBodyChecks.set(request, check); },
    admitImport(request, security) {
      const identity = invites.authenticate(request, security);
      if (!identity) throw httpError(401, 'Access required.');
      if (pickerId === 'legacy' || identity.role !== 'owner' || identity.readOnly) throw httpError(403, 'Picker owner access required.');
      checkRequestOrigin(request, security);
      if (closed || handover.frozen || liveSwap?.standby) throw httpError(503, 'The picker is stopping. Retry after it restarts.');
      if (importingBackup) throw httpError(503, 'Another backup is being checked or imported. Wait for it to finish, then try again.');
      importingBackup = true; admittedImports.add(request);
      // Router parsing precedes handle(), so include its admission in the same
      // drain set. Eviction must not reopen alongside a still-running parser.
      const drained = Promise.withResolvers(); requests.add(drained.promise);
      return () => { admittedImports.delete(request); importingBackup = false; requests.delete(drained.promise); drained.resolve(); };
    },
    authenticate: (request, security) => invites.authenticate(request, security),
    authenticatePlugin: request => gamePlugin.authenticate(request),
    handle: (request, response, listener = { host: '127.0.0.1', ingressRole: 'private' }) => track(requests, () => requestHandler(request, response, listener)),
    activate(checkpoint) {
      if (closed || !liveSwap?.standby) return Promise.reject(new Error('Only a prepared standby can activate.'));
      if (activationPending) return Promise.reject(new Error('Standby activation is already running.'));
      const activation = (async () => {
        const activationStarted = performance.now();
        try {
          await handover.freeze(liveSwap?.freezeDeadlineMs ?? 2000);
          let phaseStarted = performance.now();
          await Promise.all([signInFlow.close(), accounts.close(), invites.close(), feedback.close(), usage.close(), overlays.close(), gamePlugin.close()]);
          reportActivationTiming(liveSwap?.onActivationTiming, 'app.sidecarsClose', phaseStarted);
          if (closed) throw new Error('Standby activation was cancelled by shutdown.');
          await store.activate(checkpoint);
          if (closed) throw new Error('Standby activation was cancelled by shutdown.');
          liveSwap = { ...liveSwap, standby: false, strict: true };
          feedbackOwnerId = store.getCalculationSnapshot().members[0]?.id;
          phaseStarted = performance.now();
          await openSidecars();
          reportActivationTiming(liveSwap?.onActivationTiming, 'app.sidecarsOpen', phaseStarted);
          if (closed) throw new Error('Standby activation was cancelled by shutdown.');
          responseCache.clear(); sandboxPools.clear(); rankingPools.clear(); calculationSnapshot = undefined;
          handover.cancelFreeze();
          schedulePredictions(10000);
          return store.getInfo();
        } finally { reportActivationTiming(liveSwap?.onActivationTiming, 'app.total', activationStarted); }
      })();
      activationPending = activation;
      return activation.catch(async error => { await transport.requestClose(); throw error; })
        .finally(() => { if (activationPending === activation) activationPending = undefined; });
    },
    async freeze({ requireIdle = false, maxSaveBytes } = {}) {
      if (maxSaveBytes !== undefined && (!Number.isSafeInteger(maxSaveBytes) || maxSaveBytes <= 0)) throw new TypeError('maxSaveBytes must be a positive safe integer.');
      if (closed) throw new Error('A closed writer cannot freeze.');
      if (requireIdle && handover.ordinary) throw Object.assign(new Error('A save is still running. Please try again in a moment.'), { status: 503, code: 'LIVE_SWAP_BUSY' });
      await handover.freeze(liveSwap?.freezeDeadlineMs ?? 2000);
      clearImmediate(claimCleanupImmediate); claimCleanupImmediate = undefined;
      for (const client of clients) client.end();
      clients.clear();
      try { await mutationQueue; return await store.freeze({ maxSaveBytes }); }
      catch (error) {
        if (error.code === 'LIVE_SWAP_BUSY') handover.cancelFreeze();
        throw error;
      }
    },
    async prepare() {
      if (closed) throw new Error('Picker context is closed.');
      readinessPrepared ??= (async () => {
        if (taskWorker && nativeForegroundState) {
          const rules = store.getRules(), revision = store.getInfo().revision, started = performance.now();
          try {
            await taskWorker.prepareRules(rules, revision);
            startupPrepared.variant = true;
          } catch {
            // Optional preparation must preserve saves and the normal
            // worker recovery path when calculation is unavailable.
          } finally { startupTimingMs.variantMs = performance.now() - started; }
        }
        const info = store.getInfo(), started = performance.now();
        // Only the existing play representation is prepared. Backups, full
        // state and optional reference data remain demand loaded. All HTTP
        // reads still authenticate before entering their cached route.
        try {
          const playState = await stateRepresentation(PLAY_VIEW, info);
          await Promise.all([playState.encoded('br'), playState.encoded('gzip')]);
          startupPrepared.stateResponse = true;
        } catch {
          // Failed encoding slots are cleared by the representation helper;
          // an authenticated route can retry without stopping the server.
        } finally { startupTimingMs.stateResponseMs = performance.now() - started; }
      })();
      await readinessPrepared;
    },
    startBackground({ early = false } = {}) {
      if (closed) return;
      schedulePredictions(10000);
      if (!liveSwap?.standby && early && taskWorker && nativeForegroundState) startupWarmup = createStartupWarmup({ worker: taskWorker, clock: schedulingClock,
        snapshot: calculationState, busy: () => foregroundActive > 0 || automaticDeathActive > 0 || listPending(store.getInfo().revision)
          || schedulingClock.now() - foregroundLastActivity < 1000 });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      idleMemory.close();
      clearImmediate(claimCleanupImmediate); claimCleanupImmediate = undefined;
      notifyForeground();
      schedulingClock.clearTimeout(prewarmTimer);
      startupWarmup?.close();
      taskWorker?.cancelPicker?.();
      clearTimeout(rankingLeaseTimer);
      for (const client of clients) client.end();
      clients.clear(); clientCredentials.clear();
      // Close direct store admission before the first asynchronous drain. The
      // store commits its accepted queue before invoking this unlock barrier.
      closePromise = store.close({ beforeUnlock: async () => {
        await activationPending?.catch(() => {});
        while (requests.size) await Promise.allSettled([...requests]);
        await mutationQueue;
        await claimCleanupRun;
        await readinessPrepared;
        unsubscribe(); unsubscribeWorker?.(); unsubscribeResidency?.(); unsubscribePredictions?.();
        await overlays.close();
        await Promise.all([signInFlow.close(), accounts.close(), invites.close(), feedback.close(), usage.close(), gamePlugin.close()]);
        progressClient.close(); originalSyncClient?.close();
        while (jobs.size) await Promise.allSettled([...jobs]);
        responseCache.clear(); sandboxPools.clear(); rollPoolCache = undefined;
        poolRanking.clear(); rankingPools.clear(); savedTaskResults.clear();
        runeMetricsPreviews.clear(); originalSyncPreviews.clear();
        identityLookup = undefined; calculationSnapshot = undefined;
        trainingSourceIndex = undefined; bankingRouteProvider = undefined;
        knownTaskMembers.clear(); requiredTaskMembers.clear(); settledTaskMembers.clear();
        activeTaskMembers.clear(); foregroundWaiters.clear();
        initialState = initialImport = prepareState = beforeCommit = undefined;
        savedTaskFingerprint = rankingPoolInput = awaitingForeground = undefined;
        feedbackOwnerId = refreshMemberId = undefined;
        invites = accounts = signInFlow = feedback = usage = usageStorage = overlays = gamePlugin = undefined;
        context.store = undefined; store = undefined;
      } });
      return closePromise;
    },
  };
  return context;
}
