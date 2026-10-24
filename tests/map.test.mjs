import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkMap, MAX_MAP_DPR, layoutStickerCluster, drawSandboxMarker } from '../app/web/map.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';

const sortedRectangles = rectangles => [...rectangles].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const physicalRectangles = (map, rectangles) => rectangles.map(rectangle => rectangle.map(value => value * map.dpr));

function harness(t, { pins = false, path2D = false } = {}) {
  const original = new Map(['window', 'Image', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Path2D'].map(key => [key, globalThis[key]]));
  const frames = new Map();
  let nextFrame = 0;
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
  globalThis.Image = class { naturalWidth = 6016; naturalHeight = 6400; };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  if (path2D) globalThis.Path2D = class {
    rectangles = [];
    rect(...rectangle) { this.rectangles.push(rectangle); }
  };
  else delete globalThis.Path2D;
  const counters = [];
  function canvas() {
    const counts = { clear: 0, terrain: 0, outline: 0, text: [], clips: [], draws: [], outlines: [] };
    counters.push(counts);
    const stack = [];
    let transform = [1, 0, 0, 1, 0, 0], clip = null, rectangles = [];
    const context = {
      setTransform(...value) { transform = value; }, clearRect() { counts.clear++; }, fillRect() {},
      save() { stack.push({ transform: [...transform], clip }); },
      restore() { assert.ok(stack.length, 'Canvas restores must match saves'); ({ transform, clip } = stack.pop()); },
      rect(...rectangle) { rectangles.push(rectangle); },
      clip(path) {
        const [a, , , d, e, f] = transform;
        clip = (path?.rectangles ?? rectangles).map(([x, y, width, height]) => [a * x + e, d * y + f, a * width, d * height]);
        counts.clips.push({ path, transform: [...transform], rectangles: clip });
      },
      drawImage(...args) { counts.terrain++; counts.draws.push({ args, transform: [...transform], clip }); },
      beginPath() { rectangles = []; }, arc() {}, moveTo() {}, lineTo() {},
      stroke() {}, fill() {}, closePath() {}, fillText(text) { counts.text.push(text); }, strokeText() {}, setLineDash() {},
      strokeRect(...args) { counts.outline++; counts.outlines.push({ args, transform: [...transform], clip }); },
      get clipRectangles() { return clip; },
      get transform() { return transform; },
    };
    const captured = new Set();
    return Object.assign(new EventTarget(), {
      attributes: {}, getContext: () => context, focus() {}, setAttribute(name, value) { this.attributes[name] = value; },
      classList: { add() {}, remove() {} },
      setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
      releasePointerCapture: id => captured.delete(id),
    });
  }
  const stage = { dataset: {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }) };
  const tooltip = { hidden: true, style: {}, offsetWidth: 140, offsetHeight: 50 };
  const chosen = [];
  const canvases = { baseCanvas: canvas(), stateCanvas: canvas(), hoverCanvas: canvas() };
  if (pins) canvases.pinCanvas = canvas();
  const map = new ChunkMap({ stage, ...canvases, tooltip, onChunk: id => chosen.push(id) });
  const world = buildWorld({ chunks: { '7495': { Name: 'North' }, '7494': {}, '7751': {} }, walkableChunks: [], walkableChunksF2P: [] });
  const state = { members: [
    { id: 'one', name: 'One', unlocked: ['7495'], selected: ['7494'], pendingRoll: [] },
    { id: 'two', name: 'Two', unlocked: ['7751'], selected: [], pendingRoll: [] },
  ] };
  function flush() {
    for (let limit = 0; frames.size; limit++) {
      assert.ok(limit < 10, 'Frame loop should settle');
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach(callback => callback());
    }
  }
  map.setModel({ world, state, memberId: 'one', groupView: false });
  map.zoom = 1;
  map.offset = { x: 100, y: 100 };
  flush();
  t.after(() => {
    map.dispose();
    for (const [key, value] of original) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return { map, world, state, counters, stage, tooltip, chosen, frames, flush };
}

test('configured owner colours survive reversed saved member order and unknown owners use their row index', t => {
  const { map, world, state } = harness(t);
  const defaults = selectedDataset.gameDefaults.members;
  assert.ok(defaults.length >= 2);
  const reversed = { ...state, members: [
    { ...state.members[0], id: defaults[1].id },
    { ...state.members[1], id: defaults[0].id },
    { ...state.members[0], id: 'unconfigured-owner' },
  ] };
  map.setModel({ world, state: reversed, memberId: defaults[0].id, groupView: true });
  assert.equal(map.members[0].color, '#ad95fc');
  assert.equal(map.members[1].color, '#00cab8');
  assert.equal(map.members[2].color, '#ffb878');
});

test('sandbox map changes have distinct markers and returning to the saved model clears them', t => {
  const { map, world, state, flush } = harness(t);
  map.setModel({ world, state, memberId: 'one', sandbox: { unlockChunks: ['7494'], lockChunks: ['7495'] } }); flush();
  assert.ok(map.sandboxUnlocks.has('7494')); assert.ok(map.sandboxLocks.has('7495'));
  map.setModel({ world, state, memberId: 'one' }); flush();
  assert.equal(map.sandboxUnlocks.size, 0); assert.equal(map.sandboxLocks.size, 0);
  assert.deepEqual(state.members[0].unlocked, ['7495']);
});

test('activity model and preference changes repaint state without redrawing base terrain or pins', t => {
  const { map, counters, flush } = harness(t, { pins: true });
  const model = { clues: new Map([['7495', [{ tier: 'easy' }]]]), slayer: new Map() };
  const before = counters.map(counts => counts.clear), baseTerrain = counters[0].terrain;
  map.setActivityLayers(model); map.setActivityLayerPreferences({ clueTier: 'easy', showSlayer: false }); flush();
  assert.equal(counters[0].clear, before[0]); assert.equal(counters[0].terrain, baseTerrain);
  assert.equal(counters[1].clear, before[1] + 1); assert.equal(counters[3].clear, before[3]);
  const stateClear = counters[1].clear;
  map.setActivityLayerPreferences({ clueTier: 'easy', showSlayer: false }); flush();
  assert.equal(counters[1].clear, stateClear, 'Identical preferences skip repaint');
});

test('activity outlines paint after roll fills and before roll labels and personal markers', t => {
  const { map, flush } = harness(t);
  const events = [], context = map.contexts[1];
  const fill = context.fillRect.bind(context), text = context.fillText.bind(context);
  context.fillRect = (...args) => { events.push('fill'); fill(...args); };
  context.fillText = (...args) => { events.push('text'); text(...args); };
  map.activityLayerRenderer.draw = () => events.push('activity');
  map.drawMarkers = () => events.push('marker');
  map.setActivityLayerPreferences({ clueTier: 'all', showSlayer: true }); flush();
  const index = events.indexOf('activity');
  assert.ok(index > 0); assert.ok(events.slice(0, index).includes('fill'));
  assert.ok(events.slice(index + 1).includes('text')); assert.ok(events.slice(index + 1).includes('marker'));
  assert.ok(!events.slice(index + 1).includes('fill'));
  assert.ok(!events.slice(0, index).includes('text')); assert.ok(!events.slice(0, index).includes('marker'));
});

test('activity tooltip follows tier switches, clearing layers and replacement player targets', t => {
  const { map, tooltip, flush } = harness(t);
  map.pointer = { x: 150, y: 150 }; map.setHover('7495');
  const clues = new Map([['7495', [{ tier: 'easy' }, { tier: 'hard' }]]]);
  map.setActivityLayers({ clues, slayer: new Map([['7495', [{ label: 'Cow' }]]]), slayerLabel: 'Cows' });
  map.setActivityLayerPreferences({ clueTier: 'easy', showSlayer: true }); flush();
  assert.match(tooltip.textContent, /Recorded clue locations: easy\./);
  assert.match(tooltip.textContent, /Locked Slayer task: Cows/);
  map.setActivityLayerPreferences({ clueTier: 'hard', showSlayer: false }); flush();
  assert.match(tooltip.textContent, /Recorded clue locations: hard\./);
  assert.doesNotMatch(tooltip.textContent, /Locked Slayer task|clue locations: easy/);
  map.setActivityLayerPreferences({ clueTier: 'off', showSlayer: false }); flush();
  assert.doesNotMatch(tooltip.textContent, /Recorded clue|Locked Slayer/);
  map.setActivityLayerPreferences({ clueTier: 'off', showSlayer: true });
  map.setActivityLayers({ clues: new Map(), slayer: new Map([['7495', [{ label: 'Goblin' }]]]), slayerLabel: 'Goblins' }); flush();
  assert.match(tooltip.textContent, /Locked Slayer task: Goblins/); assert.doesNotMatch(tooltip.textContent, /Cows/);
  map.setActivityLayers({ clues: new Map(), slayer: new Map() }); flush();
  assert.doesNotMatch(tooltip.textContent, /Recorded clue|Locked Slayer/);
  assert.equal(map.activityLayerRenderer.entries.length, 0);
});

test('sandbox hatching stays inside its chunk and stays bounded at maximum zoom', () => {
  const points = []; let saved = 0, restored = 0, dashed = false;
  const context = { save() { saved++; }, restore() { restored++; }, fillRect() {}, beginPath() {}, stroke() {}, strokeRect() {},
    moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); }, setLineDash() { dashed = true; } };
  drawSandboxMarker(context, 10, 20, 512, true);
  assert.equal(saved, restored); assert.ok(dashed); assert.ok(points.length <= 96);
  assert.ok(points.every(([x, y]) => x >= 10 && x <= 522 && y >= 20 && y <= 532));
});

test('late pins retain decoded terrain and redraw only their layer', t => {
  const { map, counters, flush } = harness(t, { pins: true });
  const manifest = { terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [] }, categories: [{ id: 'bank', label: 'Bank' }] };
  map.setMapAssets(manifest, { pins: [] }); flush();
  const terrain = map.terrain, terrainDraws = counters[0].terrain;
  let disposed = false;
  const dispose = terrain.dispose.bind(terrain);
  terrain.dispose = () => { disposed = true; dispose(); };
  map.setMapPins(manifest, { pins: [{ id: 'bank-one', categoryId: 'bank', x: 20, y: 20 }] }); flush();
  assert.equal(map.terrain, terrain);
  assert.equal(disposed, false);
  assert.equal(counters[0].terrain, terrainDraws);
});

