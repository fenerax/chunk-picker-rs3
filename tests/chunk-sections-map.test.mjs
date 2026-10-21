import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTerrain } from '../app/web/map-terrain.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const regionX = Math.floor(SURFACE_GRID.startId / SURFACE_GRID.stride);
const regionY = SURFACE_GRID.startId % SURFACE_GRID.stride;
const chunkId = x => String(SURFACE_GRID.startId + x * SURFACE_GRID.stride);
const tileKey = x => `${regionX + x},${regionY}`;
const tilePath = x => `terrain/28/2/0_${regionX + x}_${regionY}.png`;
const fallbackImage = { naturalWidth: SURFACE_GRID.columns * 128, naturalHeight: SURFACE_GRID.rows * 128 };

const canvas = (width, height) => {
  const calls = [], fills = [], context = { clearRect() {}, drawImage: (...args) => calls.push(args),
    fillRect(...args) { fills.push({ color: this.fillStyle, args }); } };
  return { width, height, calls, fills, getContext: () => context };
};
const manifest = () => ({ terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [
  { x: regionX + 0, y: regionY, status: 'downloaded', path: tilePath(0) },
  { x: regionX + 1, y: regionY, status: 'downloaded', path: tilePath(1) },
] } });
function fixture(t, options = {}) {
  const images = [], terrain = new MapTerrain(manifest(), {
    fallbackImage: fallbackImage, canvasFactory: canvas,
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    ...options,
  });
  t.after(() => terrain.dispose()); return { terrain, images };
}

test('offscreen chunk crop shares accepted native terrain without replacing the main viewport', t => {
  const { terrain, images } = fixture(t);
  terrain.setView({ left: 128, top: 0, right: 256, bottom: 128 }, 0.5);
  const visible = [...terrain.visibleKeys], native = [...terrain.nativeKeys]; let redraws = 0;
  const unsubscribe = terrain.subscribeChunk(chunkId(0), () => redraws++);
  const image = images.find(row => row.src.endsWith(tilePath(0))); image.onload();
  assert.equal(redraws, 1, 'The panel repaints while a main-map tile is still pending');
  assert.deepEqual([...terrain.visibleKeys], visible); assert.deepEqual([...terrain.nativeKeys], native);
  const target = canvas(256, 256);
  assert.equal(terrain.drawChunk(target.getContext('2d'), chunkId(0)), true);
  assert.deepEqual(target.calls.at(-1), [image, 0, 0, 256, 256]);
  const before = images.length; unsubscribe();
  const again = terrain.subscribeChunk(chunkId(0), () => redraws++);
  assert.equal(images.length, before, 'Reopening uses the decoded image'); again();
  assert.equal(terrain.chunkListeners.size, 0);
});

test('panning retains queued panel demand and unsubscribe prevents late callbacks', t => {
  const { terrain, images } = fixture(t, { concurrency: 1 });
  terrain.setView({ left: 128, top: 0, right: 256, bottom: 128 }, 0.5);
  let redraws = 0; const unsubscribe = terrain.subscribeChunk(chunkId(0), () => redraws++);
  assert.ok(terrain.queue.has(tileKey(0)));
  terrain.setView({ left: 128, top: 0, right: 256, bottom: 128 }, 0.5);
  assert.ok(terrain.queue.has(tileKey(0)));
  images[0].onload(); assert.equal(images[1].src, `/assets/map/${tilePath(0)}`);
  unsubscribe(); images[1].onload(); assert.equal(redraws, 0);
  assert.equal(terrain.chunkListeners.size, 0);
});

test('an offscreen panel cannot evict native tiles needed to publish a full-budget viewport', t => {
  const data = manifest(); data.terrain.tiles.push({ x: regionX + 2, y: regionY, status: 'downloaded', path: tilePath(2) });
  const images = [], frames = new Map(); let nextFrame = 0;
  const terrain = new MapTerrain(data, { cacheLimit: 2, canvasFactory: canvas,
    fallbackImage: fallbackImage,
    imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    requestFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelFrame: id => frames.delete(id),
  });
  t.after(() => terrain.dispose()); terrain.setView({ left: 0, top: 0, right: 256, bottom: 128 }, 1);
  terrain.subscribeChunk(chunkId(2), () => {});
  for (const x of [0, 2, 1]) images.find(image => image.src.endsWith(tilePath(x))).onload();
  for (let i = 0; frames.size; i++) {
    assert.ok(i < 20, 'Terrain publication must settle');
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  }
  assert.deepEqual(new Set(terrain.images.keys()), new Set([tileKey(0), tileKey(1)]));
  assert.deepEqual([...terrain.chunkImages.keys()], [tileKey(2)]);
  assert.equal(terrain.pages.size, 1); assert.equal(terrain.stagedPages.size, 0);
  assert.equal(terrain.unreadyNative.size, 0);
});

