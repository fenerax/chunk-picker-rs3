import { lookupPermanentId } from '../tasks/identity.mjs';
import { groupGoalCommandKeys } from './group-goal-types.mjs';
export { groupGoalCommandKeys, groupGoalCommandTypes } from './group-goal-types.mjs';

export const MAX_GROUP_GOALS = 100;
export const MAX_GROUP_GOAL_TEXT = 200;
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new TypeError(message); };
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}
function keys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`Unknown ${path} field: ${key}`);
}
export function validateGroupGoalId(id) {
  if (typeof id !== 'string' || !/^group-goal:[A-Za-z0-9_-]{1,96}$/.test(id) || unsafe.has(id.slice(11))) fail('Group goal ID must be group-goal:<safe identifier>');
}
export function validateGroupGoalText(text) {
  if (typeof text !== 'string' || !text.trim() || text !== text.trim() || text.length > MAX_GROUP_GOAL_TEXT || /[\u0000-\u001f\u007f-\u009f]/.test(text)) fail(`Group goal text must be trimmed printable text of 1 through ${MAX_GROUP_GOAL_TEXT} characters`);
}
function completionMode(value) {
  if (value !== 'players' && value !== 'group') fail('Group goal completion must be players or group');
}
export function validateGroupGoalLink(link) {
  object(link, 'group goal link'); keys(link, new Set(['kind', 'id', 'label']), 'group goal link');
  if (link.kind !== 'task' && link.kind !== 'item') fail('Group goal link kind must be task or item');
  if (typeof link.id !== 'string' || !link.id.trim() || link.id !== link.id.trim() || link.id.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(link.id) || link.id.split(':').some(part => unsafe.has(part))) fail('Invalid group goal link ID');
  if (link.kind === 'item' && !/^rs3:entity:[A-Za-z0-9_-]+$/.test(link.id)) fail('Group goal item link needs a permanent item ID');
  if (typeof link.label !== 'string' || !link.label.trim() || link.label !== link.label.trim() || link.label.length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(link.label)) fail('Group goal link label must be trimmed printable text of 1 through 500 characters');
}
export function validateGroupGoals(value, memberIds) {
  if (!Array.isArray(value) || value.length > MAX_GROUP_GOALS) fail(`groupGoals must be an array of at most ${MAX_GROUP_GOALS} rows`);
  const ids = new Set();
  for (const goal of value) {
    object(goal, 'group goal'); keys(goal, new Set(['id', 'text', 'completion', 'completedBy', 'done', 'link']), 'group goal');
    validateGroupGoalId(goal.id); validateGroupGoalText(goal.text); completionMode(goal.completion);
    if (ids.has(goal.id)) fail('Duplicate group goal ID'); ids.add(goal.id);
    if (!Array.isArray(goal.completedBy) || new Set(goal.completedBy).size !== goal.completedBy.length) fail('Group goal completedBy must contain unique member IDs');
    for (const id of goal.completedBy) if (!memberIds.has(id)) fail('Group goal completion references absent member');
    if (typeof goal.done !== 'boolean') fail('Group goal done must be boolean');
    if (goal.completion === 'group' && goal.completedBy.length) fail('Group completion must have empty completedBy');
    if (goal.completion === 'players' && goal.done !== [...memberIds].every(id => goal.completedBy.includes(id))) fail('Group goal done must match all player checks');
    if (Object.hasOwn(goal, 'link')) validateGroupGoalLink(goal.link);
  }
}

