import { neededForChains, setStanding, taskWarnings } from './task-provenance.mjs';

export const TASK_WHY_DISPLAY_LIMIT = 64 * 1024;

// Project only inputs consumed by explainTask. Keep the same set/dependency
// algorithms and order as a full result. No projection or dependency index is
// retained on the worker snapshot: its existing ledger still owns the baseline.
export function taskWhyDisplay(result, taskId, memberId, stateRevision) {
  const task = result?.tasks?.find(row => row.id === taskId);
  if (!task) return undefined;
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
  const display = {
    format: 'task-why-display-v1', memberId, stateRevision,
    task: { ...pick(task, ['id', 'label', 'category', 'status', 'monster', 'slayerUnlockGate', 'sourcePolicyRejections', 'sourceExclusion']),
      record: pick(task.record, ['Category', 'Label', 'Monsters']), sources: task.sources ?? [] },
    result: { bossGates: result.bossGates ?? [], presentation: {
      suppressed: { [taskId]: result.presentation?.suppressed?.[taskId] ?? [] }, diagnostics: taskWarnings(task, result),
    } },
    related: { set: setStanding(task, result), neededFor: neededForChains(task, { tasks: result.tasks }) },
  };
  // Never truncate an explanation. Oversized evidence uses the full-path fallback.
  return Buffer.byteLength(JSON.stringify(display)) <= TASK_WHY_DISPLAY_LIMIT ? display : undefined;
}
