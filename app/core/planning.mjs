import { applyCommand, validateState, hasRandomStartChoices, seedRandomStartSections } from './state.mjs';
import { createRuleRegistry } from './rules.mjs';

export const RULE_PROFILE_FORMAT = 'rs3-chunk-rule-profile';
export const RULE_PROFILE_VERSION = 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name} must be a plain object.`);
};
const memberOf = (state, memberId) => {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}.`);
  return member;
};
const registryOf = registry => registry ?? createRuleRegistry();
function dataProperties(map) {
  if (Object.getOwnPropertySymbols(map).length) throw new TypeError('Rule profiles cannot contain symbol fields.');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(map))) {
    if (!('value' in descriptor)) throw new TypeError('Rule profiles cannot contain accessors.');
    if (!descriptor.enumerable) throw new TypeError('Rule profiles cannot contain hidden fields.');
  }
}

function profileValue(profile, registry) {
  if (typeof profile === 'string') {
    try { profile = JSON.parse(profile); } catch { throw new TypeError('Rule profile is not valid JSON.'); }
  }
  object(profile, 'Rule profile');
  dataProperties(profile);
  for (const key of Object.keys(profile)) if (!['format', 'schemaVersion', 'rules', 'taskRules'].includes(key)) throw new TypeError(`Unknown rule profile field: ${key}.`);
  if (profile.format !== RULE_PROFILE_FORMAT) throw new TypeError('Unsupported rule profile format.');
  if (profile.schemaVersion !== RULE_PROFILE_VERSION) throw new TypeError('Unsupported rule profile version.');
  object(profile.rules, 'Profile rules');
  dataProperties(profile.rules);
  registry.resolve(profile.rules);
  object(profile.taskRules, 'Profile taskRules');
  dataProperties(profile.taskRules);
  for (const [key, value] of Object.entries(profile.taskRules)) {
    if (!key.trim()) throw new TypeError('Task rule IDs must be nonempty.');
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw new TypeError(`Task rule ${key} must be a JSON primitive.`);
  }
  return { format: RULE_PROFILE_FORMAT, schemaVersion: RULE_PROFILE_VERSION, rules: { ...profile.rules }, taskRules: { ...profile.taskRules } };
}

/** Export only rules, with no progress, history, credentials or map provenance. */
export function exportRuleProfile(state, memberId, registry) {
  const copy = validateState(state, registry);
  const member = memberOf(copy, memberId);
  return { format: RULE_PROFILE_FORMAT, schemaVersion: RULE_PROFILE_VERSION, rules: copy.rules, taskRules: { ...(member.taskRules ?? {}) } };
}

function changes(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compare).filter(id => JSON.stringify(before[id]) !== JSON.stringify(after[id])).map(id => ({
    id, before: Object.hasOwn(before, id) ? before[id] : null, after: Object.hasOwn(after, id) ? after[id] : null,
    kind: !Object.hasOwn(before, id) ? 'added' : !Object.hasOwn(after, id) ? 'removed' : 'changed',
  }));
}

/** Preview replacement semantics: omitted group keys revert to registry defaults. */
export function previewRuleProfile(state, profile, memberId, registry) {
  const rules = registryOf(registry);
  const current = validateState(state, rules);
  const member = memberOf(current, memberId);
  const incoming = profileValue(profile, rules);
  const group = changes(rules.resolve(current.rules), rules.resolve(incoming.rules));
  const personal = changes(member.taskRules ?? {}, incoming.taskRules);
  const warnings = [];
  if (group.length) warnings.push('Group rules change for every member.');
  if (personal.some(change => change.kind === 'removed')) warnings.push('The profile removes personal task-rule overrides that it omits.');
  if (personal.length) warnings.push('Task-rule names are declarative data; unsupported task rules remain subject to engine diagnostics.');
  return { changes: { rules: group, taskRules: personal }, warnings };
}

