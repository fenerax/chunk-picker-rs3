import test from 'node:test';
import assert from 'node:assert/strict';
import { MapPinRenderer, PIN_CACHE_PADDING, PIN_AGGREGATION_LIMIT, PIN_ZOOM_REFRESH_MS } from '../app/web/map-pin-renderer.mjs';
import { pinMatchesSearch } from '../app/web/map-pins.mjs';

test('search accepts authored categories without a provider legend match', () => {
  const categories = [{ id: 'invented-category', label: 'Invented place' }];
  const pin = { categoryId: 'invented-category', label: 'Quiet clearing' };
  assert.equal(pinMatchesSearch(pin, 'quiet invented', categories), true);
  assert.equal(pinMatchesSearch(pin, 'missing', categories), false);
  assert.equal(pinMatchesSearch(pin, 'quiet', []), true);
});

function context() {
  return { images: [], rings: [], clears: 0, globalAlpha: 1,
    setTransform(...value) { this.transform = value; }, clearRect() { this.clears++; },
    drawImage(...args) { this.images.push({ args, alpha: this.globalAlpha }); },
    beginPath() {}, arc(...args) { this.rings.push({ args, alpha: this.globalAlpha }); }, stroke() {}, fill() {} };
}
const view = { bounds: { left: 0, top: 0, right: 800, bottom: 600 }, offset: { x: 50, y: 70 },
  zoom: 1, width: 800, height: 600, dpr: 1, unlocked: new Set() };
const pin = { id: 'bank-one', worldX: 100, worldY: 200, chunkId: '7495', categoryId: 'bank', label: 'Bank' };
function fixture(pins = [pin], { ready = true, ...timing } = {}) {
  const canvases = [], images = [], changed = [];
  const renderer = new MapPinRenderer({ categories: [{ id: 'bank', label: 'Bank', icon: '/assets/map/icons/bank.png' }] }, { pins }, {
    canvasFactory(width, height) {
      const ctx = context(), canvas = { width, height, getContext: () => ctx, context: ctx };
      canvases.push(canvas); return canvas;
    },
    imageFactory() { const image = { naturalWidth: 24, naturalHeight: 24, decode: async () => {} }; images.push(image); return image; },
    changed: () => changed.push(true),
    ...timing,
  });
  if (ready) renderer.images.set('bank', { ready: true, image: { naturalWidth: 24, naturalHeight: 24 } });
  return { renderer, canvases, images, changed, main: context() };
}

function clock() {
  let time = 0, next = 0;
  const pending = new Map();
  return { pending,
    now: () => time,
    setTimer(callback, delay) { pending.set(++next, { callback, at: time + delay }); return next; },
    clearTimer(timer) { pending.delete(timer); },
    advance(delta) {
      const end = time + delta;
      while (true) {
        const due = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]); time = due[1].at; due[1].callback();
      }
      time = end;
    },
  };
}

test('padded pin cache paints once per pan and moves hit coordinates with its canvas', () => {
  const { renderer, canvases, main } = fixture();
  renderer.draw(main, view);
  const canvas = canvases[0];
  assert.equal(canvas.context.images.length, 1);
  assert.equal(renderer.at({ x: 150, y: 270 })?.id, pin.id);
  for (const shift of [20, 40, 80, 120]) {
    main.images.length = 0;
    renderer.draw(main, { ...view, offset: { x: 50 + shift, y: 80 } });
    assert.equal(main.images.length, 1);
    assert.equal(main.images[0].args[0], canvas);
    assert.equal(main.images[0].args[1], shift - PIN_CACHE_PADDING);
    assert.equal(canvas.context.clears, 1, 'Safe pans reuse rendered sprites');
    assert.equal(renderer.at({ x: 150 + shift, y: 280 })?.id, pin.id);
    assert.equal(renderer.at({ x: 150, y: 270 }), null, 'Old positions must not remain clickable');
  }
  renderer.draw(main, { ...view, offset: { x: 190, y: 70 } });
  assert.equal(canvas.context.clears, 2, 'Pan beyond the safe padding rebuilds');
  assert.equal(canvases.length, 1, 'Rebuild reuses the bounded canvas allocation');
  renderer.dispose();
});

