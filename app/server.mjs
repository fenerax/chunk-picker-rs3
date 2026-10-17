import { resolveDataset } from './datasets.mjs';
import { defaultGameDirectory, prepareGameStorage, gameArtOptions, datasetFeature, unavailableDatasetFeature, requireGameBackup, preserveGameIdentity } from './game-profile.mjs';
import { prepareServerDefinitions, preparedDefinitionStages } from './dataset-pipeline.mjs';
import { datasetCatalogueKey, datasetBrowserPayload, datasetLocalMetadataBytes } from './dataset-catalogues.mjs';
import { datasetJSON, selectedDataset, adoptLegacyMetadataProvider } from "./dataset-runtime.mjs";
import http from 'node:http';
import { serveGallery } from './gallery-route.mjs';
import { loadPrivateAddon, datasetWithPrivateAddon } from './private-addon.mjs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isImportRoute, readBackupRequest, sendGzipBackup, backupPreviewState } from './backup-transfer.mjs';
import { createTaskScheduler } from './tasks/scheduler.mjs';
import { createPoolRanking } from './tasks/pool-ranking.mjs';
import { openStore, prepareStoreProcessIdentity } from './storage/store.mjs';
import { openInviteStore } from './storage/invites.mjs';
import { openFeedbackStore } from './storage/feedback.mjs';
import { openUsageRoute } from './usage-route.mjs';
import { openOverlays } from './overlays.mjs';
import { readBackupStatus } from './storage/backup-status.mjs';
import { transportRouteById } from './data/transport-routes.mjs';
import { normalizePublicOrigin, requestContext, checkRequestOrigin, createRateLimits } from './security/request.mjs';
import { buildWorld } from './data/world.mjs';
import { loadDatasetInputs, loadOriginalSyncIntegration } from './dataset-bootstrap.mjs';
import { evaluateTransportRoutes } from './core/transport-access.mjs';
import { archaeologyTaskCorrections } from './data/archaeology-task-corrections.mjs';
import { createGroupState, importBackup, importLegacyMaps, previewRestore, BACKUP_FORMAT, SCHEMA_VERSION } from './core/state.mjs';
import { groupGoalCommandTypes } from './core/group-goals.mjs';
import { builtInRules, createRuleRegistry, evaluateRollPool, partnerConnections } from './core/rules.mjs';
import { previewRuleProfile } from './core/planning.mjs';
import { hasGameplayMigration, hasCurrentProgressAliasMigration, hasCurrentJournalMigration, migrateOwnedGameplay, resolveSavedTaskId } from './tasks/migration.mjs';
import { buildIdentityIndex, isPermanentId } from './tasks/identity.mjs';
import { createRuneMetricsClient, createQuestMapping, previewRuneMetrics } from './integrations/runemetrics.mjs';
const trainingCatalogue = await datasetJSON("app/data/training/methods.f2p.json");
const membersStartBanks = await datasetJSON("app/data/members-start-banks.2026-10-12.v1.json");
import { planTraining, trainingPreferences } from './tasks/training-planner.mjs';
import { createBankingRoutes } from './training/banking-routes.mjs';
import { createGatheringRouteLookup } from './tasks/banking-plan.mjs';
import { MINING_PICKAXES, MINING_PROFILES } from './training/mining-rates.mjs';
import { WOODCUTTING_HATCHETS } from './training/woodcutting-rates.mjs';
import { buildTrainingAvailability, createTrainingSourceIndex, trainingProgress } from './tasks/training-availability.mjs';
import { houseStorageCatalogue } from './data/poh-storage.mjs';
import { skillGuideCatalogue } from './data/skill-guides.mjs';
import { createIconCatalogue, ICON_MANIFEST_PATH, ICON_BUNDLES } from './data/icons.mjs';
import { createInteriorAssetCatalogue } from './data/interior-assets.mjs';
import { createTerrainAssetCatalogue, validateTerrainDescriptor, TERRAIN_BUNDLE, TERRAIN_MANIFEST_PATH } from './data/terrain-assets.mjs';
import { buildInteriorMapIndex, getInteriorArea } from './core/interior-maps.mjs';
import { loadChunkSectionIndex, buildChunkSectionIndex, chunkSectionsPayload } from './core/chunk-sections.mjs';
import { projectDisplayWorld } from './display-world.mjs';
import { projectMapLayerData } from './map-layer-data.mjs';
import { projectPlayState, projectPlayResult, PLAY_VIEW } from './play-view.mjs';
import { projectDuoPlayResult, projectDuoInspectionJSON, DUO_INSPECTION_VIEW } from './duo-play-view.mjs';
import { selectDuoTasks } from './web/duo-tasks.mjs';
import { createRepresentation, sendRepresentation, createResponseCache, negotiateEncoding, PRIVATE_NO_STORE, PRIVATE_REVALIDATE } from './http-response.mjs';
import { crc32, deflateRawSync } from 'node:zlib';
import { normalizeSandboxRequest, sandboxTaskCatalogue, applySandboxChanges } from './sandbox.mjs';
import { normalizeAreaCheckRequest } from './tasks/area-check.mjs';
import { helperDrops } from './helper-drops.mjs';
import { backlogSearchTasks } from './tasks/backlog-search.mjs';
import { createProgressQuestPoints } from './helper-progress.mjs';
import { startEarlyServer } from './startup.mjs';
import { createStartupWarmup } from './tasks/startup-warmup.mjs';
import { createIdleMemoryReclaimer } from './idle-memory.mjs';
import { releaseAutomaticTransportCaches } from './core/automatic-transport.mjs';
import { buildXpChoiceCatalogue, buildXpChoiceView } from './core/xp-choices.mjs';
import { createArtProvider } from './art-provider.mjs';
import { artBinding } from './art-bindings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A fingerprint of the shipped app code; open pages compare it after reconnecting to offer a refresh.
const APP_VERSION = (() => {
  const hash = createHash('sha256');
  for (const dir of ['web', 'core', 'tasks', 'data']) {
    const base = path.join(ROOT, 'app', dir);
    let names = []; try { names = readdirSync(base).filter(name => /\.(mjs|css|html)$/.test(name)).sort(); } catch {}
    for (const name of names) { hash.update(name); hash.update(readFileSync(path.join(base, name))); }
  }
  return hash.digest('hex').slice(0, 12);
})();
const MAX_BODY = 32 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// Every API handler and gameplay command must have an explicit access decision.
// Unknown writes are denied before consuming their body, including future routes.
export const routePermissions = Object.freeze({
  GET: Object.freeze({
    '/api/session': 'read', '/api/coordination': 'read', '/api/invites': 'admin', '/api/overlays': 'admin', '/api/feedback': 'admin',
    '/api/feedback/summary': 'write', '/api/feedback/own': 'write', '/api/usage': 'admin',
    '/api/admin/master-link': 'admin', '/api/icons': 'read', '/api/ids/:id': 'read',
    '/api/state': 'read', '/api/history': 'read', '/api/history/:id': 'read', '/api/roll-stats': 'read', '/api/display-world': 'read', '/api/health': 'read', '/api/art-status': 'read', '/api/dataset-status': 'read', '/api/dataset-runtime': 'read', '/api/dataset-input': 'read',
    '/api/changelog': 'read', '/api/roadmap': 'read', '/api/diagnostics': 'read', '/api/definitions': 'read',
    '/api/map-info': 'read', '/api/npcs-and-shops': 'read', '/api/archaeology-catalogue': 'read',
    '/api/chunk-sections': 'read', '/api/interior-maps': 'read', '/api/task-map': 'read',
    '/api/training-catalogue': 'read', '/api/house-storage-catalogue': 'read',
    '/api/helper-drops': 'read', '/api/helper-progress': 'read', '/api/xp-choices': 'read', '/api/backup-status': 'admin',
    '/api/teleports': 'write', '/api/skill-guide-catalogue': 'read', '/api/training-plan': 'write',
    '/api/tasks': 'saved-tasks', '/api/area-check': 'read', '/api/backlog-search': 'read', '/api/pool-ranking': 'read', '/api/predict': 'write', '/api/death-estimates': 'write', '/api/chunk-planning': 'write',
    '/api/migration': 'read', '/api/rules': 'read', '/api/backup': 'write', '/api/backups': 'write',
    '/api/backups/:id': 'write', '/api/members-start': 'write', '/api/events': 'read',
  }),
  POST: Object.freeze({
    '/api/sandbox/evaluate': 'write', '/api/prediction-intent': 'write', '/api/pool-ranking-intent': 'write', '/api/feedback': 'write', '/api/feedback/:id/status': 'admin',
    '/api/feedback/seen': 'write', '/api/usage': 'usage',
    '/api/invites': 'admin', '/api/invites/:id/player': 'admin', '/api/invites/:id/revoke': 'admin',
    '/api/overlays': 'admin', '/api/overlays/:id/revoke': 'admin',
    '/api/shutdown': 'admin', '/api/worker-restart': 'admin', '/api/runemetrics/preview': 'write', '/api/original-sync/preview': 'write',
    '/api/runemetrics/apply': 'write', '/api/profile/preview': 'write', '/api/command': 'write',
    '/api/member-restore/preview': 'write', '/api/member-restore': 'write',
    '/api/restore/preview': 'admin', '/api/restore': 'admin', '/api/import/preview': 'admin', '/api/import': 'admin',
  }),
});
export const commandPermissions = Object.freeze(Object.fromEntries([
  ...groupGoalCommandTypes,
  'set-finish-line-item', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom',
  'set-teleport-override', 'set-transport-facts', 'sync-original', 'set-rule', 'set-rule-review', 'set-profile',
  'set-teleport', 'delete-teleport', 'set-chunk', 'set-note', 'set-journal', 'add-task', 'update-task', 'delete-task', 'clear-challenge-ticks',
  'clear-backlog', 'set-task-status', 'set-task-rule', 'set-preference', 'reset-task-rule',
  'set-task-alternative', 'set-primary-override', 'set-skill-levels', 'set-xp-choices', 'replace-member',
  'set-runescape-name', 'apply-runemetrics', 'set-slayer-lock', 'set-sticker', 'add-sticker',
  'update-sticker', 'remove-sticker', 'clear-stickers', 'set-chunk-colour', 'rename-chunk-colour', 'set-starting-chunk', 'set-section',
  'set-source-backlog', 'set-area', 'complete-task', 'set-obtained-equipment', 'roll', 'pick-for-me', 'unlock-selection',
  'cancel-roll', 'unlock-both', 'random-start', 'go-members', 'unpick', 'undo', 'claim-task', 'clear-task-claim',
].map(type => [type, 'write'])));
export function apiPermission(method, route) {
  const routes = routePermissions[method === 'HEAD' ? 'GET' : method];
  if (!routes) return undefined;
  if (Object.hasOwn(routes, route)) return routes[route];
  const template = Object.keys(routes).find(template => template.includes('/:id')
    && new RegExp(`^${template.replace('/:id', '/[^/]+')}$`).test(route));
  return template ? routes[template] : undefined;
}
export function redactInviteTokens(value) {
  return String(value).replace(/(?:\/|%2f)join(?:\/|%2f)[^\s"'<>?#\\]*/gi, '/join/[redacted]');
}
export function serverReadyMessage(inviteUrl) {
  return `Private duo picker ready at ${new URL(inviteUrl).origin}.\nUse your saved private administrator link to open it.\n`;
}
function savedTaskSuffix(revision, memberId) {
  const metadata = JSON.stringify({ stateRevision: revision, memberId, cache: { hit: true, savedResult: true, worker: false } });
  return Buffer.from(`,${metadata.slice(1)}`);
}
// Stream the existing result and tiny response metadata into compression rather
// than copying or parsing a potentially large full result on the HTTP thread.
export function gzipSavedTaskResult(bytes, revision, memberId) {
  return new Promise((resolve, reject) => {
    const compressor = createGzip({ level: 1 }), chunks = [];
    compressor.on('data', chunk => chunks.push(chunk)); compressor.on('error', reject);
    compressor.on('end', () => resolve(Buffer.concat(chunks)));
    compressor.write(bytes.subarray(0, bytes.length - 1));
    compressor.end(savedTaskSuffix(revision, memberId));
  });
}
function redactInviteFields(value) {
  if (typeof value === 'string') return redactInviteTokens(value);
  if (Array.isArray(value)) return value.map(redactInviteFields);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactInviteTokens(key), redactInviteFields(item)]));
  return value;
}