test('hit testing excludes unknown surface cells and exact outer boundaries', t => {
  const { map, chosen, flush } = harness(t);
  assert.equal(map.chunkAt({ x: 100, y: 100 }), '7495');
  assert.equal(map.chunkAt({ x: 228, y: 100 }), '7751');
  assert.equal(map.chunkAt({ x: 100, y: 228 }), '7494');
  assert.equal(map.chunkAt({ x: 228, y: 228 }), null);
  assert.equal(map.chunkAt({ x: 99.99, y: 100 }), null);
  assert.equal(map.chunkAt({ x: 100 + 47 * 128, y: 100 }), null);
  assert.equal(map.chunkAt({ x: 100, y: 100 + 50 * 128 }), null);
  map.pointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 160, clientY: 170 });
  map.pointerUp({ pointerId: 1, clientX: 160, clientY: 170 });
  flush();
  assert.deepEqual(chosen, ['7495']);
});

test('hover changes never redraw terrain or state and repeated cell hover skips the canvas', t => {
  const { map, counters, tooltip, flush } = harness(t);
  const before = counters.map(counts => counts.clear);
  map.pointerMove({ clientX: 160, clientY: 170 });
  flush();
  assert.deepEqual(counters.map(counts => counts.clear), [before[0], before[1], before[2] + 1]);
  assert.match(tooltip.textContent, /North\nUnlocked: One/);
  map.pointerMove({ clientX: 170, clientY: 180 });
  flush();
  assert.equal(counters[2].clear, before[2] + 1);
  map.pointerMove({ clientX: 250, clientY: 170 });
  flush();
  assert.equal(counters[2].clear, before[2] + 2);
  assert.deepEqual(counters.slice(0, 2).map(counts => counts.clear), before.slice(0, 2));
});

