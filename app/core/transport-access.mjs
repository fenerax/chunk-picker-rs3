import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';
import { TRANSPORT_ACCESS_RULE, TRANSPORT_MASK_SHA256, TRANSPORT_RUNTIME_SHA256 } from '../data/cache-entry-policy.mjs';
import { componentLocations, componentBlocked, surfaceReachability } from './cache-surface.mjs';
import { isWalkingSectionEdge, sectionIsFree } from './map-boundaries.mjs';
import { sameRuneScapeName } from './game-progress.mjs';
import { surfaceLodestones } from '../data/lodestones.mjs';
import { requireTeleportReturns } from './teleport-returns.mjs';
import { automaticTransportEnabled, deriveAutomaticTransport, automaticRouteFacts, automaticRouteGroup,
  automaticConfirmationRequiresDeclaration } from './automatic-transport.mjs';

const baseOf = id => id.split('-')[0];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const kinds = new Set(['canoe', 'boat', 'ferry', 'carpet', 'cart', 'glider', 'balloon', 'portal', 'shortcut', 'stairs', 'ladder', 'cave', 'teleport', 'lodestone']);
const EMPTY_ROUTES = Object.freeze([]);
export const transportAccessEnabled = state => state.rules?.[TRANSPORT_ACCESS_RULE] === true;

// Only the task evaluator supplies this memo, with a fresh lifetime for each
// immutable evaluation. Actual and hypothetical saves never share entries.
function evaluationCache(memo, field, world, state) {
  if (!memo || !automaticTransportEnabled(state)) return null;
  const worlds = memo[field] ??= new WeakMap();
  let states = worlds.get(world);
  if (!states) { states = new WeakMap(); worlds.set(world, states); }
  let entries = states.get(state);
  if (!entries) { entries = new Map(); states.set(state, entries); }
  return entries;
}

/** Explicit personal declarations; absent facts mean unknown, never zero/false.
 * Counts establish availability only: evaluation does not spend fares/items. */