function actorOwnsEvent(actor, identity) {
  if (!actor) return false;
  if (actor.memberId && identity.memberId && actor.memberId === identity.memberId) return true;
  if (actor.kind === 'invite' && actor.inviteId) return identity.kind === 'invite' && actor.inviteId === identity.inviteId;
  if (actor.memberId) return false;
  if (actor.kind === 'master') return identity.kind === 'master';
  return Boolean(actor.label && actor.label === identity.label);
}

// Small committed History metadata only; never hydrate save/undo archives for a notice.
export function coordinationView(store, identity) {
  const records = store.getRecentHistory(Number.MAX_SAFE_INTEGER);
  const publicEvent = record => {
    if (!record) return null;
    const { hasUndo, ...event } = record;
    return event;
  };
  const latest = store.getUndoEligibility();
  const personalXpUndo = view => view?.event?.type === 'set-xp-choices' && !identity.admin
    && (!identity.memberId || view.event.command?.memberId !== identity.memberId)
    ? { ...view, canUndo: false, reason: 'You can only undo XP choices for your signed-in player.' } : view;
  const latestUndo = personalXpUndo({ ...latest, event: publicEvent(store.getHistoryEvent(latest.undoRevision)) });
  const own = records.findLast(event => event.hasUndo && event.type !== 'undo' && event.undoneRevision === undefined && actorOwnsEvent(event.actor, identity));
  const ownUndo = !own || own.revision === latest.undoRevision ? null : personalXpUndo({ ...store.getUndoEligibility(own.revision), event: publicEvent(own) });
  return { stateRevision: store.getInfo().revision, history: records.filter(event => event.actor && !actorOwnsEvent(event.actor, identity)).slice(-100).map(publicEvent), latestUndo, ownUndo };
}

function routeIsRuneMetrics(request) { return (request.url ?? '').startsWith('/api/runemetrics/'); }
async function json(request, response, status, value, headers = {}) {
  return jsonBytes(request, response, status, Buffer.from(JSON.stringify(value)), headers);
}
function acceptsFastGzip(request) {
  try { return negotiateEncoding(`${request.headers['accept-encoding'] ?? ''}, br;q=0`) === 'gzip'; }
  catch (error) { if (error.status !== 406) throw error; return false; }
}
async function jsonBytes(request, response, status, bytes, headers = {}) {
  const unacceptable = () => { response.writeHead(406, { 'Cache-Control': PRIVATE_NO_STORE, Vary: 'Accept-Encoding', 'Content-Length': 0 }); response.end(); };
  if (status === 406) { unacceptable(); return; }
  try {
    // Error bodies also negotiate encoding. An unacceptable encoding inside
    // the outer request catch must not become an unhandled handler rejection.
    const compactTasks = (request.url ?? '').split('?')[0] === '/api/tasks' && new URL(request.url, 'http://localhost').searchParams.get('view') === PLAY_VIEW;
    const transport = compactTasks && acceptsFastGzip(request) ? { method: request.method,
      headers: { ...request.headers, 'accept-encoding': 'gzip, identity;q=0' } } : request;
    return await sendRepresentation(transport, response, createRepresentation(bytes, { cacheControl: PRIVATE_NO_STORE }),
      { status, headers, conditional: false });
  } catch (error) {
    if (error.status !== 406 || response.headersSent) throw error;
    unacceptable();
  }
}

// Storage returns immutable JSON from the committed snapshot. Reusing it avoids
// cloning and serializing the large identity/migration archives for each save.
async function commandJSON(request, response, saved) {
  const metadata = saved.unchangedFields?.length
    ? `,"baseRevision":${saved.baseRevision},"unchangedFields":${JSON.stringify(saved.unchangedFields)}` : '';
  const view = saved.format ? `,"format":${JSON.stringify(saved.format)},"schemaVersion":1` : '';
  return jsonBytes(request, response, 200, Buffer.from(`{"state":${saved.stateJSON},"pools":${JSON.stringify(saved.pools)}${metadata}${view}}`));
}
async function bodyJSON(request, maxBytes = MAX_BODY) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw httpError(415, 'Use application/json.');
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError(413, 'Request body is too large.');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw httpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Request body is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Request body must be a JSON object.');
  return value;
}
async function cachedJSON(bytes) {
  return createRepresentation(bytes);
}
function sendCached(request, response, cached) {
  return sendRepresentation(request, response, cached);
}
async function containedFile(directory, relative) {
  const base = await realpath(directory);
  const file = await realpath(path.resolve(directory, relative));
  const inside = path.relative(base, file);
  if (!inside || inside.startsWith(`..${path.sep}`) || inside === '..' || path.isAbsolute(inside)) throw httpError(404, 'Not found.');
  return file;
}