test('wheel-style zoom preserves the anchored world point and ignores invalid factors', t => {
  const { map } = harness(t);
  const anchor = { x: 390, y: 270 };
  const before = { x: (anchor.x - map.offset.x) / map.zoom, y: (anchor.y - map.offset.y) / map.zoom };
  map.zoomAt(1.5, anchor);
  assert.equal((anchor.x - map.offset.x) / map.zoom, before.x);
  assert.equal((anchor.y - map.offset.y) / map.zoom, before.y);
  const zoom = map.zoom;
  for (const value of [0, -1, NaN, Infinity]) map.zoomBy(value);
  assert.equal(map.zoom, zoom);
});

test('canvas density is capped while device-density changes resize only when needed', t => {
  const { map, counters, flush } = harness(t, { pins: true });
  assert.equal(MAX_MAP_DPR, 1.5, 'High-density map rendering has an explicit raster budget');
  assert.equal(map.deviceDpr, 2);
  assert.equal(map.dpr, MAX_MAP_DPR);
  assert.ok(map.canvases.every(canvas => canvas.width === 800 * MAX_MAP_DPR && canvas.height === 600 * MAX_MAP_DPR));
  assert.equal(map.chunkAt({ x: 150, y: 150 }), '7495', 'Hit testing stays in CSS coordinates');
  map.autoFit = false;
  const offset = { ...map.offset }, before = counters.map(counter => counter.clear);
  const resize = map.resize.bind(map);
  let resizes = 0;
  map.resize = () => { resizes++; resize(); };
  window.devicePixelRatio = 3;
  map.schedule(); flush();
  assert.equal(resizes, 1, 'Device-density changes are detected even above the raster cap');
  assert.equal(map.deviceDpr, 3);
  assert.equal(map.dpr, MAX_MAP_DPR);
  assert.deepEqual(counters.map(counter => counter.clear), before, 'Equal capped dimensions do not repaint');
  map.schedule(); flush();
  assert.equal(resizes, 1, 'Stored device density prevents repeated resize calls');

  window.devicePixelRatio = 1.25;
  map.schedule(); flush();
  assert.equal(resizes, 2);
  assert.equal(map.deviceDpr, 1.25);
  assert.equal(map.dpr, 1.25);
  assert.ok(map.canvases.every(canvas => canvas.width === 1000 && canvas.height === 750));
  assert.deepEqual(counters.map(counter => counter.clear), before.map(value => value + 1), 'Changed raster density repaints all canvas layers');
  assert.deepEqual(map.offset, offset);
  assert.equal(map.zoom, 1);
  assert.equal(map.chunkAt({ x: 150, y: 150 }), '7495');

  window.devicePixelRatio = 0.75;
  map.schedule(); flush();
  assert.equal(map.deviceDpr, 1);
  assert.equal(map.dpr, 1);
  const settledResizes = resizes;
  map.schedule(); flush();
  assert.equal(resizes, settledResizes, 'Sub-1 browser density uses the same normalization in resize and schedule');
});

