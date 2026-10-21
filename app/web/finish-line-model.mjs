import { datasetValue, selectedDataset } from "../dataset-runtime.mjs";
import { buildProfileModel } from './profile-model.mjs';
import { helperSkills, helperTrialCaps } from './helper-model.mjs';
import { sameRuneScapeName } from '../core/game-progress.mjs';
import { entityId, generatedGoalId, legacyTaskId, permanentTaskId } from '../tasks/identity.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';

const array = value => Array.isArray(value) ? value : [];
const plain = value => String(value ?? '').replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*+$/g, '').trim();
const flag = value => ![undefined, null, false, 'false', 0].includes(value);
const observed = (fact, member) => fact?.source === 'runemetrics' && sameRuneScapeName(fact.runescapeName, member.runescapeName);
const level = value => Number.isSafeInteger(value) && value >= 1 && value <= 120;

// A proposed stopping point, not a maximum, engine ceiling or house rule.
export const finishLineSkillTargets = datasetValue("app/web/finish-line-model.mjs#finishLineSkillTargets");
const skillReasons = datasetValue("app/web/finish-line-model.mjs#skillReasons");

const component = (slot, ...names) => ({ slot, options: names.map(name => [name]) });
const hands = (...options) => ({ slot: 'Weapons / ammunition', options });
const common = () => [component('Ring', "Explorer's ring 4")];
// These reviewed durable targets deliberately do not read obtainable rankings.
// A whole tied hand setup must be obtained; hands/ammo cannot be mixed across it.
export const finishLineGearTargets = datasetValue("app/web/finish-line-model.mjs#finishLineGearTargets");

const notableAchievements = datasetValue("app/web/finish-line-model.mjs#notableAchievements");
const wholeQuest = (label, record) => record && Object.hasOwn(record, 'QuestPoints')
  && (/ Complete the (?:quest|miniquest|subquest)$/i.test(plain(label))
    || !record.BaseQuest && !/~\||Archaeology Mystery:/i.test(label));
const free = record => record && !flag(record['Not F2P']) && !flag(record.members);
const validResult = (state, member, result) => result && (!result.memberId || result.memberId === member.id)
  && (!result.currentBiS?.memberId || result.currentBiS.memberId === member.id)
  && (result.stateRevision === undefined || result.stateRevision === state.revision) ? result : null;
const memberResult = (results, member) => results instanceof Map ? results.get(member.id)
  : Array.isArray(results) ? results.find(result => result?.memberId === member.id) : results?.[member.id];

// Only personal obtain completions count. Challenge ticks and shared rankings
// never turn into inventory. This mirrors the existing equipment identity seam
// without importing presentation or evaluating the engine.
function equipmentIdentity(name, data = {}) {
  const formatted = data.formatted_name ?? name.toLowerCase();
  const plural = name.endsWith('s') || name.endsWith(')') && name.split('(')[0].trim().endsWith('s');
  const article = plural ? ' ' : /^[aeiou]/i.test(name) ? ' an ' : ' a ';
  const rawLabel = `Obtain${article}~|${formatted}|~`;
  return { id: generatedGoalId('equipment', entityId('item', name, data)), category: 'BiS',
    aliases: [legacyTaskId('BiS', rawLabel)], equipmentName: name };
}

/** Pure editable proposal from the saved personal facts and already loaded
 * results. No fetch, task calculation, mutation or membership transition. */