async function startTaskWorker(definitions, definitionBytes, world, registry, options, dataset, datasetOptions) {
  const builtinIds = new Set(builtInRules.map(rule => rule.id));
  const extraRules = registry.definitions.filter(rule => !builtinIds.has(rule.id)).map(({ candidates, exclude, ...metadata }) => metadata);
  // Worker factories keep their existing object input. Native lanes can parse
  // the already available JSON without cloning the entire definition graph.
  let input = { definitions };
  if (!options?.workerFactory && !options?.deathWorkerFactory && !options?.duoWorkerFactory) {
    const shared = new SharedArrayBuffer(definitionBytes.byteLength);
    new Uint8Array(shared).set(definitionBytes);
    input = { definitionBytes: shared };
  }
  return createTaskScheduler({ ...options, workerData: { ...input, datasetSelection: dataset.workerSelection(), datasetDigest: dataset.digest, datasetOptions, preparedDatasetStages: preparedDefinitionStages(definitions), world: { chunks: world.chunks, areas: world.areas, ...(world.surface ? { surface: world.surface } : {}) }, extraRules } });
}

function migrationSummary(state) {
  const migration = state.legacy?.gameplayMigration;
  const unresolved = migration?.unresolved ?? [];
  const identities = state.provenance?.taskIdentityMigration;
  const warnings = [...(migration?.warnings ?? unresolved.map(item => `Could not import ${({ checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' })[item.source] ?? item.source} ${item.category}/${item.legacyKey} for ${state.members.find(member => member.id === item.memberId)?.name ?? item.memberId}: ${({ 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' })[item.reason] ?? item.reason}.`))].map(warning => String(warning)
    .replace(/Could not migrate ([^ ]+) (.+?) for member ([^:]+): (.+?)\./g, (_, source, task, memberId, reason) => `Could not import ${({ checkedAllTasks: 'task check', checkedChallenges: 'challenge check', completedChallenges: 'completed challenge', backlog: 'backlog choice', favoriteTasks: 'pinned task' })[source] ?? source} ${task} for ${state.members.find(member => member.id === memberId)?.name ?? memberId}: ${({ 'ambiguous legacy task ID': 'more than one task matches this original check', 'unknown legacy task ID': 'no task matches this original check', 'task is absent from the category catalogue': 'this task is not listed in its category' })[reason] ?? reason}.`)
    .replace(/Unresolved saved task ID ([^ ]+) at (.+); the original record is preserved for review\./g, (_, id, path) => `Saved task ${state.tasks.find(task => task.id === id)?.label ?? id} at ${path} could not be matched; the original record is kept for review.`)
    .replace(/Map ([^ ]+) has /g, (_, id) => `${state.members.find(member => member.sourceMapId === id)?.name ?? id}’s original map has `)
    .replace(/Member ([^ ]+) references missing legacy map ([^.]+)\./g, (_, id, mapId) => `${state.members.find(member => member.id === id)?.name ?? id}’s original map ${mapId} is missing from this save.`)
    .replaceAll('it remains in legacy data.', 'it stays in the saved original-picker copy.')
    .replaceAll('unsupported chunk key', 'unsupported chunk number')
    .replaceAll('map-wide chunkNotes document with no base chunk key', 'map-wide note with no whole chunk number')
    .replaceAll('malformed manual section data', 'invalid section access choices')
    .replaceAll('malformed manual section', 'invalid section access choice')
    .replaceAll('malformed manual area', 'invalid area access choice')
    .replaceAll('non-primitive rule', 'invalid rule value for')
    .replaceAll('Task identity collisions establish a new undo boundary; the complete preceding history is retained in migration archives.', 'Different saved task records match the same task. Undo now starts after this import; all earlier History is kept in the saved import archive.')
    .replaceAll('task identity conflict(s) were preserved in migration provenance; explicit canonical fields take precedence.', 'conflicting saved task records are kept in the import details; values saved directly under the current task take precedence.')
    .replaceAll('task identity conflict(s) remain in migration provenance for review.', 'conflicting saved task records remain in the import details for review.'));
  for (const item of identities?.unresolved ?? []) warnings.push(`Saved task ${state.tasks.find(task => task.id === item.originalId)?.label ?? item.originalId} at ${item.path} could not be matched; the original record is kept for review.`);
  if (identities?.conflicts?.length) warnings.push(`${identities.conflicts.length} conflicting saved task records remain in the import details for review.`);
  return { stateRevision: state.revision, warnings: [...new Set(warnings)],
    report: { ...(migration?.report ?? { catalogueTasks: state.tasks.length, unresolved, taskStatusProvenance: migration?.taskStatusProvenance ?? [] }),
      ...(identities ? { identities: Object.fromEntries(Object.entries(identities).filter(([key]) => key !== 'archives')) } : {}) } };
}

function convertLegacyCapture(document, { members, capturedAt, registry } = {}) {
  const metadata = document?.metadata && typeof document.metadata === 'object' && !Array.isArray(document.metadata) ? document.metadata : {};
  const captureDate = capturedAt ?? document?.capturedAt ?? metadata.capturedAt;
  if (captureDate !== undefined && (typeof captureDate !== 'string' || !Number.isFinite(Date.parse(captureDate)))) throw new TypeError('capturedAt must be a valid date string.');
  const imported = importLegacyMaps(document, { members, capturedAt: captureDate, registry });
  const capture = {};
  if (captureDate !== undefined) capture.capturedAt = captureDate;
  if (typeof metadata.hash === 'string' && /^sha256:[a-f0-9]{64}$/i.test(metadata.hash)) capture.hash = metadata.hash;
  for (const key of ['hashScope', 'sourceVersion', 'source']) {
    if (typeof metadata[key] === 'string' && metadata[key].length > 0 && metadata[key].length <= 256) capture[key] = metadata[key];
  }
  if (typeof metadata.sourceOrigin === 'string') {
    try {
      const origin = new URL(metadata.sourceOrigin);
      if (['http:', 'https:'].includes(origin.protocol) && !origin.username && !origin.password && origin.origin === metadata.sourceOrigin) capture.sourceOrigin = metadata.sourceOrigin;
    } catch { /* An invalid source descriptor is not retained. */ }
  }
  if (Object.keys(capture).length) {
    imported.state.provenance.capture = capture;
    imported.warnings = imported.warnings.filter(warning => warning !== 'Original export entry metadata was not kept.' && (captureDate === undefined || warning !== 'Original export entry capturedAt was not kept.'));
  }
  return imported;
}

