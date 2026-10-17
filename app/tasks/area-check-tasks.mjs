import { skillCaps, plainLabel } from './engine.mjs';

// Slayer has training rows too, but its ordinary duties also belong in the
// requested task comparison. All other skill categories stay in the ladders.
const isTask = task => task.category === 'Slayer' || !Object.hasOwn(skillCaps, task.category);
const categoryOrder = category => category === 'Quest' ? 0 : category === 'Diary' ? 1 : 2;

/** Compare ordinary presented lists, never a second model of reachability. */
export function areaTaskDifference(currentTasks, scenarioTasks) {
  const current = new Set(currentTasks.map(task => task.id)), groups = new Map();
  for (const task of scenarioTasks) {
    if (!isTask(task) || current.has(task.id)) continue;
    if (!groups.has(task.category)) groups.set(task.category, new Map());
    groups.get(task.category).set(task.id, { id: task.id, label: plainLabel(task.label), level: task.level ?? 1 });
  }
  const categories = [...groups].sort(([a], [b]) => categoryOrder(a) - categoryOrder(b) || a.localeCompare(b))
    .map(([category, group]) => {
      const tasks = [...group.values()].sort((a, b) => (category === 'Quest' ? 0 : a.level - b.level)
        || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      return { category, count: tasks.length, tasks };
    });
  return { total: categories.reduce((sum, group) => sum + group.count, 0), categories };
}