test('the place-label layer can own text-only pins without hiding icons or reusing stale text', () => {
  const textPin = { ...pin, id: 'town', label: 'Lumbridge', worldX: 120, textOnly: true };
  const raster = context(), texts = [];
  raster.fillText = (...args) => texts.push(args);
  const canvas = { width: 0, height: 0, getContext: () => raster };
  const { renderer, main } = fixture([pin, textPin], { canvasFactory: () => canvas });
  renderer.draw(main, view);
  assert.deepEqual(texts.map(args => args[0]), ['Lumbridge']);
  assert.equal(renderer.visible.length, 2);
  renderer.draw(main, { ...view, textLabels: false });
  assert.deepEqual(renderer.visible.map(entry => entry.pin.id), [pin.id]);
  assert.equal(texts.length, 1); assert.equal(raster.images.length, 2);
  renderer.draw(main, view);
  assert.equal(texts.length, 2); assert.equal(renderer.visible.length, 2);
  assert.equal(raster.clears, 3);
  renderer.focused = textPin.id;
  const rings = raster.rings.length;
  renderer.draw(main, { ...view, textLabels: false });
  assert.equal(texts.length, 2); assert.equal(renderer.visible.length, 2);
  assert.equal(raster.rings.length, rings + 1, 'Search focus retains its location ring');
  renderer.dispose();
});

test('pin cache refreshes filters, focus, unlocked opacity, zoom and DPR/viewport size', () => {
  const { renderer, canvases, main } = fixture();
  renderer.draw(main, view);
  const canvas = canvases[0], ctx = canvas.context;
  assert.equal(ctx.images.at(-1).alpha, 0.72);
  const unlocked = new Set([pin.chunkId]);
  renderer.draw(main, { ...view, unlocked });
  assert.equal(ctx.clears, 2); assert.equal(ctx.images.at(-1).alpha, 1);
  unlocked.clear(); renderer.draw(main, { ...view, unlocked });
  assert.equal(ctx.clears, 3); assert.equal(ctx.images.at(-1).alpha, 0.72);
  renderer.focused = pin.id; renderer.draw(main, view);
  assert.equal(ctx.clears, 4); assert.equal(ctx.images.at(-1).alpha, 1);
  assert.equal(ctx.strokeStyle, '#fff');
  renderer.focused = null;
  renderer.setFilters({ search: 'bank' }); renderer.draw(main, view);
  assert.equal(ctx.clears, 5); assert.equal(ctx.strokeStyle, '#ffe55c');
  renderer.setFilters({ hiddenPinIds: [pin.id] }); renderer.draw(main, view);
  assert.equal(ctx.clears, 6); assert.equal(renderer.at({ x: 150, y: 270 }), null);
  renderer.setFilters({ hiddenPinIds: [], categoryIds: [] }); renderer.draw(main, view);
  assert.equal(ctx.clears, 7); assert.equal(renderer.visible.length, 0);
  renderer.setFilters({ categoryIds: ['bank'], search: '' }); renderer.draw(main, { ...view, zoom: 2 });
  assert.equal(ctx.clears, 8);
  renderer.draw(main, { ...view, zoom: 2, width: 900, height: 700, dpr: 2 });
  assert.equal(ctx.clears, 9);
  assert.equal(canvas.width, (900 + PIN_CACHE_PADDING * 2) * 2);
  assert.equal(canvas.height, (700 + PIN_CACHE_PADDING * 2) * 2);
  assert.deepEqual(ctx.transform, [2, 0, 0, 2, 0, 0]);
  renderer.dispose();
});

test('decoded icons invalidate cached placeholders and disposal releases canvas and hits', async () => {
  const { renderer, canvases, images, changed, main } = fixture([pin], { ready: false });
  renderer.draw(main, view);
  const canvas = canvases[0];
  assert.equal(canvas.context.images.length, 0);
  assert.equal(images.length, 1);
  images[0].onload(); await Promise.resolve();
  assert.equal(changed.length, 1);
  renderer.draw(main, view);
  assert.equal(canvas.context.clears, 2);
  assert.equal(canvas.context.images.length, 1);
  renderer.dispose();
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  assert.equal(renderer.cache, null); assert.equal(renderer.at({ x: 150, y: 270 }), null);
  assert.equal(images[0].onload, null);
  const draws = main.images.length; renderer.draw(main, view); assert.equal(main.images.length, draws);
});

