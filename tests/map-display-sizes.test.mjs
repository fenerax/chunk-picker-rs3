import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkMap, layoutStickerCluster } from '../app/web/map.mjs';
import { buildWorld } from '../app/data/world.mjs';

const chunkId = '7495';
const members = ['actor1', 'reed'].map(id => ({ id, color: id === 'actor1' ? '#00cab8' : '#ad95fc',
  startingChunk: chunkId, stickers: { [chunkId]: Array.from({ length: 6 }, (_, index) => ({ id: `${id}-${index}`,
    type: 'star', color: '#ffffff' })) } }));

function drawingMap(size, preferences = {}, pinLayer = false) {
  const texts = [], rectangles = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setTransform() {}, moveTo() {}, lineTo() {},
    stroke() {}, strokeRect() {}, strokeText() {},
    fillRect(...rect) { rectangles.push({ rect, color: this.fillStyle }); },
    measureText(value) { return { width: value.length * parseFloat(this.font.match(/[\d.]+px/)[0]) * .6 }; },
    fillText(value, x, y, maxWidth) { texts.push({ value, x, y, maxWidth, font: parseFloat(this.font.match(/[\d.]+px/)[0]) }); },
  };
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    model: { preferences }, contexts: [null, context], zoom: size / 128, dpr: 1, offset: { x: 0, y: 0 },
    active: { selectedRanks: new Map() }, candidateRanks: new Map([[chunkId, 123]]),
    cellStates: new Map([[chunkId, { owners: [], selected: [], pending: false, candidate: true }]]),
    visibleMembers: members, overlay: null, clear() {}, drawTerrain() {}, drawUnlockedBorder() {}, drawDeathMarker() {},
    markerImage: () => null, eachVisibleCell(callback) { callback(chunkId, 0, 0); }, visibleBounds: () => ({}),
  });
  if (pinLayer) Object.assign(map, { pins: { draw() {} }, pinContext: context, deathMarkers: new Map() });
  return { map, texts, rectangles };
}

test('default sticker geometry remains unchanged and both glyph types use the same scale', () => {
  const layout = layoutStickerCluster(members, chunkId, 128);
  assert.deepEqual(layout, layoutStickerCluster(members, chunkId, 128, 1));
  assert.deepEqual(layout.markers.map(({ x, y, size }) => [x, y, size]),
    [[74, 4, 24], [100, 4, 24], [74, 34, 24], [100, 34, 24]]);
  assert.deepEqual(layout.overflow, { count: 8, x: 74, y: 64, width: 50, height: 12 });
  for (const scale of [.6, 1, 2]) {
    const { map, texts } = drawingMap(256, { stickerScale: scale });
    map.drawMarkers(map.contexts[1], chunkId, 0, 0, 256);
    assert.deepEqual(texts.filter(text => text.value === '★').map(text => text.font), Array(4).fill(24 * scale));
    const flags = texts.filter(text => text.value !== '★' && !text.value.startsWith('+'));
    assert.equal(flags.length, 2);
    assert.deepEqual(flags.map(text => text.font), [20 * scale, 20 * scale]);
  }
});

test('scaled clusters stay bounded, balanced, and separate from starting flags at every cell size', () => {
  const original = structuredClone(members);
  for (const scale of [.6, 1, 2]) for (let size = 18; size <= 512; size++) {
    const layout = layoutStickerCluster(members, chunkId, size, scale);
    assert.ok(layout.markers.length <= 4);
    assert.equal(layout.markers.length + (layout.overflow?.count ?? 0), 12);
    assert.deepEqual(layout.markers.map(marker => marker.owner.id),
      ['actor1', 'reed', 'actor1', 'reed'].slice(0, layout.markers.length));
    const rects = layout.markers.map(marker => [marker.x, marker.y, marker.size, marker.size + 4]);
    if (layout.overflow) rects.push([layout.overflow.x, layout.overflow.y, layout.overflow.width, layout.overflow.height]);
    const { map, texts } = drawingMap(size, { stickerScale: scale });
    map.drawMarkers(map.contexts[1], chunkId, 0, 0, size);
    for (const flag of texts.filter(text => text.value !== '★' && !text.value.startsWith('+'))) {
      rects.push([flag.x - flag.font / 2, flag.y - flag.font / 2, flag.font, flag.font + 4]);
    }
    for (const [x, y, width, height] of rects) {
      assert.ok(width > 0 && height > 0 && x >= -1e-9 && y >= -1e-9);
      assert.ok(x + width <= size + 1e-9 && y + height <= size + 1e-9);
    }
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const [x, y, width, height] = rects[a], [otherX, otherY, otherWidth, otherHeight] = rects[b];
      assert.ok(x + width <= otherX + 1e-9 || otherX + otherWidth <= x + 1e-9
        || y + height <= otherY + 1e-9 || otherY + otherHeight <= y + 1e-9,
      `Annotations overlap at cell ${size}, scale ${scale}`);
    }
  }
  assert.deepEqual(members, original);
  assert.deepEqual(layoutStickerCluster(members, chunkId, 128, NaN), layoutStickerCluster(members, chunkId, 128));
  assert.deepEqual(layoutStickerCluster(members, chunkId, 128, 99), layoutStickerCluster(members, chunkId, 128, 2));
});

