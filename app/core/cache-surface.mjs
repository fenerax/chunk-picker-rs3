// Start-only certificates, independent of the unresolved whole legacy section.
// Source: app/data/cache-selector-evidence.2026-10-07.v1.json, records[].anchors.
// Chest footprints and reviewed Wiki pins certify starts independently of the
// retained selector. Confidence and limitations remain in each provenance row.
export const startingBankSeeds = Object.freeze({
  '12084': Object.freeze({ selector: '12084-1', component: '12084-1000001',
    provenance: Object.freeze({ confidence: 'high', evidence: 'cache-selector-evidence.2026-10-07.v1.json#12084-1' }),
    objectId: 85341, x: 3061, y: 3339, witnessTiles: Object.freeze([[3060, 3339], [3060, 3340]].map(Object.freeze)) }),
  '12854': Object.freeze({ selector: '12854-0', component: '12854-1000005',
    provenance: Object.freeze({ confidence: 'high', evidence: 'cache-selector-evidence.2026-10-07.v1.json#12854-0' }),
    objectId: 115427, x: 3254, y: 3498, witnessTiles: Object.freeze([[3254, 3499], [3253, 3498]].map(Object.freeze)) }),
  '13626': Object.freeze({ selector: '13626-1', component: '13626-1000007',
    npcId: 9710, x: 3448, y: 3720, witnessTiles: Object.freeze([[3448, 3719], [3449, 3720]].map(Object.freeze)),
    provenance: Object.freeze({ confidence: 'high', mapId: 28, plane: 0,
      evidenceUrl: 'https://runescape.wiki/w/Fremennik_banker?oldid=37142600',
      suppliedBy: 'orchestrator Wiki NPC-map check, 2026-11-01',
      rationale: 'NPC tile blocked; complete walkable cardinal perimeter agrees on component 7. North/west blocked.' }) }),
  '11318': Object.freeze({ selector: '11318-1', component: '11318-1000009',
    objectId: 43808, x: 2854, y: 3461, witnessTiles: Object.freeze([[2854, 3460], [2855, 3460], [2856, 3460]].map(Object.freeze)),
    provenance: Object.freeze({ confidence: 'medium', mapId: 28, plane: 0,
      evidence: 'cache-selector-evidence.2026-10-07.v1.json#11318-6; training/banking-masks.v1.json',
      suppliedBy: 'orchestrator Wiki pin checks, 2026-11-01',
      wikiPins: Object.freeze([
        Object.freeze({ x: 2855, y: 3458, evidenceUrl: 'https://runescape.wiki/w/Violet_is_Blue?oldid=37204107' }),
        Object.freeze({ x: 2855, y: 3459, evidenceUrl: 'https://runescape.wiki/w/Violet?oldid=37140601' }),
        Object.freeze({ x: 2854, y: 3457, evidenceUrl: 'https://runescape.wiki/w/Violet_is_Blue_Too?oldid=37153083' }),
      ]),
      rationale: 'All three independent pins walk to the south perimeter in component 9, which has a boundary edge. The competing component 10 is one tile, movement 0, with no edges.',
      limitation: 'No numeric post-quest return tile is published; orchestrator accepts component 9 at medium confidence. This does not map the whole legacy selector.' }) }),
});
export const startingBankWalkabilitySha256 = 'd553ed49ce12254d197e82abe673279f3bb1ede5eb34098cf0376e68bd67fdf6';

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

/** Resolve a new start without certifying an ambiguous legacy section.
 * Keep the old section-1 seed for saved task access; an independently witnessed
 * bank component supplies walking only on the exact audited surface snapshot. */
export function startingSectionLocations(world, base) {
  const seeds = world?.sectionTopology?.get(base)?.has('1') ? [`${base}-1`] : [];
  const certificate = startingBankSeeds[base], cache = world?.cacheWalking;
  if (certificate && cache?.surfaceCorrections?.provenance?.walkabilitySha256 === startingBankWalkabilitySha256
    && cache.components.has(certificate.component) && componentLocations(world, certificate.selector).length === 0) {
    seeds.push(certificate.component);
  }
  return seeds;
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
export function surfaceReachability(world, claimed, overrides = {}, { seeds = [], f2p = false, seedBases = claimed, eligibility, proof } = {}) {
  const cache = world.cacheWalking, reached = new Set(), queue = [];
  if (!cache) return reached;
  const eligible = eligibility ?? createSurfaceEligibility(world, claimed, overrides, { f2p });
  const add = (id, from, manual = false) => { if (!reached.has(id) && eligible(id)) { proof?.location(id, { from, manual }); reached.add(id); queue.push(id); } };
  for (const base of seedBases) if (world.sectionTopology.get(base)?.has('0')) {
    for (const id of componentLocations(world, `${base}-0`)) add(id);
  }
  for (const [id, enabled] of Object.entries(overrides)) if (enabled === true) for (const component of componentLocations(world, id, { landing: true })) add(component, id, true);
  for (const id of seeds) for (const component of componentLocations(world, id, { landing: true })) add(component, component === id ? undefined : id);
  // Entry lists are directed incoming dependencies; cache edges are reciprocal.
  const outgoing = cache.outgoing ?? new Map();
  if (!cache.outgoing) for (const [base, sections] of cache.topology) for (const [suffix, edges] of sections) {
    const to = `${base}-${suffix}`;
    for (const from of edges) { if (!outgoing.has(from)) outgoing.set(from, []); outgoing.get(from).push(to); }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) for (const to of outgoing.get(queue[cursor]) ?? []) add(to, queue[cursor]);
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
