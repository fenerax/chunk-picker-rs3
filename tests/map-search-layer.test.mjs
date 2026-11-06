import test from 'node:test';
import assert from 'node:assert/strict';
import { MapSearchLayer } from '../app/web/map-search-layer.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { buildWorld } from '../app/data/world.mjs';

function drawing() {
  const fills = [], outlines = [], clears = [];
  const context = { save() {}, restore() {}, setTransform() {}, setLineDash() {},
    fillRect(...rect) { fills.push(rect); }, strokeRect(...rect) { outlines.push(rect); },
    clearRect(...rect) { clears.push(rect); } };
  return { context, fills, outlines, clears };
}
const view = { width: 2048, height: 2048, dpr: 1.5, zoom: 1, offset: { x: 0, y: 0 } };

test('all matches beyond the list limit resolve once, deduplicate sections and draw without lookups', () => {
  const layer = new MapSearchLayer();
  const cells = new Map(Array.from({ length: 200 }, (_, i) => [String(i + 1000), { x: i % 16, y: Math.floor(i / 16) }]));
  let lookups = 0;
  const get = cells.get.bind(cells);
  cells.get = id => { lookups++; return get(id); };
  const ids = [...cells.keys(), '1000', '1000-2', 1001, 'missing'];
  layer.setMatches(ids, cells);
  assert.equal(layer.matches.size, 200);
  const resolvedLookups = lookups;
  const { context, fills, outlines } = drawing();
  layer.draw(view, context);
  assert.equal(fills.length, 200);
  assert.equal(outlines.length, 200);
  layer.draw({ ...view, offset: { x: -128, y: 0 } }, context);
  assert.equal(lookups, resolvedLookups, 'Pan does not read chunk or search data');
  assert.equal(layer.setMatches(new Set(cells.keys()), cells), false, 'Array and Set resolve identically');
});

test('offscreen cells and exact viewport edges are skipped; partially visible cells remain', () => {
  const layer = new MapSearchLayer();
  layer.setMatches(['left', 'top', 'right', 'bottom', 'partial'], new Map([
    ['left', { x: -1, y: 0 }], ['top', { x: 0, y: -1 }], ['right', { x: 1, y: 0 }],
    ['bottom', { x: 0, y: 1 }], ['partial', { x: .5, y: .5 }],
  ]));
  const { context, fills } = drawing();
  layer.draw({ ...view, width: 128, height: 128 }, context);
  assert.deepEqual(fills, [[64, 64, 128, 128]]);
});

test('canvas redraws only when matches or viewport change and clears/removes its own layer', () => {
  const { context, fills, clears } = drawing();
  let removed = 0, inserted;
  const canvas = { getContext: () => context, setAttribute() {}, remove() { removed++; } };
  const anchor = {};
  const stage = { ownerDocument: { createElement: () => canvas }, insertBefore(...args) { inserted = args; } };
  const layer = new MapSearchLayer(stage, anchor);
  assert.deepEqual(inserted, [canvas, anchor]);
  assert.equal(canvas.className, 'map-search-layer');
  layer.setMatches(['1'], new Map([['1', { x: 0, y: 0 }]]));
  layer.draw(view);
  layer.draw(view);
  assert.equal(clears.length, 1);
  layer.draw({ ...view, zoom: .5 });
  assert.equal(clears.length, 2);
  layer.setMatches([], new Map());
  layer.draw(view);
  assert.equal(clears.length, 3);
  assert.equal(fills.length, 2);
  layer.dispose(); layer.dispose();
  assert.equal(removed, 1);
  assert.equal(layer.setMatches(['1'], new Map()), false);
});

