import { ANCIENT_EFFIGIES_RULE } from '../data/settings.mjs';
import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
import { activityTimingSourceRules } from '../data/activity-timing.mjs';
import { taskRuleEnabled } from './rule-defaults.mjs';
import { membershipSourceBlocker } from '../data/access-policy.mjs';
import { sourceMembershipBlocker as evaluateSourceMembership } from '../data/source-membership.mjs';
import { itemMembershipBlocker as evaluateItemMembership } from './membership.mjs';
import { parseDropRate, composeDropRates, passesRateCutoff, rateEvidence } from './rates.mjs';
import { buildWorld } from '../data/world.mjs';
import { applyCacheTopology } from '../data/cache-topology.mjs';
import { applyCacheResources } from '../data/cache-resources.mjs';
import { applyCacheArchaeology } from '../data/cache-archaeology.mjs';
import { componentLocations, createSurfaceEligibility, isCacheWorld, projectLegacySections, surfaceReachability } from '../core/cache-surface.mjs';
import { expandTransportReachability, evaluateTransportRoutes, transportAccessEnabled } from '../core/transport-access.mjs';
import { automaticTransportEnabled } from '../core/automatic-transport.mjs';

// Reference records are data only. This evaluator never executes upstream code.
const BASE = /^\d+$/;
const SECTION = /^(\d+)-(\d+)$/;
const KINDS = { Object: 'objects', NPC: 'npcs', Monster: 'monsters', Shop: 'shops', Spawn: 'spawns' };
const PLURALS = { Object: 'Objects', NPC: 'NPCs', Monster: 'Monsters', Shop: 'Shops', Spawn: 'Spawns' };
// Reference travel hubs expose their own resources but do not join geographic
// sections through their exits. An entry to an essence mine, for example, is
// not evidence that every wizard's entrance has become reachable.
const UNCONNECTED_AREAS = new Set(['Zanaris', 'Puro-Puro', 'Player-owned house', 'Player-Owned Port', 'Vinesweeper', 'Guthixian Cache', "Balthazar Beauregard's Big Top Bonanza", 'Sinkhole', 'Chinchompa cave', 'Rune Essence mine', 'Paterdomus', 'Uncharted Isles']);
const entries = value => value && typeof value === 'object' ? Object.entries(value) : [];
const has = (object, key) => Object.hasOwn(object ?? {}, key);
const itemCache = new WeakMap();
const accessDetails = new WeakMap();
const diagnosticKeys = new WeakMap();

/** Copy mutable access containers while preserving private spawn provenance. */
export function copyAccess(access) {
  const copy = Object.fromEntries(Object.entries(access).map(([key, value]) => [key,
    value instanceof Set ? new Set(value) : value instanceof Map ? new Map(value) : Array.isArray(value) ? [...value] : value]));
  if (accessDetails.has(access)) accessDetails.set(copy, accessDetails.get(access));
  return copy;
}

function decodeProfile(value) {
  if (Array.isArray(value)) return value.map(decodeProfile);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [decodeLegacyText(key).replace(/^\*fb\*_/, ''), decodeProfile(child)]));
  return typeof value === 'string' ? decodeLegacyText(value) : value;
}

function personalAccessProfile(state, member) {
  const saved = state.legacy?.maps?.[member.sourceMapId]?.chunkinfo ?? {};
  // Normalize the branches used by access at one boundary, including Firebase
  // numeric-key markers. Other account facts remain owned by the task engine.
  return decodeProfile(Object.fromEntries(['manualSections', 'manualAreas', 'manualMonsters', 'backloggedSources'].map(key => [key, saved[key]])));
}

function normalizedBacklogs(profile) {
  const result = {};
  for (const [rawKind, names] of entries(profile)) {
    const kind = rawKind.toLowerCase();
    if (!result[kind]) result[kind] = {};
    for (const [rawName, value] of entries(names)) result[kind][decodeLegacyText(rawName)] = Boolean(value);
  }
  return result;
}

function diagnostic(list, code, details) {
  const record = { code, ...details };
  // A fixed point can revisit a failed edge many times.
  const key = JSON.stringify(record);
  let keys = diagnosticKeys.get(list);
  if (!keys) { keys = new Set(list.map(value => JSON.stringify(value))); diagnosticKeys.set(list, keys); }
  if (!keys.has(key)) { keys.add(key); list.push(record); }
}

