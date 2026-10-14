import { playerControlSkills } from './player-controls.mjs';
import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';

const skills = new Set(playerControlSkills);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = value => String(value).replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*+$/g, '');

// Missing retained membership evidence only; see docs/lamp-choices.md for
// the data audit and pinned Wiki sources. Never feed this into task eligibility.
const reviewedMembersSources = new Set([
  "Quest\0~|Beneath Scabaras' Sands|~ Complete the quest",
  'Diary\0~|Varrock Achievements#Easy|~ Complete the Easy Achievements',
  'Diary\0~|Wilderness Achievements#Easy|~ Complete the Easy Achievements',
  'Diary\0~|Wilderness Achievements#Medium|~ Complete the Medium Achievements',
]);

function rewardMembership(definitions) {
  const freeAreas = new Set(definitions.walkableChunksF2P ?? []);
  const questMembers = new Set(Object.entries(definitions.challenges?.Quest ?? {})
    .filter(([label, reward]) => reward['Not F2P'] || reviewedMembersSources.has(`Quest\0${label}`))
    .map(([label, reward]) => reward.BaseQuest ?? plain(label).replace(/ Complete the (?:quest|miniquest|subquest)$/i, '')));
  function members(category, label, path = new Set()) {
    const key = `${category}\0${label}`, reward = definitions.challenges?.[category]?.[label];
    if (reviewedMembersSources.has(key)) return true;
    if (!reward || path.has(key)) return false;
    if (reward['Not F2P'] || questMembers.has(reward.BaseQuest)) return true;
    // Only diary claim regions: a quest's listed places do not define its mode.
    // Unknown/interior/mixed regions provide no proof of members-only access.
    if (category === 'Diary' && Array.isArray(definitions.walkableChunksF2P)
      && reward.Chunks?.length && reward.Chunks.every(id => {
        const base = String(id).split('-')[0];
        return /^[1-9]\d*$/.test(base) && Object.hasOwn(definitions.chunks ?? {}, base) && !freeAreas.has(base);
      })) return true;
    path.add(key);
    const required = Object.entries(reward.Tasks ?? {}).some(([dependency, dependencyCategory]) => members(dependencyCategory, dependency, path));
    path.delete(key);
    return required;
  }
  return members;
}

/** Expand the retained AnyxN / Skill|SkillxN notation without inventing rewards. */
export function xpRewardSlots(task, { f2p = false } = {}) {
  const slots = [];
  for (const [key, amount] of Object.entries(task.record?.XpReward ?? task.XpReward ?? {})) {
    if (skills.has(key) || !Number.isFinite(amount) || amount < 0) continue;
    const match = /^(.*)x([1-9]\d*)$/.exec(key), selector = match?.[1] ?? key;
    const count = match ? Number(match[2]) : 1;
    if (count > 100) continue;
    const allowed = selector === 'Any' ? playerControlSkills : selector.split('|');
    if (!allowed.length || allowed.some(skill => !skills.has(skill))) continue;
    for (let copy = 0; copy < count; copy++) slots.push({ index: slots.length, amount,
      selector: key, skills: allowed.filter(skill => !f2p || skill !== 'Invention') });
  }
  return slots;
}

/** Identity catalogue stays small; reward metadata has its own trusted catalogue. */
export function buildXpChoiceCatalogue(definitions, taskCatalogue) {
  const catalogue = new Map(), rows = taskCatalogue instanceof Map ? [...taskCatalogue.values()] : taskCatalogue;
  const members = rewardMembership(definitions);
  for (const task of rows ?? []) {
    const rawLabel = task.rawLabel ?? task.label;
    const reward = definitions.challenges?.[task.category]?.[rawLabel];
    if (!reward || !xpRewardSlots(reward).length) continue;
    catalogue.set(task.id, { id: task.id, label: plain(task.label), category: task.category, rawLabel,
      kind: task.category === 'Quest' ? 'quest' : 'lamp',
      members: !!(task.members || task.record?.['Not F2P'] || members(task.category, rawLabel)),
      record: { XpReward: reward.XpReward } });
  }
  return catalogue;
}

export function validateSavedXpChoices(choices) {
  if (!Array.isArray(choices) || !choices.length || choices.length > 100
    || choices.some(skill => skill !== null && !skills.has(skill))) throw new TypeError('XP choices must be an array of known skills or null');
}

export function validateXpChoices(task, choices, { f2p = false } = {}) {
  validateSavedXpChoices(choices);
  const slots = xpRewardSlots(task, { f2p });
  if (!slots.length || choices.length !== slots.length) throw new TypeError('XP choices must contain one selection per reward slot');
  if (f2p && task.members && choices.some(skill => skill !== null)) throw new TypeError('This XP reward is members-only');
  for (const slot of slots) if (choices[slot.index] !== null && !slot.skills.includes(choices[slot.index])) throw new TypeError(`Invalid skill for XP reward slot ${slot.index + 1}`);
}

