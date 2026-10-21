import test from 'node:test';
import assert from 'node:assert/strict';
import { MapTaskCountRenderer } from '../app/web/map-task-count-renderer.mjs';

function context() {
  const calls = [];
  return { calls, font: '', save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    rect() {}, roundRect() {}, fill() {}, stroke() {},
    measureText(text) { calls.push(['measure', text]); return { width: text.length * Number.parseFloat(this.font.slice(5)) * .6 }; },
    fillText(...args) { calls.push(['text', this.font, ...args]); } };
}
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
function assertClear(placements, obstacles = []) {
  for (let i = 0; i < placements.length; i++) {
    assert.ok(placements[i].fontSize >= 11);
    for (const obstacle of obstacles) assert.equal(overlaps(placements[i], obstacle), false,
      `badge ${placements[i].id} overlaps an obstacle`);
    for (let j = i + 1; j < placements.length; j++) assert.equal(overlaps(placements[i], placements[j]), false,
      `badges ${placements[i].id} and ${placements[j].id} overlap`);
  }
}
function fixture(zoom = .055, scale = 1) {
  const cells = new Map(), counts = new Map();
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    const id = String(row * 6 + col);
    cells.set(id, { x: col, y: row }); counts.set(id, Number(id) % 2 ? 7 : 123);
  }
  return { cells, counts, zoom, scale, width: 1600, height: 1000, offset: { x: 600, y: 400 } };
}

test('all 30 adjacent overview counts stay legible and distinct at every supported scale', () => {
  for (const scale of [.6, 1, 2]) for (const zoom of [.055, .08, .16, .25]) {
    const renderer = new MapTaskCountRenderer(), ctx = context(), options = fixture(zoom, scale);
    const size = zoom * 128;
    // Tiny centered labels and ownership tabs occupy most of the adjacent cells.
    options.obstacles = [...options.cells.values()].flatMap(cell => {
      const x = options.offset.x + cell.x * size, y = options.offset.y + cell.y * size;
      return [{ x: x + size * .2, y: y + size * .2, width: size * .6, height: size * .6 },
        { x, y: y + size - 3, width: size, height: 3 }];
    });
    const placements = renderer.draw(ctx, options);
    assert.equal(placements.length, 30, `lost badge at zoom ${zoom}, scale ${scale}`);
    assert.equal(renderer.unplaced, 0);
    assertClear(placements, options.obstacles);
    for (const call of ctx.calls.filter(call => call[0] === 'text')) assert.equal(call.length, 5, 'text must not be compressed with maxWidth');
  }
});

test('200% badges avoid dual flags, stickers, IDs, roll labels and ownership tabs', () => {
  const zoom = .55, size = 128 * zoom, offset = { x: 200, y: 200 };
  const cells = new Map([['first', { x: 0, y: 0 }], ['next', { x: 1, y: 0 }]]);
  const obstacles = [...cells.values()].flatMap(cell => {
    const x = offset.x + cell.x * size, y = offset.y;
    return [
      { x: x + 2, y: y + 3, width: 25, height: 19 }, // owner tab / sticker overflow
      { x: x + 29, y: y + 3, width: 39, height: 35 }, // two sticker columns
      { x: x + 16, y: y + 24, width: 40, height: 30 }, // roll number
      { x: x + 3, y: y + 52, width: 42, height: 17 }, // ID
      { x: x + 45, y: y + 48, width: 10, height: 20 }, // two flags
      { x: x + 57, y: y + 48, width: 10, height: 20 },
    ];
  });
  const placements = new MapTaskCountRenderer().draw(context(), {
    cells, counts: new Map([['first', 173], ['next', 9]]), offset, zoom, scale: 2,
    width: 1000, height: 800, obstacles,
  });
  assert.equal(placements.length, 2);
  assertClear(placements, obstacles);
  assert.ok(placements.every(entry => entry.callout));
});