/** Compile stable location aliases and reverse dependencies once per dataset. */
export function buildAccessIndex(definitions, { dataset, cacheWalking, cacheResources, resourceCatalogue, resourceSelectors,
  cacheArchaeology, archaeologyCatalogue, lodestones, transportRoutes, transportFactsByMember } = {}) {
  if (!definitions || typeof definitions !== 'object') throw new TypeError('Definitions must be an object.');
  const worldDefinitions = { ...definitions, walkableChunks: definitions.walkableChunks ?? [], walkableChunksF2P: definitions.walkableChunksF2P ?? [] };
  let world = buildWorld(worldDefinitions, { dataset, cacheWalking, cacheResources, resourceCatalogue, resourceSelectors, cacheArchaeology, archaeologyCatalogue });
  // A preview may supply the before-state destination table. Rebuild from the
  // retained world so entry eligibility has the same table as partner travel.
  if (lodestones !== undefined && isCacheWorld(world)) {
    const retainedWorld = buildWorld(worldDefinitions, { dataset, cacheWalking: false, cacheResources: false, cacheArchaeology: false });
    // Cache mode also adds terrain-only geography before topology. Preserve
    // that footprint while starting membership/walkability from retained data.
    retainedWorld.chunks = new Map(world.chunks);
    retainedWorld.surface = new Set(world.surface);
    retainedWorld.neighbors = new Map(world.neighbors);
    world = applyCacheResources(applyCacheTopology(retainedWorld, { lodestones }), worldDefinitions,
      { enabled: cacheResources, resourceCatalogue, resourceSelectors });
    applyCacheArchaeology(world, worldDefinitions, { enabled: cacheArchaeology, archaeologyCatalogue });
  }
  const nodes = new Map(), aliases = new Map(), reverse = new Map(), topology = new Map(), baseSections = new Map();
  world.transportRoutes = transportRoutes;
  world.transportFactsByMember = transportFactsByMember;
  const diagnostics = [], connectors = [], resourceCompatibility = [], invalidSourceGates = new Map();
  for (const [id, record] of entries(definitions.chunks)) {
    if (BASE.test(id) && record.Name) aliases.set(id, record.Name);
  }
  for (const [id, record] of entries(definitions.chunks)) {
    const canonical = aliases.get(id) ?? id;
    if (record.Name && canonical !== id && definitions.chunks[canonical]) continue;
    if (record.Sections) {
      baseSections.set(canonical, Object.keys(record.Sections).map(suffix => `${canonical}-${suffix}`));
      for (const [suffix, data] of entries(record.Sections)) nodes.set(`${canonical}-${suffix}`, { id: `${canonical}-${suffix}`, base: canonical, data, kind: 'section' });
    } else nodes.set(canonical, { id: canonical, base: canonical, data: record, kind: BASE.test(canonical) ? 'base' : 'area' });
  }
  const resolve = id => aliases.get(String(id)) ?? String(id);
  const resourceCatalogues = [world.cacheResources, world.cacheArchaeology].filter(Boolean);
  for (const catalogue of resourceCatalogues) for (const [id, node] of nodes) if (catalogue.retainedNodes.has(id)) {
    node.data = catalogue.retainedNodes.get(id);
  }
  for (const kind of Object.keys(KINDS)) for (const [source, locations] of entries(definitions.taskUnlocks?.[PLURALS[kind]])) {
    for (const [location] of entries(locations)) {
      const target = resolve(location);
      if (!nodes.has(target) && !has(definitions.chunks, target)) {
        diagnostic(diagnostics, 'missing-source-location', { kind, source, location });
        invalidSourceGates.set(`${kind}:${source}`, location);
      }
    }
  }
  const addReverse = (from, to, gate, via) => {
    if (via === 'connect' && nodes.get(to)?.kind === 'section' && UNCONNECTED_AREAS.has(from)) return;
    if (via === 'transport' && BASE.test(from) && baseSections.has(from)) {
      // A bare split departure abbreviates entered sections, not ownership.
      for (const section of baseSections.get(from)) addReverse(section, to, gate, via);
      return;
    }
    if (!reverse.has(from)) reverse.set(from, []);
    const existing = reverse.get(from).find(edge => edge.to === to && edge.via === via);
    if (existing) existing.gate = { __all: [existing.gate, gate] };
    else reverse.get(from).push({ to, gate, via });
  };
  // Section lists describe entry dependencies: accessible neighbor -> section.
  for (const [base, sections] of entries(definitions.sections)) {
    for (const [suffix, neighbors] of entries(sections)) {
      const id = `${base}-${suffix}`;
      const sources = Array.isArray(neighbors) ? neighbors.map(resolve) : [];
      if (suffix !== '0') topology.set(id, sources);
      // Cache surface traversal owns walking entry. Retained section lists
      // remain available as policy/resource IDs, never a parallel bypass.
      if (isCacheWorld(world) && world.cacheWalking.topology.has(base)) {
        for (const neighbor of sources) if (world.sectionRoutes?.get(id)?.get(neighbor) === 'transport') {
          addReverse(neighbor, suffix === '0' ? base : id, true, 'transport');
        }
        continue;
      }
      if (suffix === '0') continue;
      for (const neighbor of topology.get(id)) addReverse(neighbor, id, true, 'topology');
    }
  }
  const sectionEntrances = new Map();
  for (const node of nodes.values()) if (node.kind === 'section') {
    for (const destination of Object.keys(node.data.Connect ?? {})) {
      const key = `${node.base}\u0000${resolve(destination)}`;
      if (!sectionEntrances.has(key)) sectionEntrances.set(key, []);
      sectionEntrances.get(key).push(node.id);
    }
  }
  for (const node of nodes.values()) {
    for (const [destination, gate] of entries(node.data.Connect)) {
      const target = resolve(destination);
      // An interior may abbreviate its entrance as the whole base. When the
      // base declares section entrances to that interior, those are the entry
      // locations. Ownership alone must not close an otherwise unseeded cycle.
      const entrances = node.kind === 'area' ? sectionEntrances.get(`${target}\u0000${node.id}`) : null;
      if (isCacheWorld(world) && node.kind === 'area' && !entrances && baseSections.has(target)) {
        // A retained underground entrance can abbreviate an entered surface
        // base. Its entry uses admitted legacy sections; its return marker
        // cannot seed any disconnected surface section or walking component.
        for (const approach of baseSections.get(target)) addReverse(approach, node.id, gate, 'connect');
        addReverse(node.id, target, gate, 'connect');
        continue;
      }
      for (const entrance of entrances ?? [target]) {
        addReverse(node.id, entrance, gate, 'connect');
        addReverse(entrance, node.id, gate, 'connect');
      }
    }
  }
  for (const [label, task] of entries(definitions.challenges?.Nonskill)) {
    if (task.ConnectsSections && Array.isArray(task.Sections)) connectors.push({ label, locations: task.Sections.map(resolve) });
  }
  if (isCacheWorld(world)) for (const mapping of world.cacheWalking.mapping) {
    if (mapping.components.length && mapping.project !== false || nodes.get(mapping.legacy)?.kind !== 'section') continue;
    const [base, part] = mapping.legacy.split('-');
    if (world.cacheWalking.fallback.has(base)) continue;
    for (const source of world.sectionTopology.get(base)?.get(part) ?? []) {
      const sourceBase = source.split('-')[0], kind = world.sectionRoutes.get(mapping.legacy)?.get(source);
      if (sourceBase === base || !world.neighbors.get(base)?.includes(sourceBase) || kind && kind !== 'walking') continue;
      resourceCompatibility.push({ to: mapping.legacy, from: source, mapping });
    }
  }
  // Synthetic task worlds need not occupy the retained surface crop. Interior
  // aliases still cannot become travel nodes: calculateAccess resolves them.
  const travelWorld = isCacheWorld(world) ? world : { ...world, surface: undefined };
  const retained = isCacheWorld(world) ? buildAccessIndex(definitions, { dataset, cacheWalking: false, cacheResources: false, cacheArchaeology: false, lodestones, transportRoutes, transportFactsByMember }) : undefined;
  const membersOnlyBases = new Set(), mixedBases = new Set();
  for (const component of world.cacheWalking?.components.values() ?? []) {
    if (component.membershipSource === 'cache-mask' && component.free === false) membersOnlyBases.add(component.base);
    else mixedBases.add(component.base);
  }
  for (const base of mixedBases) membersOnlyBases.delete(base);
  // Resource uncertainty cannot recover a positively absent region boundary
  // for partner travel. Unknown/missing coverage retains its previous policy.
  const resourceBoundaryAllowed = (from, to) => {
    const sourceBase = from.split('-')[0], base = to.split('-')[0];
    if (!world.cacheWalking || base === sourceBase || world.cacheWalking.fallback.has(base) || world.cacheWalking.fallback.has(sourceBase)
      || !world.cacheWalking.topology.has(base) || !world.cacheWalking.topology.has(sourceBase)) return true;
    const correspondence = (id, departure = false) => {
      if (world.cacheWalking.components.has(id)) return [id];
      // An unqualified retained departure accepts any entered section. Its
      // primary landing cannot stand in for all possible boundary witnesses.
      if (departure && !id.includes('-')) return componentLocations(world, id);
      const selector = id.includes('-') ? id : `${id}-${world.sectionTopology.get(id)?.has('0') ? '0' : '1'}`;
      const mapping = world.cacheWalking.mapping.find(record => record.legacy === selector);
      // A point anchor certifies that landing, not the extent of a retained
      // approach with unlocated contents/entrances. Conflicting placements
      // likewise cannot prove every retained approach uses one component.
      if (mapping?.resourceUnresolved && (mapping.method === 'declared-object-spatial-agreement'
        || mapping.resourceUnresolvedReason === 'declared-object-spatial-conflict')) return [];
      return id.includes('-') ? componentLocations(world, id) : componentLocations(world, id, { landing: true });
    };
    const sources = correspondence(from, true), destinations = correspondence(to);
    if (sources.length && destinations.length) return destinations.some(destination =>
      world.cacheWalking.topology.get(base)?.get(destination.split('-')[1])?.some(source => sources.includes(source)));
    return [...world.cacheWalking.topology.get(base).values()].some(edges => edges.some(edge => edge.split('-')[0] === sourceBase));
  };
  const retainedResourceWorld = retained && { ...retained.world, sectionTopology: new Map([...retained.world.sectionTopology].map(([base, parts]) => [base,
    new Map([...parts].map(([part, sources]) => [part, sources.filter(source => resourceBoundaryAllowed(source, `${base}-${part}`))]))])) };
  return { definitions, nodes, aliases, reverse, topology, baseSections, connectors, resourceCompatibility, invalidSourceGates, diagnostics, resolve, world: travelWorld, retained, retainedResourceWorld, resourceBoundaryAllowed, membersOnlyBases };
}

