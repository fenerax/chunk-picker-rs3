import { taskRuleDefinitions, taskRuleCutoffDefaults, taskRuleValueError } from './data/settings.mjs';
import { projectPlayTask } from './play-view.mjs';
import { createTaskFactsIndex } from './core/progress.mjs';

export const SANDBOX_FORMAT = 'sandbox-v1';
export const SANDBOX_MAX_CHUNKS = 40;
export const SANDBOX_MAX_DONE_TASKS = 500;
export const SANDBOX_MAX_RULES = 128;
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const knownRules = new Set([...taskRuleDefinitions.map(row => row.id), ...Object.keys(taskRuleCutoffDefaults),
  'Skills', 'Quests', 'Quest Complete', 'BIS', 'BIS Prayer', 'Relics', 'Show Nonskill Tasks']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function object(value, name, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name} must be a plain object.`);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${name} contains unsupported fields.`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (unsafe.has(key) || !descriptor.enumerable || !('value' in descriptor) || (keys && !keys.includes(key))) throw new TypeError(`Unsupported ${name} field: ${key}.`);
  }
}
function ids(value, name, limit, validate) {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError(`${name} must be an array of at most ${limit} IDs.`);
  for (const id of value) if (typeof id !== 'string' || !id.trim() || id.length > 256 || unsafe.has(id) || !validate(id)) throw new TypeError(`Invalid ${name} ID.`);
  if (new Set(value).size !== value.length) throw new TypeError(`${name} contains duplicate IDs.`);
  return [...value].sort(compare);
}
export function sandboxTaskCatalogue(state, catalogue = []) {
  return new Map([...catalogue, ...state.tasks].map(row => [row.id, row]));
}

/** Validate and canonicalize the complete draft; never accept saved-state fields. */
export function normalizeSandboxRequest(body, { state, world, catalogue = [], taskIndex }) {
  object(body, 'sandbox request', ['memberId', 'baseRevision', 'changes', 'previewChunkId', 'planningChunkId']);
  if (typeof body.memberId !== 'string' || body.memberId.length > 256 || !state.members.some(row => row.id === body.memberId)) throw new TypeError('Choose a known sandbox member.');
  if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) throw new TypeError('baseRevision must be a nonnegative safe integer.');
  object(body.changes, 'changes', ['unlockChunks', 'lockChunks', 'doneTasks', 'taskRules']);
  const baseChunk = id => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    && world.chunks.has(id) && (!world.surface || world.surface.has(id));
  const values = key => Object.hasOwn(body.changes, key) ? body.changes[key] : [];
  const unlockChunks = ids(values('unlockChunks'), 'unlockChunks', SANDBOX_MAX_CHUNKS, baseChunk);
  const lockChunks = ids(values('lockChunks'), 'lockChunks', SANDBOX_MAX_CHUNKS, baseChunk);
  if (unlockChunks.length + lockChunks.length > SANDBOX_MAX_CHUNKS) throw new TypeError(`A sandbox draft may change at most ${SANDBOX_MAX_CHUNKS} chunks.`);
  if (unlockChunks.some(id => lockChunks.includes(id))) throw new TypeError('A sandbox chunk cannot be both locked and unlocked.');
  const tasks = taskIndex ?? sandboxTaskCatalogue(state, catalogue);
  const doneTasks = ids(values('doneTasks'), 'doneTasks', SANDBOX_MAX_DONE_TASKS, id => tasks.has(id));
  const changes = { unlockChunks, lockChunks, doneTasks };
  if (body.changes.taskRules !== undefined) {
    object(body.changes.taskRules, 'taskRules');
    const entries = Object.entries(body.changes.taskRules).sort(([a], [b]) => compare(a, b));
    if (entries.length > SANDBOX_MAX_RULES) throw new TypeError(`A sandbox draft may change at most ${SANDBOX_MAX_RULES} task rules.`);
    for (const [id, value] of entries) {
      if (!knownRules.has(id)) throw new TypeError(`Unknown sandbox task rule: ${id}.`);
      if (!(value === null || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 256)
        || (typeof value === 'number' && Number.isFinite(value)))) throw new TypeError(`Invalid sandbox task rule: ${id}.`);
      const error = taskRuleValueError(id, value);
      if (error) throw new TypeError(error);
    }
    if (entries.length) changes.taskRules = Object.fromEntries(entries);
  }
  if (body.previewChunkId !== undefined && (typeof body.previewChunkId !== 'string' || !baseChunk(body.previewChunkId))) throw new TypeError('previewChunkId must be an exact known surface chunk ID.');
  if (body.planningChunkId !== undefined && (typeof body.planningChunkId !== 'string' || body.planningChunkId.length > 256
    || !(world.chunks.has(body.planningChunkId) || world.areas?.has(body.planningChunkId)))) throw new TypeError('planningChunkId must be an exact known chunk or area ID.');
  return { memberId: body.memberId, baseRevision: body.baseRevision, changes,
    ...(body.previewChunkId !== undefined ? { previewChunkId: body.previewChunkId } : {}),
    ...(body.planningChunkId !== undefined ? { planningChunkId: body.planningChunkId } : {}) };
}