test('large clear chunks use the top-left inset across the supported zoom range', () => {
  for (const zoom of [.5, 1, 4]) {
    const options = { cells: new Map([['a', { x: 0, y: 0 }]]), counts: new Map([['a', 93]]),
      offset: { x: 100, y: 100 }, zoom, width: 1000, height: 1000, scale: 2 };
    const [entry] = new MapTaskCountRenderer().draw(context(), options);
    assert.equal(entry.callout, false);
    assert.ok(entry.x >= 105 && entry.x <= 114); assert.ok(entry.y >= 105 && entry.y <= 114);
    assertClear([entry]);
  }
});

test('zero, negative, malformed, missing and offscreen counts produce no visible badge', () => {
  const renderer = new MapTaskCountRenderer(), ctx = context();
  const cells = new Map([['zero', { x: 1, y: 1 }], ['negative', { x: 1, y: 1 }],
    ['bad', { x: NaN, y: 0 }], ['fraction', { x: 2, y: 1 }], ['offscreen', { x: 100, y: 100 }]]);
  const counts = new Map([['zero', 0], ['negative', -1], ['missing', 3], ['bad', 9], ['fraction', 1.5], ['offscreen', 8]]);
  assert.deepEqual(renderer.draw(ctx, { cells, counts, zoom: 1, offset: { x: 0, y: 0 }, width: 100, height: 100 }), []);
  assert.deepEqual(renderer.draw(ctx, { cells, counts: null, zoom: 1, offset: { x: 0, y: 0 }, width: 100, height: 100 }), []);
  assert.equal(ctx.calls.filter(call => call[0] === 'text').length, 0);
});

test('pan translates cached layout and matching obstacles without remeasuring counts', () => {
  const renderer = new MapTaskCountRenderer(), ctx = context(), options = fixture();
  options.obstacles = [{ x: 590, y: 370, width: 30, height: 20 }];
  const first = renderer.draw(ctx, options), measurements = ctx.calls.filter(call => call[0] === 'measure').length;
  const second = renderer.draw(ctx, { ...options, offset: { x: 611.25, y: 393.4 },
    obstacles: options.obstacles.map(rect => ({ ...rect, x: rect.x + 11.25, y: rect.y - 6.6 })) });
  assert.equal(renderer.layoutBuilds, 1);
  assert.equal(ctx.calls.filter(call => call[0] === 'measure').length, measurements);
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++) {
    assert.ok(Math.abs(second[i].x - first[i].x - 11.25) < 1e-9);
    assert.ok(Math.abs(second[i].y - first[i].y + 6.6) < 1e-9);
  }
  renderer.draw(ctx, { ...options, scale: 2 }); assert.equal(renderer.layoutBuilds, 2);
  renderer.draw(ctx, { ...options, sceneKey: 2 }); assert.equal(renderer.layoutBuilds, 3);
  renderer.draw(ctx, { ...options, counts: new Map(options.counts) }); assert.equal(renderer.layoutBuilds, 4);
});

test('impossible occupied scene stops with an explicit unplaced count', () => {
  const renderer = new MapTaskCountRenderer();
  const placements = renderer.draw(context(), { counts: new Map([['a', 4]]), cells: new Map([['a', { x: 0, y: 0 }]]),
    zoom: .055, offset: { x: 0, y: 0 }, width: 1000, height: 1000,
    obstacles: [{ x: -10000, y: -10000, width: 20000, height: 20000 }] });
  assert.deepEqual(placements, []); assert.equal(renderer.unplaced, 1);
});

test('viewport-edge callouts retain complete digits during cached pans', () => {
  const renderer = new MapTaskCountRenderer(), options = fixture(.055, 2);
  options.width = 600; options.height = 400; options.offset = { x: 0, y: 0 };
  const first = renderer.draw(context(), options);
  assert.equal(first.length, 30); assertClear(first);
  for (const entry of first) {
    assert.ok(entry.x >= 1 && entry.y >= 1);
    assert.ok(entry.x + entry.width <= 599 && entry.y + entry.height <= 399);
  }
  const second = renderer.draw(context(), { ...options, offset: { x: 550, y: 350 } });
  assert.equal(renderer.layoutBuilds, 1);
  assert.equal(second.length, 30); assertClear(second);
  for (const entry of second) {
    assert.ok(entry.x >= 1 && entry.y >= 1);
    assert.ok(entry.x + entry.width <= 599 && entry.y + entry.height <= 399);
  }
});

