import { datasetValue } from '../dataset-runtime.mjs';
import { createRuleRegistryFromDefinitions } from './rule-registry.mjs';
import { hasGameplayMigration, projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/migration.mjs';
import { evaluatePartnerConnections } from './territory.mjs';
import { freeDestinationBlocker, frontierDestinationSections, isWalkingSectionEdge } from './map-boundaries.mjs';
import { surfaceReachability, projectLegacySections, componentBlocked } from './cache-surface.mjs';
import { TRANSPORT_ACCESS_RULE } from '../data/cache-entry-policy.mjs';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../data/skill-guide-rules.mjs';
import { expandTransportReachability, evaluateTransportRoutes, transportEdges, transportReachabilityPaths, transportBudget, affordableTransportCost, addTransportCosts, physicalTransportRoutes } from './transport-access.mjs';
import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';
import { CACHE_SECTION_OFFSET } from '../data/surface-grid.mjs';
import { personalTeleportRows } from './teleport-returns.mjs';

/**
 * Pure rules and rolling API. Settings use flat IDs (for example `roll.adjacent`).
 *
 * createRuleRegistry(extraDefinitions) accepts definitions with id, label,
 * description, type (`boolean`, `enum`, `string`, or `number`), default, optional
 * options for enums, and priority (ascending, then ordinal ID). Hooks are plain
 * functions, never evaluated strings:
 *   candidates(context) -> iterable of { id: string, detail: string }
 *   exclude({ ...context, candidateId, reasons }) -> string | string[] | null
 * Each hook receives its resolved `value` plus world, state, member, settings,
 * and accessible (a Set of personal roll origins). Custom hooks receive defensive read-only snapshots:
 * Map/Set facades preserve instanceof, iteration, lookup and forEach, and reject
 * mutation; stored objects and arrays are cloned and deeply frozen. Candidate hooks run
 * before exclusion hooks; exclusions always win. Reasons are attributed to the
 * hook's rule ID, deduplicated, and sorted by priority then ID then detail.
 * Hooks are called even for false values, so a custom rule can define both modes.
 * Registry metadata and resolved settings are frozen; no operation changes state.
 */

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const placeName = (world, id) => {
  const [base, section] = String(id).split('-');
  const name = world.chunks.get(base)?.name ?? world.areas?.get(base)?.name;
  if (!name) return String(id);
  if (!section || section === '0') return name;
  const numeric = Number(section);
  return `${numeric >= CACHE_SECTION_OFFSET ? `walkable area ${numeric - CACHE_SECTION_OFFSET}` : `section ${section}`} in ${name}`;
};
const trustedDefinitions = new WeakSet();
const explicitlySelected = reasons => reasons.some(reason => reason.ruleId === 'roll.selected');
const typedEntry = reason => reason.ruleId === TRANSPORT_ACCESS_RULE
  || reason.ruleId === 'roll.teleports' && (typeof reason.destinationSection === 'string' || reason.verifiedTeleportDestination === true);

export function teleportRollCandidates({ value, world, state, member, settings, needsAutomaticTravel }) {
  if (!value) return [];
  const owners = settings['roll.teleportScope'] === 'group' ? state.members : [member];
  const candidates = [];
  for (const owner of owners) {
    let routes;
    const routeOptions = {
      transportRoutes: world.transportRoutes, transportFactsByMember: world.transportFactsByMember,
      sectionOverrides: effectiveSectionOverrides(state, owner) };
    let personal = (owner.teleports ?? []).length ? personalTeleportRows(world, state, owner.id, [], routeOptions) : [];
    if (settings['travel.automatic'] && personal.some(row => !row.available && owner.teleports.find(saved => saved.id === row.id)?.available)) {
      routes = evaluateTransportRoutes(world, state, owner.id, routeOptions);
      personal = personalTeleportRows(world, state, owner.id, routes, routeOptions);
    }
    for (const teleport of personal) {
      if (teleport.available && (!teleport.consumable || settings['roll.consumableTeleports'])) {
        candidates.push({ id: teleport.destination, detail: `Available teleport ${teleport.label || teleport.id} (${owner.name || owner.id}).` });
      }
    }
    if (settings['travel.automatic'] && needsAutomaticTravel?.(true) !== false) {
      for (const route of routes ?? evaluateTransportRoutes(world, state, owner.id, routeOptions)) {
        if (!route.global || !(route.rollAvailable ?? route.available)) continue;
        const destination = route.rollDestination?.chunkId ?? route.to?.split('-')[0];
        if (!destination) continue;
        candidates.push({ id: destination, verifiedTeleportDestination: true, travelKind: route.kind,
          ...(route.to ? { destinationSection: route.to.split('-')[1] ?? '0' } : {}),
          detail: `Automatic ${route.name || route.id} (${owner.name || owner.id})${route.estimated ? '; estimated from reachable training' : ''}.` });
      }
    }
  }
  return candidates;
}

const authoredRuleHooks = Object.freeze([
  { id: SKILL_GUIDE_TASKS_RULE, },
  { id: SKILL_GUIDE_MILESTONES_RULE, },
  { id: SKILL_GUIDE_CORRECTIONS_RULE, },
  { id: 'access.shared', },
  { id: 'travel.automatic', },
  { id: TRANSPORT_ACCESS_RULE, candidates({ value, world, state, member, needsAutomaticTravel }) {
      if (!value) return [];
      if (state.rules?.['travel.automatic'] && needsAutomaticTravel?.(false) === false) return [];
      const claimed = new Set(member.unlocked ?? []), overrides = effectiveSectionOverrides(state, member);
      const initial = world.cacheWalking ? surfaceReachability(world, claimed, overrides, { f2p: state.rules?.['content.f2p'] !== false }) : findReachableSections(world, claimed, overrides);
      if (!world.cacheWalking) for (const base of claimed) if (world.sectionTopology.get(base)?.has('0')) initial.add(base);
      const paths = transportReachabilityPaths(world, state, member.id, initial, { claimed, sectionOverrides: overrides, transportRoutes: world.transportRoutes, transportFactsByMember: world.transportFactsByMember });
      const budget = transportBudget(state, member.id, world.transportFactsByMember, world);
      const routes = evaluateTransportRoutes(world, state, member.id, { sectionOverrides: effectiveSectionOverrides(state, member), transportRoutes: world.transportRoutes, transportFactsByMember: world.transportFactsByMember });
      return routes.filter(route => route.available).flatMap(route => {
        const legs = route.global ? paths.size ? [{ to: route.to }] : [] : transportEdges([route]).filter(edge =>
          (paths.get(edge.from) ?? []).some(cost => affordableTransportCost(addTransportCosts(cost, edge.cost), budget)));
        return legs.map(leg => ({ id: leg.to.split('-')[0], destinationSection: leg.to.split('-')[1] ?? '0', travelKind: route.kind, detail: `${route.name || route.id}; personal travel requirements confirmed.` }));
      });
    } },
  {
    id: 'roll.selected', candidates({ value, member }) {
      return value ? (member.selected ?? []).map(id => ({ id, detail: 'Manually selected as a roll candidate by this member.' })) : [];
    },
  },
  {
    id: 'roll.adjacent', candidates({ value, world, accessible, settings, state, member }) {
      if (!value || settings['roll.neighborMode'] === 'manual') return [];
      const candidates = [];
      const overrides = effectiveSectionOverrides(state, member);
      if (world.cacheWalking && settings['roll.neighborMode'] === 'accessible') {
        const reached = new Set(reachableSections(world, state, member.id));
        for (const [base, topology] of world.cacheWalking.topology) {
          if (accessible.has(base)) continue;
          for (const [section, edges] of topology) {
            if (componentBlocked(world, `${base}-${section}`, overrides)) continue;
            for (const edge of edges) if (reached.has(edge) && world.neighbors.get(base)?.includes(edge.split('-')[0])) {
              candidates.push({ id: base, destinationSection: section, detail: `Verified walking connection from ${placeName(world, edge)} to ${placeName(world, `${base}-${section}`)}.` });
            }
          }
        }
        return candidates;
      }
      const sections = settings['roll.neighborMode'] === 'accessible' ? new Set(reachableSections(world, state, member.id)) : null;
      for (const base of [...accessible].sort(compare)) {
        for (const id of world.neighbors.get(base) ?? []) {
          if (sections) {
            const topology = world.sectionTopology?.get(id);
            if (!topology) continue;
            const connections = [...topology].flatMap(([section, edges]) => overrides[`${id}-${section}`] === false ? [] : edges
              .filter(edge => edge.split('-')[0] === base && isWalkingSectionEdge(world, id, section, edge)
                && connectionIsReachable(world, accessible, sections, overrides, edge))
              .map(edge => ({ edge, section })));
            if (!connections.length) continue;
            for (const { edge, section } of connections) candidates.push({ id, destinationSection: section,
              detail: `Walking connection from unlocked ${placeName(world, edge)} to ${placeName(world, `${id}-${section}`)}.` });
            continue;
          }
          for (const destinationSection of frontierDestinationSections(world, base, id, overrides)) {
            candidates.push({ id, destinationSection, detail: `Next to unlocked ${placeName(world, base)}${destinationSection === undefined ? '' : `, entering ${placeName(world, `${id}-${destinationSection}`)}`}.` });
          }
        }
      }
      return candidates;
    },
  },
  { id: 'roll.neighborMode', },
  { id: 'roll.clearSelected', },
  {
    id: 'roll.walkable', exclude({ value, world, candidateId, reasons, settings }) {
      return value && settings['roll.neighborMode'] !== 'accessible' && !explicitlySelected(reasons) && !reasons.some(typedEntry) && !world.walkable.has(candidateId) ? 'Not a walkable destination.' : null;
    },
  },
  {
    id: 'roll.teleports', candidates: teleportRollCandidates,
  },
  { id: 'roll.teleportScope', },
  { id: 'roll.consumableTeleports', },
  {
    id: 'content.f2p', exclude({ value, world, candidateId, reasons }) {
      return value && !explicitlySelected(reasons) && !reasons.some(typedEntry) ? freeDestinationBlocker(world, candidateId, reasons) : null;
    },
  },
  { id: 'tasks.completion', },
].map(Object.freeze));

const ruleContract = datasetValue('app/core/rules.mjs#ruleContract');
const rulePresentation = datasetValue('app/core/rules.mjs#rulePresentation');
export const builtInRules = Object.freeze(ruleContract.map(metadata => {
  const hook = authoredRuleHooks.find(rule => rule.id === metadata.id);
  if (!hook) throw new TypeError('Unknown dataset rule hook.');
  const wording = rulePresentation.find(rule => rule.id === metadata.id);
  return Object.freeze({ ...metadata, ...wording, ...(hook.candidates ? { candidates: hook.candidates } : {}), ...(hook.exclude ? { exclude: hook.exclude } : {}) });
}));

/** Return the full gameplay registry, retaining trusted built-in hook identities. */
export function createRuleRegistry(extraDefinitions = []) {
  if (!Array.isArray(extraDefinitions)) throw new TypeError('Rule definitions must be an array.');
  return createRuleRegistryFromDefinitions([...builtInRules, ...extraDefinitions], {
    onNormalize(original, normalized) { if (builtInRules.includes(original)) trustedDefinitions.add(normalized); },
  });
}

const defaultRegistry = createRuleRegistry();

function memberContext(state, memberId, registry) {
  if (!state || !Array.isArray(state.members)) throw new TypeError('State needs a members array.');
  const member = state.members.find(candidate => candidate.id === memberId);
  if (!member) throw new RangeError(`Unknown member: ${memberId}.`);
  return { state, member, settings: registry.resolve(state.rules) };
}

function checkedDetail(detail, ruleId) {
  if (typeof detail !== 'string' || !detail.trim()) throw new TypeError(`Rule ${ruleId} must return a nonempty reason string.`);
  return detail;
}

export function effectiveSectionOverrides(state, member) {
  const overrides = {};
  // Legacy numeric keys were encoded with *fb*_; retain a read-only fallback
  // until the dedicated migration writes member.sectionOverrides.
  const manual = hasGameplayMigration(state, member) ? {} : state.legacy?.maps?.[member.sourceMapId]?.chunkinfo?.manualSections;
  for (const [rawBase, entries] of Object.entries(manual ?? {})) {
    const base = rawBase.replace(/^\*fb\*_/, '');
    if (!/^[1-9]\d*$/.test(base) || !entries || typeof entries !== 'object') continue;
    for (const [rawSection, value] of Object.entries(entries)) {
      const section = rawSection.replace(/^\*fb\*_/, '');
      if (/^(?:0|[1-9]\d*)$/.test(section) && typeof value === 'boolean') overrides[`${base}-${section}`] = value;
    }
  }
  return { ...overrides, ...(member.sectionOverrides ?? {}) };
}

// Bare IDs describe an unsplit chunk (section 0), or the whole source chunk
// where the retained data omits a section suffix. Unlocking a split chunk must
// not silently make every one of its disconnected sections reachable.
function connectionIsReachable(world, accessible, reachable, overrides, edge) {
  const [base, section] = edge.split('-');
  if (!accessible.has(base)) return false;
  if (section !== undefined && section !== '0') return reachable.has(edge);
  const topology = world.sectionTopology?.get(base);
  if (topology?.has('0')) return overrides[`${base}-0`] !== false;
  if (section === '0') return false;
  return [...(topology?.keys() ?? [])].some(part => reachable.has(`${base}-${part}`));
}

function findReachableSections(world, accessible, overrides) {
  const reachable = new Set();
  const reverseEdges = new Map();
  const queue = [];
  const add = id => { if (!reachable.has(id) && overrides[id] !== false) { reachable.add(id); queue.push(id); } };
  for (const base of accessible) {
    for (const [section, edges] of world.sectionTopology?.get(base) ?? []) {
      // Section 0 describes whole-chunk adjacency and must not expand reachability.
      if (section === '0') continue;
      const id = `${base}-${section}`;
      const walkingEdges = edges.filter(edge => isWalkingSectionEdge(world, base, section, edge));
      if (overrides[id] === false) continue;
      if (overrides[id] === true || walkingEdges.some(edge => connectionIsReachable(world, accessible, reachable, overrides, edge))) add(id);
      for (const edge of walkingEdges) {
        const [sourceBase, sourceSection] = edge.split('-');
        if (!accessible.has(sourceBase)) continue;
        // An unsuffixed split source can become reachable later in this walk.
        const sources = sourceSection !== undefined ? [edge] : [...(world.sectionTopology?.get(sourceBase)?.keys() ?? [])].map(part => `${sourceBase}-${part}`);
        for (const source of sources) {
          if (!reverseEdges.has(source)) reverseEdges.set(source, []);
          reverseEdges.get(source).push(id);
        }
      }
    }
  }
  for (let index = 0; index < queue.length; index++) for (const id of reverseEdges.get(queue[index]) ?? []) add(id);
  return reachable;
}

/** Sorted reachable nonzero sections; only unlocked bases and personal overrides contribute. */
export function reachableSections(world, state, memberId, registry = defaultRegistry) {
  const { member, settings } = memberContext(state, memberId, registry);
  const accessible = new Set(member.unlocked ?? []);
  if (world.cacheWalking) {
    const reached = expandTransportReachability(world, state, memberId, surfaceReachability(world, accessible, effectiveSectionOverrides(state, member), { f2p: settings['content.f2p'] }),
      { claimed: accessible, sectionOverrides: effectiveSectionOverrides(state, member), transportRoutes: world.transportRoutes, transportFactsByMember: world.transportFactsByMember });
    return [...new Set([...reached, ...projectLegacySections(world, reached)])].sort(compare);
  }
  const initial = findReachableSections(world, accessible, effectiveSectionOverrides(state, member));
  if (settings[TRANSPORT_ACCESS_RULE]) for (const base of accessible) if (world.sectionTopology.get(base)?.has('0')) initial.add(base);
  return [...expandTransportReachability(world, state, memberId, initial, { claimed: accessible, sectionOverrides: effectiveSectionOverrides(state, member), transportRoutes: world.transportRoutes, transportFactsByMember: world.transportFactsByMember })].sort(compare);
}

/** Map/UI travel evidence; task access supplies its richer gated section sets. */
export function partnerConnections(world, state, memberId, registry = defaultRegistry) {
  return evaluatePartnerConnections(world, state, memberId, { sectionOverrides: effectiveSectionOverrides(state, memberContext(state, memberId, registry).member), sectionsByMember: Object.fromEntries(state.members.map(owner => [owner.id, reachableSections(world, state, owner.id, registry)])),
    ...(state.rules?.[TRANSPORT_ACCESS_RULE] ? { personalTravelSeeds: reachableSections(world, { ...state, rules: { ...state.rules, [TRANSPORT_ACCESS_RULE]: false } }, memberId, registry) } : {}) });
}

// A frozen Map/Set still permits set/add. Proxy copied collections instead, with
// no method that exposes the backing collection (including forEach/valueOf).
function readonlyCollection(collection) {
  const fail = () => { throw new TypeError('Rule hook context is read-only.'); };
  const mutators = new Set(['set', 'add', 'delete', 'clear']);
  const readers = new Set(['get', 'has', 'keys', 'values', 'entries', Symbol.iterator]);
  let facade;
  facade = new Proxy(collection, {
    get(target, property) {
      if (mutators.has(property)) return fail;
      if (property === 'forEach') return (callback, thisArg) => target.forEach((value, key) => callback.call(thisArg, value, key, facade));
      if (property === 'valueOf') return () => facade;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' && readers.has(property) ? value.bind(target) : value;
    },
    set: fail, deleteProperty: fail, defineProperty: fail, setPrototypeOf: fail,
  });
  return facade;
}

function readonlySnapshot(value, copies = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') throw new TypeError('Rule hook snapshots require data properties, not functions.');
    return value;
  }
  if (copies.has(value)) return copies.get(value);
  if (value instanceof Map || value instanceof Set) {
    const copy = value instanceof Map ? new Map() : new Set();
    const facade = readonlyCollection(copy);
    copies.set(value, facade);
    if (value instanceof Map) for (const [key, item] of value) copy.set(readonlySnapshot(key, copies), readonlySnapshot(item, copies));
    else for (const item of value) copy.add(readonlySnapshot(item, copies));
    return facade;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Rule hook snapshots support plain objects, arrays, Maps and Sets.');
  }
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  copies.set(value, copy);
  for (const property of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && property === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (!('value' in descriptor)) throw new TypeError('Rule hook snapshots require data properties, not accessors.');
    Object.defineProperty(copy, property, { value: readonlySnapshot(descriptor.value, copies), enumerable: descriptor.enumerable, writable: true, configurable: true });
  }
  return Object.freeze(copy);
}

