import { componentLocations, surfaceReachability } from './cache-surface.mjs';
import { transportReachabilityPaths, transportBudget, affordableTransportCost, addTransportCosts } from './transport-access.mjs';
import { automaticTransportEnabled, deriveAutomaticTransport } from './automatic-transport.mjs';
import { teleportReturnCache } from './teleport-return-cache.mjs';
import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';
import { surfaceLodestones } from '../data/lodestones.mjs';

const baseOf = id => id.split('-')[0];
export const ONE_WAY_REASON = "One-way for now: there’s no way back to your chunks from here. Activate a lodestone in your own area first.";

// This module calls the shared journey evaluator with already evaluated rows.
// It never evaluates routes recursively or turns a teleport arrival into a root.
export function requireTeleportReturns(world, state, memberId, rows, options = {}) {
  // Carpet roll options are journeys too: budget the paid outward and return
  // legs, including the monkey colony's directed service, before offering one.
  const needsReturn = row => row.kind === 'carpet' || row.global || ['teleport', 'lodestone', 'portal'].includes(row.kind) && !row.bidirectional;
  if (!rows.some(needsReturn)) return rows;
  const member = state.members.find(row => row.id === memberId);
  const owned = new Set(member.unlocked ?? []), overrides = options.sectionOverrides ?? member.sectionOverrides ?? {};
  const claimed = state.rules?.['access.shared'] === false ? owned : new Set(state.members.flatMap(row => row.unlocked ?? []));
  const f2p = state.rules?.['content.f2p'] !== false;
  const initial = world.cacheWalking ? surfaceReachability(world, owned, overrides, { f2p }) : new Set();
  if (!world.cacheWalking) {
    for (const base of owned) if (world.sectionTopology?.get(base)?.has('0') && overrides[`${base}-0`] !== false) initial.add(base);
    for (const [id, enabled] of Object.entries(overrides)) if (enabled === true && owned.has(baseOf(id))) initial.add(id);
  }
  // The unchanged task baseline may prove gated walking sections, but partner
  // territory never becomes this member's journey root.
  for (const id of options.automaticContext?.reachableLocations ?? []) if (owned.has(baseOf(id))) initial.add(id);
  const roots = new Set(initial);
  // Keep roll-only activation estimates separate from exact task landings.
  // A reviewed reachable home chunk can support the network for planning; it
  // still supplies no geometry edge to the task evaluator.
  const estimatedHome = [...rows, ...(options.planningRows ?? [])].some(row => row.available && row.kind === 'lodestone'
    && !row.to && row.rollDestination && claimed.has(row.rollDestination.chunkId)
    && options.automaticContext?.reachableBases.has(row.rollDestination.chunkId));
  const escapes = rows.filter(row => row.available && row.global && row.to).map(row => ({ to: row.to, cost: row.cost ?? {} }));
  for (const row of member.teleports ?? []) if (row.available && (!row.consumable || state.rules?.['roll.consumableTeleports'])) {
    const to = personalLanding(world, row.destination);
    if (to) escapes.push({ to, cost: {} });
  }
  const budget = options.transportBudgetOverride ?? transportBudget(state, memberId, options.transportFactsByMember, world, options.automaticContext);
  const compute = () => {
    // Derive the budget once, rather than rescanning task/fact inputs for each
    // landing. The graph and Pareto journey evaluator remain unchanged.
    const common = { ...options, typedRoutes: rows, transportBudgetOverride: budget, _skipNoop: true, _requireReturn: true };
    const home = transportReachabilityPaths(world, state, memberId, initial, { ...common, claimed });
    const byBase = new Map();
    const journeysTo = to => {
      const base = baseOf(to);
      if (claimed.has(base)) return home;
      if (!byBase.has(base)) byBase.set(base, transportReachabilityPaths(world, state, memberId, initial,
        { ...common, claimed: new Set([...claimed, base]) }));
      return byBase.get(base);
    };
    const escapeCosts = escapes.flatMap(row => (journeysTo(row.to).returnPaths?.get(row.to) ?? []).map(cost => addTransportCosts(row.cost, cost)));
    return rows.map(row => {
      if (!needsReturn(row)) return true;
      let back = roots.size > 0 && (estimatedHome && affordableTransportCost(row.cost ?? {}, budget)
        || escapeCosts.some(cost => affordableTransportCost(addTransportCosts(row.cost ?? {}, cost), budget)));
      if (!back && row.to) {
        back = (journeysTo(row.to).returnPaths?.get(row.to) ?? []).some(cost => affordableTransportCost(addTransportCosts(row.cost ?? {}, cost), budget));
      }
      return back;
    });
  };
  // The graph consumes evaluated routes, not raw task/fact declarations.
  // Capture its exact roots, bound, blocks, costs, home declarations and
  // reviewed catalogue inputs. Selection, history and pending rolls have no
  // bearing on this proof. World geometry is immutable for a world's lifetime;
  // configure/releaseAutomaticTransportCaches also clear these decisions.
  const catalogue = options.transportRoutes ?? TRANSPORT_ROUTES;
  const key = options.returnProofCache === false ? null : JSON.stringify([
    memberId, f2p, [...initial], [...claimed], overrides, budget, estimatedHome, !!options._physicalUpper, !!options._proofLower,
    rows.map(row => [row.id, row.from, row.to, row.available, row.global, row.kind, row.bidirectional, row.cost]),
    (member.teleports ?? []).filter(row => row.available && (!row.consumable || state.rules?.['roll.consumableTeleports'])).map(row => row.destination),
    (options.lodestones ?? surfaceLodestones).map(row => [row.chunkId, row.location, row.f2p]),
    (catalogue.stations ?? []).map(row => [row.id, row.chunkId]),
    (catalogue.routes ?? []).map(row => [row.id, row.kind, row.to]),
  ]);
  const back = key === null ? compute() : (options.returnProofCache ?? teleportReturnCache).evaluate(world, key, compute);
  // Distinguish a missing fare from a missing way home. Raise only coins in
  // this diagnostic proof; quests, items, geometry and confirmations still gate it.
  const coinFailure = value => value.requirement === 'currencies' && value.key === 'coins';
  const coinCandidates = rows.some((row, index) => !back[index] && row.kind === 'carpet'
    && [...row.unmet, ...row.unknown].every(coinFailure));
  const coinProof = !options._coinProof && coinCandidates ? requireTeleportReturns(world, state, memberId,
    rows.map(row => ({ ...row, unmet: row.unmet.filter(value => !coinFailure(value)), unknown: row.unknown.filter(value => !coinFailure(value)),
      available: row.available || [...row.unmet, ...row.unknown].length > 0 && [...row.unmet, ...row.unknown].every(coinFailure) })),
    { ...options, _coinProof: true, transportBudgetOverride: { ...budget, 'currencies:coins': 1e12 } }) : null;
  return rows.map((row, index) => back[index] ? row : { ...row, available: false,
    unmet: [...row.unmet, coinProof?.[index].available && row.kind === 'carpet'
      ? { requirement: 'return-coins', key: row.id, detail: 'Needs coins for the outward and return journey.' }
      : { requirement: 'return-route', key: row.id, detail: ONE_WAY_REASON }] });
}

