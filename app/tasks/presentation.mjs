import { skillCaps, taskId } from './engine.mjs';
import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts, resolveSavedTaskId } from './migration.mjs';
import { resolveTaskAlternatives } from '../core/task-alternatives.mjs';
import { primaryEquipmentSource } from './rates.mjs';
import { entityId, generatedGoalId, legacyTaskId } from './identity.mjs';
import { isNonPermanentEquipment } from '../data/equipment-permanence.mjs';
import { itemMembership } from '../data/item-membership.mjs';
import { selectProcessingSources } from './processing.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';

// Authored display selection. Eligibility and source production belong to engine.mjs.
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const enabled = taskRuleEnabled;
const clean = value => String(value).replace(/\*/g, '');

/** An explicit member restriction remains authoritative for custom definitions.
 * Unknown names retain their existing eligibility instead of guessing membership.
 */
export const equipmentMembersOnly = (name, data = {}) => data.members === true || itemMembership(name).members === true;

function membersTokenRequirement(cleaned, definitions, membersOnly) {
  const alias = /^(.*\[\+\])(?:x(\d+))?$/.exec(cleaned);
  const names = [...new Set(list(definitions.codeItems?.itemsPlus?.[alias?.[1] ?? cleaned] ?? cleaned))];
  const needed = alias?.[2] ? Number(alias[2]) : 1;
  // Required groups are alternatives. Preserve a group with enough distinct
  // free or unknown equipment choices to meet its declared count.
  const members = names.filter(item => definitions.equipment?.[item] && membersOnly(item, definitions.equipment[item]));
  return members.length > 0 && names.length - members.length < needed;
}

export function membersEquipmentRequirement(row, data, definitions, selection) {
  const membersOnly = selection?.membersOnly ?? equipmentMembersOnly;
  const name = row.equipmentName ?? row.item;
  if (name && membersOnly(name, definitions.equipment?.[name])) return true;
  return list(data.Items).some(token => selection?.tokenRequirement
    ? selection.tokenRequirement(token) : membersTokenRequirement(clean(token), definitions, membersOnly));
}

function createMembershipSelection(definitions) {
  const names = new Map(), tokens = new Map();
  const membersOnly = (name, data = {}) => {
    // Custom definitions can restrict a public free item. Their explicit flag
    // stays authoritative even after the public-name lookup has been cached.
    if (data.members === true) return true;
    if (!names.has(name)) names.set(name, itemMembership(name).members === true);
    return names.get(name);
  };
  const tokenRequirement = token => {
    const cleaned = clean(token);
    if (!tokens.has(cleaned)) tokens.set(cleaned, membersTokenRequirement(cleaned, definitions, membersOnly));
    return tokens.get(cleaned);
  };
  return { membersOnly, tokenRequirement };
}

export function equipmentTaskIdentity(name, data = {}) {
  const formatted = data.formatted_name ?? name.toLowerCase();
  const plural = name.endsWith('s') || name.endsWith(')') && name.split('(')[0].trim().endsWith('s');
  const article = plural ? ' ' : /^[aeiou]/i.test(name) ? ' an ' : ' a ';
  const rawLabel = `Obtain${article}~|${formatted}|~`;
  const itemId = entityId('item', name, data);
  return { id: generatedGoalId('equipment', itemId), category: 'BiS', rawLabel, label: `Obtain${article}${name}`,
    aliases: [legacyTaskId('BiS', rawLabel)], kind: 'equipment', objectiveKind: 'equipment', itemId };
}

/** Register potential equipment IDs without asserting access or availability. */
const equipmentCatalogues = new WeakMap();
const emptyCatalogue = Object.freeze([]);
export function buildEquipmentCatalogue(definitions) {
  const equipment = definitions.equipment;
  if (!equipment) return emptyCatalogue;
  const entries = Object.entries(equipment), cached = equipmentCatalogues.get(equipment);
  // Stats and requirements affect eligibility, not identity. Refresh when the
  // fields that display or explicitly register an item identity change.
  if (cached && entries.length === cached.entries.length && entries.every(([name, data], index) => {
    const previous = cached.entries[index];
    return previous.name === name && previous.formatted === data.formatted_name
      && previous.entityId === data.PickerEntityId && previous.pickerId === data.PickerId;
  })) return cached.catalogue;
  const catalogue = Object.freeze(entries.map(([name, data]) => Object.freeze(equipmentTaskIdentity(name, data))));
  equipmentCatalogues.set(equipment, { catalogue, entries: entries.map(([name, data]) => ({ name, formatted: data.formatted_name, entityId: data.PickerEntityId, pickerId: data.PickerId })) });
  return catalogue;
}

