import { datasetValue, selectedDataset } from "../dataset-runtime.mjs";
import { identityRegistryVersion, authoredTasks, authoredEntities, authoredGoals, authoredSources } from '../data/identity-registry.mjs';

const normalized = value => String(value).normalize('NFC');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = value => normalized(value).replace(/~\|([^|]+)\|~/g, (_, text) => text.split('#')[0]).replace(/\*+$/g, '');
const candidatesOf = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
const entryMap = new Map(), aliasMap = new Map(), entityMap = new Map();
const sourceMap = new Map();
function addEntityAlias(kind, name, id) { addAlias(entityMap, `${kind}\u0000${normalized(name)}`, id); }

/** The old exact category/label ID remains an alias, never a minted identity. */
export function legacyTaskId(category, rawLabel) {
  return `rs3:${encodeURIComponent(normalized(category))}:${encodeURIComponent(normalized(rawLabel))}`;
}
export function isPermanentId(id) {
  return typeof id === 'string' && (/^rs3:(?:task|entity|goal):/.test(id)
    || selectedDataset.capabilities.independent === true && (id.startsWith(`${selectedDataset.identityNamespace}:`)
      || id.startsWith(`custom:${selectedDataset.datasetId ?? selectedDataset.id}:`)));
}
// Most keys name one ID: it stays a string, and only shared keys collect a Set.
function addAlias(map, alias, id) {
  if (typeof alias !== 'string' || !alias || typeof id !== 'string' || !id) return;
  const ids = map.get(alias);
  if (ids === undefined) map.set(alias, id);
  else if (typeof ids === 'string') { if (ids !== id) map.set(alias, new Set([ids, id])); }
  else ids.add(id);
}
function register(value) {
  const previous = entryMap.get(value.id);
  const aliases = [...new Set([...(previous?.aliases ?? []), ...(value.aliases ?? [])])];
  const entry = Object.freeze({ ...previous, ...value, aliases: Object.freeze(aliases) });
  entryMap.set(value.id, entry); addAlias(aliasMap, value.id, value.id);
  for (const alias of aliases) addAlias(aliasMap, alias, value.id);
}
for (const [id, category, rawLabel, oldLabels = []] of authoredTasks) {
  register({ id, kind: 'task', category, label: plain(rawLabel), rawLabel,
    aliases: [rawLabel, legacyTaskId(category, rawLabel), ...oldLabels.flatMap(old => {
      const [oldCategory, label] = Array.isArray(old) ? old : [category, old];
      return [label, legacyTaskId(oldCategory, label)];
    })] });
}
// Exact, metadata-reviewed progress seams from the 2026-10-08 parity audit.
// These identify challenge objectives only: they grant no personal quests,
// inventory or usable teleports. Unreviewed quest skill clones stay unresolved.
export const verifiedProgressAliases = datasetValue("app/tasks/identity.mjs#verifiedProgressAliases");
const verifiedProgressKeys = new Set();
for (const [id, category, rawLabel] of verifiedProgressAliases) {
  const alias = legacyTaskId(category, rawLabel);
  verifiedProgressKeys.add(alias);
  register({ ...entryMap.get(id), aliases: [rawLabel, alias] });
}
export function isVerifiedProgressAlias(category, rawLabel) {
  return verifiedProgressKeys.has(legacyTaskId(category, rawLabel));
}
for (const [id, kind, name, oldNames = []] of authoredEntities) {
  register({ id, kind: 'entity', entityKind: kind, label: name, aliases: [] });
  for (const alias of [name, ...oldNames]) {
    addEntityAlias(kind, alias, id);
    // Reference stars and [+] are presentation/table markers, not entities.
    addEntityAlias(kind, normalized(alias).replaceAll('*', '').replaceAll('[+]', ''), id);
  }
}
for (const [id, kind, rawLabel, aliases = [], category = kind === 'equipment' ? 'BiS' : 'Extra'] of authoredGoals) {
  register({ id, kind, category, label: plain(rawLabel), rawLabel,
    aliases: [rawLabel, legacyTaskId(category, rawLabel), ...aliases] });
}
for (const [id, names, objectives] of authoredSources) for (const name of names) for (const objective of objectives) addAlias(sourceMap, `${objective}\u0000${normalized(name)}`, id);
// The authored maps are complete and read-only from here: shared keys keep
// their IDs, in insertion order, as a frozen array.
for (const map of [aliasMap, entityMap, sourceMap]) for (const [key, ids] of map) if (typeof ids !== 'string') map.set(key, Object.freeze([...ids]));
const idsOf = value => typeof value === 'string' ? [value] : value;

