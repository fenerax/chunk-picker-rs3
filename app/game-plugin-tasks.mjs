import { selectDuoTasks } from './web/duo-tasks.mjs';

// The game panel is small. Long lists stay in the picker.
export const PLUGIN_TASK_LIMITS = Object.freeze({ all: 100, here: 50, label: 120, category: 40 });
const text = (value, limit) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Rows from one saved play result, in the picker's Active Tasks order.
 * `stale` results came from an older revision: current completions, backlog
 * and status still apply, but new unlocks are missing until the picker reloads. */
export function pluginTaskRows({ state, result, registry, memberId, stale = false }) {
  const results = new Map([[memberId, { ...result, memberId, stateRevision: stale ? null : state.revision }]]);
  const locations = result.taskLocations;
  return selectDuoTasks({ state, results, registry, selectedMemberId: memberId }).rows.map(row => {
    const task = row.tasksByMember[memberId] ?? row.task;
    return { id: row.id, label: text(task.label, PLUGIN_TASK_LIMITS.label), category: text(task.category, PLUGIN_TASK_LIMITS.category),
      ...(Number.isSafeInteger(task.level) && task.level > 0 ? { level: task.level } : {}),
      chunks: locations ? (locations[task.id] ?? []).map(id => String(id).split('-')[0]) : null };
  });
}

/** Response body for GET /api/plugin/v1/tasks. `chunks` stays on the server. */
export function pluginTaskList({ rows, chunkId, stateRevision, stale }) {
  if (!rows) return { v: 1, ready: false, stale: false, stateRevision, chunkId, here: [], all: [], hereCount: 0, allCount: 0, hereKnown: false };
  const strip = ({ chunks, ...row }) => row;
  const hereKnown = chunkId !== null && rows.every(row => row.chunks !== null);
  const here = hereKnown ? rows.filter(row => row.chunks.includes(chunkId)) : [];
  return { v: 1, ready: true, stale, stateRevision, chunkId, hereKnown,
    here: here.slice(0, PLUGIN_TASK_LIMITS.here).map(strip), all: rows.slice(0, PLUGIN_TASK_LIMITS.all).map(strip),
    hereCount: here.length, allCount: rows.length };
}