function decodedRecord(value = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [decodeLegacyText(key), child]));
}

/** Select active tasks without changing any engine row or saved game fact.
 * alternatives and suppressed contain task IDs so this result is JSON serializable.
 */
export function selectPresentedTasks(result, state, memberId, definitions = {}, { reuse = true } = {}) {
  const savedMember = state.members.find(value => value.id === memberId);
  const member = savedMember && projectMemberTaskFacts(state, savedMember, result.tasks);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const legacyMap = state.legacy?.maps?.[member.sourceMapId] ?? {};
  const migrated = hasGameplayMigration(state, member);
  // Retained import payloads are provenance after conversion. Missing authored
  // fields then mean unset/automatic and must not revive an imported override.
  const legacy = migrated ? {} : legacyMap.chunkinfo ?? {};
  const rules = { ...(migrated ? {} : decodedRecord(legacyMap.rules)), ...state.taskRules, ...member.taskRules };
  const taskAlternatives = resolveTaskAlternatives(state, member);
  const rows = result.tasks;
  const membershipSelection = reuse ? createMembershipSelection(definitions) : undefined;
  const record = row => row.record ?? definitions.challenges?.[row.category]?.[row.rawLabel] ?? {};
  // Alternative access gates are objectives in their own right. Their neutral
  // Level:1 is not a training milestone to suppress or rank against skill goals.
  const isSkill = row => Object.hasOwn(skillCaps, row.category);
  const isSkillGoal = row => isSkill(row) && !(record(row).RequirementAlternatives && Number(row.level ?? record(row).Level ?? 1) === 1);
  const suppressed = {}, alternatives = {}, effectiveLevels = {}, diagnostics = [];
  const hide = (row, reason) => { (suppressed[row.id] ??= []).push(reason); };
  const items = new Map((result.items ?? []).map(item => [item.name, item]));
  const byId = new Map(rows.map(row => [row.id, row]));
  // Legacy status fields and completed IDs are fixed for this selection. Keep
  // reuse local so a later save or caller mutation always gets a fresh view.
  const completedIds = reuse ? new Set(member.completedTasks ?? []) : undefined;
  const legacyFields = new Map(), legacyCategories = new Map();
  const flagsFor = (field, category) => {
    if (!reuse) return decodedRecord(decodedRecord(legacy[field])[category]);
    let categories = legacyCategories.get(field);
    if (!categories) { categories = new Map(); legacyCategories.set(field, categories); }
    if (categories.has(category)) return categories.get(category);
    if (!legacyFields.has(field)) legacyFields.set(field, decodedRecord(legacy[field]));
    const flags = decodedRecord(legacyFields.get(field)[category]);
    categories.set(category, flags);
    return flags;
  };
  const legacyFlags = (row, field) => {
    const flags = flagsFor(field, row.category);
    return Object.hasOwn(flags, row.rawLabel) || Object.hasOwn(flags, row.rawLabel?.replace(/#/g, '/'));
  };
  const statusFlag = (row, field, legacyField) => {
    const status = member.taskStatus?.[row.id] ?? {};
    return Object.hasOwn(status, field) ? !!status[field] : legacyFlags(row, legacyField);
  };
  const done = row => row.challengeSatisfied || row.personalCompleted || (reuse ? completedIds.has(row.id) : member.completedTasks?.includes(row.id)) || statusFlag(row, 'challengeCompleted', 'completedChallenges');
  const backlog = row => statusFlag(row, 'backlogged', 'backlog');

  function level(row) {
    if (effectiveLevels[row.id] !== undefined) return effectiveLevels[row.id];
    let boost = 0, saw = 0;
    const data = record(row), requirement = Number(row.level ?? data.Level ?? 1);
    if (enabled(rules, 'Boosting', false) && !data.NoBoost) {
      for (const [source, amount] of Object.entries(definitions.codeItems?.boostItems?.[row.category] ?? {})) {
        if (definitions.codeItems?.boostTaskBans?.[row.category]?.[row.rawLabel]?.includes(source)) continue;
        const [name, field = 'items'] = source.split('~');
        const sources = list(items.get(name)?.sources);
        if (!(field === 'items' ? items.has(name) && (!sources.length || sources.some(source => source.processingMode !== 'multi')) : result.access?.[field]?.includes(name))) continue;
        if (name === 'Crystal saw') {
          if (row.category === 'Construction' && list(data.Items).includes('Saw[+]')) saw = 3;
        } else if (typeof amount === 'number') boost = Math.max(boost, amount);
        else if (/^\d+(?:\.\d+)?%\+\d+$/.test(amount)) {
          const [percent, extra] = amount.split('%+').map(Number);
          const first = Math.floor(requirement * percent / 100 + extra);
          boost = Math.max(boost, Math.floor((requirement - first) * percent / 100 + extra));
        } else diagnostics.push({ kind: 'unsupported-presentation-boost', taskId: row.id, source, detail: 'This boost formula does not participate in presentation ranking.' });
      }
    }
    return effectiveLevels[row.id] = Math.max(1, requirement - boost - saw);
  }

  for (const row of rows) {
    if (row.obligation === false) hide(row, 'Outside this member’s own obligation map.');
    const data = record(row);
    if ((state.rules?.['content.f2p'] ?? true) && membersEquipmentRequirement(row, data, definitions, membershipSelection)) hide(row, 'This equipment requires membership in free-to-play mode.');
    if (row.status !== 'available') hide(row, 'Task is not available.');
    if (row.hidden) hide(row, 'Hidden by the engine display filters.');
    if (done(row)) hide(row, 'Challenge already satisfied.');
    if (backlog(row)) hide(row, 'Task is backlogged.');
    if (data.NeverShow) hide(row, 'Task metadata excludes it from the active view.');
    if (isSkill(row)) {
      level(row);
      if (!enabled(rules, 'Skills') || !enabled(rules, 'Show Skill Tasks')) hide(row, 'Skill tasks are hidden.');
      // The reference highest-goal scan requires checkPrimaryMethod first
      // (index.js:7385; worker.js:5528). Secondary supplies do not establish
      // a primary route; non-primary pets cannot replace the suppressed recipe.
      const training = result.training?.[row.category];
      const explicitTraining = training?.manualPrimary || training?.primaryOverride === true
        || training?.passiveOverride != null && Number(training.passiveOverride) >= level(row)
        || training?.observedCapabilityLevel != null && Number(training.observedCapabilityLevel) >= level(row);
      if (isSkillGoal(row) && row.primaryMethod === false && training?.primary === false && !explicitTraining) {
        hide(row, 'This method has no reachable primary training route.');
      }
      if (enabled(rules, 'Hide Partial Products', false) && data.Partial && row.level > 1) hide(row, 'Partial products are hidden.');
      if (!enabled(rules, 'Shortcut Task') && list(data.Category).includes('Shortcut') && row.level > 1) hide(row, 'Shortcut tasks are hidden.');
      // Wield/wear goals whose every qualifying item crumbles, runs out or is temporary follow the Non-permanent BiS rule too.
      if (!enabled(rules, 'Non-permanent BiS') && /^(?:Wield|Wear|Equip)\b/i.test(row.rawLabel ?? row.label ?? '')) {
        const sourced = (row.sources ?? []).map(source => source.item).filter(Boolean);
        // Sources name the actual items; Items can be a group reference like CorruptDragonWeapon[+].
        const items = [...new Set(sourced.length ? sourced : list(data.Items).filter(name => definitions.equipment?.[name]))];
        if (items.length && items.every(name => isNonPermanentEquipment(name, definitions.equipment?.[name]))) hide(row, 'Every qualifying item is non-permanent (Non-permanent BiS rule).');
      }
      if (row.category === 'Herblore' && !enabled(rules, 'Cleaning Herbs') && row.level > 1 && /Clean a|\(unf\)|\(unfinished\)/.test(row.rawLabel)) hide(row, 'Herb cleaning and unfinished potions are hidden.');
    } else if (row.category === 'Quest') {
      if (!enabled(rules, 'Quests') || !enabled(rules, 'Show Quest Tasks')) hide(row, 'Quest tasks are hidden.');
      // The upstream completion marker is property presence, including zero-QP miniquests.
      if (enabled(rules, 'Show Quest Tasks Complete', false) && !Object.hasOwn(data, 'QuestPoints')) hide(row, 'Only whole quest completion tasks are shown.');
    } else if (row.category === 'Diary') {
      if (!enabled(rules, 'Achievement')) hide(row, 'Achievement tasks are hidden by Achievement.');
      if (enabled(rules, 'Show Diary Tasks Complete', false) && !Object.hasOwn(data, 'ManualShow')) hide(row, 'Only complete achievement tiers are shown.');
    } else if (row.category === 'Extra' && list(data.Category).includes('BIS Skilling')) {
      if (!enabled(rules, 'BIS Skilling')) hide(row, 'Skilling equipment goals are hidden by the BIS Skilling rule.');
    } else if (row.category === 'Nonskill') {
      if (!enabled(rules, 'Show Nonskill Tasks', false)) hide(row, 'Access and source prerequisites are kept in the catalogue.');
    } else if (row.category === 'BiS') {
      if (!enabled(rules, 'Show Best in Slot Tasks')) hide(row, 'Equipment tasks are hidden.');
      if (!enabled(rules, 'Non-permanent BiS') && list(row.equipmentName ?? data.Items).some(name => isNonPermanentEquipment(name, definitions.equipment?.[name]))) hide(row, 'Non-permanent equipment is excluded from Best in Slot tasks.');
    }
  }

  // A completable diary parent replaces its same-family child duties. Keep the
  // eligible catalogue intact: hidden children still carry skill requirements,
  // supply provenance and historical checks. ManualShow tier markers remain
  // separate goals, as in the reference worker's markSubTasks selection.
  const diaryByLabel = new Map(rows.filter(row => row.category === 'Diary').flatMap(row =>
    [[row.rawLabel, row], [row.rawLabel?.replace(/#/g, '/'), row]]));
  for (const parent of rows) {
    if (parent.category !== 'Diary' || parent.status !== 'available' || parent.obligation === false || backlog(parent)) continue;
    const data = record(parent);
    if (!data.BaseQuest) continue;
    for (const [dependency, category] of Object.entries(data.Tasks ?? {})) {
      if (category !== 'Diary') continue;
      const token = dependency.split('--')[0], alias = /^(.*\[\+\])(?:x\d+)?$/.exec(token);
      const children = list(definitions.codeItems?.tasksPlus?.[alias?.[1] ?? token] ?? token);
      for (const name of children) {
        const child = diaryByLabel.get(String(name).split('--')[0]);
        if (!child || child.id === parent.id) continue;
        const childData = record(child);
        if (childData.BaseQuest === data.BaseQuest && !childData.ManualShow) {
          hide(child, `Included in the available achievement parent: ${parent.label ?? parent.rawLabel}.`);
        }
      }
    }
  }

  // Engine results carry the admitted source frontier. Standalone row fixtures
  // use the same selector; display filters never become source production rules.
  const sourceSelection = result.metrics?.processingPasses != null
    ? { eligibleTaskIds: rows.filter(row => row.sourceEligible !== false).map(row => row.id), diagnostics: [] }
    : result.processing ?? selectProcessingSources(rows, result.items ?? [], result.training, rules, definitions, result.access);
  diagnostics.push(...sourceSelection.diagnostics);
  const sourceIds = new Set(sourceSelection.eligibleTaskIds);
  for (const row of rows) if (row.sourceEligible === false || row.status === 'available' && !sourceIds.has(row.id)) {
    hide(row, 'A lower-level processing method or its source frontier excludes this recipe.');
  }
  const priority = row => {
    const number = Number(record(row).Priority ?? record(row).priority);
    return Number.isFinite(number) ? number : Infinity;
  };
  const primary = row => row.primary ?? !!(record(row).Primary ?? record(row).Priamry ?? record(row).primary);

  const completedLevels = new Map();
  // The reference cutoff reads every completed challenge (worker.js:9858), so a
  // tick still counts after a map change (an F2P-to-members restart can move or
  // wipe chunks). challengeSatisfied already applies the group completion rule:
  // under the shared default, a partner's higher goal also covers lower ones.
  for (const row of rows) if (isSkillGoal(row) && done(row)) completedLevels.set(row.category, Math.max(completedLevels.get(row.category) ?? 0, level(row)));
  const skills = new Map();
  const selected = [];
  for (const row of rows) {
    if (suppressed[row.id]) continue;
    if (!isSkillGoal(row)) { selected.push(row); continue; }
    if (level(row) <= (completedLevels.get(row.category) ?? 0)) { hide(row, 'A goal at this skill level or higher is already satisfied.'); continue; }
    if (level(row) <= 1 && !primary(row)) { hide(row, 'A level-one prerequisite is not a primary training goal.'); continue; }
    const group = skills.get(row.category) ?? [];
    group.push(row); skills.set(row.category, group);
  }
  for (const [category, group] of skills) {
    const ranked = group.slice().sort((a, b) => level(b) - level(a) || priority(a) - priority(b) || Number(primary(b)) - Number(primary(a)));
    const highest = level(ranked[0]);
    const peers = ranked.filter(row => level(row) === highest);
    const savedChoice = taskAlternatives[category]?.[String(highest)];
    const preferred = typeof savedChoice === 'string' ? resolveSavedTaskId(state.identityRegistry, savedChoice, category) : savedChoice;
    const exact = peers.find(row => row.id === preferred || row.rawLabel === preferred || row.aliases?.includes(preferred));
    const chosen = exact ?? ranked[0];
    if (preferred && !exact) diagnostics.push({ kind: 'unavailable-task-alternative', category, group: String(highest), preferred: savedChoice, chosen: chosen.id,
      detail: 'Your saved task choice is unavailable or could not be matched. The highest-ranked available alternative is shown.' });
    selected.push(chosen);
    alternatives[chosen.id] = peers.filter(row => row !== chosen).map(row => row.id);
    for (const row of group) if (row !== chosen) hide(row, level(row) === highest ? 'An alternative at the current goal level.' : 'A higher skill goal is available.');
  }
  const order = new Map(rows.map((row, index) => [row.id, index]));
  selected.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { tasks: selected, alternatives, suppressed, effectiveLevels, diagnostics,
    metrics: { catalogueCount: rows.length, presentedCount: selected.length, suppressedCount: Object.keys(suppressed).length },
    coverage: { limitations: [
      'Required highest-task links and XP-based boost ranking remain partial.',
      'Cross-skill goals keep their original owning category; prerequisite duplication into another skill heading is not implemented.',
      'Dynamic BiS tasks and upstream weapon/ammunition scoring are not synthesized by this selector. Equipment rows remain eligibility results.',
    ] } };
}

/** Ordinary armour/accessory recommendations over engine-confirmed equipment.
 * Weapon/ammunition loadouts need a separate coupled scorer and are not ranked.
 */
export function selectEquipmentRecommendations(result, rules = {}, definitions = {}) {
  const groups = new Map(), diagnostics = [], tasksByItem = new Map();
  const compare = (a, b) => {
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return b[index] - a[index];
    return 0;
  };
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  for (const equipment of result.equipment ?? []) {
    if (equipment.obligation === false) continue;
    const data = definitions.equipment?.[equipment.name];
    if (!data) {
      diagnostics.push({ kind: 'unsupported-equipment-presentation', item: equipment.name, detail: 'Raw equipment scoring fields are unavailable.' });
      continue;
    }
    if ((rules.F2P ?? rules['content.f2p'] ?? false) && equipmentMembersOnly(equipment.name, data)) {
      diagnostics.push({ kind: 'f2p-members-equipment-excluded', item: equipment.name, detail: 'This equipment requires membership in free-to-play mode.' });
      continue;
    }
    if (!enabled(rules, 'Non-permanent BiS') && isNonPermanentEquipment(equipment.name, data)) continue;
    if (data.speed > 0 || /weapon/.test(equipment.slot) || equipment.slot === 'ammo' || equipment.slot === 'off-hand') {
      diagnostics.push({ kind: 'unsupported-equipment-presentation', item: equipment.name, detail: 'Coupled weapon, shield, and ammunition loadout scoring is not implemented.' });
      continue;
    }
    if (enabled(rules, 'Consumable Primary BiS', false) && data.is_consumable && !equipment.sources?.some(source => primaryEquipmentSource(source, rules))) continue;
    for (const style of ['Melee', 'Ranged', 'Magic', 'Necromancy', 'Prayer']) {
      if (!enabled(rules, 'Show Best in Slot Tasks')) continue;
      if (style === 'Prayer' && (!enabled(rules, 'Show Best in Slot Prayer Tasks') || !enabled(rules, 'BIS Prayer'))) continue;
      if (style !== 'Prayer' && !['none', 'hybrid', 'all', style.toLowerCase()].includes(data.class)) continue;
      const damage = numeric(data[`${style.toLowerCase()}_damage`]);
      if (style !== 'Prayer' && damage < 0) continue;
      const score = style === 'Prayer' ? [numeric(data.prayer)] : [damage + 0.15 * numeric(data[`${style.toLowerCase()}_accuracy`]), numeric(data.armour), numeric(data.lp)];
      if (style === 'Prayer' ? score[0] <= 0 : score.every(value => value === 0)) continue;
      const key = `${style}\u0000${equipment.slot}`, group = groups.get(key) ?? [];
      group.push({ equipment, score, style, slot: equipment.slot }); groups.set(key, group);
    }
  }
  const recommendations = [], alternatives = {};
  for (const group of groups.values()) {
    group.sort((a, b) => compare(a.score, b.score) || a.equipment.name.localeCompare(b.equipment.name));
    const chosen = group[0], peers = group.filter(value => compare(value.score, chosen.score) === 0);
    recommendations.push({ style: chosen.style, slot: chosen.slot, equipment: chosen.equipment, score: chosen.score, alternatives: peers.slice(1).map(value => value.equipment.name) });
    for (const value of peers) {
      const name = value.equipment.name, data = definitions.equipment[name];
      let task = tasksByItem.get(name);
      if (!task) {
        task = { ...equipmentTaskIdentity(name, data), level: 1, primary: false, generated: true,
          status: 'available', blockers: [], hidden: false, hiddenReasons: [], personalCompleted: false, challengeSatisfied: false,
          sources: value.equipment.sources ?? [], equipmentName: name, equipmentGoals: [],
          explanation: 'This item is reachable and meets the equipment requirements. Its ordinary armour/accessory score is highest in the listed categories.',
          wiki: `https://runescape.wiki/w/${encodeURIComponent(name.replace(/#/g, '/'))}`,
          record: { Items: [name], Label: '', Category: ['BIS'] } };
        tasksByItem.set(name, task);
      }
      task.equipmentGoals.push(`${value.style} BiS ${value.slot}`);
    }
    const chosenTask = tasksByItem.get(chosen.equipment.name);
    const peerIds = peers.slice(1).map(value => tasksByItem.get(value.equipment.name).id);
    alternatives[chosenTask.id] = [...new Set([...(alternatives[chosenTask.id] ?? []), ...peerIds])];
  }
  const catalogue = [...tasksByItem.values()];
  for (const task of catalogue) task.record.Label = task.equipmentGoals.join(' / ');
  const chosenNames = new Set(recommendations.map(value => value.equipment.name));
  return { recommendations, tasks: catalogue.filter(task => chosenNames.has(task.equipmentName)), catalogue, alternatives, diagnostics,
    coverage: { limitations: ['Ordinary armour, accessories, and prayer comparisons only. Weapon/ammunition loadouts, tank-only views, weight gear, and bespoke skilling/relic comparisons are not implemented.'] } };
}