/** Atomic pure transition: one command, one revision, one undo event, no storage. */
export function applyRuleProfile(state, profile, memberId, options = {}) {
  const registry = registryOf(options.registry);
  const incoming = profileValue(profile, registry);
  return applyCommand(state, { type: 'set-profile', memberId, rules: incoming.rules, taskRules: incoming.taskRules }, { ...options, registry });
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function checkedResult(result) {
  if (!result || !Array.isArray(result.tasks) || !Array.isArray(result.items) || !result.access) throw new TypeError('Prediction engine must return tasks, items and access.');
  return result;
}
const rowsDifference = (before, after, key) => {
  const known = new Set(before.map(row => row[key]));
  return after.filter(row => !known.has(row[key])).sort((a, b) => compare(a[key], b[key]));
};
const stringsDifference = (before = [], after = []) => {
  const known = new Set(before);
  return [...new Set(after)].filter(value => !known.has(value)).sort(compare);
};

/**
 * Evaluate one hypothetical personal unlock. No command/history/revision is
 * created, no persistence is performed, and game completion is never inferred.
 * The injected engine implements evaluate(state, memberId), as createTaskEngine
 * does. Returned state is a deeply frozen independent snapshot.
 */
function predictionInputs(chunkId, { world, engine }) {
  if (typeof chunkId !== 'string' || !/^[1-9]\d*$/.test(chunkId) || !Number.isSafeInteger(Number(chunkId))) throw new TypeError('Prediction chunkId must be a positive safe integer base ID.');
  if (!(world?.chunks instanceof Map) || !world.chunks.has(chunkId) || (world.surface && !world.surface.has(chunkId))) throw new RangeError(`Prediction chunk ${chunkId} is outside the known surface world.`);
  if (typeof engine?.evaluate !== 'function') throw new TypeError('Prediction requires a task engine with evaluate(state, memberId).');
}

/** Reuse one validated, immutable snapshot for a worker's bounded prediction
 * cache. Every candidate still evaluates its complete hypothetical state. */
export function prepareChunkPrediction(state, registry) {
  const baseline = freeze(validateState(state, registry));
  return (memberId, chunkId, options = {}) => {
    predictionInputs(chunkId, options);
    return predictionFromBaseline(baseline, memberId, chunkId, options);
  };
}

export function predictChunk(state, memberId, chunkId, { world, engine, registry } = {}) {
  predictionInputs(chunkId, { world, engine });
  return predictionFromBaseline(freeze(validateState(state, registry)), memberId, chunkId, { world, engine });
}

function predictionFromBaseline(baseline, memberId, chunkId, { engine, world }) {
  memberOf(baseline, memberId);
  const sandbox = { ...baseline, members: baseline.members.map(member => ({ ...member })) };
  const target = memberOf(sandbox, memberId);
  target.unlocked = [...new Set([...target.unlocked, chunkId])];
  target.selected = target.selected.filter(id => id !== chunkId);
  target.blacklisted = target.blacklisted.filter(id => id !== chunkId);
  if (target.pendingRoll.includes(chunkId)) {
    if (hasRandomStartChoices(baseline, target)) seedRandomStartSections(target, [chunkId], world);
    target.selected = [...new Set([...target.selected, ...target.pendingRoll.filter(id => id !== chunkId)])];
    target.pendingRoll = [];
  }
  const originalResult = checkedResult(engine.evaluate(baseline, memberId));
  const result = checkedResult(engine.evaluate(freeze(sandbox), memberId));
  const available = value => value.tasks.filter(task => task.status === 'available' && !task.hidden && task.obligation !== false);
  const beforeTasks = available(originalResult), afterTasks = available(result);
  const beforeById = new Map(originalResult.tasks.map(task => [task.id, task]));
  const delta = {
    tasksAdded: rowsDifference(beforeTasks, afterTasks, 'id'), tasksRemoved: rowsDifference(afterTasks, beforeTasks, 'id'),
    tasksChanged: result.tasks.filter(task => task.obligation !== false && beforeById.has(task.id) && beforeById.get(task.id).status !== task.status).map(task => ({ id: task.id, label: task.label, beforeStatus: beforeById.get(task.id).status, afterStatus: task.status })).sort((a, b) => compare(a.id, b.id)),
    itemsAdded: rowsDifference(originalResult.items, result.items, 'name'), itemsRemoved: rowsDifference(result.items, originalResult.items, 'name'),
    equipmentAdded: rowsDifference((originalResult.equipment ?? []).filter(row => row.obligation !== false), (result.equipment ?? []).filter(row => row.obligation !== false), 'name'), equipmentRemoved: rowsDifference((result.equipment ?? []).filter(row => row.obligation !== false), (originalResult.equipment ?? []).filter(row => row.obligation !== false), 'name'),
    trainingChanged: [...new Set([...Object.keys(originalResult.training ?? {}), ...Object.keys(result.training ?? {})])].sort(compare).filter(skill => JSON.stringify(originalResult.training?.[skill]) !== JSON.stringify(result.training?.[skill])).map(skill => ({ skill, before: originalResult.training?.[skill] ?? null, after: result.training?.[skill] ?? null })),
  };
  for (const key of ['bases', 'sections', 'areas', 'objects', 'npcs', 'monsters', 'shops']) {
    delta[`${key}Added`] = stringsDifference(originalResult.access[key], result.access[key]);
    delta[`${key}Removed`] = stringsDifference(result.access[key], originalResult.access[key]);
  }
  return { state: sandbox, result, delta };
}
