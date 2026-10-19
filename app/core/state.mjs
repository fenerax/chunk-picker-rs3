import { validateSavedXpChoices, validateXpChoices } from './xp-choices.mjs';
import { selectedDataset } from '../dataset-runtime.mjs';
import { createTaskFactsIndex } from './progress-index.mjs';
import { createRuleRegistry, evaluateRollPool, sampleRoll } from './rules.mjs';
import { validateProgressSnapshots } from './progress-snapshots.mjs';
import { preferenceDefinitions, validatePreference } from './preferences.mjs';
import { validateControlSkill, validateControlLevel, validateSlayerLock } from './player-controls.mjs';
import { defaultRuneScapeNames, validateRuneScapeName, sameRuneScapeName, validateRuneMetricsTimestamp,
  validateObservedSkill, validateSkillProgress, validateQuestProgress, validateRuneMetricsProvenance } from './game-progress.mjs';
import { applyChunkColourCommand, validateChunkColour, validateChunkColourName } from './chunk-colours.mjs';
import { validateSticker, validateStickerId, validateSavedStickers, normalizeStickerList, resolveMemberStickers, MAX_STICKERS_PER_CHUNK } from './map-markers.mjs';
import { validateTransportFacts } from './transport-access.mjs';
import { transportRouteById } from '../data/transport-routes.mjs';
import { taskRuleValueError, taskRuleDiagnostics } from '../data/settings.mjs';
import { decodeLegacyText, resolveSavedTaskId, migrateTaskIdentities } from '../tasks/migration.mjs';
import { isPermanentId, legacyTaskId, lookupPermanentId } from '../tasks/identity.mjs';
import { normalizeMembersStartOptions, membersStartPools, rollMembersStarts } from './members-start.mjs';
import { validateFinishLine, validateFinishLineItemId, validateFinishLineOverride, validateFinishLineText,
  validateFinishLineChange, restoreFinishLineChange, MAX_FINISH_LINE_CUSTOM_ITEMS, finishLineCommandTypes } from './finish-line.mjs';
import { groupGoalCommandKeys, groupGoalCommandTypes, applyGroupGoalCommand, validateGroupGoals,
  groupGoalChanges, validateGroupGoalChanges, restoreGroupGoalChanges } from './group-goals.mjs';
import { validateRuleReviewId, normalizeRuleReviewNote, validateRuleReviews, ruleReviewChange,
  validateRuleReviewChange, restoreRuleReviewChange } from './rule-reviews.mjs';
import { TICK_ACTIVE_TASKS, tickActiveTasksKeys, applyTickActiveTasks } from './tick-active-tasks.mjs';
export { MAX_RULE_REVIEW_NOTE_LENGTH } from './rule-reviews.mjs';
export { preferenceDefinitions, validatePreference } from './preferences.mjs';

export const SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'rs3-chunk-picker';
export const MAX_JOURNAL_LENGTH = 10_000;

const BASE_CHUNK = /^[1-9]\d*$/;
const GAMEPLAY_KEYS = new Set(['rules', 'chunkOrder', 'settings', 'chunkinfo', 'chunks',
  'activeSubTabs', 'topbarSelection', 'manualPrimary', 'recentFancyRollTime',
  'recent', 'recentTime', 'randomLoot', 'chunkNotes', 'userTasks', 'friends', 'friendsAlt']);
const STATE_KEYS = new Set(['schemaVersion', 'revision', 'rules', 'members', 'tasks', 'history', 'legacy', 'provenance', 'identityRegistry', 'taskClaims', 'progressSnapshots', 'finishLine', 'groupGoals', 'ruleReviews']);
export const MEMBER_KEYS = new Set(['id', 'name', 'sourceMapId', 'unlocked', 'selected', 'pendingRoll', 'blacklisted', 'completedTasks', 'obtainedEquipment', 'teleports', 'teleportOverrides', 'notes', 'journal', 'taskStatus', 'taskRules', 'sectionOverrides', 'sourceBacklogs', 'areaOverrides', 'preferences', 'primaryOverrides', 'passiveLevels', 'maxLevels', 'slayerLock', 'stickers', 'chunkColours', 'chunkColourNames', 'taskAlternatives', 'runescapeName', 'skillProgress', 'questProgress', 'runeMetricsSync', 'originalPickerSync', 'transportFacts', 'f2pMap', 'xpChoices']);
const SOURCE_KINDS = new Set(['objects', 'npcs', 'monsters', 'shops', 'spawns', 'items']);
const MEMBER_ARRAY_FIELDS = new Set(['unlocked', 'selected', 'pendingRoll', 'blacklisted', 'completedTasks', 'obtainedEquipment', 'teleports']);
const MEMBER_PROGRESSION_FIELDS = new Set(['unlocked', 'selected', 'pendingRoll']);
const MEMBER_DICTIONARY_FIELDS = new Set(['notes', 'taskStatus', 'taskRules', 'sectionOverrides', 'sourceBacklogs', 'areaOverrides', 'preferences', 'primaryOverrides', 'passiveLevels', 'maxLevels', 'stickers', 'chunkColours', 'chunkColourNames', 'taskAlternatives', 'skillProgress', 'questProgress', 'teleportOverrides', 'xpChoices']);
const MEMBER_NESTED_DICTIONARY_FIELDS = new Set(['sourceBacklogs', 'taskAlternatives']);
const MEMBER_VALUE_FIELDS = new Set(['journal', 'slayerLock', 'runescapeName', 'runeMetricsSync', 'originalPickerSync', 'transportFacts', 'f2pMap']);
const ORIGINAL_SYNC_FIELDS = new Map([['chunks', 'unlocked'], ['selections', 'selected'], ['blacklist', 'blacklisted'], ['pendingRoll', 'pendingRoll'], ['rules', 'taskRules'], ['tasks', 'tasks']]);
const UNSAFE_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor']);
const COMMAND_KEYS = new Map([
  ...groupGoalCommandKeys,
  ['set-finish-line-item', new Set(['type', 'itemId', 'enabled', 'target'])],
  ['add-finish-line-custom', new Set(['type', 'itemId', 'text'])],
  ['set-finish-line-custom', new Set(['type', 'itemId', 'memberId', 'completed'])],
  ['delete-finish-line-custom', new Set(['type', 'itemId'])],
  ['set-xp-choices', new Set(['type', 'memberId', 'taskId', 'choices'])],
  ['set-rule', new Set(['type', 'ruleId', 'value'])],
  ['set-rule-review', new Set(['type', 'ruleId', 'reviewed', 'note'])],
  ['set-profile', new Set(['type', 'memberId', 'rules', 'taskRules'])],
  ['set-teleport', new Set(['type', 'memberId', 'teleport'])],
  ['set-teleport-override', new Set(['type', 'memberId', 'routeId', 'value'])],
  ['set-transport-facts', new Set(['type', 'memberId', 'facts'])],
  ['claim-task', new Set(['type', 'memberId', 'taskId', 'takeover'])],
  ['clear-task-claim', new Set(['type', 'memberId', 'taskId'])],
  ['prune-task-claims', new Set(['type', 'taskIds'])],
  ['complete-task', new Set(['type', 'memberId', 'taskId', 'completed'])],
  ['set-obtained-equipment', new Set(['type', 'memberId', 'equipmentName', 'obtained'])],
  ['roll', new Set(['type', 'memberId', 'count'])],
  ['unlock-selection', new Set(['type', 'memberId', 'chunkId'])],
  ['pick-for-me', new Set(['type', 'memberId'])],
  ['set-chunk', new Set(['type', 'memberId', 'chunkId', 'status'])],
  ['cancel-roll', new Set(['type', 'memberId'])],
  ['unlock-both', new Set(['type', 'memberId'])],
  ['random-start', new Set(['type', 'memberId', 'count'])],
  ['go-members', new Set(['type', 'options'])],
  ['unpick', new Set(['type', 'memberId'])],
  ['set-note', new Set(['type', 'memberId', 'chunkId', 'note'])],
  ['set-journal', new Set(['type', 'memberId', 'note'])],
  ['add-task', new Set(['type', 'task'])],
  ['update-task', new Set(['type', 'taskId', 'task'])],
  ['delete-task', new Set(['type', 'taskId'])],
  ['set-task-status', new Set(['type', 'memberId', 'taskId', 'backlogged', 'backlogReason', 'favorite', 'note', 'challengeCompleted'])],
  ['clear-backlog', new Set(['type', 'memberId', 'taskIds'])],
  ['clear-challenge-ticks', new Set(['type', 'memberId', 'taskIds', 'reason'])],
  [TICK_ACTIVE_TASKS, tickActiveTasksKeys],
  ['set-task-rule', new Set(['type', 'memberId', 'ruleId', 'value'])],
  ['reset-task-rule', new Set(['type', 'memberId', 'ruleId'])],
  ['set-task-alternative', new Set(['type', 'memberId', 'category', 'group', 'taskId'])],
  ['set-preference', new Set(['type', 'memberId', 'preferenceId', 'value'])],
  ['set-primary-override', new Set(['type', 'memberId', 'skill', 'enabled'])],
  ['set-skill-levels', new Set(['type', 'memberId', 'skill', 'passiveLevel', 'maxLevel'])],
  ['set-runescape-name', new Set(['type', 'memberId', 'name'])],
  ['replace-member', new Set(['type', 'memberId', 'member', 'source'])],
  ['apply-runemetrics', new Set(['type', 'memberId', 'runescapeName', 'fetchedAt', 'skills', 'quests'])],
  ['sync-original', new Set(['type', 'capturedAt', 'sourceHash', 'members'])],
  ['set-slayer-lock', new Set(['type', 'memberId', 'lock'])],
  ['set-chunk-colour', new Set(['type', 'memberId', 'chunkId', 'colour'])],
  ['rename-chunk-colour', new Set(['type', 'memberId', 'colour', 'name'])],
  ['set-sticker', new Set(['type', 'memberId', 'chunkId', 'sticker'])],
  ['add-sticker', new Set(['type', 'memberId', 'chunkId', 'sticker'])],
  ['update-sticker', new Set(['type', 'memberId', 'chunkId', 'stickerId', 'sticker'])],
  ['remove-sticker', new Set(['type', 'memberId', 'chunkId', 'stickerId'])],
  ['clear-stickers', new Set(['type', 'memberId', 'chunkId'])],
  ['set-starting-chunk', new Set(['type', 'memberId', 'chunkId'])],
  ['set-section', new Set(['type', 'memberId', 'sectionId', 'accessible'])],
  ['set-source-backlog', new Set(['type', 'memberId', 'kind', 'name', 'backlogged'])],
  ['set-area', new Set(['type', 'memberId', 'areaId', 'accessible'])],
  ['delete-teleport', new Set(['type', 'memberId', 'teleportId'])],
  ['undo', new Set(['type', 'undoRevision'])],
]);

