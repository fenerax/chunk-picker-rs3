import { datasetJSON } from "../dataset-runtime.mjs";
const catalogue = await datasetJSON("app/data/map-connections.2026-10-09.v1.json");

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const MAP_CONNECTIONS = freeze(catalogue);
const byLocation = new Map(), destinationsByChunk = new Map();
for (const edge of MAP_CONNECTIONS.connections) {
  const ids = new Set([edge.from,edge.to].flatMap(point => [point.chunkId,point.areaId,point.sectionId,point.displayChunkId,point.locationId]).filter(Boolean));
  for (const id of ids) { const rows = byLocation.get(id) ?? []; rows.push(edge); byLocation.set(id,rows); }
}
for (const destination of MAP_CONNECTIONS.destinations) if (destination.chunkId) {
  const rows = destinationsByChunk.get(destination.chunkId) ?? []; rows.push(destination); destinationsByChunk.set(destination.chunkId,rows);
}
export function getMapConnectionsForChunk(chunkId) { return [...byLocation.get(String(chunkId)) ?? []]; }
export function mapConnectionsPayload({ chunkId, f2p = false } = {}) {
  const id = chunkId === undefined || chunkId === null || chunkId === '' ? null : String(chunkId);
  const payload = id === null ? MAP_CONNECTIONS : { ...MAP_CONNECTIONS, chunkId: id, connections: getMapConnectionsForChunk(id),
    destinations: [...destinationsByChunk.get(id) ?? []] };
  if (!f2p) return payload;
  const visible = row => row.members !== true && row.f2p !== false;
  return { ...payload, membershipView: 'f2p', connections: payload.connections.filter(visible),
    destinations: payload.destinations.filter(visible) };
}
