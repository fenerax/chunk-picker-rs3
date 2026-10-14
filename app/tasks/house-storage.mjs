import { houseStorageCatalogue, houseStorageRule } from '../data/poh-storage.mjs';
import { legacyTaskId } from './identity.mjs';

const labelFor = slot => slot.display ? `Display ${slot.label.replace(/ display$/, '')} in your house`
  : slot.automaticRetrieval ? `Make ${slot.label} available from your house toy box`
    : `Store ${slot.label} in your house`;
const furnitureLabel = (slot, catalogue) => catalogue.families.find(family => family.id === slot.family)?.label.toLowerCase() ?? slot.family;
const visibleLabel = (slot, catalogue) => slot.display ? labelFor(slot)
  : slot.automaticRetrieval ? `Make ${slot.label} available from your toy box`
    : `Store ${slot.label} in your ${furnitureLabel(slot, catalogue)}`;

/** IDs name reviewed objectives, independent of selected furniture and labels. */
export function buildHouseStorageCatalogue(catalogue = houseStorageCatalogue) {
  return Object.freeze(catalogue.slots.filter(slot => slot.generateTasks !== false && slot.active !== false && slot.historical !== true).map(slot => {
    const label = labelFor(slot);
    return Object.freeze({ id: `rs3:goal:house-storage:${slot.id}`, category: 'Extra', label, rawLabel: label,
      kind: 'house-storage', objectiveKind: 'house-storage', slotId: slot.id,
      aliases: Object.freeze([legacyTaskId('Extra', label)]) });
  }));
}

const identities = buildHouseStorageCatalogue();
const objectHas = (access, name) => access?.objects instanceof Set ? access.objects.has(name) : access?.objects?.includes(name);

/** Consume the engine's admitted item sources and reachable levels. This adds
 * collection obligations only; it never produces items or Construction XP.
 * A built historical flatpack is deliberately not current furniture evidence.
 */
