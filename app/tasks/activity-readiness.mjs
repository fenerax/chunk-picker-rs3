import { buildTrainingAvailability } from './training-availability.mjs';
import { trainingMethodBlockers } from './training-planner.mjs';
import { combatLevelFromSkills } from '../core/combat-level.mjs';
import { skillCaps } from './engine.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const questGroupName = row => row.baseQuest ?? row.record?.BaseQuest ?? /~\|([^|]+)\|~/.exec(row.rawLabel ?? '')?.[1]?.split('#')[0] ?? row.label;
export function isWholeQuestTask(row) {
  if (!Object.hasOwn(row.record ?? {}, 'QuestPoints')) return false;
  const label = row.label ?? row.rawLabel ?? '';
  return / Complete the (?:quest|miniquest|subquest)$/i.test(label)
    || !(row.record?.BaseQuest || /~\||Archaeology Mystery:/i.test(row.rawLabel ?? label));
}

/** Overlay personal requirements on the engine's reachable source evidence.
 * The selector evaluator remains authoritative; this adapter only translates
 * retained record fields and supplies recorded account facts. */
export function buildQuestReadiness(result, state, memberId, definitions = {}) {
  const availability = buildTrainingAvailability(result, { state, memberId, definitions, sourceLocations: {} });
  const rows = result.tasks ?? [], quests = rows.filter(row => row.category === 'Quest');
  const byKey = new Map(rows.map(row => [`${row.category}:${row.rawLabel}`, row]));
  const completed = new Set(availability.completedTasks.map(row => row.id));
  const skills = { ...availability.skills };
  const combatSkills = ['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Prayer', 'Magic', 'Summoning', 'Necromancy'];
  if (combatSkills.every(skill => Number.isFinite(skills[skill]))) skills.Combat = combatLevelFromSkills(skills, { f2p: availability.members !== true });
  skills.QuestPointsNeeded = quests.filter(row => isWholeQuestTask(row) && completed.has(row.id)).reduce((total, row) => total + Number(row.record.QuestPoints || 0), 0);
  const totalSkills = Object.keys(skillCaps).filter(skill => skill !== 'Combat');
  if (totalSkills.every(skill => Number.isFinite(skills[skill]))) skills.TotalLevelNeeded = totalSkills.reduce((total, skill) => total + skills[skill], 0);
  // Kudos, CombatScore and virtual totals have no saved personal observation.
  const facts = { ...availability, skills, aliases: { ...availability.aliases, quest: { ...definitions.codeItems?.tasksPlus } },
    completedQuests: availability.completedTasks.filter(row => row.category === 'Quest').flatMap(row => [row.id, row.rawLabel, row.label]) };
  const points = ['QuestPointsNeeded', 'KudosNeeded', 'CombatScoreNeeded', 'TotalLevelNeeded', 'TotalVirtualLevelNeeded'];
  const output = new Map(), evaluating = new Set();
  const requirementsFor = (row, rowFacts) => {
    const record = row.record ?? {}, requirements = [];
    for (const [name, level] of Object.entries({ ...record.Requirements, ...record.SkillsNeeded, ...record.Skills })) requirements.push({ kind: 'skill', name, level });
    if (skillCaps[row.category] && Number(row.level ?? record.Level ?? 1) > 1) requirements.push({ kind: 'skill', name: row.category, level: Number(row.level ?? record.Level) });
    for (const field of points) if (record[field] !== undefined) requirements.push({ kind: 'skill', name: field, level: record[field] });
    for (const [field, kind] of [['Chunks', 'chunk'], ['Items', 'item'], ['Objects', 'object'], ['NPCs', 'npc'], ['Monsters', 'monster'], ['Monster', 'monster'], ['Shops', 'shop']]) {
      for (const name of list(record[field])) requirements.push({ kind, name });
    }
    for (const [token, category] of Object.entries(record.Tasks ?? {})) {
      const match = /^(.*\[\+\])(?:x(\d+))?$/.exec(token);
      const aliases = definitions.codeItems?.tasksPlus ?? {};
      const aliasKey = match && (Object.hasOwn(aliases, match[1]) ? match[1] : Object.keys(aliases).find(key => key.toLowerCase() === match[1].toLowerCase()));
      const names = match ? list(aliases[aliasKey]) : [token];
      const targets = names.map(name => ({ name: String(name).split('--')[0], row: byKey.get(`${category}:${String(name).split('--')[0]}`) }));
      // Reference self-links annotate alternative production routes, rather
      // than requiring the task to have been performed already.
      if (targets.length && targets.every(target => target.row?.id === row.id)) continue;
      const name = `Readiness ${row.id} ${token}[+]`;
      rowFacts.aliases.quest[name] = [...new Set(targets.map(target => `${category}:${target.name}`))];
      for (const target of targets) {
        const internal = category === 'Quest' && target.row && questGroupName(target.row) === questGroupName(row);
        const ready = target.row && (completed.has(target.row.id)
          || (category !== 'Quest' || internal) && target.row.id !== row.id && evaluate(target.row).canDoNow);
        if (ready) rowFacts.completedQuests.push(`${category}:${target.name}`);
      }
      requirements.push({ kind: 'quest', name: `${name}x${Number(match?.[2] ?? 1)}` });
    }
    if (record.RequirementAlternatives) requirements.push({ anyOf: list(record.RequirementAlternatives).map(clause => {
      const keys = clause && typeof clause === 'object' && !Array.isArray(clause) ? Object.keys(clause) : [];
      if (!keys.length || keys.some(key => key !== 'Skills' && !points.includes(key))
        || clause.Skills !== undefined && (!clause.Skills || typeof clause.Skills !== 'object' || Array.isArray(clause.Skills) || !Object.keys(clause.Skills).length)
        || Object.entries(clause.Skills ?? {}).some(([name, level]) => !skillCaps[name] || !Number.isSafeInteger(level) || level < 1)
        || points.some(name => clause[name] !== undefined && (!Number.isSafeInteger(clause[name]) || clause[name] < 1))) return { kind: 'unsupported-alternative', name: 'Malformed requirement alternative' };
      // Conjunctions are passed through the same evaluator as a temporary method.
      const needs = [...Object.entries(clause?.Skills ?? {}).map(([name, level]) => ({ kind: 'skill', name, level })), ...points.filter(field => clause?.[field] !== undefined).map(name => ({ kind: 'skill', name, level: clause[name] }))];
      const blocked = trainingMethodBlockers({ members: false, requirements: needs }, rowFacts);
      return blocked.length ? { kind: 'unsupported-alternative', name: blocked[0].detail } : { kind: 'skill', name: 'QuestPointsNeeded', level: 0 };
    }) });
    return requirements;
  };
  function evaluate(row) {
    if (output.has(row.id)) return output.get(row.id);
    if (evaluating.has(row.id)) return { personalCompleted: completed.has(row.id), canDoNow: false, level: 1 };
    if (completed.has(row.id)) {
      const value = { personalCompleted: true, canDoNow: false, level: Math.max(1, ...Object.values({ ...row.record?.Requirements, ...row.record?.SkillsNeeded, ...row.record?.Skills }).filter(Number.isFinite), ...list(row.record?.RequirementAlternatives).flatMap(clause => Object.values(clause?.Skills ?? {}).filter(Number.isFinite))) };
      output.set(row.id, value); return value;
    }
    evaluating.add(row.id);
    const rowFacts = { ...facts, aliases: { ...facts.aliases, quest: { ...facts.aliases.quest } }, completedQuests: [...facts.completedQuests] };
    const requirements = requirementsFor(row, rowFacts);
    const preserved = (row.blockers ?? []).filter(blocker => !['training', 'tasks', 'points', 'requirements', 'personal-completion'].includes(blocker.kind));
    const unknownStatus = row.status !== 'available' && !(row.blockers?.length);
    const blockers = trainingMethodBlockers({ members: row.record?.['Not F2P'] === true, requirements }, rowFacts);
    const level = Math.max(1, ...requirements.filter(requirement => requirement.kind === 'skill' && skillCaps[requirement.name] && Number.isFinite(requirement.level)).map(requirement => requirement.level), ...list(row.record?.RequirementAlternatives).flatMap(clause => Object.values(clause?.Skills ?? {}).filter(Number.isFinite)));
    const value = { personalCompleted: false, canDoNow: !unknownStatus && !preserved.length && !blockers.length, level };
    // Failed cyclic branches are path dependent; only successful branches can
    // be shared while traversing the dependency graph.
    if (value.canDoNow || evaluating.size === 1) output.set(row.id, value);
    evaluating.delete(row.id);
    return value;
  }
  for (const row of quests) output.set(row.id, evaluate(row));
  return output;
}
