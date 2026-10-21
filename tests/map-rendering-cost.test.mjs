import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkMap } from '../app/web/map.mjs';
import { MapTerrain } from '../app/web/map-terrain.mjs';
import { MapPinRenderer } from '../app/web/map-pin-renderer.mjs';

const context = () => {
  const calls = [];
  return new Proxy({ calls, drawImage(...args) { calls.push(['image', ...args]); },
    clip(...args) { calls.push(['clip', ...args]); } }, { get: (target, key) => target[key] ?? (() => {}) });
};
const canvasFactory = (width, height) => { const ctx = context(); return { width, height, getContext: () => ctx }; };

test('full crop with 2350 revealed chunks bounds overview terrain and cached pins through zoom 0.75, including DPR 2', () => {
  const cells = new Map(), tiles = [], pinRows = [];
  for (let x = 0; x < 47; x++) for (let y = 0; y < 50; y++) {
    const id = String(7495 + x * 256 - y); cells.set(id, { x, y });
    tiles.push({ x: 29 + x, y: 71 - y, path: `terrain/28/2/0_${29 + x}_${71 - y}.png`, status: 'downloaded' });
    pinRows.push({ id, worldX: x * 128 + 1, worldY: y * 128 + 1, categoryId: 'bank', chunkId: id });
  }
  const manifest = { terrain: { mapId: 28, plane: 0, zoom: 2, tiles }, categories: [{ id: 'bank', label: 'Bank' }] };
  const terrain = new MapTerrain(manifest, { canvasFactory, fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 } });
  // A fully loaded cache must not accidentally reintroduce per-tile overview draws.
  for (const tile of tiles) terrain.images.set(`${tile.x},${tile.y}`, { naturalWidth: 256, naturalHeight: 256 });
  const pins = new MapPinRenderer(manifest, { pins: pinRows }, { canvasFactory });
  const owner = { unlockedSet: new Set(cells.keys()), selectedRanks: new Map(), pendingSet: new Set(), stickers: {} };
  const contexts = [context(), context(), context()], pinContext = context();
  const map = Object.assign(Object.create(ChunkMap.prototype), { terrain, pins, cells, contexts, pinContext,
    width: 1280, height: 800, dpr: 2, offset: { x: 0, y: 0 }, model: { preferences: {} },
    visibleMembers: [owner], active: owner, unlocked: owner.unlockedSet, poolIds: new Set(), deathMarkers: new Map(),
    cellStates: new Map([...cells.keys()].map(id => [id, { owners: [owner], selected: [], pending: false }])),
  });
  for (const zoom of [0.055, 0.1, 0.25, 0.49, 0.5, 0.55, 0.75]) {
    map.zoom = zoom;
    for (const ctx of [...contexts, pinContext]) ctx.calls.length = 0;
    map.drawBase(); map.drawState(); map.drawPins();
    assert.equal(contexts.slice(0, 2).flatMap(ctx => ctx.calls).filter(call => call[0] === 'image').length, 2, `two terrain layers at zoom ${zoom}`);
    assert.equal(pinContext.calls.filter(call => call[0] === 'image').length, zoom < 0.5 ? 0 : 1, `at most one pin blit at zoom ${zoom}`);
    assert.equal([...contexts, pinContext].flatMap(ctx => ctx.calls).filter(call => call[0] === 'image').length, zoom < 0.5 ? 2 : 3, `bounded total at zoom ${zoom}`);
    assert.equal(contexts[1].calls.filter(call => call[0] === 'clip').length, 1);
    if (zoom >= 0.5) {
      const cachedCanvas = pins.cache.canvas, spriteCalls = cachedCanvas.getContext('2d').calls.length;
      map.offset.x += 16;
      pinContext.calls.length = 0;
      map.drawPins();
      assert.equal(pinContext.calls.filter(call => call[0] === 'image').length, 1, 'Safe pan only blits the pin cache');
      assert.equal(pins.cache.canvas, cachedCanvas);
      assert.equal(cachedCanvas.getContext('2d').calls.length, spriteCalls, 'Safe pan never repaints cached pin sprites');
      map.offset.x -= 16;
    }
  }
  terrain.dispose(); pins.dispose();
});

test('ordinary pointer motion paints hover only, without touching terrain/state/pins', t => {
  const priorWindow = globalThis.window, priorRaf = globalThis.requestAnimationFrame;
  let frame;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  t.after(() => { globalThis.window = priorWindow; globalThis.requestAnimationFrame = priorRaf; });
  const painted = [];
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    disposed: false, frame: null, dpr: 1, drag: null, pointer: null, hoverId: null,
    dirty: { base: false, state: false, pins: false, hover: false },
    localPoint: () => ({ x: 20, y: 30 }), chunkAt: () => '7495',
    setHover(id) { if (id !== this.hoverId) { this.hoverId = id; this.dirty.hover = true; } },
    drawBase: () => painted.push('base'), drawState: () => painted.push('state'),
    drawPins: () => painted.push('pins'), drawHover: () => painted.push('hover'),
  });
  map.pointerMove({}); frame();
  assert.deepEqual(painted, ['hover']);
});
