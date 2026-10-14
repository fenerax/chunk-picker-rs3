import { datasetJSON } from "../dataset-runtime.mjs";
import { inflateRawSync } from 'node:zlib';
const masks = await datasetJSON("app/data/training/banking-masks.v1.json");
const fishing = await datasetJSON("app/data/training/banking-fishing-spots.v1.json");
import { reviewedBankingService, bankingServiceEvidence } from '../data/training/banking-destinations.mjs';

const DIR = [[-1, 0], [0, 1], [1, 0], [0, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]];
const OPPOSITE = [2, 3, 0, 1, 6, 7, 4, 5];
const list = value => value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
const chunkAt = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const componentId = (base, label) => `${base}-${1000000 + label}`;
const limitations = Object.freeze([...masks.limits,
  'The nearest reviewed usable surface bank or deposit is selected. Unreviewed services, NPC-only banks, upper floors and connected interiors have no automatic route.',
  'Interaction perimeter tiles come from the cache placement witness. Bank opening, deposit clicks and gathering reaction times are separate cycle assumptions.']);

export function stilesSupports(method) {
  const outputs = (method.outputs ?? []).map(row => row.item).concat(method.output ?? []);
  return method.skill === 'Fishing' && outputs.length > 0 && outputs.every(name => /^(?:Raw |Cooked )?(?:tuna|lobster|swordfish)$/i.test(name));
}

function questsAllow(destination, availability) {
  return !destination.quest || list(availability.completedQuests).includes(destination.quest);
}

function selectorsFor(method, availability) {
  const names = new Set();
  const visit = requirement => {
    if (requirement.anyOf) requirement.anyOf.forEach(visit);
    else if (requirement.kind === 'object') {
      const alias = availability.aliases?.object?.[requirement.name];
      const values = alias ? Array.isArray(alias) ? alias : Object.keys(alias) : [requirement.name];
      values.forEach(name => names.add(name));
    }
  };
  (method.requirements ?? []).forEach(visit);
  return names;
}

/** A provider holds at most two territory fields. Distances are a multi-source
 * BFS (one game step for a diagonal or cardinal step), shared across methods.
 * No state, source gates, topology or saves are mutated. Node-only, on demand. */
