import { xpForLevel, levelForXp } from '../core/experience.mjs';
import { combatLevelFromSkills } from '../core/combat-level.mjs';
import { progressBelongsToMember } from '../core/game-progress.mjs';
import { isCustomTask, customTaskAssignedTo } from './custom-tasks-model.mjs';

// The duo is F2P. Include every trainable F2P skill and members skill trial;
// Invention cannot be trained in F2P and has a different XP curve.
export const helperSkills = Object.freeze(['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Prayer', 'Magic',
  'Runecrafting', 'Crafting', 'Mining', 'Smithing', 'Fishing', 'Cooking', 'Firemaking', 'Woodcutting', 'Fletching',
  'Dungeoneering', 'Construction', 'Archaeology', 'Necromancy', 'Agility', 'Herblore', 'Thieving', 'Farming',
  'Hunter', 'Slayer', 'Divination', 'Summoning']);
export { helperTrialCaps } from '../core/f2p-skill-caps.mjs';
import { helperTrialCaps } from '../core/f2p-skill-caps.mjs';
const skills = new Set(helperSkills);
const validLevel = value => Number.isSafeInteger(value) && value >= 1 && value <= 120;
const validXp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Saved observations for the currently named account only. Unknown skills are
 * absent: training ceilings, declarations and challenge checks are not XP. */
export function personalSkillProgress(member) {
  return Object.fromEntries(Object.entries(member?.skillProgress ?? {}).filter(([skill, observation]) => skills.has(skill)
    && progressBelongsToMember(observation, member)
    && validLevel(observation.level) && validXp(observation.xp)).map(([skill, observation]) => [skill, {
    level: observation.level, xp: observation.xp, source: observation.source,
    fetchedAt: observation.fetchedAt ?? null, runescapeName: observation.runescapeName,
  }]));
}

/** Standard XP curve through virtual level 120; excludes Invention. */
export function xpLookup(xp) {
  if (!validXp(xp)) throw new RangeError('XP must be a finite, nonnegative number.');
  const level = levelForXp(xp), levelXp = xpForLevel(level);
  const nextLevel = level < 120 ? level + 1 : null, nextLevelXp = nextLevel ? xpForLevel(nextLevel) : null;
  return { xp, level, levelXp, nextLevel, nextLevelXp,
    xpToNext: nextLevelXp === null ? null : nextLevelXp - xp,
    progress: nextLevelXp === null ? 1 : (xp - levelXp) / (nextLevelXp - levelXp) };
}

/** XP remaining from explicit XP, never a missing observation coerced to zero. */
export function xpGap(fromXp, targetLevel) {
  if (!validXp(fromXp)) throw new RangeError('Starting XP must be a finite, nonnegative number.');
  const targetXp = xpForLevel(targetLevel);
  return { fromXp, targetLevel, targetXp, xpRemaining: Math.max(0, targetXp - fromXp) };
}

/** Independent eligible kills with a fixed 1/N chance of at least one drop.
 * Duo kills are pooled only when both have the same eligible drop roll. Counts
 * beyond safely representable integers return null for the threshold. */
export function dropChance(denominator, ownKills, partnerKills = 0) {
  if (typeof denominator !== 'number' || !Number.isFinite(denominator) || denominator < 1) {
    throw new RangeError('Drop denominator must be a finite number of at least 1.');
  }
  for (const kills of [ownKills, partnerKills]) if (!Number.isSafeInteger(kills) || kills < 0) {
    throw new RangeError('Kills must be nonnegative safe integers.');
  }
  const kills = ownKills + partnerKills;
  if (!Number.isSafeInteger(kills)) throw new RangeError('Combined kills must be a safe integer.');
  const perKill = 1 / denominator, logFailure = Math.log1p(-perKill);
  const probability = kills === 0 ? 0 : denominator === 1 ? 1 : -Math.expm1(kills * logFailure);
  const thresholds = [0.5, 0.9, 0.99].map(probability => {
    const count = denominator === 1 ? 1 : Math.ceil(Math.log1p(-probability) / logFailure);
    const thresholdKills = Number.isSafeInteger(count) ? count : null;
    return { probability, kills: thresholdKills, remainingKills: thresholdKills === null ? null : Math.max(0, thresholdKills - kills) };
  });
  return { denominator, perKill, ownKills, partnerKills, kills, probability, thresholds };
}

/** The shared combat formula; partial inputs retain its conservative defaults. */
export function combatProjection(levels, { f2p = true } = {}) {
  return combatLevelFromSkills(levels, { f2p });
}

function levelRequirements(task) {
  const record = task.record ?? {}, requirements = {};
  const add = (skill, level) => {
    if (skills.has(skill) && validLevel(level) && level <= (helperTrialCaps[skill] ?? 120)) {
      requirements[skill] = Math.max(requirements[skill] ?? 1, level);
    }
  };
  // Full engine rows carry normalized Skills/Requirements/SkillsNeeded.
  // SkillReqs is also accepted for existing display task records.
  for (const field of ['Requirements', 'SkillsNeeded', 'Skills', 'SkillReqs']) {
    for (const [skill, level] of Object.entries(record[field] ?? {})) add(skill, level);
  }
  for (const [skill, level] of Object.entries(task.SkillReqs ?? {})) add(skill, level);
  // Visible play-v1 rows retain unconditional numeric per-skill gates without
  // downloading the full task record or triggering another calculation.
  for (const [skill, level] of Object.entries(task.skillRequirements ?? {})) add(skill, level);
  // Alternative clauses are not simultaneous requirements. Do not invent a
  // training goal from the compiler's default category level for such rows.
  if (!record.RequirementAlternatives || Number(task.level ?? record.Level ?? 1) > 1) {
    add(task.category, task.level ?? record.Level);
  }
  return requirements;
}

