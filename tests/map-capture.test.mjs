import test from 'node:test';
import assert from 'node:assert/strict';
import { mapImageGeometry, renderMapImage, MAX_MAP_IMAGE_SIDE, MAP_CAPTURE_PANEL } from '../app/web/map-capture.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const worldWidth = SURFACE_GRID.columns * 128, worldHeight = SURFACE_GRID.rows * 128;

class CaptureMap {
  constructor() {
    this.width = 700; this.height = 540; this.zoom = 1.2; this.dpr = 2;
    this.offset = { x: -100, y: -80 };
    this.model = { preferences: { theme: 'dark' }, state: { revision: 7 } };
    this.markerImages = new Map();
    this.imageStatus = 'ready'; this.image = { complete: true, naturalWidth: worldWidth };
    this.calls = []; this.unlocked = new Set([String(SURFACE_GRID.startId)]);
  }
  visibleBounds() {
    return { left: -this.offset.x / this.zoom, top: -this.offset.y / this.zoom,
      right: (this.width - this.offset.x) / this.zoom, bottom: (this.height - this.offset.y) / this.zoom };
  }
  record(kind) {
    this.calls.push({ kind, facade: this, width: this.width, height: this.height, offset: { ...this.offset } });
    assert.equal(this.dpr, 1);
  }
  drawBase() { this.record('base'); }
  drawState() { this.record('state'); }
  drawPins() { this.record('pins'); }
  drawConnectionLines() { this.record('connections'); }
  drawSectionHighlight() { this.record('section'); }
  drawOpenChunk() { this.record('open'); }
  drawHover() { this.drawConnectionLines(); this.drawSectionHighlight(); this.drawOpenChunk(); }
}

function canvases({ encodeFailure = false } = {}) {
  const allocated = [], draws = [];
  const factory = (width, height) => {
    const context = { setTransform() {}, drawImage: (...args) => draws.push(args) };
    const canvas = { width, height, initialWidth: width, initialHeight: height,
      getContext: () => context,
      toBlob(callback, type) { assert.equal(type, 'image/png'); callback(encodeFailure ? null : new Blob(['png'], { type })); } };
    allocated.push(canvas); return canvas;
  };
  return { allocated, draws, factory };
}

function assertReleased(allocated) {
  assert.ok(allocated.length > 0);
  for (const canvas of allocated) assert.deepEqual([canvas.width, canvas.height], [0, 0]);
}

test('full geometry keeps the surface aspect ratio within the raster budget and ignores device density', () => {
  const map = new CaptureMap();
  const geometry = mapImageGeometry(map);
  const scale = Math.min(1, MAX_MAP_IMAGE_SIDE / Math.max(worldWidth, worldHeight));
  assert.equal(geometry.height, Math.floor(worldHeight * scale));
  assert.equal(geometry.width, Math.floor(worldWidth * scale));
  assert.deepEqual(geometry.offset, { x: 0, y: 0 });
  assert.equal(geometry.zoom, scale);
  map.dpr = 4;
  assert.deepEqual(mapImageGeometry(map), geometry);
});

test('visible geometry scales the viewport and its transform together', () => {
  const map = new CaptureMap(); map.width = 8192; map.height = 2048;
  assert.deepEqual(mapImageGeometry(map, 'visible'), {
    width: 4096, height: 1024, zoom: .6, offset: { x: -50, y: -40 },
  });
  assert.throws(() => mapImageGeometry(map, 'unknown'), /Unknown map image area/);
  assert.throws(() => mapImageGeometry({}), /Wait for the map/);
});

