import { SURFACE_GRID } from '../data/surface-grid.mjs';
import { MapTerrain } from './map-terrain.mjs';
import { MapPinRenderer } from './map-pin-renderer.mjs';
import { loadStickerFont } from './map-tools.mjs';

export const MAX_MAP_IMAGE_SIDE = 4096;
export const MAP_CAPTURE_PANEL = 512;
const WORLD_WIDTH = SURFACE_GRID.columns * 128, WORLD_HEIGHT = SURFACE_GRID.rows * 128;
const canvasDefault = (width, height) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
};
const aborted = signal => { if (signal?.aborted) throw new DOMException('Image download cancelled.', 'AbortError'); };

export function mapImageGeometry(map, area = 'full') {
  if (!map?.model) throw new Error('Wait for the map to load, then try again.');
  if (!['full', 'visible'].includes(area)) throw new TypeError('Unknown map image area.');
  const width = area === 'full' ? WORLD_WIDTH : map.width;
  const height = area === 'full' ? WORLD_HEIGHT : map.height;
  const scale = Math.min(1, MAX_MAP_IMAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)),
    zoom: area === 'full' ? scale : map.zoom * scale,
    offset: area === 'full' ? { x: 0, y: 0 } : { x: map.offset.x * scale, y: map.offset.y * scale } };
}