/** Create the private local application without binding a port until listen(). */
export async function createServer({ dataDir, host = '127.0.0.1', port = 8788,
  dataset, world, definitions, taskMap, registry, initialState, prepareState, beforeCommit, now, random,
  webRoot = path.join(ROOT, 'app', 'web'), resourcesRoot = path.join(ROOT, 'resources'), initialImport,
  taskArtworkRoot = path.join(webRoot, 'task-item-artwork.2026-10-09.v1'),
  worldImagesRoot,
  packsDir = process.env.RS3_PACKS_DIR || path.join(ROOT, '.local', 'packs'),
  packSelection = process.env.RS3_PACK_SELECTION,
  runeMetrics = {}, originalSync = {}, privateAddonOptions = {},
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
  // Optional second listener on 127.0.0.1 for Tailscale Funnel, which can only proxy to loopback.
  loopbackPort = process.env.RS3_LOOPBACK_PORT ? Number(process.env.RS3_LOOPBACK_PORT) : undefined,
  httpServer, httpLoopbackServer, startupConnections, onRequestHandler, startupSignal,
} = {}) {
  const initializationStarted = performance.now();
  dataset ??= await resolveDataset({ packsDir, selectionPath: packSelection, mapAssetsDir, gameDataDir });
  worldImagesRoot ??= path.join(ROOT, ...(dataset.gameDefaults.compatibility?.worldImagesPath ?? ['.local', 'world-images']));
  adoptLegacyMetadataProvider(dataset);
  const privateAddon = await loadPrivateAddon(privateAddonOptions);
  const appVersion = privateAddon ? createHash('sha256').update(`${APP_VERSION}:${privateAddon.addonSha256}`).digest('hex').slice(0, 12) : APP_VERSION;
  dataset = datasetWithPrivateAddon(dataset, privateAddon);
  // Refuse a broken executable installation before opening or preparing saves.
  const originalSyncIntegration = await loadOriginalSyncIntegration(dataset, undefined, privateAddon);
  dataDir ??= defaultGameDirectory(ROOT, dataset);
  await prepareGameStorage(dataDir, dataset);
  if (initialImport && !datasetFeature(dataset, 'originalSync')) throw httpError(422, 'Restore a starter backup through Backup & Import.');
  const browserDataset = await datasetBrowserPayload(dataset);
  const startupTimingMs = { cataloguesMs: 0, workerAndReferencesMs: 0, storeMs: 0, authMs: 0, variantMs: 0, stateResponseMs: 0 };
  publicOrigin = normalizePublicOrigin(publicOrigin);
  const limits = createRateLimits(rateLimits);
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
  let definitionBytes = definitions === undefined ? originalData.definitionBytes : Buffer.from(JSON.stringify(definitions));
  const taskBytes = taskMap === undefined ? originalData.taskBytes : Buffer.from(JSON.stringify(taskMap));
  const parsedDefinitions = prepareServerDefinitions(JSON.parse(definitionBytes.toString('utf8')), dataset, { reviewedOverlays: definitions === undefined });
  definitionBytes = Buffer.from(JSON.stringify(parsedDefinitions));
  const parsedTaskMap = JSON.parse(taskBytes.toString('utf8'));
  const datasetOptions = { reviewedOverlays: definitions === undefined, ...(definitions === undefined ? {} : { cacheWalking: false }) };
  const indexedWorld = world ?? buildWorld(parsedDefinitions, { dataset, ...datasetOptions });
  startupTimingMs.cataloguesMs = performance.now() - initializationStarted;
  const workerStarted = performance.now();
  let chunkSectionsPending;
  const loadChunkSections = () => chunkSectionsPending ??= chunkSectionCatalogue
    ? Promise.resolve(buildChunkSectionIndex(chunkSectionCatalogue, indexedWorld))
    : loadChunkSectionIndex(gameDataDir, ROOT, indexedWorld, { dataset });
  const ruleRegistry = registry ?? createRuleRegistry();
  const storeProcessPending = prepareStoreProcessIdentity();
  const definitionCachePending = cachedJSON(definitionBytes), taskCachePending = cachedJSON(taskBytes);
  const taskWorkerPending = parsedDefinitions.challenges && typeof parsedDefinitions.challenges === 'object' && !Array.isArray(parsedDefinitions.challenges)
    ? startTaskWorker(parsedDefinitions, definitionBytes, indexedWorld, ruleRegistry, taskWorkerOptions, dataset, datasetOptions) : Promise.resolve(null);
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
  if (startupSignal?.aborted) { await taskWorker?.close(); startupSignal.throwIfAborted(); }
  const abortCalculator = () => { void taskWorker?.close(); };
  startupSignal?.addEventListener('abort', abortCalculator, { once: true });
  startupTimingMs.workerAndReferencesMs = performance.now() - workerStarted;
  const storeStarted = performance.now();
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
  let store;
  prepareState = preserveGameIdentity(dataset, prepareState);
  try { store = await openStore({ dataDir, world: indexedWorld, registry: ruleRegistry, initialState, migrateState, prepareState, beforeCommit, now, random, retention, membersStartBanks, xpChoiceCatalogue, progressQuestPoints: createProgressQuestPoints(parsedDefinitions),
    taskCatalogue: taskWorker ? new Map([...taskWorker.catalogue, ...taskWorker.dynamicCatalogue].map(({ level, ...task }) => [task.id, task])) : undefined }); }
  catch (error) { await taskWorker?.close(); throw error; }
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
  } catch (error) { await store.close(); await taskWorker?.close(); throw error; }
  startupTimingMs.storeMs = performance.now() - storeStarted;
  const authStarted = performance.now();
  const token = store.getAccessToken();
  // The first map belongs to the master owner. Feedback aliases her private
  // master sessions to linked owner invitations without changing History actors.
  const feedbackOwnerId = store.getState().members[0]?.id;
  const feedbackActor = identity => identity.kind === 'master' && feedbackOwnerId
    ? { ...identity.actor, memberId: feedbackOwnerId } : identity.actor;
  let invites, feedback, overlays, usage;
  try {
    invites = await openInviteStore({ dataDir, masterToken: token, masterLabel: dataset.gameDefaults.masterLabel }); feedback = await openFeedbackStore({ dataDir });
    usage = await openUsageRoute({ dataDir, members: store.getState().members,
      authenticate: (request, security) => invites.authenticate(request, security), bodyJSON, json,
      ...(now === undefined ? {} : { now: () => typeof now === 'function' ? now() : now }), rateLimits: usageRateLimits });
    overlays = await openOverlays({ dataDir, store, world: indexedWorld, webRoot, publicOrigin,
      authenticateAdmin: (request, security) => invites.authenticate(request, security), checkRequestOrigin, serializeMutation,
      unauthenticated: key => limits.unauthenticated(key) });
  }
  catch (error) { await Promise.all([invites?.close(), feedback?.close(), usage?.close(), store.close(), taskWorker?.close()]); throw error; }
  if (startupSignal?.aborted) { await overlays.close(); await Promise.all([store.close(), taskWorker?.close(), invites.close(), feedback.close(), usage.close()]); startupSignal.throwIfAborted(); }
  startupTimingMs.authMs = performance.now() - authStarted;
  // Compile the static fingerprint before readiness; subsequent saves hash
  // only changed gameplay fields rather than the large migration archives.
  if (taskWorker) {
    store.getGameplayFingerprint();
    // Warm immutable catalogue/legacy digests before readiness. Later exact
    // saved reuse hashes only the changed small fields on the Unlock path.
    void store.getCalculationSnapshot().taskInputKey;
  }
  const runeMetricsClient = createRuneMetricsClient(runeMetrics), questMapping = createQuestMapping(parsedDefinitions);
  const runeMetricsPreviews = new Map();
  const originalSyncClient = originalSyncIntegration?.createOriginalSyncClient(originalSync), originalSyncPreviews = new Map();
  const originalSyncNow = () => (originalSync.now?.() ?? new Date()).getTime();
  const previewLifetimeMs = 10 * 60 * 1000;
  const stateEnvelope = state => ({ state, pools: Object.fromEntries(state.members.map(member => [member.id, evaluateRollPool(indexedWorld, state, member.id, ruleRegistry)])) });
  const responseCache = createResponseCache({ maxEntries: 32, maxBytes: 48 * 1024 * 1024 });
  const staticCache = createResponseCache({ maxEntries: 128, maxBytes: 48 * 1024 * 1024 });
  const sandboxPools = createResponseCache({ maxEntries: 32, maxBytes: 4 * 1024 * 1024 });
  const poolRanking = createPoolRanking(), rankingPools = new Map();
  let rankingPoolInput, rankingLeaseTimer;
  function rankingPoolIds(state, memberId, input) {
    if (rankingPoolInput !== input) { rankingPools.clear(); rankingPoolInput = input; }
    if (!rankingPools.has(memberId)) rankingPools.set(memberId,
      evaluateRollPool(indexedWorld, state, memberId, ruleRegistry).eligible.map(row => row.id));
    return rankingPools.get(memberId);
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
  function stateRepresentation(view, info = store.getInfo()) {
    const key = `state:${info.revision}:${view ?? 'full'}`;
    let cached = responseCache.get(key);
    if (!cached) {
      const saved = store.getStateSnapshot({ view });
      cached = responseCache.set(key, createRepresentation(Buffer.from(`{"state":${saved.stateJSON},"pools":${JSON.stringify(saved.pools)},"store":${JSON.stringify(info)}${view ? ',"format":"play-v1","schemaVersion":1' : ''}}`)));
    }
    return cached;
  }
  function viewEnvelope(state, view) {
    const envelope = stateEnvelope(state);
    if (view !== PLAY_VIEW) return envelope;
    return { format: PLAY_VIEW, schemaVersion: 1, state: projectPlayState(state),
      pools: Object.fromEntries(state.members.map(member => [member.id, { ...envelope.pools[member.id],
        partnerConnections: partnerConnections(indexedWorld, state, member.id, ruleRegistry) }])) };
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
  async function rememberTaskResult(revision, memberId, evaluation, input, retainFull = false) {
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
    for (const client of clients) client.write(`event: task-ready\ndata: ${JSON.stringify({ revision, memberId })}\n\n`);
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
    const pending = mutationQueue.then(operation);
    mutationQueue = pending.catch(() => {});
    return pending;
  }
  const connections = startupConnections ?? new Set(), savingConnections = new Map();
  let connectionDeadlinePassed = false;
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
    if (closed) return;
    if (claimCleanupRun) { claimCleanupAgain = true; return; }
    if (claimCleanupImmediate) return;
    claimCleanupImmediate = setImmediate(() => {
      claimCleanupImmediate = undefined;
      claimCleanupRun = Promise.resolve().then(async () => {
        if (closed) return;
        const candidates = claimCleanupCandidates();
        if (!candidates) return;
        lastClaimCheckKey = candidates.key;
        await serializeMutation(() => closed ? undefined : store.reconcileTaskClaims(candidates.activeTaskIds, candidates.revision));
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
  let foregroundActive = 0, foregroundLastActivity = schedulingClock.now(), foregroundCompletedRevision = -1, foregroundAwaitedRevision = -1, awaitingForeground;
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
    if (!taskWorker || closed || !predictionPrewarm && !poolRanking.interestedMembers().size) return;
    schedulingClock.clearTimeout(prewarmTimer);
    // Cheap guards run before cloning state, computing pools, or starting the
    // prediction worker. Foreground loading wins even on slow state transfers.
    prewarmTimer = schedulingClock.setTimeout(() => {
      if (closed) return;
      const time = schedulingClock.now();
      if (startupWarmup && ['pending', 'running'].includes(startupWarmup.diagnostics().status)) { schedulePredictions(); return; }
      if (foregroundActive || automaticDeathActive) { schedulePredictions(); return; }
      if (requiredTaskMembers.size && [...requiredTaskMembers].some(id => !settledTaskMembers.has(id))) { schedulePredictions(); return; }
      if (awaitingForeground && time < awaitingForeground.until) { schedulePredictions(Math.min(1000, awaitingForeground.until - time)); return; }
      awaitingForeground = undefined;
      const quietRemaining = 1000 - (time - foregroundLastActivity);
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
      const pools = state.members.map(member => interested.has(member.id)
        ? poolRanking.missing(member.id, valid(rankingPoolIds(state, member.id, input))) : []);
      for (let index = 0; index < Math.max(0, ...pools.map(ids => ids.length)); index++) {
        state.members.forEach((member, owner) => { if (pools[owner][index]) groups.push({ memberId: member.id,
          chunkIds: [pools[owner][index]], purpose: 'ranking' }); });
      }
      taskWorker.prewarm(state, input, groups);
    }, delay);
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
  async function evaluatedTasks(state, memberId, type = 'evaluate', chunkId, signal, chunkIds = [], resultView = 'full', stateInput, evaluationLane = 'foreground', duoSidebarProjection = false, retainFull = false, afterRemembered) {
    const side = type === 'chunk-planning' || type === 'death-estimates' || type === 'evaluate' && resultView === 'full' && nativeForegroundState && requiredTaskMembers.size > 0;
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
    // Share the task-input boundary with unlock predictions. Pool selections,
    // pending offers and blacklists cannot change these calculation results.
    let completed = false;
    const input = stateInput?.inputKey ?? calculationState().input;
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
        setImmediate(() => rememberTaskResult(state.revision, memberId, evaluation, input, retainFull).then(afterRemembered).catch(() => {}));
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
  const unsubscribe = store.subscribe(({ revision, ownershipChanged }) => {
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
    }
    notifyForeground();
    endInactiveClients();
    for (const client of clients) client.write(`event: revision\ndata: ${JSON.stringify({ revision, ...(taskResultsUnchanged ? { taskResultsUnchanged: true } : {}) })}\n\n`);
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
      responseCache.clear(); staticCache.clear(); sandboxPools.clear();
      definitionCache = createRepresentation(definitionBytes); taskCache = createRepresentation(taskBytes);
      identityLookup = undefined; identityLookupRevision = -1; trainingSourceIndex = undefined;
      mapInfoCache.clear(); npcShopInfoCache = undefined; archaeologyCache = undefined;
      interiorsPending = undefined; chunkSectionsPending = undefined;
    }
    endInactiveClients();
    for (const client of clients) client.write(`event: worker\ndata: ${JSON.stringify(worker)}\n\n`);
  });
  let importingBackup = false;
  const requestHandler = async (request, response) => {
    const security = requestContext(request, { host, publicOrigin });
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
      const remaining = (savingConnections.get(socket) ?? 1) - 1;
      if (remaining) savingConnections.set(socket, remaining); else savingConnections.delete(socket);
      if (connectionDeadlinePassed && !remaining) socket.destroySoon();
    }
    response.once('finish', saveFinished); response.once('close', saveFinished);
    try {
      let identity = invites.authenticate(request, security);
      const rawPath = (request.url ?? '/').split('?')[0];
      let route;
      try { route = decodeURIComponent(rawPath); } catch { throw httpError(400, 'Invalid URL.'); }
      if (route.includes('\\') || route.includes('\0') || route.split('/').some(part => part === '..' || part === '.')) throw httpError(404, 'Not found.');
      if (await overlays.handle(request, response, { route, security, closed })) return;
      if (!identity) limits.unauthenticated(security.rateKey);
      if (request.method === 'GET' && route.startsWith('/join/')) {
        if (closed) throw httpError(503, 'Please try again later.');
        const finishJoin = limits.beginJoin(security.rateKey);
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
        response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': PRIVATE_NO_STORE });
        response.end('Access required.'); return;
      }
      await invites.touch(identity);
      // A concurrent revoke can finish while persisting the usage timestamp.
      identity = invites.authenticate(request, security);
      if (!identity) throw httpError(401, 'Access required.');
      // Aggregate usage is the sole viewer POST exception; gameplay stays read only.
      const usageWrite = route === '/api/usage' && request.method === 'POST';
      if (identity.readOnly && !['GET', 'HEAD'].includes(request.method) && !usageWrite) throw httpError(403, 'This link is view only.');
      function requireAdmin() { if (!identity.admin) throw httpError(403, 'Administrator access required.'); }
      function requirePermission() {
        const permission = apiPermission(request.method, route);
        if (identity.readOnly && !usageWrite && (!['GET', 'HEAD'].includes(request.method) || !['read', 'saved-tasks'].includes(permission))) throw httpError(403, 'This link is view only.');
        if (permission === 'admin') requireAdmin();
      }
      if (!originalSyncIntegration && (route.startsWith('/api/original-sync/') || unavailableDatasetFeature(dataset, route) === 'originalSync')) {
        throw httpError(404, 'Not found.');
      }
      if (privateAddon?.features.originalSync && route.startsWith('/api/original-sync/')) await privateAddon.verify();
      if (route.startsWith('/api/')) {
        requirePermission();
        if (unavailableDatasetFeature(dataset, route)) throw httpError(422, 'This feature is unavailable in this game.');
        if (closed && route !== '/api/health') throw httpError(503, 'The picker is stopping. Retry after it restarts.');
        if (await usage.handle(request, response, { route, security, identity, closed: () => closed, checkRequestOrigin })) return;
        if (route === '/api/chunk-sections' && request.method !== 'GET') throw httpError(405, 'Method not allowed.');
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (route === '/api/session') { await json(request, response, 200, { admin: identity.admin, readOnly: identity.readOnly, capabilities: identity.capabilities, label: identity.label, kind: identity.kind, memberId: identity.memberId ?? null, actor: identity.actor }); return; }
          if (route === '/api/pool-ranking') {
            const query = new URL(request.url, 'http://localhost').searchParams;
            const captured = calculationState(), state = captured.state, memberId = query.get('memberId');
            if (!state.members.some(member => member.id === memberId)) throw httpError(400, 'Choose a known player to compare the roll pool.');
            const ids = rankingPoolIds(state, memberId, captured.input);
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
          if (route === '/api/backup-status') { requireAdmin(); await json(request, response, 200, await readBackupStatus(dataDir)); return; }
          if (route === '/api/admin/master-link') { requireAdmin(); await json(request, response, 200, { link: handle.inviteUrl }); return; }
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
            await sendCached(request, response, stateRepresentation(view, info)); return;
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
            await json(request, response, 200, { ready: !closed && worker.ready && !worker.stuck && !worker.restartRequired, status: closed ? 'stopping' : worker.stuck ? 'stuck' : worker.restartRequired ? 'restart-required' : warming ? 'warming' : worker.ready ? 'ready'
              : ['sleeping', 'waking'].includes(worker.status) ? worker.status : 'degraded',
              savesReady: !closed, worker, local: true, revision: store.getInfo().revision, version: appVersion, schemaVersion: 1 }); return;
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
              referenceCache: { entries: 2, bytes: definitionCache.retainedBytes + taskCache.retainedBytes },
              startupTimingMs: { ...startupTimingMs },
              startupPrepared: { ...startupPrepared },
              startupWarmup: startupWarmup?.diagnostics() ?? { status: 'disabled' },
              idleGc: idleMemory.diagnostics(),
              viewerTaskCache: { entries: savedTaskResults.size,
                playBytes: [...savedTaskResults.values()].reduce((sum, row) => sum + row.bytes, 0),
                fullCompressedBytes: [...savedTaskResults.values()].reduce((sum, row) => sum + retainedFullBytes(row), 0) },
              responseCache: { entries: responseCache.size, bytes: responseCache.bytes }, staticCache: { entries: staticCache.size, bytes: staticCache.bytes } }); return;
          }
          if (route === '/api/definitions') {
            const view = new URL(request.url, 'http://localhost').searchParams.get('view');
            if (view === 'map-layers-v1') { await sendCached(request, response, cachedValue('map-layer-definitions', () => projectMapLayerData(parsedDefinitions))); return; }
            const display = view === 'display-v1';
            await sendCached(request, response, display ? cachedValue('display-definitions', () => ({ chunks: parsedDefinitions.chunks })) : definitionCache); return;
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
          if (route === '/api/task-map') { await sendCached(request, response, taskCache); return; }
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
            const rows = evaluateTransportRoutes(indexedWorld, preview, memberId).map(row => ({
              id: row.id, name: row.name, group: row.group ?? 'transport',
              available: row.global ? (row.rollAvailable ?? row.available) : row.available,
              reason: (row.global ? row.rollReason : row.reason) ?? row.reason ?? 'Travel evidence unresolved',
              reasons: (row.global ? row.rollReasons : row.reasons) ?? row.reasons ?? [],
              accessAvailable: row.available, accessReason: row.reason,
              rollOnly: !!(row.global && row.rollAvailable && !row.available),
              destination: row.rollDestination?.chunkId ?? row.destination ?? row.to?.split('-')[0] ?? '',
              destinationName: indexedWorld.chunks.get(row.rollDestination?.chunkId ?? row.destination)?.name ?? row.destinationName ?? '', estimated: !!row.estimated,
              override: row.override ?? null, pending: !!row.pending,
              provenance: row.provenance, endpointEvidence: row.endpointEvidence,
            }));
            await json(request, response, 200, { stateRevision: state.revision, memberId,
              automatic: state.rules?.['travel.automatic'] === true, rows,
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
                chunkIds = [...new Set([...evaluateRollPool(indexedWorld, state, memberId, ruleRegistry).eligible.map(row => row.id), ...selected])].sort();
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
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': PRIVATE_NO_STORE, Connection: 'keep-alive' });
            if (request.method === 'HEAD') { response.end(); return; }
            response.write(`event: revision\ndata: ${JSON.stringify({ revision: store.getInfo().revision })}\n\n`);
            response.write(`event: version\ndata: ${JSON.stringify({ version: appVersion })}\n\n`);
            if (taskWorker) response.write(`event: worker\ndata: ${JSON.stringify(taskWorker.getHealth())}\n\n`);
            clients.add(response);
            clientCredentials.set(response, { request, security });
            const heartbeat = setInterval(() => { endInactiveClients(); if (clients.has(response)) response.write(': keepalive\n\n'); }, 20000);
            heartbeat.unref();
            request.on('close', () => { clearInterval(heartbeat); clients.delete(response); clientCredentials.delete(response); });
            return;
          }
        } else if (request.method === 'POST') {
          checkRequestOrigin(request, security);
          if (isImportRoute(route)) {
            if (importingBackup) throw httpError(503, 'Another backup is being checked or imported. Wait for it to finish, then try again.');
            importingBackup = ownsImport = true;
          }
          const importedFile = isImportRoute(route) ? await readBackupRequest(request) : null;
          const body = importedFile ? importedFile.body : await bodyJSON(request, route === '/api/sandbox/evaluate' ? 64 * 1024 : route === '/api/worker-restart' || route === '/api/prediction-intent' || route === '/api/pool-ranking-intent' || route.startsWith('/api/runemetrics/') || route.startsWith('/api/invites') ? 8192 : route.startsWith('/api/feedback') ? 16384 : MAX_BODY);
          if (importedFile?.uploaded && body.document && route.startsWith('/api/restore')) route = route.replace('/api/restore', '/api/import');
          const execute = async () => {
            if (closed) throw httpError(503, 'The picker is stopping. Retry after it restarts.');
            // A session may have been revoked while a slow body was arriving.
            identity = invites.authenticate(request, security);
            if (!identity) throw httpError(401, 'Access required.');
            requirePermission();
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
              const poolStarted = performance.now(), poolKey = JSON.stringify([state.revision, draft.memberId, draft.changes]);
              let pool = sandboxPools.get(poolKey); const poolHit = !!pool;
              if (!pool) {
                const hypothetical = applySandboxChanges(state, draft.memberId, draft.changes, sandboxCatalogue, captured.sandboxTaskIndex);
                const rollPool = { ...evaluateRollPool(indexedWorld, hypothetical, draft.memberId, ruleRegistry),
                  partnerConnections: partnerConnections(indexedWorld, hypothetical, draft.memberId, ruleRegistry) };
                pool = sandboxPools.set(poolKey, createRepresentation(Buffer.from(JSON.stringify(rollPool))));
              }
              const sandboxPoolMs = performance.now() - poolStarted;
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
            if (route === '/api/invites') {
              requireAdmin();
              if (!knownMember(body.memberId)) throw httpError(400, 'Choose a known player for the invite.');
              const created = await invites.create(body);
              await json(request, response, 201, { invite: created.invite, link: `${publicOrigin ?? security.origin}/join/${created.token}` }); return;
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
            if (['/api/command', '/api/restore', '/api/import', '/api/member-restore', '/api/runemetrics/apply'].includes(route)) {
              savingSocket = request.socket;
              savingConnections.set(savingSocket, (savingConnections.get(savingSocket) ?? 0) + 1);
            }
            if (route === '/api/shutdown') {
              requireAdmin();
              await json(request, response, 202, { status: 'stopping' });
              void handle.close().catch(() => { process.exitCode = 1; }); return;
            }
            if (route === '/api/runemetrics/preview') {
              if (Object.keys(body).some(key => key !== 'memberId')) throw httpError(400, 'RuneMetrics preview accepts only memberId.');
              const owner = store.getState().members.find(member => member.id === body.memberId);
              if (!owner) throw httpError(400, 'Choose a known player for RuneMetrics sync.');
              const snapshot = await runeMetricsClient.snapshot(owner);
              const current = store.getState(), latest = current.members.find(member => member.id === owner.id);
              if (!latest || latest.runescapeName !== owner.runescapeName) throw Object.assign(httpError(409, 'The RuneScape name changed while fetching. Review a new sync.'), { code: 'REVISION_CONFLICT', state: current });
              const proposal = previewRuneMetrics(current, owner.id, snapshot, questMapping);
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
              await json(request, response, 200, viewEnvelope(state, viewFor(request))); return;
            }
            if (route === '/api/profile/preview') {
              const state = store.getState();
              await json(request, response, 200, { ...previewRuleProfile(state, body.profile, body.memberId, ruleRegistry), stateRevision: state.revision }); return;
            }
            if (route === '/api/command') {
              if (body.command?.type === 'prune-task-claims') throw httpError(400, 'Task claims are tidied up automatically.');
              if (!Object.hasOwn(commandPermissions, body.command?.type)) throw httpError(400, 'Unknown gameplay command.');
              if (body.command?.type === 'replace-member') throw httpError(400, 'To replace a player’s map, review the backup in Backup & Import first.');
              if (body.command?.type === 'apply-runemetrics') throw httpError(400, 'Review the RuneMetrics sync preview before saving progress.');
              let command = body.command;
              if (unavailableDatasetFeature(dataset, route, command?.type)) throw httpError(422, 'This feature is unavailable in this game.');
              if (command?.type === 'set-xp-choices' && !identity.admin && (!identity.memberId || command.memberId !== identity.memberId)) {
                throw httpError(403, 'You can only change XP choices for your signed-in player.');
              }
              if (command?.type === 'set-finish-line-custom' && !identity.admin && (!identity.memberId || command.memberId !== identity.memberId)) {
                throw httpError(403, 'You can only tick custom finish line items for your signed-in player.');
              }
              if (command?.type === 'undo' && !identity.admin) {
                const target = store.getHistoryEvent(command.undoRevision ?? store.getUndoEligibility().undoRevision);
                if (target?.type === 'set-finish-line-custom' && (!identity.memberId || target.command?.memberId !== identity.memberId)) {
                  throw httpError(403, 'You can only undo finish line ticks for your signed-in player.');
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
              await commandJSON(request, response, await store.commandSerialized(command, body.expectedRevision, { omitUnchanged: true, actor: identity.actor, view: viewFor(request) })); return;
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
              await json(request, response, 200, { ...viewEnvelope(await store.command(command, body.expectedRevision, { actor: identity.actor }), viewFor(request)), warnings }); return;
            }
            // Replacing the whole save is an administrator action; invites keep normal gameplay.
            if (/^\/api\/(?:restore|import)(?:\/preview)?$/.test(route)) requireAdmin();
            if (route === '/api/restore/preview') {
              // Storage validates the complete public backup at its replacement boundary.
              const replacement = await store.previewReplacement(await restoreBackup(body));
              const preview = previewRestore(replacement.current, replacement.state, registry);
              await json(request, response, 200, importedFile?.uploaded ? { preview, state: backupPreviewState(replacement.state) }
                : Object.hasOwn(body, 'backupId') ? { preview, state: projectPlayState(replacement.state) } : preview); return;
            }
            if (route === '/api/restore') { await json(request, response, 200, viewEnvelope(await store.replace(await restoreBackup(body), body.expectedRevision, { actor: identity.actor }), viewFor(request))); return; }
            if (route === '/api/import/preview' || route === '/api/import') {
              const imported = convertLegacyCapture(body.document, { members: body.members, capturedAt: body.capturedAt, registry: ruleRegistry });
              const current = store.getState();
              for (const member of imported.state.members) member.obtainedEquipment = [...(current.members.find(owner => owner.id === member.id)?.obtainedEquipment ?? [])];
              if (route.endsWith('/preview')) {
                const replacement = await store.previewReplacement(imported.state);
                await json(request, response, 200, { preview: previewRestore(replacement.current, replacement.state, registry), warnings: [...imported.warnings, ...migrationSummary(replacement.state).warnings],
                  ...(importedFile?.uploaded ? { format: PLAY_VIEW, schemaVersion: 1, state: backupPreviewState(replacement.state) } : viewEnvelope(replacement.state, viewFor(request))) });
              } else {
                const state = await store.replace(imported.state, body.expectedRevision, { actor: identity.actor });
                await json(request, response, 200, { ...viewEnvelope(state, viewFor(request)), warnings: [...imported.warnings, ...migrationSummary(state).warnings] });
              }
              return;
            }
            throw httpError(404, 'API route not found.');
          };
          // Order revocation with accepted saves. Once revoke returns, a queued
          // request cannot commit using the revoked session or admin capability.
          const durable = ['/api/command', '/api/restore', '/api/import', '/api/member-restore', '/api/runemetrics/apply', '/api/shutdown'].includes(route)
            || route === '/api/invites' || /^\/api\/invites\/[^/]+\/(?:revoke|player)$/.test(route);
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
      else if (['/overlay-panel.mjs', '/overlay-panel.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
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
      else if (['/task-hover.mjs', '/task-methods.mjs', '/task-equipment.mjs', '/task-artwork.mjs', '/task-ui.css', '/bis-panel.css', '/duo-tasks.mjs', '/duo-task-view.mjs', '/duo-tasks.css', '/task-claims.mjs', '/task-filters.mjs', '/task-filters-model.mjs', '/task-filters.css', '/custom-tasks-model.mjs', '/screen-custom-tasks.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/art-status.mjs', '/art-status.css', '/dataset-status.mjs', '/dataset-features.mjs', '/browser-task-icons.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (/^\/placeholder-art\/(?:skill-[a-z]+|task-(?:quest|achievements|minigame|clue|music)|pin-(?:general|transport|skilling|combat-slayer|quests-achievements|minigames|other)|item)\.svg$/.test(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/display-world.mjs') file = await containedFile(path.join(ROOT, 'app'), 'display-world.mjs');
      else if (route === '/data/access-policy.mjs') file = await containedFile(path.join(ROOT, 'app', 'data'), 'access-policy.mjs');
      else if (['/map-activity-layers.mjs', '/map-activity-layer-model.mjs', '/map-activity-layer-renderer.mjs', '/map-activity-layers.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/core/rule-registry.mjs', '/core/progress-index.mjs', '/core/automatic-transport.mjs', '/core/travel-inputs.mjs', '/core/progress-snapshots.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/teleports.mjs', '/teleports.css', '/backup-status.mjs', '/backup-transfer.mjs', '/map-display.mjs', '/map-display.css', '/map-task-counts.mjs', '/map-task-count-renderer.mjs', '/map-task-count-obstacles.mjs', '/map-place-labels.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/stream-safe.mjs', '/stream-safe.css', '/feedback-badge.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-roll-stats.mjs', '/roll-stats.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/profile-view.mjs', '/profile-model.mjs', '/profile-copy.mjs', '/profile.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/group-goals.mjs', '/group-goals.css', '/finish-line-view.mjs', '/finish-line-model.mjs', '/finish-line-copy.mjs', '/finish-line.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/screen-chunk-notes.mjs') file = await containedFile(webRoot, 'screen-chunk-notes.mjs');
      else if (['/screen-journal.mjs', '/journal.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (route === '/screen-backlog.mjs') file = await containedFile(webRoot, 'screen-backlog.mjs');
      else if (['/duo-task-lists.mjs', '/duo-backlog-view.mjs', '/duo-task-preferences.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-search.mjs', '/screen-search-data.mjs', '/search.css', '/map-search-layer.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/phone-layout.css', '/phone-layout.mjs', '/screen-phone-layout.mjs', '/chunk-long-press.mjs', '/map-control-discovery.mjs', '/calculation-feedback.mjs', '/screen-task-guidance.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-usage.mjs', '/usage-client.mjs', '/usage-model.mjs', '/usage-catalogue.mjs', '/usage.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/quest-map.mjs', '/quest-map-model.mjs', '/quest-map.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/screen-context.mjs', '/screen-ui.mjs', '/screen-settings.mjs', '/screen-commands.mjs', '/screen-roll.mjs', '/screen-map.mjs', '/screen-loading.mjs', '/screen-tasks.mjs', '/screen-task-dialogs.mjs', '/screen-chunks.mjs', '/screen-dialogs.mjs', '/screen-history.mjs', '/screen-live.mjs', '/screen-startup.mjs', '/screen-controls.mjs', '/screen-panels.mjs', '/dataset-panels.mjs', '/original-sync-loader.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/map-capture.mjs', '/screen-capture.mjs', '/map-capture.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/area-check.mjs', '/area-check-selection.mjs', '/area-check.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/partner-supply-model.mjs', '/partner-supply-view.mjs', '/partner-supply.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/tasks/rule-defaults.mjs', '/tasks/fact-projection.mjs', '/tasks/gameplay-compat.mjs', '/tasks/gameplay-facts.mjs', '/tasks/chunk-planning-index.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'tasks'), route.slice('/tasks/'.length));
      else if (['/data/surface-grid.mjs', '/data/world-connections.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
      else if (['/data/cache-archaeology.mjs', '/data/cache-interiors.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
      else if (['/rules-panel.mjs', '/rules-model.mjs', '/rules-review.mjs', '/rules-review-model.mjs', '/rules-review-preview.mjs', '/rule-explanations.mjs', '/rules-review.css', '/kept-rules.mjs', '/sandbox.mjs', '/sandbox.css', '/sandbox-rules.mjs', '/duo-coordination.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/completed-view.mjs', '/completed-model.mjs', '/completed-range.mjs', '/completed-range-preference.mjs', '/completed-view.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/helper.mjs', '/helper.css', '/helper-model.mjs', '/helper-training.mjs', '/helper-goals.mjs', '/helper-drops.mjs', '/helper-charts.mjs', '/helper-utilities.mjs', '/helper-progress.mjs', '/helper-progress-model.mjs'].includes(route)) file = await containedFile(webRoot, route.slice(1));
      else if (['/core/interior-maps.mjs', '/core/archaeology.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/core/experience.mjs', '/core/combat-level.mjs', '/core/f2p-skill-caps.mjs', '/core/finish-line.mjs', '/core/group-goals.mjs', '/core/group-goal-types.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'core'), route.slice('/core/'.length));
      else if (['/copy-lists.mjs', '/copy-list-control.mjs', '/copy-list-model.mjs', '/copy-lists.css'].includes(route)) file = await containedFile(webRoot, route.slice(1));
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
      let cached = staticCache.get(key);
      if (!cached) {
        const bytes = await readFile(file);
        if (expected && (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256)) throw httpError(404, `${iconFile ? 'Icon' : terrainFile ? 'Terrain asset' : 'Interior tile'} does not match its manifest.`);
        const extension = path.extname(file).toLowerCase();
        // Dates and v1 names are revalidated. Only paths carrying a content
        // digest can advertise immutable bytes across application updates.
        const immutable = route.startsWith('/assets/') && /[.-][a-f0-9]{12,}(?:[./-]|$)/i.test(route);
        cached = staticCache.set(key, createRepresentation(bytes, { type: MIME[extension] ?? 'application/octet-stream',
          cacheControl: immutable ? 'private, max-age=31536000, immutable' : PRIVATE_REVALIDATE,
          compress: ['.html', '.css', '.mjs', '.json', '.svg'].includes(extension) }));
      }
      await sendRepresentation(request, response, cached);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) { response.end(); return; }
      const status = error.code === 'REVISION_CONFLICT' ? 409 : error.status ?? (error.code === 'ENOENT' ? 404 : error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 400 : 500);
      if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
      await json(request, response, status, { message: status === 500 ? 'The save could not be completed. Your previous save remains available.' : redactInviteTokens(error.message),
        ...(error.code === 'TASK_RESULTS_UNAVAILABLE' ? { code: error.code } : {}),
        ...(error.code === 'REVISION_CONFLICT' ? viewEnvelope(error.state, viewFor(request)) : {}),
        ...(error.code === 'REVISION_CONFLICT' && error.claimOnlyChanges === true ? { claimOnlyChanges: true } : {}),
        ...((routeIsRuneMetrics(request) || (request.url ?? '').startsWith('/api/original-sync/')) && error.code !== 'REVISION_CONFLICT' && error.code ? { code: error.code } : {}) });
    } finally { if (ownsImport) importingBackup = false; }
  };
  const server = httpServer ?? http.createServer(requestHandler);
  const loopbackServer = httpLoopbackServer ?? (loopbackPort === undefined ? null : http.createServer(requestHandler));
  for (const listener of [server, loopbackServer]) listener?.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  const handle = {
    server, store, world: indexedWorld, dataset,
    getStartupTimingMs: () => ({ ...startupTimingMs }),
    address: () => server.address(),
    loopbackAddress: () => loopbackServer?.address() ?? null,
    get inviteUrl() {
      const address = server.address();
      const hostname = host.includes(':') ? `[${host}]` : host;
      return `http://${hostname}:${typeof address === 'object' && address ? address.port : port}/join/${token}`;
    },
    async listen() {
      if (closed) throw new Error('Server is closed.');
      if (readinessPrepared) return handle;
      try {
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
            const playState = stateRepresentation(PLAY_VIEW, info);
            await Promise.all([playState.encoded('br'), playState.encoded('gzip')]);
            startupPrepared.stateResponse = true;
          } catch {
            // Failed encoding slots are cleared by the representation helper;
            // an authenticated route can retry without stopping the server.
          } finally { startupTimingMs.stateResponseMs = performance.now() - started; }
        })();
        // The early dispatcher already owns the listener. Optional preparation
        // runs behind it; ordinary createServer callers retain their contract.
        if (!httpServer) await readinessPrepared;
        if (closed) throw new Error('Server is closed.');
        if (!server.listening) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
        if (loopbackServer && !loopbackServer.listening) await new Promise((resolve, reject) => { loopbackServer.once('error', reject); loopbackServer.listen(loopbackPort, '127.0.0.1', () => { loopbackServer.off('error', reject); resolve(); }); });
      } catch (error) { await handle.close(); throw error; }
      // A browser may still be starting before it can request state. Give that
      // initial admission time; foreground completion resumes the usual quiet
      // delay, while an unattended server still warms autonomously.
      schedulePredictions(10000);
      if (httpServer && taskWorker && nativeForegroundState) startupWarmup = createStartupWarmup({ worker: taskWorker, clock: schedulingClock,
        snapshot: calculationState, busy: () => foregroundActive > 0 || automaticDeathActive > 0 || listPending(store.getInfo().revision)
          || schedulingClock.now() - foregroundLastActivity < 1000 });
      return handle;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      idleMemory.close();
      clearImmediate(claimCleanupImmediate); claimCleanupImmediate = undefined;
      notifyForeground();
      schedulingClock.clearTimeout(prewarmTimer);
      startupWarmup?.close();
      clearTimeout(rankingLeaseTimer);
      closePromise = (async () => {
        const overlaysClosed = overlays.close();
        unsubscribe();
        runeMetricsClient.close(); runeMetricsPreviews.clear();
        originalSyncClient?.close(); originalSyncPreviews.clear();
        unsubscribeWorker?.();
        unsubscribeResidency?.();
        unsubscribePredictions?.(); poolRanking.clear(); rankingPools.clear();
        for (const client of clients) client.end();
        clients.clear();
        savedTaskResults.clear();
        clientCredentials.clear();
        // Stop accepting requests first. Slow bodies/connections and the worker
        // have a deadline; saves already in the store queue finish before unlock.
        let timer, saveResponseTimer;
        const listening = [server, loopbackServer].filter(listener => listener?.listening);
        const connectionsClosed = listening.length ? new Promise((resolve, reject) => {
          let open = listening.length;
          for (const listener of listening) {
            listener.close(error => error ? reject(error) : --open || resolve());
            listener.closeIdleConnections();
          }
          timer = setTimeout(() => {
            connectionDeadlinePassed = true;
            for (const socket of connections) if (!savingConnections.has(socket)) socket.destroy();
          }, shutdownDeadlineMs);
        }) : Promise.resolve();
        const authClosed = mutationQueue.then(() => Promise.all([invites.close(), feedback.close(), usage.close(), overlaysClosed]));
        const storeClosed = store.close({ beforeUnlock: authClosed });
        // A peer can stop reading an accepted save response. Protect its durable
        // transaction first, then bound the remaining network transmission too.
        const boundedResponses = storeClosed.then(() => {
          saveResponseTimer = setTimeout(() => { for (const socket of connections) socket.destroy(); }, shutdownDeadlineMs);
        });
        try { await Promise.all([connectionsClosed, taskWorker?.close(shutdownDeadlineMs), boundedResponses]); }
        finally { clearTimeout(timer); clearTimeout(saveResponseTimer); }
      })();
      return closePromise;
    },
  };
  onRequestHandler?.(requestHandler);
  startupSignal?.removeEventListener('abort', abortCalculator);
  return handle;
}

/** Production startup exposes private health before opening the save. */
export function startServer(options = {}) {
  const configured = { dataDir: defaultGameDirectory(ROOT, selectedDataset), ...options };
  return selectedDataset.capabilities.independent
    ? prepareGameStorage(configured.dataDir, selectedDataset).then(() => startEarlyServer(configured, createServer))
    : startEarlyServer(configured, createServer);
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
