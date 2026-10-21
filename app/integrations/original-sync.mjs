import { selectedDataset } from '../dataset-runtime.mjs';
import { decodeLegacyText } from '../tasks/migration.mjs';
import { collectionRules } from '../tasks/collection.mjs';
import { taskRuleDiagnostics, taskRuleCutoffDefaults, taskRuleValueError } from '../data/settings.mjs';
import { createOriginalTaskReview } from './original-tasks.mjs';

export const ORIGINAL_SYNC_GROUPS = Object.freeze(['chunks', 'selections', 'blacklist', 'pendingRoll', 'rules', 'tasks']);
const DEFAULT_MAP_IDS = Object.freeze((selectedDataset.gameDefaults?.members ?? []).flatMap(({ mapId }) => mapId ? [mapId] : []));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafe = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const decodeKey = key => decodeLegacyText(key.replaceAll('*fb*_', ''));
function shape(message) {
  return Object.assign(new Error(`The original picker returned unexpected data: ${message}. Nothing was applied.`),
    { status: 502, code: 'ORIGINAL_DATA_SHAPE' });
}
function record(value, path) { if (!object(value)) throw shape(`${path} must be an object`); }
function taskRecords(value, path, backlog = false) {
  if (value == null) return;
  record(value, path);
  for (const [category, tasks] of Object.entries(value)) {
    if (!category.trim() || unsafe(category)) throw shape(`${path} has an invalid category`);
    record(tasks, `${path}.${category}`);
    for (const [id, entry] of Object.entries(tasks)) {
      if (!id.trim() || unsafe(id) || typeof entry !== (backlog ? 'string' : 'boolean')) throw shape(`${path}.${category}.${id} must be ${backlog ? 'a backlog reason string' : 'a boolean task check'}`);
    }
  }
}
function decoded(value) {
  if (Array.isArray(value)) return value.map(decoded);
  if (!object(value)) return typeof value === 'string' ? decodeLegacyText(value) : value;
  const entries = Object.entries(value).map(([key, item]) => [decodeKey(key), decoded(item)])
    .filter(([key]) => !unsafe(key) && !/^(?:password|pin\d*|credentials?|authorization|cookie|accessToken|auth)$/i.test(key));
  return Object.fromEntries(entries);
}

function chunkIds(value, path, warnings, ordered = false) {
  if (value == null) return [];
  if (!Array.isArray(value)) record(value, path);
  let ids = Array.isArray(value) ? [...value] : Object.keys(value);
  // The original's setUpSelected uses numeric ranks, with descending IDs for
  // its older string-valued saves. chunkOrder is roll history, not this order.
  if (ordered && !Array.isArray(value)) ids.sort((a, b) =>
    typeof value[a] === 'string' && typeof value[b] === 'string' ? Number(decodeKey(b)) - Number(decodeKey(a)) : Number(value[a]) - Number(value[b]));
  const result = [];
  for (const raw of ids) {
    const id = typeof raw === 'string' ? decodeKey(raw) : raw;
    if (typeof id === 'string' && /^[1-9]\d*-\d+$/.test(id)) {
      warnings.push(`${path}: section ${id} is shown only in original records; sync mirrors base chunks.`); continue;
    }
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw shape(`${path} contains an invalid chunk ID`);
    if (ordered && object(value)) {
      const rank = value[raw];
      if (!(typeof rank === 'number' && Number.isSafeInteger(rank) && rank > 0) && !(typeof rank === 'string' && /^[1-9]\d*$/.test(rank))) throw shape(`${path} has an invalid selection rank`);
    }
    if (!ordered && object(value)) {
      const entry = value[raw];
      if (!(entry === true || typeof entry === 'string' && decodeKey(entry) === id || typeof entry === 'number' && String(entry) === id)) throw shape(`${path}.${id} has an invalid chunk-set value`);
    }
    if (result.includes(id)) throw shape(`${path} contains duplicate chunk IDs`);
    result.push(id);
  }
  return result;
}