test('immutable world obstacles bypass normalization on pan and protect viewport repairs', () => {
  const renderer = new MapTaskCountRenderer(), options = fixture(.055, 2), ctx = context();
  const worldObstacles = [{ x: 0, y: 0, width: 45, height: 45 }, { x: 50, y: 0, width: 20, height: 20 }];
  options.width = 600; options.height = 400; options.offset = { x: 0, y: 0 };
  const first = renderer.draw(ctx, { ...options, worldObstacles });
  const cachedIndex = renderer.cache.obstacleIndex;
  assert.equal(first.length, 30); assertClear(first, worldObstacles);
  const secondOffset = { x: 530, y: 350 };
  const second = renderer.draw(ctx, { ...options, offset: secondOffset, worldObstacles,
    obstacles: [{ get x() { throw new Error('screen obstacles must be ignored'); } }] });
  assert.equal(renderer.layoutBuilds, 1); assert.equal(renderer.cache.obstacleIndex, cachedIndex);
  assert.equal(second.length, 30);
  assertClear(second, worldObstacles.map(rect => ({ ...rect, x: rect.x + secondOffset.x, y: rect.y + secondOffset.y })));
  renderer.draw(ctx, { ...options, worldObstacles: [...worldObstacles] });
  assert.equal(renderer.layoutBuilds, 2);
});

test('enormous finite geometry remains bounded and rejects scaled-coordinate overflow', () => {
  const renderer = new MapTaskCountRenderer();
  const placements = renderer.draw(context(), { counts: new Map([['visible', 4], ['huge', 8]]),
    cells: new Map([['visible', { x: 0, y: 0 }], ['huge', { x: Number.MAX_VALUE, y: 0 }]]),
    zoom: 4, offset: { x: 100, y: 100 }, width: 1000, height: 1000,
    worldObstacles: [{ x: 1e300, y: 1e300, width: 50, height: 50 }] });
  assert.equal(placements.length, 1); assert.equal(placements[0].id, 'visible');
  assert.equal(renderer.unplaced, 1);
});

function bitmapFixture() {
  const rasterContext = () => ({ ...context(), setTransform(...args) { this.calls.push(['transform', ...args]); },
    clearRect(...args) { this.calls.push(['clear', ...args]); },
    drawImage(...args) { this.calls.push(['stamp', ...args]); } });
  const bitmapContext = rasterContext(), glyphContext = rasterContext();
  const canvas = { width: 0, height: 0, getContext: () => bitmapContext };
  const glyphCanvas = { width: 0, height: 0, getContext: () => glyphContext };
  let factories = 0;
  const renderer = new MapTaskCountRenderer({ canvasFactory: () => { factories++; return factories === 1 ? canvas : glyphCanvas; } });
  const screen = { ...context(), drawImage(...args) { this.calls.push(['blit', ...args]); },
    clip(...args) { this.calls.push(['clip', ...args]); } };
  return { renderer, screen, canvas, bitmapContext, glyphCanvas, glyphContext, factories: () => factories };
}

test('compact bitmap regions reuse shapes and text over ordinary pans', () => {
  const { renderer, screen, bitmapContext, canvas, factories } = bitmapFixture(), options = fixture();
  options.dpr = 1.5;
  renderer.draw(screen, options);
  const painted = bitmapContext.calls.filter(call => call[0] === 'text').length;
  const measurements = screen.calls.filter(call => call[0] === 'measure').length;
  for (const delta of [5, 25, 64, 120]) renderer.draw(screen, { ...options,
    offset: { x: options.offset.x + delta, y: options.offset.y + delta } });
  assert.equal(renderer.bitmapBuilds, 1); assert.equal(renderer.layoutBuilds, 1);
  assert.equal(bitmapContext.calls.filter(call => call[0] === 'text').length, painted);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
  assert.equal(screen.calls.filter(call => call[0] === 'measure').length, measurements);
  assert.equal(screen.calls.filter(call => call[0] === 'blit').length, renderer.bitmap.regions.length * 5);
  assert.equal(factories(), 2);
  assert.ok(canvas.width * canvas.height < options.width * options.height * options.dpr ** 2 / 4,
    'retained canvas must pack occupied regions rather than allocating the viewport');
  for (const call of screen.calls.filter(call => call[0] === 'blit')) assert.equal(call.length, 10, 'blits must use cropped source rectangles');
  renderer.draw(screen, { ...options, offset: { x: options.offset.x + 200, y: options.offset.y } });
  assert.equal(renderer.bitmapBuilds, 2); assert.equal(renderer.layoutBuilds, 1); assert.equal(factories(), 2);
});