test('IDs fit inside the chunk and stay clear of both flags on either annotation layer', () => {
  for (const pinLayer of [false, true]) for (const scale of [.6, 1, 2]) for (let size = 35; size <= 256; size++) {
    const { map, texts } = drawingMap(size, { ids: true, chunkIdScale: scale, stickerScale: scale }, pinLayer);
    map.drawState();
    if (pinLayer) map.drawPins();
    const id = texts.find(text => text.value === chunkId);
    const flags = texts.filter(text => text.value !== chunkId && text.value !== '123' && text.value !== '★' && !text.value.startsWith('+'));
    assert.equal(flags.length, 2);
    assert.ok(id.x - chunkId.length * id.font * .6 >= 2 - 1e-9);
    assert.ok(id.y - id.font >= 0 && id.y <= size);
    // Either the ID sits left of the flags, or the flags move up above the ID line.
    for (const flag of flags) assert.ok(id.x < flag.x - flag.font / 2 || flag.y + flag.font / 2 <= id.y - id.font + 1e-9,
      `ID collides at cell ${size}, scale ${scale}`);
  }
});

test('a chunk ID keeps its chosen size beside starting flags by moving the flags up when needed', () => {
  for (const pinLayer of [false, true]) for (const scale of [.6, 1, 2]) for (const size of [35, 64, 128, 256]) {
    const { map, texts } = drawingMap(size, { ids: true, chunkIdScale: scale, stickerScale: scale }, pinLayer);
    map.drawState();
    if (pinLayer) map.drawPins();
    const id = texts.find(text => text.value === chunkId);
    const requested = Math.min(Math.min(13, Math.max(10, size * .1)) * scale, size - 8);
    // The test context measures digits wider (.6em) than Calibri, so allow its own fit shrink.
    assert.ok(id.font >= Math.min(requested, (size - 7) / (chunkId.length * .6)) - 1e-9, `ID squeezed at cell ${size}, scale ${scale}`);
  }
});

test('with chunk IDs on, the roll number stays above the ID line', () => {
  for (const scale of [.6, 1, 2]) for (const size of [35, 64, 128]) {
    const { map, texts } = drawingMap(size, { ids: true, chunkIdScale: scale, rollNumberScale: scale });
    map.drawState();
    const id = texts.find(text => text.value === chunkId), rank = texts.find(text => text.value === '123');
    assert.ok(rank.y + rank.font / 2 <= id.y - id.font + 2 + 1e-9, `roll number overlaps ID at cell ${size}, scale ${scale}`);
  }
});

test('rank scaling keeps the base font rule, fits long ranks, and leaves chunk hit geometry unchanged', () => {
  for (const scale of [.6, 1, 2]) for (const size of [11, 18, 35, 64, 128, 512]) {
    const { map, texts } = drawingMap(size, { rollNumberScale: scale });
    const zoom = map.zoom, offset = map.offset;
    map.drawState();
    const rank = texts.find(text => text.value === '123');
    assert.ok(rank.font <= Math.max(11, Math.min(48, size * .5)) * scale);
    assert.ok(rank.font <= size - 4 && rank.font * 3 * .6 <= rank.maxWidth + 1e-9);
    assert.equal(map.zoom, zoom); assert.equal(map.offset, offset);
  }
  const { map, texts } = drawingMap(128);
  map.drawState();
  assert.equal(texts.find(text => text.value === '123').font, 48);
});

test('display preference changes repaint affected layers without rebuilding the map', () => {
  for (const hasPins of [false, true]) for (const ids of [false, true]) {
    let frames = 0;
    const model = { preferences: { ids, theme: 'dark' } }, states = new Map(), ranks = new Map();
    const map = Object.assign(Object.create(ChunkMap.prototype), { model, cellStates: states, candidateRanks: ranks,
      pins: hasPins ? {} : null, dirty: { base: false, state: false, pins: false, hover: false }, schedule() { frames++; } });
    map.setDisplayPreferences({ stickerScale: 2 });
    assert.deepEqual(map.dirty, { base: false, state: !hasPins || ids, pins: hasPins, hover: false });
    assert.equal(model.preferences.theme, 'dark');
    assert.equal(map.cellStates, states); assert.equal(map.candidateRanks, ranks);
    map.setDisplayPreferences({ stickerScale: 100 });
    assert.equal(frames, 1, 'Equivalent clamped values do not schedule another frame');
    map.dirty = { base: false, state: false, pins: false, hover: false };
    map.setDisplayPreferences({ rollNumberScale: .1, chunkIdScale: NaN });
    assert.deepEqual(map.dirty, { base: false, state: true, pins: false, hover: false });
    assert.equal(model.preferences.rollNumberScale, .6); assert.equal(model.preferences.chunkIdScale, 1);
  }
});

