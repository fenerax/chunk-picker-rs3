import test from 'node:test';
import assert from 'node:assert/strict';
import { MapActivityLayerRenderer, ACTIVITY_CACHE_PADDING } from '../app/web/map-activity-layer-renderer.mjs';

const view = { width: 256, height: 256, zoom: 1, dpr: 1, offset: { x: 0, y: 0 } };
function context() {
  const calls = [];
  const ctx = { calls };
  for (const method of ['save', 'restore', 'setTransform', 'beginPath', 'moveTo', 'lineTo', 'rect', 'setLineDash', 'clearRect', 'drawImage']) {
    ctx[method] = (...args) => calls.push([method, ...args]);
  }
  ctx.stroke = () => calls.push(['stroke', ctx.strokeStyle, ctx.lineWidth, ctx.lineCap]);
  return ctx;
}
function renderer(rows = [['a', { x: 0, y: 0 }]], clues = [['a', [{ tier: 'easy' }]]], slayer = [['a', [{ label: 'Cow' }]]]) {
  const layer = new MapActivityLayerRenderer();
  layer.setModel({ clues: new Map(clues), slayer: new Map(slayer) }, new Map(rows));
  return layer;
}

test('activity layers default off and perform zero canvas operations', () => {
  const layer = renderer(), ctx = context();
  assert.deepEqual(layer.draw(ctx, view), { clues: 0, slayer: 0 });
  assert.deepEqual(layer.draw(ctx, view, { clueTier: 'off', showSlayer: false }), { clues: 0, slayer: 0 });
  assert.deepEqual(ctx.calls, []);
});

test('activity layers cull offscreen cells before issuing paths, including viewport edges and pan', () => {
  const rows = [['a', { x: 0, y: 0 }], ['b', { x: 2, y: 0 }], ['c', { x: -1, y: 0 }], ['d', { x: 0, y: 2 }]];
  const layer = renderer(rows, rows.map(([id]) => [id, [{ tier: 'easy' }]]), []), ctx = context();
  assert.deepEqual(layer.draw(ctx, view, { clueTier: 'all' }), { clues: 1, slayer: 0 });
  assert.equal(ctx.calls.filter(([op]) => op === 'moveTo').length, 4);
  const shifted = context();
  assert.deepEqual(layer.draw(shifted, { ...view, offset: { x: -256, y: 0 } }, { clueTier: 'easy' }), { clues: 1, slayer: 0 });
  assert.equal(shifted.calls.find(([op]) => op === 'moveTo')[1], 5);
  const outside = context();
  layer.draw(outside, { ...view, offset: { x: 1000, y: 1000 } }, { clueTier: 'all', showSlayer: true });
  assert.deepEqual(outside.calls, []);
});

test('tier switching uses precompiled masks and all includes every supported tier', () => {
  const tiers = ['easy', 'medium', 'hard', 'elite', 'master'];
  const rows = tiers.map((tier, x) => [tier, { x, y: 0 }]);
  const model = { clues: new Map(tiers.map(tier => [tier, [{ tier }]])), slayer: new Map() };
  const layer = new MapActivityLayerRenderer(); layer.setModel(model, new Map(rows));
  model.clues.get = () => { throw new Error('model lookup during drawing'); };
  for (const tier of tiers) assert.deepEqual(layer.draw(context(), { ...view, width: 1000 }, { clueTier: tier }), { clues: 1, slayer: 0 });
  assert.deepEqual(layer.draw(context(), { ...view, width: 1000 }, { clueTier: 'all' }), { clues: 5, slayer: 0 });
  const ctx = context(); layer.draw(ctx, view, { clueTier: 'unknown' }); assert.deepEqual(ctx.calls, []);
});

test('clues and Slayer coexist with separate insets, dark casing, no fills or text, and restored state', () => {
  for (const theme of ['dark', 'gray', 'light']) {
    const layer = renderer(), ctx = context();
    assert.deepEqual(layer.draw(ctx, { ...view, dpr: 1.5 }, { clueTier: 'easy', showSlayer: true, theme }), { clues: 1, slayer: 1 });
    const strokes = ctx.calls.filter(([op]) => op === 'stroke');
    assert.deepEqual(strokes.map(call => call[2]), [3.5, 1.5, 3.5, 1.5]);
    assert.equal(strokes[0][1], '#10131a'); assert.equal(strokes[2][1], '#10131a');
    assert.equal(strokes[3][1], '#cb99ff'); assert.notEqual(strokes[1][1], strokes[3][1]);
    assert.deepEqual(ctx.calls.find(([op]) => op === 'rect'), ['rect', 10, 10, 108, 108]);
    assert.deepEqual(ctx.calls.filter(([op]) => op === 'setLineDash'), [['setLineDash', []], ['setLineDash', [0, 5]]]);
    assert.deepEqual(ctx.calls.find(([op]) => op === 'setTransform'), ['setTransform', 1.5, 0, 0, 1.5, 0, 0]);
    assert.equal(ctx.calls[0][0], 'save'); assert.equal(ctx.calls.at(-1)[0], 'restore');
  }
  const ctx = context(); renderer().draw(ctx, view, { showSlayer: true });
  assert.deepEqual(ctx.calls.find(([op]) => op === 'rect'), ['rect', 5, 5, 118, 118]);
});

