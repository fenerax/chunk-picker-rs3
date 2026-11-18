import { unknownDropContext, addUnknownDropWarnings } from './unknown-drop-warnings.mjs';
import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts } from './migration.mjs';
import { equipmentTaskIdentity, selectEquipmentRecommendations, buildEquipmentCatalogue, equipmentMembersOnly, membersEquipmentRequirement } from './presentation.mjs';
import { primaryEquipmentSource } from './rates.mjs';
import { permanentTaskId } from './identity.mjs';
import { isNonPermanentEquipment } from '../data/equipment-permanence.mjs';
import { taskItemMembershipBlockers } from './membership.mjs';
import { recordedEquipment as personalEquipmentRecords } from './recorded-equipment.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';
export { buildEquipmentCatalogue } from './presentation.mjs';

// Authored coupled equipment selection over the engine's eligible equipment only.
const enabled = (rules, name, fallback = true) => taskRuleEnabled(rules, name, fallback);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const decoded = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, child]) => [decodeLegacyText(key), child]));
const unique = values => [...new Set(values)];
const epsilon = 1e-8;
const weaponSlots = new Set(['main hand weapon', 'off-hand weapon', '2h weapon']);
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const compareScores = (a, b) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (b[index] ?? 0) - (a[index] ?? 0);
  return 0;
};

function declarativeSpecialists(result, rules, definitions, reuse = true) {
  // These are exactly the category predicates consumed below. Other tasks
  // cannot contribute specialist rows, so their membership work is unnecessary.
  const candidate = row => {
    const tags = list(row.record?.Category);
    return tags.includes('BIS Skilling') || tags.some(tag => ['BIS Skilling Relics', 'PvM Relics'].includes(tag))
      || row.category === 'Extra' && tags.some(tag => ['Permanent Unlockables', 'Unlock Abilities', 'Unlock Prayers'].includes(tag));
  };
  result = { ...result, tasks: (result.tasks ?? []).filter(row => (!reuse || candidate(row)) && row.obligation !== false && (!rules.F2P ||
    !row.record?.['Not F2P'] && row.record?.members !== true && !row.blockers?.some(blocker => blocker.kind === 'membership') &&
    !membersEquipmentRequirement(row, row.record ?? {}, definitions) &&
    taskItemMembershipBlockers(row.record ?? {}, row.category, definitions, row.rawLabel ?? row.label).length === 0)) };
  const summary = row => ({ id: row.id, evidenceTaskId: row.id, label: row.label, status: row.status, personalCompleted: !!row.personalCompleted,
    challengeSatisfied: !!row.challengeSatisfied, priority: Number.isFinite(Number(row.record?.Priority)) ? Number(row.record.Priority) : null,
    items: list(row.record?.Items), categories: list(row.record?.Category) });
  const isRelic = row => list(row.record?.Category).some(tag => ['BIS Skilling Relics', 'PvM Relics'].includes(tag));
  const skilling = (result.tasks ?? []).filter(row => list(row.record?.Category).includes('BIS Skilling') && !isRelic(row));
  const sets = new Map();
  for (const row of skilling) if (row.record.Set) { const group = sets.get(row.record.Set) ?? []; group.push(row); sets.set(row.record.Set, group); }
  const reachable = row => row.status === 'available' || row.blockers?.length > 0 && row.blockers.every(blocker => blocker.kind === 'outclassed');
  return {
    skilling: { enabled: enabled(rules, 'BIS Skilling'), sets: [...sets].map(([name, rows]) => {
      const candidates = rows.filter(reachable).map(summary).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || a.label.localeCompare(b.label));
      const ranked = candidates.length > 0 && candidates.every(row => row.priority !== null);
      const best = ranked ? candidates.filter(row => row.priority === candidates[0].priority) : [];
      return { name, ranked, best, alternatives: candidates.filter(row => !best.includes(row)), unavailable: rows.filter(row => !reachable(row)).map(summary),
        comparison: ranked ? 'Lower declared Priority wins within this explicit equipment Set; equal priorities remain alternatives.' : 'No complete declared priority ranking is available for this set.' };
    }), unranked: skilling.filter(row => !row.record.Set).map(summary),
    explanation: 'Skilling tools use the equipment sets and priorities recorded in the game data. Convenience upgrades are separate goals. The BIS Skilling rule controls active goals; comparisons remain visible here.' },
    relics: { enabled: enabled(rules, 'BIS Skilling') && enabled(rules, 'BIS Skilling Relics'), tasks: (result.tasks ?? []).filter(isRelic).map(summary), coverage: { limitations: ['Relic availability and prerequisites only. The dataset does not declare relic-energy budgets, simultaneous activation limits or an optimal relic combination.'] } },
    misc: { tasks: (result.tasks ?? []).filter(row => row.category === 'Extra' && list(row.record?.Category).some(tag => ['Permanent Unlockables', 'Unlock Abilities', 'Unlock Prayers'].includes(tag))).map(summary),
      explanation: 'Declared permanent, ability and prayer unlock goals have distinct effects. They are listed with prerequisites rather than assigned a shared equipment score.' },
  };
}

