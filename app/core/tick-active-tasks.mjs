// One player's "Tick all active tasks": a single revision-checked command, so
// one History entry and one Undo cover the whole list.
export const TICK_ACTIVE_TASKS = 'tick-active-tasks';
export const MAX_TICK_ACTIVE_TASKS = 5000;
export const tickActiveTasksKeys = new Set(['type', 'memberId', 'taskIds', 'skipped']);

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
function fail(message) { throw new TypeError(message); }

/** Marks the listed tasks done for one member. `registerTask` registers a
 * catalogue task (and rejects unknown IDs) exactly as a single tick does.
 * Already ticked tasks are left alone; the saved command records what changed. */
export function applyTickActiveTasks(member, payload, registerTask) {
  const ids = payload.taskIds;
  if (!Array.isArray(ids) || !ids.length) fail('List the active tasks to tick');
  if (ids.length > MAX_TICK_ACTIVE_TASKS) fail(`Tick at most ${MAX_TICK_ACTIVE_TASKS} tasks at once`);
  for (const id of ids) if (typeof id !== 'string' || !id.trim() || UNSAFE.has(id)) fail('Task IDs must be nonempty strings');
  if (payload.skipped !== undefined && (!Number.isSafeInteger(payload.skipped) || payload.skipped < 0 || payload.skipped > MAX_TICK_ACTIVE_TASKS)) fail('Skipped must be a small whole number');
  const unique = [...new Set(ids)];
  for (const id of unique) registerTask(id);
  const fresh = unique.filter(id => member.taskStatus?.[id]?.challengeCompleted !== true);
  if (!fresh.length) fail('Those tasks are already ticked');
  member.taskStatus = { ...(member.taskStatus ?? {}) };
  for (const id of fresh) member.taskStatus[id] = { ...(member.taskStatus[id] ?? {}), challengeCompleted: true };
  payload.taskIds = fresh; payload.ticked = fresh.length;
}

/** Server access rule: a player link may only tick, or undo, its own player's list. */
export function tickActiveTasksDenied(identity, command, undoTarget) {
  if (identity.admin) return undefined;
  if (command?.type === TICK_ACTIVE_TASKS && (!identity.memberId || command.memberId !== identity.memberId)) return 'You can only tick your own active tasks.';
  if (command?.type === 'undo' && undoTarget?.type === TICK_ACTIVE_TASKS && (!identity.memberId || undoTarget.command?.memberId !== identity.memberId)) return 'You can only undo your own ticked tasks.';
  return undefined;
}