export function validateTransportFacts(facts) {
  if (!object(facts)) throw new TypeError('transportFacts must be an object.');
  const fields = new Set(['levels', 'quests', 'items', 'currencies', 'conditions', 'confirmations']);
  for (const [field, entries] of Object.entries(facts)) {
    if (!fields.has(field) || !object(entries)) throw new TypeError(`Invalid transportFacts field: ${field}`);
    if (Object.keys(entries).length > 256) throw new TypeError(`Too many transportFacts ${field} entries.`);
    for (const [key, value] of Object.entries(entries)) {
      if (!key.trim() || key !== key.trim() || key.length > 200 || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Invalid transport fact key.');
      if (['quests', 'conditions', 'confirmations'].includes(field)) {
        if (typeof value !== 'boolean') throw new TypeError(`transportFacts ${field} values must be boolean.`);
      } else if (!Number.isSafeInteger(value) || value < (field === 'levels' ? 1 : 0) || value > (field === 'levels' ? 152 : 1e12)) {
        throw new TypeError(`Invalid transportFacts ${field} count/level.`);
      }
    }
  }
  return facts;
}

/** Resolve one endpoint. Exact decoded tile witnesses or an existing unique
 * verified legacy mapping establish a component; bounding boxes never do.
 * Plane/map ambiguity and disconnected chunk selectors never seed geometry. */
export function resolveTransportStation(world, station) {
  const failure = reason => ({ location: null, reason });
  if (!station || typeof station.chunkId !== 'string' || !world.chunks.has(station.chunkId)) return failure('unknown station chunk');
  if (station.plane !== 0) return failure('non-surface station requires verified interior mapping');
  if (!station.coordinateEvidence) return failure('missing coordinate evidence');
  const point = station.accessAnchor ?? station;
  if (station.accessAnchor && (!object(point) || point.plane !== station.plane || point.mapId !== station.mapId
    || !station.id.startsWith('canoe-') || point.coordinateEvidence?.kind !== 'wiki-canoe-instructor-map'
    || !/^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/.test(point.coordinateEvidence?.url ?? '')
    || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)
    || String((Math.floor(point.x / 64) << 8) | Math.floor(point.y / 64)) !== station.chunkId)) return failure('invalid designated canoe instructor access anchor');
  const cache = world.cacheWalking;
  if (cache && station.mapId !== cache.provenance?.mapId) return failure('station map does not match cache surface map');
  if (Number.isFinite(station.x) && Number.isFinite(station.y)
    && String((Math.floor(station.x / 64) << 8) | Math.floor(station.y / 64)) !== station.chunkId) return failure('station coordinate/chunk mismatch');
  if (cache?.suppressedRegions?.has(station.chunkId) || cache?.eligibility?.get(station.chunkId)?.nonEntryEvidence) return failure('destination has contrary non-entry evidence');
  let locations = [], evidence;
  const witness = station.componentWitness;
  const exact = cache?.tileComponents?.get(`${point.mapId}:${point.plane}:${point.x}:${point.y}`);
  if (cache && witness) {
    const proof = witness.evidence;
    if (!object(witness) || witness.x !== point.x || witness.y !== point.y || witness.plane !== point.plane || witness.mapId !== point.mapId
      || witness.stationId !== station.id || witness.maskSha256 !== TRANSPORT_MASK_SHA256 || witness.runtimeSha256 !== TRANSPORT_RUNTIME_SHA256
      || !object(proof) || proof.kind !== 'exact-decoded-mask-tile' || proof.encoding !== 'base64-u16le' || proof.order !== 'x*64+z'
      || proof.sourcePlane + proof.sourceShift !== point.plane || proof.offsetBytes !== ((point.x % 64) * 64 + point.y % 64) * 2
      || !Number.isSafeInteger(proof.label) || proof.label <= 0 || witness.componentId !== `${station.chunkId}-${1000000 + proof.label}`
      || !Array.isArray(proof.encodedLabelBytes) || proof.encodedLabelBytes.length !== 2 || proof.encodedLabelBytes[0] + proof.encodedLabelBytes[1] * 256 !== proof.label
      || !cache.components.has(witness.componentId)
      || baseOf(witness.componentId) !== station.chunkId || cache.exactMaskSha256 && witness.maskSha256 !== cache.exactMaskSha256) return failure('invalid exact component witness');
    locations = [witness.componentId]; evidence = station.accessAnchor ? 'exact-station-instructor-component' : 'exact-decoded-tile-witness';
  } else if (cache && exact) {
    if (!cache.components.has(exact) || baseOf(exact) !== station.chunkId) return failure('invalid decoded tile component');
    locations = [exact]; evidence = 'exact-decoded-tile-mask';
  } else if (station.locationId) {
    if (cache?.components.has(station.locationId)) return failure('direct component selector requires exact decoded tile evidence');
    if (baseOf(station.locationId) !== station.chunkId || !station.locationId.includes('-')) return failure('station selector must identify an exact section');
    locations = cache ? componentLocations(world, station.locationId) : world.sectionTopology.get(station.chunkId)?.has(station.locationId.split('-')[1]) ? [station.locationId.endsWith('-0') ? station.chunkId : station.locationId] : [];
    if (locations.length !== 1) return failure('station selector has unresolved or multiple components');
    evidence = 'verified-section-selector';
  } else if (cache && !cache.fallback.has(station.chunkId)) {
    return failure('station coordinate needs exact decoded tile evidence');
  } else if (world.sectionTopology.get(station.chunkId)?.has('0')) locations = [cache ? `${station.chunkId}-0` : station.chunkId];
  else return failure('split station needs a verified section');
  if (cache?.components.has(locations[0]) && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    const bounds = cache.components.get(locations[0]).bounds;
    if (bounds && !(point.x >= bounds[0] && point.y >= bounds[1] && point.x <= bounds[2] && point.y <= bounds[3])) return failure('station coordinate outside selected component');
  }
  return { location: locations[0], evidence: evidence ?? 'unsplit-retained-section' };
}

function personalFacts(state, member, injected) {
  const explicit = validateTransportFacts(injected ?? member.transportFacts ?? {});
  const levels = { ...(member.passiveLevels ?? {}) }, quests = {};
  for (const [skill, observation] of Object.entries(member.skillProgress ?? {})) if (observation.source === 'runemetrics'
    && sameRuneScapeName(observation.runescapeName, member.runescapeName)) levels[skill] = observation.level;
  for (const [id, observation] of Object.entries(member.questProgress ?? {})) if (sameRuneScapeName(observation.runescapeName, member.runescapeName)
    && member.completedTasks?.includes(id)) quests[observation.title] = true;
  // Personal game completions can prove an exact quest title; challenge checks
  // and the task engine's potential-level fixed point cannot.
  for (const task of state.tasks ?? []) if (task.category === 'Quest' && member.completedTasks?.includes(task.id)) quests[task.label] = true;
  return { ...explicit, levels: { ...levels, ...explicit.levels }, quests: { ...quests, ...explicit.quests } };
}

/** Reviewed surface destination evidence proves a roll chunk independently of
 * whether copied walking masks identify its arrival component. */