function equipmentContextIndex(result, state, personalResult, definitions = {}) {
  const ownersByBase = new Map();
  for (const member of state.members) for (const base of member.unlocked ?? []) {
    const owners = ownersByBase.get(base) ?? [];
    owners.push(member.id); ownersByBase.set(base, owners);
  }
  const catalogue = buildEquipmentCatalogue(definitions);
  const facts = new Map(state.members.map(member => [member.id, projectMemberTaskFacts(state, member, catalogue)]));
  return { tasks: new Map((result.tasks ?? []).map(task => [task.id, task])), ownersByBase, facts,
    completed: new Map([...facts].map(([id, member]) => [id, new Set(member.completedTasks ?? [])])),
    personalEquipment: personalResult ? new Set((personalResult.equipment ?? []).map(row => row.name)) : null };
}

/** Explain a goal's geography and challenge obligation independently of possession. */
export function equipmentContext(row, result, state, memberId, definitions = {}, personalResult, index = equipmentContextIndex(result, state, personalResult, definitions)) {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const data = definitions.equipment?.[row.name] ?? {};
  const identity = equipmentTaskIdentity(row.name, data);
  const scope = state.rules?.['tasks.completion'] ?? 'any';
  const completedBy = state.members.filter(owner => index.completed.get(owner.id).has(identity.id) || index.facts.get(owner.id).taskStatus?.[identity.id]?.challengeCompleted).map(owner => owner.id);
  const owners = scope === 'personal' ? [member] : state.members;
  const challengeSatisfied = scope === 'all' ? owners.every(owner => completedBy.includes(owner.id)) : owners.some(owner => completedBy.includes(owner.id));
  const duplicateGrindRequired = scope === 'any' ? !challengeSatisfied : !completedBy.includes(memberId);
  const tasks = index.tasks;
  const locations = new Set();
  const visit = (sources, seen = new Set()) => {
    for (const source of sources ?? []) {
      if (source.location) locations.add(String(source.location));
      for (const location of source.locations ?? []) locations.add(String(location));
      if (source.kind === 'chunks' && source.name) locations.add(String(source.name));
      const id = source.taskId ?? (source.category && source.task ? permanentTaskId(source.category, source.task) : null);
      if (id && !seen.has(id)) { seen.add(id); visit(tasks.get(id)?.sources, seen); }
    }
  };
  visit(row.sources);
  const personalLocations = [], sharedLocations = [], connectedAreas = [];
  for (const location of locations) {
    const base = location.split('-')[0];
    const owningMembers = index.ownersByBase.get(base) ?? [];
    if (!owningMembers.length) connectedAreas.push(location);
    else if (owningMembers.includes(memberId)) personalLocations.push(location);
    else sharedLocations.push({ location, memberIds: owningMembers });
  }
  const personalAccess = index.personalEquipment ? index.personalEquipment.has(row.name) : null;
  return { sourceAccess: { personalAccess, personalLocations, sharedLocations, connectedAreas,
    explanation: personalAccess === false ? 'Obtainable using shared unlocked access; this does not mean another member obtained or equipped it.' : 'Sources show where this member can obtain the item; access does not establish ownership.' },
    challenge: { scope, personalCompleted: index.completed.get(memberId).has(identity.id), satisfiedBy: completedBy, challengeSatisfied,
      duplicateGrindRequired, groupRequirementPending: !challengeSatisfied,
      explanation: challengeSatisfied ? 'This challenge is already satisfied under the group completion rule. Another obtain grind is not required for the challenge.' : !duplicateGrindRequired ? 'This member has satisfied their part. The group completion rule still requires another member’s completion.' : 'This is an obtainable equipment goal. The completion rule determines who must satisfy the challenge.' },
    rewardSharing: 'Personal quest and achievement progress stays personal. The dataset does not identify item tradeability; access and challenge completion do not establish a transferable reward.' };
}

/** A current-BiS view has obtainable goals and recorded personal facts, never an
 * inferred inventory. Legacy manualEquipment adds sources, not ownership. */