/** Explicit PickerId is an authored rename seam. Unregistered custom/fixture
 * definitions retain their old identifier until deliberately registered; they
 * are not misrepresented as a permanent identity or fuzzy matched to another.
 */
export function permanentTaskId(category, rawLabel, data = {}) {
  if (typeof data?.PickerId === 'string' && (data.PickerId.startsWith('rs3:task:')
    || selectedDataset.capabilities.independent === true && data.PickerId.startsWith(`${selectedDataset.identityNamespace}:activity:`))) return data.PickerId;
  const ids = [...(idsOf(aliasMap.get(legacyTaskId(category, rawLabel))) ?? [])];
  if (ids.length === 1) return ids[0];
  const semantic = semanticCandidates(legacyTaskId(category, rawLabel), category);
  return !ids.length && semantic.length === 1 ? semantic[0] : legacyTaskId(category, rawLabel);
}
export function entityId(kind, name, data = {}) {
  const explicit = data?.PickerEntityId ?? data?.PickerId;
  if (typeof explicit === 'string' && explicit.startsWith('rs3:entity:')) return explicit;
  const candidates = entityMap.get(`${kind}\u0000${normalized(name)}`)
    ?? entityMap.get(`${kind}\u0000${normalized(name).replaceAll('*', '').replaceAll('[+]', '')}`);
  return typeof candidates === 'string' ? candidates : `rs3:unregistered:${encodeURIComponent(kind)}:${encodeURIComponent(normalized(name))}`;
}
/** Objective kinds are versioned semantics; entity IDs supply identity. Rates,
 * quantities, thresholds and display strings must never be passed here. */
export function generatedGoalId(kind, ...entityIds) {
  if (!entityIds.length || entityIds.some(id => typeof id !== 'string' || !id.startsWith('rs3:'))) throw new TypeError('Generated goals need picker entity IDs');
  const parts = entityIds.map(id => id.startsWith('rs3:entity:') ? id.slice('rs3:entity:'.length) : encodeURIComponent(id));
  return `rs3:goal:${encodeURIComponent(kind)}:${parts.join(':')}`;
}
function result(id, candidates, entries, category) {
  let ids = [...new Set(candidates)].filter(candidate => entries.has ? entries.has(candidate) : entries.get(candidate));
  if (category !== undefined) {
    const prefix = `rs3:${encodeURIComponent(normalized(category))}:`;
    ids = ids.filter(candidate => {
      if (entries.matchesCategory) return entries.matchesCategory(candidate, normalized(category), prefix);
      const entry = entries.get(candidate);
      return entry?.category === normalized(category) || entry?.aliases?.some(alias => alias.startsWith(prefix));
    });
  }
  return ids.length === 1 ? { status: 'resolved', id: ids[0], candidates: ids }
    : { status: ids.length ? 'ambiguous' : 'unresolved', candidates: ids, originalId: id };
}
function semanticEntry(id) {
  if (typeof id !== 'string' || !id.startsWith('rs3:goal:')) return null;
  const [, , objectiveKind, ...parts] = id.split(':');
  if (!['equipment', 'kill-x', 'every-drop', 'all-droptables', 'all-shops'].includes(objectiveKind)) return null;
  const entities = parts.map(part => entryMap.get(`rs3:entity:${part}`));
  if (!entities.length || entities.some(entity => !entity)) return null;
  if (['equipment', 'kill-x'].includes(objectiveKind) ? entities.length !== 1 : entities.length !== 2) return null;
  const equipment = objectiveKind === 'equipment', category = equipment ? 'BiS' : 'Extra';
  const label = equipment ? `Obtain ${entities[0].label}` : objectiveKind === 'kill-x' ? `Kill X ${entities[0].label}` : `${entities[0].label}: ${entities[1]?.label ?? ''}`;
  return { id, kind: equipment ? 'equipment' : 'collection', objectiveKind, category, label, aliases: [] };
}
function entityCandidates(kind, name) {
  return [...(idsOf(entityMap.get(`${kind}\u0000${normalized(name)}`) ?? entityMap.get(`${kind}\u0000${normalized(name).replaceAll('*', '').replaceAll('[+]', '')}`)) ?? [])];
}
/** Decode historical generated display identities by their immutable subjects.
 * Parenthesized display rate/quantity data never participates in the result.
 * Subject ambiguity is returned as candidates instead of guessed away. */