function taskRequirements(requirements, validTasks, diagnostics, context) {
  if (requirements === undefined || requirements === true) return true;
  if (requirements === false) return false;
  if (Array.isArray(requirements)) return requirements.every(value => taskRequirements(value, validTasks, diagnostics, context));
  if (!requirements || typeof requirements !== 'object') {
    diagnostic(diagnostics, 'unsupported-condition', { ...context, condition: requirements });
    return false;
  }
  return Object.entries(requirements).every(([label, category]) => {
    if (typeof category !== 'string') {
      diagnostic(diagnostics, 'unsupported-condition', { ...context, condition: label });
      return false;
    }
    const valid = validTasks.has(`${category}\u0000${label}`);
    if (!valid) diagnostic(diagnostics, 'task-required', { ...context, category, task: label });
    return valid;
  });
}

function connectionGate(gate, validTasks, diagnostics, context) {
  if (gate?.__all) return gate.__all.every(value => connectionGate(value, validTasks, diagnostics, context));
  if (typeof gate === 'boolean') return gate;
  if (Array.isArray(gate)) return taskRequirements(gate, validTasks, diagnostics, context);
  if (!gate || typeof gate !== 'object') return taskRequirements(gate, validTasks, diagnostics, context);
  let allowed = true;
  for (const [condition, value] of Object.entries(gate)) {
    if (condition === 'Tasks') allowed = taskRequirements(value, validTasks, diagnostics, context) && allowed;
    else {
      // No inventory/level evidence is available in this API. Do not silently
      // waive a condition merely because its spelling is recognizable.
      diagnostic(diagnostics, 'unsupported-condition', { ...context, condition, requirement: value });
      allowed = false;
    }
  }
  return allowed;
}

const connectionAllowedWithoutTasks = gate => connectionGate(gate, new Set(), [], {});

function overridesFor(state, member, legacy = personalAccessProfile(state, member)) {
  const sections = {};
  const converted = hasGameplayMigration(state, member);
  if (!converted) for (const [base, values] of entries(legacy.manualSections)) for (const [suffix, value] of entries(values)) sections[`${base}-${suffix}`] = value;
  Object.assign(sections, member.sectionOverrides ?? {});
  return { sections, areas: { ...(!hasGameplayMigration(state, member, 'areaOverrides') ? legacy.manualAreas ?? {} : {}), ...member.areaOverrides } };
}

/** Own access by default; an explicit territory admits connected capability
 * bases/sections through the same personal gates and source collector. */