export function buildCurrentBiS(result, planning, state, memberId, definitions = {}, personalResult) {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const index = equipmentContextIndex(result, state, personalResult, definitions), contexts = new Map();
  const f2p = state.rules?.['content.f2p'] ?? true;
  const allRecordedObtained = personalEquipmentRecords(index.facts.get(memberId), definitions);
  const membershipAllowed = name => !f2p || !equipmentMembersOnly(name, definitions.equipment?.[name]);
  // Hand records remain removable even when membership excludes their ranking.
  const recordedObtained = allRecordedObtained.filter(item => membershipAllowed(item.name) || item.addedByHand);
  const rankableRecords = allRecordedObtained.filter(item => membershipAllowed(item.name));
  const membershipExcludedRecorded = allRecordedObtained.filter(item => !membershipAllowed(item.name)).map(item => ({ name: item.name,
    reason: 'This item requires membership in free-to-play mode. The saved personal obtain record is preserved.' }));
  const legacy = state.legacy?.maps?.[member.sourceMapId]?.chunkinfo ?? {};
  const allImportedSelections = Object.entries(decoded(legacy.manualEquipment)).filter(([, value]) => value).map(([name]) => ({ name,
    meaning: 'Additional obtainable source override; ownership unconfirmed.' }));
  const excludedImportedSelections = allImportedSelections.filter(item => !membershipAllowed(item.name)).map(item => ({ name: item.name,
    reason: 'This item requires membership in free-to-play mode. The saved source override is preserved.' }));
  const contextualize = values => values.map(value => {
    const name = value.equipment.name;
    if (!contexts.has(name)) contexts.set(name, equipmentContext(value.equipment, result, state, memberId, definitions, personalResult, index));
    return { ...value, ...contexts.get(name) };
  });
  const contextualizeSpecialists = value => value ? { ...value,
    tank: { ...value.tank, recommendations: contextualize(value.tank.recommendations) },
    weight: { ...value.weight, recommendations: contextualize(value.weight.recommendations) } } : undefined;
  const recommendations = contextualize(planning.recommendations);
  const recordedNames = new Set(rankableRecords.map(item => item.name));
  const recordedEquipment = (result.equipment ?? []).filter(item => recordedNames.has(item.name)).map(item => ({ ...item, obligation: true }));
  const eligibleRecordedNames = new Set(recordedEquipment.map(item => item.name));
  const excludedRecordedItems = [...membershipExcludedRecorded, ...rankableRecords.filter(item => !eligibleRecordedNames.has(item.name)).map(item => ({ name: item.name,
    reason: 'You recorded obtaining this item, but the picker cannot currently confirm a reachable source and that you can equip it.' }))];
  const recordedPlanning = evaluateEquipment({ ...result, equipment: recordedEquipment,
    tasks: (result.tasks ?? []).filter(task => index.completed.get(memberId).has(task.id) || eligibleRecordedNames.has(task.equipmentName)) }, state, memberId, definitions);
  const recordedBest = { loadouts: recordedPlanning.loadouts, recommendations: contextualize(recordedPlanning.recommendations),
    specialist: contextualizeSpecialists(recordedPlanning.specialist),
    diagnostics: [...recordedPlanning.diagnostics, ...excludedRecordedItems.map(item => ({ kind: 'recorded-equipment-currently-ineligible', item: item.name, detail: item.reason }))],
    coverage: { ...recordedPlanning.coverage, eligibleRecordedItems: recordedEquipment.length, excludedRecordedItems,
      scope: 'Best among personally recorded obtainable gear; current possession, equipped slots and current levels are unconfirmed.',
      limitations: [...recordedPlanning.coverage.limitations, 'Comparisons use items you recorded obtaining and can currently obtain and equip. Ammunition needs its own obtain record. Challenge ticks and your partner’s records do not add gear to your account.'] } };
  return { memberId, accessPolicy: state.rules?.['access.shared'] === false ? 'personal' : 'shared', completionScope: state.rules?.['tasks.completion'] ?? 'any',
    obtainable: { loadouts: planning.loadouts, recommendations, specialist: contextualizeSpecialists(planning.specialist) },
    owned: { known: false, items: [], recordedObtained, recordedBest, explanation: 'No current equipment or inventory has been recorded. Obtainable BiS is a recommendation, not the gear this character wears.' },
    importedSelections: allImportedSelections.filter(item => membershipAllowed(item.name)),
    coverage: { ...planning.coverage, ...(excludedImportedSelections.length || membershipExcludedRecorded.length ? {
      excludedImportedSelections, membershipExcludedRecordedItems: membershipExcludedRecorded,
      savedImportedSelectionCount: allImportedSelections.length, savedRecordedObtainCount: allRecordedObtained.length,
    } : {}) } };
}

/** Normalize declarative tiers without mutating imported definitions. These are
 * picker ranking units, not a prediction of damage per second against a target. */
export function equipmentPower(data, { offhand = false, augmentation = false } = {}) {
  const tier = number(data.tier);
  const damage = number(data.damage_tier) || (number(data.ability_damage) > 0 ? tier : 0);
  const accuracy = number(data.accuracy_tier) || (number(data.accuracy) > 0 ? tier : 0);
  const bonus = (offhand ? 0.5 : 1) * ((augmentation && data.can_augment ? 10 : 0) + (data.has_spec ? 2 : 0) + (data.has_passive ? 5 : 0));
  return { damage, accuracy, bonus };
}

