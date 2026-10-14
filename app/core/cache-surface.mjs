const baseOf = id => { const separator = id.indexOf('-'); return separator < 0 ? id : id.slice(0, separator); };
export const isCacheWorld = world => !!world.cacheWalking;

/** Resolve saved selectors without confusing cache labels with legacy numbers. */
export function componentLocations(world, id, { landing = false } = {}) {
  const cache = world.cacheWalking;
  if (!cache) return [id];
  if (cache.components.has(id)) return [id];
  const [base, suffix] = id.split('-');
  if (cache.fallback.has(base)) {
    if (suffix !== undefined) return [id];
    const topology = cache.topology.get(base);
    return topology?.has('0') ? [`${base}-0`] : landing ? topology?.has('1') ? [`${base}-1`] : []
      : [...topology?.keys() ?? []].map(part => `${base}-${part}`);
  }
  if (suffix !== undefined) return cache.legacyToComponents.get(id) ?? [];
  if (landing) return cache.legacyToComponents.get(`${base}-${world.sectionTopology.get(base)?.has('0') ? '0' : '1'}`) ?? [];
  return [...cache.topology.get(base)?.keys() ?? []].map(part => `${base}-${part}`);
}

function blockedComponent(world, id, overrides, base) {
  if (overrides[id] === false) return true;
  if (world.sectionTopology.get(base)?.has('0') && overrides[`${base}-0`] === false) return true;
  const aliases = (world.cacheWalking.blockAliases ?? world.cacheWalking.componentToLegacy).get(id) ?? [];
  if (aliases.some(alias => overrides[alias] === false)) return true;
  if (world.cacheWalking.blockAliases) return false;
  // An unresolved explicit block suppresses every possible correspondence.
  const label = world.cacheWalking.components.get(id)?.label;
  return world.cacheWalking.mapping.some(record => record.legacy.startsWith(`${base}-`) && !record.components.length
    && overrides[record.legacy] === false && record.candidates.includes(label));
}

export function componentBlocked(world, id, overrides = {}) {
  return overrides[id] === false || blockedComponent(world, id, overrides, baseOf(id));
}

/** Cache node policy independently of walking seeds in a fixed compiled world.
 * Snapshot personal facts so later resource projections cannot change policy. */
export function createSurfaceEligibility(world, claimed, overrides = {}, { f2p = false } = {}) {
  const cache = world.cacheWalking;
  if (!cache) return () => false;
  const claimedBases = new Set(claimed), sectionOverrides = { ...overrides }, eligibility = new Map();
  return id => {
    if (eligibility.has(id)) return eligibility.get(id);
    const base = baseOf(id);
    const allowed = claimedBases.has(base) && !cache.blockedRegions?.has(base) && !blockedComponent(world, id, sectionOverrides, base)
      && (!f2p || (cache.components.has(id) ? cache.components.get(id).free === true : world.sectionMembership.get(base)?.get(id.split('-')[1]) ?? world.f2p.has(base)));
    eligibility.set(id, allowed);
    return allowed;
  };
}

/** Walking visits claimed bases only. Owning a split base supplies no seed.
 * A supplied eligibility predicate must match this world and personal facts. */
export function surfaceReachability(world, claimed, overrides = {}, { seeds = [], f2p = false, seedBases = claimed, eligibility } = {}) {
  const cache = world.cacheWalking, reached = new Set(), queue = [];
  if (!cache) return reached;
  const eligible = eligibility ?? createSurfaceEligibility(world, claimed, overrides, { f2p });
  const add = id => { if (!reached.has(id) && eligible(id)) { reached.add(id); queue.push(id); } };
  for (const base of seedBases) if (world.sectionTopology.get(base)?.has('0')) {
    for (const id of componentLocations(world, `${base}-0`)) add(id);
  }
  for (const [id, enabled] of Object.entries(overrides)) if (enabled === true) for (const component of componentLocations(world, id, { landing: true })) add(component);
  for (const id of seeds) for (const component of componentLocations(world, id, { landing: true })) add(component);
  // Entry lists are directed incoming dependencies; cache edges are reciprocal.
  const outgoing = cache.outgoing ?? new Map();
  if (!cache.outgoing) for (const [base, sections] of cache.topology) for (const [suffix, edges] of sections) {
    const to = `${base}-${suffix}`;
    for (const from of edges) { if (!outgoing.has(from)) outgoing.set(from, []); outgoing.get(from).push(to); }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) for (const to of outgoing.get(queue[cursor]) ?? []) add(to);
  return reached;
}

/** Only certified correspondences project resource/task section selectors. */
export function projectLegacySections(world, reached) {
  const result = new Set();
  for (const component of reached) {
    const aliases = (world.cacheWalking.resourceAliases ?? world.cacheWalking.componentToLegacy).get(component)
      ?? (world.cacheWalking.fallback.has(baseOf(component)) ? [component] : []);
    for (const alias of aliases) if (!alias.endsWith('-0')) result.add(alias);
  }
  return result;
}