test('full-crop operation cost uses one path and two strokes per enabled layer', () => {
  const rows = [];
  for (let x = 0; x < 47; x++) for (let y = 0; y < 50; y++) rows.push([`${x},${y}`, { x, y }]);
  const layer = renderer(rows, rows.map(([id]) => [id, [{ tier: 'easy' }]]), rows.map(([id]) => [id, [{ label: 'Cow' }]]));
  const ctx = context();
  assert.deepEqual(layer.draw(ctx, { ...view, width: 1280, height: 800, zoom: .055 }, { clueTier: 'all', showSlayer: true }), { clues: 2350, slayer: 2350 });
  assert.equal(ctx.calls.filter(([op]) => op === 'beginPath').length, 2);
  assert.equal(ctx.calls.filter(([op]) => op === 'stroke').length, 4);
  assert.equal(ctx.calls.filter(([op]) => op === 'save').length, 1);
  assert.equal(ctx.calls.filter(([op]) => op === 'rect').length, 2350);
  assert.ok(ctx.calls.filter(([op]) => op === 'rect').every(([, , , width, height]) => width > 0 && height > 0));
});

test('model replacement clears old geometry and invalid view or geometry draws nothing', () => {
  const layer = renderer();
  layer.setModel({ clues: new Map([['a', [{ tier: 'easy' }]]]) }, new Map([['a', { x: NaN, y: 0 }]]));
  const ctx = context(); layer.draw(ctx, view, { clueTier: 'all', showSlayer: true });
  assert.deepEqual(ctx.calls, []);
  layer.setModel(null, null);
  assert.deepEqual(layer.entries, []);
  const valid = renderer(); valid.draw(ctx, { ...view, zoom: Infinity }, { clueTier: 'all' });
  assert.deepEqual(ctx.calls, []);
});

