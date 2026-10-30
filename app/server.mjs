import { createUsageRateLimit } from './usage-route.mjs';
import { bodyJSON, json } from './picker-context-http.mjs';
import { httpError, redactInviteTokens, serverReadyMessage, cachedJSON } from './picker-context-http.mjs';
export { routePermissions, commandPermissions, apiPermission, redactInviteTokens, serverReadyMessage, gzipSavedTaskResult, coordinationView } from './picker-context-http.mjs';
import { createPickerContext } from './picker-context.mjs';
import { createPickerLimits } from './security/picker-limits.mjs';
import { createPickerRouter } from './picker-router.mjs';
import { reconcileTombstones, backupDeletionDisclosure } from './storage/tombstones.mjs';
import { openRegistry } from './storage/registry.mjs';
import { readLegacyAccounts } from './storage/registry-legacy.mjs';
import { startupPhase } from './startup-timing.mjs';
import { resolveDataset } from './datasets.mjs';
import { verifyDatasetBinding, bindDatasetStorage } from './dataset-binding.mjs';
import { defaultGameDirectory, prepareGameStorage, gameArtOptions, datasetFeature } from './game-profile.mjs';
import { prepareServerDefinitions, preparedDefinitionStages } from './dataset-pipeline.mjs';
import { datasetBrowserPayload } from './dataset-catalogues.mjs';
import { datasetJSON, selectedDataset, adoptLegacyMetadataProvider } from "./dataset-runtime.mjs";
import http from 'node:http';
import { loadPrivateAddon, datasetWithPrivateAddon } from './private-addon.mjs';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createTaskScheduler } from './tasks/scheduler.mjs';
import { sharedJSONBytes, sharedBuffer } from './tasks/shared-bytes.mjs';
import { prepareStoreProcessIdentity } from './storage/store.mjs';
import { normalizePublicOrigin, normalizeIngressRole, requestContext, checkRequestOrigin, createRateLimits, createStreamLimits } from './security/request.mjs';
import { buildWorld } from './data/world.mjs';
import { loadDatasetInputs, loadOriginalSyncIntegration } from './dataset-bootstrap.mjs';
import { archaeologyTaskCorrections } from './data/archaeology-task-corrections.mjs';
import { createGroupState } from './core/state.mjs';
import { builtInRules, createRuleRegistry } from './core/rules.mjs';
import { hasGameplayMigration, hasCurrentProgressAliasMigration, hasCurrentJournalMigration, migrateOwnedGameplay, resolveSavedTaskId } from './tasks/migration.mjs';
const trainingCatalogue = await datasetJSON("app/data/training/methods.f2p.json");
const membersStartBanks = await datasetJSON("app/data/members-start-banks.2026-10-12.v1.json");
import { createIconCatalogue, ICON_BUNDLES } from './data/icons.mjs';
import { createInteriorAssetCatalogue } from './data/interior-assets.mjs';
import { createTerrainAssetCatalogue, validateTerrainDescriptor, TERRAIN_BUNDLE } from './data/terrain-assets.mjs';
import { buildInteriorMapIndex } from './core/interior-maps.mjs';
import { loadChunkSectionIndex, buildChunkSectionIndex } from './core/chunk-sections.mjs';
import { createRepresentation, createResponseCache } from './http-response.mjs';
import { startEarlyServer, reuseEquivalentDataset } from './startup.mjs';
import { buildXpChoiceCatalogue } from './core/xp-choices.mjs';
import { createArtProvider } from './art-provider.mjs';

