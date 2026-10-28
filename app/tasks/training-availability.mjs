import { progressBelongsToMember } from '../core/game-progress.mjs';
import { decodeLegacyText } from './migration.mjs';
import { gatheringSettingDefinitions } from '../core/gathering-settings.mjs';

const entries = value => value && typeof value === 'object' ? Object.entries(value) : [];
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const kinds = { Object: 'object', NPC: 'npc', Monster: 'monster', Shop: 'shop', Spawn: 'item' };

/** Reverse references are hints about where missing selectors occur, never
 * evidence that their resources are accessible. Compile once per definitions. */
export function createTrainingSourceIndex(definitions = {}) {
  const index = {}, locationsBySource = new Map();
  const add = (kind, name, location) => {
    const key = `${kind}:${name}`;
    const values = index[key] ??= [];
    if (!values.some(value => value.locationId === location.locationId)) values.push(location);
  };
  for (const [id, chunk] of entries(definitions.chunks)) {
    const base = id.split('-')[0], label = chunk.Nickname ?? chunk.Name ?? id;
    const visit = (node, locationId) => {
      const location = { locationId, ...(/^\d+$/.test(base) ? { chunkId: base } : { area: base }), label };
      add('chunk', locationId, location);
      if (locationId !== id) add('chunk', id, location);
      for (const [field, kind] of entries(kinds)) for (const [name] of entries(node[field])) {
        add(kind, name, location);
        const sourceKey = `${field}:${name}`;
        const sourceLocations = locationsBySource.get(sourceKey) ?? [];
        sourceLocations.push(location); locationsBySource.set(sourceKey, sourceLocations);
      }
      for (const [name] of entries(node.Quest)) add('quest', name, location);
    };
    if (chunk.Sections) for (const [suffix, section] of entries(chunk.Sections)) visit(section, `${id}-${suffix}`);
    else visit(chunk, id);
  }
  for (const [shop, items] of entries(definitions.shopItems)) for (const [item] of entries(items)) {
    for (const location of locationsBySource.get(`Shop:${shop}`) ?? []) add('item', item, location);
  }
  // Direct and nested drop tables locate inputs without converting rare drops
  // into stock or assuming a throughput. Cycles terminate at the source table.
  const drops = (table, locations, visiting = new Set()) => {
    if (visiting.has(table)) return;
    visiting.add(table);
    for (const [item] of entries(definitions.drops?.[table])) {
      if (definitions.drops?.[item]) drops(item, locations, new Set(visiting));
      else for (const location of locations) add('item', item, location);
    }
  };
  for (const [sourceKey, locations] of locationsBySource) if (sourceKey.startsWith('Monster:')) drops(sourceKey.slice('Monster:'.length), locations);
  for (const [object, yields] of entries(definitions.objectItems)) for (const [item] of entries(yields)) {
    for (const location of locationsBySource.get(`Object:${object}`) ?? []) add('item', item, location);
  }
  const locationFor = record => {
    const own = [];
    for (const id of array(record.Chunks)) own.push(...(index[`chunk:${id}`] ?? []));
    for (const [field, kind] of entries({ Objects: 'object', NPCs: 'npc', Monsters: 'monster', Shops: 'shop' })) {
      for (const name of array(record[field])) own.push(...(index[`${kind}:${name}`] ?? []));
    }
    return own;
  };
  const outputs = value => typeof value === 'string' ? [value.replaceAll('*', '')] : Array.isArray(value) ? value.flatMap(outputs)
    : value && typeof value === 'object' ? Object.keys(value).flatMap(name => definitions.codeItems?.itemsPlus?.[name] ?? [name]) : [];
  for (const [, tasks] of entries(definitions.challenges)) for (const [, record] of entries(tasks)) {
    for (const item of outputs(record.Output)) for (const location of locationFor(record)) add('item', item, location);
  }
  return index;
}

/** Accept saved progress only from the member's currently named account.
 * Primary/passive/max declarations describe capabilities, not observed levels.
 * A manual level is an ephemeral request scenario and does not mutate state. */
