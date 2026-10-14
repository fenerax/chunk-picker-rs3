import { playerControlSkills } from '../core/player-controls.mjs';
import { combatLevelFromSkills } from '../core/combat-level.mjs';
import { sameRuneScapeName } from '../core/game-progress.mjs';
import { permanentTaskId } from '../tasks/identity.mjs';
import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
import { helperTrialCaps } from './helper-model.mjs';
import { buildBiSComparison } from './bis-compare.mjs';

const array = value => Array.isArray(value) ? value : [];
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const observed = (fact, member) => fact?.source === 'runemetrics' && sameRuneScapeName(fact.runescapeName, member.runescapeName);
const enabled = value => ![false, 'false', 0].includes(value);
const combatSkills = ['Attack', 'Strength', 'Defence', 'Constitution', 'Prayer', 'Magic', 'Ranged', 'Summoning', 'Necromancy'];
const taskSections = ['Quests', 'Skills', 'BiS / gear', 'Diaries / achievements', 'Other'];
// Presentation classifies Quest, Diary and BiS separately, then every named
// skill (including Combat). Keep that same category boundary for this summary.
const sectionFor = category => category === 'Quest' ? 'Quests' : category === 'Diary' ? 'Diaries / achievements'
  : category === 'BiS' ? 'BiS / gear' : playerControlSkills.includes(category) || category === 'Combat' ? 'Skills' : 'Other';
const standardSlots = ['head', 'neck', 'back', 'torso', 'legs', 'hands', 'feet', 'ring', 'main hand', 'off-hand', 'ammo', 'pocket', 'aura'];
const slotLabels = { 'main hand': 'Main hand', 'off-hand': 'Off-hand', ammo: 'Ammunition' };
const plain = value => String(value ?? '').replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*+$/g, '');

function recordedGear(member, result) {
  const owned = result?.currentBiS?.owned;
  // Feed only the recorded plan to the shared hand-loadout projection. Its
  // obtainable rankings never participate in the profile.
  const comparison = buildBiSComparison([{ member, result: { currentBiS: { owned: { recordedBest: owned?.recordedBest } } } }]);
  const styles = comparison.styles.map(section => {
    const indexed = new Map(section.rows.map(row => [row.slot, row]));
    const slots = [...standardSlots.filter(slot => !(slot === 'back' && indexed.has('cape')) && !(slot === 'torso' && indexed.has('body'))),
      ...section.rows.map(row => row.slot).filter(slot => !standardSlots.includes(slot))];
    return { style: section.style, slots: slots.map(slot => {
      const row = indexed.get(slot), entry = row?.cells[0]?.recorded;
      return { slot, label: row?.label ?? slotLabels[slot] ?? slot[0].toUpperCase() + slot.slice(1),
        items: array(entry?.items).map(name => ({ name })), known: !!entry,
        coupled: entry?.coupled === true, unused: entry?.unused === true,
        loadoutItems: array(entry?.loadoutItems), tiedLoadouts: array(entry?.tiedLoadouts), mode: entry?.mode ?? null };
    }) };
  });
  return { available: !!owned?.recordedBest, totalRecorded: owned ? new Set(array(owned.recordedObtained).map(item => typeof item === 'string' ? item : item.name).filter(Boolean)).size : null,
    styles, defaultStyle: styles.find(section => section.slots.some(slot => slot.items.length))?.style ?? styles[0]?.style ?? null,
    scope: 'Best recorded obtained gear; current possession and equipped items are unconfirmed.' };
}

/** Pure per-account profile. Saved observations are independent of reachable
 * training ceilings, shared challenge satisfaction and current inventory. */