function personalLanding(world, destination) {
  if (typeof destination !== 'string' || !world.chunks.has(baseOf(destination))) return null;
  if (world.cacheWalking) {
    const locations = componentLocations(world, destination, { landing: true });
    return locations.length === 1 ? locations[0] : null;
  }
  const [base, suffix = '0'] = destination.split('-');
  return world.sectionTopology?.get(base)?.has(suffix) ? suffix === '0' ? base : destination : null;
}

export function personalTeleportRows(world, state, memberId, routes = [], options = {}) {
  const member = state.members.find(row => row.id === memberId);
  if (!member.teleports?.length) return [];
  const personal = (member.teleports ?? []).map(row => ({ ...row, global: true, kind: 'teleport', to: personalLanding(world, row.destination),
    available: row.available && (!row.consumable || state.rules?.['roll.consumableTeleports'] === true), unmet: [], unknown: [], cost: {} }));
  const proof = routes.map(row => row.global && row.rollAvailable ? { ...row, available: true } : row);
  const automaticContext = routes.length && automaticTransportEnabled(state) ? deriveAutomaticTransport(world, state, memberId, options) : null;
  const evaluated = requireTeleportReturns(world, state, memberId, [...proof, ...personal], { ...options, automaticContext,
    ...(!routes.length ? { transportBudgetOverride: {} } : {}) });
  return evaluated.slice(routes.length).map(row => ({ ...row, reason: row.unmet[0]?.detail }));
}
