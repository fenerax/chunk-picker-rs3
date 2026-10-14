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
