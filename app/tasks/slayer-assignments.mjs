import { combatLevelFromSkills } from '../core/combat-level.mjs';
import { plainLabel } from './engine.mjs';
import { questGroupName } from './activity-readiness.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const yes = () => ({ status: 'doable', quests: [] });
const unknown = () => ({ status: 'unknown', quests: [] });
const all = values => ({ status: values.some(v => v.status === 'stuck') ? 'stuck' : values.some(v => v.status === 'unknown') ? 'unknown' : 'doable', quests: [...new Set(values.flatMap(v => v.quests))] });
const any = values => values.find(v => v.status === 'doable') ?? (values.some(v => v.status === 'unknown') ? unknown() : values.length ? all(values) : unknown());
const observedSources = new Set(['game-plugin', 'runemetrics', 'official-api', 'hiscores']);

/** Current facts only: planning ceilings and manual training assumptions are not observations. */
export function currentSlayerLevels(result, { f2p = true } = {}) {
  const levels = {};
  for (const [skill, training] of Object.entries(result.training ?? {})) {
    if (observedSources.has(training.observedSource) && Number.isSafeInteger(training.observedLevel) && training.observedLevel >= 1) levels[skill] = training.observedLevel;
  }
  const lockLevel = result.playerControls?.slayerLock?.level;
  if (levels.Slayer == null && Number.isSafeInteger(lockLevel) && lockLevel >= 1) levels.Slayer = lockLevel;
  const combatSkills = ['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Prayer', 'Magic', 'Necromancy', ...(f2p ? [] : ['Summoning'])];
  // Do not let the formula's missing-skill defaults turn unknown stats into current levels.
  if (levels.Combat == null && combatSkills.every(skill => levels[skill] != null)) levels.Combat = combatLevelFromSkills(levels, { f2p });
  return levels;
}

/** Intersect the planning method with personal, current master requirements.
 * An available method can still require training or an unfinished quest. */
export function currentSlayerMasterAccess(method, levels, resolveTasks, npcNow) {
  if (method?.status !== 'available') return { status: 'unavailable', reasons: ['No verified assignment method is reachable.'] };
  const unmet = [], missing = [], record = method.record ?? {};
  for (const [skill, level] of Object.entries({ ...record.Skills, ...record.SkillsNeeded, ...(record.Level ? { Slayer: record.Level } : {}) })) {
    if (levels[skill] == null) missing.push(`Sync your ${skill} level to check this master.`);
    else if (levels[skill] < level) unmet.push(`Requires ${skill} ${level} (recorded ${levels[skill]}).`);
  }
  for (const [label, category] of Object.entries(record.Tasks ?? {})) {
    const candidates = resolveTasks(label, category);
    if (candidates.some(row => row.personalCompleted)) continue;
    if (category === 'Quest' && candidates.length) unmet.push(`Complete ${[...new Set(candidates.map(questGroupName))].join(' or ')} yourself to use this master.`);
    else missing.push(`The prerequisite ${plainLabel(label)} cannot be checked right now.`);
  }
  // The master's location can carry its own quest gates, outside the method
  // record: Chaeldar is in Zanaris (Lost City), Duradel's hut needs Shilo Village.
  for (const npc of npcNow ? list(record.NPCs) : []) {
    const place = npcNow(npc), name = npc.split('#')[0];
    if (place.status === 'stuck') unmet.push(place.quests.length ? `Reaching ${name} needs ${place.quests.join(' and ')} finished.` : `${name} cannot be reached right now.`);
    else if (place.status === 'unknown') missing.push(`Whether you can reach ${name} cannot be checked right now.`);
  }
  return { status: unmet.length ? 'unavailable' : missing.length ? 'unknown' : 'available', reasons: [...unmet, ...missing] };
}

/** Bounded display-only proof over serialized access. Missing route evidence stays unknown.
 * Access is a planning union: area tasks, Connect gates and source taskUnlocks may
 * depend on unfinished quests. Never use monster membership alone as a NOW proof. */