function verifiedRollDestination(world, route, station, blocked, f2p) {
  const destination = route.rollDestination, proof = destination?.evidence;
  if (route.from !== null || !object(destination) || !object(proof) || !station || !world.chunks.has(destination.chunkId)
    || destination.chunkId !== station.chunkId || destination.stationId !== station.id
    || destination.plane !== 0 || destination.mapId !== 28 || destination.plane !== station.plane || destination.mapId !== station.mapId
    || destination.x !== station.x || destination.y !== station.y || !Number.isSafeInteger(destination.x) || !Number.isSafeInteger(destination.y)
    || String((Math.floor(destination.x / 64) << 8) | Math.floor(destination.y / 64)) !== destination.chunkId
    || proof.kind !== 'verified-teleport-destination-chunk' || !/^https:\/\/runescape\.wiki\/w\/.+\?oldid=\d+$/.test(proof.url ?? '')
    || !Number.isSafeInteger(proof.revisionId) || !proof.url.endsWith(`oldid=${proof.revisionId}`)
    || !/^[a-f0-9]{64}$/.test(proof.coordinateSha256 ?? '')
    || !['wiki-explicit-teleport-map', 'cache-typed-teleport-destination'].includes(proof.sourceKind)
    || proof.sourceKind === 'cache-typed-teleport-destination' && station.coordinateEvidence?.kind !== 'cache-typed-coordinate'
    || proof.sourceKind === 'wiki-explicit-teleport-map' && station.coordinateEvidence?.kind !== 'wiki-teleport-map'
    || !['exact-teleport-destination', 'teleport-destination-marker', 'wiki-teleport-destination-map'].includes(station.coordinateEvidence?.role)) return null;
  const cache = world.cacheWalking, base = destination.chunkId;
  if (cache && (station.mapId !== cache.provenance?.mapId || cache.suppressedRegions?.has(base) || cache.eligibility?.get(base)?.nonEntryEvidence)) return null;
  // With no exact component, a blocked section cannot safely be assigned to a
  // different arrival. Conservatively keep that destination unavailable.
  if (Object.entries(blocked).some(([selector, value]) => value === false && selector.split('-')[0] === base)) return null;
  if (f2p && (!route.f2p || route.members === true || !world.f2p.has(base))) return null;
  return destination;
}