export function normalizeOriginalMap(map, sourceMapId, warnings = []) {
  record(map, `map ${sourceMapId}`); record(map.chunks, `${sourceMapId}.chunks`);
  const unlocked = chunkIds(map.chunks.unlocked, `${sourceMapId}.unlocked`, warnings);
  const selected = chunkIds(map.chunks.selected, `${sourceMapId}.selected`, warnings, true);
  const pendingRoll = chunkIds(map.chunks.potential, `${sourceMapId}.potential`, warnings);
  const blacklisted = chunkIds(map.chunks.blacklisted, `${sourceMapId}.blacklisted`, warnings);
  if (pendingRoll.length > 2) throw shape(`${sourceMapId} has more than two pending Roll 2 choices`);
  const progression = [...unlocked, ...selected, ...pendingRoll];
  if (new Set(progression).size !== progression.length) throw shape(`${sourceMapId} has overlapping unlocked, selected or pending chunks`);
  if (pendingRoll.length === 1) warnings.push(`${sourceMapId.toUpperCase()} has one pending choice; review it before applying.`);
  const taskRules = decoded(map.rules ?? {}); record(taskRules, `${sourceMapId}.rules`);
  for (const [id, value] of Object.entries(taskRules)) {
    if (value !== null && !['boolean', 'string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw shape(`${sourceMapId}.rules.${id} must be a primitive`);
    const error = taskRuleValueError(id, value);
    if (error) throw shape(`${sourceMapId}.rules.${id}: ${error}`);
  }
  for (const [path, value] of [['chunkinfo', map.chunkinfo], ['chunkNotes', map.chunkNotes], ['stickeredNotes', map.chunks.stickeredNotes], ['userTasks', map.userTasks]]) {
    if (value != null) record(value, `${sourceMapId}.${path}`);
  }
  const info = map.chunkinfo ?? {};
  for (const field of ['checkedAllTasks', 'checkedChallenges', 'completedChallenges']) taskRecords(info[field], `${sourceMapId}.${field}`);
  taskRecords(info.backlog, `${sourceMapId}.backlog`, true);
  const observations = {
    notes: decoded({ ...(map.chunkNotes == null ? {} : { chunkNotes: map.chunkNotes }),
      ...(map.chunks.stickeredNotes == null ? {} : { stickeredNotes: map.chunks.stickeredNotes }),
      ...(info.backlog == null ? {} : { backlog: info.backlog }) }),
    taskChecks: decoded(Object.fromEntries(['checkedAllTasks', 'checkedChallenges', 'completedChallenges'].filter(key => info[key] != null).map(key => [key, info[key]]))),
    userTasks: decoded(map.userTasks ?? {}),
  };
  return { sourceMapId, unlocked, selected, pendingRoll, blacklisted, taskRules, observations };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const added = (before, after) => after.filter(id => !before.includes(id));
export function previewOriginalSync(state, document, captureWarnings = [], taskOptions = {}) {
  record(document, 'capture'); record(document.maps, 'capture.maps'); record(document.metadata, 'capture.metadata');
  const { capturedAt, hash: sourceHash } = document.metadata;
  if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt)) || typeof sourceHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(sourceHash)) throw shape('capture provenance is missing or invalid');
  const warnings = [...captureWarnings], targets = [], members = [], seen = new Set();
  const sources = state.members.filter(owner => DEFAULT_MAP_IDS.includes(owner.sourceMapId?.toLowerCase()))
    .map(owner => normalizeOriginalMap(document.maps[owner.sourceMapId.toLowerCase()], owner.sourceMapId.toLowerCase(), warnings));
  const taskReview = createOriginalTaskReview(state, sources, taskOptions);
  for (const owner of state.members) {
    const sourceMapId = owner.sourceMapId?.toLowerCase();
    if (!DEFAULT_MAP_IDS.includes(sourceMapId)) continue;
    if (seen.has(sourceMapId)) throw shape(`map ${sourceMapId} is assigned to more than one player`);
    seen.add(sourceMapId);
    const source = sources.find(source => source.sourceMapId === sourceMapId);
    const tasks = taskReview(owner, source);
    const keepLocal = owner.unlocked.filter(id => !source.unlocked.includes(id) && tasks.localChanges.chunks.has(id));
    const unlocked = [...source.unlocked, ...keepLocal];
    // A retained unlock cannot also become an original candidate or roll offer.
    const selected = source.selected.filter(id => !tasks.localChanges.chunks.has(id));
    const pendingRoll = source.pendingRoll.filter(id => !tasks.localChanges.chunks.has(id));
    const effective = collectionRules(state, owner.id);
    for (const { ruleId } of taskRuleDiagnostics(effective)) {
      if (Object.hasOwn(taskRuleCutoffDefaults, ruleId)) effective[ruleId] = taskRuleCutoffDefaults[ruleId];
      else delete effective[ruleId];
    }
    const rules = Object.entries(source.taskRules).filter(([id, value]) => !same(effective[id], value))
      .map(([id, after]) => ({ id, before: effective[id] ?? null, after, inherited: effective[id] === undefined,
        ...(id === 'F2P' ? { shared: true } : {}) }));
    members.push({ id: owner.id, name: owner.name, sourceMapId, lastSynced: owner.originalPickerSync?.appliedAt ?? null,
      originalF2P: source.taskRules.F2P ?? null, currentF2P: effective.F2P,
      chunks: { unlock: added(owner.unlocked, unlocked), lock: added(unlocked, owner.unlocked), keepLocal },
      selections: { add: added(owner.selected, selected), remove: added(selected, owner.selected),
        before: [...owner.selected], after: [...selected], orderChanged: !same(owner.selected, selected) },
      blacklist: { add: added(owner.blacklisted, source.blacklisted), remove: added(source.blacklisted, owner.blacklisted) },
      pendingRoll: { before: [...owner.pendingRoll], after: [...pendingRoll], changed: !same(owner.pendingRoll, pendingRoll) },
      rules, tasks: tasks.preview, observations: source.observations });
    targets.push({ memberId: owner.id, ...source, unlocked, selected, pendingRoll, tasks: tasks.target });
  }
  if (!members.length) throw Object.assign(new Error('No player is linked to a supported original map. Import the original maps first.'), { status: 422, code: 'ORIGINAL_MAP_BINDING' });
  if (new Set(members.map(member => member.originalF2P).filter(value => value !== null)).size > 1) warnings.push('The original maps have different F2P rules. F2P is shared in this app; apply one player’s Rules group at a time or make the originals agree first.');
  return { preview: { currentRevision: state.revision, capturedAt, warnings, members },
    capturedAt, sourceHash, targets };
}