export function slayerTargetAccess(result, definitions, resolveTasks, levels, confirmedSections = new Set()) {
  const access = result.access ?? {}, places = new Set([...list(access.bases), ...list(access.sections), ...list(access.areas)]);
  const tasks = new Map((result.tasks ?? []).map(row => [`${row.category}\0${row.rawLabel}`, row]));
  const memo = new Map(), active = new Set();
  let visits = 0;
  const questName = row => row?.record?.BaseQuest ?? /~\|([^|]+)\|~/.exec(row?.rawLabel)?.[1]?.split('#')[0] ?? plainLabel(row?.rawLabel ?? 'the required quest');
  const completedQuests = new Set((result.tasks ?? []).filter(row => row.category === 'Quest' && row.personalCompleted && Object.hasOwn(row.record ?? {}, 'QuestPoints')).map(questName));
  const requirements = value => {
    if (value == null || value === true) return yes();
    if (value === false) return { status: 'stuck', quests: [] };
    if (Array.isArray(value)) return all(value.map(requirements));
    if (typeof value !== 'object') return unknown();
    return all(Object.entries(value).map(([label, category]) => any(resolveTasks(label, category).map(checkTask))));
  };
  function checkTask(row) {
    if (row.personalCompleted || row.category === 'Quest' && completedQuests.has(questName(row))) return yes();
    if (row.category === 'Quest') return { status: 'stuck', quests: [questName(row)] };
    const key = `task:${row.id}`;
    if (active.has(key) || active.size > 80 || ++visits > 1000) return unknown();
    active.add(key);
    const record = row.record ?? {}, checks = [requirements(record.Tasks)];
    for (const [skill, level] of Object.entries({ ...record.Skills, ...record.SkillsNeeded, ...(record.Level ? { [row.category]: record.Level } : {}) })) checks.push(levels[skill] == null ? unknown() : { status: levels[skill] >= level ? 'doable' : 'stuck', quests: [] });
    if (record.Chunks) checks.push(any(list(record.Chunks).map(checkPlace)));
    // Inventory, points, transport confirmations and other untraced gates need a fuller proof.
    if (Object.keys(record).some(key => !['Tasks', 'Skills', 'SkillsNeeded', 'Level', 'Chunks', 'UnlocksArea', 'Description', 'BaseQuest', 'NoBoost'].includes(key))) checks.push(unknown());
    active.delete(key); return all(checks);
  }
  const gate = value => {
    if (value == null || typeof value === 'boolean') return requirements(value);
    if (Array.isArray(value)) return all(value.map(requirements));
    if (value.__all) return all(value.__all.map(gate));
    return Object.keys(value).every(key => key === 'Tasks') ? requirements(value.Tasks) : unknown();
  };
  const recordAt = id => {
    const match = /^(\d+)-(\d+)$/.exec(id);
    return match ? definitions.chunks?.[match[1]]?.Sections?.[match[2]] : definitions.chunks?.[id];
  };
  function checkPlace(id) {
    if (!places.has(id)) return unknown();
    if (memo.has(id)) return memo.get(id);
    if (active.has(id) || active.size > 80 || ++visits > 1000) return unknown();
    active.add(id);
    const checks = [], data = recordAt(id), base = id.split('-')[0];
    if (!data) checks.push(unknown());
    // These section gates are quest-step selectors, separate from area UnlocksArea tasks.
    for (const label of list(definitions.questSections?.[id] ?? definitions.questSections?.[base])) checks.push(requirements({ [label]: 'Quest' }));
    const area = definitions.challenges?.Nonskill?.[id];
    if (area?.UnlocksArea) checks.push(checkTask(tasks.get(`Nonskill\0${id}`) ?? { id: id, category: 'Nonskill', record: area }));
    if (/^\d+(?:-\d+)?$/.test(id)) {
      // A section reached only through an interior or a quest connector is not
      // independently proved by membership in the planning access union.
      const section = /^(\d+)-(\d+)$/.exec(id), neighbors = section && definitions.sections?.[section[1]]?.[section[2]];
      // A section the player confirmed reachable is its own route proof; its quest and area gates above still apply.
      if (section && confirmedSections.has(id)) checks.push(yes());
      else if (neighbors?.length) checks.push(any(neighbors.filter(place => places.has(place)).map(checkPlace)));
      else if (section && Object.keys(definitions.chunks?.[base]?.Sections ?? {}).length > 1) checks.push(unknown());
      else if (!section && definitions.chunks?.[base]?.Sections) checks.push(unknown());
    } else {
      const entrances = list(access.entranceSources?.[id]);
      checks.push(any(entrances.filter(place => places.has(place)).map(from => {
        // access.mjs combines duplicate Connect edges from both records. A
        // permissive backlink must not erase the other direction's quest gate.
        const edges = [recordAt(from)?.Connect?.[id], data?.Connect?.[from] ?? data?.Connect?.[from.split('-')[0]]].filter(value => value !== undefined);
        return all([checkPlace(from), edges.length ? all(edges.map(gate)) : unknown()]);
      })));
    }
    active.delete(id);
    const value = all(checks);
    // Cycle failures depend on the current path; cache only successful proofs.
    if (value.status === 'doable') memo.set(id, value);
    return value;
  }
  const target = monster => {
    visits = 0;
    const locations = list(access.locations?.[`Monster:${monster}`]);
    return any(locations.map(location => {
      const checks = [checkPlace(location)];
      const sourceGate = definitions.taskUnlocks?.Monsters?.[monster];
      checks.push(requirements(sourceGate?.[location] ?? sourceGate?.[location.split('-')[0]]));
      const monsterRequirement = definitions.slayerMonsters?.[monster];
      const required = typeof monsterRequirement === 'number' ? monsterRequirement : monsterRequirement?.Level;
      if (typeof required === 'number') checks.push(levels.Slayer == null ? unknown() : { status: levels.Slayer >= required ? 'doable' : 'stuck', quests: [] });
      // The retained area gate permits the quest's entrance, but these monsters
      // are downstairs: https://runescape.wiki/w/Lumbridge_Catacombs
      // The lower level requires The Blood Pact completed on this account.
      if (location === 'Lumbridge Catacombs') {
        const whole = (result.tasks ?? []).filter(row => row.category === 'Quest' && questName(row) === 'The Blood Pact' && Object.hasOwn(row.record ?? {}, 'QuestPoints'));
        checks.push(whole.some(row => row.personalCompleted) ? yes() : { status: 'stuck', quests: ['The Blood Pact'] });
      }
      return all(checks);
    }));
  };
  // Same place proof for an NPC (a Slayer master), with its own source gates.
  target.npc = npc => {
    visits = 0;
    const gates = definitions.taskUnlocks?.NPCs?.[npc];
    return any(list(access.locations?.[`NPC:${npc}`]).map(location =>
      all([checkPlace(location), requirements(gates?.[location] ?? gates?.[location.split('-')[0]])])));
  };
  return target;
}