export function evaluateTransportRoutes(world, state, memberId, { transportRoutes = TRANSPORT_ROUTES, transportFactsByMember, sectionOverrides, _rollPlanning = false, _physical = false, transportMemo, returnProofCache } = {}) {
  const member = state.members.find(value => value.id === memberId);
  if (!member) throw new TypeError(`Unknown member: ${memberId}`);
  const routeCache = returnProofCache === false ? null : evaluationCache(transportMemo, 'routes', world, state);
  const routeKey = routeCache && JSON.stringify([memberId, sectionOverrides ?? member.sectionOverrides ?? {}, _rollPlanning, _physical]);
  const prior = routeCache?.get(routeKey);
  if (prior?.catalogue === transportRoutes && prior.facts === transportFactsByMember) return prior.rows;
  const remember = rows => {
    routeCache?.set(routeKey, { catalogue: transportRoutes, facts: transportFactsByMember, rows });
    return rows;
  };
  const explicitFacts = personalFacts(state, member, transportFactsByMember?.[memberId]);
  const automatic = automaticTransportEnabled(state) && !_physical;
  const automaticContext = automatic ? deriveAutomaticTransport(world, state, memberId, { transportFactsByMember }) : null;
  const stations = new Map((transportRoutes.stations ?? []).map(station => [station.id, station]));
  const blocked = sectionOverrides ?? member.sectionOverrides ?? {};
  const f2p = state.rules?.['content.f2p'] !== false;
  const evaluated = (transportRoutes.routes ?? []).map(route => {
    const from = route.from === null ? { location: null, global: true } : resolveTransportStation(world, stations.get(route.from));
    const to = resolveTransportStation(world, stations.get(route.to));
    const rollDestination = automatic ? verifiedRollDestination(world, route, stations.get(route.to), blocked, f2p) : null;
    const planningChunk = _rollPlanning && rollDestination ? rollDestination.chunkId : undefined;
    const facts = automatic ? automaticRouteFacts(route, automaticContext, to.location, planningChunk) : explicitFacts;
    const unmet = [], unknown = [], cost = {};
    const require = (field, key, needed = true) => {
      // Membership follows the content rule; it is not a personal declaration.
      const actual = field === 'conditions' && key === 'membership' ? !f2p : facts[field]?.[key];
      if (actual === undefined) unknown.push({ requirement: field, key, needed });
      else if (typeof needed === 'number' ? actual < needed : actual !== needed) unmet.push({ requirement: field, key, needed, actual });
    };
    if (!kinds.has(route.kind)) unknown.push({ requirement: 'kind', key: route.kind });
    if (f2p && (route.members === true || route.f2p === false)) unmet.push({ requirement: 'membership', key: 'F2P route' });
    else if (f2p && route.f2p !== true) unknown.push({ requirement: 'membership', key: 'F2P route' });
    if (route.members === true && !f2p) require('conditions', 'membership');
    const req = route.requirements;
    if (!object(req)) unknown.push({ requirement: 'requirements', key: route.id });
    else {
      for (const field of Object.keys(req)) if (!['levels', 'quests', 'items', 'fare', 'conditions', 'confirmations'].includes(field)) unknown.push({ requirement: 'unsupported', key: field });
      for (const [skill, level] of Object.entries(req.levels ?? {})) {
        if (!Number.isSafeInteger(level) || level < 1) unknown.push({ requirement: 'levels', key: skill });
        else require('levels', skill, level);
      }
      for (const quest of req.quests ?? []) typeof quest === 'string' ? require('quests', quest) : unknown.push({ requirement: 'quests', key: JSON.stringify(quest) });
      for (const item of req.items ?? []) {
        const name = typeof item === 'string' ? item : item.name ?? item.id;
        const count = typeof item === 'string' ? 1 : item.quantity ?? item.count ?? 1;
        if (typeof name !== 'string' || !Number.isSafeInteger(count) || count < 1) unknown.push({ requirement: 'items', key: JSON.stringify(item) });
        else { require('items', name, count); if (item.consumed === true || route.consumable === true) cost[`items:${name}`] = (cost[`items:${name}`] ?? 0) + count; }
      }
      if (req.fare !== null && req.fare !== undefined) {
        const currency = req.fare.currency ?? req.fare.item ?? 'coins', amount = req.fare.amount;
        if (!Number.isSafeInteger(amount) || amount < 0) unknown.push({ requirement: 'fare', key: JSON.stringify(req.fare) });
        else if (amount > 0) { require('currencies', currency, amount); cost[`currencies:${currency}`] = amount; }
      }
      for (const field of ['conditions', 'confirmations']) for (const value of req[field] ?? []) {
        const key = typeof value === 'string' ? value : value?.id;
        if (typeof key !== 'string') unknown.push({ requirement: field, key: JSON.stringify(value) });
        else require(field, key);
      }
    }
    if (route.consumable === true && state.rules?.['roll.consumableTeleports'] !== true) unmet.push({ requirement: 'consumable', key: route.id });
    if (route.consumable === true && !Object.keys(cost).length) cost[`uses:${route.id}`] = 1;
    for (const [side, endpoint] of [['from', from], ['to', to]]) if (endpoint.reason) unknown.push({ requirement: 'endpoint', key: side, detail: endpoint.reason });
    if (planningChunk) for (let index = unknown.length - 1; index >= 0; index--) if (unknown[index].requirement === 'endpoint'
      && unknown[index].key === 'to' && ['station coordinate needs exact decoded tile evidence', 'station selector has unresolved or multiple components',
        'split station needs a verified section'].includes(unknown[index].detail)) unknown.splice(index, 1);
    // Global travel always requires a personal activation/use confirmation,
    // even if an incomplete catalogue omitted that requirement.
    if (from.global && !(req?.confirmations ?? []).length) require('confirmations', route.id);
    for (const endpoint of [from, to]) if (endpoint.location) {
      const location = endpoint.location, base = baseOf(location), section = location.split('-')[1] ?? '0';
      if (world.cacheWalking ? componentBlocked(world, location, blocked) : blocked[`${base}-${section}`] === false) unmet.push({ requirement: 'section-block', key: location });
      if (f2p && !(world.cacheWalking?.components.has(location) ? world.cacheWalking.components.get(location).free === true : sectionIsFree(world, base, section))) unmet.push({ requirement: 'free-component', key: location });
    }
    const override = (automatic || _physical) && typeof member.teleportOverrides?.[route.id] === 'boolean' ? member.teleportOverrides[route.id] : null;
    // An override declares personal capability, never endpoint geometry or a
    // house-rule exception. Costs remain budgeted on every leg.
    const personalRequirement = value => ['levels', 'quests', 'items', 'currencies', 'conditions', 'confirmations'].includes(value.requirement)
      && value.needed !== undefined
      && !(value.requirement === 'conditions' && value.key === 'membership');
    if (override === true || _physical) {
      for (const list of [unmet, unknown]) for (let index = list.length - 1; index >= 0; index--) if (personalRequirement(list[index])
        && !(_physical && override !== true && list[index].requirement === 'confirmations' && automaticConfirmationRequiresDeclaration(list[index].key))
        || _physical && list[index].requirement === 'conditions' && list[index].key === 'membership' && !f2p) list.splice(index, 1);
    }
    if (override === false) unmet.push({ requirement: 'personal-override', key: route.id, detail: 'Disabled by this player.' });
    const planningActivation = !!planningChunk && !to.location && route.kind === 'lodestone' && route.automatic?.activation === 'touch'
      && automaticContext.reachableBases.has(planningChunk) && (req?.confirmations ?? []).some(key => automaticContext.facts.confirmations[key] === undefined);
    const levelEstimated = automatic && Object.keys(req?.levels ?? {}).some(skill => automaticContext.estimatedLevels.has(skill));
    const estimated = levelEstimated || planningActivation;
    const preparations = automatic && route.kind === 'canoe' && (req?.confirmations ?? []).includes('canoe-familiar-state-supported')
      && automaticContext.facts.confirmations['canoe-familiar-state-supported'] === undefined ? ['Dismiss a familiar if present before canoe travel.'] : [];
    return { id: route.id, name: route.name, kind: route.kind, from: from.location, to: to.location, global: !!from.global,
      bidirectional: route.bidirectional === true && !from.global, available: !unmet.length && !unknown.length, unmet, unknown,
      cost: _physical ? {} : cost, provenance: route.provenance ?? [], endpointEvidence: { from: from.evidence ?? null, to: to.evidence ?? null },
      group: automaticRouteGroup(route), destination: stations.get(route.to)?.chunkId ?? null,
      destinationName: stations.get(route.to)?.name ?? world.chunks.get(stations.get(route.to)?.chunkId)?.name ?? null, estimated, levelEstimated, override, preparations, rollDestination, planningActivation };
  });
  for (const pending of transportRoutes.pendingRoutes ?? []) evaluated.push({ id: pending.id, name: pending.name, kind: pending.kind,
    from: null, to: null, global: pending.from === null, bidirectional: false, available: false, pending: true, cost: {}, unmet: [],
    unknown: [{ requirement: 'pending-route', key: pending.id, detail: (pending.unknowns ?? ['Unresolved route endpoints']).join('; ') }], provenance: pending.provenance ?? [], endpointEvidence: { from: null, to: null } });
  for (const destination of transportRoutes.unresolvedDestinations ?? []) evaluated.push({ id: `unresolved:${destination.id}`, name: destination.name, kind: 'unresolved-destination',
    from: null, to: null, global: false, bidirectional: false, available: false, pending: true, cost: {}, unmet: [],
    unknown: [{ requirement: 'unresolved-destination', key: destination.id, detail: destination.reason ?? 'Exact current destination map/plane coordinate is unresolved.' }], provenance: destination.provenance ?? [], endpointEvidence: { from: null, to: null } });
  const reasonFor = requirement => {
    if (requirement.detail) return ({
      'unknown station chunk': 'The departure or arrival chunk is unknown.',
      'non-surface station requires verified interior mapping': 'This travel stop is indoors or underground; its exact area is not yet verified.',
      'missing coordinate evidence': 'The exact departure or arrival location is not yet verified.',
      'invalid designated canoe instructor access anchor': 'The canoe instructor’s exact location could not be verified.',
      'station map does not match cache surface map': 'This travel stop uses a different map from the current walking data.',
      'station coordinate/chunk mismatch': 'The travel stop’s coordinates do not match its recorded chunk.',
      'destination has contrary non-entry evidence': 'The walking data indicates that this destination cannot be entered.',
      'invalid exact component witness': 'The recorded proof of this walking area could not be verified.',
      'invalid decoded tile component': 'The walking area for this travel stop could not be verified.',
      'direct component selector requires exact decoded tile evidence': 'The exact tile for this travel stop is not yet verified.',
      'station selector must identify an exact section': 'The exact walking area for this travel stop is missing.',
      'station selector has unresolved or multiple components': 'The exact walking area for this travel stop is unclear.',
      'station coordinate needs exact decoded tile evidence': 'The exact tile for this travel stop is not yet verified.',
      'split station needs a verified section': 'This chunk has separate walking areas; the travel stop’s area is not yet verified.',
      'station coordinate outside selected component': 'The travel stop’s coordinates fall outside its recorded walking area.',
    })[requirement.detail] ?? requirement.detail;
    if (requirement.requirement === 'levels') return `Needs ${requirement.key} ${requirement.needed}${requirement.actual === undefined ? '; personal level unknown' : `; personal level ${requirement.actual}`}.`;
    if (requirement.requirement === 'quests') return `Needs quest ${requirement.key}; personal completion ${requirement.actual === false ? 'not confirmed' : 'unknown'}.`;
    if (requirement.requirement === 'items' || requirement.requirement === 'currencies') {
      if (automaticContext?.baseline && requirement.actual === undefined) return `${requirement.key} not obtainable from currently reachable sources.`;
      return `Needs ${requirement.needed} ${requirement.key}; ${requirement.actual === undefined ? 'reachable supply unknown' : `${requirement.actual} available`}.`;
    }
    if (requirement.requirement === 'consumable') return 'Consumable teleport — rule off.';
    if (requirement.requirement === 'membership' || requirement.requirement === 'conditions' && requirement.key === 'membership') return 'Members only.';
    if (requirement.requirement === 'section-block') return `Destination or departure section ${requirement.key} is blocked.`;
    if (requirement.requirement === 'free-component') return `Section ${requirement.key} is not verified F2P.`;
    return `${requirement.key}: ${requirement.requirement} requirement is unknown or not met.`;
  };
  const planningRows = automatic && !_rollPlanning ? new Map(evaluateTransportRoutes(world, state, memberId, { transportRoutes, transportFactsByMember, sectionOverrides,
    _rollPlanning: true, transportMemo, returnProofCache }).map(row => [row.id, row])) : new Map();
  const usable = _physical ? evaluated : requireTeleportReturns(world, state, memberId, evaluated, {
    transportRoutes, transportFactsByMember, sectionOverrides: blocked, transportMemo, returnProofCache, automaticContext, planningRows: [...planningRows.values()] });
  const displayRows = usable.map(row => {
    const priority = value => ['return-route', 'endpoint', 'section-block', 'free-component', 'membership', 'consumable'].indexOf(value.requirement);
    const reasons = [...row.unmet, ...row.unknown].sort((a, b) => {
      const first = priority(a), second = priority(b);
      return (first < 0 ? 10 : first) - (second < 0 ? 10 : second);
    }).map(reasonFor);
    if (!reasons.length) reasons.push(row.override === true ? 'Confirmed available by this player.' : automatic
      ? `${row.preparations?.length ? 'Usable after dismissing a familiar if present. ' : ''}Personal requirements met using obtainable supplies and game progress.${row.estimated ? ' Levels are estimated from the training you can reach.' : ''}`
      : 'Personal requirements confirmed.');
    return { group: automaticRouteGroup(row), destination: row.to?.split('-')[0] ?? null, destinationName: null,
      estimated: false, override: null, ...row, reason: reasons[0], reasons };
  });
  if (_rollPlanning) return remember(displayRows);
  return remember(displayRows.map(row => {
    const planning = planningRows.get(row.id), rollAvailable = row.available || !!(row.global && row.rollDestination && planning?.available);
    const rollReasons = rollAvailable && !row.available ? [planning?.planningActivation
      ? 'The lodestone is in a reachable chunk, so activation is estimated. You can roll its verified destination chunk; the exact landing area is not yet verified.'
      : 'Teleport requirements and the destination chunk are verified. The exact landing area is not yet verified.'] : row.reasons;
    return { ...row, rollAvailable, rollReason: rollReasons[0], rollReasons,
      activationEstimated: !!(rollAvailable && !row.available && planning?.planningActivation),
      estimated: row.estimated || !!(rollAvailable && !row.available && planning?.estimated) };
  }));
}

