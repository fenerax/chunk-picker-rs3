import { equipmentTaskIdentity } from './presentation.mjs';

/** Deduplicated personal obtain evidence, independent of challenge completion. */
export function recordedEquipment(member, definitions = {}) {
  const completed = new Set(member.completedTasks ?? []), manual = new Set(member.obtainedEquipment ?? []);
  return Object.entries(definitions.equipment ?? {}).flatMap(([name, data]) => {
    const taskId = equipmentTaskIdentity(name, data).id;
    const taskCompleted = completed.has(taskId), addedByHand = manual.has(name);
    if (!taskCompleted && !addedByHand) return [];
    return [{ name, slot: data.slot, taskId, taskCompleted, addedByHand,
      provenance: [...(taskCompleted ? ['task'] : []), ...(addedByHand ? ['manual'] : [])],
      evidence: `${taskCompleted ? 'Explicit personal obtain-task completion' : 'Personal obtain record added by hand'}; current possession and equipped slot are unconfirmed.` }];
  });
}
