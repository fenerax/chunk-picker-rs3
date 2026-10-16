// Calculator-only evidence is explicitly supplied by a provider or pinned
// operator add-on. It creates no access edges, ownership or player landings.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const tile = value => Number.isSafeInteger(value) && value >= 0;

/** The surface graph must still admit an entrance witness. Upper-floor timing
 * remains an estimate and the service never becomes a surface graph seed. */
export function interiorBankCandidates(evidence = { schemaVersion: 1, candidates: [] }) {
  if (!plain(evidence) || evidence.schemaVersion !== 1 || !Array.isArray(evidence.candidates)
    || evidence.candidates.length > 1000) throw new TypeError('Invalid banking interior evidence.');
  const ids = new Set();
  for (const row of evidence.candidates) {
    if (!plain(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || typeof row.label !== 'string' || !row.label || row.kind !== 'bank'
      || typeof row.members !== 'boolean' || typeof row.chunkId !== 'string' || !row.chunkId
      || ![row.x, row.y, row.mapId, row.plane].every(tile) || row.plane === 0
      || !plain(row.entryPoint) || ![row.entryPoint.x, row.entryPoint.y].every(tile)
      || row.entryPoint.plane !== 0 || row.entryPoint.mapId !== row.mapId
      || !Array.isArray(row.witnessTiles) || !row.witnessTiles.length
      || !row.witnessTiles.every(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(tile))
      || !Number.isFinite(row.interiorSeconds) || row.interiorSeconds < 0
      || !tile(row.interiorTileSteps) || !plain(row.interiorEstimate)
      || row.interiorEstimate.estimated !== true || row.interiorEstimate.accessEffect !== 'none'
      || !Array.isArray(row.interiorEstimate.assumptions) || !row.interiorEstimate.assumptions.every(note => typeof note === 'string')) {
      throw new TypeError('Invalid banking interior evidence.');
    }
    ids.add(row.id);
  }
  return structuredClone(evidence.candidates);
}
