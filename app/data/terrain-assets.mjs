import { datasetValue } from "../dataset-runtime.mjs";
import { SURFACE_GRID } from './surface-grid.mjs';

export const TERRAIN_MANIFEST_PATH = datasetValue("app/data/terrain-assets.mjs#TERRAIN_MANIFEST_PATH");

// The offline exporter writes a new content-addressed directory and publishes
// its manifest last. Selecting a bundle requires this reviewed descriptor.
export const TERRAIN_BUNDLE = datasetValue("app/data/terrain-assets.mjs#TERRAIN_BUNDLE");

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const minX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride);
const maxY = SURFACE_GRID.startId % SURFACE_GRID.stride;
const regionKey = region => `${region.x},${region.y}`;
const inCrop = region => Number.isSafeInteger(region.x) && Number.isSafeInteger(region.y)
  && region.x >= minX && region.x < minX + SURFACE_GRID.columns
  && region.y <= maxY && region.y > maxY - SURFACE_GRID.rows;

export function validateTerrainDescriptor(descriptor) {
  if (!descriptor || !/^terrain\.optimized-\d{4}-\d{2}-\d{2}-[a-f0-9]{12,64}$/.test(descriptor.directory ?? '')
    || descriptor.manifestPath !== `${descriptor.directory}/manifest.json` || !hash(descriptor.manifestSha256)) {
    throw new TypeError('Invalid terrain bundle descriptor.');
  }
  return descriptor;
}

/** Validate every advertised path before it can reach the authenticated route. */
export function createTerrainAssetCatalogue(bundle, descriptor) {
  validateTerrainDescriptor(descriptor);
  const directory = descriptor.directory;
  if (bundle?.schemaVersion !== 1 || bundle.directory !== directory || bundle.mapId !== 28
    || bundle.plane !== 0 || bundle.zoom !== 2 || bundle.tileSize !== 256
    || bundle.iconFree !== true || bundle.layoutComplete !== true || bundle.transparentWater !== true
    || bundle.oceanColour?.length !== 3 || !bundle.oceanColour.every(c => Number.isInteger(c) && c >= 0 && c <= 255)
    || !Array.isArray(bundle.tiles) || !Array.isArray(bundle.pages)
    || !hash(bundle.provenance?.sourceManifestSha256)) throw new TypeError('Invalid terrain bundle.');
  const files = new Map(), tiles = new Map();
  const addFile = (entry, relative) => {
    if (entry.path !== relative || !hash(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1
      || files.has(`/assets/map/${relative}`)) throw new TypeError('Invalid terrain asset.');
    files.set(`/assets/map/${relative}`, { relative, sha256: entry.sha256, bytes: entry.bytes });
  };
  for (const tile of bundle.tiles) {
    if (!inCrop(tile) || tile.width !== 256 || tile.height !== 256 || tile.status !== 'rendered'
      || tiles.has(regionKey(tile))) throw new TypeError('Invalid terrain native tile.');
    addFile(tile, `${directory}/native/0_${tile.x}_${tile.y}.webp`);
    tiles.set(regionKey(tile), tile);
  }
  if (tiles.size !== SURFACE_GRID.columns * SURFACE_GRID.rows) throw new TypeError('Incomplete terrain native coverage.');
  const pages = new Set();
  for (const page of bundle.pages) {
    if (!Number.isSafeInteger(page.x) || !Number.isSafeInteger(page.y) || page.x < 0 || page.y < 0
      || page.x >= Math.ceil(SURFACE_GRID.columns / 4) || page.y >= Math.ceil(SURFACE_GRID.rows / 4)
      || page.left !== page.x * 512 || page.top !== page.y * 512 || page.width !== 512 || page.height !== 512
      || page.pixelWidth !== 256 || page.pixelHeight !== 256 || pages.has(regionKey(page))
      || !Array.isArray(page.regions)) throw new TypeError('Invalid terrain overview page.');
    const covered = new Set();
    for (const region of page.regions) {
      if (!inCrop(region) || Math.floor((region.x - minX) / 4) !== page.x
        || Math.floor((maxY - region.y) / 4) !== page.y || covered.has(regionKey(region))) {
        throw new TypeError('Invalid terrain overview region.');
      }
      covered.add(regionKey(region));
    }
    const count = Math.min(4, SURFACE_GRID.columns - page.x * 4) * Math.min(4, SURFACE_GRID.rows - page.y * 4);
    if (covered.size !== count) throw new TypeError('Incomplete terrain overview regions.');
    addFile(page, `${directory}/overview/${page.x}_${page.y}.webp`);
    pages.add(regionKey(page));
  }
  if (pages.size !== Math.ceil(SURFACE_GRID.columns / 4) * Math.ceil(SURFACE_GRID.rows / 4)) {
    throw new TypeError('Incomplete terrain overview coverage.');
  }
  return { files, directory, manifest: { relative: descriptor.manifestPath, sha256: descriptor.manifestSha256 } };
}