test('a stage resize repaints every layer before the browser paints, so no empty map frame shows', t => {
  const { map, counters, stage, frames, flush } = harness(t, { pins: true });
  const before = counters.map(counter => counter.clear);
  // A status line appearing above the map shrinks the stage; setting canvas sizes wipes them.
  stage.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 582 });
  map.resize();
  assert.ok(map.canvases.every(canvas => canvas.height === Math.round(582 * map.dpr)));
  assert.deepEqual(counters.map(counter => counter.clear), before.map(value => value + 1), 'Resize repaints all layers in the same task');
  assert.equal(map.frame, null, 'No repaint is left waiting for the next frame');
  flush();
  assert.equal(frames.size, 0);
  assert.deepEqual(counters.map(counter => counter.clear), before.map(value => value + 1), 'The next frame does not paint again');
});

test('cached reveal path follows pan and zoom and restores the canvas before annotations', t => {
  const { map, counters, flush } = harness(t, { path2D: true });
  map.image.onload(); flush();
  const stateContext = map.contexts[1], reveal = map.revealPath;
  map.zoom = 0.5;
  map.offset = { x: 40, y: 60 };
  counters[1].draws.length = counters[1].clips.length = counters[1].outlines.length = 0;
  map.invalidate(true, true, true); flush();
  assert.equal(counters[1].clips.length, 1);
  assert.equal(counters[1].clips[0].path, reveal);
  assert.deepEqual(sortedRectangles(counters[1].clips[0].rectangles), physicalRectangles(map, [[40, 60, 64, 64], [40, 124, 64, 64]]));
  assert.equal(counters[1].draws.length, 1, 'Both revealed cells share one terrain draw');
  assert.deepEqual(counters[1].draws[0].transform, [map.dpr, 0, 0, map.dpr, 0, 0], 'Terrain uses viewport coordinates after clipping');
  assert.deepEqual(sortedRectangles(counters[1].draws[0].clip), physicalRectangles(map, [[40, 60, 64, 64], [40, 124, 64, 64]]));
  assert.ok(counters[1].outlines.length > 0, 'Selection annotation paints after terrain');
  assert.ok(counters[1].outlines.every(outline => outline.clip === null), 'Annotations must not inherit the reveal clip');
  assert.equal(stateContext.clipRectangles, null);
  assert.deepEqual(stateContext.transform, [map.dpr, 0, 0, map.dpr, 0, 0]);

  map.zoom = 1.5;
  map.offset = { x: -12, y: 8 };
  counters[1].clips.length = 0;
  map.invalidate(true, true, true); flush();
  assert.equal(map.revealPath, reveal, 'Pan and zoom reuse model geometry');
  assert.deepEqual(sortedRectangles(counters[1].clips[0].rectangles), physicalRectangles(map, [[-12, 8, 192, 192], [-12, 200, 192, 192]]));
  assert.equal(stateContext.clipRectangles, null);
});