test('capture composites bounded panels in order and preserves the live map on success', async () => {
  const map = new CaptureMap(), original = { offset: map.offset, model: map.model, markerImages: map.markerImages };
  const canvas = canvases(), progress = [];
  const result = await renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory, onProgress: value => progress.push(value) });
  assert.equal(result.blob.type, 'image/png');
  assert.deepEqual([result.width, result.height], [700, 540]);
  assert.deepEqual(canvas.allocated.map(item => [item.initialWidth, item.initialHeight]), [[700, 540], [MAP_CAPTURE_PANEL, MAP_CAPTURE_PANEL], [MAP_CAPTURE_PANEL, MAP_CAPTURE_PANEL]]);
  assert.deepEqual(map.calls.map(call => call.kind), ['base', 'state', 'base', 'state', 'base', 'state', 'base', 'state', 'connections', 'section', 'open']);
  assert.deepEqual(map.calls.filter(call => call.kind === 'base').map(({ width, height, offset }) => ({ width, height, offset })), [
    { width: 512, height: 512, offset: { x: -100, y: -80 } },
    { width: 188, height: 512, offset: { x: -612, y: -80 } },
    { width: 512, height: 28, offset: { x: -100, y: -592 } },
    { width: 188, height: 28, offset: { x: -612, y: -592 } },
  ]);
  assert.equal(canvas.draws.length, 8);
  assert.deepEqual(progress, [.25, .5, .75, 1]);
  for (const call of map.calls) {
    assert.notEqual(call.facade, map);
    assert.notEqual(call.facade.model, original.model);
    assert.notEqual(call.facade.model.preferences, original.model.preferences);
  }
  assert.equal(map.offset, original.offset); assert.equal(map.model, original.model);
  assert.equal(map.markerImages, original.markerImages);
  assert.deepEqual([map.width, map.height, map.zoom, map.dpr], [700, 540, 1.2, 2]);
  assert.equal(map.model.state.revision, 7);
  assertReleased(canvas.allocated);
});

test('abort between panels stops rendering and releases capture resources', async () => {
  const map = new CaptureMap(), canvas = canvases(), abort = new AbortController();
  await assert.rejects(renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory,
    signal: abort.signal, onProgress: () => abort.abort() }), { name: 'AbortError' });
  assert.deepEqual(map.calls.map(call => call.kind), ['base', 'state']);
  assert.deepEqual(map.offset, { x: -100, y: -80 });
  assertReleased(canvas.allocated);
});

test('a pre-aborted request allocates no raster', async () => {
  const canvas = canvases(), abort = new AbortController(); abort.abort();
  await assert.rejects(renderMapImage(new CaptureMap(), { signal: abort.signal, canvasFactory: canvas.factory }), { name: 'AbortError' });
  assert.equal(canvas.allocated.length, 0);
});

test('PNG encoding failure releases canvases and leaves the live map usable', async () => {
  const map = new CaptureMap(), canvas = canvases({ encodeFailure: true });
  await assert.rejects(renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory }), /Could not create the PNG/);
  assertReleased(canvas.allocated);
  assert.equal(map.imageStatus, 'ready'); assert.equal(map.zoom, 1.2);
});

test('terrain waits for publication, reports missing tiles, and disposes its private renderer', async () => {
  const map = new CaptureMap(), canvas = canvases(); map.width = map.height = 100;
  map.mapAssetManifest = { id: 'fixture' }; map.terrain = { modernBase: true, live: true };
  const originalTerrain = map.terrain;
  let disposed = 0, ready = false, options, view;
  const terrain = { unpublishedKeys: new Set(['one']), pageQueue: new Set(), previewQueue: new Set(),
    pageWorkScheduled: false, visibleKeys: new Set(['one']), failed: new Set(['one']),
    previews: new Map(), committedKeys: new Set(),
    viewLoaded: () => ready,
    setView(bounds, zoom, dpr) {
      view = { bounds, zoom, dpr };
      setTimeout(() => { ready = true; }, 1);
      setTimeout(() => terrain.unpublishedKeys.clear(), 10);
    },
    paintLegacyRegion() {}, dispose() { disposed++; },
  };
  const originalBase = map.drawBase;
  map.drawBase = function () { assert.equal(ready, true); assert.equal(terrain.unpublishedKeys.size, 0); originalBase.call(this); };
  const result = await renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory,
    terrainFactory(manifest, value) { assert.equal(manifest, map.mapAssetManifest); options = value; return terrain; } });
  assert.equal(result.missingTiles, true);
  assert.equal(options.cacheLimit, 64); assert.equal(options.concurrency, 3);
  assert.equal(options.canvasFactory(3000, 3200), null);
  assert.equal(view.dpr, 1); assert.ok(view.zoom > .75);
  assert.equal(map.terrain, originalTerrain); assert.equal(disposed, 1);
  assertReleased(canvas.allocated);
});