const friendlyChance = chance => {
  if (chance === 1) return 'all';
  const choices = [...Array.from({ length: 99 }, (_, i) => [1, i + 2]), [2, 3], [3, 4], [4, 5], [9, 10]];
  const [n, d] = choices.reduce((best, pair) => Math.abs(pair[0] / pair[1] - chance) < Math.abs(best[0] / best[1] - chance) ? pair : best);
  return `about ${n} in ${d}`;
};

export function slayerStuckSummary(master, tasks, now = false) {
  const pool = tasks.filter(task => now ? task.currentUnlocked : task.planningUnlocked);
  const stuck = pool.filter(task => now ? task.currentStatus === 'stuck' : !task.planningEligible);
  const uncertain = now ? pool.filter(task => task.currentStatus === 'unknown') : [];
  const weightsKnown = pool.length > 0 && pool.every(task => Number.isFinite(task.weight) && task.weight >= 0) && pool.reduce((sum, task) => sum + task.weight, 0) > 0;
  const poolWeight = weightsKnown ? pool.reduce((sum, task) => sum + task.weight, 0) : null;
  const stuckWeight = weightsKnown ? stuck.reduce((sum, task) => sum + task.weight, 0) : null;
  const unknownWeight = weightsKnown ? uncertain.reduce((sum, task) => sum + task.weight, 0) : null;
  const names = stuck.map(task => `${task.name}${now && task.currentQuests.length ? `: needs ${task.currentQuests.join(' and ')} finished` : ''}`);
  let line = null;
  if (!weightsKnown) line = `${now ? 'Right now: ' : `${master}: `}the assignment weights are unknown${names.length ? ` (${names.join(', ')})` : ''}.`;
  else if (stuckWeight > 0) line = now ? `Right now: ${friendlyChance(stuckWeight / poolWeight)} (${names.join(', ')}).` : `${friendlyChance(stuckWeight / poolWeight).replace(/^a/, 'A')} of ${master}'s tasks can't be done in your chunks yet (${names.join(', ')}).`;
  if (uncertain.length && (!weightsKnown || unknownWeight > 0)) line = `${line ? `${line} ` : 'Right now: '}Can't tell for ${uncertain.map(task => task.name).join(', ')}${weightsKnown ? ` (${unknownWeight} of ${poolWeight} weight)` : ''}.`;
  return { poolWeight, stuckWeight, unknownWeight, weightsKnown, stuckAssignments: stuck.map(task => task.name), unknownAssignments: uncertain.map(task => task.name), line };
}