function fail(message) { throw new TypeError(message); }
function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}
function string(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a nonempty string`);
}
function chunk(value, path) {
  if (typeof value !== 'string' || !BASE_CHUNK.test(value) || !Number.isSafeInteger(Number(value))) fail(`${path} must be a positive safe integer base chunk ID string`);
}
function text(value, path) { if (typeof value !== 'string') fail(`${path} must be a string`); }
function journalText(value, path) {
  text(value, path);
  if (value.length > MAX_JOURNAL_LENGTH) fail(`${path} must be at most ${MAX_JOURNAL_LENGTH} characters`);
}
function section(value, path) {
  if (typeof value !== 'string' || !/^[1-9]\d*-(?:0|[1-9]\d*)$/.test(value)) fail(`${path} must be a base-section ID`);
  const [base, suffix] = value.split('-');
  chunk(base, path);
  if (!Number.isSafeInteger(Number(suffix))) fail(`${path} suffix must be a safe integer`);
}
function primitive(value, path) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) fail(`${path} must be a JSON primitive`);
}
function validateTaskRule(id, value) {
  primitive(value, `task rule ${id}`);
  const error = taskRuleValueError(id, value);
  if (error) fail(error);
}
function savedTaskRuleDiagnostics(state) {
  return [...state.members.flatMap(member => taskRuleDiagnostics(member.taskRules, { memberId: member.id })),
    ...Object.entries(state.legacy?.maps ?? {}).flatMap(([sourceMapId, map]) => taskRuleDiagnostics(Object.fromEntries(Object.entries(map?.rules ?? {}).map(([id, value]) => [decodeLegacyText(id), value])), { sourceMapId }))];
}
function dictionary(value, path, check) {
  record(value, path);
  for (const [key, item] of Object.entries(value)) { propertyKey(key, `${path} key`); check(item, key); }
}
function propertyKey(value, path) {
  string(value, path);
  if (UNSAFE_PROPERTIES.has(value)) fail(`${path} contains an unsafe property name`);
}
function uniqueStrings(value, path, check = string) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  value.forEach((item, index) => check(item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) fail(`${path} contains duplicate IDs`);
}
function uniqueRecords(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  value.forEach((item, index) => { record(item, `${path}[${index}]`); string(item.id, `${path}[${index}].id`); });
  if (new Set(value.map(item => item.id)).size !== value.length) fail(`${path} contains duplicate IDs`);
}
function knownKeys(value, keys, path) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`Unknown ${path} field: ${key}`);
}

/** Attribution is supplied by an authenticated caller, separately from commands.
 * Keep only the durable identity snapshot; credentials never belong in History. */
export function validateHistoryActor(actor) {
  record(actor, 'history actor');
  const prototype = Object.getPrototypeOf(actor);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(actor).length) fail('History actor must be a plain JSON object');
  if (!['invite', 'master'].includes(actor.kind)) fail('History actor kind must be invite or master');
  knownKeys(actor, new Set(actor.kind === 'invite' ? ['kind', 'label', 'inviteId', 'memberId'] : ['kind', 'label']), 'history actor');
  if (typeof actor.label !== 'string' || !actor.label.length || actor.label.length > 80 || actor.label !== actor.label.trim()
    || /[\u0000-\u001f\u007f-\u009f]/.test(actor.label)) fail('History actor label must be trimmed printable text of 1 to 80 characters');
  if (actor.kind === 'invite' && (typeof actor.inviteId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(actor.inviteId))) fail('History actor inviteId must be a safe identifier of 1 to 128 characters');
  if (actor.memberId !== undefined && (typeof actor.memberId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(actor.memberId))) fail('History actor memberId must be a safe identifier of 1 to 64 characters');
  return { kind: actor.kind, label: actor.label, ...(actor.kind === 'invite' ? { inviteId: actor.inviteId } : {}),
    ...(actor.memberId !== undefined ? { memberId: actor.memberId } : {}) };
}
function originalSyncTimestamp(value, path) {
  try { validateRuneMetricsTimestamp(value); }
  catch { fail(`${path} must be a valid ISO UTC timestamp`); }
}
function originalSyncSource(value) {
  const mapIds = (selectedDataset.gameDefaults?.members ?? []).flatMap(({ mapId }) => mapId ? [mapId] : []);
  if (typeof value !== 'string' || !mapIds.includes(value.toLowerCase())) fail(mapIds.length ? `Original sync sourceMapId must be ${mapIds.join(' or ')}` : 'Original sync is unavailable in this game');
  return value.toLowerCase();
}
function originalSyncHash(value) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('Original sync sourceHash must be a lowercase sha256 hash');
}
function originalSyncGroups(value) {
  uniqueStrings(value, 'Original sync groups');
  if (!value.length) fail('Original sync needs at least one selected group');
  for (const group of value) if (!ORIGINAL_SYNC_FIELDS.has(group)) fail(`Unknown Original sync group: ${group}`);
}
function validateOriginalPickerSync(value) {
  record(value, 'Original picker sync provenance');
  knownKeys(value, new Set(['sourceMapId', 'capturedAt', 'appliedAt', 'sourceHash', 'groups']), 'Original picker sync provenance');
  originalSyncSource(value.sourceMapId);
  originalSyncTimestamp(value.capturedAt, 'Original sync capturedAt');
  originalSyncTimestamp(value.appliedAt, 'Original sync appliedAt');
  originalSyncHash(value.sourceHash);
  originalSyncGroups(value.groups);
}
function validateF2PMap(value) {
  record(value, 'F2P map snapshot');
  knownKeys(value, new Set(['unlocked', 'at']), 'F2P map snapshot');
  uniqueStrings(value.unlocked, 'F2P map unlocked', chunk);
  originalSyncTimestamp(value.at, 'F2P map timestamp');
}
function validateTask(task, memberIds) {
  record(task, 'task');
  knownKeys(task, new Set(['id', 'label', 'category', 'completionIds', 'skill', 'level', 'memberIds']), 'task');
  string(task.id, 'task.id');
  string(task.label, `task ${task.id}.label`); string(task.category, `task ${task.id}.category`);
  if (task.completionIds !== undefined) uniqueStrings(task.completionIds, `task ${task.id}.completionIds`, propertyKey);
  if (task.skill !== undefined) {
    validateControlSkill(task.skill);
    if (task.category !== task.skill) fail('Task category must match its skill');
  }
  if (task.level !== undefined) {
    if (task.skill === undefined) fail('Task level requires a skill');
    validateControlLevel(task.level);
  }
  if (task.memberIds !== undefined) {
    uniqueStrings(task.memberIds, `task ${task.id}.memberIds`, propertyKey);
    if (!task.memberIds.length) fail('Task assignment needs at least one member');
    if (memberIds) for (const id of task.memberIds) if (!memberIds.has(id)) fail(`Task assignment references absent member: ${id}`);
  }
}

function customTask(state, id) {
  string(id, 'taskId');
  if (!id.startsWith('custom:') && !id.startsWith('rs3:task:custom:')) fail('Only custom tasks can be edited or deleted');
  const task = indexedTaskRows(state.tasks).get(id);
  if (!task) fail(`Unknown custom task: ${id}`);
  return task;
}

function clearCustomTaskAlternatives(state, id) {
  for (const member of state.members) if (member.taskAlternatives) {
    for (const [category, groups] of Object.entries(member.taskAlternatives)) {
      let changed = false;
      for (const [group, selected] of Object.entries(groups)) if (selected === id) { delete groups[group]; changed = true; }
      if (changed && !Object.keys(groups).length) delete member.taskAlternatives[category];
    }
  }
}

function claimTaskRow(state, id) {
  id = resolveSavedTaskId(state.identityRegistry, id);
  const saved = indexedTaskRows(state.tasks).get(id);
  if (!saved && (id.startsWith('custom:') || id.startsWith('rs3:task:custom:'))) return null;
  const row = saved ?? state.identityRegistry?.entries?.[id] ?? lookupPermanentId(id);
  return row?.label && row?.category ? { id: resolveSavedTaskId(state.identityRegistry, row.id ?? id, row.category), label: row.label, category: row.category,
    ...(row.completionIds ? { completionIds: row.completionIds } : {}) } : null;
}

// Background removal only cancels claim leaves. It never assigns those leaves
// to a previous gameplay command, and it preserves every unrelated inverse.
export function cancelTaskClaimUndo(state, taskIds, throughRevision = Infinity) {
  const inactive = new Set(taskIds);
  state.history = state.history.map(event => {
    if (!event.undo?.taskClaimChanges || event.type === 'undo' || event.undoneRevision !== undefined || event.revision > throughRevision) return event;
    const retained = event.undo.taskClaimChanges.changes.filter(change => !inactive.has(change.id));
    if (retained.length === event.undo.taskClaimChanges.changes.length) return event;
    const undo = { ...event.undo }, updated = { ...event };
    if (retained.length) undo.taskClaimChanges = { ...event.undo.taskClaimChanges, changes: retained };
    else delete undo.taskClaimChanges;
    if (Object.keys(undo).length) updated.undo = undo;
    else delete updated.undo;
    return updated;
  });
}

function canonicalizeTaskClaimAliases(state) {
  if (state.taskClaims !== undefined) {
    record(state.taskClaims, 'taskClaims');
    const claims = {};
    for (const [id, value] of Object.entries(state.taskClaims)) {
      propertyKey(id, 'task claim ID');
      const canonical = resolveSavedTaskId(state.identityRegistry, id);
      propertyKey(canonical, 'task claim ID');
      if (Object.hasOwn(claims, canonical) && JSON.stringify(claims[canonical]) !== JSON.stringify(value)) fail('Conflicting claims resolve to the same task');
      claims[canonical] = value;
    }
    state.taskClaims = claims;
  }
  for (const event of state.history ?? []) for (const change of event.undo?.taskClaimChanges?.changes ?? []) {
    propertyKey(change.id, 'undo task claim ID');
    change.id = resolveSavedTaskId(state.identityRegistry, change.id);
  }
}
const savedCompletionFamilies = new WeakMap();
function indexedCompletionFamilies(tasks) {
  let families = savedCompletionFamilies.get(tasks);
  if (!families) {
    families = new Map();
    for (const task of tasks) if (task.completionIds) for (const id of [task.id, ...task.completionIds]) families.set(id, task.completionIds);
    savedCompletionFamilies.set(tasks, families);
  }
  return families;
}
function completionClaimFacts(state, memberId, registry, catalogue, extraIds = []) {
  const savedFamilies = indexedCompletionFamilies(state.tasks);
  const rows = new Map([...new Set([...Object.keys(state.taskClaims ?? {}), ...extraIds])].map(id => {
    const saved = claimTaskRow(state, id);
    const trusted = catalogue instanceof Map ? catalogue.get(id) : catalogue?.find(task => task.id === id);
    const completionIds = trusted?.completionIds ?? saved?.completionIds ?? savedFamilies.get(id);
    return [id, completionIds ? { ...saved, completionIds } : saved];
  }).filter(([, row]) => row));
  const facts = createTaskFactsIndex(state, memberId, registryOrDefault(registry), { tasks: [...rows.values()] });
  return { get: id => facts.get(id, rows.get(id)?.completionIds),
    family: id => [id, ...(rows.get(id)?.completionIds ?? [])].map(value => resolveSavedTaskId(state.identityRegistry, value)) };
}
function validateTaskClaim(value, tasks, members, id) {
  propertyKey(id, 'task claim ID');
  if (!tasks.has(id)) fail(`Task claim references absent task: ${id}`);
  record(value, 'task claim'); knownKeys(value, new Set(['memberId', 'at']), 'task claim');
  if (!members.has(value.memberId)) fail('Task claim references absent member');
  originalSyncTimestamp(value.at, 'Task claim timestamp');
}
function validateTaskClaimChanges(value, tasks, members) {
  record(value, 'undo task claim changes');
  knownKeys(value, new Set(['beforeExists', 'afterExists', 'changes']), 'undo task claim changes');
  if (typeof value.beforeExists !== 'boolean' || typeof value.afterExists !== 'boolean') fail('Undo task claim container flags must be boolean');
  uniqueRecords(value.changes, 'undo task claim changes');
  if (!value.changes.length) fail('Undo task claim changes must be nonempty');
  for (const change of value.changes) {
    propertyKey(change.id, 'undo task claim ID');
    knownKeys(change, new Set(['id', 'before', 'after']), 'undo task claim change');
    for (const side of ['before', 'after']) {
      validatePresence(change[side], 'undo task claim presence', 'value');
      if (change[side].exists) {
        if (!value[`${side}Exists`]) fail('Undo task claim exists inside absent container');
        validateTaskClaim(change[side].value, tasks, members, change.id);
      }
    }
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) fail('Undo task claim patch must describe a change');
  }
}
function restoreTaskClaimChanges(state, delta) {
  for (const change of delta.changes) {
    const current = pathValue(state.taskClaims ?? {}, [change.id]);
    if (JSON.stringify(current) !== JSON.stringify(change.after)) fail('Stale undo: task claim has changed');
  }
  const claims = { ...(state.taskClaims ?? {}) };
  for (const change of delta.changes) writePath(claims, [change.id], change.before);
  if (!delta.beforeExists && !Object.keys(claims).length) delete state.taskClaims;
  else state.taskClaims = claims;
}

function validateIdentityRegistry(value) {
  record(value, 'identityRegistry');
  knownKeys(value, new Set(['schemaVersion', 'entries', 'aliases', 'unresolved']), 'identityRegistry');
  if (value.schemaVersion !== 1) fail('Unsupported identityRegistry schema version');
  dictionary(value.entries, 'identityRegistry.entries', (entry, id) => {
    record(entry, `identityRegistry entry ${id}`);
    if (!isPermanentId(id)) fail(`Identity registry entry needs a permanent ID: ${id}`);
    string(entry.label, `identityRegistry entry ${id}.label`);
    string(entry.kind, `identityRegistry entry ${id}.kind`);
    if (entry.id !== undefined && entry.id !== id) fail('Identity registry row ID does not match its key');
    if (entry.category !== undefined) string(entry.category, `identityRegistry entry ${id}.category`);
    if (entry.aliases !== undefined) uniqueStrings(entry.aliases, `identityRegistry entry ${id}.aliases`);
  });
  dictionary(value.aliases, 'identityRegistry.aliases', (targets, alias) => {
    if (Array.isArray(targets)) uniqueStrings(targets, `identityRegistry alias ${alias}`);
    else string(targets, `identityRegistry alias ${alias}`);
  });
  if (!Array.isArray(value.unresolved)) fail('identityRegistry.unresolved must be an array');
}

function validateTaskAlternative(category, group, value, tasks) {
  propertyKey(category, 'alternative category'); propertyKey(group, 'alternative group');
  if (value === null) return;
  string(value, 'alternative task ID');
  if (!tasks.has(value)) fail(`Task alternative references absent task: ${value}`);
  if (typeof tasks.get === 'function' && tasks.get(value).category !== category) fail('Alternative task category does not match the selected category');
}
function alternativeTaskIds(member) {
  return [...Object.values(member.taskAlternatives ?? {}).flatMap(groups => Object.values(groups ?? {}).filter(value => value !== null)), ...Object.keys(member.xpChoices ?? {})];
}

// Sparse undo uses typed, literal path segments, never dotted paths or executable
// setters. Container patches preserve absent optional dictionaries distinctly
// from empty ones. Leaf patches retain both sides so undo can reject stale data.
function validatePresence(side, path, kind) {
  record(side, path);
  if (typeof side.exists !== 'boolean') fail(`${path}.exists must be boolean`);
  knownKeys(side, new Set(kind === 'object' || !side.exists ? ['exists'] : ['exists', 'value']), path);
  if (kind === 'value' && side.exists && !Object.hasOwn(side, 'value')) fail(`${path} needs a value`);
}

function validatePatchValue(path, value, tasks) {
  const [field, key, name] = path;
  if (field === 'journal') { journalText(value, 'undo journal'); return; }
  if (field === 'slayerLock') { validateSlayerLock(value); return; }
  if (field === 'transportFacts') { validateTransportFacts(value); return; }
  if (field === 'runescapeName') { if (validateRuneScapeName(value) !== value) fail('Undo RuneScape name must be trimmed'); return; }
  if (field === 'runeMetricsSync') { validateRuneMetricsProvenance(value); return; }
  if (field === 'originalPickerSync') { validateOriginalPickerSync(value); return; }
  if (field === 'f2pMap') { validateF2PMap(value); return; }
  if (field === 'skillProgress') { validateSkillProgress(key, value); return; }
  if (field === 'xpChoices') { if (!tasks.has(key)) fail('XP choices reference absent task'); validateSavedXpChoices(value); return; }
  if (field === 'questProgress') { validateQuestProgress(key, value, tasks); return; }
  if (MEMBER_ARRAY_FIELDS.has(field)) {
    if (field === 'teleports') {
      uniqueRecords(value, 'undo teleports');
      for (const teleport of value) {
        knownKeys(teleport, new Set(['id', 'label', 'destination', 'available', 'consumable']), 'undo teleport');
        string(teleport.label, 'undo teleport label'); chunk(teleport.destination, 'undo teleport destination');
        if (typeof teleport.available !== 'boolean' || typeof teleport.consumable !== 'boolean') fail('Undo teleport flags must be boolean');
      }
    } else {
      uniqueStrings(value, `undo ${field}`, ['completedTasks', 'obtainedEquipment'].includes(field) ? string : chunk);
      if (field === 'pendingRoll' && value.length > 2) fail('Undo has more than two pending choices');
      if (field === 'completedTasks') for (const id of value) if (!tasks.has(id)) fail(`History undo references absent task: ${id}`);
    }
    return;
  }
  if (field === 'notes') { chunk(key, 'undo note chunk'); text(value, 'undo note'); }
  else if (field === 'taskRules') primitive(value, 'undo task rule');
  else if (field === 'preferences') validatePreference(key, value);
  else if (field === 'chunkColours') { chunk(key, 'undo colour chunk'); validateChunkColour(value); }
  else if (field === 'chunkColourNames') { validateChunkColour(key, { allowClear: false }); validateChunkColourName(value); }
  else if (field === 'stickers') { chunk(key, 'undo sticker chunk'); validateSavedStickers(value); }
  else if (field === 'passiveLevels' || field === 'maxLevels') { validateControlSkill(key); validateControlLevel(value); }
  else if (field === 'primaryOverrides') { validateControlSkill(key); if (typeof value !== 'boolean') fail('Primary override must be boolean'); }
  else if (field === 'taskAlternatives') validateTaskAlternative(key, name, value, tasks);
  else if (field === 'taskStatus') {
    if (!tasks.has(key)) fail(`History undo references absent task: ${key}`);
    record(value, 'undo task status');
    knownKeys(value, new Set(['backlogged', 'backlogReason', 'favorite', 'note', 'challengeCompleted']), 'undo task status');
    if (!Object.keys(value).length) fail('Undo task status needs at least one field');
    for (const flag of ['backlogged', 'favorite', 'challengeCompleted']) if (Object.hasOwn(value, flag) && typeof value[flag] !== 'boolean') fail(`Undo task status ${flag} must be boolean`);
    if (Object.hasOwn(value, 'note')) text(value.note, 'undo task note');
    if (Object.hasOwn(value, 'backlogReason')) text(value.backlogReason, 'undo backlog reason');
  } else {
    if (field === 'sectionOverrides') section(key, 'undo section');
    if (field === 'sourceBacklogs') { if (!SOURCE_KINDS.has(key)) fail('Unknown undo source kind'); propertyKey(name, 'undo source name'); }
    if (typeof value !== 'boolean') fail(`Undo ${field} must be boolean`);
  }
}

function validateMemberChanges(change, tasks, members, afterTasks = tasks) {
  record(change, 'undo member change'); knownKeys(change, new Set(['id', 'changes']), 'undo member change');
  string(change.id, 'undo member ID');
  if (!members.has(change.id)) fail('History undo references absent member');
  if (!Array.isArray(change.changes) || !change.changes.length) fail('Undo member changes must be a nonempty array');
  const paths = new Map();
  for (const patch of change.changes) {
    record(patch, 'undo patch'); knownKeys(patch, new Set(['path', 'kind', 'before', 'after']), 'undo patch');
    if (!Array.isArray(patch.path) || !patch.path.length) fail('Undo patch needs a path');
    patch.path.forEach(segment => propertyKey(segment, 'undo path segment'));
    const [field, key] = patch.path;
    const array = MEMBER_ARRAY_FIELDS.has(field), dictionary = MEMBER_DICTIONARY_FIELDS.has(field);
    const nested = MEMBER_NESTED_DICTIONARY_FIELDS.has(field), depth = nested ? 3 : 2;
    if (patch.kind === 'object') {
      if (!dictionary || !(patch.path.length === 1 || (nested && patch.path.length === 2 && (field !== 'sourceBacklogs' || SOURCE_KINDS.has(key))))) fail('Invalid undo container path');
    } else if (patch.kind === 'value') {
      if (!((array || MEMBER_VALUE_FIELDS.has(field)) && patch.path.length === 1) && !(dictionary && patch.path.length === depth)) fail('Invalid undo value path');
      if (field === 'sourceBacklogs' && !SOURCE_KINDS.has(key)) fail('Unknown undo source kind');
      if (field === 'notes') chunk(key, 'undo note chunk');
      if (field === 'sectionOverrides') section(key, 'undo section');
      if ((field === 'taskStatus' || field === 'questProgress') && !tasks.has(key)) fail(`History undo references absent task: ${key}`);
      if (field === 'preferences' && !preferenceDefinitions.some(definition => definition.id === key)) fail(`Unknown undo preference: ${key}`);
      if (field === 'stickers') chunk(key, 'undo sticker chunk');
      if (field === 'chunkColours') chunk(key, 'undo colour chunk');
      if (field === 'chunkColourNames') validateChunkColour(key, { allowClear: false });
      if (['primaryOverrides', 'passiveLevels', 'maxLevels'].includes(field)) validateControlSkill(key);
    } else fail('Unknown undo patch kind');
    validatePresence(patch.before, 'undo before', patch.kind); validatePresence(patch.after, 'undo after', patch.kind);
    if (array && (!patch.before.exists || !patch.after.exists)) fail('Required undo member fields cannot be absent');
    if (JSON.stringify(patch.before) === JSON.stringify(patch.after)) fail('Undo patch must describe a change');
    if (patch.kind === 'value') for (const name of ['before', 'after']) {
      const side = patch[name];
      if (side.exists) validatePatchValue(patch.path, side.value, name === 'before' ? tasks : afterTasks);
    }
    const encoded = JSON.stringify(patch.path);
    if (paths.has(encoded)) fail('Duplicate undo path');
    paths.set(encoded, patch);
  }
  for (const patch of change.changes) for (let length = 1; length < patch.path.length; length++) {
    const parent = paths.get(JSON.stringify(patch.path.slice(0, length)));
    if (parent) for (const side of ['before', 'after']) if (!parent[side].exists && patch[side].exists) fail('Undo path exists inside an absent container');
  }
}

function validateTaskChanges(changes, memberIds) {
  uniqueRecords(changes, 'undo task changes');
  if (!changes.length) fail('Undo task changes must be nonempty');
  const indices = { before: new Set(), after: new Set() };
  for (const change of changes) {
    knownKeys(change, new Set(['id', 'before', 'after']), 'undo task change');
    for (const name of ['before', 'after']) {
      const side = change[name];
      record(side, 'undo task presence');
      if (typeof side.exists !== 'boolean') fail('Undo task exists must be boolean');
      knownKeys(side, new Set(side.exists ? ['exists', 'value', 'index'] : ['exists']), 'undo task presence');
      if (side.exists) {
        validateTask(side.value, memberIds);
        if (side.value.id !== change.id) fail('Undo task ID does not match its row');
        if (!Number.isSafeInteger(side.index) || side.index < 0) fail('Undo task index is invalid');
        if (indices[name].has(side.index)) fail('Duplicate undo task index');
        indices[name].add(side.index);
      }
    }
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) fail('Undo task patch must describe a change');
  }
}

function pathValue(object, path) {
  let value = object;
  for (const segment of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { exists: false };
    value = value[segment];
  }
  return { exists: true, value };
}
function pathParent(object, path) {
  let parent = object;
  for (const segment of path.slice(0, -1)) {
    if (!Object.hasOwn(parent, segment)) fail('Stale undo: missing parent container');
    parent = parent[segment]; record(parent, 'undo parent container');
  }
  return parent;
}
function writePath(object, path, side) {
  const parent = pathParent(object, path), key = path.at(-1);
  if (!side.exists) delete parent[key];
  else Object.defineProperty(parent, key, { value: side.value, configurable: true, enumerable: true, writable: true });
}
function restoreMemberChanges(member, changes) {
  // Preflight every changed value before restoring any of them.
  for (const patch of changes) {
    const current = pathValue(member, patch.path);
    if (current.exists !== patch.after.exists || (current.exists && (patch.kind === 'object'
      ? current.value === null || typeof current.value !== 'object' || Array.isArray(current.value)
      : JSON.stringify(current.value) !== JSON.stringify(patch.after.value)))) fail('Stale undo: member value has changed');
  }
  const containers = changes.filter(patch => patch.kind === 'object').sort((a, b) => a.path.length - b.path.length);
  for (const patch of containers) if (patch.before.exists) writePath(member, patch.path, { exists: true, value: {} });
  for (const patch of changes) if (patch.kind === 'value') {
    // An absent leaf beneath an absent optional container needs no deletion.
    if (!patch.before.exists && !pathValue(member, patch.path.slice(0, -1)).exists) continue;
    writePath(member, patch.path, patch.before);
  }
  for (const patch of containers.reverse()) if (!patch.before.exists) {
    if (Object.keys(pathValue(member, patch.path).value).length) fail('Stale undo: new container has unrelated entries');
    writePath(member, patch.path, { exists: false });
  }
}
function restoreTaskChanges(state, changes) {
  // Catalogue refreshes can change every row. Check each after-value against
  // one index instead of rescanning the entire catalogue for every change.
  const positions = new Map(state.tasks.map((task, index) => [task.id, index]));
  for (const change of changes) {
    const index = positions.get(change.id);
    if ((index !== undefined) !== change.after.exists || (index !== undefined && (index !== change.after.index || JSON.stringify(state.tasks[index]) !== JSON.stringify(change.after.value)))) fail('Stale undo: task catalogue has changed');
  }
  const ids = new Set(changes.map(change => change.id));
  const unchanged = state.tasks.filter(task => !ids.has(task.id));
  const restored = [], additions = changes.filter(change => change.before.exists).sort((a, b) => a.before.index - b.before.index);
  let cursor = 0;
  for (let inserted = 0; inserted < additions.length; inserted++) {
    const change = additions[inserted];
    // Match the bounds of each preceding splice, including the rows already
    // inserted. Validated deltas have distinct before indices.
    if (change.before.index > unchanged.length + inserted) fail('Stale undo: task catalogue index is outside its bounds');
    while (restored.length < change.before.index) restored.push(unchanged[cursor++]);
    restored.push(change.before.value);
  }
  while (cursor < unchanged.length) restored.push(unchanged[cursor++]);
  state.tasks = restored;
}

// Backups have a JSON boundary. Reject values JSON would silently lose or alter.
function assertJson(value) {
  const seen = new Set();
  function visit(item, path, historyList = false, historyEvent = false) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object') fail(`${path} is not JSON serializable`);
    if (seen.has(item)) fail(`${path} contains a circular reference`);
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) fail(`${path} must contain plain JSON objects`);
    if (Object.getOwnPropertySymbols(item).length) fail(`${path} contains symbol properties`);
    // Restore and identity-migration provenance also contain preserved History.
    // Check attribution while walking JSON so those archives get the same
    // credential/shape boundary without another traversal of large evidence.
    if (historyEvent && Object.hasOwn(item, 'actor')) validateHistoryActor(item.actor);
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) visit(item[index], `${path}[${index}]`, false, historyList);
    } else {
      for (const [key, child] of Object.entries(item)) visit(child, `${path}.${key}`, key === 'history' || key === 'incomingHistory' || key === 'previousHistory');
    }
    seen.delete(item);
  }
  visit(value, 'state');
}

function jsonClone(value) {
  assertJson(value);
  return JSON.parse(JSON.stringify(value));
}

function registryOrDefault(registry) { return registry ?? createRuleRegistry(); }

export function createGroupState(members = [], registry) {
  if (!Array.isArray(members)) fail('members must be an array');
  return validateState({ schemaVersion: SCHEMA_VERSION, revision: 0, rules: {},
    members: members.map(member => ({ sourceMapId: null, unlocked: [], selected: [], pendingRoll: [],
      blacklisted: [], completedTasks: [], teleports: [], ...member })),
    tasks: [], history: [] }, registry);
}

export function validateState(state, registry) {
  record(state, 'state');
  return validateStateCopy(jsonClone(state), registry);
}

/** Storage already owns this private copy. Validate every JSON/schema invariant
 * without making another full catalogue, registry and provenance clone. */
export function validateOwnedState(state, registry) {
  record(state, 'state');
  assertJson(state);
  return validateStateCopy(state, registry);
}

function validateStateCopy(copy, registry) {
  knownKeys(copy, STATE_KEYS, 'state');
  if (copy.identityRegistry !== undefined) validateIdentityRegistry(copy.identityRegistry);
  canonicalizeTaskClaimAliases(copy);
  if (copy.progressSnapshots !== undefined) validateProgressSnapshots(copy.progressSnapshots);
  if (copy.identityRegistry && Array.isArray(copy.members) && Array.isArray(copy.tasks)) {
    for (const member of copy.members) {
      uniqueStrings(member.completedTasks, 'completedTasks');
      if (member.taskStatus !== undefined) dictionary(member.taskStatus, 'taskStatus', value => record(value, 'task status'));
      if (member.taskAlternatives !== undefined) dictionary(member.taskAlternatives, 'taskAlternatives', groups => dictionary(groups, 'alternative groups', value => { if (value !== null) string(value, 'alternative task ID'); }));
    }
    const presentTaskIds = new Set(copy.tasks.map(task => task.id));
    const needsProjection = copy.members.some(member => [...(member.completedTasks ?? []), ...Object.keys(member.taskStatus ?? {}), ...alternativeTaskIds(member)]
      .some(id => !presentTaskIds.has(id) || resolveSavedTaskId(copy.identityRegistry, id) !== id));
    if (needsProjection) copy = migrateTaskIdentities(copy).state;
  }
  if (copy.schemaVersion !== SCHEMA_VERSION) fail(`Unsupported state schema version: ${copy.schemaVersion}`);
  if (!Number.isSafeInteger(copy.revision) || copy.revision < 0) fail('revision must be a nonnegative safe integer');
  record(copy.rules, 'rules');
  registryOrDefault(registry).resolve(copy.rules);
  if (copy.ruleReviews !== undefined) validateRuleReviews(copy.ruleReviews, registryOrDefault(registry));
  uniqueRecords(copy.tasks, 'tasks');
  for (const task of copy.tasks) validateTask(task, new Set((copy.members ?? []).map(member => member.id)));
  const tasks = new Set(copy.tasks.map(task => task.id));
  const taskRows = new Map(copy.tasks.map(task => [task.id, task]));
  uniqueRecords(copy.members, 'members');
  if (copy.finishLine !== undefined) validateFinishLine(copy.finishLine, new Set(copy.members.map(member => member.id)));
  if (copy.groupGoals !== undefined) validateGroupGoals(copy.groupGoals, new Set(copy.members.map(member => member.id)));
  if (copy.progressSnapshots && JSON.stringify(copy.progressSnapshots.memberIds) !== JSON.stringify(copy.members.map(member => member.id))) fail('Progress snapshots member IDs must match the current roster and order');
  for (const member of copy.members) {
    const path = `member ${member.id}`;
    knownKeys(member, MEMBER_KEYS, 'member');
    if (member.f2pMap !== undefined) validateF2PMap(member.f2pMap);
    if (member.transportFacts !== undefined) validateTransportFacts(member.transportFacts);
    if (member.teleportOverrides !== undefined) {
      if (Object.keys(member.teleportOverrides).length > 512) fail('Too many teleport overrides');
      dictionary(member.teleportOverrides, `${path}.teleportOverrides`, (value, id) => {
        propertyKey(id, 'teleport route');
        if (id.length > 200 || typeof value !== 'boolean') fail('Teleport overrides must be route IDs with boolean values');
      });
    }
    string(member.name, `${path}.name`);
    if (!Object.hasOwn(member, 'runescapeName') && Object.hasOwn(defaultRuneScapeNames, member.id)) member.runescapeName = defaultRuneScapeNames[member.id];
    if (member.runescapeName !== undefined) member.runescapeName = validateRuneScapeName(member.runescapeName);
    if (member.sourceMapId !== null) string(member.sourceMapId, `${path}.sourceMapId`);
    for (const field of ['unlocked', 'selected', 'pendingRoll', 'blacklisted']) uniqueStrings(member[field], `${path}.${field}`, chunk);
    if (member.pendingRoll.length > 2) fail(`${path} has more than two pending roll choices`);
    const progression = [...member.unlocked, ...member.selected, ...member.pendingRoll];
    if (new Set(progression).size !== progression.length) fail(`${path} has overlapping unlocked, selected or pending roll chunks`);
    uniqueStrings(member.completedTasks, `${path}.completedTasks`);
    if (!Object.hasOwn(member, 'obtainedEquipment')) member.obtainedEquipment = [];
    uniqueStrings(member.obtainedEquipment, `${path}.obtainedEquipment`);
    for (const id of member.completedTasks) if (!tasks.has(id)) fail(`${path} completion references absent task: ${id}`);
    uniqueRecords(member.teleports, `${path}.teleports`);
    for (const teleport of member.teleports) {
      knownKeys(teleport, new Set(['id', 'label', 'destination', 'available', 'consumable']), 'teleport');
      string(teleport.label, `${path}.teleport ${teleport.id}.label`);
      chunk(teleport.destination, `${path}.teleport ${teleport.id}.destination`);
      if (typeof teleport.available !== 'boolean' || typeof teleport.consumable !== 'boolean') fail(`${path}.teleport ${teleport.id} flags must be boolean`);
    }
    if (member.notes !== undefined) dictionary(member.notes, `${path}.notes`, (value, id) => { chunk(id, 'note chunk'); text(value, 'note'); });
    if (member.journal !== undefined) journalText(member.journal, `${path}.journal`);
    if (member.taskRules !== undefined) dictionary(member.taskRules, `${path}.taskRules`, (value, id) => primitive(value, `task rule ${id}`));
    if (member.preferences !== undefined) dictionary(member.preferences, `${path}.preferences`, (value, id) => validatePreference(id, value));
    if (member.primaryOverrides !== undefined) dictionary(member.primaryOverrides, `${path}.primaryOverrides`, (value, skill) => { validateControlSkill(skill); if (typeof value !== 'boolean') fail('Primary override must be boolean'); });
    for (const field of ['passiveLevels', 'maxLevels']) if (member[field] !== undefined) dictionary(member[field], `${path}.${field}`, (value, skill) => { validateControlSkill(skill); validateControlLevel(value); });
    if (member.slayerLock !== undefined) validateSlayerLock(member.slayerLock);
    if (member.skillProgress !== undefined) dictionary(member.skillProgress, `${path}.skillProgress`, (value, skill) => validateSkillProgress(skill, value));
    if (member.questProgress !== undefined) dictionary(member.questProgress, `${path}.questProgress`, (value, id) => validateQuestProgress(id, value, taskRows));
    if (member.xpChoices !== undefined) dictionary(member.xpChoices, `${path}.xpChoices`, (value, id) => { if (!tasks.has(id)) fail('XP choices reference absent task'); validateSavedXpChoices(value); });
    if (member.runeMetricsSync !== undefined) validateRuneMetricsProvenance(member.runeMetricsSync);
    if (member.originalPickerSync !== undefined) validateOriginalPickerSync(member.originalPickerSync);
    if (member.chunkColours !== undefined) dictionary(member.chunkColours, `${path}.chunkColours`, (value, id) => { chunk(id, 'colour chunk'); validateChunkColour(value); });
    if (member.chunkColourNames !== undefined) dictionary(member.chunkColourNames, `${path}.chunkColourNames`, (value, id) => { validateChunkColour(id, { allowClear: false }); validateChunkColourName(value); });
    if (member.stickers !== undefined) dictionary(member.stickers, `${path}.stickers`, (value, id) => { chunk(id, 'sticker chunk'); validateSavedStickers(value); });
    if (member.taskAlternatives !== undefined) dictionary(member.taskAlternatives, `${path}.taskAlternatives`, (groups, category) => {
      dictionary(groups, `${path}.taskAlternatives.${category}`, (value, group) => validateTaskAlternative(category, group, value, taskRows));
    });
    if (member.sectionOverrides !== undefined) dictionary(member.sectionOverrides, `${path}.sectionOverrides`, (value, id) => { section(id, 'section override'); if (typeof value !== 'boolean') fail('section override must be boolean'); });
    if (member.areaOverrides !== undefined) dictionary(member.areaOverrides, `${path}.areaOverrides`, value => { if (typeof value !== 'boolean') fail('area override must be boolean'); });
    if (member.sourceBacklogs !== undefined) dictionary(member.sourceBacklogs, `${path}.sourceBacklogs`, (entries, kind) => {
      if (!SOURCE_KINDS.has(kind)) fail(`Unknown source backlog kind: ${kind}`);
      dictionary(entries, `${path}.sourceBacklogs.${kind}`, value => { if (typeof value !== 'boolean') fail('source backlog must be boolean'); });
    });
    if (member.taskStatus !== undefined) dictionary(member.taskStatus, `${path}.taskStatus`, (value, id) => {
      if (!tasks.has(id)) fail(`Task status references absent task: ${id}`);
      record(value, 'task status'); knownKeys(value, new Set(['backlogged', 'backlogReason', 'favorite', 'note', 'challengeCompleted']), 'task status');
      for (const flag of ['backlogged', 'favorite', 'challengeCompleted']) if (value[flag] !== undefined && typeof value[flag] !== 'boolean') fail(`task status ${flag} must be boolean`);
      if (value.note !== undefined) text(value.note, 'task status note');
      if (value.backlogReason !== undefined) text(value.backlogReason, 'task backlog reason');
      if (!Object.keys(value).length) fail('task status needs at least one field');
    });
  }
  const claimTaskIds = copy.taskClaims === undefined ? tasks : new Set(tasks);
  const claimMemberIds = new Set(copy.members.map(member => member.id));
  for (const id of Object.keys(copy.taskClaims ?? {})) if (claimTaskRow(copy, id)) claimTaskIds.add(id);
  if (copy.taskClaims !== undefined) dictionary(copy.taskClaims, 'taskClaims', (value, id) => {
    validateTaskClaim(value, claimTaskIds, claimMemberIds, id);
    if (resolveSavedTaskId(copy.identityRegistry, id) !== id) fail('Task claims require canonical task IDs');
  });
  uniqueRecords(copy.history, 'history');
  let previousRevision = 0;
  for (const event of copy.history) {
    if (!Number.isSafeInteger(event.revision) || event.revision < 1 || event.revision > copy.revision) fail('History event revision is invalid');
    if (event.id !== `revision-${event.revision}`) fail('History event ID must match its revision');
    if (event.revision <= previousRevision) fail('History revisions must be unique and monotonically increasing');
    previousRevision = event.revision;
    string(event.type, 'history event type');
    string(event.at, 'history event timestamp');
  }
  // Validate bounded undo snapshots independently, without recursive history.
  const historicalTasks = new Map(copy.tasks.map(task => [task.id, task]));
  const memberIds = new Set(copy.members.map(member => member.id));
  const historyByRevision = new Map(copy.history.map(event => [event.revision, event]));
  for (const event of copy.history) {
    if (event.command?.type === 'add-task') {
      validateTask(event.command.task, memberIds);
      historicalTasks.set(event.command.task.id, event.command.task);
    }
    if (event.undo?.tasks !== undefined) {
      uniqueRecords(event.undo.tasks, 'history undo tasks');
      for (const task of event.undo.tasks) { validateTask(task, memberIds); historicalTasks.set(task.id, task); }
    }
    for (const change of event.undo?.taskClaimChanges?.changes ?? []) {
      const row = claimTaskRow(copy, change.id); if (row) historicalTasks.set(change.id, row);
    }
    if (event.undo?.taskChanges !== undefined) {
      validateTaskChanges(event.undo.taskChanges, memberIds);
      for (const change of event.undo.taskChanges) for (const side of [change.before, change.after]) if (side.exists) historicalTasks.set(change.id, side.value);
    }
  }
  // Task edits change category while older personal inverses still address the
  // earlier category. Resolve each side against its own revision's task row.
  const taskTimeline = new Map();
  for (const event of copy.history) {
    const target = event.type === 'undo' ? historyByRevision.get(event.command?.undoRevision) : event;
    for (const change of target?.undo?.taskChanges ?? []) {
      const timeline = taskTimeline.get(change.id) ?? [];
      timeline.push({ revision: event.revision, before: event.type === 'undo' ? change.after : change.before,
        after: event.type === 'undo' ? change.before : change.after });
      taskTimeline.set(change.id, timeline);
    }
  }
  const taskRowsAt = revision => ({
    has(id) { return historicalTasks.has(id); },
    get(id) {
      const timeline = taskTimeline.get(id);
      if (!timeline) return historicalTasks.get(id);
      const side = timeline.findLast(change => change.revision <= revision)?.after ?? timeline[0].before;
      return side.exists ? side.value : historicalTasks.get(id);
    },
  });
  for (const event of copy.history) {
    if (event.undo !== undefined) {
      record(event.undo, 'history undo'); knownKeys(event.undo, new Set(['members', 'rules', 'tasks', 'memberChanges', 'taskChanges', 'taskClaimChanges', 'finishLineChange', 'groupGoalChanges', 'ruleReviewChange']), 'history undo');
      if (!Object.keys(event.undo).length) fail('History undo needs a snapshot');
      if (event.undo.members !== undefined && event.undo.memberChanges !== undefined) fail('Undo cannot mix member snapshots and changes');
      if (event.undo.tasks !== undefined && event.undo.taskChanges !== undefined) fail('Undo cannot mix task snapshots and changes');
      if (Object.hasOwn(event.undo, 'rules')) { record(event.undo.rules, 'history undo rules'); registryOrDefault(registry).resolve(event.undo.rules); }
      if (Object.hasOwn(event.undo, 'members')) {
        uniqueRecords(event.undo.members, 'history undo members');
        if (!event.undo.members.length) fail('History undo members must be nonempty');
      }
      if (event.undo.memberChanges !== undefined) {
        uniqueRecords(event.undo.memberChanges, 'history undo member changes');
        if (!event.undo.memberChanges.length) fail('Undo member changes must be nonempty');
        for (const change of event.undo.memberChanges) validateMemberChanges(change, taskRowsAt(event.revision - 1), memberIds, taskRowsAt(event.revision));
      }
      if (event.undo.taskClaimChanges !== undefined) validateTaskClaimChanges(event.undo.taskClaimChanges, historicalTasks, memberIds);
      if (event.undo.finishLineChange !== undefined) validateFinishLineChange(event.undo.finishLineChange, memberIds);
      if (event.undo.groupGoalChanges !== undefined) validateGroupGoalChanges(event.undo.groupGoalChanges, memberIds);
      if (event.undo.ruleReviewChange !== undefined) validateRuleReviewChange(event.undo.ruleReviewChange, registryOrDefault(registry));
      const snapshotMembers = event.undo.members ?? [];
      uniqueRecords(snapshotMembers, 'history undo members');
      const references = new Set();
      for (const member of snapshotMembers) {
        uniqueStrings(member.completedTasks, `history undo member ${member.id}.completedTasks`);
        if (member.taskStatus !== undefined) record(member.taskStatus, `history undo member ${member.id}.taskStatus`);
        for (const id of [...member.completedTasks, ...Object.keys(member.taskStatus ?? {}), ...Object.keys(member.questProgress ?? {}), ...alternativeTaskIds(member)]) references.add(id);
      }
      const referencedTasks = event.undo.tasks ?? [...references].map(id => {
        if (!historicalTasks.has(id)) fail(`History undo references absent task: ${id}`);
        return historicalTasks.get(id);
      });
      // Member-only changes validate their references, not the entire world task
      // catalogue once per historical event. Catalogue undo still validates all.
      // Assigned rows were checked against the complete roster above. This
      // member-only snapshot may contain only one of the task's assignees.
      const snapshot = { schemaVersion: SCHEMA_VERSION, revision: 0, history: [], rules: event.undo.rules ?? {}, members: snapshotMembers,
        tasks: referencedTasks.map(({ memberIds: assignment, ...task }) => task) };
      validateState(snapshot, registry);
      for (const member of snapshot.members) if (!copy.members.some(current => current.id === member.id)) fail('History undo references absent member');
    }
    if (event.undoneRevision !== undefined) {
      if (!Number.isSafeInteger(event.undoneRevision) || event.undoneRevision <= event.revision || !event.undo) fail('History undo revision is invalid');
      const marker = historyByRevision.get(event.undoneRevision);
      if (marker?.type !== 'undo' || marker.command?.undoRevision !== event.revision) fail('History undo marker is invalid');
    }
    if (event.type === 'undo') {
      const target = historyByRevision.get(event.command?.undoRevision);
      if (!target?.undo || target.undoneRevision !== event.revision) fail('History undo target is invalid');
    }
  }
  // Check the remaining sparse undo chain against a private working copy.
  // Older snapshots have no after-value guards, but still form valid boundaries
  // for later sparse deltas. This catches stale/corrupt imported history before
  // it can be selected by undo without copying the catalogue per event.
  if (copy.history.some(event => event.undo?.memberChanges || event.undo?.taskChanges || event.undo?.taskClaimChanges || event.undo?.finishLineChange || event.undo?.groupGoalChanges || event.undo?.ruleReviewChange)) {
    const replay = { members: jsonClone(copy.members), tasks: [...copy.tasks], ...(copy.taskClaims !== undefined ? { taskClaims: jsonClone(copy.taskClaims) } : {}), ...(copy.finishLine !== undefined ? { finishLine: jsonClone(copy.finishLine) } : {}), ...(copy.groupGoals !== undefined ? { groupGoals: jsonClone(copy.groupGoals) } : {}), ...(copy.ruleReviews !== undefined ? { ruleReviews: jsonClone(copy.ruleReviews) } : {}) };
    let replayTaskIds = new Set(copy.tasks.map(task => task.id));
    for (let index = copy.history.length - 1; index >= 0; index--) {
      const event = copy.history[index];
      if (!event.undo || event.undoneRevision !== undefined || event.type === 'undo') continue;
      if (event.undo.members) for (const member of event.undo.members) replay.members[replay.members.findIndex(current => current.id === member.id)] = jsonClone(member);
      if (event.undo.memberChanges) for (const change of event.undo.memberChanges) {
        const member = replay.members.find(member => member.id === change.id);
        restoreMemberChanges(member, change.changes);
        const progression = [...member.unlocked, ...member.selected, ...member.pendingRoll];
        if (new Set(progression).size !== progression.length) fail('Undo restores overlapping unlocked, selected or pending chunks');
      }
      if (event.undo.taskClaimChanges) restoreTaskClaimChanges(replay, jsonClone(event.undo.taskClaimChanges));
      if (event.undo.finishLineChange) restoreFinishLineChange(replay, event.undo.finishLineChange);
      if (event.undo.groupGoalChanges) restoreGroupGoalChanges(replay, event.undo.groupGoalChanges);
      if (event.undo.ruleReviewChange) restoreRuleReviewChange(replay, event.undo.ruleReviewChange);
      if (event.undo.tasks) { replay.tasks = [...event.undo.tasks]; replayTaskIds = new Set(replay.tasks.map(task => task.id)); }
      if (event.undo.taskChanges) {
        restoreTaskChanges(replay, event.undo.taskChanges);
        for (const change of event.undo.taskChanges) {
          if (change.before.exists) replayTaskIds.add(change.id);
          else replayTaskIds.delete(change.id);
        }
      }
      for (const id of Object.keys(replay.taskClaims ?? {})) if (!replayTaskIds.has(id) && !claimTaskRow(copy, id)) fail(`Sparse undo task claim references absent task at its historical revision: ${id}`);
      const checkMembers = event.undo.taskChanges ? replay.members
        : (event.undo.memberChanges ?? []).map(change => replay.members.find(member => member.id === change.id));
      for (const member of checkMembers) for (const id of [...member.completedTasks, ...Object.keys(member.taskStatus ?? {}), ...Object.keys(member.questProgress ?? {}), ...alternativeTaskIds(member)]) {
        if (!replayTaskIds.has(id)) fail(`Sparse undo references absent task at its historical revision: ${id}`);
      }
    }
  }
  const diagnostics = savedTaskRuleDiagnostics(copy);
  if (diagnostics.length) {
    record(copy.provenance ?? {}, 'provenance');
    copy.provenance = { ...copy.provenance, taskRuleDiagnostics: diagnostics };
  } else if (copy.provenance?.taskRuleDiagnostics !== undefined) delete copy.provenance.taskRuleDiagnostics;
  // Validate the original sparse undo guards before migrating their values.
  // Transform both sides and current rows together so old null/singleton
  // backups retain their complete undo chain and explicit removal masks.
  const normalizeMember = member => {
    if (member.stickers !== undefined) for (const [id, value] of Object.entries(member.stickers)) {
      if (!Array.isArray(value)) member.stickers[id] = normalizeStickerList(value, id);
    }
  };
  copy.members.forEach(normalizeMember);
  for (const event of copy.history) {
    (event.undo?.members ?? []).forEach(normalizeMember);
    for (const change of event.undo?.memberChanges ?? []) for (const patch of change.changes) {
      if (patch.kind === 'value' && patch.path[0] === 'stickers') {
        for (const side of [patch.before, patch.after]) if (side.exists && !Array.isArray(side.value)) side.value = normalizeStickerList(side.value, patch.path[1]);
        if (JSON.stringify(patch.before) === JSON.stringify(patch.after)) fail('Undo sticker patch must describe a change after migration');
      }
    }
  }
  return copy;
}

export function exportBackup(state, registry) {
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, state: validateState(state, registry) };
}

export function importBackup(document, registry) {
  let backup = document;
  if (typeof backup === 'string') {
    try { backup = JSON.parse(backup); } catch { fail('Backup is not valid JSON'); }
  }
  record(backup, 'backup');
  if (backup.format !== BACKUP_FORMAT) fail('Unsupported backup format');
  if (backup.schemaVersion !== SCHEMA_VERSION) fail(`Unsupported backup schema version: ${backup.schemaVersion}`);
  return validateState(backup.state, registry);
}

function difference(before, after) {
  return { added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) };
}
function recordChanges(before, after) {
  return {
    added: after.filter(item => !before.some(old => old.id === item.id)),
    removed: before.filter(item => !after.some(next => next.id === item.id)),
    changed: after.filter(item => {
      const old = before.find(candidate => candidate.id === item.id);
      return old && JSON.stringify(old) !== JSON.stringify(item);
    }).map(item => ({ id: item.id, before: before.find(old => old.id === item.id), after: item })),
  };
}

function dictionaryChanges(before = {}, after = {}) {
  const keys = difference(Object.keys(before), Object.keys(after));
  return { ...keys, changed: Object.keys(before).filter(key => Object.hasOwn(after, key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) };
}

function removedPaths(before, after, path = 'legacy') {
  if (before === null || typeof before !== 'object') return [];
  if (after === null || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return [path];
  return Object.keys(before).flatMap(key => Object.hasOwn(after, key)
    ? removedPaths(before[key], after[key], `${path}.${key}`) : [`${path}.${key}`]);
}

export function previewRestore(current, incoming, registry) {
  const before = validateState(current, registry);
  const after = incoming?.format === BACKUP_FORMAT ? importBackup(incoming, registry) : validateState(incoming, registry);
  const members = [...new Set([...before.members, ...after.members].map(member => member.id))].map(id => {
    const oldMember = before.members.find(member => member.id === id);
    const newMember = after.members.find(member => member.id === id);
    return { id, name: newMember?.name ?? oldMember.name,
      status: !oldMember ? 'added' : !newMember ? 'removed' : 'existing',
      unlocked: difference(oldMember?.unlocked ?? [], newMember?.unlocked ?? []),
      selected: difference(oldMember?.selected ?? [], newMember?.selected ?? []),
      pendingRoll: difference(oldMember?.pendingRoll ?? [], newMember?.pendingRoll ?? []),
      blacklisted: difference(oldMember?.blacklisted ?? [], newMember?.blacklisted ?? []),
      completedTasks: difference(oldMember?.completedTasks ?? [], newMember?.completedTasks ?? []),
      obtainedEquipment: difference(oldMember?.obtainedEquipment ?? [], newMember?.obtainedEquipment ?? []),
      identity: {
        name: { before: oldMember?.name ?? null, after: newMember?.name ?? null },
        runescapeName: { before: oldMember?.runescapeName ?? null, after: newMember?.runescapeName ?? null },
        sourceMapId: { before: oldMember?.sourceMapId ?? null, after: newMember?.sourceMapId ?? null },
        changed: Boolean(oldMember && newMember && (oldMember.name !== newMember.name || oldMember.sourceMapId !== newMember.sourceMapId || oldMember.runescapeName !== newMember.runescapeName)),
      },
      teleports: recordChanges(oldMember?.teleports ?? [], newMember?.teleports ?? []),
      transportFacts: { before: oldMember?.transportFacts ?? {}, after: newMember?.transportFacts ?? {}, changed: JSON.stringify(oldMember?.transportFacts ?? {}) !== JSON.stringify(newMember?.transportFacts ?? {}) },
      teleportOverrides: { before: oldMember?.teleportOverrides ?? {}, after: newMember?.teleportOverrides ?? {}, changed: JSON.stringify(oldMember?.teleportOverrides ?? {}) !== JSON.stringify(newMember?.teleportOverrides ?? {}) },
      notes: dictionaryChanges(oldMember?.notes, newMember?.notes),
      journal: { before: oldMember?.journal ?? null, after: newMember?.journal ?? null, changed: oldMember?.journal !== newMember?.journal },
      taskStatus: dictionaryChanges(oldMember?.taskStatus, newMember?.taskStatus),
      taskRules: dictionaryChanges(oldMember?.taskRules, newMember?.taskRules),
      preferences: dictionaryChanges(oldMember?.preferences, newMember?.preferences),
      primaryOverrides: dictionaryChanges(oldMember?.primaryOverrides, newMember?.primaryOverrides),
      passiveLevels: dictionaryChanges(oldMember?.passiveLevels, newMember?.passiveLevels),
      maxLevels: dictionaryChanges(oldMember?.maxLevels, newMember?.maxLevels),
      skillProgress: dictionaryChanges(oldMember?.skillProgress, newMember?.skillProgress),
      questProgress: dictionaryChanges(oldMember?.questProgress, newMember?.questProgress),
      runeMetricsSync: { before: oldMember?.runeMetricsSync ?? null, after: newMember?.runeMetricsSync ?? null, changed: JSON.stringify(oldMember?.runeMetricsSync) !== JSON.stringify(newMember?.runeMetricsSync) },
      stickers: dictionaryChanges(oldMember?.stickers, newMember?.stickers),
      chunkColours: dictionaryChanges(oldMember?.chunkColours, newMember?.chunkColours),
      chunkColourNames: dictionaryChanges(oldMember?.chunkColourNames, newMember?.chunkColourNames),
      xpChoices: dictionaryChanges(oldMember?.xpChoices, newMember?.xpChoices),
      taskAlternatives: dictionaryChanges(oldMember?.taskAlternatives, newMember?.taskAlternatives),
      slayerLock: { before: oldMember?.slayerLock ?? null, after: newMember?.slayerLock ?? null, changed: JSON.stringify(oldMember?.slayerLock) !== JSON.stringify(newMember?.slayerLock) },
      sectionOverrides: dictionaryChanges(oldMember?.sectionOverrides, newMember?.sectionOverrides),
      areaOverrides: dictionaryChanges(oldMember?.areaOverrides, newMember?.areaOverrides),
      sourceBacklogs: dictionaryChanges(oldMember?.sourceBacklogs, newMember?.sourceBacklogs),
    };
  });
  const resolvedBefore = registryOrDefault(registry).resolve(before.rules);
  const resolvedAfter = registryOrDefault(registry).resolve(after.rules);
  const changed = Object.keys(resolvedAfter).filter(id => resolvedBefore[id] !== resolvedAfter[id])
    .map(ruleId => ({ ruleId, before: resolvedBefore[ruleId], after: resolvedAfter[ruleId] }));
  const tasks = recordChanges(before.tasks, after.tasks);
  const oldMaps = before.legacy?.maps ?? {};
  const newMaps = after.legacy?.maps ?? {};
  const mapDifferences = difference(Object.keys(oldMaps), Object.keys(newMaps));
  const legacy = {
    changed: JSON.stringify(before.legacy) !== JSON.stringify(after.legacy),
    addedMaps: mapDifferences.added,
    removedMaps: mapDifferences.removed,
    changedMaps: Object.keys(oldMaps).filter(id => Object.hasOwn(newMaps, id) && JSON.stringify(oldMaps[id]) !== JSON.stringify(newMaps[id])),
    removedPaths: removedPaths(before.legacy, after.legacy),
  };
  const warnings = (after.provenance?.taskRuleDiagnostics ?? []).map(item => `Restore ${before.members.find(member => member.id === item.memberId || member.sourceMapId === item.sourceMapId)?.name ?? after.members.find(member => member.id === item.memberId || member.sourceMapId === item.sourceMapId)?.name ?? item.memberId ?? item.sourceMapId}: ${item.detail}`);
  for (const item of after.provenance?.taskIdentityMigration?.unresolved ?? []) warnings.push(`Restore keeps the saved task ${before.tasks.find(task => task.id === item.originalId)?.label ?? after.tasks.find(task => task.id === item.originalId)?.label ?? item.originalId} from ${item.path} for review because it could not be matched.`);
  const identityRegistry = { changed: JSON.stringify(before.identityRegistry) !== JSON.stringify(after.identityRegistry),
    removedAliases: Object.keys(before.identityRegistry?.aliases ?? {}).filter(alias => !Object.hasOwn(after.identityRegistry?.aliases ?? {}, alias)) };
  if (identityRegistry.removedAliases.length) warnings.push(`Restore changes ${identityRegistry.removedAliases.length} older task references; your previous save remains in the backup.`);
  if (legacy.removedMaps.length) warnings.push(`Restore removes saved copies of original maps: ${legacy.removedMaps.map(id => before.members.find(member => member.sourceMapId === id)?.name ?? id).join(', ')}.`);
  if (legacy.changedMaps.length) warnings.push(`Restore changes saved original-picker progress for: ${legacy.changedMaps.map(id => before.members.find(member => member.sourceMapId === id)?.name ?? id).join(', ')}. Review notes, checks and backlogs before replacing the current save.`);
  if (legacy.removedPaths.length) warnings.push(`Restore removes these saved original-picker records: ${legacy.removedPaths.join(', ')}.`);
  for (const member of members) {
    if (member.journal.changed) warnings.push(`Restore ${member.journal.after === null ? 'removes' : 'changes'} the journal for ${member.identity.name.before ?? member.name}.`);
    if (member.identity.changed) warnings.push(`Restore changes the name, RuneScape account or original map owner for ${member.identity.name.before ?? member.name}.`);
    if (member.completedTasks.removed.length) warnings.push(`Restore removes personal task completions for ${member.identity.name.before ?? member.name}: ${member.completedTasks.removed.map(id => before.tasks.find(task => task.id === id)?.label ?? after.tasks.find(task => task.id === id)?.label ?? id).join(', ')}.`);
    if (member.teleports.removed.length || member.teleports.changed.length) warnings.push(`Restore removes or changes saved teleports for ${member.identity.name.before ?? member.name}.`);
    if (member.transportFacts.changed) warnings.push(`Restore changes confirmed travel requirements for ${member.identity.name.before ?? member.name}.`);
    if (member.teleportOverrides.changed) warnings.push(`Restore changes personal teleport availability choices for ${member.identity.name.before ?? member.name}.`);
    for (const field of ['notes', 'taskStatus', 'taskRules', 'sectionOverrides', 'areaOverrides', 'sourceBacklogs', 'preferences', 'primaryOverrides', 'passiveLevels', 'maxLevels', 'stickers', 'chunkColours', 'chunkColourNames', 'taskAlternatives', 'skillProgress', 'questProgress', 'xpChoices']) {
      if (member[field].removed.length || member[field].changed.length) warnings.push(`Restore removes or changes ${({ notes: 'notes', taskStatus: 'task checks and backlog choices', taskRules: 'task rules', sectionOverrides: 'section access choices', areaOverrides: 'area access choices', sourceBacklogs: 'backlogged item sources', preferences: 'settings', primaryOverrides: 'main training method assumptions', passiveLevels: 'levels possible without a main training method', maxLevels: 'training level limits', stickers: 'map stickers', chunkColours: 'chunk colours', chunkColourNames: 'chunk colour names', taskAlternatives: 'chosen task methods', skillProgress: 'personal levels and XP', questProgress: 'personal quest progress', xpChoices: 'XP reward choices' })[field]} for ${member.identity.name.before ?? member.name}.`);
    }
    if (member.slayerLock.changed) warnings.push(`Restore changes the Slayer lock for ${member.identity.name.before ?? member.name}.`);
    if (member.runeMetricsSync.changed) warnings.push(`Restore changes the last RuneMetrics sync for ${member.identity.name.before ?? member.name}.`);
  }
  const provenance = { changed: JSON.stringify(before.provenance) !== JSON.stringify(after.provenance),
    removedPaths: removedPaths(before.provenance, after.provenance, 'provenance') };
  if (provenance.removedPaths.length) warnings.push(`Restore removes these saved source details: ${provenance.removedPaths.join(', ')}.`);
  if (JSON.stringify(before.progressSnapshots) !== JSON.stringify(after.progressSnapshots)) {
    warnings.push(`Restore replaces saved daily progress counts (${before.progressSnapshots?.days.length ?? 0} current, ${after.progressSnapshots?.days.length ?? 0} in the backup).`);
  }
  const groupGoals = recordChanges(before.groupGoals ?? [], after.groupGoals ?? []);
  if (JSON.stringify(before.groupGoals ?? []) !== JSON.stringify(after.groupGoals ?? [])) {
    warnings.push(`Restore replaces shared group goals (${before.groupGoals?.length ?? 0} current, ${after.groupGoals?.length ?? 0} in the backup). Review the shared plan before restoring.`);
  }
  const history = difference(before.history.map(event => event.id), after.history.map(event => event.id));
  if (history.removed.length) warnings.push(`Restore removes ${history.removed.length} History entries.`);
  return { currentRevision: before.revision, incomingRevision: after.revision, members, rules: { changed }, tasks, legacy, provenance, history, identityRegistry, groupGoals, warnings };
}

function findMember(state, id) {
  const member = state.members.find(item => item.id === id);
  if (!member) fail(`Unknown member: ${id}`);
  return member;
}
const validatedCommandBaselines = new WeakMap(), validatedTaskRows = new WeakMap();
function indexedTaskRows(tasks) {
  let rows = validatedTaskRows.get(tasks);
  if (!rows) { rows = new Map(tasks.map(task => [task.id, task])); validatedTaskRows.set(tasks, rows); }
  return rows;
}
function writableCommandTasks(state) {
  if (validatedCommandBaselines.get(state)?.tasks === state.tasks) state.tasks = [...state.tasks];
}
function registerCatalogueTask(state, id, catalogue) {
  string(id, 'taskId');
  if (validatedCommandBaselines.has(state) ? indexedTaskRows(state.tasks).has(id) : state.tasks.some(task => task.id === id)) return;
  const candidate = catalogue instanceof Map ? catalogue.get(id)
    : Array.isArray(catalogue) ? catalogue.find(task => task?.id === id) : undefined;
  if (!candidate) fail(`Unknown task: ${id}`);
  knownKeys(candidate, new Set(['id', 'label', 'category', 'rawLabel', 'aliases', 'kind', 'objectiveKind', 'sourceId', 'itemId', 'completionIds']), 'catalogue task');
  if (candidate.aliases !== undefined) uniqueStrings(candidate.aliases, 'catalogue task aliases');
  if (candidate.rawLabel !== undefined) string(candidate.rawLabel, 'catalogue raw label');
  if (candidate.sourceId !== undefined) string(candidate.sourceId, 'catalogue sourceId');
  if (candidate.itemId !== undefined) string(candidate.itemId, 'catalogue itemId');
  // Only a catalogue passed by the trusted caller may register a derived goal.
  // Command payloads cannot supply or replace task metadata.
  const task = jsonClone({ id: candidate.id, label: candidate.label, category: candidate.category });
  validateTask(task);
  if (task.id !== id) fail('Catalogue task ID does not match the requested task');
  writableCommandTasks(state);
  state.tasks.push(task);
  validatedTaskRows.get(state.tasks)?.set(task.id, task);
  if (isPermanentId(id)) {
    if (validatedCommandBaselines.get(state)?.identityRegistry === state.identityRegistry && state.identityRegistry) {
      state.identityRegistry = { ...state.identityRegistry, entries: { ...state.identityRegistry.entries }, aliases: { ...state.identityRegistry.aliases } };
    }
    state.identityRegistry ??= { schemaVersion: 1, entries: {}, aliases: {}, unresolved: [] };
    const baseline = lookupPermanentId(id);
    const previous = state.identityRegistry.entries[id];
    const aliases = [...new Set([id, ...(baseline?.aliases ?? []), ...(previous?.aliases ?? []), ...(candidate.aliases ?? []),
      ...(candidate.rawLabel ? [candidate.rawLabel, legacyTaskId(candidate.category, candidate.rawLabel)] : [])])];
    const entry = { ...baseline, ...previous, ...task, kind: candidate.kind ?? baseline?.kind ?? previous?.kind ?? 'task', aliases };
    const addedAliases = {};
    for (const alias of aliases) {
      const old = state.identityRegistry.aliases[alias];
      const targets = [...new Set([...(Array.isArray(old) ? old : typeof old === 'string' ? [old] : []), id])];
      Object.defineProperty(addedAliases, alias, { value: targets.length === 1 ? targets[0] : targets, enumerable: true });
    }
    validateIdentityRegistry({ schemaVersion: 1, entries: { [id]: entry }, aliases: addedAliases, unresolved: [] });
    state.identityRegistry.entries[id] = entry;
    Object.assign(state.identityRegistry.aliases, addedAliases);
  }
}
function timestamp(now) {
  const value = typeof now === 'function' ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('Command timestamp is invalid');
  return date.toISOString();
}

function knownDestination(world, id) {
  if (!(world?.chunks instanceof Map)) fail('A world is required for chunk editing');
  if (!world.chunks.has(id) || (world.surface && !world.surface.has(id))) fail(`Chunk ${id} is outside the known surface world`);
}

function knownRollDestination(world, id) {
  knownDestination(world, id);
  if (world.cacheWalking?.blockedRegions?.has(id)) fail(`Chunk ${id} has no witnessed walking boundary or known typed entry`);
}

function addManualNeighbors(state, member, unlocked, world, registry) {
  const settings = registryOrDefault(registry).resolve(state.rules);
  if (settings['roll.neighborMode'] !== 'manual' || !settings['roll.adjacent']) return;
  if (!world) fail('A world is required to add manual neighbor candidates');
  const unavailable = new Set([...member.unlocked, ...member.selected, ...member.pendingRoll, ...member.blacklisted]);
  for (const base of unlocked) for (const id of world.neighbors.get(base) ?? []) {
    if (!BASE_CHUNK.test(id) || !world.chunks.has(id) || (world.surface && !world.surface.has(id)) || unavailable.has(id)) continue;
    if (world.cacheWalking?.blockedRegions?.has(id)) continue;
    if (settings['roll.walkable'] && !world.walkable.has(id)) continue;
    if (settings['content.f2p'] && !world.f2p.has(id)) continue;
    member.selected.push(id); unavailable.add(id);
  }
}

function clearSelectedAfterUnlock(state, member, registry) {
  if (registryOrDefault(registry).resolve(state.rules)['roll.clearSelected']) member.selected = [];
}

function seedRandomStartSections(member, ids, world) {
  for (const id of ids) if (world?.sectionTopology?.get(id)?.has('1')) {
    member.sectionOverrides = { ...(member.sectionOverrides ?? {}), [`${id}-1`]: true };
  }
}

function hasRandomStartChoices(state, member) {
  // Intervening preference/note edits do not erase the origin of pending choices.
  // An Original pending offer has its own origin, even when the IDs match an
  // older local offer. Ignore undone offers so undo restores the previous origin.
  const offer = [...state.history].reverse().find(event => event.undoneRevision === undefined &&
    ((event.command?.memberId === member.id && ['random-start', 'roll'].includes(event.type)) ||
      (event.type === 'sync-original' && event.command?.members?.some(target => target.memberId === member.id && target.groups.includes('pendingRoll')))));
  return offer?.type === 'random-start' && offer.command.count === 2 &&
    JSON.stringify(offer.command.rolled) === JSON.stringify(member.pendingRoll);
}

function undoChanges(before, after) {
  const undo = {};
  const reviewChange = ruleReviewChange(before, after);
  if (reviewChange) undo.ruleReviewChange = reviewChange;
  const goalsChange = groupGoalChanges(before, after);
  if (goalsChange) undo.groupGoalChanges = goalsChange;
  if (JSON.stringify(before.finishLine) !== JSON.stringify(after.finishLine)) undo.finishLineChange = {
    before: before.finishLine === undefined ? { exists: false } : { exists: true, value: before.finishLine },
    after: after.finishLine === undefined ? { exists: false } : { exists: true, value: after.finishLine },
  };
  const memberChanges = [];
  for (const member of before.members) {
    const next = after.members.find(candidate => candidate.id === member.id), changes = [];
    function leaf(path, old, changed) {
      if (JSON.stringify(old) !== JSON.stringify(changed)) changes.push({ path, kind: 'value', before: old, after: changed });
    }
    function container(path, old, changed, depth) {
      const beforeExists = old !== undefined, afterExists = changed !== undefined;
      if (beforeExists !== afterExists) changes.push({ path, kind: 'object', before: { exists: beforeExists }, after: { exists: afterExists } });
      for (const key of new Set([...Object.keys(old ?? {}), ...Object.keys(changed ?? {})])) {
        if (depth > 1) container([...path, key], old?.[key], changed?.[key], depth - 1);
        else leaf([...path, key], Object.hasOwn(old ?? {}, key) ? { exists: true, value: old[key] } : { exists: false },
          Object.hasOwn(changed ?? {}, key) ? { exists: true, value: changed[key] } : { exists: false });
      }
    }
    for (const field of MEMBER_ARRAY_FIELDS) leaf([field], { exists: true, value: member[field] }, { exists: true, value: next[field] });
    for (const field of MEMBER_VALUE_FIELDS) leaf([field], Object.hasOwn(member, field) ? { exists: true, value: member[field] } : { exists: false }, Object.hasOwn(next, field) ? { exists: true, value: next[field] } : { exists: false });
    for (const field of MEMBER_DICTIONARY_FIELDS) container([field], member[field], next[field], MEMBER_NESTED_DICTIONARY_FIELDS.has(field) ? 2 : 1);
    if (changes.length) memberChanges.push({ id: member.id, changes });
  }
  if (memberChanges.length) undo.memberChanges = memberChanges;
  if (JSON.stringify(before.rules) !== JSON.stringify(after.rules)) undo.rules = before.rules;
  const claimChanges = [];
  for (const id of new Set([...Object.keys(before.taskClaims ?? {}), ...Object.keys(after.taskClaims ?? {})])) {
    const old = pathValue(before.taskClaims ?? {}, [id]), next = pathValue(after.taskClaims ?? {}, [id]);
    if (JSON.stringify(old) !== JSON.stringify(next)) claimChanges.push({ id, before: old, after: next });
  }
  if (claimChanges.length) undo.taskClaimChanges = { beforeExists: before.taskClaims !== undefined, afterExists: after.taskClaims !== undefined, changes: claimChanges };
  if (before.tasks === after.tasks) return Object.keys(undo).length ? undo : undefined;
  const oldTasks = new Map(before.tasks.map((value, index) => [value.id, { exists: true, value, index }]));
  const nextTasks = new Map(after.tasks.map((value, index) => [value.id, { exists: true, value, index }]));
  const taskChanges = [];
  for (const id of new Set([...oldTasks.keys(), ...nextTasks.keys()])) {
    const old = oldTasks.get(id) ?? { exists: false }, next = nextTasks.get(id) ?? { exists: false };
    // Inserting/removing another row shifts indices without changing this row.
    if (old.exists !== next.exists || old.value !== next.value && JSON.stringify(old.value) !== JSON.stringify(next.value)) taskChanges.push({ id, before: old, after: next });
  }
  if (taskChanges.length) undo.taskChanges = taskChanges;
  return Object.keys(undo).length ? undo : undefined;
}

function undoTarget(state, undoRevision) {
  if (undoRevision !== undefined && (!Number.isSafeInteger(undoRevision) || undoRevision < 1)) fail('undoRevision must be a positive safe integer');
  const target = undoRevision === undefined
    ? state.history.findLast(event => event.undo && event.undoneRevision === undefined && event.type !== 'undo')
    : state.history.find(event => event.revision === undoRevision);
  if (!target) fail(undoRevision === undefined ? 'No reversible command remains to undo' : 'Undo revision is not in the active history');
  if (target.undoneRevision !== undefined) fail('This command has already been undone');
  if (!target.undo || target.type === 'undo') fail('This history entry is not reversible');
  return target;
}

function overlappingUndoPaths(first, second) {
  // These arrays share one exclusivity invariant. A later inverse can restore
  // a chunk to another array even if its current value no longer conflicts.
  if (MEMBER_PROGRESSION_FIELDS.has(first[0]) && MEMBER_PROGRESSION_FIELDS.has(second[0])) return true;
  return first.slice(0, Math.min(first.length, second.length)).every((segment, index) => segment === second[index]);
}

export function taskClaimInvalidatingEvent(event) {
  const command = event.command ?? { type: event.type };
  if (finishLineCommandTypes.includes(command.type)) return false;
  if (groupGoalCommandTypes.includes(command.type)) return false;
  if (['set-rule-review', 'claim-task', 'clear-task-claim', 'prune-task-claims', 'set-preference', 'set-note', 'set-journal',
    'set-sticker', 'add-sticker', 'update-sticker', 'remove-sticker', 'clear-stickers', 'set-chunk-colour', 'rename-chunk-colour'].includes(command.type)) return false;
  if (command.type === 'set-task-status') return Object.hasOwn(command, 'backlogged') || Object.hasOwn(command, 'challengeCompleted');
  // Task availability depends on shared access, progress and presentation rules.
  // Without current calculated evidence, a later gameplay change is uncertain.
  return true;
}

function prepareUndo(state, undoRevision, registry) {
  const target = undoTarget(state, undoRevision);
  const directClaim = ['claim-task', 'clear-task-claim', 'prune-task-claims'].includes(target.type);
  const newerTaskChange = state.history.some(event => event.revision > target.revision && event.type !== 'undo'
    && event.undoneRevision === undefined && taskClaimInvalidatingEvent(event));
  if (directClaim && target.undo.taskClaimChanges?.changes.some(change => change.before.exists) && newerTaskChange) {
    fail('A newer task or map change may have made these dibs inactive; undo that change first');
  }
  const later = state.history.filter(event => event.revision > target.revision && event.undo && event.undoneRevision === undefined && event.type !== 'undo');
  if (later.length) {
    // Old snapshots and rules lack after-value guards. Catalogue inverses may
    // also remove facts used by a later revision's historical member values.
    // Keep these commands on the established latest-command undo path.
    if (!(target.undo.memberChanges || target.undo.taskClaimChanges) || target.undo.members || target.undo.rules || target.undo.tasks || target.undo.taskChanges) fail('Older undo is supported only for guarded personal changes');
    for (const change of target.undo.memberChanges ?? []) for (const event of later) {
      if (event.undo.members?.some(member => member.id === change.id)) fail('A later command changed the same player snapshot');
      const laterChanges = event.undo.memberChanges?.find(member => member.id === change.id)?.changes ?? [];
      if (change.changes.some(patch => laterChanges.some(other => overlappingUndoPaths(patch.path, other.path)))) fail('A later command changed the same saved value');
    }
  }
  const skippedClaimIds = [], claimChanges = [];
  const restoreClaims = directClaim || ['update-task', 'delete-task'].includes(target.type);
  for (const change of target.undo.taskClaimChanges?.changes ?? []) {
    const overlapping = later.some(event => event.undo.taskClaimChanges?.changes.some(other => other.id === change.id));
    if (restoreClaims) {
      if (overlapping) fail('A later command changed the same task claim');
      claimChanges.push(change);
    } else skippedClaimIds.push(change.id);
  }
  // Copy gameplay members, never history, provenance, or the task catalogue.
  // The same preparation supplies both preview eligibility and actual undo.
  const restored = { members: jsonClone(state.members), rules: state.rules, tasks: state.tasks, ...(state.taskClaims !== undefined ? { taskClaims: jsonClone(state.taskClaims) } : {}), ...(state.finishLine !== undefined ? { finishLine: state.finishLine } : {}), ...(state.groupGoals !== undefined ? { groupGoals: state.groupGoals } : {}), ...(state.ruleReviews !== undefined ? { ruleReviews: state.ruleReviews } : {}) };
  if (target.undo.members) for (const member of target.undo.members) restored.members[restored.members.findIndex(candidate => candidate.id === member.id)] = jsonClone(member);
  if (target.undo.memberChanges) for (const change of target.undo.memberChanges) restoreMemberChanges(findMember(restored, change.id), jsonClone(change.changes));
  if (claimChanges.length) restoreTaskClaimChanges(restored, jsonClone({ ...target.undo.taskClaimChanges, changes: claimChanges }));
  if (target.undo.rules) restored.rules = jsonClone(target.undo.rules);
  if (target.undo.finishLineChange) {
    validateFinishLineChange(target.undo.finishLineChange, new Set(state.members.map(member => member.id)));
    restoreFinishLineChange(restored, target.undo.finishLineChange);
  }
  if (target.undo.groupGoalChanges) {
    validateGroupGoalChanges(target.undo.groupGoalChanges, new Set(state.members.map(member => member.id)));
    restoreGroupGoalChanges(restored, target.undo.groupGoalChanges);
  }
  if (target.undo.ruleReviewChange) {
    validateRuleReviewChange(target.undo.ruleReviewChange, registryOrDefault(registry));
    restoreRuleReviewChange(restored, target.undo.ruleReviewChange);
  }
  if (target.undo.tasks) restored.tasks = jsonClone(target.undo.tasks);
  if (target.undo.taskChanges) {
    validateTaskChanges(target.undo.taskChanges, new Set(state.members.map(member => member.id)));
    restoreTaskChanges(restored, jsonClone(target.undo.taskChanges));
  }
  // Check restored cross-field invariants and task references using only the
  // saved rows those members address. All other rows were already validated.
  const rows = indexedTaskRows(restored.tasks), referenced = new Map();
  for (const change of target.undo.taskChanges ?? []) if (change.before.exists) referenced.set(change.id, rows.get(change.id));
  for (const member of restored.members) for (const id of [...member.completedTasks, ...Object.keys(member.taskStatus ?? {}),
    ...Object.keys(member.questProgress ?? {}), ...alternativeTaskIds(member)]) {
    const task = rows.get(id);
    if (!task) fail(`Undo references absent task: ${id}`);
    referenced.set(id, task);
  }
  for (const id of Object.keys(restored.taskClaims ?? {})) {
    const task = rows.get(id) ?? claimTaskRow(state, id); if (!task) fail(`Undo task claim references absent task: ${id}`); referenced.set(id, task);
  }
  validateOwnedState({ schemaVersion: state.schemaVersion, revision: state.revision, rules: restored.rules,
    members: restored.members, tasks: [...referenced.values()], history: [], ...(restored.taskClaims !== undefined ? { taskClaims: restored.taskClaims } : {}) }, registry);
  if (restored.finishLine !== undefined) validateFinishLine(restored.finishLine, new Set(state.members.map(member => member.id)));
  if (restored.groupGoals !== undefined) validateGroupGoals(restored.groupGoals, new Set(state.members.map(member => member.id)));
  return { target, restored, skippedClaimIds };
}

/** Read-only eligibility on an already validated state. No history replay or
 * whole-state clone; commands call the identical preparation before applying. */
export function getUndoEligibility(state, undoRevision, { registry } = {}) {
  try {
    const { target } = prepareUndo(state, undoRevision, registry);
    return { canUndo: true, reason: null, undoRevision: target.revision };
  } catch (error) {
    return { canUndo: false, reason: error.message, ...(undoRevision !== undefined ? { undoRevision } : {}) };
  }
}

export function applyCommand(state, command, { expectedRevision, world, registry, random, now, taskCatalogue, actor, membersStartBanks, xpChoiceCatalogue } = {}) {
  const next = validateState(state, registry);
  return applyCommandCopy(next, command, { expectedRevision, world, registry, random, now, taskCatalogue, actor, membersStartBanks, xpChoiceCatalogue });
}

/** Storage-only capability check, not an eligibility or authorization check. */
export function hasRetainedSparseUndo(state, command) {
  if (command?.type !== 'undo' || command.undoRevision === undefined) return false;
  const undo = state.history.find(event => event.revision === command.undoRevision)?.undo;
  return Boolean((undo?.memberChanges || undo?.taskClaimChanges) && !undo.members && !undo.rules && !undo.tasks && !undo.taskChanges);
}

/** Storage-only command boundary. The caller exclusively owns fully validated
 * input and must isolate hooks/readers from the shared unchanged JSON trees.
 * Public commands, imports and hooks continue to cross full validation. */
export function applyValidatedCommand(state, command, options = {}) {
  const sparseUndo = hasRetainedSparseUndo(state, command);
  if (command?.type === 'undo' && !sparseUndo) return applyCommand(state, command, options);
  // prepareUndo owns the member copy for sparse undo; catalogue, archives and
  // historical inverse values remain read-only shared storage trees.
  const next = { ...state, members: sparseUndo ? state.members : jsonClone(state.members), rules: { ...state.rules }, history: [...state.history] };
  validatedCommandBaselines.set(next, state);
  try { return applyCommandCopy(next, command, options, state); }
  finally { validatedCommandBaselines.delete(next); }
}

function validateCommandGameplay(state, baseline, registry) {
  if (state.ruleReviews !== undefined) validateRuleReviews(state.ruleReviews, registryOrDefault(registry));
  if (state.finishLine !== undefined) validateFinishLine(state.finishLine, new Set(state.members.map(member => member.id)));
  if (state.groupGoals !== undefined) validateGroupGoals(state.groupGoals, new Set(state.members.map(member => member.id)));
  const rows = indexedTaskRows(state.tasks), oldRows = indexedTaskRows(baseline.tasks), referenced = new Map();
  for (const member of state.members) for (const id of [...member.completedTasks, ...Object.keys(member.taskStatus ?? {}),
    ...Object.keys(member.questProgress ?? {}), ...alternativeTaskIds(member)]) {
    const task = rows.get(id);
    if (!task) fail(`Command references absent task: ${id}`);
    referenced.set(id, task);
  }
  if (state.tasks !== baseline.tasks) for (const task of state.tasks) if (task !== oldRows.get(task.id)) referenced.set(task.id, task);
  for (const id of Object.keys(state.taskClaims ?? {})) {
    const task = rows.get(id) ?? claimTaskRow(state, id);
    if (!task) fail(`Command task claim references absent task: ${id}`); referenced.set(id, task);
  }
  const checked = validateOwnedState({ schemaVersion: state.schemaVersion, revision: state.revision, rules: state.rules,
    members: state.members, tasks: [...referenced.values()], history: [], ...(state.taskClaims !== undefined ? { taskClaims: state.taskClaims } : {}) }, registry);
  const diagnostics = [...(checked.provenance?.taskRuleDiagnostics ?? []),
    ...(baseline.provenance?.taskRuleDiagnostics ?? []).filter(item => item.sourceMapId !== undefined)];
  if (JSON.stringify(diagnostics) !== JSON.stringify(baseline.provenance?.taskRuleDiagnostics ?? [])) {
    state.provenance = { ...state.provenance };
    if (diagnostics.length) state.provenance.taskRuleDiagnostics = diagnostics;
    else delete state.provenance.taskRuleDiagnostics;
  }
  // Removed rows remain available only to validate the inverse's historical
  // references. They never mask a dangling reference in current gameplay.
  for (const member of baseline.members) for (const id of [...member.completedTasks, ...Object.keys(member.taskStatus ?? {}),
    ...Object.keys(member.questProgress ?? {}), ...alternativeTaskIds(member)]) if (!referenced.has(id)) referenced.set(id, oldRows.get(id));
  for (const id of Object.keys(baseline.taskClaims ?? {})) if (!referenced.has(id)) referenced.set(id, oldRows.get(id) ?? claimTaskRow(baseline, id));
  return referenced;
}

function applyCommandCopy(next, command, { expectedRevision, world, registry, random, now, taskCatalogue, actor, membersStartBanks, xpChoiceCatalogue } = {}, baseline) {
  const attribution = actor === undefined ? undefined : validateHistoryActor(actor);
  // Commands replace/add/remove catalogue rows; they do not mutate old rows.
  const before = baseline ? { members: baseline.members, rules: baseline.rules, tasks: baseline.tasks, taskClaims: baseline.taskClaims, finishLine: baseline.finishLine, groupGoals: baseline.groupGoals, ruleReviews: baseline.ruleReviews }
    : { members: jsonClone(next.members), rules: jsonClone(next.rules), tasks: [...next.tasks], taskClaims: next.taskClaims, finishLine: next.finishLine, groupGoals: next.groupGoals, ruleReviews: next.ruleReviews };
  record(command, 'command');
  const payload = jsonClone(command);
  if (!COMMAND_KEYS.has(payload.type)) fail(`Unknown command type: ${payload.type}`);
  knownKeys(payload, COMMAND_KEYS.get(payload.type), 'command');
  if (typeof payload.taskId === 'string') {
    const requestedTaskId = payload.taskId;
    payload.taskId = resolveSavedTaskId(next.identityRegistry, requestedTaskId, payload.category);
    if (payload.taskId === requestedTaskId && !(baseline ? indexedTaskRows(next.tasks).has(requestedTaskId) : next.tasks.some(task => task.id === requestedTaskId))
      && !(taskCatalogue instanceof Map && taskCatalogue.has(requestedTaskId))) {
      const candidates = taskCatalogue instanceof Map ? [...taskCatalogue.values()] : Array.isArray(taskCatalogue) ? taskCatalogue : [];
      const targets = [...new Set(candidates.filter(task => task.aliases?.includes(requestedTaskId) && (payload.category === undefined || task.category === payload.category)).map(task => task.id))];
      if (targets.length === 1) payload.taskId = targets[0];
    }
    if (requestedTaskId !== payload.taskId) payload.requestedTaskId = requestedTaskId;
  }
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) fail('expectedRevision must be a nonnegative safe integer');
  if (expectedRevision !== undefined && expectedRevision !== next.revision) fail(`Revision conflict: expected ${expectedRevision}, found ${next.revision}`);
  if (next.revision === Number.MAX_SAFE_INTEGER) fail('State revision limit reached');
  if (payload.taskId) {
    const task = indexedTaskRows(next.tasks).get(payload.taskId);
    if (task) payload.taskLabel = task.label;
  }
  let commandAt;
  switch (payload.type) {
    case 'add-group-goal':
    case 'update-group-goal':
    case 'move-group-goal':
    case 'set-group-goal-done':
    case 'remove-group-goal':
      applyGroupGoalCommand(next, payload);
      break;
    case 'set-finish-line-item': {
      const { type, itemId, ...fields } = payload;
      validateFinishLineOverride(fields, itemId);
      const line = next.finishLine ?? { items: {}, customItems: [] };
      if (itemId.startsWith('finish:')) {
        const item = line.customItems.find(row => row.id === itemId);
        if (!item) fail('Unknown custom finish line item');
        payload.itemText = item.text;
        payload.itemLabel = item.text;
      } else if (itemId.startsWith('skill:')) payload.itemLabel = itemId.slice(6);
      else if (itemId.startsWith('gear:')) payload.itemLabel = `${itemId.slice(5)} gear`;
      else {
        const taskId = itemId.slice(itemId.indexOf(':') + 1);
        const task = indexedTaskRows(next.tasks).get(taskId) ?? next.identityRegistry?.entries?.[taskId] ?? lookupPermanentId(taskId);
        if (task?.label) payload.itemLabel = decodeLegacyText(task.label).replace(/~\|([^|]+)\|~/g, (_, label) => label.split('#')[0]).replace(/\*+$/g, '').trim();
      }
      next.finishLine = { ...line, items: { ...line.items, [itemId]: { ...line.items[itemId], ...fields } } };
      break;
    }
    case 'add-finish-line-custom': {
      validateFinishLineItemId(payload.itemId, { custom: true }); validateFinishLineText(payload.text);
      payload.itemLabel = payload.text;
      const line = next.finishLine ?? { items: {}, customItems: [] };
      if (line.customItems.some(item => item.id === payload.itemId)) fail('Duplicate finish line custom item ID');
      if (line.customItems.length >= MAX_FINISH_LINE_CUSTOM_ITEMS) fail('Too many finish line custom items');
      next.finishLine = { ...line, customItems: [...line.customItems, { id: payload.itemId, text: payload.text, completedBy: [] }] };
      break;
    }
    case 'set-finish-line-custom':
    case 'delete-finish-line-custom': {
      validateFinishLineItemId(payload.itemId, { custom: true });
      const line = next.finishLine, item = line?.customItems.find(row => row.id === payload.itemId);
      if (!item) fail('Unknown custom finish line item');
      payload.itemText = item.text;
      payload.itemLabel = item.text;
      if (payload.type === 'delete-finish-line-custom') {
        const items = { ...line.items }; delete items[item.id];
        next.finishLine = { ...line, items, customItems: line.customItems.filter(row => row.id !== item.id) };
      }
      else {
        findMember(next, payload.memberId);
        if (typeof payload.completed !== 'boolean') fail('Finish line completed must be boolean');
        const completedBy = new Set(item.completedBy);
        if (payload.completed) completedBy.add(payload.memberId); else completedBy.delete(payload.memberId);
        next.finishLine = { ...line, customItems: line.customItems.map(row => row.id === item.id ? { ...item, completedBy: [...completedBy] } : row) };
      }
      break;
    }
    case 'claim-task': {
      findMember(next, payload.memberId);
      propertyKey(payload.taskId, 'taskId');
      const row = claimTaskRow(next, payload.taskId);
      if (!row) fail(`Unknown task: ${payload.taskId}`);
      const assignment = indexedTaskRows(next.tasks).get(row.id)?.memberIds;
      if (assignment && !assignment.includes(payload.memberId)) fail('Task is assigned to another member');
      payload.taskId = row.id;
      if (Object.hasOwn(payload, 'takeover') && typeof payload.takeover !== 'boolean') fail('takeover must be boolean');
      const existing = next.taskClaims?.[payload.taskId];
      if (existing?.memberId === payload.memberId) fail('Task is already claimed by this member');
      if (existing && payload.takeover !== true) fail('Task is already claimed; confirm takeover');
      if (existing) payload.previousMemberId = existing.memberId;
      payload.taskLabel = row.label;
      const facts = completionClaimFacts(next, payload.memberId, registry, taskCatalogue, [row.id]);
      if (facts.get(payload.taskId).group) fail('Completed tasks cannot be claimed');
      commandAt = timestamp(now);
      next.taskClaims = { ...(next.taskClaims ?? {}), [payload.taskId]: { memberId: payload.memberId, at: commandAt } };
      break;
    }
    case 'clear-task-claim': {
      findMember(next, payload.memberId); propertyKey(payload.taskId, 'taskId');
      const row = claimTaskRow(next, payload.taskId);
      if (row) payload.taskId = row.id;
      const existing = next.taskClaims?.[payload.taskId];
      if (!existing) fail('Task has no claim to release');
      payload.taskLabel = row?.label ?? payload.taskId;
      if (existing.memberId !== payload.memberId) fail('Only the claiming member can release this task claim');
      next.taskClaims = { ...next.taskClaims }; delete next.taskClaims[payload.taskId];
      break;
    }
    case 'prune-task-claims': {
      uniqueStrings(payload.taskIds, 'inactive task claim IDs', propertyKey);
      if (!payload.taskIds.length) fail('No inactive task claims to release');
      next.taskClaims = { ...(next.taskClaims ?? {}) };
      for (const id of payload.taskIds) {
        if (!Object.hasOwn(next.taskClaims, id)) fail('Inactive task claim no longer exists');
        delete next.taskClaims[id];
      }
      break;
    }
    case 'set-teleport-override': {
      string(payload.routeId, 'routeId');
      if (!transportRouteById.has(payload.routeId)) fail(`Unknown transport route: ${payload.routeId}`);
      if (payload.value !== null && typeof payload.value !== 'boolean') fail('Teleport override must be true, false or null');
      const member = findMember(next, payload.memberId);
      if (payload.value === null) {
        if (member.teleportOverrides) delete member.teleportOverrides[payload.routeId];
        if (member.teleportOverrides && !Object.keys(member.teleportOverrides).length) delete member.teleportOverrides;
      } else member.teleportOverrides = { ...member.teleportOverrides, [payload.routeId]: payload.value };
      break;
    }
    case 'set-transport-facts': {
      validateTransportFacts(payload.facts);
      findMember(next, payload.memberId).transportFacts = payload.facts;
      break;
    }
    case 'sync-original': {
      originalSyncTimestamp(payload.capturedAt, 'Original sync capturedAt');
      originalSyncHash(payload.sourceHash);
      if (!Array.isArray(payload.members) || !payload.members.length) fail('Original sync members must be a nonempty array');
      const memberIds = new Set(), prepared = [], f2pValues = new Set();
      for (const target of payload.members) {
        record(target, 'Original sync member');
        string(target.memberId, 'Original sync memberId');
        if (memberIds.has(target.memberId)) fail(`Duplicate Original sync member: ${target.memberId}`);
        memberIds.add(target.memberId);
        const member = findMember(next, target.memberId), sourceMapId = originalSyncSource(target.sourceMapId);
        if (typeof member.sourceMapId !== 'string' || member.sourceMapId.toLowerCase() !== sourceMapId) fail(`Original sync source map ${target.sourceMapId} does not match member ${member.id}'s current sourceMapId binding`);
        originalSyncGroups(target.groups);
        const fields = target.groups.map(group => ORIGINAL_SYNC_FIELDS.get(group));
        knownKeys(target, new Set(['memberId', 'sourceMapId', 'groups', ...fields]), 'Original sync member');
        const updated = { ...member };
        for (const field of fields) {
          if (field === 'taskRules') {
            dictionary(target.taskRules, 'Original sync taskRules', (value, id) => validateTaskRule(id, value));
            updated.taskRules = { ...(member.taskRules ?? {}), ...target.taskRules };
            if (Object.hasOwn(target.taskRules, 'F2P')) f2pValues.add(target.taskRules.F2P);
          } else if (field === 'tasks') {
            record(target.tasks, 'Original sync tasks');
            knownKeys(target.tasks, new Set(['complete', 'backlog']), 'Original sync tasks');
            uniqueStrings(target.tasks.complete, 'Original sync complete tasks', propertyKey);
            if (!Array.isArray(target.tasks.backlog)) fail('Original sync backlog must be an array');
            const backloggedIds = new Set();
            for (const entry of target.tasks.backlog) {
              record(entry, 'Original sync backlog entry');
              knownKeys(entry, new Set(['taskId', 'reason']), 'Original sync backlog entry');
              propertyKey(entry.taskId, 'Original sync backlog taskId'); text(entry.reason, 'Original sync backlog reason');
              if (backloggedIds.has(entry.taskId)) fail('Original sync backlog contains duplicate tasks');
              backloggedIds.add(entry.taskId);
            }
            // IDs and reasons come from the server's reviewed token. Metadata
            // can only come from saved rows or the trusted task catalogue.
            for (const id of new Set([...target.tasks.complete, ...backloggedIds])) registerCatalogueTask(next, id, taskCatalogue);
            updated.taskStatus = jsonClone(member.taskStatus ?? {});
            for (const id of target.tasks.complete) updated.taskStatus[id] = { ...(updated.taskStatus[id] ?? {}), challengeCompleted: true };
            for (const { taskId, reason } of target.tasks.backlog) {
              const status = updated.taskStatus[taskId] ?? {};
              // The reason lands in the backlog reason; an existing local reason is kept.
              updated.taskStatus[taskId] = { ...status, backlogged: true,
                ...(!status.backlogReason && reason ? { backlogReason: reason } : {}) };
            }
          } else {
            uniqueStrings(target[field], `Original sync ${field}`, chunk);
            if (field === 'pendingRoll' && target[field].length > 2) fail('Original sync has more than two pending roll choices');
            if (world) for (const id of target[field]) knownDestination(world, id);
            updated[field] = target[field];
          }
        }
        const progression = [...updated.unlocked, ...updated.selected, ...updated.pendingRoll];
        if (new Set(progression).size !== progression.length) fail(`Original sync for member ${member.id} would overlap unlocked, selected or pending roll chunks. Select the chunks, selections and pendingRoll groups together to resolve the conflict.`);
        target.sourceMapId = sourceMapId;
        prepared.push({ member, updated, target });
      }
      if (f2pValues.size > 1) fail('Original sync F2P rules disagree between selected members. F2P is shared and affects both players; sync matching F2P rules together.');
      // Complete validation of every member before applying any chosen group.
      commandAt = timestamp(now);
      for (const { member, updated, target } of prepared) {
        Object.assign(member, updated);
        member.originalPickerSync = { sourceMapId: target.sourceMapId, capturedAt: payload.capturedAt,
          appliedAt: commandAt, sourceHash: payload.sourceHash, groups: target.groups };
      }
      if (f2pValues.size) next.rules = { ...next.rules, 'content.f2p': [...f2pValues][0] };
      break;
    }
    case 'set-rule-review':
      validateRuleReviewId(payload.ruleId, registryOrDefault(registry));
      if (typeof payload.reviewed !== 'boolean') fail('Rule review reviewed must be boolean');
      payload.note = normalizeRuleReviewNote(payload.note);
      next.ruleReviews = { ...next.ruleReviews, [payload.ruleId]: { reviewed: payload.reviewed, note: payload.note } };
      break;
    case 'set-rule':
      string(payload.ruleId, 'ruleId');
      next.rules = { ...next.rules, [payload.ruleId]: payload.value };
      registryOrDefault(registry).resolve(next.rules);
      break;
    case 'set-profile': {
      record(payload.rules, 'profile rules');
      registryOrDefault(registry).resolve(payload.rules);
      const member = payload.memberId === undefined ? null : findMember(next, payload.memberId);
      if (Object.hasOwn(payload, 'taskRules')) {
        if (!member) fail('Profile taskRules require a memberId');
        dictionary(payload.taskRules, 'profile taskRules', (value, id) => validateTaskRule(id, value));
        member.taskRules = payload.taskRules;
      }
      next.rules = payload.rules;
      break;
    }
    case 'set-teleport': {
      const member = findMember(next, payload.memberId);
      record(payload.teleport, 'teleport');
      const index = member.teleports.findIndex(item => item.id === payload.teleport.id);
      if (index < 0) member.teleports.push(payload.teleport);
      else member.teleports[index] = payload.teleport;
      break;
    }
    case 'delete-teleport': {
      const member = findMember(next, payload.memberId);
      string(payload.teleportId, 'teleportId');
      if (!member.teleports.some(teleport => teleport.id === payload.teleportId)) fail(`Unknown teleport: ${payload.teleportId}`);
      member.teleports = member.teleports.filter(teleport => teleport.id !== payload.teleportId);
      break;
    }
    case 'set-chunk': {
      const member = findMember(next, payload.memberId);
      chunk(payload.chunkId, 'chunkId');
      if (!['unlocked', 'selected', 'blacklisted', 'locked'].includes(payload.status)) fail('Chunk status must be unlocked, selected, blacklisted or locked');
      if (member.pendingRoll.includes(payload.chunkId)) fail('Resolve or cancel the pending roll before editing its choices');
      const existing = ['unlocked', 'selected', 'blacklisted'].some(field => member[field].includes(payload.chunkId));
      if (payload.status !== 'locked' || !existing) knownDestination(world, payload.chunkId);
      for (const field of ['unlocked', 'selected', 'blacklisted']) member[field] = member[field].filter(id => id !== payload.chunkId);
      if (payload.status !== 'locked') member[payload.status].push(payload.chunkId);
      break;
    }
    case 'set-journal': {
      const member = findMember(next, payload.memberId);
      journalText(payload.note, 'journal');
      if (payload.note) member.journal = payload.note;
      else delete member.journal;
      break;
    }
    case 'set-note': {
      const member = findMember(next, payload.memberId);
      chunk(payload.chunkId, 'chunkId'); text(payload.note, 'note');
      knownDestination(world, payload.chunkId);
      member.notes = { ...(member.notes ?? {}) };
      if (payload.note) member.notes[payload.chunkId] = payload.note;
      else delete member.notes[payload.chunkId];
      break;
    }
    case 'add-task':
      record(payload.task, 'task');
      validateTask(payload.task, new Set(next.members.map(member => member.id)));
      if (baseline ? indexedTaskRows(next.tasks).has(payload.task.id) : next.tasks.some(task => task.id === payload.task.id)) fail(`Task already exists: ${payload.task.id}`);
      writableCommandTasks(next);
      next.tasks.push(payload.task);
      validatedTaskRows.get(next.tasks)?.set(payload.task.id, payload.task);
      break;
    case 'update-task': {
      const old = customTask(next, payload.taskId);
      record(payload.task, 'custom task');
      knownKeys(payload.task, new Set(['label', 'skill', 'level', 'memberIds']), 'custom task');
      const updated = { id: old.id, ...payload.task, category: payload.task.skill ?? (old.skill === undefined ? old.category : 'Custom'),
        ...(old.completionIds !== undefined ? { completionIds: old.completionIds } : {}) };
      validateTask(updated, new Set(next.members.map(member => member.id)));
      next.tasks = next.tasks.map(task => task.id === old.id ? updated : task);
      payload.taskLabel = updated.label;
      if (old.category !== updated.category) clearCustomTaskAlternatives(next, old.id);
      const claim = next.taskClaims?.[old.id];
      if (claim && updated.memberIds && !updated.memberIds.includes(claim.memberId)) {
        next.taskClaims = { ...next.taskClaims }; delete next.taskClaims[old.id];
      }
      break;
    }
    case 'delete-task': {
      const old = customTask(next, payload.taskId);
      next.tasks = next.tasks.filter(task => task.id !== old.id);
      for (const member of next.members) {
        member.completedTasks = member.completedTasks.filter(id => id !== old.id);
        if (member.taskStatus) delete member.taskStatus[old.id];
        if (member.questProgress) delete member.questProgress[old.id];
      }
      clearCustomTaskAlternatives(next, old.id);
      if (next.taskClaims?.[old.id]) { next.taskClaims = { ...next.taskClaims }; delete next.taskClaims[old.id]; }
      break;
    }
    case 'clear-challenge-ticks': {
      // Remove one player's challenge ticks in bulk (e.g. ticks that were really the partner's); one undoable change.
      const member = findMember(next, payload.memberId);
      if (!Array.isArray(payload.taskIds) || !payload.taskIds.length || payload.taskIds.length > 5000) fail('List the tasks to untick');
      if (payload.reason !== undefined) { text(payload.reason, 'reason'); if (payload.reason.length > 200) fail('Reason must be at most 200 characters'); }
      const ids = [...new Set(payload.taskIds)].filter(id => member.taskStatus?.[id]?.challengeCompleted);
      if (!ids.length) fail('None of those tasks are ticked');
      member.taskStatus = { ...member.taskStatus };
      for (const id of ids) member.taskStatus[id] = { ...member.taskStatus[id], challengeCompleted: false };
      payload.taskIds = ids; payload.cleared = ids.length;
      break;
    }
    case 'tick-active-tasks':
      applyTickActiveTasks(findMember(next, payload.memberId), payload, id => registerCatalogueTask(next, id, taskCatalogue));
      break;
    case 'clear-backlog': {
      // Restore saved statuses, even for tasks absent from the current calculated catalogue.
      const member = findMember(next, payload.memberId);
      let ids;
      if (Object.hasOwn(payload, 'taskIds')) {
        if (!Array.isArray(payload.taskIds) || !payload.taskIds.length) fail('List backlogged tasks to restore');
        uniqueStrings(payload.taskIds, 'backlog task IDs', propertyKey);
        ids = payload.taskIds;
        for (const id of ids) if (!member.taskStatus?.[id]?.backlogged) fail(`Task is no longer backlogged: ${id}`);
      } else ids = Object.entries(member.taskStatus ?? {}).filter(([, status]) => status.backlogged).map(([id]) => id);
      if (!ids.length) fail('Nothing is backlogged');
      member.taskStatus = { ...member.taskStatus };
      for (const id of ids) {
        const { backlogReason, ...rest } = member.taskStatus[id];
        member.taskStatus[id] = { ...rest, backlogged: false };
      }
      payload.restored = ids.length;
      break;
    }
    case 'set-task-status': {
      const member = findMember(next, payload.memberId);
      registerCatalogueTask(next, payload.taskId, taskCatalogue);
      const fields = ['backlogged', 'backlogReason', 'favorite', 'note', 'challengeCompleted'].filter(field => Object.hasOwn(payload, field));
      if (Object.hasOwn(payload, 'backlogReason')) { text(payload.backlogReason, 'backlog reason'); if (payload.backlogReason.length > 500) fail('Backlog reason must be at most 500 characters'); }
      if (!fields.length) fail('Task status needs at least one field');
      member.taskStatus = { ...(member.taskStatus ?? {}), [payload.taskId]: { ...(member.taskStatus?.[payload.taskId] ?? {}), ...Object.fromEntries(fields.map(field => [field, payload[field]])) } };
      break;
    }
    case 'set-task-rule': {
      const member = findMember(next, payload.memberId);
      propertyKey(payload.ruleId, 'ruleId'); validateTaskRule(payload.ruleId, payload.value);
      member.taskRules = { ...(member.taskRules ?? {}), [payload.ruleId]: payload.value };
      break;
    }
    case 'set-preference': {
      const member = findMember(next, payload.memberId);
      validatePreference(payload.preferenceId, payload.value);
      if (payload.preferenceId === 'startingChunk' && payload.value && world) knownDestination(world, payload.value);
      member.preferences = { ...(member.preferences ?? {}), [payload.preferenceId]: payload.value };
      break;
    }
    case 'reset-task-rule': {
      const member = findMember(next, payload.memberId);
      propertyKey(payload.ruleId, 'ruleId');
      if (member.taskRules) delete member.taskRules[payload.ruleId];
      break;
    }
    case 'set-xp-choices': {
      const member = findMember(next, payload.memberId);
      const reward = xpChoiceCatalogue instanceof Map ? xpChoiceCatalogue.get(payload.taskId) : xpChoiceCatalogue?.find(task => task.id === payload.taskId);
      if (!reward) fail('Unknown choosable XP reward');
      validateXpChoices(reward, payload.choices, { f2p: next.rules['content.f2p'] ?? true });
      registerCatalogueTask(next, payload.taskId, taskCatalogue);
      payload.taskLabel = reward.label;
      member.xpChoices = { ...member.xpChoices, [payload.taskId]: payload.choices };
      break;
    }
    case 'set-task-alternative': {
      const member = findMember(next, payload.memberId);
      propertyKey(payload.category, 'category'); propertyKey(payload.group, 'group');
      if (payload.taskId !== null) registerCatalogueTask(next, payload.taskId, taskCatalogue);
      validateTaskAlternative(payload.category, payload.group, payload.taskId, baseline ? indexedTaskRows(next.tasks) : new Map(next.tasks.map(task => [task.id, task])));
      member.taskAlternatives = { ...(member.taskAlternatives ?? {}), [payload.category]: { ...(member.taskAlternatives?.[payload.category] ?? {}), [payload.group]: payload.taskId } };
      break;
    }
    case 'set-primary-override': {
      const member = findMember(next, payload.memberId);
      validateControlSkill(payload.skill);
      if (payload.enabled !== null && typeof payload.enabled !== 'boolean') fail('Primary override enabled must be boolean or null');
      member.primaryOverrides = { ...(member.primaryOverrides ?? {}) };
      if (payload.enabled === null) delete member.primaryOverrides[payload.skill];
      else member.primaryOverrides[payload.skill] = payload.enabled;
      break;
    }
    case 'set-skill-levels': {
      const member = findMember(next, payload.memberId);
      validateControlSkill(payload.skill);
      const fields = [['passiveLevel', 'passiveLevels'], ['maxLevel', 'maxLevels']].filter(([field]) => Object.hasOwn(payload, field));
      if (!fields.length) fail('Skill levels require a passiveLevel or maxLevel');
      for (const [field, destination] of fields) {
        if (payload[field] !== null) validateControlLevel(payload[field]);
        member[destination] = { ...(member[destination] ?? {}) };
        if (payload[field] === null) delete member[destination][payload.skill];
        else member[destination][payload.skill] = payload[field];
      }
      break;
    }
    case 'replace-member': {
      // One player's map from a backup; the other player, shared rules and History stay.
      const index = next.members.findIndex(member => member.id === payload.memberId);
      if (index < 0) fail(`Unknown member: ${payload.memberId}`);
      record(payload.member, 'replacement member');
      if (payload.member.id !== payload.memberId) fail('The replacement map belongs to a different player');
      if (payload.source !== undefined && (typeof payload.source !== 'string' || payload.source.length > 120)) fail('Replacement source must be a short label');
      next.members[index] = jsonClone(payload.member);
      // Undo keeps the previous map; History only needs a summary, not a second copy.
      payload.summary = { unlocked: payload.member.unlocked?.length ?? 0, completedTasks: payload.member.completedTasks?.length ?? 0 };
      delete payload.member;
      break;
    }
    case 'set-runescape-name': {
      const member = findMember(next, payload.memberId);
      member.runescapeName = validateRuneScapeName(payload.name);
      payload.name = member.runescapeName;
      break;
    }
    case 'apply-runemetrics': {
      const member = findMember(next, payload.memberId);
      const name = validateRuneScapeName(payload.runescapeName);
      if (!sameRuneScapeName(name, member.runescapeName)) fail('RuneMetrics name does not match the current member account binding');
      validateRuneMetricsTimestamp(payload.fetchedAt);
      if (!Array.isArray(payload.skills) || !Array.isArray(payload.quests)) fail('RuneMetrics skills and quests must be arrays');
      const observedSkills = new Set(), observedQuests = new Set();
      for (const skill of payload.skills) {
        record(skill, 'RuneMetrics skill'); knownKeys(skill, new Set(['skill', 'level', 'xp']), 'RuneMetrics skill');
        validateObservedSkill(skill.skill, skill);
        if (observedSkills.has(skill.skill)) fail(`Duplicate RuneMetrics skill: ${skill.skill}`);
        observedSkills.add(skill.skill);
      }
      const taskRows = new Map(next.tasks.map(task => [task.id, task]));
      const provenance = { source: 'runemetrics', fetchedAt: payload.fetchedAt, runescapeName: member.runescapeName };
      for (const quest of payload.quests) {
        record(quest, 'RuneMetrics quest'); knownKeys(quest, new Set(['taskId', 'title']), 'RuneMetrics quest');
        propertyKey(quest.taskId, 'RuneMetrics quest taskId');
        validateQuestProgress(quest.taskId, { title: quest.title, ...provenance }, taskRows);
        if (observedQuests.has(quest.taskId)) fail(`Duplicate RuneMetrics quest task: ${quest.taskId}`);
        observedQuests.add(quest.taskId);
      }
      // The entire trusted snapshot validates before any personal fact is applied.
      payload.runescapeName = member.runescapeName;
      if (payload.skills.length) member.skillProgress = { ...(member.skillProgress ?? {}), ...Object.fromEntries(payload.skills.map(({ skill, level, xp }) => [skill, { level, xp, ...provenance }])) };
      if (payload.quests.length) {
        member.questProgress = { ...(member.questProgress ?? {}), ...Object.fromEntries(payload.quests.map(({ taskId, title }) => [taskId, { title, ...provenance }])) };
        member.completedTasks = [...new Set([...member.completedTasks, ...observedQuests])];
      }
      member.runeMetricsSync = provenance;
      break;
    }
    case 'set-slayer-lock': {
      const member = findMember(next, payload.memberId);
      validateSlayerLock(payload.lock); member.slayerLock = payload.lock;
      break;
    }
    case 'set-chunk-colour':
    case 'rename-chunk-colour': {
      const member = findMember(next, payload.memberId);
      if (payload.type === 'set-chunk-colour') { chunk(payload.chunkId, 'chunkId'); knownDestination(world, payload.chunkId); }
      applyChunkColourCommand(member, payload);
      break;
    }
    case 'set-sticker':
    case 'add-sticker':
    case 'update-sticker':
    case 'remove-sticker':
    case 'clear-stickers': {
      const member = findMember(next, payload.memberId);
      chunk(payload.chunkId, 'chunkId'); knownDestination(world, payload.chunkId);
      let stickers = resolveMemberStickers(next, member)[payload.chunkId] ?? [];
      if (['add-sticker', 'update-sticker', 'set-sticker'].includes(payload.type)) {
        validateSticker(payload.sticker);
        if (payload.sticker === null && payload.type !== 'set-sticker') fail('Sticker must be an object');
      }
      if (payload.type === 'update-sticker' || payload.type === 'remove-sticker') {
        validateStickerId(payload.stickerId);
        const index = stickers.findIndex(sticker => sticker.id === payload.stickerId);
        if (index < 0) fail(`Unknown sticker ID: ${payload.stickerId}`);
        if (payload.type === 'remove-sticker') stickers = stickers.filter((_, position) => position !== index);
        else stickers[index] = { id: payload.stickerId, ...payload.sticker };
      } else if (payload.type === 'clear-stickers' || payload.sticker === null) stickers = [];
      else {
        if (payload.type === 'add-sticker' && stickers.length >= MAX_STICKERS_PER_CHUNK) fail(`A chunk can have at most ${MAX_STICKERS_PER_CHUNK} stickers`);
        // Revisions never repeat, including after undo or a restored save.
        let id = `sticker-${next.revision + 1}`, suffix = 1;
        while (stickers.some(sticker => sticker.id === id)) id = `sticker-${next.revision + 1}-${suffix++}`;
        payload.stickerId = id;
        const sticker = { id, ...payload.sticker };
        stickers = payload.type === 'set-sticker' ? [sticker] : [...stickers, sticker];
      }
      // An empty list deliberately masks inherited legacy markers.
      member.stickers = { ...(member.stickers ?? {}), [payload.chunkId]: stickers };
      break;
    }
    case 'set-starting-chunk': {
      const member = findMember(next, payload.memberId);
      if (payload.chunkId !== null) { chunk(payload.chunkId, 'chunkId'); knownDestination(world, payload.chunkId); }
      member.preferences = { ...(member.preferences ?? {}), startingChunk: payload.chunkId ?? '' };
      break;
    }
    case 'set-section': {
      const member = findMember(next, payload.memberId);
      section(payload.sectionId, 'sectionId');
      if (payload.accessible !== null && typeof payload.accessible !== 'boolean') fail('Section accessible must be boolean or null');
      member.sectionOverrides = { ...(member.sectionOverrides ?? {}) };
      if (payload.accessible === null) delete member.sectionOverrides[payload.sectionId];
      else member.sectionOverrides[payload.sectionId] = payload.accessible;
      break;
    }
    case 'set-source-backlog': {
      const member = findMember(next, payload.memberId);
      if (!SOURCE_KINDS.has(payload.kind)) fail(`Unknown source backlog kind: ${payload.kind}`);
      string(payload.name, 'source name');
      if (typeof payload.backlogged !== 'boolean') fail('Source backlogged must be boolean');
      // False is a durable override, not deletion: it can unmask legacy backlogs.
      member.sourceBacklogs = { ...(member.sourceBacklogs ?? {}), [payload.kind]: { ...(member.sourceBacklogs?.[payload.kind] ?? {}), [payload.name]: payload.backlogged } };
      break;
    }
    case 'set-area': {
      const member = findMember(next, payload.memberId);
      string(payload.areaId, 'areaId');
      if (payload.accessible !== null && typeof payload.accessible !== 'boolean') fail('Area accessible must be boolean or null');
      member.areaOverrides = { ...(member.areaOverrides ?? {}) };
      if (payload.accessible === null) delete member.areaOverrides[payload.areaId];
      else member.areaOverrides[payload.areaId] = payload.accessible;
      break;
    }
    case 'set-obtained-equipment': {
      const member = findMember(next, payload.memberId);
      string(payload.equipmentName, 'equipmentName');
      if (typeof payload.obtained !== 'boolean') fail('obtained must be boolean');
      member.obtainedEquipment = (member.obtainedEquipment ?? []).filter(name => name !== payload.equipmentName);
      if (payload.obtained) member.obtainedEquipment.push(payload.equipmentName);
      break;
    }
    case 'complete-task': {
      const member = findMember(next, payload.memberId);
      registerCatalogueTask(next, payload.taskId, taskCatalogue);
      if (typeof payload.completed !== 'boolean') fail('completed must be boolean');
      member.completedTasks = member.completedTasks.filter(id => resolveSavedTaskId(next.identityRegistry, id) !== payload.taskId);
      if (payload.completed) member.completedTasks.push(payload.taskId);
      break;
    }
    case 'roll': {
      const member = findMember(next, payload.memberId);
      if (!world) fail('A world is required to roll');
      if (member.pendingRoll.length) fail(`${member.name || member.id} must choose or cancel the pending roll before rolling again`);
      if (payload.count !== 1 && payload.count !== 2) fail('Roll count must be 1 or 2');
      const evaluation = evaluateRollPool(world, next, payload.memberId, registry);
      const pool = evaluation.eligible;
      const picks = sampleRoll(pool, payload.count, random);
      const ids = picks.map(candidate => typeof candidate === 'string' ? candidate : candidate.id ?? candidate.chunkId);
      uniqueStrings(ids, 'rolled chunks', chunk);
      member.selected = member.selected.filter(id => !ids.includes(id));
      if (payload.count === 1) {
        member.unlocked.push(ids[0]); addManualNeighbors(next, member, ids, world, registry);
        clearSelectedAfterUnlock(next, member, registry);
      }
      else member.pendingRoll = ids;
      payload.rolled = ids;
      break;
    }
    case 'pick-for-me':
    case 'unlock-selection': {
      const member = findMember(next, payload.memberId);
      if (payload.type === 'pick-for-me') {
        if (!member.pendingRoll.length) fail('No pending roll to pick from');
        for (const id of member.pendingRoll) knownRollDestination(world, id);
        payload.chunkId = sampleRoll(member.pendingRoll.map(id => ({ id })), 1, random)[0].id;
      }
      chunk(payload.chunkId, 'chunkId');
      if (!member.pendingRoll.includes(payload.chunkId)) fail(`${world?.chunks.get(payload.chunkId)?.name || `Chunk ${payload.chunkId}`} is not a pending roll choice for ${member.name || member.id}`);
      const randomStart = hasRandomStartChoices(next, member);
      if (randomStart && !world) fail('A world is required to unlock random start choices');
      knownRollDestination(world, payload.chunkId);
      member.selected.push(...member.pendingRoll.filter(id => id !== payload.chunkId));
      member.pendingRoll = [];
      member.unlocked.push(payload.chunkId);
      if (!randomStart) addManualNeighbors(next, member, [payload.chunkId], world, registry);
      if (randomStart) seedRandomStartSections(member, [payload.chunkId], world);
      clearSelectedAfterUnlock(next, member, registry);
      break;
    }
    case 'cancel-roll': {
      const member = findMember(next, payload.memberId);
      if (!member.pendingRoll.length) fail('No pending roll to cancel');
      member.selected.push(...member.pendingRoll);
      member.pendingRoll = [];
      break;
    }
    case 'unlock-both': {
      const member = findMember(next, payload.memberId);
      if (member.pendingRoll.length !== 2) fail('Unlock both requires two pending choices');
      const randomStart = hasRandomStartChoices(next, member);
      if (randomStart && !world) fail('A world is required to unlock random start choices');
      const choices = [...member.pendingRoll];
      for (const id of choices) knownRollDestination(world, id);
      member.unlocked.push(...choices); member.pendingRoll = [];
      if (!randomStart) addManualNeighbors(next, member, choices, world, registry);
      if (randomStart) seedRandomStartSections(member, choices, world);
      clearSelectedAfterUnlock(next, member, registry);
      break;
    }
    case 'go-members': {
      if (next.members.length !== 2) fail('Ready for members requires both players in the group');
      if (!world || !membersStartBanks?.version) fail('Members starting banks are unavailable');
      payload.options = normalizeMembersStartOptions(payload.options, next.members.map(member => member.id));
      const pools = membersStartPools(membersStartBanks, next.members, payload.options);
      // The versioned data defines eligibility. Existing blacklist/old map access
      // decisions are retained, but do not remove a deliberately chosen bank pool.
      for (const pool of pools) for (const bank of pool.banks) knownDestination(world, bank.chunkId);
      payload.starts = rollMembersStarts(pools, payload.options.pairing, random);
      payload.bankVersion = membersStartBanks.version;
      commandAt = timestamp(now);
      for (const start of payload.starts) {
        const member = findMember(next, start.memberId);
        member.f2pMap ??= { unlocked: [...member.unlocked], at: commandAt };
        member.unlocked = [start.chunkId];
        member.selected = [];
        member.pendingRoll = [];
        member.preferences = { ...(member.preferences ?? {}), startingChunk: start.chunkId };
        seedRandomStartSections(member, [start.chunkId], world);
      }
      if (payload.options.switchToMembers) next.rules['content.f2p'] = false;
      break;
    }
    case 'random-start': {
      const member = findMember(next, payload.memberId);
      if (member.pendingRoll.length) fail('Resolve or cancel the pending roll before random start');
      const count = Object.hasOwn(payload, 'count') ? payload.count : 1;
      if (count !== 1 && count !== 2) fail('Random start count must be 1 or 2');
      if (!world) fail('A world is required for random start');
      const settings = registryOrDefault(registry).resolve(next.rules);
      const accessible = new Set(member.unlocked);
      const blacklisted = new Set(member.blacklisted);
      const pool = [...(world.surface ?? world.chunks.keys())].filter(id => BASE_CHUNK.test(id) && world.chunks.has(id) && world.walkable.has(id)
        && !world.cacheWalking?.blockedRegions?.has(id) && (!settings['content.f2p'] || world.f2p.has(id)) && !accessible.has(id) && !blacklisted.has(id)).sort().map(id => ({ id }));
      const ids = sampleRoll(pool, count, random).map(choice => choice.id);
      member.selected = member.selected.filter(candidate => !ids.includes(candidate));
      payload.rolled = ids;
      if (count === 2) member.pendingRoll = ids;
      else {
        member.unlocked.push(ids[0]); seedRandomStartSections(member, ids, world);
        clearSelectedAfterUnlock(next, member, registry);
      }
      break;
    }
    case 'unpick': {
      const member = findMember(next, payload.memberId);
      if (member.pendingRoll.length) fail('Resolve or cancel the pending roll before unpick');
      if (!member.unlocked.length) fail('Unpick requires at least one personally unlocked chunk');
      const id = sampleRoll(member.unlocked.map(id => ({ id })), 1, random)[0].id;
      member.unlocked = member.unlocked.filter(candidate => candidate !== id);
      member.selected.push(id);
      payload.unpicked = id;
      break;
    }
    case 'undo': {
      const { target, restored, skippedClaimIds } = prepareUndo(next, payload.undoRevision, registry);
      if (!Object.hasOwn(restored, 'taskClaims')) delete next.taskClaims;
      if (!Object.hasOwn(restored, 'finishLine')) delete next.finishLine;
      if (!Object.hasOwn(restored, 'groupGoals')) delete next.groupGoals;
      if (!Object.hasOwn(restored, 'ruleReviews')) delete next.ruleReviews;
      Object.assign(next, restored);
      if (baseline) next.history[next.history.findIndex(event => event.revision === target.revision)] = { ...target, undoneRevision: next.revision + 1 };
      else target.undoneRevision = next.revision + 1;
      if (skippedClaimIds.length) cancelTaskClaimUndo(next, skippedClaimIds, target.revision);
      payload.undoRevision = target.revision;
      break;
    }
    default: fail(`Unknown command type: ${payload.type}`);
  }
  // Commands that add completion own claim cleanup, including gameplay Undo.
  // Availability changes are
  // reconciled after calculation, without attaching their cleanup to History.
  const completionCommand = payload.type === 'complete-task' || payload.type === 'set-task-status' && Object.hasOwn(payload, 'challengeCompleted')
    || ['apply-runemetrics', 'sync-original', 'replace-member', 'clear-challenge-ticks', TICK_ACTIVE_TASKS, 'undo'].includes(payload.type);
  if (completionCommand && Object.keys(next.taskClaims ?? {}).length) {
    const satisfiedIds = member => new Set([...(member?.completedTasks ?? []),
      ...Object.entries(member?.taskStatus ?? {}).filter(([, status]) => status.challengeCompleted === true).map(([id]) => id)]
      .map(id => resolveSavedTaskId(next.identityRegistry, id)));
    const newlySatisfied = new Set();
    for (const member of next.members) {
      const previous = satisfiedIds(before.members.find(owner => owner.id === member.id));
      for (const id of satisfiedIds(member)) if (!previous.has(id)) newlySatisfied.add(id);
    }
    const factsByMember = new Map(), claims = { ...next.taskClaims };
    const clearedIds = [];
    for (const [id, claim] of Object.entries(claims)) {
      let facts = factsByMember.get(claim.memberId);
      if (!facts) { facts = completionClaimFacts(next, claim.memberId, registry, taskCatalogue); factsByMember.set(claim.memberId, facts); }
      if (facts.family(id).some(taskId => newlySatisfied.has(taskId)) && facts.get(id).group) { delete claims[id]; clearedIds.push(id); }
    }
    next.taskClaims = claims;
    // Undo has no new inverse of its own. Cancel outstanding claim guards that
    // its restored completion invalidated, preserving unrelated History.
    if (payload.type === 'undo' && clearedIds.length) cancelTaskClaimUndo(next, clearedIds);
  }
  // The undo marker is paired with its new event below before final validation.
  // The input history was validated above; the newly changed gameplay has not
  // yet acquired its undo delta, so validate its shape without replaying that
  // temporarily incomplete chain. Final validation includes the entire history.
  const commandTasks = baseline ? validateCommandGameplay(next, baseline, registry) : undefined;
  if (!baseline && payload.type !== 'undo') validateOwnedState({ ...next, history: [] }, registry);
  const at = commandAt ?? timestamp(now);
  if (finishLineCommandTypes.includes(payload.type) && payload.type !== 'set-finish-line-custom') payload.affectedMemberIds = next.members.map(member => member.id);
  next.revision++;
  const undo = payload.type === 'undo' ? undefined : undoChanges(before, next);
  if (baseline && undo) {
    if (undo.memberChanges) {
      const beforeRows = new Map(commandTasks);
      for (const change of undo.taskChanges ?? []) if (change.before.exists) beforeRows.set(change.id, change.before.value);
      for (const change of undo.memberChanges) validateMemberChanges(change, beforeRows, new Set(next.members.map(member => member.id)), commandTasks);
    }
    if (undo.taskChanges) validateTaskChanges(undo.taskChanges, new Set(next.members.map(member => member.id)));
    if (undo.taskClaimChanges) validateTaskClaimChanges(undo.taskClaimChanges, commandTasks, new Set(next.members.map(member => member.id)));
    if (undo.finishLineChange) validateFinishLineChange(undo.finishLineChange, new Set(next.members.map(member => member.id)));
    if (undo.groupGoalChanges) validateGroupGoalChanges(undo.groupGoalChanges, new Set(next.members.map(member => member.id)));
    if (undo.ruleReviewChange) validateRuleReviewChange(undo.ruleReviewChange, registryOrDefault(registry));
  }
  // After-value guards must not share objects with editable gameplay rows.
  // Clone the new event rather than recopying the complete saved state.
  next.history.push(jsonClone({ id: `revision-${next.revision}`, revision: next.revision, type: payload.type, at, command: payload,
    ...(attribution ? { actor: attribution } : {}), ...(undo ? { undo } : {}) }));
  return baseline ? next : validateOwnedState(next, registry);
}

