// Browser display data comes from the same corrected server world as gameplay.
// Resource evidence is retained on the server; the contents list reads these
// four provenance fields rather than the repeated catalogue evidence graph.
function contents(record) {
  if (!record || typeof record !== 'object') return record;
  const projected = { ...record };
  if (record.ObjectProvenance) projected.ObjectProvenance = Object.fromEntries(
    Object.entries(record.ObjectProvenance).map(([name, provenance]) => [name,
      Object.fromEntries(['source', 'classKey', 'components', 'cacheOnly']
        .filter(key => Object.hasOwn(provenance, key)).map(key => [key, provenance[key]]))]));
  for (const key of ['Sections', 'CacheComponents']) if (record[key]) projected[key] =
    Object.fromEntries(Object.entries(record[key]).map(([id, node]) => [id, contents(node)]));
  return projected;
}

export function projectDisplayWorld(world) {
  return {
    schemaVersion: 1,
    chunks: [...world.chunks], areas: [...world.areas ?? []],
    surface: [...world.surface ?? []], walkable: [...world.walkable ?? []], f2p: [...world.f2p ?? []],
    sectionTopology: [...world.sectionTopology ?? []].map(([base, sections]) => [base, [...sections]]),
    cacheTopology: world.cacheWalking ? [...world.cacheWalking.topology.keys()] : null,
    resourceContents: [...world.resourceContents ?? []].map(([id, record]) => [id, contents(record)]),
  };
}

export function hydrateDisplayWorld(payload) {
  if (payload?.schemaVersion !== 1) throw new TypeError('Unsupported display world version.');
  return {
    chunks: new Map(payload.chunks), areas: new Map(payload.areas),
    surface: new Set(payload.surface), walkable: new Set(payload.walkable), f2p: new Set(payload.f2p),
    sectionTopology: new Map(payload.sectionTopology.map(([base, entries]) => [base, new Map(entries)])),
    ...(payload.cacheTopology ? { cacheWalking: { topology: new Map(payload.cacheTopology.map(base => [base, []])) } } : {}),
    resourceContents: new Map(payload.resourceContents),
  };
}