test('chunk crop preserves transparent-water underlay and community-to-cache fallback', t => {
  const data = manifest(); data.terrain.tiles = [data.terrain.tiles[0]];
  data.cacheTerrain = { mapId: 28, plane: 0, zoom: 2, iconFree: true,
    directory: 'terrain.cache-section-test-v1/28/2', layoutComplete: true, transparentWater: true,
    oceanColour: [96, 118, 154], tiles: [{ x: regionX + 0, y: regionY, status: 'rendered', path: `terrain.cache-section-test-v1/28/2/0_${regionX}_${regionY}.png` }] };
  const images = [], black = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const terrain = new MapTerrain(data, { imageFactory: () => { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    canvasFactory: (w, h) => { const c = canvas(w, h); c.getContext().getImageData = () => ({ data: black }); return c; } });
  t.after(() => terrain.dispose()); terrain.subscribeChunk(chunkId(0), () => {});
  images[0].onload(); assert.equal(images.length, 2); assert.match(images[1].src, /terrain\.cache-section/);
  images[1].onload(); const target = canvas(256, 256); terrain.drawChunk(target.getContext('2d'), chunkId(0));
  assert.deepEqual(target.fills, [{ color: 'rgb(96,118,154)', args: [0, 0, 256, 256] }]);
  assert.equal(target.calls.at(-1)[0], images[1]);
});

test('main-map section outline projects north-up tile edges and changes only the hover layer', () => {
  const map = Object.create(ChunkMap.prototype); map.dirty = { base: false, state: false, hover: false };
  map.schedule = () => {}; map.offset = { x: 10, y: 20 }; map.zoom = 2;
  const bytes = Buffer.alloc(512); bytes[0] = 1;
  map.setSectionHighlight(chunkId(0), { mask: { encoding: 'base64-bitset-lsb0-y64+x', data: bytes.toString('base64') }, color: '#0072b2' });
  assert.deepEqual(map.dirty, { base: false, state: false, hover: true });
  const points = [], strokes = []; let saves = 0, restores = 0;
  const context = { save() { saves++; }, restore() { restores++; }, beginPath() {}, moveTo: (...p) => points.push(p), lineTo: (...p) => points.push(p), stroke() { strokes.push([this.strokeStyle, this.lineWidth]); } };
  map.drawSectionHighlight(context);
  assert.deepEqual(new Set(points.map(p => p.join(','))), new Set(['10,276', '14,276', '10,272', '14,272']));
  assert.deepEqual(strokes, [['#15202bcc', 3], ['#0072b2', 1.5]]); assert.equal(saves, restores);
  map.setSectionHighlight(chunkId(0), { mask: null }); assert.equal(map.sectionHighlight, null);
});

test('selecting or closing a chunk clears its section outline without changing connections', () => {
  const map = Object.create(ChunkMap.prototype); map.dirty = {}; map.schedule = () => {};
  map.sectionHighlight = { chunkId: chunkId(0), segments: [] }; map.mapInformation = { connections: { connections: [] } };
  const eligibility = { byChunk: {} }; map.connections = eligibility;
  map.setConnectionChunk(chunkId(0)); assert.equal(map.sectionHighlight, null);
  map.sectionHighlight = { chunkId: chunkId(0), segments: [] }; map.setConnectionChunk(null);
  assert.equal(map.sectionHighlight, null); assert.equal(map.connections, eligibility);
});

test('terrain source replacement rebinds an open panel and its cleanup targets the new source', t => {
  const map = Object.create(ChunkMap.prototype); map.chunkTerrainListeners = new Map();
  map.dirty = { base: false, state: false, pins: false, hover: false }; map.schedule = () => {};
  map.stage = { dataset: {} }; map.imageStatus = 'error'; map.invalidate = () => {};
  let redraws = 0, unsubscribes = 0;
  map.terrain = { subscribeChunk: () => () => unsubscribes++, dispose() {} };
  const unsubscribe = map.subscribeChunkTerrain(chunkId(0), () => redraws++);
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [] } }, null);
  t.after(() => map.terrain.dispose());
  assert.equal(unsubscribes, 1); assert.equal(redraws, 1);
  assert.equal(map.terrain.chunkListeners.get(tileKey(0)).size, 1);
  unsubscribe(); assert.equal(map.terrain.chunkListeners.size, 0); assert.equal(map.chunkTerrainListeners.size, 0);
});