export function evaluateHouseStorage({ rules, f2p, rows, items, sourceList, access, ownAccess, levels, caps,
  member, completed, challengeSatisfied }, catalogue = houseStorageCatalogue) {
  const coverage = { version: catalogue.version, exhaustive: false, furnitureCount: catalogue.furniture.length,
    slotCount: catalogue.slots.length, supportedObjectiveCount: catalogue.slots.filter(slot => slot.generateTasks !== false && slot.active !== false && slot.historical !== true).length,
    referenceOnlyCount: catalogue.slots.filter(slot => slot.generateTasks === false).length, automaticBookcasesGenerateTasks: false };
  const result = { tasks: [], enabled: rules[houseStorageRule] === true, coverage, eligibleSlots: [], exclusions: [] };
  if (!result.enabled) return result;
  if (f2p) {
    result.exclusions.push({ kind: 'membership', detail: 'The catalogued deposit storage and display furniture requires membership. F2P bookcases retrieve books automatically and have no fill tasks.' });
    return result;
  }
  const globalBlockers = [];
  if (!objectHas(access, catalogue.housing.workbench)) globalBlockers.push({ kind: 'location', detail: 'Requires an accessible current furniture workbench in Rimmington.' });
  if (!objectHas(access, catalogue.housing.storage)) globalBlockers.push({ kind: 'location', detail: 'Requires accessible furniture storage in Rimmington for placing newly constructed furniture.' });
  const housingQuest = rows.find(row => row.category === 'Quest' && row.baseQuest === catalogue.housing.quest && row.record?.QuestPoints !== undefined
    && (row.status === 'available' || row.personalCompleted));
  if (!housingQuest) globalBlockers.push({ kind: 'quest', detail: `Requires reachable completion or personal completion evidence for ${catalogue.housing.quest}.` });
  if (globalBlockers.length) { result.exclusions.push(...globalBlockers); return result; }

  const goals = catalogue === houseStorageCatalogue ? identities : buildHouseStorageCatalogue(catalogue);
  const goalsBySlot = new Map(goals.map(goal => [goal.slotId, goal]));
  const level = Math.min(levels.Construction ?? 1, caps.Construction ?? 120);
  for (let index = 0; index < catalogue.slots.length; index++) {
    const slot = catalogue.slots[index], identity = goalsBySlot.get(slot.id);
    if (slot.active === false || slot.historical === true || slot.generateTasks === false) {
      result.exclusions.push({ slotId: slot.id, kind: slot.generateTasks === false ? 'unsupported-entitlement' : 'historical', detail: slot.exclusionReason ?? 'This entry is not an active storage objective.' }); continue;
    }
    const parts = slot.parts.map(alternatives => alternatives.find(name => items.has(name)));
    if (parts.some(name => !name)) {
      result.exclusions.push({ slotId: slot.id, kind: 'items', missing: slot.parts.filter((_, part) => !parts[part]), detail: 'Every item in this storage slot must be obtainable from a source allowed by your chunk rules.' }); continue;
    }
    // The Wiki's complete-set rule is represented by AND between components;
    // alternatives within one component are OR (for example legs or skirt).
    const options = catalogue.furniture.filter(furniture => furniture.family === slot.family && furniture.active === true && furniture.generateTasks !== false
      && furniture.function !== 'automatic-book-retrieval' && furniture.construction <= level
      && (!slot.rewardTier || furniture.rewardTiers?.includes(slot.rewardTier))
      && Object.keys(furniture.materials).every(name => items.has(name)));
    const furniture = options.sort((a, b) => a.construction - b.construction || a.id.localeCompare(b.id))[0];
    if (!furniture) {
      result.exclusions.push({ slotId: slot.id, kind: 'furniture', reachableConstruction: level, detail: 'No current compatible furniture recipe has both reachable Construction and admitted sources for all materials.' }); continue;
    }
    result.eligibleSlots.push(slot.id);
    const backlogged = member.taskStatus?.[identity.id]?.backlogged === true;
    const blockers = backlogged ? [{ kind: 'backlog', detail: 'This house-storage task is backlogged by the current member.' }] : [];
    const sources = [...new Set([...parts, ...Object.keys(furniture.materials)])].flatMap(item => sourceList(item).map(source => ({ ...source, item })));
    const obligation = objectHas(ownAccess, catalogue.housing.workbench) && objectHas(ownAccess, catalogue.housing.storage) && housingQuest.obligation !== false;
    const hiddenReasons = obligation ? [] : ['This task is outside the member’s own reachable map; partner access is a convenience.'];
    const label = visibleLabel(slot, catalogue);
    result.tasks.push({ ...identity, label, rawLabel: label, generated: true, level: furniture.construction, primary: false, primaryMethod: false,
      status: blockers.length ? 'blocked' : 'available', blockers, sources, obligation, hidden: !obligation, hiddenReasons,
      personalCompleted: completed.has(identity.id), challengeSatisfied: challengeSatisfied(identity.id),
      wiki: slot.wiki, wikiPermalink: slot.permalink,
      explanation: slot.automaticRetrieval
        ? 'The item is obtainable and the toy box is buildable. Its retrieval interface shares Diango storage; there is no separate manual deposit requirement.'
        : `All slot components are obtainable and ${furniture.name} is buildable at reachable Construction ${level}.`,
      houseStorage: { slotId: slot.id, family: slot.family, furnitureId: furniture.id, furniture: furniture.name,
        construction: furniture.construction, materials: furniture.materials, parts, members: furniture.members,
        capacity: furniture.capacity ?? null, automaticRetrieval: slot.automaticRetrieval === true,
        provenance: catalogue.sources[slot.source], furnitureProvenance: catalogue.sources[furniture.source] },
      record: { Category: [houseStorageRule], Label: houseStorageRule, Items: parts, Skills: { Construction: furniture.construction }, 'Not F2P': true } });
  }
  return result;
}