/** Turn only reviewed group names into a trusted ordinary command. */
export function originalSyncCommand(review, selections) {
  if (!Array.isArray(selections) || !selections.length) throw new TypeError('Choose at least one original-picker sync group.');
  const seen = new Set();
  const members = selections.map(selection => {
    if (!object(selection) || Object.keys(selection).some(key => !['memberId', 'groups'].includes(key))) throw new TypeError('Sync selections accept only memberId and groups.');
    const target = review.targets.find(member => member.memberId === selection.memberId);
    if (!target || seen.has(selection.memberId)) throw new TypeError('Choose each reviewed player at most once.');
    seen.add(selection.memberId);
    if (!Array.isArray(selection.groups) || !selection.groups.length || new Set(selection.groups).size !== selection.groups.length || selection.groups.some(group => !ORIGINAL_SYNC_GROUPS.includes(group))) throw new TypeError('Choose valid, unique sync groups.');
    const fields = { chunks: 'unlocked', selections: 'selected', blacklist: 'blacklisted', pendingRoll: 'pendingRoll', rules: 'taskRules', tasks: 'tasks' };
    return { memberId: target.memberId, sourceMapId: target.sourceMapId, groups: [...selection.groups],
      ...Object.fromEntries(selection.groups.map(group => [fields[group], structuredClone(target[fields[group]])])) };
  });
  return { type: 'sync-original', capturedAt: review.capturedAt, sourceHash: review.sourceHash, members };
}

/** In-memory, short-lived capture cache. No request means no original reads. */
export function createOriginalSyncClient({ fetchImpl = globalThis.fetch, timeoutMs = 10000, retries = 1,
  cacheTtlMs = 30000, now = () => new Date() } = {}) {
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 60000) throw new TypeError('Original-picker cache must be between 0 and 60000ms.');
  let cached, pending, closed = false;
  return {
    async snapshot() {
      if (closed) throw Object.assign(new Error('The picker is stopping. Retry after it restarts.'), { status: 503 });
      if (!DEFAULT_MAP_IDS.length) throw Object.assign(new Error('This dataset has no linked original maps.'), { status: 422, code: 'ORIGINAL_MAP_BINDING' });
      if (cached && now().getTime() - Date.parse(cached.document.metadata.capturedAt) < cacheTtlMs) return { ...structuredClone(cached), cached: true };
      if (!pending) pending = import('../capture-maps.mjs').then(({ capturePublicMaps }) => capturePublicMaps({ fetchImpl, timeoutMs, retries, now })).then(result => {
        // Validate both sources before caching; failed captures never fall back.
        for (const id of DEFAULT_MAP_IDS) normalizeOriginalMap(result.document.maps[id], id);
        cached = result; return result;
      }).catch(error => {
        if (error.status) throw error;
        const timeout = /Timed out|abort/i.test(error.message);
        throw Object.assign(new Error(timeout ? 'The original picker took too long to respond. Try fetching a new preview.' : `Could not read the original picker. Check the connection and try again. ${error.message}`),
          { status: timeout ? 504 : 502, code: timeout ? 'ORIGINAL_TIMEOUT' : 'ORIGINAL_NETWORK', cause: error });
      }).finally(() => { pending = undefined; });
      return { ...structuredClone(await pending), cached: false };
    },
    close() { closed = true; cached = undefined; },
  };
}
