import { datasetValue } from "../dataset-runtime.mjs";
import { SURFACE_GRID } from './surface-grid.mjs';
import { categoryForSprite, categoryForCachePin, MAP_PIN_CATEGORIES } from './map-pin-categories.mjs';

export const CACHE_PIN_BUNDLE = datasetValue("app/data/map-pins.mjs#CACHE_PIN_BUNDLE");
export const CACHE_PIN_PATH = datasetValue("app/data/map-pins.mjs#CACHE_PIN_PATH");
export const CACHE_PIN_MANIFEST_PATH = datasetValue("app/data/map-pins.mjs#CACHE_PIN_MANIFEST_PATH");
export const CACHE_PIN_SPRITE_DIRECTORY = datasetValue("app/data/map-pins.mjs#CACHE_PIN_SPRITE_DIRECTORY");

export const PIN_COMMIT = datasetValue("app/data/map-pins.mjs#PIN_COMMIT");
export const PIN_SNAPSHOT_DATE = datasetValue("app/data/map-pins.mjs#PIN_SNAPSHOT_DATE");
const regionX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride);
const regionY = SURFACE_GRID.startId % SURFACE_GRID.stride;
export const SURFACE_CROP = datasetValue("app/data/map-pins.mjs#SURFACE_CROP");

export function gameToWorld(x, y, { centred = false } = {}) {
  const offset = centred ? 0 : 0.5;
  return { x: (x + offset - SURFACE_CROP.minX) * 2, y: (SURFACE_CROP.maxY - y - offset) * 2 };
}

export function chunkIdForGame(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < SURFACE_CROP.minX || x >= SURFACE_CROP.maxX
    || y < SURFACE_CROP.minY || y >= SURFACE_CROP.maxY) return null;
  return String(Math.floor(x / 64) * SURFACE_GRID.stride + Math.floor(y / 64));
}

export function enumerateTerrainTiles(zoom = 2) {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 3) throw new RangeError('Terrain zoom must be 0–3.');
  const span = 256 / 2 ** zoom;
  const result = [];
  for (let y = Math.floor(SURFACE_CROP.minY / span); y < Math.ceil(SURFACE_CROP.maxY / span); y++) {
    for (let x = Math.floor(SURFACE_CROP.minX / span); x < Math.ceil(SURFACE_CROP.maxX / span); x++) {
      result.push({ x, y, path: `terrain/28/${zoom}/0_${x}_${y}.png` });
    }
  }
  return result;
}

/** Adapt the immutable research bundle without rewriting its placements or IDs. */
export function normalizeCachePins(dataset, provenance, terrainManifest) {
  if (dataset?.schemaVersion !== 1 || dataset.exportType !== 'cache-diagnostic' || dataset.mapId !== 28
    || dataset.plane !== 0 || !Array.isArray(dataset.pins) || provenance?.schemaVersion !== 1
    || provenance.published?.pins?.path !== CACHE_PIN_PATH || !terrainManifest?.terrain) {
    throw new Error('Invalid cache surface pin bundle.');
  }
  const frames = new Map();
  for (const sprite of provenance.published?.sprites?.sprites ?? []) {
    const frame = sprite.frames?.find(frame => frame.index === 0);
    if (frame?.asset && frame.asset.path === `${CACHE_PIN_SPRITE_DIRECTORY}/${sprite.spriteId}-0.png`
      && [frame.width, frame.height, frame.fullwidth, frame.fullheight].every(value => Number.isInteger(value) && value > 0)
      && [frame.x, frame.y].every(value => Number.isInteger(value) && value >= 0)) {
      frames.set(sprite.spriteId, { ...frame, icon: `/assets/map/${frame.asset.path}` });
    }
  }
  const seen = new Set();
  const pins = dataset.pins.map(pin => {
    const chunkId = chunkIdForGame(pin.x, pin.y);
    if (typeof pin.id !== 'string' || seen.has(pin.id) || pin.mapId !== 28 || pin.plane !== 0 || !chunkId
      || !(pin.spriteId === null || Number.isInteger(pin.spriteId))) throw new Error('Invalid cache pin placement.');
    seen.add(pin.id);
    const category = categoryForCachePin(pin), world = gameToWorld(pin.x, pin.y), frame = frames.get(pin.spriteId);
    if (Number.isInteger(pin.spriteId) && !frame) throw new Error(`Missing cache sprite frame: ${pin.spriteId}`);
    return { ...pin, categoryId: category.id, chunkId, worldX: world.x, worldY: world.y,
      label: plainLabel(pin.label) || plainLabel(pin.objectName) || category.label,
      labelOrigin: pin.label ? pin.labelOrigin : pin.objectName ? 'cache-object-name' : 'category',
      textOnly: pin.spriteId === null, ...(frame ? { icon: frame.icon, iconFrame: frame } : {}),
      surfaceEvidence: 'decoded-surface-paste' };
  });
  const categories = MAP_PIN_CATEGORIES.map(category => {
    const current = pins.find(pin => pin.categoryId === category.id && pin.icon);
    return { ...category, ...(current ? { icon: current.icon } : {}) };
  });
  const snapshotDate = provenance.generatedAt?.slice(0, 10);
  return { dataset: { ...dataset, pins, snapshotDate, sourceKind: 'copied-cache',
    normalization: { policy: 'Exact surface pastes and retained conditional records; no water-only exclusions.',
      rawPins: dataset.pins.length, retainedPins: pins.length, waterExclusions: 0 } },
  manifest: { ...terrainManifest, categories, cachePinProvenance: provenance,
    pins: { ...provenance.published.pins, snapshotDate, sourceKind: 'copied-cache', count: pins.length,
      manifestPath: CACHE_PIN_MANIFEST_PATH },
    limitations: [...(terrainManifest.limitations ?? []), ...(dataset.limits ?? [])] } };
}

