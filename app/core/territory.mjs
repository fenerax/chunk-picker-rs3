import { surfaceLodestones } from '../data/lodestones.mjs';
import { surfaceReachability, componentLocations, projectLegacySections, componentBlocked } from './cache-surface.mjs';
import { isWalkingSectionEdge } from './map-boundaries.mjs';
import { transportAccessEnabled, evaluateTransportRoutes, transportEdges, expandTransportReachability, transportBudget,
  affordableTransportPaths, affordableTransportCost, addTransportCosts, physicalTransportRoutes, reviewedLodestoneUsable, transportReachabilityPaths } from './transport-access.mjs';
import { automaticTransportEnabled } from './automatic-transport.mjs';

const baseOf = id => id.split('-')[0];
const sorted = values => [...values].sort();

/** Pure directed travel over unlocked surface sections. Entry dependencies are
 * source -> destination, never inferred reciprocal edges or geometric paths.
 * sectionsByMember bounds each owner's reachable map before sharing. */
export function evaluatePartnerConnections(world, state, memberId, { sectionsByMember = {}, lodestones = surfaceLodestones, sectionOverrides, walkingRoutes = [], transportRoutes, transportFactsByMember, typedRoutes, personalTravelSeeds, transportBudgetOverride, transportMemo, _bound } = {}) {
  const catalogue = transportRoutes ?? world.transportRoutes;
  const focusedMember = state.members.find(owner => owner.id === memberId);
  const automatic = automaticTransportEnabled(state) && transportAccessEnabled(state);
  if (!_bound && typedRoutes === undefined && automatic) {
    // A legacy/custom selector whose choice changes with admitted nodes cannot
    // support bounds. Keep its established full evaluator as the fallback.
    const owned = new Set(state.members.flatMap(owner => owner.unlocked ?? []));
    const destinations = [...(focusedMember?.teleports ?? []).filter(teleport => teleport.available).map(teleport => teleport.destination),
      ...lodestones.filter(stone => state.rules?.['content.f2p'] === false || stone.f2p).map(stone => stone.location ?? stone.chunkId)]
      .filter(id => typeof id === 'string' && owned.has(baseOf(id)));
    const ambiguous = destinations.some(id => world.cacheWalking ? componentLocations(world, id, { landing: true }).length > 1
      : !id.includes('-') && !world.sectionTopology.get(id)?.has('0') && (world.sectionTopology.get(id)?.size ?? 0) > 1);
    if (!ambiguous) {
      const common = { sectionsByMember, lodestones, sectionOverrides, walkingRoutes, transportRoutes: catalogue,
        transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember,
        personalTravelSeeds, transportBudgetOverride: {}, transportMemo };
      const lower = evaluatePartnerConnections(world, state, memberId, { ...common, typedRoutes: [], _bound: 'lower' });
      const upper = evaluatePartnerConnections(world, state, memberId, { ...common,
        typedRoutes: physicalTransportRoutes(world, state, memberId, { transportRoutes: catalogue,
          transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember, sectionOverrides, transportMemo }), _bound: 'upper' });
      const identical = ['bases', 'sections', 'components', 'reachable'].every(field => {
        const a = lower[field] ?? [], b = upper[field] ?? [];
        return a.length === b.length && a.every((id, i) => id === b[i]);
      });
      if (identical) return { ...lower, transportNoop: true };
    }
  }
  const typed = typedRoutes ?? (transportAccessEnabled(state) ? evaluateTransportRoutes(world, state, memberId,
    { transportRoutes: transportRoutes ?? world.transportRoutes, transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember, sectionOverrides, transportMemo }) : []);
  if (world.cacheWalking) {
    const focused = state.members.find(owner => owner.id === memberId);
    if (!focused) throw new TypeError(`Unknown member: ${memberId}`);
    const blocked = sectionOverrides ?? focused.sectionOverrides ?? {};
    const canonical = {};
    for (const owner of state.members) {
      const supplied = sectionsByMember[owner.id] ?? [];
      const explicitComponents = supplied.filter(id => world.cacheWalking.components.has(id)
        || world.cacheWalking.fallback.has(baseOf(id)) && id.includes('-'));
      const reached = Object.hasOwn(sectionsByMember, owner.id)
        ? new Set(explicitComponents.length ? explicitComponents : supplied.flatMap(id => componentLocations(world, id, { landing: true })))
        : surfaceReachability(world, new Set(owner.unlocked ?? []), owner.sectionOverrides ?? {},
          { f2p: state.rules?.['content.f2p'] !== false });
      const admittedEndpoints = new Set(typed.filter(route => route.available).flatMap(route => [route.from, route.to]));
      canonical[owner.id] = [...reached].filter(id => (!world.cacheWalking.blockedRegions?.has(baseOf(id)) || admittedEndpoints.has(id))
        && !componentBlocked(world, id, blocked));
    }
    const roots = personalTravelSeeds ?? [...surfaceReachability(world, new Set(focused.unlocked ?? []), blocked, { f2p: state.rules?.['content.f2p'] !== false })];
    if (typed.length) {
      const claimed = new Set(state.members.flatMap(owner => owner.unlocked ?? []));
      const focusedReach = expandTransportReachability(world, state, memberId, new Set(roots), { claimed,
        sectionOverrides: blocked, transportRoutes: catalogue, transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember, transportMemo,
        typedRoutes: _bound ? typed : undefined, transportBudgetOverride: _bound ? {} : transportBudgetOverride,
        _physicalUpper: _bound === 'upper', _proofLower: _bound === 'lower', _skipNoop: !!_bound });
      for (const owner of state.members) if (owner.id !== memberId) canonical[owner.id] = sorted(new Set([...canonical[owner.id],
        ...[...focusedReach].filter(id => (owner.unlocked ?? []).includes(baseOf(id)))]));
    }
    const landing = id => componentLocations(world, id, { landing: true }).find(component => canonical[memberId]?.includes(component)
      || Object.values(canonical).some(ids => ids.includes(component)));
    const converted = { ...state, members: state.members.map(owner => ({ ...owner,
      teleports: (owner.teleports ?? []).map(teleport => ({ ...teleport, destination: landing(teleport.destination) })).filter(teleport => teleport.destination) })) };
    const stones = lodestones.map(stone => ({ ...stone, location: landing(stone.location ?? stone.chunkId) })).filter(stone => stone.location);
    const routes = walkingRoutes.flatMap(([from, to]) => componentLocations(world, from).flatMap(source => componentLocations(world, to)
      .filter(target => world.cacheWalking.topology.get(baseOf(target))?.get(target.split('-')[1])?.includes(source)).map(target => [source, target])));
    const result = evaluatePartnerConnections({ ...world, cacheWalking: undefined, componentNodes: true, sectionTopology: world.cacheWalking.topology, sectionRoutes: new Map() }, converted, memberId,
      { sectionsByMember: canonical, sectionOverrides: blocked, walkingRoutes: routes, lodestones: stones, typedRoutes: typed,
        transportRoutes: catalogue, transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember, personalTravelSeeds: roots, transportMemo, _bound,
        transportBudgetOverride: transportBudgetOverride ?? (typed.length
          ? transportBudget(state, memberId, transportFactsByMember ?? world.transportFactsByMember, world) : {}) });
    result.components = result.sections;
    result.sections = sorted(new Set([...result.sections, ...projectLegacySections(world, new Set(result.sections))]));
    return result;
  }
  const member = state.members.find(owner => owner.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const nodes = new Set(), byBase = new Map(), personal = new Set(), partnerNodes = new Map();
  const blocked = sectionOverrides ?? member.sectionOverrides ?? {};
  const focusedSeeds = new Set(personalTravelSeeds ?? sectionsByMember[memberId] ?? []);
  for (const base of member.unlocked ?? []) if (world.sectionTopology.get(base)?.has('0')) focusedSeeds.add(base);
  const focusedReach = typed.length && !world.componentNodes ? expandTransportReachability(world, state, memberId, focusedSeeds,
    { claimed: new Set(state.members.flatMap(owner => owner.unlocked ?? [])), sectionOverrides: blocked,
      transportRoutes: catalogue, transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember, transportMemo,
      typedRoutes: _bound ? typed : undefined, transportBudgetOverride: _bound ? {} : transportBudgetOverride,
      _physicalUpper: _bound === 'upper', _proofLower: _bound === 'lower', _skipNoop: !!_bound }) : new Set();
  function ownerNodes(owner) {
    const result = new Set(), reached = sectionsByMember[owner.id];
    if (world.componentNodes) {
      for (const id of reached ?? []) if ((owner.unlocked ?? []).includes(baseOf(id)) && blocked[id] !== false) result.add(id);
      return result;
    }
    for (const base of owner.unlocked ?? []) {
      if (!world.chunks.has(base) || world.surface && !world.surface.has(base)) continue;
      const topology = world.sectionTopology?.get(base);
      const parts = topology && !topology.has('0') ? [...topology.keys()].map(part => `${base}-${part}`) : [base];
      for (const id of parts) if (blocked[id.includes('-') ? id : `${id}-0`] !== false && (!id.includes('-') || (reached ? reached.includes(id) : owner.sectionOverrides?.[id] === true)
        || owner.id !== memberId && focusedReach.has(id))) result.add(id);
    }
    return result;
  }
  for (const owner of state.members) {
    const owned = ownerNodes(owner);
    if (owner.id === memberId) for (const id of owned) personal.add(id);
    else partnerNodes.set(owner.id, owned);
    for (const id of owned) { nodes.add(id); const base = baseOf(id); if (!byBase.has(base)) byBase.set(base, new Set()); byBase.get(base).add(id); }
  }
  const outgoing = new Map(), incoming = new Map(), edgeDetails = new Map(), costOut = new Map(), costBack = new Map();
  const addEdge = (from, to, typed = false, cost = {}) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    // Nonlocal retained dependencies include boats and unverified typos. They
    // do not establish an adjacent walking boundary for this travel policy.
    if (!typed && baseOf(from) !== baseOf(to) && !(world.neighbors.get(baseOf(from)) ?? []).includes(baseOf(to))) return;
    if (!outgoing.has(from)) outgoing.set(from, new Set()); outgoing.get(from).add(to);
    if (!incoming.has(to)) incoming.set(to, new Set()); incoming.get(to).add(from);
    if (!costOut.has(from)) costOut.set(from, []); costOut.get(from).push({ to, cost });
    if (!costBack.has(to)) costBack.set(to, []); costBack.get(to).push({ to: from, cost });
  };
  for (const target of nodes) {
    const [base, part = '0'] = target.split('-');
    for (const source of world.sectionTopology?.get(base)?.get(part) ?? []) {
      if (!isWalkingSectionEdge(world, base, part, source)) continue;
      const sources = source.includes('-') && !source.endsWith('-0') ? [source] : byBase.get(baseOf(source)) ?? [];
      for (const from of sources) addEdge(from, target);
    }
  }
  for (const [from, to] of walkingRoutes) {
    const sources = from.includes('-') ? [from] : byBase.get(from) ?? [];
    const targets = to.includes('-') ? [to] : byBase.get(to) ?? [];
    for (const source of sources) for (const target of targets) addEdge(source, target);
  }
  for (const edge of transportEdges(typed)) { addEdge(edge.from, edge.to, true, edge.cost); edgeDetails.set(`${edge.from}\u0000${edge.to}`, `transport ${edge.id}`); }
  const landing = destination => nodes.has(destination) ? destination : destination.includes('-') ? nodes.has(baseOf(destination)) ? baseOf(destination) : null : sorted(byBase.get(destination) ?? []).find(id => id === `${destination}-1`);
  const teleports = (member.teleports ?? []).filter(teleport => teleport.available && (!teleport.consumable || state.rules?.['roll.consumableTeleports']))
    .map(teleport => ({ to: landing(teleport.destination), detail: `${teleport.label || teleport.id} teleport` })).filter(teleport => teleport.to);
  for (const route of typed) if (route.global && route.available && nodes.has(route.to)) teleports.push({ to: route.to, detail: `${route.name || route.id} ${route.kind}`, cost: route.cost });
  const out = new Map(), queue = [];
  const reach = (id, detail) => { if (!out.has(id)) { out.set(id, detail); queue.push(id); } };
  for (const id of sorted(personal)) reach(id, `own ${id}`);
  if (personal.size) for (const teleport of teleports) reach(teleport.to, teleport.detail);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const to of outgoing.get(queue[cursor]) ?? []) {
    const leg = edgeDetails.get(`${queue[cursor]}\u0000${to}`) ?? `walking via ${queue[cursor]}`;
    reach(to, out.get(queue[cursor]).startsWith('own ') ? leg : `${out.get(queue[cursor])}; ${leg}`);
  }
  const budget = transportBudgetOverride ?? (typed.length
    ? transportBudget(state, memberId, transportFactsByMember ?? world.transportFactsByMember, world) : {});
  // Global confirmed teleports are usable from every admitted node; retain
  // their cost on each journey, rather than assuming a free return.
  if (personal.size) for (const teleport of teleports) for (const id of nodes) {
    if (!costOut.has(id)) costOut.set(id, []); costOut.get(id).push({ to: teleport.to, cost: teleport.cost ?? {} });
    if (!costBack.has(teleport.to)) costBack.set(teleport.to, []); costBack.get(teleport.to).push({ to: id, cost: teleport.cost ?? {} });
  }
  const journeyRoots = personalTravelSeeds ? new Set([...focusedSeeds].filter(id => personal.has(id))) : personal;
  const journeys = typed.length || automatic;
  const outsideHome = !_bound && automatic && typed.some(route => route.available && route.global && route.to && !nodes.has(route.to));
  const homeReturns = outsideHome ? transportReachabilityPaths(world, state, memberId, journeyRoots, {
    claimed: new Set(state.members.flatMap(owner => owner.unlocked ?? [])), sectionOverrides: blocked,
    transportRoutes: catalogue, transportFactsByMember: transportFactsByMember ?? world.transportFactsByMember,
    typedRoutes: typed, transportMemo, transportBudgetOverride: budget, lodestones, _skipNoop: true }).returnPaths : null;
  const outward = journeys ? affordableTransportPaths([...journeyRoots].map(id => ({ id })), costOut, budget) : null;
  if (outward) for (const id of out.keys()) if (!outward.has(id)) out.delete(id);
  const back = new Map(), reverseQueue = [];
  const returnTo = (id, detail) => { if (!back.has(id)) { back.set(id, detail); reverseQueue.push(id); } };
  for (const id of sorted(personal)) returnTo(id, `own ${id}`);
  for (let cursor = 0; cursor < reverseQueue.length; cursor++) for (const from of incoming.get(reverseQueue[cursor]) ?? []) returnTo(from, `${edgeDetails.get(`${from}\u0000${reverseQueue[cursor]}`) ?? `walking via ${reverseQueue[cursor]}`}${personal.has(reverseQueue[cursor]) ? '' : `; ${back.get(reverseQueue[cursor])}`}`);
  for (const id of out.keys()) if (homeReturns?.has(id) && !back.has(id)) returnTo(id, 'available teleport home');
  // Reaching the actual lodestone section satisfies activation. No locked or
  // unreachable destination can activate itself through a circular teleport.
  const activated = lodestones.filter(stone => (state.rules?.['content.f2p'] === false || stone.f2p) && world.chunks.has(stone.chunkId))
    .map(stone => ({ ...stone, to: landing(stone.location ?? stone.chunkId) })).filter(stone => stone.to && out.has(stone.to)
      && (!automatic || reviewedLodestoneUsable(catalogue, typed, stone, stone.to, _bound === 'lower')));
  const returnLeg = [...activated.map(stone => ({ to: stone.to, detail: `${stone.name} lodestone` })), ...teleports].find(leg => back.has(leg.to));
  if (returnLeg) for (const id of out.keys()) if (!back.has(id)) returnTo(id, `${returnLeg.detail}${personal.has(returnLeg.to) ? '' : `; ${back.get(returnLeg.to)}`}`);
  for (const stone of activated) for (const id of nodes) {
    if (!costBack.has(stone.to)) costBack.set(stone.to, []); costBack.get(stone.to).push({ to: id, cost: {} });
  }
  const returnSeeds = [...journeyRoots].map(id => ({ id }));
  for (const [id, costs] of homeReturns ?? []) if (nodes.has(id)) for (const cost of costs) returnSeeds.push({ id, cost });
  const returnPaths = journeys ? affordableTransportPaths(returnSeeds, costBack, budget) : null;
  const connected = new Set([...out.keys()].filter(id => back.has(id) && (!journeys || (outward.get(id) ?? []).some(outCost =>
    (returnPaths.get(id) ?? []).some(backCost => affordableTransportCost(addTransportCosts(outCost, backCost), budget)))))), regions = [], byChunk = {};
  for (const owner of state.members.filter(owner => owner.id !== memberId)) {
    const remaining = new Set(partnerNodes.get(owner.id));
    while (remaining.size) {
      const component = [], pending = [sorted(remaining)[0]]; remaining.delete(pending[0]);
      for (let cursor = 0; cursor < pending.length; cursor++) {
        const id = pending[cursor]; component.push(id);
        for (const neighbor of [...outgoing.get(id) ?? [], ...incoming.get(id) ?? []]) if (remaining.delete(neighbor)) pending.push(neighbor);
      }
      const reached = component.filter(id => out.has(id)), admitted = component.filter(id => connected.has(id));
      const region = { ownerId: owner.id, ownerName: owner.name || owner.id, sections: sorted(component), bases: sorted(new Set(component.map(baseOf))), connected: admitted.length === component.length,
        out: reached.length ? out.get(reached[0]) : null, back: admitted.length ? back.get(admitted[0]) : null,
        reason: !reached.length ? 'no route out' : admitted.length !== component.length ? 'no route back' : null };
      regions.push(region);
      for (const id of component) {
        const base = baseOf(id), entry = byChunk[base] ??= { connected: false, ownerId: owner.id, ownerName: owner.name || owner.id, reason: region.reason, out: region.out, back: region.back };
        if (connected.has(id)) Object.assign(entry, { connected: true, reason: null, out: out.get(id), back: back.get(id) });
      }
    }
    // Preserve explanation for split territory with no reached entry section.
    for (const base of owner.unlocked ?? []) if (!byChunk[base]) byChunk[base] = { connected: false, ownerId: owner.id, ownerName: owner.name || owner.id, reason: 'no reachable section entry', out: null, back: null };
  }
  return { regions, byChunk, bases: sorted(new Set([...connected].map(baseOf))), sections: sorted([...connected].filter(id => id.includes('-'))), reachable: sorted(out.keys()) };
}
