import { helperTaskLevels } from './helper-task-levels.mjs';

const factKeys = ['id', 'label', 'category', 'status', 'hidden', 'obligation', 'aliases', 'completionGroup', 'completionIds'];
const displayKeys = ['level', 'primary', 'generated', 'equipmentName', 'item', 'rawLabel', 'wiki'];

/** Browser facts always retain identity, scope and completion-family evidence.
 * Hidden rows need display fields only in an explicitly opened planning view. */
export function projectPlayTask(task, { retainHiddenDisplay = false, reuse = true } = {}) {
  let projected;
  if (reuse) {
    projected = {};
    for (const key of factKeys) if (Object.hasOwn(task, key)) projected[key] = task[key];
    if (!task.hidden || retainHiddenDisplay) for (const key of displayKeys) if (Object.hasOwn(task, key)) projected[key] = task[key];
  } else {
    const keys = [...factKeys];
    if (!task.hidden || retainHiddenDisplay) keys.push(...displayKeys);
    projected = Object.fromEntries(keys.filter(key => Object.hasOwn(task, key)).map(key => [key, task[key]]));
  }
  if (!task.hidden || retainHiddenDisplay) { const levels = helperTaskLevels(task); if (Object.keys(levels).length) projected.skillRequirements = levels; }
  if (task.record?.RequirementAlternatives && Number(task.level ?? task.record.Level ?? 1) === 1) delete projected.level;
  if ((!task.hidden || retainHiddenDisplay) && task.blockers?.length) projected.blockers = [{ detail: task.blockers[0].detail }];
  if ((!task.hidden || retainHiddenDisplay) && typeof task.record?.Description === 'string') projected.description = task.record.Description;
  return projected;
}