test('grouped bitmap refreshes after zoom and on source, scale, DPR, scene and viewport changes', () => {
  const { renderer, screen, canvas, glyphCanvas, factories } = bitmapFixture();
  let options = fixture();
  renderer.draw(screen, options);
  for (const update of [{ counts: new Map(options.counts) }, { zoom: .08 }, { scale: 2 },
    { dpr: 1.5 }, { sceneKey: 'updated' }, { width: 1500 }, { height: 900 }]) {
    options = { ...options, ...update }; renderer.draw(screen, options);
  }
  assert.equal(renderer.bitmapBuilds, 7); assert.equal(factories(), 2);
  assert.equal(renderer.bitmap.canvas, canvas);
  renderer.clear(); assert.equal(renderer.bitmap, null); assert.equal(renderer.cache, null);
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  assert.equal(glyphCanvas.width, 0); assert.equal(glyphCanvas.height, 0);
});

test('bitmap masks partial original badges and reuses cached glyphs for viewport repairs', () => {
  const { renderer, screen } = bitmapFixture(), options = fixture(.055, 2);
  options.width = 600; options.height = 400; options.offset = { x: 0, y: 0 };
  const entries = renderer.draw(screen, options);
  assert.equal(entries.length, 30); assertClear(entries);
  assert.ok(screen.calls.some(call => call[0] === 'clip' && call[1] === 'evenodd'));
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
  assert.ok(entries.some(entry => entry.repaired));
  assert.ok(screen.calls.filter(call => call[0] === 'blit').length >= 1);
});

test('unavailable offscreen canvas retains vector painting and placement API', () => {
  const renderer = new MapTaskCountRenderer({ canvasFactory: () => null });
  const screen = { ...context(), drawImage() { throw new Error('must use vector fallback'); }, clip() {} };
  const placements = renderer.draw(screen, fixture());
  assert.equal(placements.length, 30); assertClear(placements);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 30);
  assert.equal(renderer.bitmapBuilds, 0);
});

test('empty viewports skip painting and one through eight visible badges reuse cached glyphs', () => {
  const { renderer, screen, factories } = bitmapFixture();
  const options = fixture(4);
  options.width = 100; options.height = 100; options.offset = { x: 5000, y: 5000 };
  assert.deepEqual(renderer.draw(screen, options), []);
  assert.equal(factories(), 0); assert.equal(screen.calls.filter(call => call[0] === 'blit').length, 0);
  options.width = 1600; options.height = 1000; options.zoom = .055; options.offset = { x: 600, y: 400 };
  const source = options.counts;
  for (let count = 1; count <= 8; count++) {
    options.counts = new Map([...source].slice(0, count));
    const entries = renderer.draw(screen, options);
    assert.equal(entries.length, count); assertClear(entries);
    const builds = renderer.bitmapBuilds;
    renderer.draw(screen, { ...options, offset: { x: 605, y: 405 } });
    assert.equal(renderer.bitmapBuilds, builds);
  }
  assert.equal(factories(), 2); assert.equal(renderer.bitmapBuilds, 8);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
});