test('scope preserves display changes and clears changed world, member or revision snapshots', () => {
  const layer = new MapSearchLayer(), world = {}, cells = new Map([['1', { x: 0, y: 0 }]]);
  layer.setScope(world, 'one', 1);
  for (const scope of [[world, 'one', 1], [world, 'two', 1], [world, 'two', 2], [{}, 'two', 2]]) {
    layer.setMatches(['1'], cells);
    layer.setScope(...scope);
    assert.equal(layer.matches.size, scope[1] === 'one' ? 1 : 0);
  }
});


test('a dedicated canvas search update schedules no state, pin or hover repaint', () => {
  const { context } = drawing();
  const canvas = { getContext: () => context, setAttribute() {}, remove() {} };
  const stage = { ownerDocument: { createElement: () => canvas }, insertBefore() {} };
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    searchLayer: new MapSearchLayer(stage, {}), cells: new Map([['1', { x: 0, y: 0 }]]),
    dirty: { base: false, state: false, pins: false, hover: false }, scheduled: 0,
    schedule() { this.scheduled++; },
  });
  map.setSearchMatches(['1']);
  assert.equal(map.scheduled, 1);
  assert.ok(Object.values(map.dirty).every(value => value === false));
  map.setSearchMatches(new Set(['1']));
  assert.equal(map.scheduled, 1, 'Repeated resolved matches do not schedule another frame');
  map.searchLayer.dispose();
  map.setSearchMatches(['1']);
  assert.equal(map.scheduled, 1, 'Disposed renderer ignores updates');
});

test('quest matches distinguish unlocked solids and locked dashes; Search resets the style', () => {
  const layer = new MapSearchLayer(), cells = new Map([['1', { x: 0, y: 0 }], ['2', { x: 1, y: 0 }]]);
  const styles = [], context = { ...drawing().context, setLineDash(dash) { this.dash = dash; },
    strokeRect() { styles.push([this.strokeStyle, this.dash]); } };
  layer.setMatches(['1', '2'], cells, { lockedIds: ['2'] }); layer.draw(view, context);
  assert.deepEqual(styles, [['#f25fe3', []], ['#e69b36', [5, 3]]]);
  assert.equal(layer.setMatches(['1', '2'], cells), true);
  layer.draw(view, context);
  assert.deepEqual(styles.slice(2), [['#f25fe3', [5, 3]], ['#f25fe3', [5, 3]]]);
});

test('fitting quest chunks includes full cells, deduplicates sections and ignores interior names', () => {
  const map = Object.assign(Object.create(ChunkMap.prototype), { cells: new Map([['1', { x: 2, y: 3 }], ['2', { x: 4, y: 6 }]]),
    width: 2000, height: 2000, zoom: .65, fitBounds(...bounds) { this.bounds = bounds; } });
  assert.equal(map.centerOnChunks(['1-2', '1', 'Cave', '2']), true);
  assert.deepEqual(map.bounds, [256, 384, 640, 896]); assert.equal(map.autoFit, false);
  assert.equal(map.centerOnChunks(['Cave']), false);
});

test('a quest route wider than the minimum zoom reports that a first-chunk fallback is needed', () => {
  const map = Object.assign(Object.create(ChunkMap.prototype), { cells: new Map([['1', { x: 0, y: 0 }], ['2', { x: 100, y: 100 }]]),
    width: 390, height: 340, invalidate() {} });
  assert.equal(map.centerOnChunks(['1', '2']), false);
  assert.equal(map.centerOnChunks(['1']), true);
});

