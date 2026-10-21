import { plainLabel, taskId } from './engine.mjs';
import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
import { passesRateCutoff } from './rates.mjs';
import { achievementFamilyRequired } from './achievements.mjs';
import { buildQuestReadiness, isWholeQuestTask, questGroupName } from './activity-readiness.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const on = (rules, key, fallback = true) => rules[key] === undefined ? fallback : ![false, 'false', 0].includes(rules[key]);
const clean = value => String(value).replace(/\*/g, '');

/** Read-only activity index over every engine row, including display-suppressed
 * methods. Reachable levels are planning ceilings, never current account stats. */
export function buildActivityInfo(result, state, memberId, definitions = {}) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const legacyMap = state.legacy?.maps?.[member.sourceMapId] ?? {};
  const rules = { ...(!hasGameplayMigration(state, member) ? Object.fromEntries(Object.entries(legacyMap.rules ?? {}).map(([key, value]) => [decodeLegacyText(key), value])) : {}), ...state.taskRules, ...member.taskRules };
  const rows = result.tasks ?? [], byId = new Map(rows.map(row => [row.id, row]));
  const questReadiness = buildQuestReadiness(result, state, memberId, definitions);
  const selected = new Set((result.presentation?.tasks ?? []).map(row => row.id));
  const items = new Map((result.items ?? []).map(row => [row.name, row]));
  const sourcePrimary = source => {
    if (source.kind === 'drop') return passesRateCutoff(source.probability, rules, 'primary');
    if (source.kind === 'shop') return true;
    if (source.kind === 'spawn') return on(rules, 'Primary Spawns');
    if (source.category === 'Farming' && !on(rules, 'Farming Primary', false)) return false;
    if (Object.hasOwn(source, 'probability')) return source.primary === true && passesRateCutoff(source.probability, rules, 'primary');
    return source.primary === true;
  };
  const primaryMethod = row => {
    if (typeof row.primaryMethod === 'boolean') return row.primaryMethod;
    if (!row.primary) return false;
    if (row.category === 'Smithing' && !on(rules, 'Smithing by Smelting', false) && !(result.access?.objects ?? []).some(name => ['Anvil', 'Rusted anvil'].includes(name))) return false;
    const record = row.record ?? {};
    const secondaryInputs = list(record.Items).filter(token => String(token).includes('*')).some(token => !(definitions.codeItems?.itemsPlus?.[clean(token)] ?? [clean(token)]).some(name => (items.get(name)?.sources ?? []).some(sourcePrimary)));
    const conditionalTags = ['Normal Farming', 'Shortcut', 'InsidePOH Primary', 'Token', 'Cleaning Herbs Primary'];
    const disabled = list(record.Category).some(tag => conditionalTags.includes(tag) && !on(rules, tag));
    return (!list(record.Category).includes('Secondary Primary') && !secondaryInputs && !disabled) || on(rules, 'Secondary Primary', false);
  };
  const summarize = row => ({ id: row.id, label: row.label, category: row.category, obligation: row.obligation !== false, explanation: row.explanation, level: row.level, primary: primaryMethod(row), status: row.status,
    personalCompleted: !!row.personalCompleted, challengeSatisfied: !!row.challengeSatisfied, selected: selected.has(row.id),
    suppressionReasons: result.presentation?.suppressed?.[row.id] ?? [], blockers: row.blockers ?? [], wiki: row.wiki,
    evidenceTaskId: row.id, sourceCount: row.sources?.length ?? 0,
    ...(row.category === 'Quest' ? { canDoNow: questReadiness.get(row.id)?.canDoNow === true } : {}) });
  const order = (a, b) => b.level - a.level || a.label.localeCompare(b.label);
  const skills = Object.entries(result.training ?? {}).filter(([skill]) => skill !== 'Combat').map(([skill, training]) => {
    const tasks = rows.filter(row => row.category === skill).map(summarize).sort(order);
    return { skill, reachableLevel: training.level, cap: training.cap, primary: training.primary, passiveLevel: training.passiveLevel,
      primaryOverride: training.primaryOverride ?? null, manualPrimary: !!training.manualPrimary, passiveOverride: training.passiveOverride ?? null, maxOverride: training.maxOverride ?? null,
      primaryMethods: tasks.filter(row => row.primary && row.status === 'available'), availableTasks: tasks.filter(row => row.status === 'available' && row.obligation),
      nonPrimaryMethods: tasks.filter(row => !row.primary && row.status === 'available' && row.obligation),
      blockedTasks: tasks.filter(row => row.status !== 'available' && row.obligation), selectedGoals: tasks.filter(row => row.selected && row.obligation),
      explanation: 'Reachable level is the highest level you can train to using available methods. Your current skill level is recorded separately.' };
  }).sort((a, b) => a.skill.localeCompare(b.skill));
  const groupRows = (category, getName) => {
    const groups = new Map();
    for (const row of rows.filter(row => row.category === category && row.obligation !== false)) {
      const name = getName(row), group = groups.get(name) ?? [];
      group.push(row); groups.set(name, group);
    }
    return [...groups].map(([name, tasks]) => ({ name, tasks: tasks.map(summarize), availableCount: tasks.filter(row => row.status === 'available').length,
      ...(category === 'Diary' ? { required: tasks.some(row => achievementFamilyRequired(row.record?.BaseQuest ?? row.baseQuest ?? name, rules)) } : {}),
      personallyCompletedCount: tasks.filter(row => row.personalCompleted).length, challengeSatisfiedCount: tasks.filter(row => row.challengeSatisfied).length,
      wholeCompletion: tasks.filter(row => Object.hasOwn(row.record ?? {}, category === 'Quest' ? 'QuestPoints' : 'ManualShow')).map(summarize) })).sort((a, b) => a.name.localeCompare(b.name));
  };
  const markedName = row => /~\|([^|]+)\|~/.exec(row.rawLabel)?.[1]?.split('#')[0] ?? row.baseQuest ?? row.label;
  const quests = groupRows('Quest', questGroupName);
  const allQuestGroups = new Map(), displayedQuests = new Map(quests.map(group => [group.name, group])), questStates = {};
  for (const row of rows.filter(row => row.category === 'Quest')) {
    const name = questGroupName(row), group = allQuestGroups.get(name) ?? [];
    group.push(row); allQuestGroups.set(name, group);
  }
  for (const [name, original] of allQuestGroups) {
    // Whole completion and route requirements remain personal even when some
    // steps fall outside this player's task obligations.
    const done = original.some(row => isWholeQuestTask(row) && questReadiness.get(row.id)?.personalCompleted);
    const facts = { questStatus: done ? 'done' : original.some(row => questReadiness.get(row.id)?.personalCompleted) ? 'in-progress' : 'not-started',
      canDoNow: !done && original.some(row => isWholeQuestTask(row) && questReadiness.get(row.id)?.canDoNow),
      level: Math.max(1, ...original.map(row => questReadiness.get(row.id)?.level ?? 1)) };
    for (const row of original) questStates[row.id] = { ...facts, level: questReadiness.get(row.id)?.level ?? row.level };
    const group = displayedQuests.get(name);
    if (!group) continue;
    Object.assign(group, facts, { wholeCompletion: original.filter(isWholeQuestTask).map(summarize) });
    for (const summary of [...group.tasks, ...group.wholeCompletion]) Object.assign(summary, questStates[summary.id]);
  }
  const achievements = groupRows('Diary', markedName);
  const clueRows = rows.filter(row => row.record?.ClueTier && row.obligation !== false);
  const ownAccess = result.obligationAccess ?? result.access;
  const locations = new Set([...(ownAccess?.bases ?? []), ...(ownAccess?.sections ?? []), ...(ownAccess?.areas ?? [])]);
  const tiers = [...new Set([...Object.keys(definitions.clues ?? {}), ...clueRows.map(row => row.record.ClueTier)])];
  const clues = { tiers: tiers.map(tier => {
    const tasks = clueRows.filter(row => row.record.ClueTier === tier).map(summarize);
    const declaredLocations = Object.keys(definitions.clues?.[tier] ?? {});
    return { tier, tasks, availableCount: tasks.filter(row => row.status === 'available').length, totalCount: tasks.length,
      reachableLocations: declaredLocations.filter(location => locations.has(location)), declaredLocations };
  }), limitations: ['Counts describe declared clue steps and locations. They do not predict complete-scroll success or prove possession of a clue.'] };
  const monsters = new Set(result.access?.monsters ?? []);
  const slayerRows = rows.filter(row => row.category === 'Slayer');
  const masters = Object.entries(definitions.slayerMasterTasks ?? {}).map(([name, assignments]) => {
    const aliases = name.split('/');
    const method = slayerRows.find(row => /assignment|assignement|bounty/i.test(row.rawLabel) && (name === 'Death' ? /Reaper assignment/.test(row.rawLabel) : aliases.some(alias => row.record?.NPCs?.includes(alias) || row.rawLabel.includes(`~|${alias}|~`))));
    const tasks = Object.entries(assignments).map(([assignment, data]) => {
      const blockers = [];
      if (!method || method.status !== 'available') blockers.push({ kind: 'master', detail: 'No verified way to get an assignment from this master is reachable.' });
      for (const [skill, level] of Object.entries({ ...data.Skills, ...(data.Level ? { Slayer: data.Level } : {}), ...(data.CombatLevel ? { Combat: data.CombatLevel } : {}) })) if ((result.training?.[skill]?.level ?? 1) < level) blockers.push({ kind: 'training', detail: `${skill} ${level} exceeds reachable training.` });
      for (const [label, category] of Object.entries(data.Tasks ?? {})) {
        const alternatives = definitions.codeItems?.tasksPlus?.[label] ?? [label];
        const candidates = alternatives.map(value => { const raw = value.split('--')[0]; return byId.get(taskId(category, raw, definitions.challenges?.[category]?.[raw])); }).filter(Boolean);
        if (category === 'Quest' ? !candidates.some(row => row.personalCompleted) : !candidates.some(row => row.status === 'available')) blockers.push({ kind: category === 'Quest' ? 'personal-completion' : 'task', detail: `${plainLabel(label)} requires ${category === 'Quest' ? 'completion on this player’s account' : 'a reachable prerequisite'}.` });
      }
      const alternatives = Object.keys(definitions.codeItems?.slayerTasks?.[assignment.split(' - ')[0]] ?? definitions.codeItems?.reaperTasks?.[assignment.split(' - ')[0]] ?? {});
      const reachableMonsters = alternatives.filter(monster => monsters.has(monster));
      if (!reachableMonsters.length) blockers.push({ kind: 'monsters', detail: alternatives.length ? 'No matching target monster is reachable.' : 'The monsters for this assignment have not been identified in the game data.' });
      for (const location of list(data.Chunks)) if (!(definitions.codeItems?.chunksPlus?.[location] ?? [location]).some(value => locations.has(value))) blockers.push({ kind: 'chunks', detail: `Required location: ${definitions.chunks?.[location]?.Nickname ?? definitions.chunks?.[location]?.Name ?? location}.` });
      const known = new Set(['Level', 'CombatLevel', 'Skills', 'Tasks', 'Chunks', 'Weight']);
      const unknown = Object.keys(data).filter(key => !known.has(key));
      if (unknown.length) blockers.push({ kind: 'unsupported', detail: `Some assignment requirements are not yet supported: ${unknown.join(', ')}.` });
      return { name: assignment, weight: Number(data.Weight ?? 0), reachableMonsters, planningEligible: blockers.length === 0, blockers, requirements: data };
    });
    return { name, method: method ? summarize(method) : null, reachable: method?.status === 'available', tasks,
      eligibleCount: tasks.filter(task => task.planningEligible).length, totalCount: tasks.length };
  });
  return { memberId, skills, quests, questStates, achievements,
    activities: rows.filter(row => ['Extra', 'Nonskill'].includes(row.category) && !row.record?.ClueTier && row.obligation !== false).map(summarize),
    slayer: { masters, lockOptions: { monsters: Object.keys(definitions.codeItems?.slayerTasks ?? {}), bosses: Object.keys(definitions.codeItems?.reaperTasks ?? {}) },
      declaredLock: result.playerControls?.slayerLock ?? null, effectiveLock: result.effectiveSlayerLock ?? null, lockRelease: result.slayerLockRelease ?? null,
      limitations: ['Availability uses the highest levels you can train to. Manual entries do not independently verify your current combat or Slayer level or your in-game assignment. You must complete personal quest requirements on your own account.'] }, clues,
    points: result.points, coverage: { limitations: ['Activity Info lists supported activities from the game data. Unavailable activities show why; alternative tasks remain visible here.', 'Reachable training and possible quest points are planning estimates. Current account statistics are recorded separately.'] } };
}