// Operator-supplied context adapter; HTTP input cannot select it.
export const frontDoorIngressProtocol = 1;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
startupPhase('modules-loaded');
// A fingerprint of the shipped app code; open pages compare it after reconnecting to offer a refresh.
const APP_VERSION = (() => {
  const hash = createHash('sha256');
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(mjs|css|html)$/.test(entry.name)) {
        hash.update(path.relative(ROOT, file).replaceAll('\\', '/')); hash.update(readFileSync(file));
      }
    }
  }
  visit(path.join(ROOT, 'app'));
  return hash.digest('hex').slice(0, 12);
})();
async function startTaskWorker(definitions, definitionBytes, world, registry, options, dataset, datasetOptions, transferRollWorld = false) {
  const builtinIds = new Set(builtInRules.map(rule => rule.id));
  const extraRules = registry.definitions.filter(rule => !builtinIds.has(rule.id)).map(({ candidates, exclude, ...metadata }) => metadata);
  // Worker factories keep their existing object input. Native lanes can parse
  // the already available JSON without cloning the entire definition graph.
  let input = { definitions };
  if (!options?.workerFactory && !options?.deathWorkerFactory && !options?.duoWorkerFactory) {
    input = { definitionBytes: sharedBuffer(definitionBytes) };
  }
  // Native indexes are rebuilt off-thread. Keep every cold lane's init payload small,
  // while preserving custom topology from an explicitly supplied world.
  return createTaskScheduler({ ...options, workerData: { ...input, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions, preparedDatasetStages: preparedDefinitionStages(definitions), world: transferRollWorld ? { ...world } : { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules } });
}

/** Create the private local application without binding a port until listen(). */
export async function createServer({ dataDir, host = '127.0.0.1', port = 8788,
  dataset, world, definitions, taskMap, registry, initialState, prepareState, beforeCommit, now, random,
  webRoot = path.join(ROOT, 'app', 'web'), resourcesRoot = path.join(ROOT, 'resources'), initialImport,
  taskArtworkRoot = path.join(webRoot, 'task-item-artwork.2026-10-09.v1'),
  worldImagesRoot,
  packsDir = process.env.RS3_PACKS_DIR || path.join(ROOT, '.local', 'packs'),
  packSelection = process.env.RS3_PACK_SELECTION,
  runeMetrics = {}, progressSources = {}, originalSync = {}, privateAddonOptions = {},
  mapAssetsDir = process.env.RS3_MAP_ASSETS_DIR,
  terrainAssetsDir = process.env.RS3_TERRAIN_ASSETS_DIR || mapAssetsDir,
  iconAssetsDir = process.env.RS3_ICON_ASSETS_DIR || mapAssetsDir,
  terrainBundle = TERRAIN_BUNDLE,
  iconManifests,
  interiorCatalogue,
  gameDataDir = process.env.RS3_GAME_DATA_DIR || path.join(ROOT, '.local', 'game-data'),
  chunkSectionCatalogue,
  taskWorkerOptions, idleMemoryOptions, shutdownDeadlineMs = 10000, retention, predictionPrewarm = true,
  schedulingClock = { now: () => performance.now(), setTimeout, clearTimeout },
  publicOrigin = process.env.RS3_PUBLIC_ORIGIN, rateLimits = {}, usageRateLimits = {},
  requestContextFor = requestContext,
  ingressRole = 'private',
  // Optional second listener on 127.0.0.1 for Tailscale Funnel, which can only proxy to loopback.
  loopbackPort = process.env.RS3_LOOPBACK_PORT ? Number(process.env.RS3_LOOPBACK_PORT) : undefined,
  loopbackRole = process.env.RS3_LOOPBACK_ROLE ?? 'private',
  signIn = process.env.RS3_SIGNIN ?? 'off', signInProvider, multiPicker, backupRetentionMs,
  httpServer, httpLoopbackServer, startupConnections, onRequestHandler, startupSignal,
  // Operator capability only: no HTTP endpoint can acquire writer ownership.
  liveSwap,
  // Synthetic scratch saves only: game plugin items from beta worlds tick like live ones.
  pluginItemsBetaAsLive = false,
} = {}) {
  const initializationStarted = performance.now();
  startupPhase('create:start');
  dataset ??= reuseEquivalentDataset(await resolveDataset({ packsDir, selectionPath: packSelection, mapAssetsDir, gameDataDir }), selectedDataset);
  startupPhase('create:dataset');
  worldImagesRoot ??= path.join(ROOT, ...(dataset.gameDefaults.compatibility?.worldImagesPath ?? ['.local', 'world-images']));
  adoptLegacyMetadataProvider(dataset);
  const privateAddon = await loadPrivateAddon(privateAddonOptions);
  const appVersion = liveSwap?.version ?? (privateAddon ? createHash('sha256').update(`${APP_VERSION}:${privateAddon.addonSha256}`).digest('hex').slice(0, 12) : APP_VERSION);
  dataset = datasetWithPrivateAddon(dataset, privateAddon);
  // Refuse a broken executable installation before opening or preparing saves.
  const originalSyncIntegration = await loadOriginalSyncIntegration(dataset, undefined, privateAddon);
  dataDir ??= defaultGameDirectory(ROOT, dataset);
  if (liveSwap?.standby) {
    const binding = await verifyDatasetBinding(dataDir, dataset);
    if (dataset.capabilities?.independent && !binding.bound) throw new Error('Standby requires existing bound storage.');
  } else await prepareGameStorage(dataDir, dataset);
  startupPhase('create:storage');
  if (initialImport && !datasetFeature(dataset, 'originalSync')) throw httpError(422, 'Restore a starter backup through Backup & Import.');
  const browserDataset = await datasetBrowserPayload(dataset);
  startupPhase('create:browser-payload');
  const startupTimingMs = { cataloguesMs: 0, workerAndReferencesMs: 0, storeMs: 0, authMs: 0, variantMs: 0, stateResponseMs: 0 };
  publicOrigin = normalizePublicOrigin(publicOrigin);
  ingressRole = normalizeIngressRole(ingressRole);
  loopbackRole = normalizeIngressRole(loopbackRole);
  if (!['off', 'optional', 'required'].includes(signIn)) throw new TypeError('RS3_SIGNIN must be off, optional or required.');
  // MP7: one enabled-mode budget for the full server lifetime.
  const pickerLimits = multiPicker ? createPickerLimits(multiPicker) : undefined;
  const limits = createRateLimits(rateLimits);
  const admitStream = createStreamLimits(rateLimits);
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host must be nonempty.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be an integer from 0 through 65535.');
  if (loopbackPort !== undefined && (!Number.isInteger(loopbackPort) || loopbackPort < 0 || loopbackPort > 65535)) throw new TypeError('loopbackPort must be an integer from 0 through 65535.');
  if (!Number.isSafeInteger(shutdownDeadlineMs) || shutdownDeadlineMs < 1) throw new TypeError('shutdownDeadlineMs must be a positive integer.');
  const defaultMapAssetsDir = mapAssetsDir ?? path.join(ROOT, '.local', 'map-assets');
  const art = await createArtProvider(gameArtOptions(dataset, { packsDir, selectionPath: packSelection,
    overrides: { mapAssets: mapAssetsDir, terrainAssets: terrainAssetsDir, iconAssets: iconAssetsDir },
    defaults: { legacyResources: resourcesRoot, taskArtwork: taskArtworkRoot, worldImages: worldImagesRoot,
      mapAssets: defaultMapAssetsDir, terrainAssets: terrainAssetsDir ?? defaultMapAssetsDir, iconAssets: iconAssetsDir ?? defaultMapAssetsDir } }));
  let iconCataloguePending;
  let terrainCataloguePending;
  const terrainCatalogue = () => terrainCataloguePending ??= (async () => {
    const unavailable = { available: false };
    if (!terrainBundle) return { available: false, payload: unavailable };
    validateTerrainDescriptor(terrainBundle);
    try {
      const file = await art.required('terrainAssets', terrainBundle.manifestPath);
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== terrainBundle.manifestSha256) return { available: false, payload: unavailable };
      const bundle = JSON.parse(bytes.toString('utf8'));
      const assets = createTerrainAssetCatalogue(bundle, terrainBundle);
      // A previously installed export must not override a refreshed PNG source.
      const sourceManifest = await readFile(await art.required('mapAssets', 'manifest.json'));
      if (createHash('sha256').update(sourceManifest).digest('hex') !== bundle.provenance.sourceManifestSha256) {
        return { available: false, payload: unavailable };
      }
      assets.files.set(`/assets/map/${assets.manifest.relative}`, { ...assets.manifest, bytes: bytes.length });
      // Per-file integrity is checked on demand, including HEAD/304. Offscreen
      // assets do not delay the first visit or compete with visible terrain.
      const { provenance, ...payload } = bundle;
      return { available: true, assets, payload: { ...payload, available: true } };
    } catch (error) {
      if (error.code === 'ENOENT' || error.status === 404 || error instanceof SyntaxError || error instanceof TypeError) {
        return { available: false, payload: unavailable };
      }
      throw error;
    }
  })();
  function iconCatalogue() {
    return iconCataloguePending ??= (async () => {
      const expected = iconManifests ?? await Promise.all(ICON_BUNDLES.map(async bundle =>
        dataset.json(`app/data/${bundle.manifest}`)));
      // A new asset folder is published by writing its manifest last. Only the
      // installed, matching version is advertised; missing bundles stay quiet.
      const installed = [];
      for (const bundle of expected) {
        createIconCatalogue([bundle]);
        try {
          const file = await art.required('iconAssets', `${bundle.assetDirectory}/manifest.json`);
          const local = JSON.parse(await readFile(file, 'utf8'));
          if (JSON.stringify(local) === JSON.stringify(bundle)) installed.push(bundle);
        } catch (error) { if (error.code !== 'ENOENT' && error.status !== 404 && !(error instanceof SyntaxError)) throw error; }
      }
      const catalogue = createIconCatalogue(installed);
      catalogue.manifest.available = installed.length > 0;
      catalogue.complete = installed.length === expected.length;
      catalogue.bytes = Buffer.from(JSON.stringify(catalogue.manifest));
      catalogue.etag = `"${createHash('sha256').update(catalogue.bytes).digest('hex')}"`;
      return catalogue;
    })();
  }
  const originalData = await loadDatasetInputs(dataset, { loadDefinitions: definitions === undefined, loadTaskMap: taskMap === undefined });
  startupPhase('create:inputs');
  let definitionBytes = definitions === undefined ? originalData.definitionBytes : Buffer.from(JSON.stringify(definitions));
  const taskBytes = taskMap === undefined ? originalData.taskBytes : Buffer.from(JSON.stringify(taskMap));
  const parsedDefinitions = prepareServerDefinitions(JSON.parse(definitionBytes.toString('utf8')), dataset, { reviewedOverlays: definitions === undefined });
  definitionBytes = sharedJSONBytes(parsedDefinitions);
  const parsedTaskMap = JSON.parse(taskBytes.toString('utf8'));
  startupPhase('create:definitions');
  const datasetOptions = { reviewedOverlays: definitions === undefined, ...(definitions === undefined ? {} : { cacheWalking: false }) };
  const indexedWorld = world ?? buildWorld(parsedDefinitions, { dataset, ...datasetOptions });
  startupTimingMs.cataloguesMs = performance.now() - initializationStarted;
  startupPhase('create:world');
  const workerStarted = performance.now();
  let chunkSectionsPending;
  const loadChunkSections = () => chunkSectionsPending ??= chunkSectionCatalogue
    ? Promise.resolve(buildChunkSectionIndex(chunkSectionCatalogue, indexedWorld))
    : loadChunkSectionIndex(gameDataDir, ROOT, indexedWorld, { dataset });
  const ruleRegistry = registry ?? createRuleRegistry();
  const storeProcessPending = prepareStoreProcessIdentity();
  const definitionCachePending = cachedJSON(definitionBytes), taskCachePending = cachedJSON(taskBytes);
  const taskWorkerPending = parsedDefinitions.challenges && typeof parsedDefinitions.challenges === 'object' && !Array.isArray(parsedDefinitions.challenges)
    ? startTaskWorker(parsedDefinitions, definitionBytes, indexedWorld, ruleRegistry, multiPicker ? { ...taskWorkerOptions, fairness: pickerLimits.config, maxCalculators: multiPicker.maxCalculators ?? 2 } : taskWorkerOptions, dataset, datasetOptions, world !== undefined) : Promise.resolve(null);
  let taskWorker, identityHistory, definitionCache, taskCache;
  // Optional map reference data has its own authenticated cache and payload.
  // Loading it never delays gameplay startup or enlarges state/definitions.
  const mapInfoCache = new Map();
  const loadMapInfo = (f2p = false) => {
    if (!mapInfoCache.has(f2p)) mapInfoCache.set(f2p, Promise.all([
    import('./data/map-pin-details.mjs'), import('./data/map-connections.mjs'),
  ]).then(([pins, edges]) => cachedJSON(Buffer.from(JSON.stringify({ schemaVersion: 1,
    pinDetails: pins.MAP_PIN_DETAILS, connections: edges.mapConnectionsPayload({ f2p }) })))));
    return mapInfoCache.get(f2p);
  };
  let npcShopInfoCache;
  const loadNpcShopInfo = () => npcShopInfoCache ??= Promise.all([
    import('./data/cache-npcs.mjs'), import('./data/cache-shops.mjs'),
  ]).then(([npcs, shops]) => cachedJSON(Buffer.from(JSON.stringify({ schemaVersion: 1,
    npcs: npcs.npcMetadataPayload(), shops: shops.shopMetadataPayload() }))));
  let archaeologyCache;
  const loadArchaeology = () => archaeologyCache ??= Promise.resolve(dataset.json('app/data/cache-archaeology.2026-10-08.v1.json'))
    .then(catalogue => cachedJSON(Buffer.from(JSON.stringify({ ...catalogue,
      contentsEnabled: dataset.capabilities.cacheArchaeology, taskCorrections: archaeologyTaskCorrections }))));
  let interiorsPending;
  const loadInteriors = () => interiorsPending ??= (async () => {
    if (!datasetFeature(dataset, 'mapMetadata')) {
      const payload = { schemaVersion: 1, maps: [], areas: [], assets: { available: false } };
      return { available: false, payload, index: { catalogue: payload, maps: new Map(), areas: new Map(), tiles: new Map() }, cache: await cachedJSON(Buffer.from(JSON.stringify(payload))) };
    }
    const catalogue = interiorCatalogue ?? dataset.json('app/data/cache-interiors.2026-10-08.v2.json');
    const assets = createInteriorAssetCatalogue(catalogue);
    let available = false;
    try {
      const file = await art.required('mapAssets', assets.manifest.relative);
      const bytes = await readFile(file);
      available = createHash('sha256').update(bytes).digest('hex') === assets.manifest.sha256;
      if (available) assets.files.set(`/assets/map/${assets.manifest.relative}`,
        { ...assets.manifest, bytes: bytes.length });
    } catch (error) { if (error.code !== 'ENOENT' && error.status !== 404) throw error; }
    const payload = { ...catalogue, assets: { ...catalogue.assets, available },
      maps: catalogue.maps.map(map => ({ ...map, available,
        tiles: map.tiles.map(tile => ({ ...tile, url: available ? `/assets/map/${tile.path}` : null })) })) };
    return { assets, available, payload, index: buildInteriorMapIndex(payload),
      cache: await cachedJSON(Buffer.from(JSON.stringify(payload))) };
  })();
  try {
    [taskWorker, identityHistory, definitionCache, taskCache] = await Promise.all([taskWorkerPending,
      Promise.resolve(dataset.capabilities.legacyHistory === false ? {} : dataset.json('app/data/legacy-task-history.json')),
      definitionCachePending, taskCachePending, storeProcessPending]);
  } catch (error) { await taskWorkerPending.then(worker => worker?.close()).catch(() => {}); throw error; }
  startupPhase('create:worker');
  if (startupSignal?.aborted) { await taskWorker?.close(); startupSignal.throwIfAborted(); }
  const abortCalculator = () => { void taskWorker?.close(); };
  startupSignal?.addEventListener('abort', abortCalculator, { once: true });
  startupTimingMs.workerAndReferencesMs = performance.now() - workerStarted;
  const catalogueIds = taskWorker ? new Set(taskWorker.catalogue.map(task => task.id)) : null;
  const sandboxCatalogue = taskWorker ? [...taskWorker.catalogue, ...taskWorker.dynamicCatalogue] : [];
  const migrationIsCurrent = state => {
    const previous = state.legacy?.gameplayMigration;
    const registeredIds = new Set(state.tasks.map(task => task.id));
    const catalogueReady = [...catalogueIds].every(id => registeredIds.has(id));
    const ownersReady = state.members.every(member => member.sourceMapId == null || (previous?.schemaVersion >= 2 && hasGameplayMigration(state, member)));
    const identitiesReady = state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
      && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)));
    return catalogueReady && ownersReady && identitiesReady && hasCurrentProgressAliasMigration(state) && hasCurrentJournalMigration(state)
      && state.identityRegistry?.schemaVersion === 1 && (!previous || previous.schemaVersion >= 2);
  };
  const migrateState = taskWorker ? async (state, context) => {
    const previous = state.legacy?.gameplayMigration;
    const reusable = migrationIsCurrent(state);
    const migration = reusable ? { state, reused: true, warnings: previous?.warnings ?? [], report: {
      ...(previous?.report ?? { imported: previous?.imported ?? {}, unresolved: previous?.unresolved ?? [], taskStatusProvenance: previous?.taskStatusProvenance ?? [] }),
      catalogueTasks: state.tasks.length,
    } } : { ...migrateOwnedGameplay(state, { definitions: parsedDefinitions, taskMap: parsedTaskMap, taskMapHistory: identityHistory, catalogue: taskWorker.catalogue, dynamicCatalogue: taskWorker.dynamicCatalogue }), reused: false };
    if (migration.state.legacy?.gameplayMigration) {
      migration.state.legacy.gameplayMigration.warnings = migration.warnings;
      migration.state.legacy.gameplayMigration.report = migration.report;
    }
    context.migration = migration;
    context.catalogue = taskWorker.catalogue;
    return migration.state;
  } : undefined;
  if (migrateState) migrateState.isCurrent = migrationIsCurrent;
  const xpChoiceCatalogue = buildXpChoiceCatalogue(parsedDefinitions, [...(taskWorker?.catalogue ?? []), ...(taskWorker?.dynamicCatalogue ?? [])]);
  if (initialState === undefined && dataset.capabilities.independent) {
    initialState = createGroupState(dataset.gameDefaults.members, ruleRegistry);
    initialState.tasks = structuredClone(dataset.gameDefaults.tasks ?? []);
    initialState.provenance = { dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
  }
  const usageAdmission = createUsageRateLimit({ ...(now === undefined ? {} : { now: () => typeof now === 'function' ? now() : now }), ...usageRateLimits });
  const runtime = {
    dataset, indexedWorld, ruleRegistry, taskWorker, taskWorkerOptions, parsedDefinitions,
    parsedTaskMap, identityHistory, migrateState, registry, xpChoiceCatalogue, sandboxCatalogue,
    originalSyncIntegration, privateAddon, appVersion, browserDataset, webRoot, art,
    loadChunkSections, loadMapInfo, loadNpcShopInfo, loadArchaeology, loadInteriors,
    iconCatalogue, terrainCatalogue, trainingCatalogue, membersStartBanks,
    limits, admitStream, usageAdmission, requestContextFor, pickerLimits,
    get definitionCache() { return definitionCache; }, get taskCache() { return taskCache; },
    staticCache: createResponseCache({ maxEntries: 128, maxBytes: 48 * 1024 * 1024 }),
    releaseReferences() {
      definitionCache = createRepresentation(definitionBytes); taskCache = createRepresentation(taskBytes);
      mapInfoCache.clear(); npcShopInfoCache = undefined; archaeologyCache = undefined;
      interiorsPending = undefined; chunkSectionsPending = undefined;
    },
  };
  const connections = startupConnections ?? new Set();
  const transport = { savingConnections: new Map(), connectionDeadlinePassed: false,
    inviteUrl: () => handle.inviteUrl, requestClose: () => handle.close() };
  let context, pickerRegistry, pickerRouter;
  async function syncLegacy() {
    const memberIds = context.store.getCalculationSnapshot().members.map(member => member.id);
    let plan, fromFile = false;
    try {
      await readFile(path.join(dataDir, 'accounts.json'));
      plan = await readLegacyAccounts({ accountsFile: path.join(dataDir, 'accounts.json'), invitesFile: path.join(dataDir, 'invites.json'), memberIds });
      fromFile = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // An account file without its invitation file is not an empty import.
      try { await readFile(path.join(dataDir, 'accounts.json')); throw new Error('Legacy invitation store is missing.'); }
      catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
      plan = { memberIds, accounts: [], droppedMemberships: 0 };
    }
    // The plan lists every account in accounts.json, so an imported account
    // missing from it was deleted there. Retire its registry copy first, so its
    // subjects can rejoin. Owned pickers and accounts without memberships (an
    // interrupted first login) are never retired here; a missing file retires nothing.
    if (fromFile) {
      const planned = new Set(plan.accounts.map(input => input.id));
      for (const account of pickerRegistry.listAccounts()) {
        if (planned.has(account.id) || account.defaultPickerId || !account.memberships.length) continue;
        if (account.memberships.every(m => pickerRegistry.getPicker(m.pickerId)?.kind === 'legacy-shared')) await pickerRegistry.deleteAccount(account.id);
      }
    }
    // Only accounts previously imported into the shared exception are eligible
    // for removal reconciliation, including imports with all grants revoked.
    // Native account IDs do not occur in the legacy plan and stay untouched.
    const removals = [];
    for (const input of plan.accounts) {
      const account = pickerRegistry.getAccount(input.id);
      const imported = account && !account.defaultPickerId && account.memberships.every(m => pickerRegistry.getPicker(m.pickerId)?.kind === 'legacy-shared');
      for (const identity of input.identities) {
        const owner = pickerRegistry.findIdentity(identity.provider, identity.subject);
        const existing = account?.identities.find(i => i.provider === identity.provider);
        if (owner && owner.id !== input.id || !imported && existing && existing.subject !== identity.subject) throw httpError(409, 'Sign-in identity is already assigned.');
      }
      if (imported) for (const identity of account.identities) {
        if (!input.identities.some(i => i.provider === identity.provider && i.subject === identity.subject)) removals.push([account.id, identity.provider]);
      }
    }
    for (const [id, provider] of removals) await pickerRegistry.unlinkIdentity(id, provider);
    await pickerRegistry.registerLegacy(plan);
  }
  // A single additive, enabled-only field describes the session's own controls.
  function ownerSessionView(identity, security, request) {
    const view = context.sessionView(identity, security);
    if (!view.account) return view;
    const picker = identity.pickerId ? pickerRegistry.getPicker(identity.pickerId)
      : pickerRegistry.listPickers().find(item => item.kind === 'legacy-shared');
    const account = pickerRegistry.getAccount(identity.accountId);
    const membership = account?.memberships.find(item => item.pickerId === picker?.id && item.memberId === (identity.memberId ?? null));
    return { ...view, ...(request?.headers['x-account-action'] === 'delete'
      ? { accountDeletionToken: pickerRouter.accountDeletionToken(identity) } : {}), ownerControls: { role: membership?.role ?? null, shared: picker?.kind === 'legacy-shared',
      ownsDefaultPicker: pickerRegistry.listPickers().some(item => item.kind === 'default' && item.ownerAccountId === identity.accountId && item.lifecycle === 'active'),
      backups: backupDeletionDisclosure(backupRetentionMs) } };
  }
  try {
    if (multiPicker) {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      backupDeletionDisclosure(backupRetentionMs);
      pickerRegistry = await openRegistry({ ...multiPicker, legacyDir: dataDir });
      await reconcileTombstones({ registry: pickerRegistry });
    }
    context = await createPickerContext({ pickerId: 'legacy', dataDir, runtime,
      initialState, prepareState, beforeCommit, now, random, retention, initialImport,
      runeMetrics, progressSources, originalSync, idleMemoryOptions, predictionPrewarm,
      schedulingClock, publicOrigin, signIn, signInProvider, liveSwap, pluginItemsBetaAsLive,
      startupSignal, startupTimingMs, transport,
      pickerRouting: pickerRegistry ? { registry: pickerRegistry, syncLegacy, sessionView: ownerSessionView } : undefined });
    if (pickerRegistry) {
      await reconcileTombstones({ registry: pickerRegistry, revokeSessions: scope => context.revokeDeletionSessions(scope),
        revokeAccount: id => context.revokeDeletedAccount(id) });
      await syncLegacy();
      await pickerLimits.initialize(pickerRegistry);
      pickerRouter = createPickerRouter({ registry: pickerRegistry, legacy: context, pickerLimits,
        publicOrigin, requestContextFor, backupRetentionMs, unauthenticated: key => limits.unauthenticated(key), maxOpenContexts: multiPicker.maxOpenContexts, idleCloseMs: multiPicker.idleCloseMs, maxConcurrentImports: multiPicker.maxConcurrentImports,
        openContext: async pickerId => {
          const picker = pickerRegistry.getPicker(pickerId);
          if (picker?.kind !== 'default' || picker.lifecycle !== 'active' || picker.provisioning !== 'ready') throw httpError(403, 'Picker access denied.');
          const directory = pickerRegistry.pickerDirectory(pickerId);
          const binding = await verifyDatasetBinding(directory, dataset);
          if (!binding.bound) {
            if ((await readdir(directory)).length) throw httpError(503, 'Picker dataset binding is missing.');
            await bindDatasetStorage(directory, dataset);
          }
          const initial = createGroupState(picker.memberIds.map(id => ({ id, name: 'Player 1' })), ruleRegistry);
          initial.provenance = { dataset: { id: dataset.datasetId, contractVersion: dataset.datasetContractVersion, digest: dataset.digest } };
          let opened;
          try {
            opened = await createPickerContext({ pickerId, dataDir: directory, runtime,
              initialState: initial, now, random, beforeCommit, retention, runeMetrics, progressSources, originalSync,
              prepareState: state => {
                if (JSON.stringify(state.members.map(member => member.id)) !== JSON.stringify(picker.memberIds)) throw httpError(403, 'Picker membership does not match its registry.');
                const identity = state.provenance?.dataset;
                if (!identity || identity.id !== dataset.datasetId || identity.contractVersion !== dataset.datasetContractVersion || identity.digest !== dataset.digest) throw httpError(422, 'Choose a backup from this picker’s dataset.');
                return state;
              },
              idleMemoryOptions, predictionPrewarm, schedulingClock, publicOrigin,
              pickerRouting: { sessionView: ownerSessionView, authenticate: pickerRouter.authenticate, indexKey: pickerRouter.indexKey, removeKey: pickerRouter.removeKey,
                authenticateKey: (request, memberId) => pickerRouter.authenticateKey(request, pickerId, memberId) },
              transport: { savingConnections: transport.savingConnections, requestClose: transport.requestClose } });
            const actual = opened.store.getCalculationSnapshot().members.map(member => member.id);
            if (JSON.stringify(actual) !== JSON.stringify(picker.memberIds)) throw httpError(503, 'Picker membership does not match its registry.');
            await opened.prepare(); opened.startBackground(); return opened;
          } catch (error) { await opened?.close(); throw error; }
        } });
    }
  } catch (error) { await context?.close(); await pickerRegistry?.close(); await taskWorker?.close(); throw error; }
  // Preserve the original synchronous dispatcher when routing is disabled.
  function contextFor(request) { return context; }
  async function serviceOperator(request, response, listener) {
    try {
      // Use the real listener policy even when the application has a test or
      // transport authentication adapter. Forwarded headers cannot grant this.
      const security = requestContext(request, { ...listener, publicOrigin });
      const identity = context.authenticate(request, security);
      const operator = security.masterAllowed && identity?.kind === 'master' && /^Bearer /i.test(request.headers.authorization ?? '');
      // Players keep their own picker's health; only the operator sees the service-wide view.
      if (!operator && request.url.split('?')[0] === '/api/health') return pickerRouter.handle(request, response, listener);
      if (!operator) throw httpError(403, 'Private operator credentials required.');
      if (['GET', 'HEAD'].includes(request.method) && request.url.split('?')[0] === '/api/health') {
        const worker = (taskWorker?.forPicker?.('legacy') ?? taskWorker)?.getHealth() ?? { status: 'not-configured', ready: true, restartRequired: false };
        const service = pickerRouter.checkpoint.counts();
        await json(request, response, 200, { ready: !closed && !service.checkpoint && worker.ready && !worker.stuck && !worker.restartRequired,
          status: closed ? 'stopping' : service.checkpoint ? 'checkpoint' : worker.stuck ? 'stuck' : worker.restartRequired ? 'restart-required' : worker.ready ? 'ready' : ['sleeping', 'waking'].includes(worker.status) ? worker.status : 'degraded',
          savesReady: !closed && !service.checkpoint, standby: false, worker, service, checkpointTiming: pickerRouter.checkpoint.timings(), local: true,
          revision: context.store.getInfo().revision, version: appVersion, schemaVersion: 1,
          liveSwapProtocol: 2, actionReceiptFormat: 2, saveSchemaVersion: context.store.getInfo().schemaVersion });
        return;
      }
      if (request.method !== 'POST') throw httpError(405, 'Use POST.');
      checkRequestOrigin(request, security);
      const body = await bodyJSON(request, 8192);
      if (Object.keys(body).length !== 1 || typeof body.id !== 'string') throw httpError(400, 'Use a snapshot ID.');
      if (closed) throw httpError(503, 'The writer is unavailable.');
      const { captureServiceCheckpoint } = await import('../scripts/linux/service-checkpoint.mjs');
      const result = await captureServiceCheckpoint({ settings: { dataDir, multiPicker }, id: body.id,
        registry: pickerRegistry, checkpoint: pickerRouter.checkpoint, inputs: multiPicker.recoveryInputs });
      await json(request, response, 200, result);
    } catch (error) {
      request.resume();
      if (!response.headersSent && !response.destroyed) await json(request, response, error.status ?? (error instanceof TypeError || error instanceof SyntaxError ? 400 : 503), { message: error.status ? error.message : 'Service checkpoint refused.' });
    }
  }
  const requestHandler = (request, response, listener = { host, ingressRole }) => {
    if (pickerRouter && ['/api/operator/service-snapshot', '/api/health'].includes((request.url ?? '').split('?')[0])) return serviceOperator(request, response, listener);
    return pickerRouter ? pickerRouter.handle(request, response, listener) : contextFor(request).handle(request, response, listener);
  };
  const headerOptions = { maxHeaderSize: requestContextFor === requestContext ? http.maxHeaderSize : 64 * 1024 };
  const server = httpServer ?? http.createServer(headerOptions, requestHandler);
  const loopbackServer = httpLoopbackServer ?? (loopbackPort === undefined ? null : http.createServer(headerOptions,
    (request, response) => requestHandler(request, response, { host: '127.0.0.1', ingressRole: loopbackRole })));
  for (const listener of [server, loopbackServer]) listener?.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  let closed = false, closePromise, listening;
  const handle = {
    server, store: context.store, world: indexedWorld, dataset,
    getStartupTimingMs: () => ({ ...startupTimingMs }),
    activate: checkpoint => context.activate(checkpoint),
    freeze: options => context.freeze(options),
    address: () => server.address(), loopbackAddress: () => loopbackServer?.address() ?? null,
    get inviteUrl() {
      const address = server.address(), hostname = host.includes(':') ? `[${host}]` : host;
      return `http://${hostname}:${typeof address === 'object' && address ? address.port : port}/join/${handle.store.getAccessToken()}`;
    },
    async listen() {
      if (closed) throw new Error('Server is closed.');
      if (listening) return listening;
      listening = (async () => {
        try {
          const preparation = context.prepare();
          if (!httpServer) await preparation;
          if (closed) throw new Error('Server is closed.');
          if (!server.listening) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
          if (loopbackServer && !loopbackServer.listening) await new Promise((resolve, reject) => { loopbackServer.once('error', reject); loopbackServer.listen(loopbackPort, '127.0.0.1', () => { loopbackServer.off('error', reject); resolve(); }); });
          context.startBackground({ early: Boolean(httpServer) });
          return handle;
        } catch (error) { await handle.close(); throw error; }
      })();
      return listening;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      const contextClosed = pickerRouter
        ? pickerRouter.close().then(() => context.close()).then(() => pickerRegistry.close())
        : context.close();
      closePromise = (async () => {
        let timer, saveResponseTimer;
        const listeners = [server, loopbackServer].filter(listener => listener?.listening);
        const connectionsClosed = listeners.length ? new Promise((resolve, reject) => {
          let open = listeners.length;
          for (const listener of listeners) {
            listener.close(error => error ? reject(error) : --open || resolve()); listener.closeIdleConnections();
          }
          timer = setTimeout(() => {
            transport.connectionDeadlinePassed = true;
            for (const socket of connections) if (!transport.savingConnections.has(socket)) socket.destroy();
          }, shutdownDeadlineMs);
        }) : Promise.resolve();
        const boundedResponses = contextClosed.then(() => {
          saveResponseTimer = setTimeout(() => { for (const socket of connections) socket.destroy(); }, shutdownDeadlineMs);
        });
        try { await Promise.all([connectionsClosed, taskWorker?.close(shutdownDeadlineMs), boundedResponses]); }
        finally { clearTimeout(timer); clearTimeout(saveResponseTimer); runtime.staticCache.clear(); }
      })();
      return closePromise;
    },
  };
  onRequestHandler?.(requestHandler);
  startupPhase('create:handler');
  startupSignal?.removeEventListener('abort', abortCalculator);
  return handle;
}