test('highlight drawing reuses consecutive styles while preserving colors, dashes and rectangle order', () => {
  const layer = new MapSearchLayer(), ids = ['1', '2', '3', '4', '5', '6'];
  layer.setMatches(ids, new Map(ids.map((id, i) => [id, { x: i, y: 0 }])), { lockedIds: ['3', '4'] });
  const painted = [], dashes = [];
  const context = { ...drawing().context,
    setLineDash(value) { dashes.push(value); this.dash = value; },
    fillRect(...rect) { painted.push([rect, this.fillStyle, this.strokeStyle, this.dash]); },
  };
  const expected = ids.map((_, i) => [[i * 128, 0, 128, 128],
    i === 2 || i === 3 ? 'rgba(230,155,54,.22)' : 'rgba(238,66,219,.16)',
    i === 2 || i === 3 ? '#e69b36' : '#f25fe3', i === 2 || i === 3 ? [5, 3] : []]);
  layer.draw(view, context);
  assert.deepEqual(painted, expected);
  assert.deepEqual(dashes, [[], [5, 3], []]);
  painted.length = 0; layer.draw(view, context, true);
  assert.deepEqual(painted, expected, 'each draw initializes its own style after save/restore');
  assert.equal(dashes.length, 6);
});

function progressiveLayer(t) {
  const previous = globalThis.requestAnimationFrame, frames = [];
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  t.after(() => { if (previous === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previous; });
  const picture = drawing();
  picture.context.clearRect = () => { picture.fills.length = 0; picture.outlines.length = 0; };
  const canvas = { getContext: () => picture.context, setAttribute() {}, remove() {} };
  const layer = new MapSearchLayer({ ownerDocument: { createElement: () => canvas }, insertBefore() {} });
  const cells = new Map(Array.from({ length: 5000 }, (_, i) => [String(i), { x: i % 100, y: Math.floor(i / 100) }]));
  const viewport = { ...view, zoom: .1 };
  const flush = () => { let count = 0; while (frames.length) { assert.ok(count++ < 100); frames.shift()(); } };
  return { layer, cells, viewport, flush, ...picture };
}

test('large canvas highlights paint in bounded frames and eventually match synchronous geometry in full order', t => {
  const h = progressiveLayer(t), reference = new MapSearchLayer(), expected = drawing();
  const styles = [], expectedStyles = [], ids = [...h.cells.keys()];
  for (const [context, output] of [[h.context, styles], [expected.context, expectedStyles]]) {
    const stroke = context.strokeRect;
    context.setLineDash = function(dash) { this.dash = dash; };
    context.strokeRect = function(...rect) { output.push([this.strokeStyle, this.dash]); stroke.apply(this, rect); };
  }
  for (const layer of [h.layer, reference]) layer.setMatches(ids, h.cells, { lockedIds: ids.filter((_, i) => i % 3 === 0) });
  h.layer.draw(h.viewport);
  assert.equal(h.layer.painting, true); assert.equal(h.fills.length, 1024);
  h.flush(); assert.equal(h.layer.painting, false);
  reference.draw(h.viewport, expected.context);
  assert.deepEqual(h.fills, expected.fills); assert.deepEqual(h.outlines, expected.outlines);
  assert.equal(h.fills.length, 5000); assert.deepEqual(styles, expectedStyles);
});

for (const change of ['matches', 'viewport', 'scope', 'dispose']) {
  test(`progressive canvas painting discards old work after ${change} changes`, t => {
    const h = progressiveLayer(t), world = {};
    h.layer.setScope(world, 'one', 1); h.layer.setMatches([...h.cells.keys()], h.cells); h.layer.draw(h.viewport);
    let target = h.viewport;
    if (change === 'matches') h.layer.setMatches(['1', '2'], h.cells);
    if (change === 'viewport') target = { ...h.viewport, offset: { x: -500, y: -100 } };
    if (change === 'scope') h.layer.setScope(world, 'two', 2);
    if (change === 'dispose') {
      const count = h.fills.length; h.layer.dispose(); h.flush();
      assert.equal(h.fills.length, count); assert.equal(h.layer.painting, false); return;
    }
    h.layer.draw(target); h.flush(); assert.equal(h.layer.painting, false);
    const reference = new MapSearchLayer(), expected = drawing();
    reference.setMatches([...h.layer.matches.keys()], h.cells); reference.draw(target, expected.context);
    assert.deepEqual(h.fills, expected.fills); assert.deepEqual(h.outlines, expected.outlines);
  });
}