export function transportEdges(routes) {
  return routes.filter(route => route.available && !route.global).flatMap(route => [{ from: route.from, to: route.to, id: route.id, cost: route.cost ?? {} },
    ...(route.bidirectional ? [{ from: route.to, to: route.from, id: route.id, cost: route.cost ?? {} }] : [])]);
}

/** Geometry-only upper bound. Valid personal gates and journey costs are
 * relaxed; house rules, exact endpoints and malformed metadata stay closed. */
export function physicalTransportRoutes(world, state, memberId, options = {}) {
  return evaluateTransportRoutes(world, state, memberId, { ...options, _physical: true });
}

export function reviewedLodestoneUsable(catalogue = TRANSPORT_ROUTES, rows, stone, destination, lower = false) {
  const stations = new Map((catalogue.stations ?? []).map(station => [station.id, station]));
  const reviewed = (catalogue.routes ?? []).filter(route => route.kind === 'lodestone'
    && (stations.get(route.to)?.chunkId === stone.chunkId || rows.some(row => row.id === route.id && row.to === destination)));
  return !reviewed.length || !lower && reviewed.some(route => rows.some(row => row.id === route.id && row.available));
}

export function transportBudget(state, memberId, transportFactsByMember, world, automaticContext) {
  const member = state.members.find(value => value.id === memberId);
  // Route evaluation has already validated/projected these facts. Reusing its
  // context avoids a second saved-quest scan on every warm return-proof hit.
  const explicit = automaticContext ? null : personalFacts(state, member, transportFactsByMember?.[memberId]);
  const context = automaticContext ?? (world && automaticTransportEnabled(state) ? deriveAutomaticTransport(world, state, memberId, { transportFactsByMember }) : null);
  const facts = context?.facts ?? explicit;
  const budget = {};
  for (const field of ['items', 'currencies']) for (const [key, count] of Object.entries(facts[field] ?? {})) budget[`${field}:${key}`] = count;
  for (const [key, confirmed] of Object.entries(facts.confirmations ?? {})) if (confirmed && key.startsWith('roundtrip:')) budget[`uses:${key.slice(10)}`] = 2;
  for (const [key, count] of Object.entries(context?.renewableBudget ?? {})) budget[key] = Math.max(budget[key] ?? 0, count);
  return budget;
}

