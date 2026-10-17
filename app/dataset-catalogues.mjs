import { materializeDatasetValues } from './dataset-runtime.mjs';

// Compatibility URLs select catalogue keys, never arbitrary filesystem roots.
export function datasetCatalogueKey(route, dataset) {
  if (!route.startsWith('/data/') || !route.endsWith('.json')) return null;
  const key = `app${route}`;
  return dataset.files.some(file => file.path === key && file.kind === 'input') ? key : null;
}
export async function datasetBrowserPayload(dataset) {
  return { schemaVersion: 1, dataset: dataset.status(), capabilities: dataset.capabilities,
    gameDefaults: dataset.gameDefaults, definitionOverlays: dataset.definitionOverlays ?? [],
    values: await materializeDatasetValues() };
}
export async function datasetLocalMetadataBytes(route, dataset) {
  const permitted = new Set(['/assets/map/manifest.json', '/assets/map/pins.normalized.json',
    '/assets/map/pins.cache-2026-10-08-05932552f7af-v1.json', '/assets/map/manifest.cache-2026-10-08-05932552f7af-v1.json']);
  if (!permitted.has(route)) return null;
  const key = `local-map/${route.slice('/assets/map/'.length)}`;
  const bytes = await dataset.metadataBytes(key);
  if (!bytes) return null;
  if (route === '/assets/map/manifest.json') {
    try {
      const manifest = JSON.parse(bytes.toString('utf8'));
      if (['pins.normalized.json', '/assets/map/pins.normalized.json'].includes(manifest.pins?.path)
        && !(await dataset.metadataBytes('local-map/pins.normalized.json'))
        && !(await dataset.metadataBytes('local-map/pins.cache-2026-10-08-05932552f7af-v1.json'))) return null;
    } catch (error) { if (dataset.packed && error.code === 'DATASET_PACK_INVALID') throw error; return null; }
  }
  return bytes;
}