test('closely spaced zooms reproject pins and hits, then the deadline restores fixed icon size', () => {
  const timers = clock(), { renderer, canvases, changed, main } = fixture([pin], timers);
  renderer.draw(main, view);
  const canvas = canvases[0], radius = renderer.visible[0].radius;
  timers.advance(10);
  renderer.draw(main, { ...view, zoom: 1.1 });
  assert.equal(canvas.context.clears, 1, 'First modest zoom reuses sprite bitmap');
  assert.equal(main.images.at(-1).args[3], canvas.width * 1.1);
  assert.equal(renderer.at({ x: 160, y: 290 })?.id, pin.id);
  assert.equal(renderer.at({ x: 160 + radius * 1.1 - 0.1, y: 290 })?.id, pin.id);
  assert.equal(renderer.at({ x: 160 + radius * 1.1 + 0.1, y: 290 }), null);
  assert.equal(timers.pending.size, 1);
  timers.advance(10);
  renderer.draw(main, { ...view, zoom: 1.15 });
  assert.equal(canvas.context.clears, 1);
  assert.equal(timers.pending.size, 1, 'Further zoom input does not extend the deadline or create timers');
  timers.advance(PIN_ZOOM_REFRESH_MS - 21);
  assert.equal(changed.length, 0);
  timers.advance(1);
  assert.equal(changed.length, 1, 'Idle zoom still requests a pin-only refresh by the original deadline');
  renderer.draw(main, { ...view, zoom: 1.15 });
  assert.equal(canvas.context.clears, 2);
  assert.equal(renderer.cache.zoom, 1.15);
  assert.equal(main.images.at(-1).args[3], canvas.width, 'Refreshed bitmap is no longer scaled');
  assert.equal(renderer.visible[0].radius, (16 + Math.log2(1.15 / 0.5) * 3) / 2);
  assert.equal(timers.pending.size, 0);
  renderer.dispose();
});

test('zoom reprojects only within ratio and viewport coverage limits, and disposal cancels its timer', () => {
  const timers = clock(), { renderer, canvases, changed, main } = fixture([pin], timers);
  renderer.draw(main, view);
  const ctx = canvases[0].context;
  timers.advance(5);
  renderer.draw(main, { ...view, zoom: 1.2 });
  assert.equal(ctx.clears, 2, 'Ratio above 1.18 refreshes immediately');
  timers.advance(5);
  renderer.draw(main, { ...view, zoom: 1 });
  assert.equal(ctx.clears, 3, 'Ratio below 0.85 refreshes immediately');
  renderer.draw(main, { ...view, zoom: 1.05, offset: { x: 500, y: 70 } });
  assert.equal(ctx.clears, 4, 'Insufficient padded viewport coverage refreshes immediately');
  renderer.draw(main, { ...view, zoom: 1.1, offset: { x: 500, y: 70 } });
  assert.equal(timers.pending.size, 1);
  renderer.dispose();
  assert.equal(timers.pending.size, 0);
  timers.advance(100);
  assert.equal(changed.length, 0, 'Disposed renderer cannot request a delayed redraw');
});

test('non-zoom invalidations refresh immediately during a batched zoom', async () => {
  const timers = clock(), { renderer, canvases, images, main } = fixture([pin], { ready: false, ...timers });
  let zoom = 1, unlocked = new Set(), width = view.width, dpr = 1;
  const draw = () => renderer.draw(main, { ...view, zoom, unlocked, width, dpr });
  draw();
  const ctx = canvases[0].context;
  const batch = () => { zoom *= 1.02; draw(); assert.equal(timers.pending.size, 1); };
  const refresh = change => {
    const before = ctx.clears; batch(); assert.equal(ctx.clears, before);
    change(); draw(); assert.equal(ctx.clears, before + 1); assert.equal(timers.pending.size, 0);
  };
  refresh(() => renderer.setFilters({ search: 'bank' }));
  refresh(() => { renderer.focused = pin.id; });
  refresh(() => { unlocked.add(pin.chunkId); });
  refresh(() => { width += 20; });
  refresh(() => { dpr = 2; });
  batch();
  const before = ctx.clears;
  images[0].onload(); await Promise.resolve();
  draw();
  assert.equal(ctx.clears, before + 1, 'Icon decoding never waits for the zoom deadline');
  assert.equal(timers.pending.size, 0);
  renderer.dispose();
});

