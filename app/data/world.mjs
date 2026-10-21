import { requireSelectedDataset, datasetEngineContext } from '../dataset-runtime.mjs';
import { SURFACE_GRID, surfaceCoordinates } from './surface-grid.mjs';
export { SURFACE_GRID, surfaceCoordinates } from './surface-grid.mjs';
import { registerWorldConnectionResolver } from './world-connections.mjs';
import { partnerConnections } from '../core/rules.mjs';
import { applyMapCorrections } from './map-corrections.mjs';
import { applyCacheTopology, cacheSurfaceRegions, cacheRegionNames } from './cache-topology.mjs';
import { applyCacheResources, cacheResourceContentsEnabled } from './cache-resources.mjs';
import { applyCacheArchaeology, cacheArchaeologyContentsEnabled } from './cache-archaeology.mjs';

/** Index the local reference data once. No upstream executable code is imported. */
export function buildWorld(definitions, { dataset, cacheWalking = dataset?.capabilities.cacheWalking ?? false,
  cacheResources = dataset?.capabilities.cacheResources ?? false, resourceCatalogue, resourceSelectors,
  cacheArchaeology = dataset?.capabilities.cacheArchaeology ?? false, archaeologyCatalogue, reviewedOverlays } = {}) {
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)
    || !definitions.chunks || typeof definitions.chunks !== 'object' || Array.isArray(definitions.chunks)) {
    throw new TypeError('Definitions must contain a chunks object.');
  }
  if (dataset) requireSelectedDataset(dataset);
  const corrected = dataset?.capabilities.mapCorrections ? applyMapCorrections(definitions)
    : { definitions, sectionMembership: new Map(), sectionRoutes: new Map(), mapCorrections: [] };
  definitions = corrected.definitions;
  const issues = [];
  const chunks = new Map();
  const areas = new Map();
  for (const [id, record] of Object.entries(definitions.chunks)) {
    if (!id.trim() || !record || typeof record !== 'object' || Array.isArray(record)) {
      issues.push({ code: 'invalid-chunk', id, message: 'Chunk ID or record is malformed.' });
      continue;
    }
    if (/^\d+$/.test(id) && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
      issues.push({ code: 'invalid-chunk', id, message: 'Numeric chunk ID must be a positive safe integer.' });
      continue;
    }
    const label = record.Nickname ?? record.Name;
    if (label !== undefined && typeof label !== 'string') issues.push({ code: 'invalid-name', id, message: 'Chunk label must be text; using its ID.' });
    const indexed = { id, name: typeof label === 'string' && label.trim() ? label : /^\d+$/.test(id) ? `Chunk ${id}` : id };
    // Named interior keys are legitimate reference records, but are not overland roll IDs.
    (/^\d+$/.test(id) ? chunks : areas).set(id, indexed);
  }
  if (cacheWalking) for (const id of cacheSurfaceRegions) if (surfaceCoordinates(id) && !chunks.has(id)) {
    chunks.set(id, { id, name: cacheRegionNames[id] ?? `Surface region ${id}`, terrainOnly: true });
  }
  function readList(key) {
    if (!Array.isArray(definitions[key])) throw new TypeError(`${key} must be an array.`);
    const ids = new Set();
    for (const value of definitions[key]) {
      if (typeof value !== 'string') {
        issues.push({ code: 'invalid-list-id', list: key, id: String(value), message: 'Expected a string chunk ID.' });
        continue;
      }
      const id = value.trim();
      if (id !== value) issues.push({ code: 'trimmed-id', list: key, id, message: 'Whitespace removed from reference ID.' });
      if (!chunks.has(id)) {
        issues.push({ code: 'missing-chunk', list: key, id, message: 'Reference destination is not defined; omitted from roll candidates.' });
        continue;
      }
      ids.add(id);
    }
    return ids;
  }
  const walkable = readList('walkableChunks');
  const f2p = readList('walkableChunksF2P');
  for (const id of f2p) if (!walkable.has(id)) {
    issues.push({ code: 'f2p-only-walkable', id, message: 'Present only in F2P walkable list; accepted as walkable.' });
    walkable.add(id);
  }
  const surface = new Set([...chunks.keys()].filter(id => surfaceCoordinates(id)));
  const sectionTopology = new Map();
  for (const [base, sections] of Object.entries(definitions.sections ?? {})) {
    if (!chunks.has(base) || !sections || typeof sections !== 'object' || Array.isArray(sections)) {
      issues.push({ code: 'invalid-section-base', id: base, message: 'Section topology base is missing or malformed.' });
      continue;
    }
    const indexed = new Map();
    for (const [section, edges] of Object.entries(sections)) {
      if (!/^\d+$/.test(section) || !Array.isArray(edges)) {
        issues.push({ code: 'invalid-section', id: `${base}-${section}`, message: 'Section number or edge list is malformed.' });
        continue;
      }
      const valid = [];
      for (const rawEdge of edges) {
        const edge = typeof rawEdge === 'string' ? rawEdge.trim() : '';
        const [targetBase, targetSection] = edge.split('-');
        if (!/^[1-9]\d*(?:-\d+)?$/.test(edge) || !chunks.has(targetBase)
          || (targetSection !== undefined && !Object.hasOwn(definitions.sections?.[targetBase] ?? {}, targetSection))) {
          issues.push({ code: 'missing-section-edge', id: edge || String(rawEdge), source: `${base}-${section}`, message: 'Section edge destination is undefined; omitted.' });
          continue;
        }
        if (rawEdge !== edge) issues.push({ code: 'trimmed-section-edge', id: edge, message: 'Whitespace removed from section destination.' });
        valid.push(edge);
      }
      indexed.set(section, [...new Set(valid)]);
    }
    sectionTopology.set(base, indexed);
  }
  // Match the reference image's 47 by 50 crop, rather than all numeric regions.
  // These are geometric neighbors only. The rules engine separately checks
  // sectionTopology for a traversable boundary in its default accessible mode;
  // walkable/f2p lists describe destination terrain, not a route into it.
  const neighbors = new Map();
  for (const id of chunks.keys()) {
    const adjacent = [];
    const point = surfaceCoordinates(id);
    if (point) {
      const positions = [[point.x - 1, point.y], [point.x + 1, point.y], [point.x, point.y - 1], [point.x, point.y + 1]];
      for (const [x, y] of positions) {
        if (x < 0 || x >= SURFACE_GRID.columns || y < 0 || y >= SURFACE_GRID.rows) continue;
        const neighbor = String(x * SURFACE_GRID.stride - y + SURFACE_GRID.startId);
        if (surface.has(neighbor)) adjacent.push(neighbor);
      }
    }
    neighbors.set(id, adjacent.sort((a, b) => Number(a) - Number(b)));
  }
  const world = { datasetDigest: dataset?.digest, chunks, areas, neighbors, walkable, f2p, surface, sectionTopology, issues, componentMembership: new Map(),
    sectionMembership: corrected.sectionMembership, sectionRoutes: corrected.sectionRoutes, mapCorrections: corrected.mapCorrections };
  if (cacheWalking) applyCacheTopology(world);
  applyCacheResources(world, definitions, { enabled: cacheResources, resourceCatalogue, resourceSelectors });
  applyCacheArchaeology(world, definitions, { enabled: cacheArchaeology, archaeologyCatalogue });
  registerWorldConnectionResolver(world, (state, memberId) => partnerConnections(world, state, memberId));
  Object.defineProperties(world, {
    definitions: { value: definitions },
    automaticTransportOptions: { value: { dataset: dataset && datasetEngineContext(dataset), cacheWalking, cacheResources, resourceCatalogue, resourceSelectors, cacheArchaeology, archaeologyCatalogue,
      // Servers built from injected definitions opt out of reviewed overlays; travel must inherit that policy.
      ...(reviewedOverlays === undefined ? {} : { reviewedOverlays }) } },
  });
  return world;
}

/** Report ambiguous legacy IDs without silently picking one task label. */
export function findTaskIdCollisions(taskMap) {
  if (!taskMap || typeof taskMap !== 'object' || Array.isArray(taskMap)) throw new TypeError('Task map must be an object.');
  const labelsById = new Map();
  for (const [label, id] of Object.entries(taskMap)) {
    // Upstream keeps its allocation cursor in the same object as label/ID entries.
    if (label === 'currentNextIndex' && Number.isSafeInteger(id) && id > 0) continue;
    if (typeof id !== 'string') throw new TypeError(`Invalid task ID for ${label}.`);
    if (!labelsById.has(id)) labelsById.set(id, []);
    labelsById.get(id).push(label);
  }
  return [...labelsById.entries()].filter(([, labels]) => labels.length > 1)
    .map(([id, labels]) => ({ id, labels }));
}