test('zoom within a stable font size reuses bounded text measurements', () => {
  const renderer = new MapTaskCountRenderer(), ctx = context(), options = fixture(.055);
  renderer.draw(ctx, options);
  const measured = ctx.calls.filter(call => call[0] === 'measure').length;
  for (const zoom of [.08, .12, .25, .45, .65]) renderer.draw(ctx, { ...options, zoom });
  assert.equal(renderer.layoutBuilds, 6);
  assert.equal(ctx.calls.filter(call => call[0] === 'measure').length, measured);
  for (let i = 1; i <= 550; i++) renderer.draw(ctx, { ...options, counts: new Map([['0', i]]) });
  assert.ok(renderer.textMetrics.size <= 512);
  renderer.clear(); assert.equal(renderer.textMetrics.size, 0);
});

test('spread rows crop out empty vertical map space while retaining one region canvas', () => {
  const { renderer, screen, factories } = bitmapFixture(), options = fixture(.65);
  options.offset = { x: 100, y: 100 }; options.width = 1500; options.height = 1000;
  renderer.draw(screen, options);
  const calls = screen.calls.filter(call => call[0] === 'blit');
  assert.equal(factories(), 2); assert.equal(renderer.bitmapBuilds, 1);
  const composited = calls.reduce((area, call) => area + call[8] * call[9], 0);
  assert.ok(composited < options.width * options.height / 4,
    'composited regions should exclude the gaps between badge rows');
  assert.ok(calls.length <= 10, 'nearby horizontal badges should share a crop');
});

test('partially visible 512px source cells cache offscreen corner glyphs for edge repairs', () => {
  const { renderer, screen } = bitmapFixture();
  const options = { counts: new Map([['left', 93]]), cells: new Map([['left', { x: 0, y: 0 }]]),
    zoom: 4, width: 1000, height: 800, dpr: 1.5, offset: { x: -303, y: 100 } };
  for (const x of [-303, -313, -350]) {
    const [entry] = renderer.draw(screen, { ...options, offset: { x, y: 100 } });
    assert.equal(entry.id, 'left'); assert.equal(entry.repaired, true); assertClear([entry]);
    assert.ok(entry.x >= 1 && entry.x + entry.width <= 999);
  }
  assert.ok(renderer.cache.placements[0].x + options.offset.x < -128);
  assert.equal(renderer.bitmap.padding, 512); assert.equal(renderer.bitmapBuilds, 1);
  assert.equal(renderer.bitmap.glyphSources.has('left'), true);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
  assert.equal(screen.calls.filter(call => call[0] === 'blit').length, 3);
});

test('dense zooms within one tier reuse layout while fixed glyphs remain clear in both directions', () => {
  const renderer = new MapTaskCountRenderer(), options = fixture(.055, 2), sceneKey = {};
  options.counts = new Map(); options.cells = new Map(); options.offset = { x: 600, y: 400 };
  for (let row = 0; row < 12; row++) for (let column = 0; column < 15; column++) {
    const id = `${column}:${row}`; options.cells.set(id, { x: column, y: row }); options.counts.set(id, 9);
  }
  for (const zoom of [.055, .056, .057, .058, .059, .06, .061, .059, .057, .055]) {
    const entries = renderer.draw(context(), { ...options, zoom, sceneKey, worldObstacles: [] });
    assert.equal(entries.length, 180); assertClear(entries);
    for (const entry of entries) {
      const cell = options.cells.get(entry.id);
      assert.ok(Math.abs(entry.source.x - (options.offset.x + (cell.x + .5) * 128 * zoom)) < 1e-9);
      assert.ok(Math.abs(entry.source.y - (options.offset.y + (cell.y + .5) * 128 * zoom)) < 1e-9);
    }
  }
  assert.equal(renderer.layoutBuilds, 1);
});

test('new actual obstacles within a zoom tier force replanning and remain valid for viewport repairs', () => {
  const renderer = new MapTaskCountRenderer(), options = fixture(.055), sceneKey = {};
  renderer.draw(context(), { ...options, sceneKey, worldObstacles: [] });
  const original = renderer.cache.placements[0], zoom = .058, ratio = zoom / options.zoom;
  const obstacle = { x: (original.x + original.width / 2) * ratio - original.width / 2,
    y: (original.y + original.height / 2) * ratio - original.height / 2,
    width: original.width, height: original.height };
  const entries = renderer.draw(context(), { ...options, zoom, sceneKey, worldObstacles: [obstacle] });
  assert.equal(renderer.layoutBuilds, 2); assert.equal(entries.length, 30);
  assertClear(entries, [{ ...obstacle, x: obstacle.x + options.offset.x, y: obstacle.y + options.offset.y }]);
  const edgeOffset = { x: 0, y: 0 };
  const repaired = renderer.draw(context(), { ...options, zoom, sceneKey, worldObstacles: [obstacle], offset: edgeOffset });
  assert.equal(repaired.length, 30); assertClear(repaired, [obstacle]);
});