export function xpChoiceAllocation(task, choices) {
  const allocation = {};
  for (const slot of xpRewardSlots(task)) {
    const skill = choices?.[slot.index];
    if (skills.has(skill) && slot.skills.includes(skill)) allocation[skill] = (allocation[skill] ?? 0) + slot.amount;
  }
  return allocation;
}

export function importedXpAllocations(state, member) {
  const raw = state.legacy?.maps?.[member.sourceMapId]?.chunkinfo?.assignedXpRewards;
  const entries = [];
  if (record(raw)) for (const [category, tasks] of Object.entries(raw)) if (record(tasks)) {
    for (const [label, allocation] of Object.entries(tasks)) if (record(allocation)) entries.push({
      category: decodeLegacyText(category), rawLabel: decodeLegacyText(label), allocation,
      path: `legacy.maps.${member.sourceMapId}.chunkinfo.assignedXpRewards.${category}.${label}` });
  }
  return entries;
}

/** Recover slots only when the imported totals have one defensible allocation.
 * Equivalent slots are visited in canonical order; genuinely different amounts
 * or constraints remain ambiguous. Bound work for malformed imported records. */
function recoverChoices(task, allocation) {
  const slots = xpRewardSlots(task), remaining = {};
  for (const [skill, raw] of Object.entries(allocation)) {
    const amount = Number(raw);
    if ((!skills.has(skill) && skill !== 'None') || !Number.isFinite(amount) || amount < 0) return { choices: slots.map(() => null), ambiguous: true };
    remaining[skill] = amount;
  }
  const solutions = [], chosen = []; let visits = 0;
  function visit(index) {
    if (++visits > 5000 || solutions.length > 1) return;
    if (index === slots.length) {
      if (Object.values(remaining).every(amount => amount === 0)) solutions.push([...chosen]);
      return;
    }
    const slot = slots[index], options = [...slot.skills, 'None'];
    for (const skill of options) {
      if (!(remaining[skill] >= slot.amount)) continue;
      const previous = slots[index - 1];
      if (previous && previous.amount === slot.amount && previous.selector === slot.selector
        && options.indexOf(skill) < options.indexOf(chosen[index - 1] ?? 'None')) continue;
      remaining[skill] -= slot.amount; chosen[index] = skill === 'None' ? null : skill;
      visit(index + 1); remaining[skill] += slot.amount;
    }
  }
  visit(0);
  return { choices: solutions.length === 1 && visits <= 5000 ? solutions[0] : slots.map(() => null), ambiguous: solutions.length !== 1 || visits > 5000 };
}

export function resolveXpChoices(state, member, task, imported = importedXpAllocations(state, member)) {
  if (Object.hasOwn(member.xpChoices ?? {}, task.id)) return { choices: [...member.xpChoices[task.id]], source: 'authored', ambiguous: false };
  const legacy = imported.find(row => row.category === task.category && row.rawLabel === (task.rawLabel ?? task.label));
  if (legacy) return { ...recoverChoices(task, legacy.allocation), source: 'imported', importedAllocation: structuredClone(legacy.allocation), importedPath: legacy.path };
  return { choices: xpRewardSlots(task).map(() => null), source: 'unset', ambiguous: false };
}

export function buildXpChoiceView(state, memberId, catalogue) {
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const f2p = state.rules?.['content.f2p'] ?? true;
  const imported = importedXpAllocations(state, member);
  const tasks = catalogue instanceof Map ? [...catalogue.values()] : catalogue ?? [];
  const rows = tasks.map(task => {
    const resolved = resolveXpChoices(state, member, task, imported);
    return { id: task.id, label: task.label, category: task.category, kind: task.kind,
      members: !!task.members, availableInMode: !(f2p && task.members), ...resolved,
      slots: xpRewardSlots(task, { f2p }).map(slot => ({ ...slot, selection: resolved.choices[slot.index] ?? null })),
      allocation: resolved.source === 'imported' ? resolved.importedAllocation : xpChoiceAllocation(task, resolved.choices) };
  });
  for (const entry of imported) if (!tasks.some(task => task.category === entry.category && (task.rawLabel ?? task.label) === entry.rawLabel)) {
    rows.push({ id: null, label: plain(entry.rawLabel), category: entry.category,
      kind: entry.category === 'Quest' ? 'quest' : 'lamp', unknownSource: true, availableInMode: false,
      source: 'imported', ambiguous: true, importedAllocation: structuredClone(entry.allocation),
      importedPath: entry.path, allocation: structuredClone(entry.allocation), slots: [], choices: [] });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label) || String(a.id).localeCompare(String(b.id)));
  return { memberId, f2p: !!f2p, rows };
}