const CREDENTIAL_KEYS = new Set(['password', 'passwd', 'passphrase', 'pin', 'pin2', 'pin3',
  'pincode', 'pinnumber', 'loginpin', 'securitypin', 'apikey', 'apisecret', 'accesskey',
  'accesstoken', 'refreshtoken', 'authtoken', 'idtoken', 'authkey', 'clientsecret',
  'authorization', 'cookie', 'sessionid', 'credential', 'credentials', 'authentication', 'auth']);
function sensitiveKey(key) { return CREDENTIAL_KEYS.has(key.replace(/[_-]/g, '').toLowerCase()); }
function sanitizeGameplay(value, warnings, path) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeGameplay(item, warnings, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    const output = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveKey(key)) { warnings.push(`Excluded private account information at ${path}.${key}`); continue; }
      output[key] = sanitizeGameplay(item, warnings, `${path}.${key}`);
    }
    return output;
  }
  return value;
}

function legacyChunkIds(value, path, warnings) {
  if (value === undefined || value === null) return [];
  const ids = Array.isArray(value) ? value : Object.keys(value);
  if (!Array.isArray(value)) record(value, path);
  const base = [];
  for (const id of ids) {
    if (typeof id === 'string' && /^\d+-\d+$/.test(id)) { warnings.push(`${path}: subsection ${id} stays only in the saved original-picker copy; it is not added as a whole chunk`); continue; }
    chunk(id, path);
    if (!base.includes(id)) base.push(id);
  }
  return base;
}