test('same-tier actual zoom draws current glyphs while scene, source and scale invalidate layout', () => {
  const { renderer, screen, glyphCanvas } = bitmapFixture();
  let options = { ...fixture(.055), sceneKey: {}, worldObstacles: [] };
  renderer.draw(screen, options);
  renderer.draw(screen, { ...options, zoom: .056, worldObstacles: [] });
  renderer.draw(screen, { ...options, zoom: .057, worldObstacles: [] });
  assert.equal(renderer.layoutBuilds, 1); assert.equal(renderer.bitmapBuilds, 1);
  const direct = screen.calls.filter(call => call[0] === 'blit' && call[1] === glyphCanvas);
  assert.equal(direct.length, 60); assert.equal(renderer.cache.zoom, .057);
  for (const update of [{ sceneKey: {} }, { counts: new Map(options.counts) },
    { cells: new Map(options.cells) }, { scale: 2 }]) {
    options = { ...options, ...update }; renderer.draw(screen, options);
  }
  assert.equal(renderer.layoutBuilds, 5);
  assert.equal(renderer.bitmap.layout, renderer.cache);
});

test('an unresolvable tier layout retries when the actual obstacle geometry changes', () => {
  const renderer = new MapTaskCountRenderer(), sceneKey = {}, options = fixture(.055);
  renderer.draw(context(), { ...options, sceneKey, worldObstacles: [{ x: -10000, y: -10000, width: 20000, height: 20000 }] });
  assert.equal(renderer.unplaced, 30);
  const entries = renderer.draw(context(), { ...options, zoom: .056, sceneKey, worldObstacles: [] });
  assert.equal(entries.length, 30); assert.equal(renderer.layoutBuilds, 2); assert.equal(renderer.unplaced, 0);
});

test('replanned layouts reuse candidate reads and explicit scene changes refresh in-place map edits', () => {
  let reads = 0;
  class Cells extends Map { get(id) { reads++; return super.get(id); } }
  const options = fixture(.055), renderer = new MapTaskCountRenderer();
  options.cells = new Cells(options.cells); options.sceneKey = {};
  renderer.draw(context(), options);
  assert.equal(reads, 30);
  renderer.draw(context(), { ...options, zoom: .075 });
  assert.equal(renderer.layoutBuilds, 2); assert.equal(reads, 30);
  options.counts.set('0', 4567); options.cells.set('0', { x: 4, y: 4 }); options.sceneKey = {};
  const entries = renderer.draw(context(), options), changed = entries.find(entry => entry.id === '0');
  assert.equal(reads, 60); assert.equal(changed.count, 4567);
  assert.ok(Math.abs(changed.source.x - (options.offset.x + 4.5 * 128 * options.zoom)) < 1e-9);
  assertClear(entries);
});

test('obstacles spanning negative and positive spatial buckets retain collision padding', () => {
  const renderer = new MapTaskCountRenderer(), options = fixture(.055, 2);
  const worldObstacles = [
    { x: -65, y: -33, width: 34, height: 66 },
    { x: -1, y: -65, width: 34, height: 34 },
    { x: 31, y: -1, width: 66, height: 34 },
    { x: -33, y: 31, width: 66, height: 34 },
  ];
  const entries = renderer.draw(context(), { ...options, worldObstacles });
  assert.equal(entries.length, 30);
  const obstacles = worldObstacles.map(rect => ({ ...rect, x: rect.x + options.offset.x, y: rect.y + options.offset.y }));
  assertClear(entries, obstacles);
  for (const entry of entries) for (const obstacle of obstacles) assert.equal(overlaps(
    { ...entry, x: entry.x - 1, y: entry.y - 1, width: entry.width + 2, height: entry.height + 2 }, obstacle), false);
});

