/** Retain numeric skill gates in compact task results without the full records.
 * These are task requirements, never observed personal levels or completion.
 */
export function helperTaskLevels(task) {
  const requirements = {};
  for (const field of ['Skills', 'Requirements', 'SkillsNeeded', 'SkillReqs']) {
    for (const [skill, raw] of Object.entries(task.record?.[field] ?? {})) {
      const level = Number(raw);
      if (Number.isSafeInteger(level) && level >= 1 && level <= 120) requirements[skill] = Math.max(requirements[skill] ?? 0, level);
    }
  }
  return requirements;
}