/** Per-skill goals from the already loaded, active own task presentation.
 * Compact play-v1 rows retain category levels and explicit skillRequirements;
 * older rows without that map cannot supply omitted cross-skill gates.
 * `payoff` counts that skill's level goals, never completed tasks or
 * quests; supplies, actions and other personal requirements still apply.
 * Optional saved state supplies assigned custom targets independently of the
 * engine's level gates. Unknown current XP/levels remain null; Invention has
 * no standard-curve XP estimate. No task evaluation or fetch occurs. */
export function skillGoals(member, result, state) {
  const progress = personalSkillProgress(member);
  const selected = result?.presentation?.tasks;
  const selectedIds = selected ? new Set(selected.map(task => task.id)) : null;
  const personalCompletedIds = new Set([...(member?.completedTasks ?? []),
    ...Object.entries(member?.taskStatus ?? {}).filter(([, status]) => status?.challengeCompleted === true).map(([id]) => id)]);
  const completedIds = new Set([...personalCompletedIds,
    ...(result?.presentation?.completedTasks ?? []).map(task => task.id)]);
  const grouped = new Map(), seen = new Set();
  const ownResult = !result?.memberId || result.memberId === member?.id;
  for (const task of ownResult ? result?.tasks ?? [] : []) {
    if (state && isCustomTask(task)) continue;
    const family = [task.id, ...(task.aliases ?? []), ...(task.completionIds ?? []),
      ...(result.collectionPlanning?.completionGroups?.[task.completionGroup] ?? [])];
    if (seen.has(task.id) || task.obligation === false || task.hidden || task.status !== 'available'
      || selectedIds && !selectedIds.has(task.id) || task.personalCompleted || task.challengeSatisfied
      || family.some(id => completedIds.has(id))) continue;
    seen.add(task.id);
    const requirements = levelRequirements(task);
    for (const [skill, targetLevel] of Object.entries(requirements)) {
      const goals = grouped.get(skill) ?? [];
      goals.push({ id: task.id, label: task.label ?? task.rawLabel ?? task.id, category: task.category, targetLevel,
        requirements, requirementsComplete: result.format !== 'play-v1' && !!task.record });
      grouped.set(skill, goals);
    }
  }
  // Saved custom goals are explicit targets, so their level need not already
  // be attainable by the engine. Keep them independent of presentation filters.
  // Saved completion and assignment take priority over cached custom flags.
  for (const task of state?.tasks ?? []) {
    const skill = task.skill || task.category;
    if (!isCustomTask(task) || !customTaskAssignedTo(task, member?.id) || seen.has(task.id)
      || !(skills.has(skill) || skill === 'Invention') || !validLevel(task.level) || member?.taskStatus?.[task.id]?.backlogged) continue;
    const family = [task.id, ...(task.aliases ?? []), ...(task.completionIds ?? []),
      ...(result?.collectionPlanning?.completionGroups?.[task.completionGroup] ?? [])];
    if (family.some(id => personalCompletedIds.has(id))) continue;
    const owners = (state.members ?? []).filter(owner => customTaskAssignedTo(task, owner.id));
    const satisfied = owner => family.some(id => owner.completedTasks?.includes(id) || owner.taskStatus?.[id]?.challengeCompleted === true);
    const mode = state.rules?.['tasks.completion'] ?? 'any';
    if (mode !== 'personal' && owners.length && (mode === 'all' ? owners.every(satisfied) : owners.some(satisfied))) continue;
    seen.add(task.id);
    const goals = grouped.get(skill) ?? [];
    goals.push({ id: task.id, label: task.label ?? task.id, category: skill, targetLevel: task.level,
      requirements: { [skill]: task.level }, requirementsComplete: true });
    grouped.set(skill, goals);
  }
  const invention = member?.skillProgress?.Invention;
  if (grouped.has('Invention') && progressBelongsToMember(invention, member)
    && validLevel(invention.level) && validXp(invention.xp)) progress.Invention = invention;
  const goalSkills = grouped.has('Invention') ? [...helperSkills, 'Invention'] : helperSkills;
  return goalSkills.map(skill => {
    const observed = progress[skill], goals = (grouped.get(skill) ?? []).sort((a, b) => a.targetLevel - b.targetLevel || a.label.localeCompare(b.label));
    const targetLevel = goals.length ? Math.max(...goals.map(goal => goal.targetLevel)) : null;
    const targetXp = targetLevel === null || skill === 'Invention' ? null : xpForLevel(targetLevel);
    const payoff = [...new Set(goals.map(goal => goal.targetLevel))].sort((a, b) => a - b).map(level => ({
      level, xp: skill === 'Invention' ? null : xpForLevel(level), levelGoalsMet: goals.filter(goal => goal.targetLevel <= level).length,
    }));
    return { skill, currentLevel: observed?.level ?? null, currentXp: observed?.xp ?? null,
      targetLevel, targetXp, xpRemaining: targetXp === null || !observed ? null : Math.max(0, targetXp - observed.xp),
      goalCount: goals.length, goals, payoff };
  });
}