export function evaluateEquipment(result, state, memberId, definitions = {}, { reuse = true } = {}) {
  const identityCatalogue = buildEquipmentCatalogue(definitions);
  const facts = new Map(state.members.map(owner => [owner.id, projectMemberTaskFacts(state, owner, identityCatalogue)]));
  const member = facts.get(memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const legacyMap = state.legacy?.maps?.[member.sourceMapId] ?? {};
  const legacy = legacyMap.chunkinfo ?? {};
  const migrated = hasGameplayMigration(state, member);
  const rules = { ...(!migrated ? decoded(legacyMap.rules) : {}), ...state.taskRules, ...member.taskRules, F2P: state.rules?.['content.f2p'] ?? true };
  const equipmentDefinitions = definitions.equipment ?? {};
  const diagnostics = [], loadouts = [], recommendations = [], alternatives = {}, upgradePaths = [];
  const byName = new Map();
  const flags = (owner, field, identity) => owner.taskStatus?.[identity.id]?.[field];
  const backlogged = (name, data) => {
    const identity = equipmentTaskIdentity(name, data);
    const authored = flags(member, 'backlogged', identity);
    if (authored !== undefined || migrated) return !!authored;
    const old = decoded(decoded(legacy.backlog).BiS);
    return Object.hasOwn(old, identity.rawLabel) || Object.hasOwn(old, identity.rawLabel.replace(/#/g, '/'));
  };
  for (const row of result.equipment ?? []) {
    const data = equipmentDefinitions[row.name];
    if (!data) { diagnostics.push({ kind: 'missing-equipment-definition', item: row.name }); continue; }
    if (rules.F2P && equipmentMembersOnly(row.name, data)) {
      diagnostics.push({ kind: 'f2p-members-equipment-excluded', item: row.name, detail: 'This equipment requires membership in free-to-play mode.' });
      continue;
    }
    if (!enabled(rules, 'Non-permanent BiS') && isNonPermanentEquipment(row.name, data)) continue;
    if (backlogged(row.name, data)) continue;
    if (enabled(rules, 'Consumable Primary BiS', false) && data.is_consumable && !row.sources?.some(source => primaryEquipmentSource(source, rules))) continue;
    byName.set(row.name, { ...row, slot: data.slot ?? row.slot, data,
      power: equipmentPower(data, { offhand: data.slot === 'off-hand weapon', augmentation: result.access?.areas?.includes('Invention Guild') }) });
  }
  const ownRows = [...byName.values()].filter(row => row.obligation !== false);
  const ordinary = selectEquipmentRecommendations({ ...result, equipment: ownRows }, { ...rules, ...(!enabled(rules, 'BIS') ? { 'Show Best in Slot Tasks': false } : {}) }, definitions);
  // Coupled rows are handled below, so the ordinary helper's corresponding
  // unsupported diagnostics no longer apply to this combined result.
  diagnostics.push(...ordinary.diagnostics.filter(value => !/Coupled weapon/.test(value.detail ?? '')));
  const tasks = new Map(ordinary.catalogue.map(task => [task.id, { ...task, equipmentGoals: [...task.equipmentGoals], record: { ...task.record } }]));
  const selected = new Set(ordinary.tasks.map(task => task.id));
  Object.assign(alternatives, ordinary.alternatives);
  recommendations.push(...ordinary.recommendations);
  const eligibleCount = ownRows.length;
  const recordedIds = new Set(member.completedTasks ?? []);
  const recordedEquipmentNames = new Set([...byName].filter(([name, row]) => recordedIds.has(equipmentTaskIdentity(name, row.data).id) || member.obtainedEquipment?.includes(name)).map(([name]) => name));
  const recordedItem = name => recordedEquipmentNames.has(name);
  const addLoadoutPaths = (style, candidates, comparison) => {
    for (const mode of unique(candidates.map(row => row.mode))) {
      const values = candidates.filter(row => row.mode === mode);
      const recorded = values.find(row => row.items.every(recordedItem));
      const tiers = new Map();
      for (const value of values) if (!recorded || value.score >= recorded.score) {
        const peers = tiers.get(value.score) ?? []; peers.push(value); tiers.set(value.score, peers);
      }
      if (tiers.size > 1) upgradePaths.push({ kind: 'loadout', style, slot: mode, mode, comparison, recordedStart: recorded?.items ?? null,
        steps: [...tiers].sort(([a], [b]) => a - b).map(([score, peers]) => { const chosen = peers.find(row => row.items.every(recordedItem)) ?? peers[0]; return { score, items: chosen.items, components: chosen.components, alternativeCount: peers.length - 1 }; }),
        explanation: 'Each score tier shows one complete compatible loadout, with the count of equal-score alternatives. It is a comparison order, not a crafting recipe or current equipment report.' });
    }
  };
  const styles = enabled(rules, 'Show Best in Slot Melee Style Tasks', false) ? ['Stab', 'Slash', 'Crush', 'Ranged', 'Magic'] : ['Melee', 'Ranged', 'Magic'];
  // F2P Necromancy trial eligibility is decided by the engine's level-20 cap.
  // Engine-confirmed trial weapons must not disappear at presentation time.
  if (ownRows.some(row => row.data.class === 'necromancy' && weaponSlots.has(row.slot))) styles.push('Necromancy');
  if (enabled(rules, 'Show Best in Slot Prayer Tasks') && enabled(rules, 'BIS Prayer')) styles.push('Prayer');
  const classOf = style => ['Stab', 'Slash', 'Crush'].includes(style) ? 'melee' : style.toLowerCase();
  const matches = (row, style) => (style === 'Prayer' || ['none', 'hybrid', 'all', classOf(style)].includes(row.data.class)) && (!['Stab', 'Slash', 'Crush'].includes(style) || !weaponSlots.has(row.slot) || row.data.style === style.toLowerCase());
  const ammoFor = row => {
    const selectors = Object.entries(definitions.codeItems?.ammoTools ?? {}).filter(([, weapons]) => Object.hasOwn(weapons, row.name)).map(([selector]) => selector.replace(/\*/g, ''));
    if (selectors.includes('No ammo')) return { required: false, names: [] };
    const names = unique(selectors.flatMap(selector => definitions.codeItems?.itemsPlus?.[selector] ?? [selector])).filter(name => byName.has(name));
    return { required: selectors.length > 0, names };
  };
  const prepare = row => ({ ...row, ammunition: ammoFor(row) });
  const usable = (row, style) => {
    if (style !== 'Prayer' && (row.power.damage <= 0 || row.slot !== 'off-hand weapon' && row.power.accuracy <= 0)) return false;
    if (row.ammunition.required && !row.ammunition.names.length) {
      diagnostics.push({ kind: 'unavailable-ammunition', item: row.name, detail: 'No compatible ammunition you can use is obtainable from reachable sources.' });
      return false;
    }
    return true;
  };
  const ammoOptions = weapons => {
    const needing = weapons.filter(row => row.ammunition.required);
    if (!needing.length) return [null];
    return needing[0].ammunition.names.filter(name => needing.every(row => row.ammunition.names.includes(name)))
      .sort((a, b) => byName.get(b).power.damage - byName.get(a).power.damage || a.localeCompare(b));
  };
  const cappedDamage = (row, ammo) => row.ammunition.required ? Math.min(row.power.damage, byName.get(ammo).power.damage) : row.power.damage;
  const describe = (style, mode, main, secondary, ammo) => {
    const twoHanded = mode === 'two-handed';
    const mainDamage = cappedDamage(main, ammo);
    const offDamage = secondary?.slot === 'off-hand weapon' ? cappedDamage(secondary, ammo) : 0;
    const accuracy = main.power.accuracy;
    const shieldAccuracy = secondary?.slot === 'off-hand' ? secondary.power.accuracy : 0;
    const damage = twoHanded ? mainDamage : (2 / 3) * mainDamage + (1 / 3) * offDamage;
    const bonus = twoHanded ? main.power.bonus : (2 / 3) * main.power.bonus + (1 / 3) * (secondary?.slot === 'off-hand weapon' ? secondary.power.bonus : 0);
    return { style, mode, mainHand: main.name, offHand: secondary?.name ?? null, ammunition: ammo,
      score: style === 'Prayer' ? number(main.data.prayer) + number(secondary?.data.prayer) : 0.85 * (accuracy + shieldAccuracy) + damage + bonus,
      components: { accuracy, shieldAccuracy, damage, bonus },
      defence: { armour: number(secondary?.data.armour), lifePoints: number(secondary?.data.lp) },
      items: unique([main.name, secondary?.name, ammo].filter(Boolean)) };
  };
  const addTask = (name, goal, chosen) => {
    const row = byName.get(name);
    if (!row || row.obligation === false || name === 'Unarmed') return null;
    // A loadout can need ammunition or a defensive companion that supplies no
    // Prayer bonus. That component is not itself a Prayer obtain duty.
    if (goal.startsWith('Prayer ') && number(row.data.prayer) <= 0) return null;
    const identity = equipmentTaskIdentity(name, row.data);
    let task = tasks.get(identity.id);
    if (!task) {
      const requirements = Object.entries(row.data.requirements ?? {}).map(([skill, level]) => ({ skill, level,
        derivedLevel: result.training?.[skill]?.level ?? null, primaryTraining: !!result.training?.[skill]?.primary }));
      const training = requirements.filter(value => value.level > 1).map(value => `${value.skill} ${value.level}${value.primaryTraining ? ' (reachable training)' : ''}`).join(', ');
      task = { ...identity, generated: true, equipmentName: name, equipmentGoals: [], level: 1, primary: false,
        status: 'available', blockers: [], hidden: false, hiddenReasons: [], sources: row.sources ?? [],
        personalCompleted: false, challengeSatisfied: false,
        record: { Items: [name], ItemsDetails: [name], Category: ['BIS'], Label: '' },
        equipRequirements: requirements, maintenance: row.data.charges ? { charges: number(row.data.charges) } : null,
        explanation: `You can obtain and equip this item.${training ? ` Equip requirements: ${training}.` : ''} Equipment comparisons use damage and accuracy tiers, compatible ammunition and recorded special or passive bonuses.${row.data.charges ? ` Degrades after ${row.data.charges} charges; upkeep is not subtracted from the picker score.` : ''}`,
        wiki: `https://runescape.wiki/w/${encodeURIComponent(name.replace(/#/g, '/'))}` };
      tasks.set(task.id, task);
    }
    task.equipmentGoals = unique([...task.equipmentGoals, goal]);
    task.record.Label = task.equipmentGoals.join(' / ');
    if (chosen) selected.add(task.id);
    return task.id;
  };
  if (enabled(rules, 'Show Best in Slot Tasks') && enabled(rules, 'BIS')) for (const style of styles) {
    const weapons = ownRows.filter(row => weaponSlots.has(row.slot) && matches(row, style) && (style !== 'Prayer' || number(row.data.prayer) > 0)).map(prepare).filter(row => usable(row, style));
    const mains = weapons.filter(row => row.slot === 'main hand weapon');
    const offhands = weapons.filter(row => row.slot === 'off-hand weapon');
    const twohands = weapons.filter(row => row.slot === '2h weapon');
    const shields = ownRows.filter(row => row.slot === 'off-hand' && matches(row, style) && (style !== 'Prayer' || number(row.data.prayer) > 0));
    const candidates = [];
    for (const main of twohands) for (const ammo of ammoOptions([main])) candidates.push(describe(style, 'two-handed', main, null, ammo));
    for (const main of mains) {
      for (const ammo of ammoOptions([main])) candidates.push(describe(style, 'one-handed', main, null, ammo));
      for (const offhand of offhands) for (const ammo of ammoOptions([main, offhand])) candidates.push(describe(style, 'dual-wield', main, offhand, ammo));
      for (const shield of shields) for (const ammo of ammoOptions([main])) candidates.push(describe(style, 'shield', main, shield, ammo));
    }
    // Exact ties go to the two-handed weapon: one item to get instead of two, and the original picker lands on the 2h for equal gravite tiers.
    candidates.sort((a, b) => (Math.abs(b.score - a.score) > epsilon ? b.score - a.score : 0) || b.defence.armour - a.defence.armour || b.defence.lifePoints - a.defence.lifePoints || Number(b.mode === 'two-handed') - Number(a.mode === 'two-handed') || a.items.join('|').localeCompare(b.items.join('|')));
    if (!candidates.length || style === 'Prayer' && candidates[0].score <= 0) continue;
    addLoadoutPaths(style, candidates, style === 'Prayer' ? 'Combined prayer bonus of compatible hands.' : 'Complete weapon loadout score, with compatible ammunition and both hands coupled.');
    const best = candidates[0];
    const winners = [best];
    if (enabled(rules, 'Show Best in Slot 1H and 2H', false)) {
      const other = candidates.find(value => (value.mode === 'two-handed') !== (best.mode === 'two-handed'));
      if (other) winners.push(other);
    }
    if (enabled(rules, 'Show Best in Slot Shield', false)) {
      const shield = candidates.find(value => value.mode === 'shield');
      if (shield && !winners.includes(shield)) winners.push(shield);
    }
    const modes = new Set(winners.map(value => value.mode));
    const summaries = [];
    for (const winner of winners) {
      const peers = candidates.filter(value => value.mode === winner.mode && Math.abs(value.score - winner.score) < epsilon && value.defence.armour === winner.defence.armour && value.defence.lifePoints === winner.defence.lifePoints);
      for (const peer of peers) for (const name of peer.items) {
        const slot = byName.get(name).slot;
        addTask(name, `${style} BiS ${slot}`, peer === winner);
      }
      const winnerIds = winner.items.map(name => addTask(name, `${style} BiS ${byName.get(name).slot}`, true)).filter(Boolean);
      for (const id of winnerIds) {
        const slot = byName.get(tasks.get(id).equipmentName).slot;
        const peerIds = peers.flatMap(value => value.items).filter(name => byName.get(name).slot === slot).map(name => equipmentTaskIdentity(name, byName.get(name).data).id);
        alternatives[id] = unique([...(alternatives[id] ?? []), ...peerIds.filter(value => !winnerIds.includes(value))]);
      }
      summaries.push({ ...winner, taskIds: winnerIds, alternatives: peers.filter(value => value !== winner).map(value => ({ items: value.items, score: value.score })) });
      for (const name of winner.items.filter(name => byName.get(name).obligation !== false && (style !== 'Prayer' || number(byName.get(name).data.prayer) > 0))) recommendations.push({ style, slot: byName.get(name).slot, equipment: byName.get(name), score: [winner.score], loadoutMode: winner.mode,
        alternatives: unique(peers.flatMap(value => value.items).filter(other => other !== name && byName.get(other).slot === byName.get(name).slot)) });
    }
    loadouts.push({ style, best: summaries[0], selected: summaries, tradeoffs: candidates.filter(value => !modes.has(value.mode)).filter((value, index, entries) => entries.findIndex(peer => peer.mode === value.mode) === index).map(value => ({ ...value, scoreDifference: best.score - value.score })) });
  }
  const specialist = { ...declarativeSpecialists(result, rules, definitions, reuse), tank: { enabled: enabled(rules, 'Show Best in Slot Defensive Tasks', false), recommendations: [], loadouts: [] }, weight: { enabled: enabled(rules, 'Show Best in Slot Weight Tasks', false), recommendations: [], coverage: {} }, upgradePaths };
  const addSlotComparison = (style, rows, score, comparison, target) => {
    const groups = new Map();
    for (const row of rows) { const group = groups.get(row.slot) ?? []; group.push({ row, score: score(row) }); groups.set(row.slot, group); }
    for (const [slot, values] of groups) {
      values.sort((a, b) => compareScores(a.score, b.score) || a.row.name.localeCompare(b.row.name));
      const best = values[0], peers = values.filter(value => compareScores(value.score, best.score) === 0);
      const recommendation = { style, slot, equipment: best.row, score: best.score, alternatives: peers.slice(1).map(value => value.row.name), comparison };
      target.push(recommendation);
      if (!recommendations.some(value => value.style === style && value.slot === slot)) recommendations.push(recommendation);
      const chosenId = addTask(best.row.name, `${style} BiS ${slot}`, true);
      for (const peer of peers.slice(1)) { const id = addTask(peer.row.name, `${style} BiS ${slot}`, false); if (chosenId && id) alternatives[chosenId] = unique([...(alternatives[chosenId] ?? []), id]); }
      const groupsByScore = [];
      for (const value of values.slice().reverse()) {
        const previous = groupsByScore.at(-1);
        if (previous && compareScores(previous.score, value.score) === 0) previous.items.push(value.row.name);
        else groupsByScore.push({ score: value.score, items: [value.row.name] });
        if (!tasks.has(equipmentTaskIdentity(value.row.name, value.row.data).id)) addTask(value.row.name, `${style} upgrade candidate ${slot}`, false);
      }
      const recorded = values.find(value => recordedItem(value.row.name));
      const steps = groupsByScore.filter(value => !recorded || compareScores(value.score, recorded.score) <= 0);
      if (steps.length > 1) upgradePaths.push({ kind: 'slot', style, slot, comparison, recordedStart: recorded?.row.name ?? null, steps,
        explanation: 'This orders currently obtainable choices by the declared comparison. It is not a crafting recipe or evidence of current possession.' });
    }
  };
  const ordinaryRows = ownRows.filter(row => !weaponSlots.has(row.slot) && !['ammo', 'off-hand'].includes(row.slot));
  // Ordinary/prayer upgrade tiers use the same lexicographic score as the
  // presentation selector. Calling with a detached target does not add winners.
  const ordinaryRecommendations = recommendations.slice();
  for (const recommendation of ordinaryRecommendations.filter(value => !value.loadoutMode)) {
    const { style, slot } = recommendation;
    const rows = ordinaryRows.filter(row => row.slot === slot && matches(row, style) && (style === 'Prayer' ? number(row.data.prayer) > 0 : number(row.data[`${style.toLowerCase()}_damage`]) >= 0));
    addSlotComparison(style, rows, row => style === 'Prayer' ? [number(row.data.prayer)] : [number(row.data[`${style.toLowerCase()}_damage`]) + 0.15 * number(row.data[`${style.toLowerCase()}_accuracy`]), number(row.data.armour), number(row.data.lp)], style === 'Prayer' ? 'Higher declared prayer bonus wins.' : 'Damage plus 0.15 × accuracy, then armour, then life points.', []);
  }
  if (enabled(rules, 'BIS') && enabled(rules, 'Show Best in Slot Tasks') && enabled(rules, 'Show Best in Slot Defensive Tasks', false)) {
    const tankStyles = ['Melee', 'Ranged', 'Magic'];
    if (ownRows.some(row => row.data.class === 'necromancy')) tankStyles.push('Necromancy');
    for (const style of tankStyles) {
      const matching = ownRows.filter(row => matches(row, style) && number(row.data[`${style.toLowerCase()}_damage`]) >= 0);
      addSlotComparison(`${style} Tank`, matching.filter(row => !weaponSlots.has(row.slot) && !['ammo', 'off-hand'].includes(row.slot) && number(row.data.armour) + number(row.data.lp) > 0), row => [number(row.data.armour), number(row.data.lp)], 'Higher armour wins; life points break armour ties.', specialist.tank.recommendations);
      const slotCandidates = slot => {
        const values = matching.filter(row => row.slot === slot && number(row.data.armour) + number(row.data.lp) > 0);
        values.sort((a, b) => compareScores([number(a.data.armour), number(a.data.lp)], [number(b.data.armour), number(b.data.lp)]) || a.name.localeCompare(b.name));
        return values.length ? values.filter(row => number(row.data.armour) === number(values[0].data.armour) && number(row.data.lp) === number(values[0].data.lp)) : [];
      };
      const mains = slotCandidates('main hand weapon');
      const secondary = [...slotCandidates('off-hand'), ...slotCandidates('off-hand weapon')];
      const twohands = slotCandidates('2h weapon');
      const candidates = [];
      const candidate = (main, offhand, mode) => {
        const items = [main, offhand].filter(Boolean), armour = items.reduce((sum, row) => sum + number(row.data.armour), 0), lifePoints = items.reduce((sum, row) => sum + number(row.data.lp), 0);
        if (armour + lifePoints > 0) candidates.push({ style: `${style} Tank`, mode, mainHand: main?.name ?? null, offHand: offhand?.name ?? null, ammunition: null,
          score: armour + lifePoints, components: { armour, lifePoints }, defence: { armour, lifePoints }, items: items.map(row => row.name) });
      };
      for (const main of twohands) candidate(main, null, 'two-handed');
      for (const offhand of secondary) {
        if (!mains.length) candidate(null, offhand, 'shield-only');
        for (const main of mains) candidate(main, offhand, offhand.slot === 'off-hand' ? 'shield' : 'dual-wield');
      }
      for (const main of mains) candidate(main, null, 'one-handed');
      candidates.sort((a, b) => b.score - a.score || b.defence.armour - a.defence.armour || b.defence.lifePoints - a.defence.lifePoints || a.items.join('|').localeCompare(b.items.join('|')));
      if (!candidates.length) continue;
      addLoadoutPaths(`${style} Tank`, candidates, 'Slot winners use armour then life points; compatible hand modes compare total armour + life points.');
      const best = candidates[0], winners = [best];
      if (enabled(rules, 'Show Best in Slot 1H and 2H', false)) { const other = candidates.find(row => (row.mode === 'two-handed') !== (best.mode === 'two-handed')); if (other) winners.push(other); }
      if (enabled(rules, 'Show Best in Slot Shield', false)) { const shield = candidates.find(row => row.mode === 'shield' || row.mode === 'shield-only'); if (shield && !winners.includes(shield)) winners.push(shield); }
      const selectedLoadouts = winners.map(winner => {
        const peers = candidates.filter(row => row.mode === winner.mode && row.score === winner.score && row.defence.armour === winner.defence.armour && row.defence.lifePoints === winner.defence.lifePoints);
        for (const peer of peers) for (const name of peer.items) addTask(name, `${style} Tank BiS ${byName.get(name).slot}`, peer === winner);
        const taskIds = winner.items.map(name => addTask(name, `${style} Tank BiS ${byName.get(name).slot}`, true)).filter(Boolean);
        for (const name of winner.items) {
          const slot = byName.get(name).slot, otherNames = unique(peers.flatMap(row => row.items).filter(other => other !== name && byName.get(other).slot === slot));
          const id = equipmentTaskIdentity(name, byName.get(name).data).id;
          alternatives[id] = unique([...(alternatives[id] ?? []), ...otherNames.map(other => equipmentTaskIdentity(other, byName.get(other).data).id)]);
          const rec = { style: `${style} Tank`, slot, equipment: byName.get(name), score: [winner.score], loadoutMode: winner.mode, alternatives: otherNames, comparison: 'Coupled hand defence compares total armour + life points, as in the reference picker.' };
          specialist.tank.recommendations.push(rec); recommendations.push(rec);
        }
        return { ...winner, taskIds, alternatives: peers.filter(row => row !== winner).map(row => ({ items: row.items, score: row.score })) };
      });
      const loadout = { style: `${style} Tank`, best: selectedLoadouts[0], selected: selectedLoadouts, tradeoffs: candidates.filter(row => !winners.some(winner => winner.mode === row.mode)).filter((row, index, rows) => rows.findIndex(other => other.mode === row.mode) === index).map(row => ({ ...row, scoreDifference: best.score - row.score })) };
      specialist.tank.loadouts.push(loadout); loadouts.push(loadout);
    }
  }
  const weightRows = ownRows.filter(row => Object.hasOwn(row.data, 'weight') && Number.isFinite(Number(row.data.weight)));
  specialist.weight.coverage = { declaredWeightRecords: Object.values(equipmentDefinitions).filter(data => Object.hasOwn(data, 'weight') && Number.isFinite(Number(data.weight))).length,
    eligibleWeightRecords: weightRows.length, supported: weightRows.length > 0,
    explanation: weightRows.length ? 'The lightest item with a recorded weight wins in each ordinary equipment slot. Weapon and off-hand combinations need a separate compatible equipment set.' : 'No obtainable, usable item has a recorded weight. The picker cannot compare weight using names, tiers or armour alone.' };
  if (enabled(rules, 'Show Best in Slot Weight Tasks', false) && enabled(rules, 'Show Best in Slot Tasks') && enabled(rules, 'BIS')) {
    if (!weightRows.length) diagnostics.push({ kind: 'missing-equipment-weight-metadata', detail: specialist.weight.coverage.explanation });
    else addSlotComparison('Weight Reducing', weightRows.filter(row => !weaponSlots.has(row.slot) && !['ammo', 'off-hand'].includes(row.slot)), row => [-Number(row.data.weight)], 'Lower declared equipment weight wins.', specialist.weight.recommendations);
  }
  specialist.coverage = { limitations: ['Tank scores compare recorded defence. Weapon and off-hand choices are compared together; other slots use armour, then life points.', 'Weight comparisons need recorded weights. Weapon and off-hand combinations are not ranked by weight.', 'Skilling tools use recorded equipment sets and priorities. Convenience upgrades and relic goals have no shared score.', 'The picker does not simulate combat equipment set effects.'] };
  const scope = state.rules?.['tasks.completion'] ?? 'any';
  const owners = scope === 'personal' ? [member] : state.members;
  for (const task of tasks.values()) {
    const data = equipmentDefinitions[task.equipmentName] ?? {};
    task.record.ItemsDetails ??= [task.equipmentName];
    task.equipRequirements ??= Object.entries(data.requirements ?? {}).map(([skill, level]) => ({ skill, level,
      derivedLevel: result.training?.[skill]?.level ?? null, primaryTraining: !!result.training?.[skill]?.primary }));
    for (const { skill, level } of task.equipRequirements) {
      const training = result.training?.[skill];
      if (level > (training?.passiveLevel ?? 1) && training?.viaPartners?.length) task.explanation += ` ${skill} training available via ${training.viaPartners.join(' and ')}'s connected chunks.`;
    }
    task.maintenance ??= data.charges ? { charges: number(data.charges) } : null;
    task.personalCompleted = !!member.completedTasks?.includes(task.id);
    const complete = owner => facts.get(owner.id).completedTasks?.includes(task.id) || facts.get(owner.id).taskStatus?.[task.id]?.challengeCompleted;
    task.challengeSatisfied = scope === 'all' ? owners.every(complete) : owners.some(complete);
  }
  addUnknownDropWarnings([...tasks.values()], unknownDropContext(result, definitions, undefined, rules), rules);
  const uniqueDiagnostics = [...new Map(diagnostics.map(value => [JSON.stringify(value), value])).values()];
  return { tasks: [...tasks.values()].filter(task => selected.has(task.id)), catalogue: [...tasks.values()], loadouts, recommendations, alternatives, specialist, diagnostics: uniqueDiagnostics,
    coverage: { eligibleEquipment: eligibleCount, generatedTasks: selected.size, weaponStyles: loadouts.map(value => value.style), limitations: [
      'Picker scores compare equipment; they are not target-specific DPS or combat simulations.',
      'Charges and maintenance are displayed, not subtracted from the reference ranking.',
      'Combat set bonuses and the best relic combinations are not calculated. Skilling tools use recorded equipment sets and priorities; weight comparisons need recorded weights.',
      'Magic spells and runes follow the usual source and skill requirements. Individual spell choices are not ranked.',
    ] } };
}