export function calculateAccess(index, state, memberId, { validTasks = new Set(), legacyRules = {}, territory, retainedTerritory, collectSources = true, membershipChecks, resolveAccess, getSurfaceEligibility, transportMemo, proof } = {}) {
  if (collectSources && resolveAccess) {
    // Source gates can change while the entered locations stay identical.
    // Resolve the independently traced travel proof, then collect against the
    // current task Set without writing into that cached proof's containers.
    const walking = resolveAccess(index, state, memberId, { validTasks, legacyRules, territory, retainedTerritory,
      collectSources: false, membershipChecks, resolveAccess, getSurfaceEligibility, transportMemo });
    const result = copyAccess(walking), details = accessDetails.get(walking);
    accessDetails.set(result, { ...details, spawnQuantities: new Map(details.spawnQuantities) });
    return collectAccessResources(index, result, { validTasks, membershipChecks });
  }
  const sourceMembershipBlocker = membershipChecks?.source ?? evaluateSourceMembership;
  const member = state.members?.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const result = { bases: new Set(), sections: new Set(), components: new Set(), compatibilitySections: new Set(), areas: new Set(), possibleAreas: new Set(), blockedAreas: new Set(), entranceSources: new Map(), objects: new Set(), npcs: new Set(), monsters: new Set(), shops: new Set(), spawns: new Map(), questSteps: new Map(), clues: new Map(), locations: new Map(), diagnostics: [...index.diagnostics] };
  const { definitions, nodes, resolve } = index;
  const spawnQuantities = new Map();
  accessDetails.set(result, { spawnQuantities, proof });
  const rules = legacyRules?.rules ?? legacyRules ?? {};
  const f2p = state.rules?.['content.f2p'] ?? rules.F2P ?? true;
  const profile = personalAccessProfile(state, member);
  const converted = hasGameplayMigration(state, member, 'sourceBacklogs');
  const backloggedSources = normalizedBacklogs(legacyRules?.backloggedSources ?? (!converted ? profile.backloggedSources : {}));
  for (const [kind, names] of entries(member.sourceBacklogs)) backloggedSources[kind] = { ...backloggedSources[kind], ...names };
  result.backloggedSources = backloggedSources;
  const overrides = overridesFor(state, member, profile), accessible = new Set(), queue = [];
  let transportRelevant = !!territory && territory.transportNoop !== true;
  if (transportAccessEnabled(state) && !automaticTransportEnabled(state)) for (const route of evaluateTransportRoutes(index.world, state, memberId, {
    transportRoutes: index.world.transportRoutes, transportFactsByMember: index.world.transportFactsByMember, sectionOverrides: overrides.sections, transportMemo })) {
    if (!route.available) diagnostic(result.diagnostics, 'transport-requirements', { routeId: route.id, unmet: route.unmet, unknown: route.unknown });
  }
  accessDetails.get(result).accessible = accessible;
  const transportResourceBases = new Set(), resourceOnlyLocations = new Set(), typedSeedLocations = new Set();
  // Territory is already a round-trip admission result. Re-seeding its partner
  // endpoints would reset journey costs and bypass the original fare budget.
  const travelState = territory ? { ...state, rules: { ...state.rules, 'access.transport': false } } : state;
  const cacheSurface = isCacheWorld(index.world);
  // An unresolved correspondence is absence of evidence, never evidence of
  // lost access. Evaluate the unchanged retained policy with the same gates.
  // These references expose resources/interiors only, and cannot seed walking.
  const retainedAccess = cacheSurface && index.retained ? (resolveAccess ?? calculateAccess)(index.retained, state, memberId,
    { validTasks, legacyRules, territory: retainedTerritory ?? territory, collectSources: false, membershipChecks, resolveAccess, getSurfaceEligibility, transportMemo }) : undefined;
  const retainedLocations = retainedAccess && accessDetails.get(retainedAccess).accessible;
  const unresolvedLocations = new Map();
  for (const mapping of index.world.cacheWalking?.mapping ?? []) if ((!mapping.components.length || mapping.project === false || mapping.resourceUnresolved)
    && overrides.sections[mapping.legacy] !== false && !index.world.cacheWalking.fallback.has(mapping.legacy.split('-')[0])) {
    const location = mapping.legacy.endsWith('-0') ? mapping.legacy.split('-')[0] : mapping.legacy;
    if (f2p && overrides.sections[mapping.legacy] !== true && index.membersOnlyBases?.has(location.split('-')[0])) continue;
    if (retainedLocations?.has(location)) unresolvedLocations.set(location, mapping);
  }
  const surfaceLocation = id => /^\d+(?:-\d+)?$/.test(id) && index.world.cacheWalking?.topology.has(id.split('-')[0]);
  const admittedTerritorySections = territory && new Set([...territory.sections,
    ...(cacheSurface ? projectLegacySections(index.world, territory.sections) : [])]);
  for (const [id, enabled] of entries(overrides.areas)) if (enabled === false) result.blockedAreas.add(resolve(id));
  for (const raw of territory?.bases ?? member.unlocked ?? []) {
    const id = resolve(raw);
    if (BASE.test(id)) result.bases.add(id);
    else diagnostic(result.diagnostics, 'nonbase-unlock', { location: id });
  }
  const walkingOverrides = { ...overrides.sections };
  if (cacheSurface && territory) {
    const ownBases = new Set(member.unlocked ?? []);
    for (const base of result.bases) if (!ownBases.has(base)) {
      for (const id of componentLocations(index.world, base)) if (!territory.sections.has(id)) walkingOverrides[id] = false;
    }
  }
  const surfaceEligibility = cacheSurface ? (getSurfaceEligibility ?? createSurfaceEligibility)(index.world,
    result.bases, walkingOverrides, { f2p }) : undefined;
  const eligible = (id, compatibility = false) => {
    const membership = sourceMembershipBlocker('Area', id, f2p);
    if (membership) {
      diagnostic(result.diagnostics, 'members-only-area', { location: id, detail: membership.detail, evidence: membership.evidence });
      return false;
    }
    if (compatibility && unresolvedLocations.has(id)) return true;
    const node = nodes.get(id);
    if (node?.kind === 'section') return result.bases.has(node.base) && overrides.sections[id] !== false && (!territory || admittedTerritorySections.has(id) || compatibility);
    if (node?.kind === 'base') return result.bases.has(id) && (!cacheSurface || !surfaceLocation(id)
      || overrides.sections[`${id}-0`] !== false && (transportResourceBases.has(id)
        || [...result.components].some(component => component.split('-')[0] === id)));
    if (node?.kind === 'area') return overrides.areas[id] !== false;
    if (cacheSurface && surfaceLocation(id) && index.baseSections.has(id)) return false;
    return result.bases.has(id);
  };
  const add = (id, { compatibility = false, resourceOnly = false, from, gate, transport = false, manual = false } = {}) => {
    if (unresolvedLocations.has(id)) { compatibility = true; resourceOnly = true; }
    if (accessible.has(id)) {
      if (!compatibility && !resourceOnly && resourceOnlyLocations.delete(id)) {
        result.compatibilitySections.delete(id); queue.push(id); return true;
      }
      return false;
    }
    if (!eligible(id, compatibility)) return false;
    const node = nodes.get(id);
    if (cacheSurface && f2p && node?.kind === 'section' && overrides.sections[id] !== true && surfaceLocation(id)
      && !(compatibility && unresolvedLocations.has(id))) {
      const locations = componentLocations(index.world, id);
      const membership = index.world.sectionMembership.get(node.base);
      const free = locations.length ? locations.some(component => index.world.cacheWalking.components.get(component)?.free === true
        || index.world.cacheWalking.fallback.has(node.base) && (membership ? membership.get(id.split('-')[1]) === true : index.world.f2p.has(node.base)))
        : membership ? membership.get(id.split('-')[1]) === true : index.world.f2p.has(node.base);
      if (!free) return false;
    }
    if (node?.kind === 'area' && overrides.areas[id] !== true) {
      const areaTask = definitions.challenges?.Nonskill?.[id];
      if (areaTask?.UnlocksArea && Object.keys(areaTask).length > 1 && !validTasks.has(`Nonskill\u0000${id}`)) {
        diagnostic(result.diagnostics, 'area-task-required', { location: id, category: 'Nonskill', task: id });
        return false;
      }
      if (id === 'Puro-Puro' && rules['Puro-Puro'] === false) return false;
    }
    proof?.location(id, { from, gate, transport, manual, resourceOnly: compatibility || resourceOnly,
      areaTask: node?.kind === 'area' && overrides.areas[id] !== true && definitions.challenges?.Nonskill?.[id]?.UnlocksArea
        && Object.keys(definitions.challenges.Nonskill[id]).length > 1,
      unbound: !from && node?.kind === 'area' && overrides.areas[id] !== true });
    accessible.add(id); queue.push(id);
    if (compatibility || resourceOnly) resourceOnlyLocations.add(id);
    if (compatibility) result.compatibilitySections.add(id);
    if (node?.kind === 'section') result.sections.add(id);
    else if (node?.kind === 'area') result.areas.add(id);
    return true;
  };
  for (const base of result.bases) {
    add(base);
    const primary = `${base}-1`;
    // A sectioned base is ownership, not evidence of entry into a section.
    // Only an unpartitioned single-section record without topology can use its
    // sole section as the whole base.
    if (index.baseSections.get(base)?.length === 1 && nodes.has(primary) && !has(definitions.sections, base)) add(primary);
    else if (!nodes.has(base) && !index.baseSections.has(base)) diagnostic(result.diagnostics, 'missing-location', { location: base });
  }
  for (const [id, enabled] of entries(overrides.sections)) if (enabled === true) {
    if (!nodes.has(id)) diagnostic(result.diagnostics, 'missing-location', { location: id });
    else add(id, { manual: true });
  }
  if (territory) for (const id of territory.sections) {
    // Recompute uncertain resource selectors with provenance below. Carrying
    // them through capability collection must not promote them into seeds.
    if (cacheSurface && index.resourceCompatibility.some(entry => entry.to === id)) continue;
    add(id);
  }
  for (const [id, enabled] of entries(overrides.areas)) if (enabled === true && nodes.has(id)) add(id, { manual: true });
  for (const [id, mapping] of unresolvedLocations) {
    add(id, { compatibility: true });
    // Explicit true overrides also remain resource-only when unresolved.
    resourceOnlyLocations.add(id); result.compatibilitySections.add(id);
    diagnostic(result.diagnostics, 'unresolved-selector-retained-access', { location: id, selector: mapping.legacy,
      candidates: mapping.candidates, evidence: 'pre-cache-access-evaluation',
      reason: !mapping.components.length ? 'unresolved-component-correspondence' : mapping.resourceUnresolved ? 'unresolved-declared-content-correspondence' : 'shared-resource-correspondence',
      detail: 'Resources remain available under the original location rules while their exact tiles are being checked. This does not add a walking route or a place you can roll from.' });
  }
  let cursor = 0, changed = true;
  while (changed) {
    changed = false;
    while (cursor < queue.length) {
      const from = queue[cursor++];
      for (const edge of index.reverse.get(from) ?? []) {
        if (nodes.get(edge.to)?.kind === 'area') {
          result.possibleAreas.add(edge.to);
          if (!result.entranceSources.has(edge.to)) result.entranceSources.set(edge.to, []);
          if (!result.entranceSources.get(edge.to).includes(from)) result.entranceSources.get(edge.to).push(from);
        }
        if (!nodes.has(edge.to) && !has(definitions.chunks, edge.to) && !result.bases.has(edge.to)) {
          diagnostic(result.diagnostics, 'missing-location', { location: edge.to, from, via: edge.via });
          continue;
        }
        // Resource compatibility may expose an underground entry, but neither
        // that section nor its interior backlinks can seed surface transit.
        if (resourceOnlyLocations.has(from) && surfaceLocation(edge.to)) continue;
        if (cacheSurface && edge.via === 'transport' && nodes.get(edge.to)?.kind === 'base'
          && result.bases.has(edge.to) && overrides.sections[`${edge.to}-0`] !== false
          && (!f2p || index.world.f2p.has(edge.to) || overrides.sections[`${edge.to}-0`] === true)
          && connectionGate(edge.gate, validTasks, result.diagnostics, { from, location: edge.to })) {
          transportResourceBases.add(edge.to);
          changed = add(edge.to, { from, gate: edge.gate, transport: true }) || changed;
          continue;
        }
        if (!eligible(edge.to) || accessible.has(edge.to)) continue;
        if (cacheSurface && edge.via === 'connect' && surfaceLocation(from) && surfaceLocation(edge.to)) {
          const [destinationBase, destinationPart = '0'] = edge.to.split('-');
          const kind = index.world.sectionRoutes?.get(`${destinationBase}-${destinationPart}`)?.get(from);
          if (kind && kind !== 'walking' && kind !== 'transport') continue;
          // Unconditional surface Connect metadata cannot restore a missing
          // cache boundary. Personal task gates and classified transport are
          // independent evidence for the retained destination resources.
          if (kind !== 'transport' && connectionAllowedWithoutTasks(edge.gate)
            && !index.world.cacheWalking.fallback.has(from.split('-')[0])
            && !index.world.cacheWalking.fallback.has(destinationBase)) continue;
        }
        if (connectionGate(edge.gate, validTasks, result.diagnostics, { from, location: edge.to })) {
          changed = add(edge.to, { from, gate: edge.gate, transport: edge.via === 'transport', resourceOnly: resourceOnlyLocations.has(from) }) || changed;
        }
      }
    }
    for (const connector of index.connectors) {
      if (!validTasks.has(`Nonskill\u0000${connector.label}`)) continue;
      if (!connector.locations.every(id => SECTION.test(id) ? result.bases.has(id.match(SECTION)[1]) : accessible.has(id))) continue;
      if (connector.locations.length > 1 && !connector.locations.some(id => accessible.has(id) && !resourceOnlyLocations.has(id))) continue;
      for (const id of connector.locations) if (nodes.has(id)) changed = add(id, { from: connector.locations.find(place => accessible.has(place)), gate: { Tasks: { [connector.label]: 'Nonskill' } } }) || changed;
    }
    if (cacheSurface) {
      const walked = surfaceReachability(index.world, result.bases, walkingOverrides, {
        seeds: [...accessible].filter(id => nodes.get(id)?.kind === 'section' && !resourceOnlyLocations.has(id) && !typedSeedLocations.has(id))
          .concat([...transportResourceBases].map(base => `${base}-0`),
            [...territory?.sections ?? []].filter(id => !unresolvedLocations.has(id) && !index.resourceCompatibility.some(entry => entry.to === id))),
        seedBases: new Set(member.unlocked ?? []), f2p, eligibility: surfaceEligibility, proof,
      });
      const reached = expandTransportReachability(index.world, travelState, memberId, walked,
        { claimed: result.bases, sectionOverrides: walkingOverrides, transportRoutes: index.world.transportRoutes, transportFactsByMember: index.world.transportFactsByMember, transportMemo });
      if (!territory && reached.transportNoop !== true) transportRelevant = true;
      for (const id of reached) if (!walked.has(id)) {
        typedSeedLocations.add(id);
        for (const alias of projectLegacySections(index.world, new Set([id]))) typedSeedLocations.add(alias);
      }
      for (const id of reached) result.components.add(id);
      for (const base of result.bases) if (nodes.get(base)?.kind === 'base') changed = add(base) || changed;
      for (const id of projectLegacySections(index.world, reached)) if (nodes.has(id) && !unresolvedLocations.has(id)) {
        const mapping = index.world.cacheWalking.mapping.find(record => record.legacy === id);
        if (index.retained && mapping?.resourceUnresolved && !retainedLocations.has(id)) continue;
        changed = add(id, { from: componentLocations(index.world, id).find(component => walked.has(component)), transport: !componentLocations(index.world, id).some(component => walked.has(component)) }) || changed;
      }
      for (const entry of index.resourceCompatibility) {
        if (accessible.has(entry.to) || !eligible(entry.to, true)) continue;
        const [base, part] = entry.to.split('-'), sourceBase = entry.from.split('-')[0];
        if (!result.bases.has(sourceBase)) continue;
        const sourceEntered = accessible.has(entry.from) || (!entry.from.includes('-')
          && (index.baseSections.get(sourceBase) ?? []).some(id => accessible.has(id)));
        if (!sourceEntered) continue;
        const membership = index.world.sectionMembership.get(base);
        if (f2p && (membership ? membership.get(part) !== true : !index.world.f2p.has(base))) continue;
        const labels = entry.mapping.components.length ? entry.mapping.components : entry.mapping.candidates;
        const destinations = [...reached].filter(id => index.world.cacheWalking.components.has(id)
          && id.split('-')[0] === base && (!labels.length || labels.includes(index.world.cacheWalking.components.get(id).label)));
        const mappedSources = componentLocations(index.world, entry.from);
        const sourceCandidates = index.world.cacheWalking.mapping.find(record => record.legacy === entry.from)?.candidates ?? [];
        const sources = new Set([...reached].filter(id => index.world.cacheWalking.components.has(id)
          && id.split('-')[0] === sourceBase && (!entry.from.includes('-')
            || (mappedSources.length ? mappedSources.includes(id)
              : !sourceCandidates.length || sourceCandidates.includes(index.world.cacheWalking.components.get(id).label)))));
        const witnessed = destinations.find(id => index.world.cacheWalking.topology.get(base)?.get(id.split('-')[1])?.some(source => sources.has(source)));
        if (!witnessed) continue;
        const gates = (index.reverse.get(entry.from) ?? []).filter(edge => edge.to === entry.to && edge.via === 'connect');
        if (!gates.every(edge => connectionGate(edge.gate, validTasks, result.diagnostics, { from: entry.from, location: entry.to }))) continue;
        if (add(entry.to, { compatibility: true })) {
          changed = true;
          diagnostic(result.diagnostics, 'resource-section-compatibility', { location: entry.to, from: entry.from,
            component: witnessed, detail: 'A walking connection into the original resource area is verified; the exact resource coordinates are still being checked.',
            evidence: 'retained-section-topology', reason: entry.mapping.components.length ? 'shared-resource-alias' : 'unresolved-resource-coordinates' });
        }
      }
    } else {
      const roots = new Set([...accessible].filter(id => !typedSeedLocations.has(id)));
      const reached = expandTransportReachability(index.world, travelState, memberId, roots, { claimed: result.bases, sectionOverrides: overrides.sections,
        transportRoutes: index.world.transportRoutes, transportFactsByMember: index.world.transportFactsByMember, transportMemo });
      if (!territory && reached.transportNoop !== true) transportRelevant = true;
      for (const id of reached) if (nodes.has(id)) { if (!roots.has(id)) typedSeedLocations.add(id); changed = add(id, { transport: !roots.has(id) }) || changed; }
    }
  }
  if (transportAccessEnabled(state) && automaticTransportEnabled(state) && transportRelevant) for (const route of evaluateTransportRoutes(index.world, state, memberId, {
    transportRoutes: index.world.transportRoutes, transportFactsByMember: index.world.transportFactsByMember, sectionOverrides: overrides.sections, transportMemo })) {
    if (!route.available) diagnostic(result.diagnostics, 'transport-requirements', { routeId: route.id, unmet: route.unmet, unknown: route.unknown });
  }
  for (const base of result.bases) if (index.baseSections.has(base) && !index.baseSections.get(base).some(id => result.sections.has(id))) {
    diagnostic(result.diagnostics, 'section-entry-required', { location: base, detail: 'No accessible section entry is established; confirm a starting section or unlock a connected neighbor.' });
  }
  // Existing territory callers carry section sets. Canonical geometry IDs
  // accompany stable legacy resource IDs without entering source collection.
  if (cacheSurface) for (const id of result.components) result.sections.add(id);
  // Report preserved partner resource bases only after walking has completed.
  for (const id of unresolvedLocations.keys()) result.bases.add(id.split('-')[0]);
  accessDetails.get(result).sourceContext = { f2p, profile, overrides, retainedLocations };
  if (!collectSources) return result;
  return collectAccessResources(index, result, { validTasks, membershipChecks });
}

