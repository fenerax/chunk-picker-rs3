const VERSION = '2026-10-08.v3';
const clone = value => structuredClone(value);
const baseId = value => String(value).replace(/-\d+$/, '');
const identities = point => [point?.areaId, point?.locationId, point?.chunkId, point?.sectionId].filter(value => value !== null && value !== undefined && value !== '').map(String);
const coordinateKey = point => JSON.stringify([point.mapId, point.plane, point.x, point.y]);
const hasCoordinates = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isInteger(point.mapId) && Number.isInteger(point.plane);
const validBounds = b => b && ['minX', 'minY', 'maxX', 'maxY'].every(key => Number.isFinite(b[key])) && b.minX < b.maxX && b.minY < b.maxY;
const inside = (point, layers) => hasCoordinates(point) && layers.some(layer => layer.mapId === point.mapId && layer.plane === point.plane
  && validBounds(layer.bounds) && point.x >= layer.bounds.minX && point.x < layer.bounds.maxX && point.y >= layer.bounds.minY && point.y < layer.bounds.maxY);

/**
 * Join display-only interior identities onto an existing connection payload.
 * No route, declaration, membership gate or access requirement is created.
 * inputs contains additional provenance rows; both inputs remain unmodified.
 */
export function buildInteriorConnections(baseConnections, interiorCatalogue, { inputs = [] } = {}) {
  if (!Array.isArray(baseConnections?.connections) || !Array.isArray(interiorCatalogue?.areas)) throw new TypeError('Expected connection and interior catalogues');
  const result = clone(baseConnections), areas = new Map(), aliases = new Map();
  for (const area of interiorCatalogue.areas) {
    if (!area.areaId || areas.has(String(area.areaId))) throw new TypeError('Interior areas need unique areaId values');
    areas.set(String(area.areaId), area);
    for (const id of area.aliasAreaIds ?? []) {
      const rows = aliases.get(String(id)) ?? [];
      rows.push(area); aliases.set(String(id), rows);
    }
  }
  const areaFor = point => {
    // Decoded surface walking witnesses retain their actual game-tile identity
    // when a historical numeric interior alias reuses the same packed ID.
    if (point?.precision === 'exact-boundary-tile' && point.mapId === 28 && point.plane === 0
      && point.coordinateEvidence?.kind === 'cache-cardinal-portals' && hasCoordinates(point)) return null;
    for (const id of identities(point)) {
      const area = areas.get(id) ?? areas.get(baseId(id));
      if (area) return area;
    }
    return null;
  };
  const layersFor = area => (area.layers ?? []).map(layer => {
    const source = (interiorCatalogue.maps ?? []).find(map => map.mapId === layer.mapId && map.plane === layer.plane);
    return { mapId: layer.mapId, plane: layer.plane, bounds: clone(layer.bounds ?? source?.bounds ?? null) };
  });
  const belongsTo = (point, area) => identities(point).some(id => id === String(area.areaId) || baseId(id) === String(area.areaId)
    || (area.aliasAreaIds ?? []).some(alias => String(alias) === id || String(alias) === baseId(id))
    || aliases.get(baseId(id))?.some(aliasArea => aliasArea.areaId === area.areaId));
  const sameLocation = (station, other) => {
    if (!station || !other) return false;
    if (station.id && other.stationId) return station.id === other.stationId;
    const otherArea = areaFor(other);
    if (otherArea && belongsTo(station, otherArea)) return true;
    return identities(station).some(id => identities(other).some(otherId => baseId(id) === baseId(otherId)));
  };
  const routeIds = edge => new Set([edge?.routeId, ...(edge?.provenance ?? []).map(row => row.routeId)].filter(Boolean));
  const entranceAnchor = (area, point, other, edge, layers) => {
    const candidates = [];
    for (const entrance of area.entrances ?? []) for (const [station, counterpart] of [[entrance.from, entrance.to], [entrance.to, entrance.from]]) {
      if (!station || !station.coordinateEvidence || !belongsTo(station, area) || !sameLocation(counterpart, other) || !inside(station, layers)) continue;
      if (point.stationId && station.id && point.stationId !== station.id) continue;
      candidates.push({ station, entrance });
    }
    const ids = routeIds(edge), matchingRoutes = candidates.filter(row => ids.has(row.entrance.id));
    const selected = ids.size ? matchingRoutes : candidates;
    // Several entrances into the same chunk do not identify one exact station.
    if (new Set(selected.map(row => coordinateKey(row.station))).size !== 1) return null;
    const { station, entrance } = selected[0];
    return { x: station.x, y: station.y, plane: station.plane, mapId: station.mapId,
      precision: station.precision === 'exact-arrival' ? 'exact-arrival' : 'exact-entrance',
      coordinateEvidence: clone(station.coordinateEvidence),
      interiorEvidence: { kind: 'reviewed-interior-entrance', routeId: entrance.id, precision: entrance.precision ?? 'reviewed-station-anchor',
        provenance: clone(entrance.provenance ?? []), unknowns: clone(entrance.unknowns ?? []),
        interpretation: 'Verified route station coordinate; an exact player arrival is established only when the station evidence explicitly says so.' } };
  };
  const annotate = (point, other = null, edge = null) => {
    if (!point) return point;
    const area = areaFor(point);
    if (!area) {
      if (!['region-center', 'unresolved'].includes(point.precision)) return point;
      const otherArea = areaFor(other), candidates = [];
      // A reviewed counterpart can replace an approximate surface chunk centre.
      // Several different entrances in the same chunk remain ambiguous.
      for (const entrance of otherArea?.entrances ?? []) for (const [station, counterpart] of [[entrance.from, entrance.to], [entrance.to, entrance.from]]) {
        if (station?.mapId === 28 && station.plane === 0 && station.coordinateEvidence && hasCoordinates(station)
          && sameLocation(station, point) && belongsTo(counterpart, otherArea)) candidates.push({ station, entrance });
      }
      const ids = routeIds(edge), selected = ids.size ? candidates.filter(row => ids.has(row.entrance.id)) : candidates;
      if (new Set(selected.map(row => coordinateKey(row.station))).size !== 1) return point;
      const { station, entrance } = selected[0];
      return { ...point, x: station.x, y: station.y, plane: 0, mapId: 28, precision: 'exact-entrance',
        worldX: (station.x + 0.5 - 1856) * 2, worldY: (4608 - station.y - 0.5) * 2,
        coordinateEvidence: clone(station.coordinateEvidence), interiorEvidence: { kind: 'reviewed-surface-counterpart',
          routeId: entrance.id, provenance: clone(entrance.provenance ?? []), unknowns: clone(entrance.unknowns ?? []),
          interpretation: 'Exact scenery/station entrance counterpart; current entry eligibility and player arrival are not inferred.' } };
    }
    const layers = layersFor(area), reference = { areaId: String(area.areaId), status: area.status,
      mapIds: clone(area.mapIds ?? []), layers, api: `/api/interior-maps?area=${encodeURIComponent(area.areaId)}` };
    const metadata = { ...point, offSurface: true, worldX: null, worldY: null, displayChunkId: null, interiorMap: reference };
    let anchor = null;
    if (area.status === 'mapped') {
      anchor = entranceAnchor(area, point, other, edge, layers);
      // A reviewed v2 route may be newer than the area's entrance census.
      if (!anchor && point.precision === 'exact-entrance' && point.coordinateEvidence && edge?.routeId
        && (edge.provenance ?? []).some(row => row.routeId === edge.routeId && row.kind === 'reviewed-transport-route') && inside(point, layers)) {
        anchor = { x: point.x, y: point.y, mapId: point.mapId, plane: point.plane, precision: point.precision, coordinateEvidence: clone(point.coordinateEvidence) };
      }
      const display = area.displayAnchor;
      if (!anchor && display?.coordinateEvidence && inside(display, layers)) {
        // displayAnchor is an area/display position, never an invented arrival.
        const precision = ['area-center', 'map-label-anchor', 'map-marker-anchor', 'map-layer-anchor', 'source-region-anchor'].includes(display.precision)
          ? display.precision : 'map-layer-anchor';
        anchor = { x: display.x, y: display.y, mapId: display.mapId, plane: display.plane, precision, coordinateEvidence: clone(display.coordinateEvidence) };
      }
      if (!anchor && point.precision === 'area-center' && point.coordinateEvidence && inside(point, layers)) {
        anchor = { x: point.x, y: point.y, mapId: point.mapId, plane: point.plane, precision: point.precision, coordinateEvidence: clone(point.coordinateEvidence) };
      }
    }
    if (anchor) {
      const { unresolvedReason, ...resolved } = metadata;
      return { ...resolved, ...anchor };
    }
    return { ...metadata, x: null, y: null, mapId: null, plane: null, precision: 'unresolved', coordinateEvidence: null,
      unresolvedReason: area.status === 'mapped' ? 'Interior map is mapped, but no verified coordinate anchor matches this endpoint.'
        : (area.unknowns ?? []).join(' ') || 'No verified interior map identity or coordinate anchor.' };
  };
  result.connections = result.connections.map(edge => {
    const from = annotate(edge.from, edge.to, edge), to = annotate(edge.to, edge.from, edge);
    return { ...edge, from, to, drawable: edge.drawable === true && ![from, to].some(point => point?.offSurface || point?.precision === 'unresolved')
      && [from, to].every(point => hasCoordinates(point) && point.mapId === 28 && point.plane === 0) };
  });
  if (Array.isArray(result.destinations)) result.destinations = result.destinations.map(point => annotate(point));
  result.version = VERSION;
  result.generatedAt = '2026-10-08';
  result.inputs = [...(result.inputs ?? []), ...clone(inputs)];
  result.summary = { ...result.summary, connections: result.connections.length,
    drawableConnections: result.connections.filter(edge => edge.drawable).length,
    unresolvedConnections: result.connections.filter(edge => !edge.drawable).length,
    offSurfaceConnections: result.connections.filter(edge => edge.from?.offSurface || edge.to?.offSurface).length,
    unresolvedInteriorEndpoints: result.connections.flatMap(edge => [edge.from, edge.to]).filter(point => point?.offSurface && point.precision === 'unresolved').length };
  return result;
}