test('reveal geometry refreshes for member, group, progress and world changes', t => {
  const { map, world, state, counters, flush } = harness(t, { path2D: true });
  const apply = model => { counters[1].clips.length = 0; map.setModel(model); flush(); };
  const rectangles = () => sortedRectangles(counters[1].clips.at(-1).rectangles);
  let priorPath = map.revealPath;
  apply({ world, state, memberId: 'two' });
  assert.notEqual(map.revealPath, priorPath);
  assert.deepEqual(rectangles(), physicalRectangles(map, [[228, 100, 128, 128]]), 'Individual view reveals only the active member');
  assert.equal(map.cellStates.get('7495').owners.length, 0);
  assert.equal(map.cellStates.get('7751').owners[0].id, 'two');

  priorPath = map.revealPath;
  apply({ world, state, memberId: 'two', groupView: true });
  assert.notEqual(map.revealPath, priorPath);
  assert.deepEqual(rectangles(), physicalRectangles(map, [[100, 100, 128, 128], [100, 228, 128, 128], [228, 100, 128, 128]]));

  const changedState = structuredClone(state);
  changedState.members[0].unlocked = [];
  changedState.members[0].selected = [];
  changedState.members[0].pendingRoll = ['7494'];
  changedState.members[1].unlocked = ['7495'];
  priorPath = map.revealPath;
  apply({ world, state: changedState, memberId: 'two', groupView: true });
  assert.notEqual(map.revealPath, priorPath);
  assert.deepEqual(rectangles(), physicalRectangles(map, [[100, 100, 128, 128], [100, 228, 128, 128]]), 'Removed ownership stops revealing; pending choice still reveals');
  assert.equal(map.cellStates.get('7751').owners.length, 0);
  assert.equal(map.cellStates.get('7494').pending, true);

  const changedWorld = buildWorld({ chunks: { '7495': {} }, walkableChunks: [], walkableChunksF2P: [] });
  apply({ world: changedWorld, state: changedState, memberId: 'two', groupView: true });
  assert.deepEqual(rectangles(), physicalRectangles(map, [[100, 100, 128, 128]]), 'Unknown world cells cannot retain stale reveal geometry');
  assert.equal(map.cellStates.has('7494'), false);

  changedState.members.forEach(member => { member.unlocked = []; member.selected = []; member.pendingRoll = []; });
  apply({ world: changedWorld, state: changedState, memberId: 'two', groupView: true });
  assert.deepEqual(counters[1].clips, [], 'No revealed cells means no clipped terrain pass');
});

test('reveal fallback clips visible cells in viewport coordinates without Path2D', t => {
  const { map, counters, flush } = harness(t);
  map.image.onload(); flush();
  map.zoom = 0.5;
  map.offset = { x: 40, y: 60 };
  counters[1].clips.length = counters[1].draws.length = 0;
  map.invalidate(true, true, true); flush();
  assert.equal(map.revealPath, null);
  assert.equal(counters[1].clips[0].path, undefined);
  assert.deepEqual(counters[1].clips[0].rectangles, physicalRectangles(map, [[40, 60, 64, 64], [40, 124, 64, 64]]));
  assert.equal(counters[1].draws.length, 1);
  assert.equal(map.contexts[1].clipRectangles, null);
});

test('death skulls paint the state layer and explain the estimate in the hover label', t => {
  const { map, counters, tooltip, flush } = harness(t);
  map.setOverlay('membership'); flush();
  const baseClears = counters[0].clear, stateClears = counters[1].clear;
  map.setDeathMarkers(new Map([['7494', { hours: 2000, thresholdHours: 1000, unknown: [{ detail: 'Unpriced duty' }] }]])); flush();
  assert.equal(counters[0].clear, baseClears, 'Estimate results do not redraw the base artwork');
  assert.equal(counters[1].clear, stateClears + 1); assert.ok(counters[1].text.includes('\u2620'));
  map.pointerMove({ clientX: 160, clientY: 300 }); flush();
  assert.match(tooltip.textContent, /Estimated death chunk for One: about 2,000 h; limit 1,000 h\. Some task times are unknown/);
  assert.equal(map.hoverCanvas.attributes['aria-description'], tooltip.textContent);
  counters[1].text.length = 0; map.zoom = .1; map.setDeathMarkers(map.deathMarkers); flush();
  assert.ok(!counters[1].text.includes('\u2620'), 'Tiny cells omit skulls that would spill into adjacent chunks');
});

