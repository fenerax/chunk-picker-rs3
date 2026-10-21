import { datasetJSON } from "../dataset-runtime.mjs";
const cache = await datasetJSON("app/data/cache-walkability.2026-10-07.v1.json");
const policy = await datasetJSON("app/data/cache-component-policy.2026-10-07.v1.json");
import { cacheEntryPolicies, cacheEntryKinds, cacheNonEntryPolicies } from './cache-entry-policy.mjs';
import { surfaceLodestones } from './lodestones.mjs';
const surfaceCorrections = await datasetJSON("app/data/cache-surface-corrections.2026-10-08.v1.json");

import { CACHE_SECTION_OFFSET } from './surface-grid.mjs';
export { CACHE_SECTION_OFFSET } from './surface-grid.mjs';
export const cacheSectionId = (base, label) => `${base}-${CACHE_SECTION_OFFSET + Number(label)}`;
export const cacheSurfaceRegions = [...new Set([
  ...cache.regions.filter(([, status, tiles]) => status === 'decoded' && tiles > 0).map(([base]) => base),
  ...surfaceCorrections.regionLabels.map(record => record.region),
  ...surfaceCorrections.displayOnlyRegions.map(record => record.region),
])];
// Exact surface-label coordinates in the selected cache pin bundle, not guessed
// positions from the obsolete baked image. These records add no resources.
export const cacheRegionNames = Object.freeze(Object.fromEntries(surfaceCorrections.regionLabels.map(record => [record.region, record.name])));

