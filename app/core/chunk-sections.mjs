import { gunzipSync } from 'node:zlib';
import { sha256, sha256RepositoryText } from '../../scripts/lib/provenance-hash.mjs';

export const SECTION_MASK_ENCODING = 'base64-bitset-lsb0-y64+x';
export const SECTION_BUNDLE_DIRECTORY = 'chunk-sections.cache-audit-2026-10-07-v4-v1';
export const SECTION_INPUTS = ['app/data/cache-walkability.2026-10-07.v1.json',
  'app/data/cache-component-policy.2026-10-07.v1.json', 'app/data/cache-surface-corrections.2026-10-08.v1.json'];
const hasTile = (bytes, x, y) => !!(bytes[(y * 64 + x) >> 3] & (1 << ((y * 64 + x) & 7)));

function summarize(bytes) {
  let count = 0, sumX = 0, sumY = 0;
  const tiles = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (hasTile(bytes, x, y)) {
    tiles.push({ x, y }); count++; sumX += x; sumY += y;
  }
  const centerX = sumX / count, centerY = sumY / count;
  let point = null, distance = Infinity;
  for (const tile of tiles) {
    const candidate = (tile.x - centerX) ** 2 + (tile.y - centerY) ** 2;
    if (candidate < distance) { point = { x: tile.x + 0.5, y: tile.y + 0.5 }; distance = candidate; }
  }
  const horizontal = centerX < 64 / 3 ? 'western' : centerX > 128 / 3 ? 'eastern' : '';
  const vertical = centerY < 64 / 3 ? 'southern' : centerY > 128 / 3 ? 'northern' : '';
  const position = vertical && horizontal ? `${vertical.slice(0, -3)}-${horizontal}` : vertical || horizontal || 'central';
  return { count, point, position };
}

/** Convert the audited x-major Uint16 component labels without changing tiles. */
export function compactChunkSections(source, world, { provenance = {}, pins = [] } = {}) {
  const components = [];
  const active = world.cacheWalking?.components ?? new Map();
  for (const region of source.regions ?? []) {
    if (region.status !== 'decoded') continue;
    const masks = region.masks;
    if (masks?.encoding !== 'base64' || masks.order !== 'x*64+z' || masks.componentType !== 'uint16-le') throw new Error(`Unsupported mask format in ${region.id}.`);
    const labels = Buffer.from(masks.components, 'base64');
    if (labels.length !== 8192) throw new Error(`Invalid label grid in ${region.id}.`);
    const parts = new Map();
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
      const label = labels.readUInt16LE((x * 64 + y) * 2), id = `${region.id}-${1000000 + label}`;
      if (!label || !active.has(id)) continue;
      if (!parts.has(id)) parts.set(id, Buffer.alloc(512));
      const bit = y * 64 + x;
      parts.get(id)[bit >> 3] |= 1 << (bit & 7);
    }
    for (const [id, bytes] of parts) {
      const summary = summarize(bytes);
      if (summary.count !== active.get(id).tiles) throw new Error(`Component tile count mismatch: ${id}.`);
      const names = pins.filter(pin => pin.mapId === 28 && pin.plane === 0 && pin.chunkId === region.id
        && !pin.placementConditional && !pin.legacyAlternate && typeof pin.label === 'string' && pin.label.trim()
        && Number.isInteger(pin.x) && Number.isInteger(pin.y) && hasTile(bytes, pin.x % 64, pin.y % 64))
        .map(pin => ({ label: pin.label.trim().replace(/<[^>]*>/g, '').slice(0, 100), pinId: pin.id, x: pin.x % 64, y: pin.y % 64 }));
      components.push({ id, data: bytes.toString('base64'), walkableTileCount: summary.count,
        labels: names.filter((item, i) => names.findIndex(other => other.label === item.label) === i).slice(0, 3) });
    }
  }
  if (components.length !== active.size) throw new Error('Source masks do not cover all runtime walking components.');
  return { schemaVersion: 1, encoding: SECTION_MASK_ENCODING, gridSize: 64, provenance, components };
}

export function buildChunkSectionIndex(catalogue, world) {
  if (catalogue?.schemaVersion !== 1 || catalogue.encoding !== SECTION_MASK_ENCODING || catalogue.gridSize !== 64
    || !Array.isArray(catalogue.components)) throw new Error('Invalid chunk section catalogue.');
  const index = new Map();
  const walking = world.cacheWalking;
  const invalid = new Set(walking?.surfaceCorrections?.invalidRegionIds ?? []);
  const nonWalking = new Set(walking?.surfaceCorrections?.nonWalkingComponentIds ?? []);
  for (const entry of catalogue.components) {
    const component = walking?.components.get(entry.id);
    if (!component || invalid.has(component.base) || nonWalking.has(`${component.base}:${component.label}`)) continue;
    const bytes = Buffer.from(entry.data ?? '', 'base64');
    if (index.has(entry.id) || bytes.length !== 512 || bytes.toString('base64') !== entry.data
      || summarize(bytes).count !== component.tiles || entry.walkableTileCount !== component.tiles) throw new Error(`Invalid component mask: ${entry.id}.`);
    const labels = (entry.labels ?? []).filter(item => typeof item.label === 'string' && item.label.length <= 100
      && Number.isInteger(item.x) && Number.isInteger(item.y) && item.x >= 0 && item.x < 64 && item.y >= 0 && item.y < 64
      && hasTile(bytes, item.x, item.y));
    index.set(entry.id, { bytes, labels });
  }
  return { components: index, provenance: catalogue.provenance };
}