test('death skulls paint above pins with owner markers and retain all tooltip lines', t => {
  const { map, world, state, counters, tooltip, flush } = harness(t, { pins: true });
  state.members[1].stickers = { '7751': { type: 'star', text: 'Partner annotation', color: '#ff0000' } };
  map.setModel({ world, state, memberId: 'one', groupView: true });
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [] }, categories: [{ id: 'bank', label: 'Bank' }] },
    { pins: [{ id: 'bank-1', worldX: 178, worldY: 50, chunkId: '7751', categoryId: 'bank', label: 'Partner bank' }] });
  const order = [];
  const originalDraw = map.pins.draw.bind(map.pins), originalSkull = map.drawDeathMarker.bind(map);
  map.pins.draw = (...args) => { order.push('pins'); return originalDraw(...args); };
  map.drawDeathMarker = (...args) => { if (args[1] === '7751') order.push('skull'); return originalSkull(...args); };
  map.setDeathMarkers(new Map([['7751', { hours: 2000, thresholdHours: 1000 }]])); flush();
  assert.deepEqual(order, ['pins', 'skull']);
  assert.ok(!counters[1].text.includes('\u2620'));
  assert.ok(counters[3].text.includes('\u2620'));
  assert.ok(counters[3].text.some(text => text !== '\u2620'), 'Personal annotations also remain on the pin layer');
  map.pointerMove({ clientX: 288, clientY: 170 }); flush();
  assert.match(tooltip.textContent, /Partner bank/);
  assert.match(tooltip.textContent, /Estimated death chunk for One/);
  assert.match(tooltip.textContent, /Two's chunk, not connected for One/);
  assert.match(tooltip.textContent, /Partner annotation/);
});

test('sticker clusters bound four icons, balance members, and count every hidden sticker', () => {
  const make = (owner, count) => ({ id: owner, color: '#00cab8', stickers: { '7495': Array.from({ length: count },
    (_, index) => ({ id: `${owner}-${index}`, type: 'star', color: '#ffffff', text: `Label ${index}` })) } });
  const members = [make('player1', 6), make('player2', 6)];
  const snapshot = structuredClone(members);
  const large = layoutStickerCluster(members, '7495', 128);
  assert.deepEqual(large.markers.map(marker => marker.sticker.id), ['player1-0', 'player2-0', 'player1-1', 'player2-1']);
  assert.equal(large.overflow.count, 8);
  for (const size of [18, 20, 29, 30, 42, 55, 56, 64, 128, 512]) {
    const layout = layoutStickerCluster(members, '7495', size);
    assert.ok(layout.markers.length <= 4);
    assert.equal(layout.markers.length + layout.overflow.count, 12);
    for (const marker of layout.markers) {
      assert.ok(marker.size > 0 && marker.x >= 0 && marker.y >= 0);
      assert.ok(marker.x + marker.size <= size);
      assert.ok(marker.y + marker.size + 4 <= size);
    }
    assert.ok(layout.overflow.x + layout.overflow.width <= size);
    assert.ok(layout.overflow.y + layout.overflow.height <= size + 1e-9);
    for (let a = 0; a < layout.markers.length; a++) for (let b = a + 1; b < layout.markers.length; b++) {
      const first = layout.markers[a], second = layout.markers[b];
      assert.ok(first.x + first.size <= second.x || second.x + second.size <= first.x
        || first.y + first.size + 4 <= second.y || second.y + second.size + 4 <= first.y, 'Icons and owner bars never overlap');
    }
  }
  assert.deepEqual(members, snapshot, 'Layout never changes saved order');
  assert.deepEqual(layoutStickerCluster(members, '7494', 128), { markers: [], overflow: null });
  assert.deepEqual(layoutStickerCluster(members, '7495', 17), { markers: [], overflow: null });
  assert.deepEqual(layoutStickerCluster(members, '7495', NaN), { markers: [], overflow: null });
  const small = layoutStickerCluster([make('player1', 2)], '7495', 128);
  assert.equal(small.markers.length, 2); assert.equal(small.overflow, null);
  members.forEach(member => { member.startingChunk = '7495'; });
  for (let size = 18; size <= 128; size++) {
    const layout = layoutStickerCluster(members, '7495', size);
    for (const marker of layout.markers) assert.ok(marker.size >= 8, 'Starting flags cannot squeeze stickers to unreadable or negative dimensions');
    assert.equal(layout.markers.length + layout.overflow.count, 12);
    assert.ok(layout.overflow.width > 0 && layout.overflow.y + layout.overflow.height <= size + 1e-9);
  }
});