function collectAccessResources(index, result, { validTasks, membershipChecks }) {
  const { definitions, nodes, resolve } = index;
  const { accessible, spawnQuantities, sourceContext, proof } = accessDetails.get(result);
  const { f2p, profile, overrides, retainedLocations } = sourceContext;
  const backloggedSources = result.backloggedSources;
  const sourceMembershipBlocker = membershipChecks?.source ?? evaluateSourceMembership;
  const accessSourceBlocker = membershipChecks?.accessSource ?? ((kind, name, location, freeOnly) =>
    membershipSourceBlocker(kind, name, location, freeOnly) ?? sourceMembershipBlocker(kind, name, freeOnly));
  function collect(kind, name, location, quantity = 1, gateLocations = []) {
    if (name.includes('^') && kind === 'Shop') return;
    const key = `${kind}:${name}`;
    // A published location already passed these fixed source-policy checks.
    if (result.locations.get(key)?.includes(location)) return;
    const membership = accessSourceBlocker(kind, name, location, f2p);
    if (membership) {
      diagnostic(result.diagnostics, 'members-only-source', { kind, source: name, location,
        detail: membership.detail, evidence: membership.evidence, verifiedOn: membership.verifiedOn });
      return;
    }
    if (index.invalidSourceGates.has(key)) {
      diagnostic(result.diagnostics, 'unresolved-source-gate', { kind, source: name, location, gateLocation: index.invalidSourceGates.get(key) });
      return;
    }
    const backlogKind = KINDS[kind];
    if (backloggedSources[backlogKind]?.[name] || (kind === 'Spawn' && backloggedSources.items?.[name])) {
      diagnostic(result.diagnostics, 'source-backlogged', { kind, source: name, location });
      return;
    }
    const gate = definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[location];
    const fallback = SECTION.test(location) ? definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[location.match(SECTION)[1]] : undefined;
    if (!taskRequirements(gate ?? fallback, validTasks, result.diagnostics, { kind, source: name, location })) return;
    for (const originalLocation of gateLocations) {
      const originalGate = definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[originalLocation]
        ?? definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[originalLocation.split('-')[0]];
      if (!taskRequirements(originalGate, validTasks, result.diagnostics, { kind, source: name, location, retainedLocation: originalLocation })) return;
    }
    proof?.entity(kind, name, location, [gate ?? fallback, ...gateLocations.map(place => definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[place] ?? definitions.taskUnlocks?.[PLURALS[kind]]?.[name]?.[place.split('-')[0]])]);
    const field = result[KINDS[kind]];
    if (field instanceof Map) field.set(name, (field.get(name) ?? 0) + (Number(quantity) || 1));
    else field.add(name);
    if (kind === 'Spawn') spawnQuantities.set(`${name}\u0000${location}`, Number(quantity) || 1);
    if (!result.locations.has(key)) result.locations.set(key, []);
    if (!result.locations.get(key).includes(location)) result.locations.get(key).push(location);
  }
  for (const id of accessible) {
    const data = nodes.get(id)?.data;
    if (!data) continue;
    for (const kind of Object.keys(KINDS)) for (const [name, quantity] of entries(data[kind])) if (quantity !== false) collect(kind, name, id, quantity);
    for (const [quest] of entries(data.Quest)) {
      if (!result.questSteps.has(quest)) result.questSteps.set(quest, []);
      result.questSteps.get(quest).push(id);
    }
    for (const [tier, count] of entries(data.Clue)) result.clues.set(tier, (result.clues.get(tier) ?? 0) + (Number(count) || 0));
  }
  function collectResource(resource, location, gateLocations = [], retainedRoute = false) {
    if (f2p && resource.members === true) {
      diagnostic(result.diagnostics, 'members-only-source', { kind: 'Object', source: resource.names[0], location,
        detail: `Members-only resource: ${resource.names[0]}.` });
      return;
    }
    if (f2p && !retainedRoute && Object.hasOwn(resource, 'members') && resource.members !== false) return;
    // Reviewed synonyms describe one physical resource. Its authored gates
    // and backlog apply to every spelling emitted for that placement.
    const backloggedName = resource.names.find(name => backloggedSources.objects?.[name]);
    if (backloggedName) {
      diagnostic(result.diagnostics, 'source-backlogged', { kind: 'Object', source: backloggedName, location });
      return;
    }
    const gated = resource.names.some(name => index.invalidSourceGates.has(`Object:${name}`)
      || [location, location.split('-')[0], ...gateLocations].some(gateLocation => {
        const gate = definitions.taskUnlocks?.Objects?.[name]?.[gateLocation];
        return !taskRequirements(gate, validTasks, result.diagnostics, { kind: 'Object', source: name, location, retainedLocation: gateLocation });
      }));
    if (gated) return;
    for (const name of resource.names) collect('Object', name, location, resource.count, gateLocations);
  }
  const resourceCatalogues = [index.world.cacheResources, index.world.cacheArchaeology].filter(Boolean);
  for (const catalogue of resourceCatalogues) for (const component of result.components) for (const resource of catalogue.byComponent.get(component)?.values() ?? []) {
    collectResource(resource, component, resource.gateLocations);
  }
  // Confirming a resource must not retract its retained source because a
  // conservative closed-door mask separates its placement from the entrance.
  // This fallback exposes only the matched resource, never its component or
  // other cache-only contents. Each retained route keeps its own source gates.
  for (const catalogue of resourceCatalogues) for (const groups of catalogue.byChunk.values()) for (const resource of groups.values()) {
    for (const source of resource.retainedSources) {
      const location = resolve(source.location);
      const selector = location.includes('-') ? location : `${location}-0`;
      if (overrides.sections[selector] === false
        || f2p && overrides.sections[selector] !== true && index.membersOnlyBases?.has(location.split('-')[0])) continue;
      if (accessible.has(location) || retainedLocations?.has(location)) collectResource(resource, location, [source.location], true);
    }
  }
  // These records can add a source after its task becomes possible; they are
  // not solely annotations of sources already present in chunks.
  for (const kind of Object.keys(KINDS)) {
    for (const [name, locations] of entries(definitions.taskUnlocks?.[PLURALS[kind]])) {
      for (const [location, gate] of entries(locations)) if (accessible.has(resolve(location)) && !result.locations.get(`${kind}:${name}`)?.includes(resolve(location))) {
        if (kind === 'Object' && resourceCatalogues.some(catalogue => catalogue.superseded.get(resolve(location))?.has(name)
          || catalogue.replacedGateSources.has(`${location}\u0000${name}`))) continue;
        if (taskRequirements(gate, validTasks, result.diagnostics, { kind, source: name, location })) collect(kind, name, resolve(location));
      }
    }
  }
  for (const [name, locations] of entries(definitions.codeItems?.telegrabSpawns)) for (const [location, gate] of entries(locations)) {
    if (accessible.has(resolve(location)) && taskRequirements(gate, validTasks, result.diagnostics, { kind: 'Spawn', source: name, location })) collect('Spawn', name, resolve(location));
  }
  for (const kind of ['Object', 'NPC', 'Monster', 'Shop']) {
    for (const [name] of entries(profile.manualMonsters?.[PLURALS[kind]])) collect(kind, decodeLegacyText(name), 'Manually Added*');
  }
  return result;
}