function semanticCandidates(id, category) {
  if (typeof id !== 'string') return [];
  if (id.startsWith('rs3:goal:') && semanticEntry(id)) return [id];
  let raw = id, cat = category;
  const encoded = /^rs3:([^:]+):([\s\S]*)$/.exec(id);
  if (encoded) {
    try { cat = decodeURIComponent(encoded[1]); raw = decodeURIComponent(encoded[2]); } catch { return []; }
  }
  const goals = [];
  if ((!cat || cat === 'BiS') && /^Obtain(?: an? | )~\|([^|]+)\|~$/.test(raw)) {
    const name = /^Obtain(?: an? | )~\|([^|]+)\|~$/.exec(raw)[1];
    for (const item of idsOf(sourceMap.get(`equipment\u0000${normalized(name)}`)) ?? []) goals.push(generatedGoalId('equipment', item));
  }
  if (cat && cat !== 'Extra') return goals;
  const kill = /^Kill X ~\|([^|]+)\|~$/.exec(raw);
  if (kill) for (const monster of entityCandidates('monster', kill[1])) goals.push(generatedGoalId('kill-x', monster));
  const drop = /^([\s\S]+): ~\|([^|]+)\|~([\s\S]*)$/.exec(raw);
  if (!drop) return goals;
  const [, sourceLabel, itemLabel, tail] = drop;
  const objective = tail === '' ? 'all-shops' : /^ \([\s\S]*\) \([^()]*\)$/.test(tail) ? 'all-droptables' : /^ \([\s\S]*\)$/.test(tail) ? 'every-drop' : null;
  if (!objective) return goals;
  for (const sourceId of idsOf(sourceMap.get(`${objective}\u0000${normalized(sourceLabel)}`)) ?? []) for (const itemId of entityCandidates('item', itemLabel)) goals.push(generatedGoalId(objective, sourceId, itemId));
  return goals;
}
export function resolveTaskAlias(id, { category } = {}) {
  const entries = { get: candidate => entryMap.get(candidate) ?? semanticEntry(candidate) };
  return result(id, idsOf(aliasMap.get(id)) ?? semanticCandidates(id, category), entries, category);
}
/** O(1) static resolution plus a small persisted registry overlay. */
export function resolveIdentity(id, registry, category) {
  const saved = candidatesOf(registry?.aliases?.[id]);
  const ids = [...(idsOf(aliasMap.get(id)) ?? semanticCandidates(id, category)), ...saved];
  if (record(registry?.entries?.[id])) ids.push(id);
  const entries = { get: candidate => registry?.entries?.[candidate] ?? entryMap.get(candidate) ?? semanticEntry(candidate) };
  return result(id, ids, entries, category);
}
export function lookupPermanentId(id) {
  const value = entryMap.get(id) ?? semanticEntry(id);
  return value ? { ...value, aliases: [...value.aliases] } : null;
}
export function authoredIdentityRegistry() {
  return { schemaVersion: identityRegistryVersion,
    entries: Object.fromEntries([...entryMap].map(([id, value]) => [id, { ...value, aliases: [...value.aliases] }])),
    aliases: Object.fromEntries([...aliasMap].map(([alias, ids]) => [alias, typeof ids === 'string' ? ids : [...ids]])), unresolved: [] };
}

/** Compile aliases once at an import/catalogue boundary. lookup and resolve
 * are constant-time and never scan all labels during task evaluation. */