test('current-font glyph atlas paints unique counts once across zooms and pans', () => {
  const { renderer, screen, bitmapContext, glyphContext, glyphCanvas, factories } = bitmapFixture();
  let options = { ...fixture(.055), sceneKey: {}, worldObstacles: [] };
  for (const zoom of [.055, .056, .062, .065, .067, .075, .09, .11, .14]) {
    const entries = renderer.draw(screen, { ...options, zoom });
    assert.equal(entries.length, 30); assertClear(entries);
  }
  renderer.draw(screen, { ...options, zoom: .14, offset: { x: 610, y: 410 } });
  assert.equal(renderer.glyphBuilds, 1);
  assert.equal(glyphContext.calls.filter(call => call[0] === 'text').length, 2);
  assert.equal(bitmapContext.calls.filter(call => call[0] === 'text').length, 0);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
  assert.equal(factories(), 2);
  for (const update of [{ counts: new Map(options.counts) }, { scale: 2 }, { dpr: 1.5 }]) {
    options = { ...options, ...update }; renderer.draw(screen, options);
  }
  assert.equal(renderer.glyphBuilds, 4); assert.equal(renderer.glyphCache.canvas, glyphCanvas);
  assert.equal(factories(), 2); assert.equal(glyphCanvas.width, 768); assert.equal(glyphCanvas.height, 768);
  renderer.draw(screen, { ...options, zoom: 4 });
  assert.equal(renderer.glyphBuilds, 5);
});

test('sprite stamps and cropped blits use native DPR pixel boundaries', () => {
  const { renderer, screen, bitmapContext } = bitmapFixture();
  renderer.draw(screen, { ...fixture(.065, 2), dpr: 1.5, offset: { x: 600.23, y: 400.71 } });
  renderer.draw(screen, { ...fixture(.067, 2), dpr: 1.5, offset: { x: 600.23, y: 400.71 } });
  for (const call of [...bitmapContext.calls.filter(call => call[0] === 'stamp'),
    ...screen.calls.filter(call => call[0] === 'blit')]) {
    for (const index of [2, 3, 4, 5]) assert.ok(Math.abs(call[index] - Math.round(call[index])) < 1e-9);
    for (const index of [6, 7, 8, 9]) assert.ok(Math.abs(call[index] * 1.5 - Math.round(call[index] * 1.5)) < 1e-9);
  }
});

test('glyph atlas obeys its pixel budget and paints uncached count strings through fallback', () => {
  const { renderer, screen, bitmapContext, glyphContext, glyphCanvas } = bitmapFixture();
  const counts = new Map(), cells = new Map();
  for (let index = 0; index < 600; index++) {
    const id = String(index); counts.set(id, 100001 + index); cells.set(id, { x: index % 30, y: Math.floor(index / 30) });
  }
  const entries = renderer.draw(screen, { counts, cells, offset: { x: 100, y: 100 }, zoom: 1, width: 4200, height: 2800 });
  assert.equal(entries.length, 600); assertClear(entries);
  assert.ok(glyphCanvas.width * glyphCanvas.height <= 512 ** 2);
  assert.ok(renderer.glyphCache.sprites.size < 600);
  assert.ok(bitmapContext.calls.some(call => call[0] === 'text'));
  assert.equal(glyphContext.calls.filter(call => call[0] === 'text').length, renderer.glyphCache.sprites.size);
  assert.equal(glyphContext.calls.filter(call => call[0] === 'text').length
    + bitmapContext.calls.filter(call => call[0] === 'text').length, 600);
});