export const addTransportCosts = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, (a[key] ?? 0) + (b[key] ?? 0)]));
export const affordableTransportCost = (cost, budget) => Object.entries(cost).every(([key, count]) => count <= (budget[key] ?? (key.startsWith('uses:') ? 1 : 0)));

/** Pareto paths retain alternative currencies/items instead of combining
 * independent minima from different journeys. A bounded path set fails closed
 * when unusually many nondominated alternatives exist. */
export function affordableTransportPaths(seeds, graph, budget) {
  const paths = new Map(), queue = [];
  const dominates = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => (a[key] ?? 0) <= (b[key] ?? 0));
  function add(id, cost) {
    if (!affordableTransportCost(cost, budget)) return;
    const prior = paths.get(id) ?? [];
    if (prior.some(old => dominates(old, cost))) return;
    const remaining = prior.filter(old => !dominates(cost, old));
    if (remaining.length >= 64) return;
    paths.set(id, [...remaining, cost]); queue.push({ id, cost });
  }
  for (const seed of seeds) add(seed.id, seed.cost ?? {});
  for (let cursor = 0; cursor < queue.length; cursor++) for (const edge of graph.get(queue[cursor].id) ?? []) add(edge.to, addTransportCosts(queue[cursor].cost, edge.cost ?? {}));
  return paths;
}