export function buildIdentityIndex(catalogue = [], { savedRegistry, taskMap = {}, history, mappingIds } = {}) {
  if (!Array.isArray(catalogue)) throw new TypeError('Identity catalogue must be an array');
  // Potential generated rows are a lookup surface. Snapshot mutable inputs,
  // but defer merged metadata until an objective needs a public entry.
  // Alias candidates remain complete, including unselected competing targets.
  const layers = new Map(), materialized = new Map(), extraReverse = new Map(), lateEntries = new Set();
  // The authored aliases are shared read-only; this index stores only its own
  // additions over them instead of copying every authored alias per index.
  const added = new Map();
  const aliases = { has: alias => added.has(alias) || aliasMap.has(alias), get: alias => added.has(alias) ? added.get(alias) : aliasMap.get(alias) };
  const targets = value => typeof value === 'string' ? [value] : value ?? [];
  const addIndexAlias = (alias, id, reverse = false) => {
    if (typeof alias !== 'string' || !alias || typeof id !== 'string' || !id) return;
    const existing = aliases.get(alias);
    if (existing === undefined) added.set(alias, id);
    else if (typeof existing === 'string') { if (existing !== id) added.set(alias, new Set([existing, id])); }
    else if (Array.isArray(existing)) { if (!existing.includes(id)) added.set(alias, new Set([...existing, id])); }
    else existing.add(id);
    if (reverse) {
      let values = extraReverse.get(id);
      if (!values) { values = new Set(); extraReverse.set(id, values); }
      values.add(alias);
    }
  };
  const registerEntry = (id, value, oldAlias = null, remappedId = null) => {
    if (!isPermanentId(id) || !record(value)) return;
    const mutableAliases = Array.isArray(value.aliases) && !Object.isFrozen(value.aliases);
    if (!Object.isFrozen(value) || mutableAliases) value = { ...value, ...(mutableAliases ? { aliases: value.aliases.slice() } : {}) };
    layers.set(id, { value, oldAlias, remappedId, previous: layers.get(id) });
    materialized.delete(id);
    addIndexAlias(id, id);
    for (const alias of Array.isArray(value.aliases) ? value.aliases : []) addIndexAlias(alias, id);
    if (oldAlias) { addIndexAlias(oldAlias, id); addIndexAlias(value.rawLabel, id); }
    if (remappedId) addIndexAlias(remappedId, id);
  };
  for (const [id, value] of Object.entries(savedRegistry?.entries ?? {})) registerEntry(id, value);
  for (const [alias, ids] of Object.entries(savedRegistry?.aliases ?? {})) for (const id of candidatesOf(ids)) addIndexAlias(alias, id, true);
  for (const task of catalogue) {
    if (!record(task) || typeof task.id !== 'string') continue;
    const oldAlias = typeof task.rawLabel === 'string' && typeof task.category === 'string' ? legacyTaskId(task.category, task.rawLabel) : null;
    const permanent = isPermanentId(task.id) ? task.id : permanentTaskId(task.category, task.rawLabel ?? task.label);
    if (!isPermanentId(permanent)) continue;
    const value = isVerifiedProgressAlias(task.category, task.rawLabel ?? task.label)
      ? { ...task, category: entryMap.get(permanent)?.category ?? task.category } : task;
    registerEntry(permanent, value, oldAlias, task.id !== permanent ? task.id : null);
  }
  const mappedLabels = new Map();
  const mappedGoalKinds = mappingIds ? new Set([...mappingIds].filter(id => typeof id === 'string' && id.startsWith('rs3:goal:')).map(id => id.split(':')[2])) : null;
  const collectionMappings = mappedGoalKinds && ['every-drop', 'all-droptables', 'all-shops'].some(kind => mappedGoalKinds.has(kind));
  const addMapping = (label, oldId) => {
    if (typeof label !== 'string' || typeof oldId !== 'string' || !oldId.startsWith('t_')) return;
    label = normalized(label);
    // A later decoder source may establish this alias. Do not cache an empty
    // attempt: a repeated historical mapping must then be able to resolve it.
    if (label.startsWith('t_') && !aliases.has(label)) return;
    const seen = mappedLabels.get(label);
    if (seen === oldId || seen instanceof Set && seen.has(oldId)) return;
    if (seen === undefined) mappedLabels.set(label, oldId);
    else if (typeof seen === 'string') mappedLabels.set(label, new Set([seen, oldId]));
    else seen.add(oldId);
    // Do not decode tens of thousands of absent collection subjects when this
    // import contains only ordinary/equipment objectives. Exact aliases and
    // referenced old codes always keep their complete competing candidates.
    if (!aliases.has(label) && mappingIds && !mappingIds.has(oldId) && !label.startsWith('rs3:')
      && !(mappedGoalKinds.has('equipment') && /^Obtain(?: an? | )~\|/.test(label))
      && !(mappedGoalKinds.has('kill-x') && /^Kill X ~\|/.test(label))
      && !(collectionMappings && label.includes(': ~|'))) return;
    for (const id of aliases.has(label) ? targets(aliases.get(label)) : semanticCandidates(label)) {
      // A compact import index needs all targets for referenced old codes and
      // all old codes for materialized targets; other potential goals stay out.
      if (!mappingIds || mappingIds.has(oldId) || mappingIds.has(id)) addIndexAlias(oldId, id, true);
    }
  };
  const mapRows = value => {
    if (!record(value)) return;
    for (const label of Object.keys(value)) addMapping(label, value[label]);
  };
  mapRows(taskMap); mapRows(history?.current); mapRows(history?.historical); mapRows(history?.mappings);
  mapRows(history?.tombstones);
  for (const conflict of history?.conflicts ?? []) for (const id of conflict.ids ?? []) addMapping(conflict.label, id);
  const getEntry = id => {
    if (materialized.has(id)) return materialized.get(id);
    const chain = [];
    for (let layer = layers.get(id); layer; layer = layer.previous) chain.push(layer);
    const base = entryMap.get(id);
    if (!chain.length) return base ?? semanticEntry(id);
    let value = { ...base };
    const allAliases = new Set(base?.aliases ?? []);
    for (let i = chain.length - 1; i >= 0; i--) {
      const layer = chain[i];
      value = { ...value, ...layer.value };
      for (const alias of Array.isArray(layer.value.aliases) ? layer.value.aliases : []) allAliases.add(alias);
      if (layer.oldAlias) { allAliases.add(layer.oldAlias); allAliases.add(layer.value.rawLabel); }
      if (layer.remappedId) allAliases.add(layer.remappedId);
    }
    value.id = id; value.aliases = [...allAliases];
    materialized.set(id, value);
    return value;
  };
  const effectiveEntries = {
    has: id => layers.has(id) || entryMap.has(id) || !!semanticEntry(id),
    matchesCategory(id, category, prefix) {
      let categoryFound = false, currentCategory;
      for (let layer = layers.get(id); layer; layer = layer.previous) {
        if (!categoryFound && Object.hasOwn(layer.value, 'category')) {
          currentCategory = layer.value.category; categoryFound = true;
          if (currentCategory === category) return true;
        }
        if (layer.oldAlias?.startsWith(prefix) || (layer.oldAlias && layer.value.rawLabel.startsWith(prefix)) || layer.remappedId?.startsWith(prefix)
          || (Array.isArray(layer.value.aliases) && layer.value.aliases.some(alias => alias.startsWith(prefix)))) return true;
      }
      const base = entryMap.get(id) ?? (!layers.has(id) ? semanticEntry(id) : null);
      return (categoryFound ? currentCategory : base?.category) === category || !!base?.aliases?.some(alias => alias.startsWith(prefix));
    },
  };
  const resolve = (id, { category } = {}) => {
    const candidates = aliases.has(id) ? targets(aliases.get(id)) : semanticCandidates(id, category);
    const resolved = result(id, candidates, effectiveEntries, category);
    if (resolved.status === 'resolved' && !aliases.has(id)) {
      addIndexAlias(id, resolved.id, true);
      if (!layers.has(resolved.id) && !entryMap.has(resolved.id)) {
        registerEntry(resolved.id, semanticEntry(resolved.id)); lateEntries.add(resolved.id);
      }
    }
    return resolved;
  };
  const lookup = id => {
    const value = getEntry(id);
    if (!value) return null;
    const selfAlias = !lateEntries.has(id) && aliases.has(id) && [...targets(aliases.get(id))].includes(id) ? [id] : [];
    return { ...value, aliases: [...new Set([...value.aliases, ...selfAlias, ...(extraReverse.get(id) ?? [])])] };
  };
  const snapshot = ids => {
    const retained = ids === undefined ? new Set([...entryMap.keys(), ...layers.keys()]) : new Set(ids);
    const rows = {}, savedAliases = structuredClone(savedRegistry?.aliases ?? {});
    for (const id of retained) {
      const value = lookup(id);
      if (!value) continue;
      rows[id] = value;
      for (const alias of value.aliases) {
        // Saved candidates first, then retained known targets, without repeats.
        const known = aliases.get(alias), saved = savedAliases[alias];
        if (saved === undefined && typeof known === 'string') { if (retained.has(known)) savedAliases[alias] = known; continue; }
        const combined = new Set(candidatesOf(saved));
        for (const target of targets(known)) if (retained.has(target)) combined.add(target);
        if (combined.size) savedAliases[alias] = combined.size === 1 ? combined.values().next().value : [...combined];
      }
    }
    return { schemaVersion: identityRegistryVersion, entries: rows, aliases: savedAliases, unresolved: [...(savedRegistry?.unresolved ?? [])] };
  };
  return Object.freeze({ resolve, lookup, snapshot, get registry() { return snapshot(); } });
}
