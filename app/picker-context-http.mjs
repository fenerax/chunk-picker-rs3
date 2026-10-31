import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { parseRequestJSON, runBodyCheck } from './security/json.mjs';
import { importLegacyMaps } from './core/state.mjs';
import { groupGoalCommandTypes } from './core/group-goals.mjs';
import { TICK_ACTIVE_TASKS } from './core/tick-active-tasks.mjs';
import { PLAY_VIEW } from './play-view.mjs';
import { createRepresentation, sendRepresentation, negotiateEncoding, PRIVATE_NO_STORE } from './http-response.mjs';

// Backup routes use their separate streaming 256 MiB limit.
export const MAX_BODY = 1024 * 1024;
// About one task recalculation plus the usual quiet window on the real save.
export const NOTE_PREWARM_QUIET_MS = 5000;
export const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// Every API handler and gameplay command must have an explicit access decision.
// Unknown writes are denied before consuming their body, including future routes.
export const routePermissions = Object.freeze({
  GET: Object.freeze({
    '/api/game-plugin': 'read', '/api/game-plugin/review': 'read',
    '/api/plugin/v1/status': 'plugin', '/api/plugin/v1/tasks': 'plugin', '/api/session': 'read', '/api/coordination': 'read', '/api/invites': 'admin', '/api/overlays': 'admin', '/api/feedback': 'admin',
    '/api/feedback/summary': 'write', '/api/feedback/own': 'write', '/api/usage': 'admin', '/api/accounts': 'admin',
    '/api/admin/master-link': 'admin', '/api/icons': 'read', '/api/ids/:id': 'read',
    '/api/state': 'read', '/api/history': 'read', '/api/history/:id': 'read', '/api/roll-stats': 'read', '/api/display-world': 'read', '/api/health': 'read', '/api/art-status': 'read', '/api/dataset-status': 'read', '/api/dataset-runtime': 'read', '/api/dataset-input': 'read',
    '/api/changelog': 'read', '/api/roadmap': 'read', '/api/diagnostics': 'read', '/api/definitions': 'read',
    '/api/map-info': 'read', '/api/npcs-and-shops': 'read', '/api/archaeology-catalogue': 'read',
    '/api/chunk-sections': 'read', '/api/interior-maps': 'read', '/api/task-map': 'read',
    '/api/training-catalogue': 'read', '/api/house-storage-catalogue': 'read',
    '/api/helper-drops': 'read', '/api/helper-progress': 'read', '/api/xp-choices': 'read', '/api/backup-status': 'admin',
    '/api/teleports': 'write', '/api/skill-guide-catalogue': 'read', '/api/training-plan': 'write',
    '/api/task-why': 'read', '/api/tasks': 'saved-tasks', '/api/area-check': 'read', '/api/backlog-search': 'read', '/api/pool-ranking': 'read', '/api/predict': 'write', '/api/death-estimates': 'write', '/api/chunk-planning': 'write',
    '/api/migration': 'read', '/api/rules': 'read', '/api/backup': 'write', '/api/backups': 'write',
    '/api/backups/:id': 'write', '/api/members-start': 'write', '/api/events': 'read',
  }),
  POST: Object.freeze({
    '/api/plugin/v1/report': 'plugin', '/api/game-plugin/keys': 'write', '/api/game-plugin/keys/:id/revoke': 'write',
    '/api/game-plugin/apply': 'write', '/api/game-plugin/dismiss': 'write',
    '/api/action-session': 'write', '/api/sandbox/evaluate': 'write', '/api/prediction-intent': 'write', '/api/pool-ranking-intent': 'write', '/api/feedback': 'write', '/api/feedback/:id/status': 'admin',
    '/api/feedback/seen': 'write', '/api/usage': 'usage',
    '/api/invites': 'admin', '/api/invites/:id/player': 'admin', '/api/invites/:id/revoke': 'admin',
    '/api/accounts/:id/unlink': 'admin', '/api/accounts/:id/revoke-sessions': 'admin', '/api/accounts/:id/delete': 'admin',
    '/api/overlays': 'admin', '/api/overlays/:id/revoke': 'admin',
    '/api/operator/snapshot': 'admin', '/api/shutdown': 'admin', '/api/worker-restart': 'admin', '/api/runemetrics/preview': 'write', '/api/original-sync/preview': 'write',
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
  'set-runescape-name', 'apply-runemetrics', 'apply-game-progress', 'set-slayer-lock', 'set-sticker', 'add-sticker',
  'update-sticker', 'remove-sticker', 'clear-stickers', 'set-chunk-colour', 'rename-chunk-colour', 'set-starting-chunk', 'set-section',
  'set-source-backlog', 'set-boss-unlock', 'set-area', 'complete-task', 'set-obtained-equipment', 'roll', 'pick-for-me', 'unlock-selection',
  'cancel-roll', 'unlock-both', 'random-start', 'go-members', 'setup-start', 'unpick', 'undo', 'claim-task', 'clear-task-claim', TICK_ACTIVE_TASKS,
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
export function savedTaskSuffix(revision, memberId) {
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
export function redactInviteFields(value) {
  if (typeof value === 'string') return redactInviteTokens(value);
  if (Array.isArray(value)) return value.map(redactInviteFields);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactInviteTokens(key), redactInviteFields(item)]));
  return value;
}

export function actorOwnsEvent(actor, identity) {
  if (!actor) return false;
  if (actor.memberId && identity.memberId && actor.memberId === identity.memberId) return true;
  if (actor.kind === 'invite' && actor.inviteId) return ['invite', 'account'].includes(identity.kind) && actor.inviteId === identity.inviteId;
  if (actor.memberId) return false;
  if (actor.kind === 'master') return identity.kind === 'master';
  return Boolean(actor.label && actor.label === identity.label);
}

export const personalUndoReasons = new Map([['set-xp-choices', 'You can only undo XP choices for your signed-in player.'],
  [TICK_ACTIVE_TASKS, 'You can only undo your own ticked tasks.']]);
// Small committed History metadata only; never hydrate save/undo archives for a notice.
export function coordinationView(store, identity) {
  const records = store.getRecentHistory(Number.MAX_SAFE_INTEGER);
  const publicEvent = record => {
    if (!record) return null;
    const { hasUndo, ...event } = record;
    return event;
  };
  const latest = store.getUndoEligibility();
  const personalXpUndo = view => personalUndoReasons.has(view?.event?.type) && !identity.admin
    && (!identity.memberId || view.event.command?.memberId !== identity.memberId)
    ? { ...view, canUndo: false, reason: personalUndoReasons.get(view.event.type) } : view;
  const latestUndo = personalXpUndo({ ...latest, event: publicEvent(store.getHistoryEvent(latest.undoRevision)) });
  const own = records.findLast(event => event.hasUndo && event.type !== 'undo' && event.undoneRevision === undefined && actorOwnsEvent(event.actor, identity));
  const ownUndo = !own || own.revision === latest.undoRevision ? null : personalXpUndo({ ...store.getUndoEligibility(own.revision), event: publicEvent(own) });
  return { stateRevision: store.getInfo().revision, history: records.filter(event => event.actor && !actorOwnsEvent(event.actor, identity)).slice(-100).map(publicEvent), latestUndo, ownUndo };
}

export function routeIsRuneMetrics(request) { return (request.url ?? '').startsWith('/api/runemetrics/'); }
export async function json(request, response, status, value, headers = {}) {
  return jsonBytes(request, response, status, Buffer.from(JSON.stringify(value)), headers);
}
export function acceptsFastGzip(request) {
  try { return negotiateEncoding(`${request.headers['accept-encoding'] ?? ''}, br;q=0`) === 'gzip'; }
  catch (error) { if (error.status !== 406) throw error; return false; }
}
export async function jsonBytes(request, response, status, bytes, headers = {}) {
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
export async function commandJSON(request, response, saved) {
  const metadata = saved.unchangedFields?.length
    ? `,"baseRevision":${saved.baseRevision},"unchangedFields":${JSON.stringify(saved.unchangedFields)}` : '';
  const view = saved.format ? `,"format":${JSON.stringify(saved.format)},"schemaVersion":1` : '';
  const receipt = saved.receipt ? `,"receipt":${JSON.stringify(saved.receipt)}` : '';
  return jsonBytes(request, response, 200, Buffer.from(`{"state":${saved.stateJSON},"pools":${JSON.stringify(saved.pools)}${metadata}${view}${receipt}}`));
}
// The routing boundary parses an admitted owner backup before handle(). Retain
// the byte count so the handler's smaller route-specific limit still applies.
const routedBodies = new WeakMap();
export function routedBody(request) { return routedBodies.get(request); }
export function rememberRoutedBody(request, value, bytes) { routedBodies.set(request, { value, bytes }); }
export async function bodyJSON(request, maxBytes = MAX_BODY) {
  const routed = routedBodies.get(request);
  if (routed) {
    if (routed.bytes > maxBytes) throw httpError(413, 'Request body is too large.');
    return routed.value;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw httpError(415, 'Use application/json.');
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw httpError(413, 'Request body is too large.');
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBytes) throw httpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  const value = parseRequestJSON(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Request body must be a JSON object.');
  runBodyCheck(request, value);
  return value;
}
export async function cachedJSON(bytes) {
  return createRepresentation(bytes);
}
export function sendCached(request, response, cached) {
  return sendRepresentation(request, response, cached);
}
export async function containedFile(directory, relative) {
  const base = await realpath(directory);
  const file = await realpath(path.resolve(directory, relative));
  const inside = path.relative(base, file);
  if (!inside || inside.startsWith(`..${path.sep}`) || inside === '..' || path.isAbsolute(inside)) throw httpError(404, 'Not found.');
  return file;
}

export function migrationSummary(state) {
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

export function convertLegacyCapture(document, { members, capturedAt, registry } = {}) {
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