export function buildProfileModel(state, memberId, result, definitions = {}, rollStats = null) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}.`);
  // Results from another player or revision must not leak gear or task facts.
  const current = result && (!result.memberId || result.memberId === memberId)
    && (result.stateRevision === undefined || result.stateRevision === state.revision) ? result : null;
  // The shared content rule overrides retained per-member legacy F2P flags.
  const f2p = enabled(state.rules?.['content.f2p']);
  const rows = playerControlSkills.map(skill => {
    const fact = member.skillProgress?.[skill];
    const known = observed(fact, member) && Number.isSafeInteger(fact.level) && fact.level >= 1 && fact.level <= 120
      && typeof fact.xp === 'number' && Number.isFinite(fact.xp) && fact.xp >= 0;
    return { skill, level: known ? fact.level : null, xp: known ? fact.xp : null,
      fetchedAt: known ? timestamp(fact.fetchedAt) : null,
      // Training.cap also includes manual planning limits and Slayer locks.
      // Only the existing membership trial caps belong beside real levels.
      f2pCap: f2p ? helperTrialCaps[skill] ?? null : null,
      unavailableInF2p: f2p && skill === 'Invention' };
  });
  const levels = Object.fromEntries(rows.filter(row => row.level !== null).map(row => [row.skill, row.level]));
  const knownCount = Object.keys(levels).length, knownLevelTotal = Object.values(levels).reduce((sum, level) => sum + level, 0);
  const sync = member.runeMetricsSync;
  const skills = { rows, knownCount, totalCount: rows.length, knownLevelTotal,
    totalLevel: knownCount === rows.length ? knownLevelTotal : null,
    combatLevel: combatSkills.every(skill => levels[skill] !== undefined) ? combatLevelFromSkills(levels) : null,
    lastSyncAt: observed(sync, member) ? timestamp(sync.fetchedAt) : null, f2p };

  const catalogue = new Map();
  const resolve = id => resolveSavedTaskId(state.identityRegistry, id);
  // Generated task metadata is richer; saved rows and registry entries retain
  // completed tasks which no longer appear in this player's active result.
  for (const task of [...array(current?.tasks), ...array(state.tasks)]) {
    const id = resolve(task.id);
    if (!catalogue.has(id)) catalogue.set(id, { ...task, id });
  }
  for (const [id, entry] of Object.entries(state.identityRegistry?.entries ?? {})) {
    if (!catalogue.has(id) && entry.category && entry.label) catalogue.set(id, { ...entry, id });
  }
  const projected = projectMemberTaskFacts(state, member, [...catalogue.values()]);
  const actual = new Set(array(projected.completedTasks).map(resolve));
  const ticked = new Set(Object.entries(projected.taskStatus ?? {}).filter(([, status]) => status.challengeCompleted === true).map(([id]) => resolve(id)));
  const completed = new Set([...actual, ...ticked]);
  const categories = new Map();
  let unknownCount = 0;
  for (const id of completed) {
    const task = catalogue.get(id);
    if (!task?.category) { unknownCount++; continue; }
    const category = categories.get(task.category) ?? { category: task.category, completed: 0, ticked: 0, actual: 0 };
    category.completed++; category.ticked += Number(ticked.has(id)); category.actual += Number(actual.has(id)); categories.set(task.category, category);
  }
  const categoryBreakdown = [...categories.values()].sort((a, b) => a.category.localeCompare(b.category));
  const sections = taskSections.map(category => ({ category, completed: 0, ticked: 0, actual: 0 }));
  for (const row of categoryBreakdown) {
    const section = sections.find(value => value.category === sectionFor(row.category));
    for (const field of ['completed', 'ticked', 'actual']) section[field] += row[field];
  }
  const tasks = { categories: sections, categoryBreakdown,
    completedCount: completed.size - unknownCount, unknownCount };

  const questRows = new Map();
  const eligible = record => !f2p || !enabled(record?.['Not F2P'] ?? false);
  const isWhole = (label, record) => Object.hasOwn(record, 'QuestPoints')
    && (/ Complete the (?:quest|miniquest|subquest)$/i.test(plain(label)) || !record.BaseQuest && !/~\||Archaeology Mystery:/i.test(label));
  for (const [label, record] of Object.entries(definitions.challenges?.Quest ?? {})) {
    if (isWhole(label, record) && eligible(record)) questRows.set(resolve(permanentTaskId('Quest', label, record)), record);
  }
  for (const task of catalogue.values()) {
    const record = task.record ?? task.data;
    if (task.category === 'Quest' && record && isWhole(task.rawLabel ?? task.label, record) && eligible(record)) questRows.set(task.id, record);
  }
  const personalQuests = new Set(Object.entries(member.questProgress ?? {}).filter(([, fact]) => observed(fact, member)).map(([id]) => resolve(id)));
  const questKnown = !!definitions.challenges?.Quest || questRows.size > 0;
  const quests = { completed: [...personalQuests].filter(id => questRows.has(id)).length,
    total: questKnown ? questRows.size : null, known: questKnown,
    unknownCompletionCount: [...personalQuests].filter(id => !questRows.has(id)).length,
    label: 'Personally completed whole quests in the current rules' };
  const diaryRows = [...catalogue.values()].filter(task => task.category === 'Diary');
  const achievements = { ticked: diaryRows.filter(task => completed.has(task.id)).length, total: diaryRows.length, label: 'ticked in the picker' };

  const rollMember = rollStats && (rollStats.stateRevision === undefined || rollStats.stateRevision === state.revision)
    ? array(rollStats.members).find(owner => owner.id === memberId) : null;
  const firstUnlockAt = array(rollMember?.timeline).map(row => timestamp(row.at)).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return { header: { memberId, name: member.name ?? member.id, runescapeName: member.runescapeName ?? null,
    unlockedCount: new Set(array(member.unlocked)).size, firstUnlockAt, firstUnlockLabel: 'First recorded unlock' },
    skills, tasks, quests, achievements, gear: recordedGear(member, current) };
}