/** Expand a supplied personal/component bound using typed routes and the
 * unchanged walking edges. Neither locked intermediates nor partner ownership
 * can become personal origins. */
export function transportReachabilityPaths(world, state, memberId, initial, { claimed, sectionOverrides, transportRoutes, transportFactsByMember, lodestones = surfaceLodestones, transportMemo,
  typedRoutes, transportBudgetOverride, _physicalUpper = false, _proofLower = false, _skipNoop = false, _requireReturn = false } = {}) {
  const member = state.members.find(value => value.id === memberId), owned = new Set(claimed ?? member.unlocked ?? []);
  const overrides = sectionOverrides ?? member.sectionOverrides ?? {};
  if (!_skipNoop && typedRoutes === undefined && automaticTransportEnabled(state) && transportAccessEnabled(state)) {
    const common = { claimed: owned, sectionOverrides: overrides, transportRoutes, transportFactsByMember, lodestones, transportMemo,
      transportBudgetOverride: {}, _skipNoop: true };
    const lower = transportReachabilityPaths(world, state, memberId, initial, { ...common, typedRoutes: EMPTY_ROUTES, _proofLower: true });
    const upper = transportReachabilityPaths(world, state, memberId, initial, { ...common,
      typedRoutes: physicalTransportRoutes(world, state, memberId, { transportRoutes, transportFactsByMember, sectionOverrides: overrides, transportMemo }), _physicalUpper: true });
    if (lower.size === upper.size && [...upper.keys()].every(id => lower.has(id))) { lower.transportNoop = true; return lower; }
  }
  const routes = typedRoutes ?? evaluateTransportRoutes(world, state, memberId, { transportRoutes, transportFactsByMember, sectionOverrides: overrides, transportMemo });
  const f2p = state.rules?.['content.f2p'] !== false, cache = world.cacheWalking;
  const admittedBases = new Set(routes.filter(route => route.available).flatMap(route => [route.from, route.to]).filter(Boolean).map(baseOf));
  const graphCache = evaluationCache(transportMemo, 'graphs', world, state);
  const extras = graphCache ? [...initial].filter(id => !(cache?.topology ?? world.sectionTopology).get(baseOf(id))?.has(id.split('-')[1] ?? '0')).sort() : [];
  const graphKey = graphCache && JSON.stringify([memberId, [...owned].sort(), overrides, extras, _physicalUpper, _proofLower]);
  const previous = graphCache?.get(graphKey);
  const cached = previous?.routes === routes ? previous : null;
  let graph = cached?.graph ?? new Map();
  const nodes = cached?.nodes ?? new Set(initial);
  const eligible = id => typeof id === 'string' && owned.has(baseOf(id)) && (cache ? !componentBlocked(world, id, overrides)
    && (!cache.blockedRegions?.has(baseOf(id)) || admittedBases.has(baseOf(id)))
    && (!f2p || (cache.components.has(id) ? cache.components.get(id).free === true : sectionIsFree(world, baseOf(id), id.split('-')[1] ?? '0')))
    : overrides[`${baseOf(id)}-${id.split('-')[1] ?? '0'}`] !== false && (!f2p || sectionIsFree(world, baseOf(id), id.split('-')[1] ?? '0')));
  const edge = (from, to, cost = {}) => {
    if (!eligible(from) || !eligible(to)) return;
    nodes.add(from); nodes.add(to);
    if (!graph.has(from)) graph.set(from, []); graph.get(from).push({ to, cost });
  };
  if (!cached) {
    for (const [base, parts] of cache?.topology ?? world.sectionTopology ?? []) for (const [part, incoming] of parts) {
      const to = cache ? `${base}-${part}` : part === '0' ? base : `${base}-${part}`;
      if (eligible(to)) nodes.add(to);
      for (const source of incoming) if (cache || isWalkingSectionEdge(world, base, part, source)) edge(!cache && source.endsWith('-0') ? baseOf(source) : source, to);
    }
    for (const leg of transportEdges(routes)) edge(leg.from, leg.to, leg.cost);
    for (const route of routes) if (route.available && route.global && eligible(route.to)) for (const from of nodes) edge(from, route.to, route.cost);
  }
  const seeds = [...initial].filter(eligible).map(id => ({ id }));
  const budget = transportBudgetOverride ?? cached?.budget ?? transportBudget(state, memberId, transportFactsByMember, world);
  if (!cached) graphCache?.set(graphKey, { graph, nodes, routes, budget });
  const outward = affordableTransportPaths(seeds, graph, budget);
  if (_physicalUpper || !_requireReturn && (!automaticTransportEnabled(state) || !transportAccessEnabled(state))) return outward;
  // The original walking bound remains the only journey root. A typed
  // arrival must have a directed return with the combined journey affordable;
  // ownership or a newly reached endpoint cannot provide a free return.
  const landing = destination => {
    const candidates = cache ? componentLocations(world, destination, { landing: true })
      : [destination.endsWith('-0') ? baseOf(destination) : destination];
    const reached = candidates.filter(id => nodes.has(id) && eligible(id));
    return reached.length === 1 ? reached[0] : null;
  };
  const returns = (member.teleports ?? []).filter(teleport => teleport.available
    && (!teleport.consumable || state.rules?.['roll.consumableTeleports']))
    .map(teleport => landing(teleport.destination)).filter(Boolean);
  const catalogue = transportRoutes ?? TRANSPORT_ROUTES;
  for (const stone of lodestones) if ((!f2p || stone.f2p) && world.chunks.has(stone.chunkId)) {
    const to = landing(stone.location ?? stone.chunkId);
    // A reached retained activation site cannot bypass reviewed special-build,
    // quest, explicit override or consumable requirements for that same site.
    if (to && outward.has(to) && reviewedLodestoneUsable(catalogue, routes, stone, to, _proofLower)) returns.push(to);
  }
  // These are existing confirmed personal teleports or reached activation
  // sites with a unique existing landing. No roll-only chunk creates an edge.
  if (returns.length) {
    // Activation/return links depend on the outward roots; keep them outside
    // the memoized graph and never promote a previous arrival into a root.
    graph = new Map([...graph].map(([id, edges]) => [id, [...edges]]));
    for (const to of returns) for (const from of nodes) edge(from, to);
  }
  const reverse = new Map();
  for (const [from, edges] of graph) for (const leg of edges) {
    if (!reverse.has(leg.to)) reverse.set(leg.to, []);
    reverse.get(leg.to).push({ to: from, cost: leg.cost });
  }
  const returnSeeds = [...seeds];
  // A usable home teleport can land just outside claimed territory and walk
  // back in. Prove that return against these same roots, without admitting the
  // outside landing as an outward task/resource node. Availability's internal
  // proof already supplies its own candidate bound, so it never recurses here.
  if (!_requireReturn) for (const route of routes) if (route.available && route.global && route.to && !owned.has(baseOf(route.to))) {
    const anchor = transportReachabilityPaths(world, state, memberId, initial, { claimed: new Set([...owned, baseOf(route.to)]),
      sectionOverrides: overrides, transportRoutes, transportFactsByMember, lodestones, transportMemo, typedRoutes: routes,
      transportBudgetOverride: budget, _requireReturn: true, _skipNoop: true });
    for (const cost of anchor.returnPaths?.get(route.to) ?? []) for (const id of nodes) returnSeeds.push({ id, cost: addTransportCosts(route.cost ?? {}, cost) });
  }
  const back = affordableTransportPaths(returnSeeds, reverse, budget);
  const roundTrips = new Map([...outward].map(([id, costs]) => [id, costs.filter(outCost => (back.get(id) ?? [])
    .some(backCost => affordableTransportCost(addTransportCosts(outCost, backCost), budget)))])
    .filter(([, costs]) => costs.length));
  Object.defineProperty(roundTrips, 'returnPaths', { value: back });
  return roundTrips;
}

export function expandTransportReachability(world, state, memberId, initial, options = {}) {
  if (!transportAccessEnabled(state)) return new Set(initial);
  const paths = transportReachabilityPaths(world, state, memberId, initial, options);
  const reached = new Set(paths.keys());
  reached.transportNoop = paths.transportNoop === true;
  return reached;
}