async function waitUntil(ready, signal, message) {
  const deadline = Date.now() + 30000;
  while (!ready()) {
    aborted(signal);
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  aborted(signal);
}

async function imageReady(image, signal) {
  await waitUntil(() => image.complete, signal, 'Map artwork is taking too long to load. Try again.');
  if (image.naturalWidth && image.decode) await settle(image.decode().catch(() => {}), signal);
  aborted(signal);
}

async function settle(promise, signal) {
  let done = false;
  promise.finally(() => { done = true; }).catch(() => {});
  await waitUntil(() => done, signal, 'Map artwork is taking too long to load. Try again.');
  return promise;
}

/** Reuse the live painters on an independent facade, never changing its viewport or caches.
 * One <=4096² output plus two 512² panels; no full-world terrain mip or pin canvas.
 */
export async function renderMapImage(map, { area = 'full', signal, onProgress = () => {},
  canvasFactory = canvasDefault, terrainFactory = (manifest, options) => new MapTerrain(manifest, options) } = {}) {
  const geometry = mapImageGeometry(map, area);
  let output, base, layer, terrain, pins;
  try {
    aborted(signal);
    await waitUntil(() => map.imageStatus !== 'loading', signal, 'Map artwork is still loading. Try again shortly.');
    const capture = Object.assign(Object.create(Object.getPrototypeOf(map)), map, geometry, {
      dpr: 1, model: { ...map.model, preferences: { ...map.model.preferences } },
      cells: new Map(map.cells), deathMarkers: new Map(map.deathMarkers),
      markerImages: new Map(map.markerImages), disposed: false,
      invalidate() {}, schedule() {},
    });
    const sourcePins = capture.pins, pinFilters = sourcePins ? { ...sourcePins.filters,
      categoryIds: [...sourcePins.filters.categoryIds], hiddenPinIds: [...sourcePins.filters.hiddenPinIds] } : null;
    await settle(loadStickerFont(), signal);
    await Promise.all([...capture.markerImages.values()].map(entry => imageReady(entry.image, signal)));
    if (!capture.terrain?.modernBase && capture.imageStatus !== 'ready') throw new Error('Map artwork could not load. Reload the picker and try again.');
    output = canvasFactory(geometry.width, geometry.height);
    base = canvasFactory(MAP_CAPTURE_PANEL, MAP_CAPTURE_PANEL);
    layer = canvasFactory(MAP_CAPTURE_PANEL, MAP_CAPTURE_PANEL);
    const context = output.getContext('2d'), baseContext = base.getContext('2d'), layerContext = layer.getContext('2d');
    if (!context || !baseContext || !layerContext) throw new Error('Your browser cannot create this map image. Try the visible area.');
    if (capture.mapAssetManifest) {
      terrain = terrainFactory(capture.mapAssetManifest, { cacheLimit: 64, concurrency: 3,
        fallbackImage: capture.imageStatus === 'ready' ? capture.image : null,
        canvasFactory: (w, h) => w <= 256 && h <= 256 ? canvasFactory(w, h) : null });
      // No composed pages are allocated; include all panel tiles at native detail.
      terrain.pageLimit = 16;
      capture.terrain = terrain;
      // The modern ocean base is complete even in panels without land tiles.
      if (terrain.baseReady) capture.imageStatus = 'ready';
      capture.drawLegacyTerrain = (ctx, left, top, right, bottom) => terrain.paintLegacyRegion(ctx,
        left, top, right - left, bottom - top, capture.offset.x + left * capture.zoom,
        capture.offset.y + top * capture.zoom, (right - left) * capture.zoom, (bottom - top) * capture.zoom);
    } else capture.terrain = null;
    if (sourcePins) {
      pins = new MapPinRenderer({ categories: [...sourcePins.categories.values()] }, { pins: [...sourcePins.pins.values()] }, { canvasFactory: () => null });
      pins.setFilters(pinFilters);
      pins.focused = sourcePins.focused;
    }
    capture.pins = pins;
    const total = Math.ceil(geometry.width / MAP_CAPTURE_PANEL) * Math.ceil(geometry.height / MAP_CAPTURE_PANEL);
    let finished = 0, missingTiles = false;
    for (let y = 0; y < geometry.height; y += MAP_CAPTURE_PANEL) for (let x = 0; x < geometry.width; x += MAP_CAPTURE_PANEL) {
      aborted(signal);
      capture.width = Math.min(MAP_CAPTURE_PANEL, geometry.width - x);
      capture.height = Math.min(MAP_CAPTURE_PANEL, geometry.height - y);
      capture.offset = { x: geometry.offset.x - x, y: geometry.offset.y - y };
      capture.contexts = [baseContext, layerContext];
      if (terrain) {
        terrain.setView(capture.visibleBounds(), Math.max(.751, geometry.zoom), 1);
        await waitUntil(() => terrain.viewLoaded() && !terrain.unpublishedKeys.size
          && !terrain.pageWorkScheduled && !terrain.pageQueue.size && !terrain.previewQueue.size,
        signal, 'Map tiles are taking too long to load. Try again or choose the visible area.');
        missingTiles ||= [...terrain.visibleKeys].some(key => terrain.failed.has(key));
      }
      capture.drawBase(); capture.drawState();
      context.drawImage(base, 0, 0, capture.width, capture.height, x, y, capture.width, capture.height);
      context.drawImage(layer, 0, 0, capture.width, capture.height, x, y, capture.width, capture.height);
      if (terrain) for (const [key, preview] of terrain.previews) if (!terrain.visibleKeys.has(key) && !terrain.images?.has(key)) {
        preview.width = preview.height = 0; terrain.previews.delete(key); terrain.committedKeys.delete(key);
      }
      onProgress(++finished / total);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    Object.assign(capture, geometry);
    capture.pinContext = context;
    capture.contexts[2] = context;
    capture.clear = ctx => ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (pins) {
      pins.paint(layerContext, { ...geometry, unlocked: capture.unlocked });
      await Promise.all([...pins.images.values()].map(entry => imageReady(entry.image, signal)));
      capture.drawPins();
    }
    capture.hoverId = null;
    capture.drawHover();
    aborted(signal);
    const blob = await settle(new Promise((resolve, reject) => output.toBlob(value => value ? resolve(value)
      : reject(new Error('Could not create the PNG. Try downloading the visible area.')), 'image/png')), signal);
    aborted(signal);
    return { blob, width: geometry.width, height: geometry.height, missingTiles };
  } finally {
    for (const entry of pins?.images.values() ?? []) if (!entry.ready) entry.image.removeAttribute?.('src');
    for (const canvas of [...(terrain?.previews?.values() ?? []), ...(terrain?.lockedImages?.values() ?? [])]) canvas.width = canvas.height = 0;
    terrain?.dispose(); pins?.dispose();
    for (const canvas of [output, base, layer]) if (canvas) canvas.width = canvas.height = 0;
  }
}