// Links retain their saved label when a catalogue row changes or disappears.
// Only new authored references must address the current catalogue.
function authoredLink(link, state) {
  validateGroupGoalLink(link);
  const known = link.kind === 'task' ? state.tasks.some(task => task.id === link.id) : lookupPermanentId(link.id)?.entityKind === 'item';
  if (!known) fail(`Group goal link references unknown ${link.kind}: ${link.id}`);
  return structuredClone(link);
}
export function applyGroupGoalCommand(state, payload) {
  object(payload, 'command');
  const allowed = groupGoalCommandKeys.get(payload.type);
  if (!allowed) fail(`Unknown group goal command type: ${payload.type}`);
  keys(payload, allowed, 'command'); validateGroupGoalId(payload.goalId);
  const goals = state.groupGoals ?? [], index = goals.findIndex(goal => goal.id === payload.goalId);
  const members = state.members.map(member => member.id);
  let next;
  if (payload.type === 'add-group-goal') {
    if (index !== -1) fail('Duplicate group goal ID');
    if (goals.length >= MAX_GROUP_GOALS) fail('Too many group goals');
    validateGroupGoalText(payload.text); completionMode(payload.completion);
    const goal = { id: payload.goalId, text: payload.text, completion: payload.completion, completedBy: [], done: payload.completion === 'players' && !members.length };
    if (Object.hasOwn(payload, 'link')) goal.link = authoredLink(payload.link, state);
    next = [...goals, goal]; payload.goalText = goal.text;
  } else {
    if (index === -1) fail('Unknown group goal ID');
    const goal = goals[index]; payload.goalText = goal.text;
    next = [...goals];
    if (payload.type === 'update-group-goal') {
      validateGroupGoalText(payload.text); completionMode(payload.completion);
      const updated = { ...goal, text: payload.text, completion: payload.completion };
      if (goal.completion !== payload.completion) updated.completedBy = payload.completion === 'players' && goal.done ? [...members] : [];
      updated.done = updated.completion === 'players' ? members.every(id => updated.completedBy.includes(id)) : goal.done;
      if (Object.hasOwn(payload, 'link')) {
        if (payload.link === null) delete updated.link;
        else if (goal.link && ['kind', 'id', 'label'].every(key => payload.link?.[key] === goal.link[key])) {
          validateGroupGoalLink(payload.link); updated.link = structuredClone(goal.link);
        } else updated.link = authoredLink(payload.link, state);
      }
      next[index] = updated; payload.goalText = updated.text;
    } else if (payload.type === 'move-group-goal') {
      if (!Number.isSafeInteger(payload.index) || payload.index < 0 || payload.index >= goals.length) fail('Group goal index must be a final list index');
      next.splice(index, 1); next.splice(payload.index, 0, goal);
    } else if (payload.type === 'remove-group-goal') next.splice(index, 1);
    else {
      if (typeof payload.done !== 'boolean') fail('Group goal done must be boolean');
      let completedBy = [];
      if (Object.hasOwn(payload, 'memberId')) {
        if (goal.completion !== 'players') fail('Group completion has no per-player check');
        if (!members.includes(payload.memberId)) fail('Group goal completion references absent member');
        const checked = new Set(goal.completedBy);
        if (payload.done) checked.add(payload.memberId); else checked.delete(payload.memberId);
        completedBy = members.filter(id => checked.has(id));
      } else if (goal.completion === 'players' && payload.done) completedBy = [...members];
      next[index] = { ...goal, completedBy, done: goal.completion === 'players' ? members.every(id => completedBy.includes(id)) : payload.done };
    }
  }
  validateGroupGoals(next, new Set(members));
  state.groupGoals = next;
}
export function groupGoalChanges(before, after) {
  if (JSON.stringify(before.groupGoals) === JSON.stringify(after.groupGoals)) return undefined;
  return { before: before.groupGoals === undefined ? { exists: false } : { exists: true, value: before.groupGoals },
    after: after.groupGoals === undefined ? { exists: false } : { exists: true, value: after.groupGoals } };
}
export function validateGroupGoalChanges(change, memberIds) {
  object(change, 'undo group goal changes'); keys(change, new Set(['before', 'after']), 'undo group goal changes');
  for (const side of [change.before, change.after]) {
    object(side, 'undo group goal presence');
    if (typeof side.exists !== 'boolean') fail('Undo group goal presence needs exists');
    keys(side, new Set(side.exists ? ['exists', 'value'] : ['exists']), 'undo group goal presence');
    if (side.exists) validateGroupGoals(side.value, memberIds);
  }
}
export function restoreGroupGoalChanges(state, change) {
  const current = Object.hasOwn(state, 'groupGoals') ? { exists: true, value: state.groupGoals } : { exists: false };
  if (JSON.stringify(current) !== JSON.stringify(change.after)) fail('Stale undo: group goals have changed');
  if (change.before.exists) state.groupGoals = structuredClone(change.before.value);
  else delete state.groupGoals;
}