test('group sticker painting keeps owner bars and the hover label lists all twelve texts literally', t => {
  const { map, world, state, tooltip } = harness(t);
  state.members.forEach((owner, ownerIndex) => {
    owner.stickers = { '7495': Array.from({ length: 6 }, (_, index) => ({ id: `${owner.id}-${index}`, type: 'star',
      color: ownerIndex ? '#ff0000' : '#00ff00', text: index === 5 ? `${owner.name}: <b>hidden label</b>` : `${owner.name} label ${index}` })) };
  });
  map.setModel({ world, state, memberId: 'one', groupView: true });
  const glyphs = [], bars = [];
  const context = { strokeText() {}, fillText(value) { glyphs.push(value); },
    fillRect(...rect) { bars.push({ color: this.fillStyle, rect }); } };
  map.drawMarkers(context, '7495', 0, 0, 128);
  assert.equal(glyphs.filter(value => value === '★').length, 4);
  assert.ok(glyphs.includes('+8'));
  assert.equal(bars.filter(bar => bar.color === map.members[0].color).length, 2);
  assert.equal(bars.filter(bar => bar.color === map.members[1].color).length, 2);
  map.pointer = { x: 160, y: 160 };
  map.setHover('7495');
  for (const owner of state.members) for (const marker of owner.stickers['7495']) assert.ok(tooltip.textContent.includes(`${owner.name}: star · ${marker.text}`));
  assert.equal(map.hoverCanvas.attributes['aria-description'], tooltip.textContent);
  map.setModel({ world, state, memberId: 'one', groupView: false });
  map.setHover('7495');
  assert.ok(!tooltip.textContent.includes('Two label'), 'Personal view shows the active member only');
});

test('dragging a known chunk pans without selecting it', t => {
  const { map, chosen, flush } = harness(t);
  map.pointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 160, clientY: 170 });
  map.pointerMove({ pointerId: 1, clientX: 220, clientY: 200 });
  flush();
  assert.deepEqual(map.offset, { x: 160, y: 130 });
  map.pointerUp({ pointerId: 1, clientX: 220, clientY: 200 });
  assert.deepEqual(chosen, []);
});

test('group view retains member ownership and artwork failures preserve state outlines', t => {
  const { map, world, state, stage, counters, flush, frames } = harness(t);
  map.setModel({ world, state, memberId: 'one', groupView: true, pool: { eligible: [{ id: '7494' }] } });
  assert.deepEqual([...map.unlocked], ['7495', '7751']);
  assert.equal(map.poolIds.has('7494'), true);
  map.image.onload();
  flush();
  assert.equal(stage.dataset.mapImage, 'ready');
  assert.ok(counters[0].terrain > 0);
  const outlines = counters[1].outline;
  map.image.onerror();
  flush();
  assert.equal(stage.dataset.mapImage, 'error');
  assert.ok(counters[1].outline > outlines);
  assert.equal(map.centerOnChunk('7750'), false);
  assert.equal(map.centerOnChunk('7751'), true);
  map.dispose();
  assert.equal(frames.size, 0);
  assert.equal(map.image.onload, null);
  assert.equal(map.image.onerror, null);
});

test('local terrain waits for the original base and an artwork error releases the loading gate', t => {
  const { map, counters, flush } = harness(t);
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2,
    tiles: [{ x: 29, y: 71, path: 'terrain/28/2/0_29_71.png', status: 'downloaded' }] } }, {});
  flush();
  assert.equal(map.terrain.waitForFallback, true);
  assert.equal(map.terrain.pending.size, 0, 'The complete original base has decode priority');
  assert.ok(counters[0].text.includes('Loading world artwork…'), 'Local assets do not hide initial artwork status');
  map.image.onerror(); flush();
  assert.equal(map.terrain.waitForFallback, false);
  assert.equal(map.terrain.pending.size, 1, 'Usable local artwork still loads when the original fails');
});

test('a decoded original supplies the terrain underlay before local detail starts', t => {
  const { map, flush } = harness(t);
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2,
    tiles: [{ x: 29, y: 71, path: 'terrain/28/2/0_29_71.png', status: 'downloaded' }] } }, {});
  flush();
  map.image.onload(); flush();
  assert.equal(map.terrain.fallbackImage, map.image);
  assert.equal(map.terrain.waitForFallback, false);
  assert.equal(map.terrain.pending.size, 1);
});