export function createBankingRoutes({ world, tileData = masks, destinations, fishingSpots = fishing } = {}) {
  const packed = new Map(tileData.regions.map(row => [String(row[0]), row]));
  const unreviewedServices = destinations ? [] : [...(world?.cacheResources?.byChunk?.values() ?? [])].flatMap(groups =>
    [...groups.values()].flatMap(group => group.placements.filter(p => /^facility:(?:bank-|deposit-box)/.test(p.classKey)
      && !reviewedBankingService(p))));
  const destinationRows = destinations ?? [...(world?.cacheResources?.byChunk?.values() ?? [])].flatMap(groups =>
    [...groups.values()].flatMap(group => group.placements.map(p => {
      const service = reviewedBankingService(p);
      return service && { ...service, id: p.id, chunkId: String(p.chunkId), x: p.x, y: p.y, witnessTiles: p.witnessTiles };
    }).filter(Boolean)));
  // The same physical bank placement appears in only one byChunk class, but
  // deduplicate nevertheless for future catalogue classes sharing a placement.
  const banks = [...new Map(destinationRows.map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const profiles = new Map();

  function makeField(availability, includeStiles) {
    const bases = new Set(list(availability.access?.bases).map(String));
    const components = new Set(list(availability.access?.components).map(String));
    const members = availability.members === true;
    const key = JSON.stringify([members, includeStiles, [...bases].sort(), [...components].sort(), list(availability.completedQuests).sort()]);
    if (profiles.has(key)) {
      const field = profiles.get(key); profiles.delete(key); profiles.set(key, field); return field;
    }
    const regions = [], byBase = new Map(), missing = [];
    for (const base of [...bases].sort()) {
      const row = packed.get(base);
      if (!row) { missing.push(base); continue; }
      const raw = inflateRawSync(Buffer.from(row[1], 'base64'));
      if (raw.length !== 12288) throw new Error(`Invalid banking tile mask for ${base}.`);
      const allowed = new Uint8Array(4096), free = row[2] ? Buffer.from(row[2], 'hex') : null;
      const r = { base, offset: regions.length * 4096, x: (Number(base) >> 8) * 64, y: (Number(base) & 255) * 64,
        moves: raw.subarray(8192), allowed, raw };
      for (let i = 0; i < 4096; i++) {
        const label = raw.readUInt16LE(i * 2), id = componentId(base, label);
        const componentFree = world?.cacheWalking?.components?.get(id)?.free;
        allowed[i] = Number(label > 0 && components.has(id) && (members || componentFree === true
          && free && (free[(i >> 6) >> 3] & (1 << ((i & 63) >> 3))) !== 0));
      }
      byBase.set(base, r); regions.push(r);
    }
    const size = regions.length * 4096;
    const distance = new Int32Array(size).fill(-1), next = new Uint8Array(size).fill(255), owner = new Uint16Array(size).fill(65535);
    const lookup = (x, y) => {
      const r = byBase.get(chunkAt(x, y)), i = (x & 63) * 64 + (y & 63);
      return r?.allowed[i] ? r.offset + i : -1;
    };
    const coords = node => {
      const r = regions[node >> 12], i = node & 4095;
      return [r.x + (i >> 6), r.y + (i & 63)];
    };
    const candidates = banks.filter(bank => bases.has(bank.chunkId) && (members || bank.members === false) && questsAllow(bank, availability));
    if (includeStiles && bases.has('11313')) candidates.push({ id: 'npc:stiles', label: 'Stiles (fish noting)', kind: 'stiles',
      members: false, chunkId: '11313', x: 2851, y: 3143, evidence: bankingServiceEvidence.stiles,
      witnessTiles: DIR.slice(0, 4).map(([dx, dy]) => [2851 + dx, 3143 + dy]) });
    const queue = new Uint32Array(size), eligible = [];
    let head = 0, tail = 0;
    for (const candidate of candidates) {
      const starts = (candidate.witnessTiles ?? []).map(([x, y]) => lookup(x, y)).filter(node => node >= 0);
      if (!starts.length) continue;
      const index = eligible.length; eligible.push(candidate);
      for (const node of starts) if (distance[node] === -1) { distance[node] = 0; owner[node] = index; queue[tail++] = node; }
    }
    while (head < tail) {
      const node = queue[head++], r = regions[node >> 12], mask = r.moves[node & 4095], [x, y] = coords(node);
      for (let d = 0; d < 8; d++) {
        if (!(mask & (1 << d))) continue;
        const [dx, dy] = DIR[d], neighbor = lookup(x + dx, y + dy);
        if (neighbor < 0 || distance[neighbor] >= 0) continue;
        // Admission is checked for both corner tiles, too: a diagonal may
        // never slip through a locked chunk, blocked component or members tile.
        if (d >= 4 && (lookup(x + dx, y) < 0 || lookup(x, y + dy) < 0)) continue;
        distance[neighbor] = distance[node] + 1; next[neighbor] = OPPOSITE[d]; owner[neighbor] = owner[node]; queue[tail++] = neighbor;
      }
    }
    const unknownServices = unreviewedServices.filter(p => bases.has(String(p.chunkId))
      // These two positively reviewed members services are unavailable in F2P.
      && (members || ![19230, 112405].includes(p.objectId))
      && (p.witnessTiles ?? []).some(([x, y]) => lookup(x, y) >= 0)).map(p => p.id);
    // Reviewed NPC-only or upper-floor banks have no surface interaction
    // placement. Their existence cannot be converted to a guessed tile route.
    if (!destinations) for (const base of ['12598', '13626', '9770']) if (bases.has(base)) unknownServices.push(`unlocated-bank:${base}`);
    const field = { bases, components, regions, byBase, missing, unknownServices, eligible, distance, next, owner, lookup, coords };
    profiles.set(key, field);
    if (profiles.size > 2) profiles.delete(profiles.keys().next().value);
    return field;
  }

  function resourceSpots(method, availability) {
    const selectors = selectorsFor(method, availability), locations = availability.access?.locations ?? {};
    const result = new Map();
    for (const [base, groups] of world?.cacheResources?.byChunk ?? []) {
      if (!list(availability.access?.bases).includes(base)) continue;
      for (const resource of groups.values()) {
        const matching = resource.names.filter(name => selectors.has(name));
        if (!matching.length) continue;
        const valid = new Set(matching.flatMap(name => list(locations instanceof Map ? locations.get(`Object:${name}`) : locations[`Object:${name}`])));
        if (!valid.size) continue; // Preserve the task engine's personal source gates and backlogs.
        for (const p of resource.placements) {
          const witnessTiles = (p.witnessTiles ?? []).filter(([, , id]) => valid.has(id?.includes(':')
            ? componentId(id.split(':')[0], Number(id.split(':')[1])) : id));
          const retained = resource.retainedSources?.some(source => valid.has(source.location));
          if (!witnessTiles.length && !retained) continue;
          result.set(p.id, { id: p.id, label: `${resource.name} — ${world?.chunks?.get(base)?.name ?? base}`,
            chunkId: base, x: p.x, y: p.y, classKey: resource.classKey, witnessTiles,
            evidence: 'cache-resource-placement', ...(witnessTiles.length ? {} : { unknownReason: 'Resource access is retained, but its interaction component has no admitted tile route.' }) });
        }
      }
    }
    return [...result.values()];
  }

  function defaultSpots(method, availability) {
    if (method.skill !== 'Fishing') return resourceSpots(method, availability);
    const methodId = method.fishingCurve?.methodId;
    const selectors = selectorsFor(method, availability), locations = availability.access?.locations ?? {};
    const validBases = new Set([...selectors].flatMap(name => list(locations instanceof Map
      ? locations.get(`Object:${name}`) : locations[`Object:${name}`])).map(location => location.split('-')[0]));
    return (fishingSpots.groups ?? []).filter(group => group.methods.includes(methodId)).flatMap(group => group.points.map(([x, y]) => ({
      id: `fishing:${methodId}:${x}:${y}`, label: group.label, chunkId: chunkAt(x, y), x, y,
      evidence: fishingSpots.sources[group.source], positionQuality: 'wiki-map-marker',
      witnessTiles: DIR.slice(0, 4).map(([dx, dy]) => [x + dx, y + dy]),
      limitations: fishingSpots.limits,
    }))).filter(spot => list(availability.access?.bases).includes(spot.chunkId)
      && (!selectors.size || validBases.has(spot.chunkId)));
  }

  function routesForGathering({ method, availability = {}, spots } = {}) {
    if (!method) throw new TypeError('A gathering method is required.');
    const candidates = spots ?? defaultSpots(method, availability);
    const field = makeField(availability, stilesSupports(method));
    const rows = candidates.filter(spot => field.bases.has(String(spot.chunkId ?? chunkAt(spot.x, spot.y)))).map(spot => {
      const witnesses = spot.witnessTiles ?? [[spot.x, spot.y]];
      const starts = witnesses.map(([x, y]) => field.lookup(x, y)).filter(node => node >= 0);
      const row = { spot: { ...spot, witnessTiles: undefined }, status: 'unknown', destination: null,
        tileSteps: null, roundTripTileSteps: null, chunks: [], limitations: [...limitations, ...(spot.limitations ?? [])] };
      if (spot.unknownReason || !starts.length) return { ...row, reason: spot.unknownReason ?? 'No admitted interaction tile in the available surface coverage.' };
      const reached = starts.filter(node => field.distance[node] >= 0).sort((a, b) => field.distance[a] - field.distance[b]);
      if (!reached.length) return { ...row, status: field.missing.length || field.unknownServices.length ? 'unknown' : 'no-bank',
        reason: field.missing.length ? 'Unlocked surface tile coverage is missing; no reviewed walking route was established.'
          : field.unknownServices.length ? 'An unlocked bank or deposit service lacks reviewed requirements or interaction coordinates; no usable walking route was established.'
          : 'No reviewed usable bank, deposit or noting service has a walking route within the admitted chunks in the closed cache snapshot.',
        ...(field.missing.length ? { missingCoverage: field.missing } : {}),
        ...(field.unknownServices.length ? { unreviewedServices: field.unknownServices } : {}) };
      const first = reached[0], candidate = field.eligible[field.owner[first]], chunks = [];
      let node = first;
      while (true) {
        const base = field.regions[node >> 12].base;
        if (chunks[chunks.length - 1] !== base) chunks.push(base);
        if (field.next[node] === 255) break;
        const [x, y] = field.coords(node), [dx, dy] = DIR[field.next[node]];
        node = field.lookup(x + dx, y + dy);
      }
      const [toX, toY] = field.coords(node), [fromX, fromY] = field.coords(first), tileSteps = field.distance[first];
      return { ...row, status: 'routed', reason: 'Shortest diagonal-aware route to a reviewed usable service in the admitted surface tiles.',
        destination: { ...candidate, witnessTiles: undefined, interactionTile: { x: toX, y: toY } },
        interactionTile: { x: fromX, y: fromY }, tileSteps, roundTripTileSteps: tileSteps * 2, chunks,
        returnChunks: [...chunks].reverse(), model: 'closed-cache-tile-walking', exactWithinModel: true,
        ...(field.unknownServices.length ? { unreviewedServices: field.unknownServices } : {}) };
    });
    if (!rows.length) return [{ spot: { id: `${method.id}:unlocated`, label: method.label ?? method.id }, status: 'unknown',
      destination: null, tileSteps: null, roundTripTileSteps: null, chunks: [],
      reason: 'No reviewed physical gathering spot is available for this method in the admitted chunks.', limitations }];
    return rows.sort((a, b) => (a.tileSteps ?? Infinity) - (b.tileSteps ?? Infinity) || a.spot.id.localeCompare(b.spot.id));
  }
  return { routesForGathering };
}