/** Missing or stale optional assets never invent geometry or prevent startup. */
export async function loadChunkSectionIndex(_gameDataDir, _repositoryRoot, world, { dataset } = {}) {
  if (!world.cacheWalking) return { components: new Map(), reason: 'cache-walking-unavailable', provenance: null };
  if (!dataset || !Array.isArray(dataset.files) || typeof dataset.json !== 'function' || typeof dataset.bytes !== 'function')
    throw new TypeError('Chunk geometry requires an explicit dataset provider.');
  const manifestKey = `local-game/${SECTION_BUNDLE_DIRECTORY}/manifest.json`;
  const bundleKey = `local-game/${SECTION_BUNDLE_DIRECTORY}/sections.v1.json.gz`;
  if (![manifestKey, bundleKey].every(key => dataset.files.some(file => file.path === key)))
    return { components: new Map(), reason: 'geometry-bundle-missing', provenance: null };
  try {
    const manifest = dataset.json(manifestKey);
    const bytes = dataset.bytes(bundleKey);
    if (manifest.schemaVersion !== 1 || manifest.sha256 !== sha256(bytes)) throw new Error('Bundle bytes differ from manifest.');
    const catalogue = JSON.parse(gunzipSync(bytes));
    const provenance = catalogue.provenance;
    if (provenance?.walkabilitySha256 !== world.cacheWalking.surfaceCorrections?.provenance?.walkabilitySha256) throw new Error('Walking source differs from runtime.');
    for (const file of SECTION_INPUTS) if (provenance?.repositoryHashes?.[file] !== sha256RepositoryText(dataset.bytes(file))) throw new Error('Runtime input differs from bundle.');
    return buildChunkSectionIndex(catalogue, world);
  } catch (error) {
    return { components: new Map(), reason: error.code === 'ENOENT' ? 'geometry-bundle-missing' : 'geometry-bundle-invalid', provenance: null };
  }
}

/** Presentation only: saved selectors and walking authority are not rewritten. */
export function chunkSectionsPayload(world, chunkId, index = { components: new Map() }) {
  if (!world.chunks.has(chunkId)) return null;
  const walking = world.cacheWalking;
  const retained = [...world.sectionTopology.get(chunkId)?.keys() ?? []].sort((a, b) => Number(a) - Number(b));
  const used = new Set(), sections = [];
  const invalid = new Set(walking?.surfaceCorrections?.invalidRegionIds ?? []);
  const nonWalking = new Set(walking?.surfaceCorrections?.nonWalkingComponentIds ?? []);
  const active = id => {
    const component = walking?.components.get(id);
    return component?.base === chunkId && !invalid.has(chunkId) && !nonWalking.has(`${chunkId}:${component.label}`);
  };
  function row(id, kind, retainedSectionIds, cacheComponentIds) {
    const known = cacheComponentIds.length > 0 && cacheComponentIds.every(component => index.components.has(component));
    const reason = !cacheComponentIds.length ? 'selector-correspondence-unresolved' : index.reason ?? 'component-mask-unavailable';
    if (!known) return { id, kind, retainedSectionIds, cacheComponentIds, mask: null, labelPoint: null, walkableTileCount: null,
      description: !cacheComponentIds.length ? 'The exact tiles in this walking area are not yet verified.' : 'The tiles for this walking area are unavailable.',
      geometryStatus: 'unknown', geometryReason: reason };
    const bytes = Buffer.alloc(512), labels = [];
    for (const component of cacheComponentIds) {
      const part = index.components.get(component);
      for (let byte = 0; byte < 512; byte++) bytes[byte] |= part.bytes[byte];
      labels.push(...part.labels);
    }
    const { count, point, position } = summarize(bytes);
    const names = [...new Set(labels.map(label => label.label))].slice(0, 3);
    const description = names.length ? `Walking area containing map ${names.length === 1 ? 'label' : 'labels'} ${names.map(name => `“${name}”`).join(', ')}.`
      : `${position[0].toUpperCase()}${position.slice(1)} walking area${cacheComponentIds.length > 1 ? ' (several mapped areas)' : ''}.`;
    return { id, kind, retainedSectionIds, cacheComponentIds, mask: { encoding: SECTION_MASK_ENCODING, data: bytes.toString('base64') },
      labelPoint: point, walkableTileCount: count, description, geometryStatus: 'exact', geometryReason: null };
  }
  for (const suffix of retained) {
    const id = `${chunkId}-${suffix}`, ids = [...walking?.legacyToComponents.get(id) ?? []].filter(active);
    ids.forEach(component => used.add(component));
    sections.push(row(id, 'retained-section', [id], ids));
  }
  for (const component of walking?.components.values() ?? []) if (active(component.id) && !used.has(component.id)) {
    sections.push(row(component.id, 'cache-component', walking.componentToLegacy.get(component.id) ?? [], [component.id]));
  }
  return { schemaVersion: 1, displayOnly: true, accessEffect: 'none', chunkId, gridSize: 64,
    coordinateSystem: 'local-x-east-y-north', sections, coverage: walking?.coverage.get(chunkId) ?? 'unknown', provenance: index.provenance ?? null };
}
