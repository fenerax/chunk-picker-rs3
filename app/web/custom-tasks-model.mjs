import { sameRuneScapeName } from '../core/game-progress.mjs';

export const isCustomTask = task => typeof task?.id === 'string' && (task.id.startsWith('custom:') || task.id.startsWith('rs3:task:custom:'));

// Missing assignment is the original shared-task behavior, including imports.
export const customTaskAssignedTo = (task, memberId) => !task.memberIds || task.memberIds.includes(memberId);

export function customTaskForMember(task, member) {
  if (!isCustomTask(task) || !customTaskAssignedTo(task, member.id)) return null;
  return { ...task, category: task.skill || task.category || 'Custom', status: 'available', blockers: [],
    explanation: 'Custom task. Check any other requirements yourself.' };
}

export function customTaskDoable(task, member) {
  if (!isCustomTask(task) || !task.level) return true;
  const skill = task.skill || task.category;
  const observed = member?.skillProgress?.[skill];
  return observed?.source === 'runemetrics' && sameRuneScapeName(observed.runescapeName, member?.runescapeName)
    && Number.isSafeInteger(observed.level) && observed.level >= task.level;
}

/** Saved rows are authoritative for custom labels, assignments and deletion. */
export function personalCustomTaskRows(tasks, state, member) {
  return [...tasks.filter(task => !isCustomTask(task)), ...(state.tasks ?? []).filter(isCustomTask)
    .map(task => customTaskForMember(task, member)).filter(Boolean)];
}