test('a glyph factory returning the region canvas is rejected without corrupting region fallback', () => {
  const raster = { ...context(), setTransform() {}, clearRect() {},
    drawImage() { throw new Error('aliasing glyph atlas must not stamp itself'); } };
  const canvas = { width: 0, height: 0, getContext: () => raster };
  const renderer = new MapTaskCountRenderer({ canvasFactory: () => canvas });
  const screen = { ...context(), drawImage() {}, clip() {} };
  const entries = renderer.draw(screen, fixture());
  assert.equal(entries.length, 30); assertClear(entries);
  assert.equal(renderer.glyphBuilds, 0); assert.equal(renderer.glyphCache.canvas, null);
  assert.equal(raster.calls.filter(call => call[0] === 'text').length, 30);
  renderer.clear(); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('an unavailable glyph canvas preserves vector fallback during zoom and region caching after zoom', () => {
  const raster = { ...context(), setTransform() {}, clearRect() {}, drawImage() {} };
  const canvas = { width: 0, height: 0, getContext: () => raster };
  let factories = 0;
  const renderer = new MapTaskCountRenderer({ canvasFactory: () => ++factories === 1 ? canvas : null });
  const screen = { ...context(), drawImage() {}, clip() {} }, options = fixture(.055);
  renderer.draw(screen, options);
  renderer.draw(screen, { ...options, zoom: .056 });
  assert.equal(factories, 2); assert.equal(renderer.glyphBuilds, 0);
  assert.equal(renderer.bitmap.canvas, canvas); assert.equal(renderer.bitmapBuilds, 1);
  assert.equal(raster.calls.filter(call => call[0] === 'text').length, 30);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 30);
  renderer.draw(screen, { ...options, zoom: .056 });
  assert.equal(renderer.bitmapBuilds, 2);
  assert.equal(raster.calls.filter(call => call[0] === 'text').length, 60);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 30);
});

test('moving zoom bypasses grouped bitmap work, then stable pans rebuild once and reuse it', () => {
  const { renderer, screen, bitmapContext, glyphContext, glyphCanvas } = bitmapFixture();
  const options = { ...fixture(.055), sceneKey: {}, worldObstacles: [], dpr: 1.5 };
  renderer.draw(screen, options);
  const initialStamps = bitmapContext.calls.filter(call => call[0] === 'stamp').length;
  const initialClears = bitmapContext.calls.filter(call => call[0] === 'clear').length;
  for (const zoom of [.056, .058, .06, .062, .064, .066]) {
    const before = screen.calls.length;
    const entries = renderer.draw(screen, { ...options, zoom });
    assert.equal(entries.length, 30); assertClear(entries);
    const blits = screen.calls.slice(before).filter(call => call[0] === 'blit');
    assert.equal(blits.length, entries.length); assert.ok(blits.every(call => call[1] === glyphCanvas));
  }
  assert.equal(renderer.bitmapBuilds, 1); assert.equal(renderer.glyphBuilds, 1);
  assert.equal(bitmapContext.calls.filter(call => call[0] === 'stamp').length, initialStamps);
  assert.equal(bitmapContext.calls.filter(call => call[0] === 'clear').length, initialClears);
  const stable = { ...options, zoom: .066, offset: { x: 611.3, y: 392.9 } };
  renderer.draw(screen, stable); assert.equal(renderer.bitmapBuilds, 2);
  renderer.draw(screen, { ...stable, offset: { x: 621.3, y: 402.9 } });
  assert.equal(renderer.bitmapBuilds, 2); assert.equal(renderer.bitmap.layout, renderer.cache);
  assert.equal(glyphContext.calls.filter(call => call[0] === 'text').length, 2);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
});

test('direct zoom sprite rendering includes only visible fitted badges and repaired edges', () => {
  const { renderer, screen, glyphCanvas } = bitmapFixture(), options = fixture(.055);
  renderer.draw(screen, options);
  const before = screen.calls.length;
  const entries = renderer.draw(screen, { ...options, zoom: 4, offset: { x: -303, y: 100 }, width: 1000, height: 800 });
  assert.ok(entries.length > 0 && entries.length < 30); assertClear(entries);
  assert.ok(entries.some(entry => entry.repaired));
  const blits = screen.calls.slice(before).filter(call => call[0] === 'blit');
  assert.equal(blits.length, entries.length); assert.ok(blits.every(call => call[1] === glyphCanvas));
  assert.equal(renderer.bitmapBuilds, 1);
  assert.equal(screen.calls.filter(call => call[0] === 'text').length, 0);
});