function plainLabel(text) {
  return typeof text === 'string' ? text.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1').trim() : '';
}

/** Surface coverage is supporting evidence, not a decoded map ID or access rule.
 * Untagged placements need downloaded map-28/plane-0 terrain at their coordinates.
 * Explicit destinations take precedence over source coordinates/maps/floors.
 */
export function normalizePins(records, { labels = [], labelLocations = [], terrainTiles = [] } = {}) {
  const definitions = new Map(labels.map(label => [label.id, label]));
  const coverage = new Map(terrainTiles.map(tile => [`${tile.x}:${tile.y}`, tile.status]));
  const explicitLabels = new Map();
  for (const row of labelLocations) {
    const text = plainLabel(definitions.get(row.labelId)?.text);
    if (text && row.location) {
      const key = `${row.location.mapId ?? ''}:${row.location.plane}:${row.location.x}:${row.location.y}`;
      explicitLabels.set(key, [...new Set([...(explicitLabels.get(key) ?? []), text])]);
    }
  }
  const occurrences = new Map();
  const visible = new Map();
  const pins = [];
  const exclusions = [];
  let previousEligiblePins = 0;
  const previousEligibleExclusionsByReason = {};
  records.forEach((row, sourceIndex) => {
    const point = row.maplink ?? row;
    const spriteId = row.iconData?.icon?.iconSprite;
    const chunkId = chunkIdForGame(point.x, point.y);
    const previouslyEligible = point.plane === 0 && (point.mapId === undefined || point.mapId === 28)
      && chunkId !== null && Number.isInteger(spriteId);
    if (previouslyEligible) previousEligiblePins++;
    // Count identities before filtering so IDs do not depend on coverage/deduplication.
    const identity = `${row.type}:${row.x}:${row.y}:${row.plane}:${spriteId}:${row.labelId ?? ''}`;
    const ordinal = occurrences.get(identity) ?? 0;
    occurrences.set(identity, ordinal + 1);
    const id = `mejrs:${identity}:${ordinal}`;
    const conditions = { properties: row.iconData?.properties, icon: row.iconData?.icon, legacyIcon: row.iconData?.legacyIcon };
    const source = { url: `https://raw.githubusercontent.com/mejrs/data_rs3/${PIN_COMMIT}/original_sprite_locations.json`, commit: PIN_COMMIT,
      index: sourceIndex, type: row.type, x: row.x, y: row.y, plane: row.plane, mapId: row.mapId ?? null, labelId: row.labelId ?? null,
      maplink: row.maplink ?? null,
      transform: row.maplink ? 'explicit-maplink' : row.mapId === 28 ? 'explicit-surface' : 'untransformed-map-unresolved' };
    const coverageStatus = coverage.get(`${Math.floor(point.x / 64)}:${Math.floor(point.y / 64)}`) ?? 'unrecorded';
    const exclude = (reason, details = {}) => {
      exclusions.push({ id, reason, previouslyEligible, x: point.x, y: point.y, plane: point.plane,
        mapId: point.mapId ?? null, spriteId: spriteId ?? null,
        label: plainLabel(row.tooltip ?? row.iconData?.icon?.tooltip ?? row.iconData?.properties?.tooltip)
          || plainLabel(definitions.get(row.labelId)?.text) || categoryForSprite(spriteId).label,
        source, conditions, ...details });
      if (previouslyEligible) previousEligibleExclusionsByReason[reason] = (previousEligibleExclusionsByReason[reason] ?? 0) + 1;
    };
    if (point.mapId !== undefined && point.mapId !== 28) return exclude('non-surface-map');
    if (point.plane !== 0) return exclude('non-surface-plane');
    if (!chunkId) return exclude('outside-crop');
    if (!Number.isInteger(spriteId)) return exclude('missing-sprite');
    // A partial maplink is not permission to guess its destination map from coverage.
    if (point.mapId === undefined && (row.maplink || coverageStatus !== 'downloaded')) {
      return exclude('surface-unverified', { coverageStatus, evidence: row.maplink ? 'maplink-missing-map-id' : 'no-downloaded-surface-terrain' });
    }
    if (!row.maplink && row.mapId === undefined) source.transform = 'untransformed-terrain-supported-surface';
    const category = categoryForSprite(spriteId);
    const world = gameToWorld(point.x, point.y);
    const tooltip = plainLabel(row.tooltip ?? row.iconData?.icon?.tooltip ?? row.iconData?.properties?.tooltip);
    const definitionLabel = plainLabel(definitions.get(row.labelId)?.text);
    const coordinateLabels = explicitLabels.get(`${row.mapId ?? ''}:${row.plane}:${row.x}:${row.y}`) ?? [];
    const coordinateLabel = coordinateLabels.length === 1 ? coordinateLabels[0] : '';
    const label = tooltip || definitionLabel || coordinateLabel || category.label;
    const labelOrigin = tooltip ? 'source-tooltip' : definitionLabel ? 'label-definition'
      : coordinateLabel ? 'coordinate-label-provisional' : 'category';
    const variant = { id, label, labelOrigin, source, conditions, backgroundSpriteId: row.iconData?.icon?.iconBackgroundSprite ?? null };
    const placementKey = `28:0:${point.x}:${point.y}:${spriteId}`;
    const existing = visible.get(placementKey);
    if (existing) {
      existing.variants ??= [{ id: existing.id, label: existing.label, labelOrigin: existing.labelOrigin,
        source: existing.source, conditions: existing.conditions, backgroundSpriteId: existing.backgroundSpriteId }];
      existing.variants.push(variant);
      return exclude('duplicate-current-sprite', { retainedPinId: existing.id });
    }
    const pin = { id, x: point.x, y: point.y, plane: 0, mapId: 28, spriteId,
      backgroundSpriteId: variant.backgroundSpriteId, categoryId: category.id,
      label, labelOrigin, ...(coordinateLabels.length > 1 ? { labelCandidates: coordinateLabels } : {}), chunkId, worldX: world.x, worldY: world.y, conditions, source,
      surfaceEvidence: point.mapId === 28 ? 'explicit-map-id' : 'downloaded-terrain-coverage',
    };
    visible.set(placementKey, pin);
    pins.push(pin);
  });
  const exclusionsByReason = {};
  for (const row of exclusions) exclusionsByReason[row.reason] = (exclusionsByReason[row.reason] ?? 0) + 1;
  return { schemaVersion: 1, normalizationVersion: 2, snapshotDate: PIN_SNAPSHOT_DATE, pins, exclusions,
    normalization: { rawPins: records.length, retainedPins: pins.length, excludedPins: exclusions.length, exclusionsByReason,
      previousEligiblePins, previousEligibleExclusionsByReason,
      policy: 'Explicit surface destinations or downloaded surface terrain coverage; one marker per coordinate/current sprite, with variants preserved. Coverage does not establish decoded map identity or conditional visibility.' } };
}