test('dense intermediate views and overview searches bound sprite rebuilds while retaining focus', () => {
  const pins = Array.from({ length: 3000 }, (_, i) => ({ ...pin, id: `bank-${i}`,
    worldX: 10 + (i % 60) * 70, worldY: 10 + Math.floor(i / 60) * 70 }));
  const { renderer, canvases, main } = fixture(pins);
  renderer.draw(main, { ...view, offset: { x: 0, y: 0 }, zoom: 0.55, width: 1280, height: 800 });
  assert.ok(canvases[0].context.images.length <= PIN_AGGREGATION_LIMIT);
  assert.ok(renderer.cache.visible.length <= PIN_AGGREGATION_LIMIT);
  renderer.setFilters({ search: 'bank' });
  renderer.focused = pins.at(-1).id;
  canvases[0].context.images.length = 0;
  renderer.draw(main, { ...view, offset: { x: 0, y: 0 }, zoom: 0.1, width: 1280, height: 800 });
  assert.ok(canvases[0].context.images.length <= PIN_AGGREGATION_LIMIT);
  assert.ok(renderer.cache.visible.length <= PIN_AGGREGATION_LIMIT);
  const focused = pins.at(-1), point = { x: focused.worldX * 0.1, y: focused.worldY * 0.1 };
  assert.equal(renderer.at(point)?.id, focused.id, 'Focus survives aggregation and paints above overlapping representatives');
  assert.ok(canvases[0].context.images.every(call => call.alpha === 1), 'Search highlights preserve opacity');
  renderer.dispose();
});

test('intermediate-zoom representatives stay the same while the map pans', () => {
  // Several pins share each crowded spot, so a screen-anchored grid would swap them.
  const pins = Array.from({ length: 3000 }, (_, i) => ({ ...pin, id: `bank-${String(i).padStart(4, '0')}`,
    worldX: 10 + (i % 60) * 70 + (i % 7) * 9, worldY: 10 + Math.floor(i / 60) * 70 + (i % 5) * 11 }));
  const { renderer } = fixture(pins);
  const zoom = 0.8, width = 1280, height = 800;
  const shown = offset => {
    const ids = new Set();
    for (const { pin: drawn } of renderer.paint(context(), { offset, zoom, unlocked: new Set(), width, height })) {
      const x = offset.x + drawn.worldX * zoom, y = offset.y + drawn.worldY * zoom;
      // Compare a central window that stays well inside both views.
      if (x > 400 && x < 880 && y > 250 && y < 550) ids.add(`${drawn.id}@${Math.round(x - offset.x)},${Math.round(y - offset.y)}`);
    }
    return ids;
  };
  const before = shown({ x: -600, y: -500 });
  assert.ok(before.size > 10);
  for (const [dx, dy] of [[37, 0], [-53, 21], [128 * zoom, 0], [11, -64]]) {
    const after = shown({ x: -600 + dx, y: -500 + dy });
    const inBoth = [...before].filter(id => {
      const [, at] = id.split('@'), [x, y] = at.split(',').map(Number);
      return x - 600 + dx > 400 && x - 600 + dx < 880 && y - 500 + dy > 250 && y - 500 + dy < 550;
    });
    for (const id of inBoth) assert.ok(after.has(id), `pan ${dx},${dy} kept ${id}`);
  }
  renderer.dispose();
});

test('DOM-less fallback remains usable and explicitly non-surface pins are excluded', () => {
  const renderer = new MapPinRenderer({ categories: [{ id: 'bank', label: 'Bank' }] }, { pins: [pin,
    { ...pin, id: 'upstairs', plane: 1 }, { ...pin, id: 'dungeon', mapId: 29 }, { ...pin, id: 'surface', mapId: 28, plane: 0, worldX: 200 }] },
  { canvasFactory: () => null });
  assert.deepEqual([...renderer.pins.keys()], ['bank-one', 'surface']);
  renderer.draw(context(), view);
  assert.equal(renderer.at({ x: 150, y: 270 })?.id, pin.id);
  assert.equal(renderer.cache, null);
  renderer.dispose();
});