test('cancelling while private terrain is loading disposes it without painting a partial map', async () => {
  const map = new CaptureMap(), canvas = canvases(), abort = new AbortController();
  map.mapAssetManifest = { id: 'fixture' }; map.terrain = { modernBase: true };
  let disposed = 0;
  const terrain = {
    setView() { abort.abort(); }, viewLoaded: () => false,
    paintLegacyRegion() {}, dispose() { disposed++; },
  };
  await assert.rejects(renderMapImage(map, { area: 'visible', signal: abort.signal,
    canvasFactory: canvas.factory, terrainFactory: () => terrain }), { name: 'AbortError' });
  assert.equal(disposed, 1);
  assert.equal(map.calls.length, 0);
  assertReleased(canvas.allocated);
});

test('live map and marker refreshes cannot change an image between panels', async () => {
  const map = new CaptureMap(), canvas = canvases();
  map.cells = new Map([['12342', { x: 19, y: 17 }]]);
  map.deathMarkers = new Map([['12342', { hours: 50 }]]);
  map.drawState = function () {
    assert.ok(this.cells.has('12342')); assert.ok(this.deathMarkers.has('12342'));
    assert.equal(this.model.preferences.theme, 'dark'); this.record('state');
  };
  await renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory, onProgress() {
    map.cells.clear(); map.deathMarkers.clear(); map.model.preferences.theme = 'light';
  } });
  assert.equal(map.calls.filter(call => call.kind === 'state').length, 4);
  assertReleased(canvas.allocated);
});

test('cancelling stalled sticker decoding does not allocate the output canvas', async () => {
  const map = new CaptureMap(), canvas = canvases(), abort = new AbortController();
  map.markerImages.set('mining', { image: { complete: true, naturalWidth: 24, decode: () => new Promise(() => {}) } });
  const timer = setTimeout(() => abort.abort(), 60);
  try {
    await assert.rejects(renderMapImage(map, { signal: abort.signal, canvasFactory: canvas.factory }), { name: 'AbortError' });
    assert.equal(canvas.allocated.length, 0);
  } finally { clearTimeout(timer); }
});

test('cancelling stalled PNG encoding releases raster canvases', async () => {
  const map = new CaptureMap(), canvas = canvases(), abort = new AbortController();
  map.width = map.height = 100;
  const factory = (w, h) => {
    const item = canvas.factory(w, h);
    item.toBlob = () => { setTimeout(() => abort.abort(), 5); };
    return item;
  };
  await assert.rejects(renderMapImage(map, { area: 'visible', signal: abort.signal, canvasFactory: factory }), { name: 'AbortError' });
  assertReleased(canvas.allocated);
});

test('preview pruning retains cached native tiles so subsequent panels can settle', async () => {
  const map = new CaptureMap(), canvas = canvases(); map.width = 700; map.height = 100;
  map.mapAssetManifest = {}; map.terrain = { modernBase: true };
  const cached = { width: 64, height: 64 }, stale = { width: 64, height: 64 };
  const terrain = { previews: new Map([['cached', cached], ['stale', stale]]), images: new Map([['cached', {}]]),
    committedKeys: new Set(['cached', 'stale']), visibleKeys: new Set(), failed: new Set(), unpublishedKeys: new Set(),
    pageQueue: new Set(), previewQueue: new Set(), viewLoaded: () => true, dispose() {}, paintLegacyRegion() {},
    setView() { assert.ok(this.previews.has('cached')); },
  };
  await renderMapImage(map, { area: 'visible', canvasFactory: canvas.factory, terrainFactory: () => terrain });
  assert.equal(terrain.previews.has('stale'), false);
  assert.deepEqual([stale.width, stale.height], [0, 0]);
  assert.deepEqual([cached.width, cached.height], [0, 0]);
  assertReleased(canvas.allocated);
});