export function trainingProgress(member, skill, manualLevel) {
  if (manualLevel !== undefined && manualLevel !== null) {
    if (!Number.isSafeInteger(manualLevel) || manualLevel < 1 || manualLevel > 120) throw new RangeError('Manual starting level must be an integer from 1 through 120.');
    return { level: manualLevel, xp: null, source: 'manual', fetchedAt: null };
  }
  const observed = member?.skillProgress?.[skill];
  if (progressBelongsToMember(observed, member)
    && Number.isSafeInteger(observed.level) && observed.level >= 1 && observed.level <= 120
    && Number.isFinite(observed.xp) && observed.xp >= 0) {
    return { level: observed.level, xp: observed.xp, source: observed.source, fetchedAt: observed.fetchedAt, ...(observed.source === 'game-plugin' ? { memberId: observed.memberId } : { runescapeName: observed.runescapeName }) };
  }
  return { level: null, xp: null, source: 'unknown', fetchedAt: null };
}

export function buildTrainingAvailability(result, { state, memberId, definitions = {}, sourceLocations } = {}) {
  const member = state?.members?.find(value => value.id === memberId);
  if (!member) throw new RangeError(`Unknown training member: ${memberId}`);
  const aliases = Object.fromEntries(Object.entries({ item: 'itemsPlus', object: 'objectsPlus', npc: 'npcsPlus', monster: 'monstersPlus', shop: 'shopsPlus', chunk: 'chunksPlus' })
    .map(([kind, field]) => [kind, definitions.codeItems?.[field] ?? {}]));
  const skills = Object.fromEntries(Object.keys(member.skillProgress ?? {}).map(skill => [skill, trainingProgress(member, skill).level]).filter(([, level]) => level !== null));
  const currentCompletion = row => {
    if (!row.personalCompleted) return false;
    const saved = member.questProgress?.[row.id];
    // Account renaming preserves challenge checks and completed IDs. Old synced
    // IDs cannot become current-account progress through the row fallback.
    return !saved || progressBelongsToMember(saved, member);
  };
  const completedTasks = (result.tasks ?? []).filter(currentCompletion).map(row => ({ id: row.id, category: row.category, rawLabel: row.rawLabel, label: row.label }));
  const completedQuests = [...new Set((result.tasks ?? []).filter(row => row.category === 'Quest' && currentCompletion(row) && row.record?.QuestPoints !== undefined)
    .flatMap(row => [row.id, row.rawLabel, row.label, row.record?.BaseQuest].filter(Boolean)))];
  for (const [id, quest] of entries(member.questProgress)) if (progressBelongsToMember(quest, member)) completedQuests.push(id, quest.title);
  return { access: result.access ?? {}, items: result.items ?? [], skills, completedQuests, completedTasks,
    miningPickaxe: member.preferences?.miningPickaxe ?? 'auto', miningAttention: member.preferences?.miningAttention ?? 'active',
    woodcuttingHatchet: member.preferences?.woodcuttingHatchet ?? 'auto',
    gatheringMode: member.preferences?.gatheringMode ?? 'drop',
    gatheringOreBox: member.preferences?.gatheringOreBox ?? 'none',
    gatheringWoodBox: member.preferences?.gatheringWoodBox ?? 'none',
    ...Object.fromEntries(gatheringSettingDefinitions.map(row => [row.id, member.preferences?.[row.id] ?? row.default])),
    gatheringTravelUnlocks: { confirmations: { ...member.transportFacts?.confirmations }, conditions: { ...member.transportFacts?.conditions },
      overrides: { ...member.teleportOverrides }, teleports: (member.teleports ?? []).filter(row => row.available && !row.consumable) },
    members: state.rules?.['content.f2p'] === false, aliases,
    sourceLocations: sourceLocations ?? createTrainingSourceIndex(definitions),
    // Retained legacy decoding is confined to selector names in reference data.
    backloggedItems: Object.keys(result.access?.backloggedSources?.items ?? {}).map(decodeLegacyText) };
}