/** Production startup exposes private health before opening the save. */
export function startServer(options = {}) {
  // Module load already resolved and verified this provider from the same
  // environment defaults createServer would read; it re-verifies bytes on use
  // and the worker re-resolves against its digest. Do not hash every input twice.
  const bootstrap = ['dataset', 'packsDir', 'packSelection', 'mapAssetsDir', 'gameDataDir'].every(key => options[key] === undefined);
  const configured = { dataDir: defaultGameDirectory(ROOT, selectedDataset), ...(bootstrap ? { dataset: selectedDataset } : {}), ...options };
  if (!selectedDataset.capabilities.independent) return startEarlyServer(configured, createServer);
  const storageReady = configured.liveSwap?.standby === true
    ? verifyDatasetBinding(configured.dataDir, selectedDataset).then(binding => {
      if (!binding.bound) throw new Error('Standby requires existing bound storage.');
    })
    : prepareGameStorage(configured.dataDir, selectedDataset);
  return storageReady.then(() => startEarlyServer(configured, createServer));
}

function cliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${arg}.`);
    if (arg === '--host') options.host = value;
    else if (arg === '--port') options.port = Number(value);
    else if (arg === '--loopback-port') options.loopbackPort = Number(value);
    else if (arg === '--data-dir') options.dataDir = path.resolve(value);
    else if (arg === '--import') options.initialImport = path.resolve(value);
    else if (arg === '--backup-days') { options.retention ??= {}; options.retention.backupDays = Number(value); }
    else if (arg === '--history-entries') { options.retention ??= {}; options.retention.historyEntries = Number(value); }
    else throw new TypeError(`Unknown option: ${arg}.`);
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const application = await startServer(cliOptions(process.argv.slice(2)));
    const stop = async () => { await application.close(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    await application.ready;
    process.stdout.write(serverReadyMessage(application.inviteUrl));
  } catch (error) { process.stderr.write(`${redactInviteTokens(error.message)}\n`); process.exitCode = 1; }
}