/** Evaluate roll candidates without changing unlocks, selections, or teleport availability. */
export function evaluateRollPool(world, state, memberId, registry = defaultRegistry) {
  if (!(world?.chunks instanceof Map) || !(world.neighbors instanceof Map) || !(world.walkable instanceof Set) || !(world.f2p instanceof Set)) {
    throw new TypeError('World needs chunks/neighbors Maps and walkable/f2p Sets.');
  }
  if (world.surface !== undefined && !(world.surface instanceof Set)) throw new TypeError('Optional world.surface must be a Set.');
  const context = memberContext(state, memberId, registry);
  const { member, settings } = context;
  const accessible = new Set((settings['access.shared'] ? state.members : [member]).flatMap(owner => owner.unlocked ?? []));
  const owned = new Set(member.unlocked ?? []);
  const pendingRoll = new Set(member.pendingRoll ?? []);
  const blacklisted = new Set(member.blacklisted ?? []);
  const candidates = new Map();
  const priorities = new Map(registry.definitions.map(definition => [definition.id, definition.priority]));
  const reasonOrder = (a, b) => (priorities.get(a.ruleId) ?? 0) - (priorities.get(b.ruleId) ?? 0) || compare(a.ruleId, b.ruleId) || compare(a.detail, b.detail);
  const normalizeReasons = reasons => [...new Map(reasons.map(reason => [JSON.stringify([reason.ruleId, reason.detail]), reason])).values()].sort(reasonOrder);
  const hookContext = { ...context, world, accessible: owned };
  const blockersFor = (id, reasons) => {
    const blockers = [];
    if (!world.chunks.has(id)) blockers.push({ ruleId: 'world.known', detail: 'Unknown chunk destination.' });
    if (world.surface && !world.surface.has(id)) blockers.push({ ruleId: 'world.surface', detail: 'Outside the supported surface grid.' });
    if (world.cacheWalking?.blockedRegions?.has(id) && !reasons.some(typedEntry)) blockers.push({ ruleId: 'world.entry',
      detail: 'No verified walking connection or transport route into this chunk.' });
    if (owned.has(id)) blockers.push({ ruleId: 'state.unlocked', detail: 'Already unlocked on this member’s own map; shared task access does not exclude partner-owned chunks.' });
    if (pendingRoll.has(id)) blockers.push({ ruleId: 'state.pendingRoll', detail: 'Already offered in this member’s pending roll.' });
    if (blacklisted.has(id)) blockers.push({ ruleId: 'state.blacklisted', detail: 'Blacklisted by this member.' });
    for (const definition of registry.definitions) {
      if (!definition.exclude) continue;
      const details = definition.exclude(Object.freeze({ ...contextFor(definition), value: settings[definition.id], candidateId: id, reasons: Object.freeze(reasons.map(reason => Object.freeze({ ...reason }))) }));
      if (details === null || details === undefined) continue;
      for (const detail of Array.isArray(details) ? details : [details]) blockers.push({ ruleId: definition.id, detail: checkedDetail(detail, definition.id) });
    }
    return blockers;
  };
  // Built-in exclusions cannot reject an already eligible destination when
  // another inclusion reason is added. Skip redundant supply evaluation only
  // with this trusted registry; custom hooks can inspect every travel reason.
  // The full Teleports catalogue remains independently evaluated for review.
  const needsAutomaticTravel = registry.definitions.every(definition => trustedDefinitions.has(definition)) ? globalOnly => {
    const catalogue = world.transportRoutes ?? TRANSPORT_ROUTES;
    const stations = new Map((catalogue.stations ?? []).map(station => [station.id, station]));
    const unnecessary = id => typeof id === 'string' && (!world.chunks.has(id) || world.surface && !world.surface.has(id)
      || owned.has(id) || pendingRoll.has(id) || blacklisted.has(id)
      || candidates.has(id) && blockersFor(id, normalizeReasons(candidates.get(id))).length === 0);
    let rawDestinationNeeded = false;
    for (const route of catalogue.routes ?? []) {
      if (globalOnly && route.from !== null || settings['content.f2p'] && (route.members === true || route.f2p === false)
        || route.consumable === true && !settings['roll.consumableTeleports']) continue;
      const destinations = [stations.get(route.to)?.chunkId];
      if (route.from === null && route.rollDestination?.chunkId) destinations.push(route.rollDestination.chunkId);
      if (!globalOnly && route.from !== null && route.bidirectional === true) destinations.push(stations.get(route.from)?.chunkId);
      if (!destinations.every(unnecessary)) { rawDestinationNeeded = true; break; }
    }
    if (!rawDestinationNeeded) return false;
    if (globalOnly) return true;
    // Access candidates require exact landings. A geometry-only, zero-cost
    // superset can reject impossible catalogue endpoints before any supplies
    // are derived. Roll-only destination certificates stay in the raw path.
    return physicalTransportRoutes(world, state, member.id, { transportRoutes: catalogue,
      transportFactsByMember: world.transportFactsByMember, sectionOverrides: effectiveSectionOverrides(state, member) })
      .some(route => route.available && (!unnecessary(route.to?.split('-')[0])
        || !route.global && route.bidirectional && !unnecessary(route.from?.split('-')[0])));
  } : undefined;
  const trustedContext = { ...hookContext, needsAutomaticTravel };
  let customContext;
  const contextFor = definition => {
    if (trustedDefinitions.has(definition)) return trustedContext;
    return customContext ??= readonlySnapshot(hookContext);
  };
  for (const definition of registry.definitions) {
    if (!definition.candidates) continue;
    const additions = definition.candidates(Object.freeze({ ...contextFor(definition), value: settings[definition.id] }));
    if (!additions || typeof additions[Symbol.iterator] !== 'function') throw new TypeError(`Rule ${definition.id} candidates must return an iterable.`);
    for (const addition of additions) {
      if (!addition || typeof addition.id !== 'string' || !addition.id) throw new TypeError(`Rule ${definition.id} returned an invalid candidate ID.`);
      const reason = { ruleId: definition.id, detail: checkedDetail(addition.detail, definition.id),
          ...(['roll.teleports', TRANSPORT_ACCESS_RULE].includes(definition.id) && trustedDefinitions.has(definition) && addition.travelKind === 'lodestone' ? { travelKind: 'lodestone' } : {}),
        ...(definition.id === 'roll.teleports' && trustedDefinitions.has(definition) && addition.verifiedTeleportDestination === true ? { verifiedTeleportDestination: true } : {}),
        ...(typeof addition.destinationSection === 'string' ? { destinationSection: addition.destinationSection } : {}) };
      if (!candidates.has(addition.id)) candidates.set(addition.id, []);
      candidates.get(addition.id).push(reason);
    }
  }
  const eligible = [];
  const excluded = [];
  for (const id of [...candidates.keys()].sort(compare)) {
    const reasons = normalizeReasons(candidates.get(id));
    const blockers = blockersFor(id, reasons);
    // Excluded entries retain their inclusion reasons as well as every blocker.
    (blockers.length ? excluded : eligible).push({ id, reasons: normalizeReasons([...reasons, ...blockers]) });
  }
  return { eligible, excluded, accessible: [...accessible].sort(compare) };
}

