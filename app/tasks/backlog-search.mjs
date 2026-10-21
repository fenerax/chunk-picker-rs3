import { resolveIdentity, lookupPermanentId } from './identity.mjs';
import { createTrainingSourceIndex } from './training-availability.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const clean = value => typeof value === 'string' ? value.replace(/\*/g, '').replace(/\[\+\](?:x\d+)?$/g, '') : '';
const selectors = { Chunks: ['chunk', 'chunksPlus'], Objects: ['object', 'objectsPlus'], NPCs: ['npc', 'npcsPlus'],
  Monsters: ['monster', 'monstersPlus'], Monster: ['monster', 'monstersPlus'], Shops: ['shop', 'shopsPlus'], Items: ['item', 'itemsPlus'] };
function entityMetadata(id, registry) {
  const entry = registry?.entries?.[id] ?? lookupPermanentId(id);
  if (entry) return entry;
  // entityId() preserves exact names in this explicit fallback format.
  const fallback = typeof id === 'string' && /^rs3:unregistered:([^:]+):(.+)$/.exec(id);
  if (fallback) try { return { entityKind: decodeURIComponent(fallback[1]), label: decodeURIComponent(fallback[2]) }; } catch {}
}

/** Static search hints only; no access, availability or gameplay calculation. */
export function backlogSearchTasks({ definitions = {}, catalogue = [], dynamicCatalogue = [], registry, taskIds = [], sourceLocations }) {
  const wanted = new Set(taskIds), targets = new Map(), matches = new Map(), exact = new Map(), ambiguous = new Set();
  for (const id of wanted) {
    const resolved = resolveIdentity(id, registry);
    if (resolved.status === 'ambiguous') ambiguous.add(id);
    const target = resolved.status === 'resolved' ? resolved.id : id;
    const requests = targets.get(target) ?? [];
    requests.push(id); targets.set(target, requests);
    matches.set(id, new Map());
  }
  // Retain only requested identities and their candidates, not a second full catalogue index.
  for (const rows of [catalogue, dynamicCatalogue]) for (const row of rows) {
    if (wanted.has(row.id)) exact.set(row.id, row);
    for (const id of targets.get(row.id) ?? []) matches.get(id).set(row.id, row);
    for (const alias of row.aliases ?? []) if (wanted.has(alias)) matches.get(alias).set(row.id, row);
  }
  let index = sourceLocations;
  const at = key => {
    index ??= createTrainingSourceIndex(definitions);
    return index instanceof Map ? index.get(key) ?? [] : index[key] ?? [];
  };
  return [...wanted].map(id => {
    const candidates = matches.get(id), row = exact.get(id) ?? (!ambiguous.has(id) && candidates.size === 1 ? candidates.values().next().value : undefined);
    const locations = new Map();
    const add = location => {
      const locationId = typeof location === 'string' ? location : location?.locationId ?? location?.id;
      if (typeof locationId !== 'string' || !locationId) return;
      const name = typeof location === 'object' ? location.label ?? location.name : undefined;
      locations.set(locationId, { id: locationId, ...(name ? { name } : {}) });
    };
    const source = (kind, name) => { for (const location of at(`${kind}:${name}`)) add(location); };
    if (row) {
      const record = row.record ?? definitions.challenges?.[row.category]?.[row.rawLabel];
      for (const [field, [kind, aliases]] of Object.entries(selectors)) for (const token of list(record?.[field])) {
        if (typeof token !== 'string') continue;
        const names = list(definitions.codeItems?.[aliases]?.[token] ?? definitions.codeItems?.[aliases]?.[token.replace(/\*/g, '')] ?? token);
        for (const value of names) {
          const name = clean(value); if (!name) continue;
          // A declared reference is evidence even if the static source index has no matching section.
          if (field === 'Chunks') add(name);
          source(kind, name);
        }
      }
      for (const entityId of [row.sourceId, row.itemId]) {
        const entity = entityMetadata(entityId, registry);
        if (entity?.entityKind && entity.label) source(entity.entityKind, entity.label);
      }
      if (row.equipmentName || row.item) source('item', row.equipmentName ?? row.item);
    }
    return { id, locations: [...locations.values()] };
  });
}