test('group view dims a disconnected partner tab and explains travel in its tooltip', t => {
  const { map, world, state, tooltip, flush } = harness(t);
  map.setModel({ world, state, memberId: 'one', groupView: true });
  map.pointerMove({ clientX: 250, clientY: 170 }); flush();
  assert.match(tooltip.textContent, /Two's chunk, not connected for One: no route out/);
  const opacity = [], context = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { opacity.push(this.globalAlpha); }, stroke() {} };
  map.drawOwnerTabs(context, [map.members[1]], 0, 0, 50, '7751'); assert.deepEqual(opacity, [.3]);
  state.members[0].teleports = [{ id: 'out', label: 'Out', destination: '7751', available: true }, { id: 'home', label: 'Home', destination: '7495', available: true }];
  map.setModel({ world, state, memberId: 'one', groupView: true }); flush();
  assert.match(tooltip.textContent, /Two's chunk, connected for One: out: Out teleport; back: Home teleport/);
});

test('membership overlay classifies members, free-to-play and unwalkable chunks', t => {
  const { map, state, flush } = harness(t);
  const world = buildWorld({ chunks: { '7495': {}, '7494': {}, '7751': {} }, walkableChunks: ['7495', '7494'], walkableChunksF2P: ['7494'] });
  map.setModel({ world, state, memberId: 'one' });
  map.setOverlay('membership');
  flush();
  assert.equal(map.overlay, 'membership');
  assert.deepEqual(['7495', '7494', '7751'].map(id => map.membership(id)), ['members', 'f2p', null]);
  map.setOverlay('unknown');
  assert.equal(map.overlay, null);
});

test('local pin filters and hover repaint independently from terrain and model state', t => {
  const { map, counters, flush, tooltip } = harness(t, { pins: true });
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [] }, categories: [{ id: 'bank', label: 'Bank' }] },
    { pins: [{ id: 'bank-1', worldX: 50, worldY: 50, chunkId: '7495', categoryId: 'bank', label: 'Test bank' }] });
  map.image.onload();
  flush();
  const before = counters.map(counts => counts.clear);
  map.setPinFilters({ categoryIds: [], hiddenPinIds: [], search: '' });
  flush();
  assert.deepEqual(counters.map(counts => counts.clear), [before[0], before[1], before[2], before[3] + 1]);
  map.setPinFilters({ categoryIds: ['bank'], hiddenPinIds: [], search: 'test bank' });
  flush();
  const filtered = counters.map(counts => counts.clear);
  map.pointerMove({ clientX: 160, clientY: 170 });
  flush();
  assert.deepEqual(counters.map(counts => counts.clear), [filtered[0], filtered[1], filtered[2] + 1, filtered[3]]);
  assert.match(tooltip.textContent, /Test bank/);
  const hovered = counters.map(counts => counts.clear);
  map.setPinFilters({ hiddenPinIds: ['bank-1'] });
  flush();
  assert.doesNotMatch(tooltip.textContent, /Test bank/);
  assert.deepEqual(counters.slice(0, 3).map(counts => counts.clear), hovered.slice(0, 3));
  map.setPinFilters({ hiddenPinIds: [] });
  flush();
  assert.equal(map.focusPin('missing'), false);
  assert.equal(map.focusPin('bank-1'), true);
  flush();
  assert.equal(map.offset.x + 50 * map.zoom, map.width / 2);
  assert.equal(map.offset.y + 50 * map.zoom, map.height / 2);
});

test('new details appear under a stationary cursor without repainting terrain or state', t => {
  const { map, counters, flush, tooltip } = harness(t, { pins: true });
  map.setMapAssets({ terrain: { mapId: 28, plane: 0, zoom: 2, tiles: [] }, categories: [{ id: 'fishing-spot', label: 'Fishing spot' }] },
    { pins: [{ id: 'fish-1', worldX: 50, worldY: 50, chunkId: '7495', categoryId: 'fishing-spot', label: 'Fishing spot' }] });
  flush(); map.pointerMove({ clientX: 160, clientY: 170 }); flush();
  const before = counters.map(counts => counts.clear);
  const detail = { id: 'fish-1', categoryLabel: 'Fishing spot', description: 'Trout and salmon; fly fishing rod and feathers.', members: false };
  map.setMapInformation({ pinDetails: { pins: [detail] }, connections: { connections: [] } });
  flush();
  assert.match(tooltip.textContent, /Fishing spot: Trout and salmon; fly fishing rod and feathers/);
  assert.doesNotMatch(tooltip.textContent, /2021 pin/);
  assert.equal(map.pinDetailAt(), detail);
  assert.deepEqual(counters.slice(0, 2).map(counts => counts.clear), before.slice(0, 2));
  map.setMapInformation({ pinDetails: { pins: [{ ...detail, title: "Cook's Assistant", categoryLabel: 'Quest start',
    description: 'Start guidance: Talk to the cook in Lumbridge Castle.' }] }, connections: { connections: [] } });
  flush();
  assert.match(tooltip.textContent, /Quest start: Cook's Assistant\. Start guidance: Talk to the cook/);
});
