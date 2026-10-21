const isPermanentId = id => typeof id === 'string' && /^rs3:(?:task|entity|goal):/.test(id);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Resolve a server-materialized registry without loading the authored catalogue. */
export function resolvePersistedIdentity(id, registry, category) {
  const saved = registry?.aliases?.[id];
  const candidates = typeof saved === 'string' ? [saved] : Array.isArray(saved) ? [...saved] : [];
  if (record(registry?.entries?.[id])) candidates.push(id);
  let ids = [...new Set(candidates)].filter(candidate => record(registry?.entries?.[candidate]));
  if (category !== undefined) {
    const normalized = String(category).normalize('NFC');
    const prefix = `rs3:${encodeURIComponent(normalized)}:`;
    ids = ids.filter(candidate => {
      const entry = registry.entries[candidate];
      return entry.category === normalized || entry.aliases?.some(alias => alias.startsWith(prefix));
    });
  }
  return ids.length === 1 ? { status: 'resolved', id: ids[0], candidates: ids }
    : { status: ids.length ? 'ambiguous' : 'unresolved', candidates: ids, originalId: id };
}

/** Ambiguous and unknown aliases remain available for review. */
export function resolveSavedTaskId(registry, id, category) {
  const result = resolvePersistedIdentity(id, registry, category);
  return result.status === 'resolved' ? result.id : id;
}

const catalogueAliasIndexes = new WeakMap();

/** Read-only compatibility projection for direct task calculations. */
export function projectMemberTaskFacts(state, member, catalogue = [], {
  resolveIdentity = resolvePersistedIdentity,
  savedAliases = state.identityRegistry?.savedAliases ?? state.identityRegistry?.aliases,
} = {}) {
  if (!(member.completedTasks?.length || Object.keys(member.taskStatus ?? {}).length || Object.keys(member.taskAlternatives ?? {}).length)) return member;
  let index = catalogueAliasIndexes.get(catalogue);
  if (!index) {
    index = new Map();
    index.taskCategories = new Map();
    index.categoryAliases = new Map();
    index.decodedCategories = new Map();
    catalogueAliasIndexes.set(catalogue, index);
  }
  // Catalogues are stable, as with the previous complete WeakMap index. Batch
  // new saved references into one scan, retaining misses for later members and
  // saves without allocating target maps for unrelated collection aliases.
  const missingIds = new Set(), missingCategories = new Set();
  const query = id => { if (!index.has(id)) missingIds.add(id); };
  for (const id of member.completedTasks ?? []) query(id);
  for (const id of Object.keys(member.taskStatus ?? {})) query(id);
  for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const id of Object.values(groups)) {
    if (id !== null) query(id);
    else if (!index.categoryAliases.has(category)) missingCategories.add(category);
  }
  for (const id of missingIds) index.set(id, undefined);
  for (const category of missingCategories) index.categoryAliases.set(category, undefined);
  if (!index.initialized || missingIds.size || missingCategories.size) {
    for (const task of catalogue) {
      if (!index.initialized) index.taskCategories.set(task.id, task.category);
      for (const alias of task.aliases ?? []) {
        // Permanent IDs can themselves be aliases; all exact candidates matter.
        if (missingIds.has(alias)) {
          const targets = index.get(alias) ?? new Map(); targets.set(task.id, task.category); index.set(alias, targets);
        }
        if (missingCategories.size && typeof alias === 'string' && alias.startsWith('rs3:') && !isPermanentId(alias)) {
          const end = alias.indexOf(':', 4), encoded = alias.slice(4, end < 0 ? undefined : end);
          if (!index.decodedCategories.has(encoded)) {
            let decoded;
            try { decoded = decodeURIComponent(encoded); } catch { /* malformed aliases remain reviewable */ }
            index.decodedCategories.set(encoded, decoded);
          }
          const category = index.decodedCategories.get(encoded);
          if (missingCategories.has(category)) {
            const categories = index.categoryAliases.get(category) ?? new Set(); categories.add(task.category); index.categoryAliases.set(category, categories);
          }
        }
      }
    }
    index.initialized = true;
  }
  // A saved key can occur in completion, status and alternative records. This
  // projection owns one fixed registry/catalogue snapshot, so resolve each
  // ID/category pair once without retaining results across later saves.
  const resolutions = new Map();
  const resolve = (id, category) => {
    let categories = resolutions.get(id);
    if (categories?.has(category)) return categories.get(category);
    const exact = index.get(id);
    const targets = new Set(exact ? [] : resolveIdentity(id, state.identityRegistry, category).candidates);
    for (const [target, taskCategory] of exact ?? []) if (category === undefined || category === taskCategory || id.startsWith(`rs3:${encodeURIComponent(category)}:`)) targets.add(target);
    if (exact) {
      const saved = savedAliases?.[id];
      for (const target of Array.isArray(saved) ? saved : typeof saved === 'string' ? [saved] : []) {
        const entry = state.identityRegistry?.entries?.[target];
        if (entry && (category === undefined || category === entry.category)) targets.add(target);
      }
    }
    const target = targets.size === 1 ? [...targets][0] : id;
    if (!categories) { categories = new Map(); resolutions.set(id, categories); }
    categories.set(category, target);
    return target;
  };
  const completedTasks = [...new Set((member.completedTasks ?? []).map(id => resolve(id)))];
  const taskStatus = Object.create(null);
  // Stable alias-then-canonical order preserves explicit false and empty notes,
  // without repeatedly resolving keys from a sorting comparator.
  const aliasStatuses = [], canonicalStatuses = [];
  for (const [id, status] of Object.entries(member.taskStatus ?? {})) {
    const target = resolve(id);
    (target === id ? canonicalStatuses : aliasStatuses).push([target, status]);
  }
  for (const [target, status] of [...aliasStatuses, ...canonicalStatuses]) {
    taskStatus[target] = { ...(taskStatus[target] ?? {}), ...status };
  }
  const taskAlternatives = Object.create(null);
  const renamedAlternatives = [], canonicalAlternatives = [];
  for (const [category, groups] of Object.entries(member.taskAlternatives ?? {})) for (const [group, id] of Object.entries(groups)) {
    const target = id === null ? null : resolve(id, category), categoryAliases = index.categoryAliases.get(category);
    const currentCategory = target === null ? categoryAliases?.size === 1 ? [...categoryAliases][0] : category
      : index.taskCategories.get(target) ?? state.identityRegistry?.entries?.[target]?.category ?? category;
    (category === currentCategory ? canonicalAlternatives : renamedAlternatives).push({ currentCategory, group, target });
  }
  for (const { currentCategory, group, target } of [...renamedAlternatives, ...canonicalAlternatives]) { taskAlternatives[currentCategory] ??= Object.create(null); taskAlternatives[currentCategory][group] = target; }
  return { ...member, completedTasks, ...(member.taskStatus !== undefined ? { taskStatus: Object.fromEntries(Object.entries(taskStatus)) } : {}),
    ...(member.taskAlternatives !== undefined ? { taskAlternatives: Object.fromEntries(Object.entries(taskAlternatives).map(([category, groups]) => [category, Object.fromEntries(Object.entries(groups))])) } : {}) };
}
