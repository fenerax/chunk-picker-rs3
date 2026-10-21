// The retained picker grid contract (world.mjs surfaceCoordinates), repeated
// here to keep offline extraction independent of app resource initialisation.
function surfaceCoordinates(id) {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  const x = Math.ceil((Number(id) - 7495) / 256) || 0, y = x * 256 + 7495 - Number(id);
  return x >= 0 && x < 47 && y >= 0 && y < 50 ? { x, y } : null;
}
const key = name => String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const unique = values => [...new Set(values)];

// Reviewed transport identities override ambiguous or historical name matches.
const overrides = {
  'Lumbridge Cellar': [31], 'Lumbridge Catacombs': [164, 165], 'Draynor Sewers': [542],
  'Edgeville Dungeon': [592], 'Varrock Sewers': [592],
  'Edgeville Dungeon chaos druids dungeon': [372], 'Edgeville Dungeon hill giant dungeon': [374],
  'Varrock Sewers resource dungeon': [380], 'Ashdale Caves': [665],
};

/** Name equality supplies a reviewable correspondence, never live-instance or
 * access certainty. Numeric aliases additionally select source grid witnesses
 * when available; old picker coordinates remain explicitly unaligned. */
export function buildInteriorCandidates(definitions, places, transport, connections) {
  const maps = new Map(places.mapRecords.filter(m => m.id !== 28 && m.pastePresent && ((m.declaredPastes?.squares ?? 0) + (m.declaredPastes?.chunks ?? 0) > 0)).map(m => [m.id, m]));
  const byName = new Map();
  for (const m of maps.values()) byName.set(key(m.name), [...(byName.get(key(m.name)) ?? []), m]);
  const stations = new Map(transport.stations.map(s => [s.id, s]));
  // Name marks numeric interior aliases even when their packed numbers collide
  // with the surface grid. Surface records use Nickname instead.
  const areas = Object.entries(definitions.chunks).filter(([id, record]) => record.Name || !surfaceCoordinates(id)).map(([id, record]) => {
    const name = record.Name ?? record.Nickname ?? id;
    const witnessed = transport.stations.filter(s => s.mapId !== 28 && ((s.locationId === id || s.chunkId === id)
      && (!s.locationId || s.locationId === id) || s.coordinateEvidence?.retainedLocationEvidence?.name === name));
    let ids = overrides[name] ?? unique(witnessed.map(s => s.mapId));
    let method = overrides[name] ? 'reviewed-semantic-map-identity' : ids.length ? 'reviewed-transport-station' : 'unique-exact-map-name';
    let candidates = byName.get(key(name)) ?? [];
    if (!ids.length && candidates.length === 1) ids = [candidates[0].id];
    if (!ids.length && /^\d+$/.test(id) && candidates.length > 1) {
      const sx = Math.floor(Number(id) / 256) * 64, sy = Number(id) % 256 * 64;
      const overlapping = candidates.filter(m => m.bounds?.some(b => b.src.xstart < sx + 64 && b.src.xend >= sx && b.src.zstart < sy + 64 && b.src.zend >= sy));
      if (overlapping.length === 1) { ids = [overlapping[0].id]; method = 'exact-name-and-source-region'; }
    }
    ids = ids.filter(mapId => maps.has(mapId));
    const entrances = [];
    for (const route of transport.routes) {
      const endpoints = [stations.get(route.from), stations.get(route.to)];
      if (!endpoints.some(s => s && (s.locationId === id || s.chunkId === id || (!/^\d+$/.test(id) && witnessed.some(w => w.id === s.id))))) continue;
      entrances.push({ id: route.id, kind: route.kind, from: endpoints[0] ?? null, to: endpoints[1] ?? null,
        bidirectional: route.bidirectional, precision: 'reviewed-station-anchor', provenance: route.provenance,
        unknowns: route.unknowns, accessEffect: 'none' });
    }
    const declaredConnections = connections.connections.filter(e => [e.from, e.to].some(s => (s?.areaId ?? s?.chunkId) === id))
      .map(e => ({ id: e.id, kind: e.kind, from: e.from, to: e.to, precision: e.from.precision === 'unresolved' || e.to.precision === 'unresolved' ? 'unresolved' : 'approximate-display',
        provenance: e.provenance, accessEffect: 'none' }));
    return { areaId: id, name, status: ids.length ? 'mapped' : 'unknown', mapIds: ids,
      bounds: null, boundsKind: ids.length ? 'map-layout-coverage-available-per-layer; semantic-area-enclosure-unknown' : 'unknown',
      layers: [], entrances, declaredConnections,
      evidence: [{ kind: 'retained-picker-record', file: 'rs3-chunkpicker-chunkinfo-export.json', pointer: `/chunks/${pointer(id)}` },
        ...(ids.length ? [{ kind: method, mapIds: ids, name }] : [])],
      unknowns: ids.length ? ['Static map-name/transport correspondence; current quest instance and live entry are not observed.',
        'Map layout bounds describe rendered coverage, not an enclosure proving area access.'] : [candidates.length > 1 ? 'Ambiguous cache map names; no reviewed selector.' : 'No exact cache map identity verified.'],
      candidateMapIds: ids.length ? [] : candidates.map(m => m.id) };
  });
  // Attach named aliases to already reviewed numeric station identities, without
  // promoting retained Connect declarations to precise entrances.
  for (const a of areas.filter(a => !/^\d+$/.test(a.areaId))) {
    const aliases = areas.filter(b => /^\d+$/.test(b.areaId) && b.name === a.name);
    a.aliasAreaIds = aliases.map(b => b.areaId);
    a.entrances = [...new Map([...a.entrances, ...aliases.flatMap(b => b.entrances)].map(e => [e.id, e])).values()];
  }
  for (const a of areas) if (!a.entrances.length) a.unknowns.push('No reviewed exact entrance route; retained declarations remain approximate or unresolved.');
  return { areas, maps: [...maps.values()].filter(m => areas.some(a => a.mapIds.includes(m.id))) };
}