/** Supported, task-gated numeric section routes for the pure travel graph.
 * Named interiors are not promoted into broad underground surface transit. */
export function walkingConnections(index, validTasks) {
  const routes = [], diagnostics = [];
  for (const [from, edges] of index.reverse) if (/^\d+(?:-\d+)?$/.test(from)) for (const edge of edges) {
    if (edge.via !== 'connect' || !/^\d+(?:-\d+)?$/.test(edge.to)) continue;
    if (isCacheWorld(index.world)) {
      const [base, part = '0'] = edge.to.split('-');
      const kind = index.world.sectionRoutes?.get(`${base}-${part}`)?.get(from);
      if (kind && kind !== 'walking') continue;
      if (connectionAllowedWithoutTasks(edge.gate) && index.world.cacheWalking.topology.has(base)
        && !index.world.cacheWalking.fallback.has(base)
        && !index.world.cacheWalking.fallback.has(from.split('-')[0])) continue;
      if (!componentLocations(index.world, from).length || !componentLocations(index.world, edge.to).length) continue;
    }
    if (connectionGate(edge.gate, validTasks, diagnostics, { from, location: edge.to })) routes.push([from, edge.to]);
  }
  for (const connector of index.connectors) if (validTasks.has(`Nonskill\u0000${connector.label}`)) {
    const locations = connector.locations.filter(id => /^\d+(?:-\d+)?$/.test(id));
    for (const from of locations) for (const to of locations) if (from !== to) routes.push([from, to]);
  }
  return routes;
}