/**
 * Report personal and rule-scoped completion without rewriting member records.
 * requiredBy lists members within the completion scope (all group members for
 * any/all, target member for personal), including those already complete.
 */
export function taskCompletion(state, taskId, memberId, registry = defaultRegistry) {
  taskId = resolveSavedTaskId(state.identityRegistry, taskId);
  state = { ...state, members: state.members.map(owner => projectMemberTaskFacts(state, owner, state.tasks)) };
  const { member, settings } = memberContext(state, memberId, registry);
  if (!Array.isArray(state.tasks) || !state.tasks.some(task => resolveSavedTaskId(state.identityRegistry, task.id) === taskId)) throw new RangeError(`Unknown task: ${taskId}.`);
  const completedBy = state.members.filter(owner => (owner.completedTasks ?? []).includes(taskId)).map(owner => owner.id).sort(compare);
  const personal = completedBy.includes(member.id);
  const mode = settings['tasks.completion'];
  const requiredBy = mode === 'personal' ? [member.id] : state.members.map(owner => owner.id).sort(compare);
  const group = mode === 'personal' ? personal : mode === 'all' ? requiredBy.every(id => completedBy.includes(id)) : completedBy.length > 0;
  return { personal, group, completedBy, requiredBy };
}

/** Challenge checkmarks remain separate from actual personal game completion. */
export function challengeCompletion(state, taskId, memberId, registry = defaultRegistry) {
  taskId = resolveSavedTaskId(state.identityRegistry, taskId);
  state = { ...state, members: state.members.map(owner => projectMemberTaskFacts(state, owner, state.tasks)) };
  const { member, settings } = memberContext(state, memberId, registry);
  if (!state.tasks.some(task => resolveSavedTaskId(state.identityRegistry, task.id) === taskId)) throw new RangeError(`Unknown task: ${taskId}.`);
  const completedBy = state.members.filter(owner => owner.taskStatus?.[taskId]?.challengeCompleted === true).map(owner => owner.id).sort(compare);
  const personal = completedBy.includes(member.id);
  const mode = settings['tasks.completion'];
  const requiredBy = mode === 'personal' ? [member.id] : state.members.map(owner => owner.id).sort(compare);
  const group = mode === 'personal' ? personal : mode === 'all' ? requiredBy.every(id => completedBy.includes(id)) : completedBy.length > 0;
  return { personal, group, completedBy, requiredBy };
}