/** Cache labels have their own namespace; saved authored selectors stay stable. */
export function applyCacheTopology(world, { lodestones = surfaceLodestones } = {}) {
  const components = new Map(), topology = new Map(), legacyToComponents = new Map(), componentToLegacy = new Map(), resourceAliases = new Map();
  const coverage = new Map(), fallback = new Set(), membership = new Map(policy.membership), partsByBase = new Map();
  const witnessedRegions = new Set(), walkingEvidence = new Map(), entryEvidence = new Map();
  const nonEntryEvidence = new Map(cacheNonEntryPolicies.map(record => [record.region, record]));
  const invalidRegions = new Set(surfaceCorrections.invalidRegionIds);
  const nonWalkingComponents = new Set(surfaceCorrections.nonWalkingComponentIds);
  const suppressedRegions = new Map();
  for (const [base, name] of Object.entries(cacheRegionNames)) if (world.chunks.has(base)) {
    world.chunks.set(base, { ...world.chunks.get(base), name });
  }
  for (const [base, status, tiles, parts] of cache.regions) {
    if (!world.surface.has(base)) continue;
    coverage.set(base, status);
    if (invalidRegions.has(base)) { suppressedRegions.set(base, 'phantom-floor-without-surface'); continue; }
    if (status !== 'decoded' || !parts.length) { fallback.add(base); continue; }
    const surfaceParts = parts.filter(([label]) => !nonWalkingComponents.has(`${base}:${label}`));
    if (!surfaceParts.length) { suppressedRegions.set(base, 'isolated-rendered-water-without-entry'); continue; }
    topology.set(base, new Map());
    const counts = new Map((membership.get(base) ?? []).map(([label, free, members, unknown]) => [label, { free, members, unknown }]));
    for (const [label, count, minX, minY, maxX, maxY] of surfaceParts) {
      const id = cacheSectionId(base, label), mask = counts.get(label) ?? { free: 0, members: 0, unknown: count };
      const settled = !mask.unknown && (!mask.free || !mask.members);
      components.set(id, { id, base, label, tiles: count, bounds: [minX, minY, maxX, maxY], counts: mask,
        free: settled ? mask.free > 0 : null, membershipSource: settled ? 'cache-mask' : 'unresolved' });
      topology.get(base).set(String(CACHE_SECTION_OFFSET + label), []);
    }
    partsByBase.set(base, surfaceParts.map(([label]) => components.get(cacheSectionId(base, label))));
  }
  for (const record of policy.mapping) {
    const base = record.legacy.split('-')[0];
    const ids = record.components.map(label => cacheSectionId(base, label)).filter(id => components.has(id));
    legacyToComponents.set(record.legacy, ids);
    for (const id of ids) {
      if (!componentToLegacy.has(id)) componentToLegacy.set(id, []);
      componentToLegacy.get(id).push(record.legacy);
      if (record.project) resourceAliases.set(id, [...resourceAliases.get(id) ?? [], record.legacy]);
    }
  }
  for (const component of components.values()) if (component.free === null) {
    const authored = (componentToLegacy.get(component.id) ?? []).map(id => world.sectionMembership.get(component.base)?.get(id.split('-')[1])).filter(value => typeof value === 'boolean');
    if (authored.length && authored.every(value => value === authored[0])) {
      component.free = authored[0]; component.membershipSource = 'wiki-section';
    } else if (!component.counts.members && component.counts.unknown) {
      component.free = world.f2p.has(component.base); component.membershipSource = 'retained-region';
    }
  }
  const add = (from, to) => topology.get(from.split('-')[0])?.get(from.split('-')[1])?.push(to);
  for (const [from, to, portals, x, y] of cache.edges) {
    const [a, labelA] = from.split(':'), [b, labelB] = to.split(':');
    const source = cacheSectionId(a, labelA), target = cacheSectionId(b, labelB);
    if (a !== b && portals > 0 && Number.isFinite(x) && Number.isFinite(y)
      && components.has(source) && components.has(target) && world.neighbors.get(a)?.includes(b)) {
      add(source, target); add(target, source);
      for (const [base, component, neighbor] of [[a, source, target], [b, target, source]]) {
        witnessedRegions.add(base);
        if (!walkingEvidence.has(base)) walkingEvidence.set(base, []);
        walkingEvidence.get(base).push({ component, neighbor, portals, witness: [x, y], evidence: 'cache-cardinal-portals' });
      }
    }
  }
  const recordEntry = record => {
    const base = record.location.split('-')[0];
    if (!world.surface.has(base) || !cacheEntryKinds.has(record.kind)) return;
    if (!entryEvidence.has(base)) entryEvidence.set(base, []);
    entryEvidence.get(base).push(record);
  };
  for (const record of cacheEntryPolicies) recordEntry(record);
  for (const stone of lodestones) recordEntry({ location: stone.location, kind: 'lodestone',
    detail: `${stone.name} lodestone landing.`, evidence: 'app/data/lodestones.mjs', conditions: 'Activation and personal travel rules still apply' });
  // Route metadata describes incoming entry dependencies, not outbound routes.
  for (const [location, routes] of world.sectionRoutes) for (const [source, kind] of routes) if (cacheEntryKinds.has(kind)) {
    const authored = world.mapCorrections.find(record => record.field === 'routeKind'
      && `${record.chunk}-${record.section}` === location && record.edge === source && record.newValue === kind);
    if (authored?.evidenceUrl) recordEntry({ location, source, kind, detail: authored.rationale, evidence: authored.evidenceUrl });
  }
  // Only unknown/missing plane-0 coverage gets retained walking dependencies.
  // A decoded missing boundary never recovers an old edge.
  const fallbackRoutes = [];
  const locations = raw => {
    const [base, suffix] = raw.split('-');
    if (fallback.has(base)) return suffix && suffix !== '0' ? [raw] : world.sectionTopology.get(base)?.has('0') ? [`${base}-0`] : [...world.sectionTopology.get(base)?.keys() ?? []].map(part => `${base}-${part}`);
    if (suffix !== undefined) return legacyToComponents.get(raw) ?? [];
    return [...topology.get(base)?.keys() ?? []].map(part => `${base}-${part}`);
  };
  for (const base of fallback) if (world.sectionTopology.has(base)) topology.set(base, new Map([...world.sectionTopology.get(base)].map(([part]) => [part, []])));
  for (const [base, sections] of world.sectionTopology) for (const [part, edges] of sections) for (const edge of edges) {
    const sourceBase = edge.split('-')[0], kind = world.sectionRoutes.get(`${base}-${part}`)?.get(edge);
    if ((!fallback.has(base) && !fallback.has(sourceBase)) || kind && kind !== 'walking'
      || !world.neighbors.get(base)?.includes(sourceBase)) continue;
    for (const to of locations(`${base}-${part}`)) for (const from of locations(edge)) {
      add(to, from); // Topology is incoming entry dependencies.
      fallbackRoutes.push({ from, to, kind: 'walking', reason: 'missing-or-empty-plane-0-coverage', evidence: 'retained-section-topology' });
    }
  }
  for (const [base, sections] of topology) {
    const parts = partsByBase.get(base) ?? [];
    if (parts.length && parts.every(component => component.free === false)) world.f2p.delete(base);
    else if (parts.some(component => component.free === true)) world.f2p.add(base);
    const membershipMap = new Map();
    for (const [part] of sections) membershipMap.set(part, components.get(`${base}-${part}`)?.free === true);
    if (parts.length) world.componentMembership.set(base, membershipMap);
  }
  // A rendered floor or a retained dependency is not entry evidence. Unknown
  // coverage keeps its compatibility topology, but cannot certify a roll.
  const eligibility = new Map(), blockedRegions = new Set();
  for (const base of world.surface) {
    const walking = walkingEvidence.get(base) ?? [], entries = entryEvidence.get(base) ?? [];
    const eligible = !suppressedRegions.has(base) && (witnessedRegions.has(base) || entries.length > 0);
    const status = coverage.get(base) ?? 'missing';
    const reason = suppressedRegions.get(base) ?? (eligible ? walking.length ? 'witnessed-walking-edge' : 'known-typed-entry'
      : status !== 'decoded' ? 'unknown-surface-coverage-without-entry'
      : partsByBase.has(base) ? 'isolated-components-without-entry' : 'empty-plane-0-without-entry');
    eligibility.set(base, { eligible, reason, coverage: status, walking, entries,
      ...(nonEntryEvidence.has(base) ? { nonEntryEvidence: nonEntryEvidence.get(base) } : {}) });
    if (eligible) world.walkable.add(base);
    else {
      blockedRegions.add(base);
      world.walkable.delete(base);
      world.f2p.delete(base);
      world.componentMembership.delete(base);
    }
  }
  const blockAliases = new Map(componentToLegacy), outgoing = new Map();
  for (const record of policy.mapping) if (!record.components.length) for (const label of record.candidates) {
    const id = cacheSectionId(record.legacy.split('-')[0], label);
    blockAliases.set(id, [...blockAliases.get(id) ?? [], record.legacy]);
  }
  for (const [base, sections] of topology) for (const [part, edges] of sections) for (const from of edges) {
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(`${base}-${part}`);
  }
  world.cacheWalking = { topology, components, coverage, fallback, legacyToComponents, componentToLegacy,
    blockAliases, outgoing, resourceAliases, eligibility, blockedRegions, entryEvidence,
    surfaceCorrections,
    mapping: policy.mapping, fallbackRoutes, provenance: cache.provenance, policyProvenance: policy.provenance,
    doors: cache.summary.doors, conditionalMorphs: cache.summary.conditionalMorphs };
  return world;
}
