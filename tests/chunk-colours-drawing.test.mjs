import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkMap } from '../app/web/map.mjs';
import { chunkColourStyles, chunkColourPaint, createChunkColourLayer, drawChunkColourLayer, createChunkColourOverview, drawChunkColourOverview, releaseChunkColourOverview, drawChunkColours } from '../app/web/map-chunk-colours.mjs';
import { CHUNK_COLOURS, LEGACY_CHUNK_COLOURS } from '../app/core/chunk-colours.mjs';
import { contrastRatio, themePalettes } from '../app/web/map-tools.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const chunkId = (x, y) => String(SURFACE_GRID.startId + x * SURFACE_GRID.stride - y);
const cellCount = SURFACE_GRID.columns * SURFACE_GRID.rows;
const worldWidth = SURFACE_GRID.columns * 128, worldHeight = SURFACE_GRID.rows * 128;

function context() {
  const calls = [];
  let transform = [1, 0, 0, 1, 0, 0], clip = null;
  const saved = [];
  return new Proxy({ calls,
    fillRect(...rect) { calls.push({ type: 'fill', color: this.fillStyle, rect }); },
    strokeRect(...rect) { calls.push({ type: 'outline', color: this.strokeStyle, width: this.lineWidth, rect }); },
    fillText(text) { calls.push({ type: 'text', text }); },
    rect(...rect) { calls.push({ type: 'reveal', rect }); },
    measureText(text) { return { width: String(text).length * 6 }; },
    setTransform(...value) { transform = value; },
    save() { saved.push({ transform, clip, smoothing: this.imageSmoothingEnabled }); },
    restore() { const previous = saved.pop(); ({ transform, clip } = previous); this.imageSmoothingEnabled = previous.smoothing; },
    clip(path) { clip = path; calls.push({ type: 'clip', path }); },
    fill(path) { calls.push({ type: 'pathfill', color: this.fillStyle, path, transform: [...transform], clip }); },
    drawImage(...args) { calls.push({ type: 'image', args, smoothing: this.imageSmoothingEnabled, transform: [...transform] }); },
    get transform() { return transform; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
}

function drawingMap({ dense = false } = {}) {
  const chunks = dense ? Object.fromEntries(Array.from({ length: cellCount }, (_, index) =>
    [chunkId(Math.floor(index / SURFACE_GRID.rows), index % SURFACE_GRID.rows), {}])) :
    { [chunkId(0, 0)]: { Name: 'North' }, [chunkId(0, 1)]: {}, [chunkId(1, 0)]: {}, [chunkId(1, 1)]: {} };
  const world = buildWorld({ chunks, walkableChunks: [], walkableChunksF2P: [] });
  const state = { revision: 1, members: [
    { id: 'actor1', name: 'Player', sourceMapId: 'bbb', unlocked: [chunkId(0, 0)], selected: [chunkId(0, 1)], pendingRoll: [chunkId(1, 0)],
      chunkColours: { [chunkId(0, 0)]: 'red', [chunkId(0, 1)]: 'yellow', [chunkId(1, 0)]: 'green', [chunkId(1, 1)]: 'blue' },
      chunkColourNames: { red: 'Quest route' },
      stickers: { [chunkId(0, 0)]: [{ id: 'star', type: 'star', color: '#ffffff', text: 'Meet Reed' }] } },
    { id: 'reed', name: 'Reed', sourceMapId: 'aaa', unlocked: [chunkId(1, 0)], selected: [], pendingRoll: [],
      chunkColours: { [chunkId(0, 0)]: 'blue', [chunkId(1, 1)]: 'blue' }, chunkColourNames: { blue: 'Training' } },
  ] };
  const ctx = context(), attributes = {};
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    cells: new Map(), dirty: {}, deathMarkers: new Map(), markerImages: new Map(), taskCounts: new Map(),
    initialized: true, zoom: 1, dpr: 1, offset: { x: 0, y: 0 }, width: 256, height: 256,
    contexts: [null, ctx], schedule() {}, markerImage: () => null,
    drawTerrain() { ctx.calls.push({ type: 'terrain' }); },
    tooltip: { style: {}, offsetWidth: 100, offsetHeight: 50 },
    hoverCanvas: { setAttribute(key, value) { attributes[key] = value; } }, pointer: { x: 80, y: 80 },
  });
  map.setModel({ world, state, memberId: 'actor1', preferences: { ids: true } });
  return { map, ctx, world, state, attributes };
}

test('all modern and retained colours have a subtle wash and readable accent in dark/light high visibility', () => {
  for (const theme of ['dark', 'light']) for (const highvis of [false, true]) {
    const styles = chunkColourStyles({ theme, highvis }), palette = themePalettes[theme];
    for (const colour of LEGACY_CHUNK_COLOURS) {
      const style = styles.get(colour.id);
      assert.ok(style.fill.endsWith(highvis ? ',0.2)' : ',0.3)'));
      assert.ok(contrastRatio(style.accent, palette.mapBg) >= 3, `${theme} ${colour.id} accent remains readable`);
    }
    assert.ok(CHUNK_COLOURS.every(colour => styles.has(colour.id)));
  }
});

test('group paint merges equal tints and retains each owner’s names and ordered legacy paints', () => {
  const owners = [
    { name: 'Player', chunkColours: { [chunkId(0, 0)]: ['red', 'orange', 'blue'] }, chunkColourNames: { red: 'Quest route' } },
    { name: 'Reed', chunkColours: { [chunkId(0, 0)]: ['blue', 'pink'] }, chunkColourNames: { blue: '<Training>' } },
  ];
  const before = structuredClone(owners);
  const paint = chunkColourPaint(owners, chunkId(0, 0), chunkColourStyles());
  assert.deepEqual(paint.segments.map(segment => segment.id), ['red', 'orange', 'blue', 'pink']);
  assert.deepEqual(paint.descriptions, ['Player: colour · Quest route, Orange, Blue', 'Reed: colour · <Training>, Pink']);
  assert.deepEqual(owners, before);
  assert.equal(chunkColourPaint(owners, chunkId(1, 1), chunkColourStyles()), null);
});

test('split washes cover exactly their chunk and keep accent geometry inside across every zoom tier', () => {
  const styles = chunkColourStyles(), paint = { segments: [...styles.values()] };
  for (const size of [128 * .055, 12, 18, 44, 128, 512]) {
    const ctx = context(); drawChunkColours(ctx, paint, 10, 20, size);
    const fills = ctx.calls.filter(call => call.type === 'fill');
    assert.equal(fills.length, styles.size);
    assert.equal(fills[0].rect[0], 10);
    assert.equal(fills.at(-1).rect[0] + fills.at(-1).rect[2], 10 + size);
    assert.ok(Math.abs(fills.reduce((sum, fill) => sum + fill.rect[2], 0) - size) < 1e-9);
    for (const { rect: [x, y, width, height], width: line = 0 } of ctx.calls) {
      assert.ok(x >= 10 && y >= 20 && width > 0 && height > 0);
      assert.ok(x + width <= 10 + size && y + height <= 20 + size);
      if (line) assert.ok(x - line / 2 >= 10 && y - line / 2 >= 20 && x + width + line / 2 <= 10 + size && y + height + line / 2 <= 20 + size);
    }
    assert.ok(ctx.calls.length <= styles.size * 3, 'Painting has no size-dependent loops');
  }
  for (const size of [0, -1, NaN, Infinity]) {
    const ctx = context(); drawChunkColours(ctx, paint, 0, 0, size); assert.equal(ctx.calls.length, 0);
  }
});

test('model changes isolate personal tints, combine group slices and discard stale cells', () => {
  const { map, world, state } = drawingMap();
  const snapshot = structuredClone(state);
  assert.deepEqual(map.cellStates.get(chunkId(0, 0)).colourPaint.segments.map(segment => segment.id), ['red']);
  assert.equal(map.cellStates.get(chunkId(1, 1)).owners.length, 0, 'A locked tint does not grant ownership');
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  assert.deepEqual(map.cellStates.get(chunkId(0, 0)).colourPaint.segments.map(segment => segment.id), ['red', 'blue']);
  assert.deepEqual(map.cellStates.get(chunkId(1, 1)).colourPaint.segments.map(segment => segment.id), ['blue'], 'Equal group colours share one wash');
  map.setModel({ world, state, memberId: 'reed' });
  assert.deepEqual(map.cellStates.get(chunkId(0, 0)).colourPaint.segments.map(segment => segment.id), ['blue']);
  assert.equal(map.cellStates.get(chunkId(0, 1)).colourPaint, null);
  const smallWorld = buildWorld({ chunks: { [chunkId(0, 0)]: {} }, walkableChunks: [], walkableChunksF2P: [] });
  map.setModel({ world: smallWorld, state, memberId: 'reed' });
  assert.equal(map.cellStates.has(chunkId(1, 1)), false);
  assert.deepEqual(state, snapshot, 'Resolution and drawing do not edit gameplay');
});

test('legacy paints render until authored tint or clear masks them', () => {
  const { map, world, state } = drawingMap();
  state.legacy = { maps: { bbb: { chunks: { painted: { [chunkId(0, 0)]: ['Orange', 'Pink', 'Purple', 'Black'] } } } } };
  delete state.members[0].chunkColours[chunkId(0, 0)];
  map.setModel({ world, state, memberId: 'actor1' });
  assert.deepEqual(map.cellStates.get(chunkId(0, 0)).colourPaint.segments.map(segment => segment.id), ['orange', 'pink', 'purple', 'black']);
  state.members[0].chunkColours[chunkId(0, 0)] = 'green';
  map.setModel({ world, state, memberId: 'actor1' });
  assert.deepEqual(map.cellStates.get(chunkId(0, 0)).colourPaint.segments.map(segment => segment.id), ['green']);
  state.members[0].chunkColours[chunkId(0, 0)] = null;
  map.setModel({ world, state, memberId: 'actor1' });
  assert.equal(map.cellStates.get(chunkId(0, 0)).colourPaint, null);
});

test('tints paint after terrain and below selected/pending outlines, IDs, stickers and unlocked borders', () => {
  const { map, ctx } = drawingMap();
  map.drawUnlockedBorder = () => ctx.calls.push({ type: 'unlockedBorder' });
  map.drawState();
  const lastTint = ctx.calls.findLastIndex(call => call.type === 'fill' && /^rgba\(\d+,\d+,\d+,0.3\)$/.test(call.color));
  assert.ok(ctx.calls.findIndex(call => call.type === 'terrain') < lastTint);
  for (const highlight of ['#5fe35a', '#ffe55c']) assert.ok(ctx.calls.findIndex(call => call.type === 'outline' && call.color === highlight) > lastTint);
  assert.ok(ctx.calls.findIndex(call => call.type === 'text' && call.text === chunkId(0, 0)) > lastTint);
  assert.ok(ctx.calls.findIndex(call => call.type === 'text' && call.text === '★') > lastTint);
  assert.ok(ctx.calls.findIndex(call => call.type === 'unlockedBorder') > lastTint);
  assert.equal(ctx.calls.filter(call => call.type === 'reveal').length, 3, 'Unlocked, selected and pending reveal; locked blue tint does not');
});

test('hover and accessible description name each personal colour literally alongside ownership and stickers', () => {
  const { map, world, state, attributes } = drawingMap();
  state.members[1].chunkColourNames.blue = '<Training>';
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  map.setHover(chunkId(0, 0));
  assert.match(map.tooltip.textContent, /Unlocked: Player/);
  assert.match(map.tooltip.textContent, /Player: colour · Quest route/);
  assert.match(map.tooltip.textContent, /Reed: colour · <Training>/);
  assert.match(map.tooltip.textContent, /Player: star · Meet Reed/);
  assert.equal(attributes['aria-description'], map.tooltip.textContent);
  map.setModel({ world, state, memberId: 'reed' });
  map.setHover(chunkId(0, 0));
  assert.ok(!map.tooltip.textContent.includes('Quest route'));
  assert.match(map.tooltip.textContent, /Locked/);
  assert.match(map.tooltip.textContent, /Reed: colour · <Training>/);
});

test('dense colour maps paint visible cells only and reuse model resolution while panning and zooming', () => {
  const { map, world, state, ctx } = drawingMap({ dense: true });
  state.members.forEach((owner, index) => {
    owner.chunkColours = Object.fromEntries([...world.surface].map(id => [id, index ? 'blue' : 'red']));
  });
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  assert.equal(map.cellStates.size, cellCount);
  const cache = map.cellStates, annotation = cache.get(chunkId(0, 0)).colourPaint;
  map.visibleMembers.forEach(owner => {
    owner.chunkColours = new Proxy({}, { get() { throw new Error('Pan must use precomputed colours'); } });
    owner.chunkColourNames = new Proxy({}, { get() { throw new Error('Hover must use precomputed names'); } });
  });
  for (const zoom of [.055, .35, 1, 4]) {
    map.zoom = zoom; ctx.calls.length = 0;
    const visible = []; map.eachVisibleCell(id => visible.push(id));
    map.drawState();
    assert.equal(ctx.calls.filter(call => call.type === 'fill' && /^rgba\(\d+,\d+,\d+,0.3\)$/.test(call.color)).length, visible.length * 2);
    assert.equal(map.cellStates, cache);
    assert.equal(cache.get(chunkId(0, 0)).colourPaint, annotation);
    if (zoom >= .35) assert.ok(visible.length < Math.min(100, cellCount), 'Zoomed viewport avoids map-wide painting');
    map.offset.x -= 2;
  }
  map.setHover(chunkId(0, 0));
  assert.match(map.tooltip.textContent, /Quest route/);
});

test('cached palette paths keep split geometry and bound dense overview fills through pan and zoom', t => {
  const previous = globalThis.Path2D;
  globalThis.Path2D = class { rectangles = []; rect(...rect) { this.rectangles.push(rect); } };
  t.after(() => { if (previous === undefined) delete globalThis.Path2D; else globalThis.Path2D = previous; });
  const { map, world, state, ctx } = drawingMap({ dense: true });
  state.members.forEach((owner, index) => {
    owner.chunkColours = Object.fromEntries([...world.surface].map((id, chunk) => [id, CHUNK_COLOURS[(chunk + index) % 4].id]));
  });
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  const layers = map.chunkColourLayer;
  assert.equal(layers.length, 4);
  assert.equal(layers.reduce((sum, layer) => sum + layer.path.rectangles.length, 0), cellCount * 2);
  const firstPoint = map.cells.values().next().value;
  assert.deepEqual(layers[0].path.rectangles[0], [firstPoint.x * 128, firstPoint.y * 128, 64, 128]);
  assert.deepEqual(layers[1].path.rectangles[0], [firstPoint.x * 128 + 64, firstPoint.y * 128, 64, 128]);
  assert.ok(layers.every(layer => layer.style.fill.endsWith(',0.3)')), 'The batch retains the wash opacity');
  for (const zoom of [.055, .1, .35, 1, 4]) {
    map.zoom = zoom; map.dpr = 1.5; map.offset = { x: -20, y: 35 }; ctx.calls.length = 0;
    const visible = new Set(); map.eachVisibleCell(id => visible.add(id));
    map.drawState();
    const fills = ctx.calls.filter(call => call.type === 'pathfill' && call.path);
    assert.equal(fills.length, 4, `Only four palette fills at zoom ${zoom}`);
    assert.equal(ctx.calls.filter(call => call.type === 'fill' && /^rgba\(\d+,\d+,\d+,0.3\)$/.test(call.color)).length, 0, 'Batched drawing does not duplicate cell washes');
    assert.ok(fills.every(fill => fill.clip === null), 'Tint wash does not inherit the terrain reveal clip; locked cells can be tinted');
    assert.ok(fills.every(fill => JSON.stringify(fill.transform) === JSON.stringify([1.5 * zoom, 0, 0, 1.5 * zoom, -30, 52.5])));
    assert.deepEqual(ctx.transform, [1.5, 0, 0, 1.5, 0, 0], 'Following annotations use viewport coordinates');
    const accentOutlines = ctx.calls.filter(call => call.type === 'outline' && layers.some(layer => layer.style.accent === call.color));
    assert.equal(accentOutlines.length > 0, zoom >= 1, 'Overview omits inset accents while detailed cells retain them');
    const lastTint = ctx.calls.findLastIndex(call => call.type === 'pathfill' && call.path);
    assert.ok(ctx.calls.findIndex(call => call.type === 'terrain') < lastTint);
    if (visible.has(chunkId(1, 0))) assert.ok(ctx.calls.findIndex(call => call.type === 'outline' && call.color === '#ffe55c') > lastTint);
    assert.equal(map.chunkColourLayer, layers, 'Pan and zoom never rebuild palette geometry');
  }
  const oldPath = layers[0].path;
  state.members[0].chunkColours[chunkId(0, 0)] = null;
  map.setModel({ world, state, memberId: 'actor1', groupView: true, preferences: { theme: 'light', highvis: true } });
  assert.notEqual(map.chunkColourLayer[0].path, oldPath, 'Changed model rebuilds paths');
  assert.ok(map.chunkColourLayer.every(layer => layer.style.fill.endsWith(',0.2)')));
});

test('batched tint layer uses canvas viewport clipping and restores an existing viewport transform', t => {
  const previous = globalThis.Path2D;
  globalThis.Path2D = class { rectangles = []; rect(...rect) { this.rectangles.push(rect); } };
  t.after(() => { if (previous === undefined) delete globalThis.Path2D; else globalThis.Path2D = previous; });
  const styles = chunkColourStyles(), colourPaint = { segments: [styles.get('red')] };
  const layers = createChunkColourLayer(new Map([[chunkId(0, 0), { x: 20, y: 30 }]]), new Map([[chunkId(0, 0), { colourPaint }]]));
  const ctx = context(); ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
  // The canvas's own viewport bounds clip these offscreen world coordinates;
  // no unbounded bitmap or additional terrain clip is created by this layer.
  assert.equal(drawChunkColourLayer(ctx, layers, { zoom: .35, dpr: 1.5, offset: { x: -200, y: 300 } }), true);
  assert.deepEqual(ctx.calls[0].path.rectangles, [[2560, 3840, 128, 128]]);
  assert.deepEqual(ctx.calls[0].transform, [1.5 * .35, 0, 0, 1.5 * .35, -300, 450]);
  assert.deepEqual(ctx.transform, [1.5, 0, 0, 1.5, 0, 0]);
  assert.equal(ctx.calls.filter(call => call.type === 'clip').length, 0);
  assert.equal(drawChunkColourLayer(ctx, null, {}), false, 'Unsupported Path2D uses visible-cell fallback');
});

test('overview bitmap bounds memory, paints with one aligned blit, and releases storage on replace and dispose', t => {
  const previousPath = globalThis.Path2D, previousCanvas = globalThis.OffscreenCanvas;
  const canvases = [];
  globalThis.Path2D = class { rectangles = []; rect(...rect) { this.rectangles.push(rect); } };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; this.context = context(); canvases.push(this); }
    getContext() { return this.context; }
  };
  t.after(() => {
    if (previousPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = previousPath;
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previousCanvas;
  });
  assert.equal(createChunkColourOverview([], worldWidth, worldHeight), null);
  assert.equal(canvases.length, 0, 'Empty colour models allocate no bitmap');
  const { map, state, world, ctx } = drawingMap({ dense: true });
  const first = map.chunkColourOverview;
  assert.deepEqual([first.canvas.width, first.canvas.height], [worldWidth / 8, worldHeight / 8]);
  assert.ok(first.canvas.width * first.canvas.height <= 601600, 'Full world overview stays within the reference pixel budget');
  assert.ok(first.canvas.context.calls.every(call => call.type !== 'pathfill' ||
    call.transform[0] === .125 && call.transform[3] === .125 && call.color.endsWith(',0.3)')));
  state.members.forEach((owner, index) => {
    owner.chunkColours = Object.fromEntries([...world.surface].map(id => [id, index ? 'blue' : 'red']));
  });
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  assert.deepEqual([first.canvas.width, first.canvas.height], [0, 0], 'Replacement releases previous pixels');
  const overview = map.chunkColourOverview, layer = map.chunkColourLayer, allocations = canvases.length;
  for (const zoom of [.055, .1, .35]) {
    map.zoom = zoom; map.offset = { x: -20, y: 35 }; ctx.calls.length = 0; ctx.imageSmoothingEnabled = true;
    map.drawState();
    const images = ctx.calls.filter(call => call.type === 'image');
    assert.equal(images.length, 1, 'Overview uses one blit regardless of coloured-cell count');
    assert.deepEqual(images[0].args, [overview.canvas, -20, 35, worldWidth * zoom, worldHeight * zoom]);
    assert.equal(images[0].smoothing, false, 'Split colour edges stay aligned instead of bleeding');
    assert.equal(ctx.imageSmoothingEnabled, true, 'Later terrain and icons retain their smoothing preference');
    assert.equal(ctx.calls.filter(call => call.type === 'pathfill' && call.path).length, 0);
    assert.equal(map.chunkColourOverview, overview);
    assert.equal(map.chunkColourLayer, layer);
    assert.equal(canvases.length, allocations, 'Pan and zoom allocate no bitmap');
  }
  map.zoom = 1; ctx.calls.length = 0; map.drawState();
  assert.equal(ctx.calls.filter(call => call.type === 'image').length, 0, 'Detail uses vectors rather than enlarged overview pixels');
  assert.equal(ctx.calls.filter(call => call.type === 'pathfill' && call.path).length, 2);
  state.members.forEach(owner => { owner.chunkColours = {}; });
  map.setModel({ world, state, memberId: 'actor1', groupView: true });
  assert.equal(map.chunkColourOverview, null);
  assert.equal(canvases.length, allocations, 'Cleared colour model creates no replacement');
  assert.deepEqual([overview.canvas.width, overview.canvas.height], [0, 0]);
  state.members[0].chunkColours[chunkId(0, 0)] = 'red';
  map.setModel({ world, state, memberId: 'actor1' });
  const last = map.chunkColourOverview;
  Object.assign(map, { cancelTouchGesture() {}, chunkHold: { dispose() {} }, chunkTerrainListeners: new Map(),
    frame: null, observer: { disconnect() {} }, listeners: [], image: {},
    hoverCanvas: { classList: { remove() {} } } });
  map.dispose();
  assert.deepEqual([last.canvas.width, last.canvas.height], [0, 0], 'Disposal releases bitmap storage');
  assert.equal(map.chunkColourOverview, null);
  assert.equal(map.chunkColourLayer, null);
  releaseChunkColourOverview(null);
  assert.equal(drawChunkColourOverview(ctx, null, {}), false);
});