export function importLegacyMaps(document, { members, capturedAt, registry } = {}) {
  record(document, 'legacy document');
  record(document.maps, 'legacy maps');
  if (!Array.isArray(members) || !members.length) fail('Legacy import requires explicit map ownership in members');
  const warnings = ['Original-picker task checks, notes and backlogs are kept; they are not added to personal task or quest completions.',
    'Original-picker rules are kept for review; the new group uses its default rules.'];
  for (const key of Object.keys(document)) if (key !== 'maps') warnings.push(`Original export entry ${key} was not kept.`);
  const maps = Object.create(null);
  const memberStates = members.map(owner => {
    record(owner, 'map owner');
    string(owner.mapId, 'owner.mapId');
    const map = document.maps[owner.mapId];
    record(map, `map ${owner.mapId}`);
    record(map.chunks, `map ${owner.mapId}.chunks`);
    if (!Object.hasOwn(maps, owner.mapId)) {
      const gameplay = Object.create(null);
      for (const key of GAMEPLAY_KEYS) if (Object.hasOwn(map, key)) gameplay[key] = sanitizeGameplay(map[key], warnings, `maps.${owner.mapId}.${key}`);
      for (const key of Object.keys(map)) if (!GAMEPLAY_KEYS.has(key)) warnings.push(`${owner.name ?? owner.id}’s original map entry ${key} was not kept.`);
      maps[owner.mapId] = gameplay;
    }
    const journal = typeof map.chunkNotes === 'string' ? decodeLegacyText(map.chunkNotes) : undefined;
    if (journal?.length > MAX_JOURNAL_LENGTH) warnings.push(`${owner.name ?? owner.id}’s original map journal exceeds ${MAX_JOURNAL_LENGTH} characters; it stays in the saved original-picker copy.`);
    return { id: owner.id, name: owner.name, sourceMapId: owner.mapId,
      ...(journal !== undefined && journal.length <= MAX_JOURNAL_LENGTH ? { journal } : {}),
      unlocked: legacyChunkIds(map.chunks.unlocked, `${owner.name ?? owner.id}’s unlocked chunks`, warnings),
      selected: legacyChunkIds(map.chunks.selected, `${owner.name ?? owner.id}’s selected chunks`, warnings),
      pendingRoll: legacyChunkIds(map.chunks.potential, `${owner.name ?? owner.id}’s pending roll choices`, warnings),
      blacklisted: legacyChunkIds(map.chunks.blacklisted, `${owner.name ?? owner.id}’s blacklisted chunks`, warnings),
      completedTasks: [], teleports: [] };
  });
  const state = createGroupState(memberStates, registry);
  const neighborOptions = members.map(owner => document.maps[owner.mapId].settings?.chunkNeighboursOptions);
  if (neighborOptions.every(options => options && ['neighbors', 'walkableRollable', 'autoWalkableRollable'].every(key => typeof options[key] === 'boolean') &&
    (!Object.hasOwn(options, 'remove') || typeof options.remove === 'boolean'))) {
    // The retained original default for an absent `remove` option is false.
    const resolved = neighborOptions.map(options => ({ 'roll.neighborMode': options.autoWalkableRollable ? 'accessible' : 'manual', 'roll.adjacent': options.neighbors, 'roll.walkable': options.walkableRollable, 'roll.clearSelected': options.remove === true }));
    if (resolved.every(options => JSON.stringify(options) === JSON.stringify(resolved[0]))) {
      state.rules = resolved[0];
      warnings.push('Both players’ matching choices for adding nearby roll candidates are now used by the shared rules.');
    } else warnings.push('Saved choices for adding nearby roll candidates differ between players; defaults remain active. Review how nearby candidates are added and whether selected candidates are cleared before rolling.');
  }
  for (const member of state.members) {
    if (member.pendingRoll.length === 1) warnings.push(`${member.name} has only one pending roll choice; it is kept for review.`);
  }
  state.legacy = { maps };
  state.provenance = { source: 'legacy-public-map-fixture', ...(capturedAt === undefined ? {} : { capturedAt }) };
  const validated = validateState(state, registry);
  warnings.push(...(validated.provenance?.taskRuleDiagnostics ?? []).map(item => `${validated.members.find(member => member.sourceMapId === item.sourceMapId)?.name ?? item.sourceMapId}: ${item.detail}`));
  return { state: validated, warnings };
}