export { cutoffProbability as dropThresholdProbability } from './rates.mjs';

// Split only the existing universal-tertiary prerequisite. Other source and
// task requirements, including non-tertiary effigy routes, stay intact.
export function splitEffigyGate(gate) {
  if (Array.isArray(gate)) {
    const parts = gate.map(splitEffigyGate);
    return { gate: parts.map(part => part.gate), effigies: parts.some(part => part.effigies) };
  }
  if (!gate || typeof gate !== 'object' || gate['Universal tertiary'] !== 'Nonskill') return { gate, effigies: false };
  const { ['Universal tertiary']: removed, ...rest } = gate;
  return { gate: rest, effigies: true };
}

function compileItems(definitions) {
  if (itemCache.has(definitions)) return itemCache.get(definitions);
  const gates = new Map();
  for (const [selector, gate] of entries(definitions.taskUnlocks?.Items)) {
    const [item, source] = selector.split('^');
    if (!gates.has(item)) gates.set(item, []);
    const split = item === 'Starved ancient effigy' ? splitEffigyGate(gate) : { gate, effigies: false };
    gates.get(item).push({ source, ...split });
  }
  const parsedRates = new Map();
  const parseRate = raw => {
    if (!parsedRates.has(raw)) parsedRates.set(raw, parseDropRate(raw));
    return parsedRates.get(raw);
  };
  const index = { gates, tables: definitions.codeItems?.dropTables ?? {}, parseRate };
  itemCache.set(definitions, index);
  return index;
}

/** Spawn, shop and monster sources only; crafting belongs to the task engine. */
/** Exact resource inputs read by the base collector, excluding task gates and
 * fixed definition/rule inputs. Keep iteration order and private per-location
 * spawn quantities: equal aggregate spawns alone do not imply equal sources. */
export function baseItemSourceView(access) {
  const quantity = value => typeof value === 'number' ? ['number', String(value)]
    : value === undefined ? ['undefined'] : ['value', value];
  const locations = (kind, name) => [...(access.locations.get(`${kind}:${name}`) ?? [])];
  return JSON.stringify([
    [...access.bases], [...access.sections], [...access.areas], access.backloggedSources,
    [...access.spawns].map(([name, amount]) => [name, locations('Spawn', name).map(location => [location,
      quantity(accessDetails.get(access)?.spawnQuantities.get(`${name}\u0000${location}`) ?? amount)])]),
    ...[['Shop', access.shops], ['Monster', access.monsters], ['Object', access.objects]]
      .map(([kind, names]) => [...names].map(name => [name, locations(kind, name)])),
  ]);
}