export function buildFinishLineModel(state, resultsByMember = {}, definitions = {}) {
  const members = array(state.members), resolve = id => resolveSavedTaskId(state.identityRegistry, id);
  const results = new Map(members.map(member => [member.id, validResult(state, member, memberResult(resultsByMember, member))]));
  const catalogue = new Map();
  const add = task => { const id = resolve(task.id); if (!catalogue.has(id)) catalogue.set(id, { ...task, id }); };
  for (const [category, records] of Object.entries(definitions.challenges ?? {})) for (const [rawLabel, record] of Object.entries(records)) {
    if (category === 'Quest' || category === 'Diary' || category === 'Extra') add({
      id: permanentTaskId(category, rawLabel, record), category, rawLabel, label: plain(rawLabel), record,
      aliases: [legacyTaskId(category, rawLabel)],
    });
  }
  for (const [name, data] of Object.entries(definitions.equipment ?? {})) add(equipmentIdentity(name, data));
  for (const task of [...array(state.tasks), ...members.flatMap(member => array(results.get(member.id)?.tasks))]) add(task);
  for (const [id, entry] of Object.entries(state.identityRegistry?.entries ?? {})) if (entry.category && entry.label) add({ ...entry, id });
  const tasks = [...catalogue.values()];
  const facts = new Map(members.map(member => [member.id, projectMemberTaskFacts(state, member, tasks)]));
  const profiles = new Map(members.map(member => [member.id, buildProfileModel(state, member.id, results.get(member.id), definitions)]));
  const completed = new Map(members.map(member => [member.id, new Set(array(facts.get(member.id).completedTasks).map(resolve))]));
  const recorded = new Map(members.map(member => {
    const current = results.get(member.id), names = new Set(array(member.obtainedEquipment));
    for (const item of array(current?.currentBiS?.owned?.recordedObtained)) names.add(typeof item === 'string' ? item : item.name);
    for (const task of tasks) if (task.equipmentName && completed.get(member.id).has(task.id)) names.add(task.equipmentName);
    // A retained recorded-best plan is also explicit personal obtain evidence.
    for (const style of profiles.get(member.id).gear.styles) for (const slot of style.slots) {
      for (const item of slot.items) names.add(item.name);
    }
    return [member.id, names];
  }));
  const identity = member => ({ memberId: member.id, name: member.name ?? member.id });
  function binary(member, done, known, status) {
    return { ...identity(member), known, current: known ? Number(done) : null, target: 1,
      done, ratio: Number(done), status: done ? 'Done' : known ? status ?? 'Not recorded complete' : 'Not recorded' };
  }
  function makeItem(base, players) {
    const override = state.finishLine?.items?.[base.id];
    const enabled = override?.enabled !== false;
    const done = players.length > 0 && players.every(player => player.done);
    const ratio = players.length ? Math.min(...players.map(player => player.ratio)) : 0;
    return { ...base, enabled, players, duo: { done, ratio }, status: done ? 'Done'
      : players.map(player => `${player.name}: ${player.status}`).join(' · ') || 'Unknown — no players' };
  }
  const quests = [...catalogue.values()].filter(task => task.category === 'Quest'
    && wholeQuest(task.rawLabel ?? task.label, task.record ?? task.data) && free(task.record ?? task.data))
    .sort((a, b) => plain(a.rawLabel ?? a.label).localeCompare(plain(b.rawLabel ?? b.label)))
    .map(task => makeItem({ id: `quest:${task.id}`, label: plain(task.rawLabel ?? task.label).replace(/ Complete the (?:quest|miniquest|subquest)$/i, ''),
      kind: 'quest' }, members.map(member => {
      const positive = completed.get(member.id).has(task.id) || Object.entries(member.questProgress ?? {}).some(([id, fact]) => resolve(id) === task.id && observed(fact, member));
      return binary(member, positive, positive, 'Not recorded complete');
    })));
  const skills = helperSkills.map(skill => {
    const id = `skill:${skill}`, cap = helperTrialCaps[skill];
    const authored = state.finishLine?.items?.[id]?.target;
    const target = level(authored) && authored <= (cap ?? 120) ? authored : finishLineSkillTargets[skill];
    return makeItem({ id, label: skill, skill, kind: 'skill', target, ...(cap ? { maxTarget: cap } : {}),
      reason: cap ? `Reach the existing F2P trial cap of ${cap}.` : skillReasons[skill] }, members.map(member => {
      const row = profiles.get(member.id).skills.rows.find(row => row.skill === skill), current = row?.level ?? null;
      return { ...identity(member), known: current !== null, current, target, done: current !== null && current >= target,
        ratio: current === null ? 0 : Math.min(1, current / target), status: current === null ? 'Levels not synced yet' : current >= target ? `Done (${current})` : `${current}/${target}` };
    }));
  });
  const gear = finishLineGearTargets.map(goal => makeItem({ id: `gear:${goal.style}`, label: goal.label, kind: 'gear',
    reason: 'Counts gear recorded as obtained, even outside your current chunks. Gravite counts because it can be repaired; corrupt dragon gear wears out, so it does not.',
    components: goal.components.map(part => ({ slot: part.slot, options: part.options.map(option => [...option]) })),
    details: goal.components.map(part => `${part.slot}: ${part.options.map(option => option.join(' + ')).join(' or ')}`),
  }, members.map(member => {
    const names = recorded.get(member.id), missing = goal.components.filter(part => !part.options.some(option => option.every(name => names.has(name))));
    const current = goal.components.length - missing.length, known = Array.isArray(member.obtainedEquipment) || !!results.get(member.id)?.currentBiS?.owned || names.size > 0;
    return { ...identity(member), known, current: known ? current : null, target: goal.components.length,
      done: !missing.length, ratio: current / goal.components.length, missing: missing.map(part => part.slot),
      status: !missing.length ? 'Done'
        : !known ? 'No gear recorded yet' : `${current}/${goal.components.length} slots` };
  })));
  const achievements = notableAchievements.map(([taskId, label]) => makeItem({ id: `achievement:${taskId}`, label, kind: 'achievement',
    reason: taskId === selectedDataset.gameDefaults.compatibility?.notableExplorationTaskId ? 'A notable F2P exploration unlock; own picker completion is the evidence.'
      : "A F2P area-achievement tier leading to explorer's ring 4; own picker completion is the evidence.",
  }, members.map(member => {
    const done = completed.get(member.id).has(taskId) || facts.get(member.id).taskStatus?.[taskId]?.challengeCompleted === true;
    return binary(member, done, done, 'Not recorded complete');
  })));
  const seen = new Set();
  const custom = array(state.finishLine?.customItems).filter(item => typeof item?.id === 'string' && /^finish:[A-Za-z0-9_-]+$/.test(item.id)
    && typeof item.text === 'string' && item.text.trim() && !seen.has(item.id) && seen.add(item.id)).map(item => makeItem({
    id: item.id, label: item.text.trim(), kind: 'custom' }, members.map(member =>
    binary(member, array(item.completedBy).includes(member.id), true, 'Not checked'))));
  const groupRows = [['quests', 'F2P quests', quests], ['skills', 'Skill milestones', skills], ['gear', 'Best F2P gear', gear],
    ['achievements', 'Notable achievements', achievements], ['custom', 'Your own goals', custom]];
  const groups = groupRows.map(([id, label, items]) => ({ id, label, items,
    total: items.filter(item => item.enabled).length, done: items.filter(item => item.enabled && item.duo.done).length }));
  const active = groups.flatMap(group => group.items).filter(item => item.enabled);
  const percent = (ratio, done, total) => total ? done === total ? 100 : Math.min(99, Math.floor(100 * ratio / total)) : 0;
  const memberRows = members.map(member => {
    const rows = active.map(item => item.players.find(player => player.memberId === member.id));
    const done = rows.filter(row => row.done).length, total = rows.length;
    return { id: member.id, name: member.name ?? member.id, done, total,
      percent: percent(rows.reduce((sum, row) => sum + row.ratio, 0), done, total) };
  });
  const done = active.filter(item => item.duo.done).length, total = active.length;
  return { draft: true, groups, members: memberRows,
    duo: { done, total, percent: percent(active.reduce((sum, item) => sum + item.duo.ratio, 0), done, total) } };
}