function cachedFixture() {
  const canvases = [], timers = new Map(); let time = 0, timerId = 0, invalidations = 0;
  const layer = new MapActivityLayerRenderer({
    canvasFactory(width, height) { const ctx = context(); const canvas = { width, height, getContext: () => ctx }; canvases.push({ canvas, ctx }); return canvas; },
    now: () => time, onInvalidate: () => invalidations++,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const cells = new Map(Array.from({ length: 10 }, (_, x) => [String(x), { x, y: 0 }]));
  const model = { clues: new Map([...cells.keys()].map(id => [id, [{ tier: 'easy' }]])), slayer: new Map([...cells.keys()].map(id => [id, [{ label: 'Cow' }]])) };
  layer.setModel(model, cells);
  return { layer, canvases, timers, cells, model, setTime: value => { time = value; }, invalidations: () => invalidations };
}
const both = { clueTier: 'easy', showSlayer: true, theme: 'dark' };

test('padded activity bitmap bounds backing size and safe pans issue one blit without any paths', () => {
  const f = cachedFixture(), ctx = context();
  assert.deepEqual(f.layer.draw(ctx, view, both), { clues: 2, slayer: 2 });
  assert.equal(f.canvases.length, 1);
  const { canvas, ctx: bitmap } = f.canvases[0], pathCalls = bitmap.calls.length;
  assert.equal(canvas.width, view.width + ACTIVITY_CACHE_PADDING * 2);
  assert.equal(canvas.height, view.height + ACTIVITY_CACHE_PADDING * 2);
  assert.equal(bitmap.calls.filter(([op]) => op === 'stroke').length, 4);
  ctx.calls.length = 0;
  assert.deepEqual(f.layer.draw(ctx, { ...view, offset: { x: -40, y: 0 } }, both), { clues: 3, slayer: 3 });
  assert.equal(f.canvases.length, 1); assert.equal(bitmap.calls.length, pathCalls);
  assert.equal(ctx.calls.filter(([op]) => op === 'drawImage').length, 1);
  assert.ok(!ctx.calls.some(([op]) => ['beginPath', 'stroke', 'rect', 'moveTo'].includes(op)));
  const blit = ctx.calls.find(([op]) => op === 'drawImage');
  assert.equal(blit[2], -200); assert.equal(blit[3], -160);
  f.layer.draw(context(), { ...view, offset: { x: -161, y: 0 } }, both);
  assert.equal(f.canvases.length, 2); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('tier, theme, model, dimensions and DPR changes invalidate and release activity bitmap', () => {
  const f = cachedFixture(); let prior;
  const draw = (v, p) => {
    f.layer.draw(context(), v, p);
    if (prior) assert.equal(prior.width, 0);
    prior = f.layer.cache.canvas;
  };
  draw(view, both);
  draw(view, { ...both, clueTier: 'all' });
  draw(view, { ...both, theme: 'light' });
  draw({ ...view, width: 300 }, both);
  draw({ ...view, dpr: 2 }, both);
  assert.equal(prior.width, Math.ceil((view.width + ACTIVITY_CACHE_PADDING * 2) * 1.5), 'Backing density capped at 1.5');
  f.layer.setModel(f.model, f.cells); assert.equal(prior.width, 0); prior = null;
  draw(view, both);
  assert.equal(f.canvases.length, 6);
});

test('short zoom reprojects bitmap correctly and timer refreshes fixed CSS outline widths', () => {
  const f = cachedFixture(); f.layer.draw(context(), view, both);
  const bitmap = f.layer.cache.canvas, ctx = context(); f.setTime(10);
  const zoomed = { ...view, zoom: 1.1, offset: { x: -12, y: -8 } };
  f.layer.draw(ctx, zoomed, both);
  assert.equal(f.layer.cache.canvas, bitmap); assert.equal(f.timers.size, 1);
  const blit = ctx.calls.find(([op]) => op === 'drawImage');
  assert.ok(Math.abs(blit[2] - (-12 - 160 * 1.1)) < 1e-9);
  assert.ok(Math.abs(blit[4] - (256 + 320) * 1.1) < 1e-9);
  const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 90);
  f.timers.clear(); f.setTime(100); timer.callback(); assert.equal(f.invalidations(), 1);
  f.layer.draw(context(), zoomed, both);
  assert.notEqual(f.layer.cache.canvas, bitmap); assert.equal(bitmap.width, 0);
  assert.equal(f.layer.cache.zoom, 1.1);
  assert.deepEqual(f.canvases.at(-1).ctx.calls.filter(([op]) => op === 'stroke').map(call => call[2]), [3.5, 1.5, 3.5, 1.5]);
});

test('uncovered zoom immediately rebuilds and off/dispose cancel pending work and release backing', () => {
  const f = cachedFixture(); f.layer.draw(context(), view, both);
  f.layer.draw(context(), { ...view, zoom: .5 }, both);
  assert.equal(f.canvases.length, 2); assert.equal(f.layer.cache.zoom, .5);
  f.setTime(10); f.layer.draw(context(), { ...view, zoom: .51 }, both); assert.equal(f.timers.size, 1);
  const canvas = f.layer.cache.canvas, ctx = context();
  f.layer.draw(ctx, view, { clueTier: 'off', showSlayer: false });
  assert.deepEqual(ctx.calls, []); assert.equal(f.timers.size, 0); assert.equal(canvas.width, 0);
  f.layer.draw(context(), view, both); const final = f.layer.cache.canvas;
  f.layer.dispose(); assert.equal(final.width, 0); assert.equal(final.height, 0); assert.equal(f.layer.cache, null);
  f.layer.draw(ctx, view, both); assert.deepEqual(ctx.calls, []);
});

test('dense cached composition uses at most three cell sprites, bounded vector work and one safe-pan blit', () => {
  const canvases = [];
  const layer = new MapActivityLayerRenderer({ canvasFactory(width, height) {
    const ctx = context(), canvas = { width, height, getContext: () => ctx };
    canvases.push({ canvas, ctx, initialWidth: width, initialHeight: height }); return canvas;
  } });
  const cells = new Map(), clues = new Map(), slayer = new Map();
  for (let x = 0; x < 47; x++) for (let y = 0; y < 50; y++) {
    const id = `${x},${y}`, kind = (x + y) % 3;
    cells.set(id, { x, y });
    if (kind !== 1) clues.set(id, [{ tier: 'easy' }]);
    if (kind !== 0) slayer.set(id, [{ label: 'Cow' }]);
  }
  layer.setModel({ clues, slayer }, cells);
  const v = { ...view, width: 1280, height: 800, zoom: .1, dpr: 1.5 }, ctx = context();
  layer.draw(ctx, v, both);
  assert.equal(canvases.length, 4, 'One viewport cache and three shared sprites');
  const bitmap = canvases[0], sprites = canvases.slice(1);
  assert.equal(bitmap.ctx.calls.filter(([op]) => op === 'drawImage').length, 2350);
  assert.ok(!bitmap.ctx.calls.some(([op]) => ['stroke', 'beginPath', 'rect', 'moveTo'].includes(op)));
  assert.equal(sprites.flatMap(sprite => sprite.ctx.calls).filter(([op]) => op === 'beginPath').length, 4);
  assert.equal(sprites.flatMap(sprite => sprite.ctx.calls).filter(([op]) => op === 'stroke').length, 8);
  for (const sprite of sprites) {
    assert.equal(sprite.initialWidth, Math.ceil((128 * .1 + 4) * 1.5));
    assert.equal(sprite.initialHeight, sprite.initialWidth);
    assert.equal(sprite.canvas.width, 0); assert.equal(sprite.canvas.height, 0);
  }
  const blit = bitmap.ctx.calls.find(([op]) => op === 'drawImage');
  assert.ok(Math.abs(blit[2] - (ACTIVITY_CACHE_PADDING - 2)) < 1e-9);
  assert.equal(blit[4], sprites[0].initialWidth / v.dpr, 'Ceil padding preserves pixels without stretching the cell geometry');
  const prior = bitmap.ctx.calls.length; ctx.calls.length = 0;
  layer.draw(ctx, { ...v, offset: { x: 8, y: -8 } }, both);
  assert.equal(canvases.length, 4); assert.equal(bitmap.ctx.calls.length, prior);
  assert.equal(ctx.calls.filter(([op]) => op === 'drawImage').length, 1);
  layer.dispose(); assert.equal(bitmap.canvas.width, 0); assert.equal(bitmap.canvas.height, 0);
});

test('sustained covered zoom reuses the bitmap past its build age and settles after last zoom idle', () => {
  const f = cachedFixture(); f.layer.draw(context(), view, both);
  const canvas = f.layer.cache.canvas;
  let previousTimer;
  for (let frame = 1; frame <= 20; frame++) {
    f.setTime(frame * 20);
    const zoom = 1 + frame * .015, ctx = context();
    f.layer.draw(ctx, { ...view, zoom }, both);
    assert.equal(f.layer.cache.canvas, canvas, `Frame ${frame} reuses covered bitmap`);
    assert.equal(f.timers.size, 1);
    const [timerId, timer] = [...f.timers][0];
    assert.notEqual(timerId, previousTimer); previousTimer = timerId;
    assert.equal(timer.delay, 90);
    assert.equal(ctx.calls.filter(([op]) => op === 'drawImage').length, 1);
    assert.equal(f.canvases.length, 1);
  }
  const settledView = { ...view, zoom: 1.3 }, [timerId, timer] = [...f.timers][0];
  f.setTime(450); f.layer.draw(context(), settledView, both);
  assert.equal([...f.timers.keys()][0], timerId, 'Static redraw does not postpone idle settlement');
  f.setTime(490); f.timers.clear(); timer.callback();
  assert.equal(f.invalidations(), 1);
  f.layer.draw(context(), settledView, both);
  assert.equal(f.canvases.length, 2); assert.equal(canvas.width, 0);
  assert.equal(f.layer.cache.zoom, 1.3); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.canvases.at(-1).ctx.calls.filter(([op]) => op === 'stroke').map(call => call[2]), [3.5, 1.5, 3.5, 1.5]);
});

test('zoom beyond modest reprojection range rebuilds and returning to original zoom cancels idle work', () => {
  const f = cachedFixture(); f.layer.draw(context(), view, both);
  f.layer.draw(context(), { ...view, zoom: 1.3 }, both); assert.equal(f.timers.size, 1);
  f.layer.draw(context(), view, both); assert.equal(f.timers.size, 0);
  const original = f.layer.cache.canvas;
  f.layer.draw(context(), { ...view, zoom: 1.41 }, both);
  assert.equal(f.canvases.length, 2); assert.equal(original.width, 0); assert.equal(f.layer.cache.zoom, 1.41);
});