export function collectBaseItemSources(definitions, access, { rules = {}, validTasks = new Set(), expansionCache, membershipChecks, proof } = {}) {
  const sourceMembershipBlocker = membershipChecks?.source ?? evaluateSourceMembership;
  const accessSourceBlocker = membershipChecks?.accessSource ?? ((kind, name, location, freeOnly) =>
    membershipSourceBlocker(kind, name, location, freeOnly) ?? sourceMembershipBlocker(kind, name, freeOnly));
  const itemMembershipBlocker = membershipChecks?.item ?? evaluateItemMembership;
  const result = { items: new Set(), sources: new Map(), diagnostics: [] };
  const { gates, tables, parseRate } = compileItems(definitions);
  const cutoffCache = new Map();
  const backloggedSources = access.backloggedSources ?? normalizedBacklogs(rules.backloggedSources);
  const add = (item, reason) => {
    const disabled = activityTimingSourceRules(item, reason.source).filter(rule => !taskRuleEnabled(rules, rule));
    if (disabled.length) {
      diagnostic(result.diagnostics, 'activity-rule-disabled', { item, source: reason.source, rules: disabled,
        detail: `Turned off in Rules: ${disabled.join(', ')}.` });
      return;
    }
    const sourceKind = { drop: 'monsters', object: 'objects', shop: 'shops', spawn: 'spawns' }[reason.kind];
    if (backloggedSources.items?.[item] || backloggedSources[sourceKind]?.[reason.source]) {
      diagnostic(result.diagnostics, 'source-backlogged', { item, source: reason.source, kind: reason.kind });
      return;
    }
    const f2p = rules.F2P ?? true;
    const membershipKind = { drop: 'Monster', object: 'Object', shop: 'Shop' }[reason.kind];
    const membership = (membershipKind && accessSourceBlocker(membershipKind, reason.source, reason.location, f2p))
      || (reason.kind === 'shop' && (membershipSourceBlocker('ShopItem', item, reason.source, f2p)
        ?? sourceMembershipBlocker('ShopItem', item, f2p, reason.source)))
      || [...(reason.kind === 'drop' ? [reason.source] : []), ...(reason.tables ?? [])]
        .map(source => sourceMembershipBlocker('DropItem', item, f2p, source)).find(Boolean);
    if (membership) {
      diagnostic(result.diagnostics, 'members-only-source', { item, source: reason.source, kind: reason.kind,
        location: reason.location, detail: membership.detail, evidence: membership.evidence, verifiedOn: membership.verifiedOn });
      return;
    }
    const itemMembership = itemMembershipBlocker(item, f2p, definitions);
    if (itemMembership) {
      diagnostic(result.diagnostics, itemMembership.code, { ...itemMembership, source: reason.source,
        sourceKind: reason.kind, location: reason.location });
      return;
    }
    for (const gate of gates.get(item) ?? []) {
      const selector = gate.source;
      const suffix = selector?.endsWith('-source') ? '-source' : selector?.endsWith('-npc') ? '-npc' : null;
      const applies = selector === undefined || selector === '' || selector === reason.source || (suffix && reason.source.toLowerCase().includes(selector.slice(0, -suffix.length).toLowerCase()));
      if (applies && gate.effigies && !taskRuleEnabled(rules, ANCIENT_EFFIGIES_RULE)) {
        diagnostic(result.diagnostics, 'item-rule-disabled', { item, source: reason.source, rule: ANCIENT_EFFIGIES_RULE,
          detail: `Turned off in Rules: ${ANCIENT_EFFIGIES_RULE}.` });
        return;
      }
      if (applies && !taskRequirements(gate.gate, validTasks, result.diagnostics, { item, source: reason.source })) return;
    }
    if (rules['Rare Drop'] === false && reason.kind === 'drop') {
      if (!cutoffCache.has(reason.probability)) cutoffCache.set(reason.probability, passesRateCutoff(reason.probability, rules));
      if (!cutoffCache.get(reason.probability)) return;
    }
    if (proof) {
      const requirements = (gates.get(item) ?? []).filter(gate => {
        const selector = gate.source, suffix = selector?.endsWith('-source') ? '-source' : selector?.endsWith('-npc') ? '-npc' : null;
        return selector === undefined || selector === '' || selector === reason.source || suffix && reason.source.toLowerCase().includes(selector.slice(0, -suffix.length).toLowerCase());
      }).map(gate => gate.gate);
      const stock = definitions.taskUnlocks?.Shops?.[`${reason.source}^${item}`];
      if (reason.kind === 'shop' && stock) requirements.push(stock[reason.location] ?? stock[reason.location.split('-')[0]]);
      proof.source(item, reason, requirements);
    }
    result.items.add(item);
    if (!result.sources.has(item)) result.sources.set(item, []);
    result.sources.get(item).push(reason);
  };
  for (const [item, quantity] of access.spawns) for (const location of access.locations.get(`Spawn:${item}`) ?? []) add(item, { kind: 'spawn', source: location, location, quantity: accessDetails.get(access)?.spawnQuantities.get(`${item}\u0000${location}`) ?? quantity });
  for (const shop of access.shops) {
    if (rules.Minigame === false && has(definitions.codeItems?.minigameShops, shop)) continue;
    if (!definitions.shopItems?.[shop]) { diagnostic(result.diagnostics, 'missing-shop-stock', { source: shop }); continue; }
    for (const [item, stock] of entries(definitions.shopItems[shop])) if (stock !== false) {
      for (const location of access.locations.get(`Shop:${shop}`) ?? []) {
        const selectors = definitions.taskUnlocks?.Shops?.[`${shop}^${item}`];
        const gate = selectors?.[location] ?? (SECTION.test(location) ? selectors?.[location.match(SECTION)[1]] : undefined);
        if (taskRequirements(gate, validTasks, result.diagnostics, { item, source: shop, location })) add(item, { kind: 'shop', source: shop, location, ...(stock === true ? {} : { quantity: stock }) });
      }
    }
  }
  // Stock unlocked by a task may be absent from the ordinary stock table.
  for (const [selector, locations] of entries(definitions.taskUnlocks?.Shops)) {
    const [shop, item] = selector.split('^');
    if (!item || (rules.Minigame === false && has(definitions.codeItems?.minigameShops, shop))) continue;
    for (const [location, gate] of entries(locations)) {
      const admitted = access.bases.has(location) || access.sections.has(location) || access.areas.has(location);
      if (!admitted || !taskRequirements(gate, validTasks, result.diagnostics, { item, source: shop, location })) continue;
      if (!result.sources.get(item)?.some(reason => reason.kind === 'shop' && reason.source === shop && reason.location === location)) add(item, { kind: 'shop', source: shop, location });
    }
  }
  const multipliedQuantity = (parent, child) => /^\d+$/.test(String(parent)) && /^\d+$/.test(String(child)) ? String(Number(parent) * Number(child)) : `${parent} × ${child}`;
  let expansionEvents, expansionReads;
  const publishExpansion = (item, reason) => expansionEvents ? expansionEvents.push({ item, reason }) : add(item, reason);
  const expansionDiagnostic = (code, detail) => expansionEvents ? expansionEvents.push({ code, detail }) : diagnostic(result.diagnostics, code, detail);
  const expansionTask = key => {
    const present = validTasks.has(key);
    expansionReads?.set(key, present);
    return present;
  };
  const flatten = (item, quantity, rate, reason, path = [], combined = parseRate(rate), cacheRoot = true) => {
    // A literal leaf already needs only admission and one source record.
    // Memoize table traversal without wrapping ordinary drops in replay events.
    if (expansionCache && !path.length && cacheRoot && has(tables, item)) {
      const key = JSON.stringify([item, typeof quantity, quantity, typeof rate, rate, reason.kind, reason.source, reason.location]);
      const entries = expansionCache.get(key) ?? [];
      let entry = entries.find(entry => entry.quantity === quantity && entry.rate === rate
        && [...entry.reads].every(([key, present]) => validTasks.has(key) === present));
      if (!entry) {
        expansionEvents = []; expansionReads = new Map();
        flatten(item, quantity, rate, reason, path, combined, false);
        entry = { quantity, rate, events: expansionEvents, reads: expansionReads };
        entries.push(entry); expansionCache.set(key, entries);
        expansionEvents = undefined; expansionReads = undefined;
      }
      // Expansion only memoizes arithmetic and table traversal. Admission and
      // its diagnostics still run against today's task gates/source rules, in
      // the original candidate/diagnostic order, with fresh mutable reasons.
      for (const event of entry.events) {
        if (event.item !== undefined) add(event.item, { ...event.reason });
        else diagnostic(result.diagnostics, event.code, event.detail);
      }
      return;
    }
    if (!has(tables, item)) {
      if (/DropTable/.test(item)) { expansionDiagnostic('missing-drop-table', { source: reason.source, table: item }); return; }
      publishExpansion(item, { ...reason, quantity, rate, probability: combined, ...rateEvidence(rate, combined), ...(path.length ? { tables: path } : {}) }); return;
    }
    if (path.includes(item)) { expansionDiagnostic('drop-table-cycle', { source: reason.source, table: item, path }); return; }
    if (['RareDropTable+', 'GemDropTable+', 'GemDropTableLegends+', 'WildernessDropTable+'].includes(item) && rules.RDT === false) return;
    if (item === 'GemDropTableLegends+' && !expansionTask("Quest\u0000~|Legends' Quest|~ Complete the quest")) return;
    for (const [child, value] of entries(tables[item])) {
      if (typeof value === 'string') {
        const [childRate, childQuantity = '1'] = value.split('@');
        flatten(child, multipliedQuantity(quantity, childQuantity), `${rate} × ${childRate}`, reason, [...path, item], composeDropRates(combined, parseRate(childRate)));
      } else if (value && typeof value === 'object') {
        for (const [childQuantity, childRate] of entries(value)) flatten(child, multipliedQuantity(quantity, childQuantity), `${rate} × ${childRate}`, reason, [...path, item], composeDropRates(combined, parseRate(childRate)));
      } else expansionDiagnostic('unsupported-drop-record', { source: reason.source, table: item, item: child });
    }
  };
  if (rules.Skiller !== true) for (const monster of access.monsters) {
    if (rules.Boss === false && has(definitions.codeItems?.bossMonsters, monster)) continue;
    if (!definitions.drops?.[monster]) continue; // No-drop monsters are legitimate.
    for (const location of access.locations.get(`Monster:${monster}`) ?? []) for (const [item, quantities] of entries(definitions.drops[monster])) {
      for (const [quantity, rate] of entries(quantities)) flatten(item, quantity, rate, { kind: 'drop', source: monster, location });
    }
  }
  for (const object of access.objects) for (const location of access.locations.get(`Object:${object}`) ?? []) {
    for (const [item, yields] of entries(definitions.objectItems?.[object])) {
      const reason = { kind: 'object', source: object, location };
      if (yields === false) continue;
      if (yields === true || typeof yields === 'number') add(item, { ...reason, quantity: yields === true ? 1 : yields });
      else if (typeof yields === 'string') {
        const [rate, quantity = '1'] = yields.split('@');
        flatten(item, quantity, rate, reason);
      } else if (yields && typeof yields === 'object') {
        for (const [quantity, rate] of entries(yields)) {
          if (typeof rate === 'string') flatten(item, quantity, rate, reason);
          else diagnostic(result.diagnostics, 'unsupported-object-yield', { source: object, item, condition: quantity });
        }
      } else diagnostic(result.diagnostics, 'unsupported-object-yield', { source: object, item });
    }
  }
  return result;
}