test('model adoption primes overflow artwork so revealing a skill with the size control makes no request', t => {
  const previousImage = globalThis.Image, requests = [];
  globalThis.Image = class { set src(url) { requests.push(url); } };
  t.after(() => { if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage; });
  const state = { revision: 1, members: ['actor1', 'reed'].map((id, index) => ({
    id, name: id, unlocked: [chunkId], selected: [], pendingRoll: [],
    stickers: { [chunkId]: Array.from({ length: 6 }, (_, order) => ({ id: `${id}-${order}`,
      type: order === 0 ? 'star' : index ? 'hunter' : 'mining', color: '#ffffff', text: '' })) },
  })) };
  const world = buildWorld({ chunks: { [chunkId]: {} }, walkableChunks: [], walkableChunksF2P: [] });
  const { map, texts } = drawingMap(35);
  const images = [];
  Object.assign(map, { model: null, cells: new Map(), markerImages: new Map(), deathMarkers: new Map(), initialized: true,
    markerImage: ChunkMap.prototype.markerImage, schedule() {}, dirty: { base: false, state: false, pins: false, hover: false } });
  map.contexts[1].drawImage = (...args) => images.push(args);
  map.setModel({ world, state, memberId: 'actor1', preferences: { stickerScale: 2 } });
  assert.deepEqual(requests, ['/assets/SVG/rs3/mining-rs3.svg'], 'Each present artwork type loads once; hidden partner types wait for group view');
  map.markerImages.get('mining').image.onload();
  map.drawMarkers(map.contexts[1], chunkId, 0, 0, 35);
  assert.deepEqual(texts.map(text => text.value), ['+6']);
  assert.equal(images.length, 0, 'The crowded initial cluster contains only overflow');
  map.setDisplayPreferences({ stickerScale: .6 });
  map.drawMarkers(map.contexts[1], chunkId, 0, 0, 35);
  assert.equal(images.length, 1, 'The newly visible skill uses primed artwork');
  assert.equal(requests.length, 1, 'Slider paint requests no artwork');
  map.setModel({ world, state, memberId: 'actor1', preferences: { stickerScale: .6 } });
  assert.equal(requests.length, 1, 'Repeated model adoption retains the artwork cache');
  map.setModel({ world, state, memberId: 'actor1', groupView: true, preferences: { stickerScale: .6 } });
  assert.deepEqual(requests, ['/assets/SVG/rs3/mining-rs3.svg', '/assets/SVG/rs3/hunter-rs3.svg']);
});

test('task-count preferences invalidate only the annotation layer when its canvas exists', () => {
  for (const hasPins of [true, false]) for (const ids of [true, false]) {
    const map = Object.assign(Object.create(ChunkMap.prototype), { model: { preferences: { ids } },
      pins: hasPins ? {} : null, pinContext: {}, dirty: { base: false, state: false, pins: false, hover: false }, schedule() {} });
    map.setDisplayPreferences({ showTaskCounts: false, taskCountScale: 2 });
    assert.deepEqual(map.dirty, { base: false, state: false, pins: true, hover: false });
    assert.equal(map.model.preferences.showTaskCounts, false);
  }
});

test('task-count scene preserves its zoom identity while refreshing current marker obstacles', () => {
  const { map } = drawingMap(128, { ids: true }, true), draws = [];
  Object.assign(map, { cells: new Map([[chunkId, { x: 1, y: 1 }]]),
    visibleTaskCounts: new Map([[chunkId, 12]]), width: 800, height: 600,
    taskCountRenderer: { draw(context, options) { draws.push(options); } } });
  map.drawTaskCounts(map.pinContext);
  const annotationCells = map.taskCountScene.annotationCells;
  map.offset.x = 40; map.drawTaskCounts(map.pinContext);
  assert.equal(draws[1].sceneKey, draws[0].sceneKey);
  assert.equal(draws[1].worldObstacles, draws[0].worldObstacles);
  map.zoom = 1.05; map.drawTaskCounts(map.pinContext);
  assert.equal(map.taskCountScene.annotationCells, annotationCells);
  assert.equal(draws[2].sceneKey, draws[0].sceneKey);
  assert.notEqual(draws[2].worldObstacles, draws[0].worldObstacles);
  assert.notDeepEqual(draws[2].worldObstacles, draws[0].worldObstacles);
  map.model.preferences = { ...map.model.preferences, stickerScale: 2 };
  map.drawTaskCounts(map.pinContext);
  assert.notEqual(draws[3].sceneKey, draws[2].sceneKey);
  map.deathMarkers.set(chunkId, {}); map.drawTaskCounts(map.pinContext);
  assert.notEqual(draws[4].sceneKey, draws[3].sceneKey);
  map.cellStates = new Map(map.cellStates); map.drawTaskCounts(map.pinContext);
  assert.notEqual(draws[5].sceneKey, draws[4].sceneKey);
});