function cryptoIndex(limit) {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) throw new Error('Cryptographic randomness is unavailable; provide a random function explicitly.');
  const range = 0x100000000;
  const ceiling = range - range % limit;
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= ceiling);
  return values[0] % limit;
}

/**
 * Sample eligible entries without replacement. Accept an evaluateRollPool result
 * or its eligible array. count must be a safe integer from 0 through pool size;
 * Roll2 with one candidate throws before drawing. An injected random() must
 * return a finite number in [0, 1). Default crypto integer draws use rejection
 * sampling to avoid modulo bias in modern Node and browsers.
 */
export function sampleRoll(pool, count, random) {
  const entries = Array.isArray(pool) ? pool : pool?.eligible;
  if (!Array.isArray(entries)) throw new TypeError('A roll pool must be an eligible array or an evaluated pool.');
  if (!Number.isSafeInteger(count) || count < 0 || count > entries.length) throw new RangeError(`Roll count must be an integer from 0 through ${entries.length}.`);
  if (random !== undefined && typeof random !== 'function') throw new TypeError('Random source must be a function.');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new TypeError('Eligible entries must have unique nonempty string IDs.');
    ids.add(entry.id);
  }
  // Clone reason records too, so callers can record/edit the result independently.
  const remaining = entries.map(entry => ({ ...entry, ...(entry.reasons ? { reasons: entry.reasons.map(reason => ({ ...reason })) } : {}) }));
  const result = [];
  for (let index = 0; index < count; index++) {
    const limit = remaining.length - index;
    let offset;
    if (random === undefined) offset = cryptoIndex(limit);
    else {
      const value = random();
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Random source must return a finite number in [0, 1).');
      offset = Math.floor(value * limit);
    }
    const chosen = index + offset;
    [remaining[index], remaining[chosen]] = [remaining[chosen], remaining[index]];
    result.push(remaining[index]);
  }
  return result;
}