/** Copy only changed fields. Challenge checks never become game/quest completion. */
export function applySandboxChanges(state, memberId, changes, catalogue = [], taskIndex) {
  const target = state.members.find(member => member.id === memberId);
  if (!target) throw new TypeError('Choose a known sandbox member.');
  const unlocked = new Set([...target.unlocked, ...changes.unlockChunks]);
  for (const id of changes.lockChunks) unlocked.delete(id);
  const changed = new Set([...changes.unlockChunks, ...changes.lockChunks]);
  const pendingChanged = target.pendingRoll.some(id => changed.has(id));
  const selected = [...new Set([...target.selected, ...(pendingChanged ? target.pendingRoll : [])])]
    .filter(id => !changed.has(id) && !unlocked.has(id));
  const taskStatus = { ...target.taskStatus };
  for (const id of changes.doneTasks) taskStatus[id] = { ...taskStatus[id], challengeCompleted: true };
  const member = { ...target, unlocked: [...unlocked], selected,
    blacklisted: target.blacklisted.filter(id => !changed.has(id)),
    pendingRoll: pendingChanged ? [] : target.pendingRoll, taskStatus,
    ...(changes.taskRules ? { taskRules: { ...target.taskRules, ...changes.taskRules } } : {}) };
  const tasks = taskIndex ?? sandboxTaskCatalogue(state, catalogue);
  const present = changes.doneTasks.length ? new Set(state.tasks.map(row => row.id)) : null;
  const extra = changes.doneTasks.filter(id => !present.has(id)).map(id => {
    const row = tasks.get(id);
    if (!row) throw new TypeError('Unknown sandbox task.');
    return { id: row.id, label: row.label, category: row.category };
  });
  return { ...state, members: state.members.map(row => row.id === memberId ? member : row), tasks: extra.length ? [...state.tasks, ...extra] : state.tasks };
}

const difference = (before, after, key) => {
  const known = new Set(before.map(row => row[key]));
  return after.filter(row => !known.has(row[key])).sort((a, b) => compare(a[key], b[key]));
};
const stringsDifference = (before = [], after = []) => [...new Set(after)].filter(id => !before.includes(id)).sort(compare);
export function sandboxDelta(before, after, { beforeState, afterState, memberId, registry } = {}) {
  const active = (result, state) => {
    const rows = new Map((result.presentation?.tasks ?? result.tasks ?? []).map(task => [task.id, task]));
    // The sidebar also shows saved custom goals outside the engine catalogue.
    for (const task of state?.tasks ?? []) if (task.id.startsWith('custom:') && !rows.has(task.id)) {
      rows.set(task.id, result.tasks?.find(row => row.id === task.id) ?? { ...task, status: 'available' });
    }
    const facts = state ? createTaskFactsIndex(state, memberId, registry, { tasks: result.tasks,
      completionGroups: result.collectionPlanning?.completionGroups }) : null;
    const status = state?.members.find(row => row.id === memberId)?.taskStatus ?? {};
    return [...rows.values()]
      .filter(task => task.status === 'available' && !task.hidden && task.obligation !== false
        && !status[task.id]?.backlogged
        && !(facts ? facts.get(task.id, task.completionIds).group : task.challengeSatisfied || task.personalCompleted));
  };
  const beforeTasks = active(before, beforeState), afterTasks = active(after, afterState);
  const delta = {
    tasksAdded: difference(beforeTasks, afterTasks, 'id').map(row => projectPlayTask(row)),
    tasksRemoved: difference(afterTasks, beforeTasks, 'id').map(row => projectPlayTask(row)),
    itemsAdded: difference(before.items ?? [], after.items ?? [], 'name').map(({ name }) => ({ name })),
    itemsRemoved: difference(after.items ?? [], before.items ?? [], 'name').map(({ name }) => ({ name })),
  };
  for (const key of ['bases', 'sections', 'areas', 'objects', 'npcs', 'monsters', 'shops']) {
    delta[`${key}Added`] = stringsDifference(before.access?.[key], after.access?.[key]);
    delta[`${key}Removed`] = stringsDifference(after.access?.[key], before.access?.[key]);
  }
  return delta;
}

/** Keep the established Preview delta shape without copying source graphs. */
export function compactSandboxPrediction(prediction) {
  const delta = { ...prediction.delta };
  for (const key of ['tasksAdded', 'tasksRemoved']) delta[key] = (delta[key] ?? []).map(row => projectPlayTask(row));
  for (const key of ['itemsAdded', 'itemsRemoved', 'equipmentAdded', 'equipmentRemoved']) delta[key] = (delta[key] ?? []).map(({ name }) => ({ name }));
  return { delta, coverage: prediction.result.coverage, metrics: prediction.result.metrics };
}
