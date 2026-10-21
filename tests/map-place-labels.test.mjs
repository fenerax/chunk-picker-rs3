import test from 'node:test';
import assert from 'node:assert/strict';
import { MapPlaceLabels, selectPlaceLabels, layoutPlaceLabels, placeLabelPoint, fitPlaceLabels,
  placeLabelChunkObstacles, placeLabelLeaderIntersects, placeLabelPanelBoxes, defaultPlaceLabels, LABEL_INKS } from '../app/web/map-place-labels.mjs';
import { RectangleIndex } from '../app/web/map-task-count-renderer.mjs';

const label = (id, level, x = 3200, y = 3200) => ({ id, name: id, level, x, y,
  priority: { region: 300, town: 200, place: 100 }[level] });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

test('overview, town and detail levels select progressively without region text on close views', () => {
  const labels = [label('region', 'region'), label('town', 'town'), label('place', 'place')];
  for (const zoom of [.055, .1, .159]) assert.deepEqual(selectPlaceLabels(labels, zoom).map(l => l.id), ['region']);
  for (const zoom of [.16, .35, .649]) assert.deepEqual(selectPlaceLabels(labels, zoom).map(l => l.id), ['region', 'town']);
  for (const zoom of [.65, 1, 4]) assert.deepEqual(selectPlaceLabels(labels, zoom).map(l => l.id), ['town', 'place']);
  assert.deepEqual(selectPlaceLabels(labels, NaN), []);
  assert.deepEqual(selectPlaceLabels([label('bad', 'unknown'), { ...label('nan', 'town'), x: NaN }], 1), []);
});


test('cache surface coordinates match the map grid including the new areas', () => {
  assert.deepEqual(placeLabelPoint(label('origin', 'town', 1856, 4608), 1), { x: 0, y: 0 });
  assert.deepEqual(placeLabelPoint(label('Havenhythe', 'town', 4337, 3311), .5), { x: 2481, y: 1297 });
});

test('collisions omit names under ranks, badges, IDs and stickers at every zoom', () => {
  for (const zoom of [.055, .1, .35, .65, 1, 4]) {
    const labels = ['region', 'town', 'place'].flatMap((level, index) => [
      label(`${level}-first`, level, 2200 + index * 400, 3500),
      label(`${level}-same`, level, 2200 + index * 400, 3500),
      label(`${level}-blocked`, level, 2200 + index * 400, 3200),
    ]);
    const obstacles = labels.filter(l => l.id.endsWith('blocked')).map(l => {
      const point = placeLabelPoint(l, zoom);
      return { x: point.x - 4, y: point.y - 4, width: 8, height: 8 };
    });
    const placements = layoutPlaceLabels(labels, { zoom, obstacles });
    assert.ok(placements.length > 0);
    for (const entry of placements) {
      assert.ok(!entry.id.endsWith('same') && !entry.id.endsWith('blocked'));
      assert.ok(entry.fontSize >= 12);
      assert.ok(obstacles.every(obstacle => !overlaps(entry, obstacle)));
      assert.ok(placements.every(other => entry === other || !overlaps(entry, other)));
    }
  }
});

function fixture() {
  const map = { model: { preferences: { ids: false } }, zoom: .35, offset: { x: -400, y: -500 },
    width: 1440, height: 900, dpr: 1, active: { selectedRanks: new Map() }, candidateRanks: new Map(),
    deathMarkers: new Map(), visibleMembers: [], cellStates: new Map(), cells: new Map(),
    taskCountScene: null, taskCountPlacements: [], visibleTaskCounts: new Map(), invalidate() {} };
  const calls = [], context = { save() {}, restore() {}, setTransform() {},
    measureText(text) { calls.push(['measure', text]); return { width: text.length * 7 }; },
    strokeText(...args) { calls.push(['stroke', ...args]); }, fillText(...args) { calls.push(['text', ...args]); },
    drawImage(...args) { calls.push(['image', ...args]); } };
  const canvas = { getContext: () => context };
  const layer = new MapPlaceLabels(map, {}, { canvasFactory: () => canvas });
  layer.labels = [label('Lumbridge', 'town')];
  return { map, context, layer, calls, canvas };
}

test('every name that fits is drawn; no fixed count makes names swap in and out', () => {
  const { map, context, layer } = fixture();
  // 42 well-separated towns inside the 1440 x 900 view: more than the old cap of 32.
  layer.labels = Array.from({ length: 42 }, (_, index) =>
    label(`T${index}`, 'town', 2550 + (index % 7) * 250, 2700 + Math.floor(index / 7) * 180));
  layer.draw(context);
  assert.equal(layer.lastPlacements.length, 42);
});

test('ordinary pans reuse raster text and world layout; zoom layouts are bounded and revisited', () => {
  const { map, context, layer, calls, canvas } = fixture();
  layer.draw(context); assert.equal(layer.lastPlacements.length, 1);
  const first = layer.lastPlacements[0], measureCount = calls.filter(c => c[0] === 'measure').length;
  const textCount = calls.filter(c => c[0] === 'text').length;
  map.offset.x += 10; layer.draw(context);
  assert.equal(layer.lastPlacements[0].x, first.x + 10);
  assert.equal(layer.layoutBuilds, 1); assert.equal(layer.artworkBuilds, 1);
  assert.equal(calls.filter(c => c[0] === 'measure').length, measureCount);
  assert.equal(calls.filter(c => c[0] === 'text').length, textCount);
  map.zoom = .42; layer.draw(context); map.zoom = .35; layer.draw(context);
  assert.equal(layer.layoutBuilds, 2);
  for (let i = 0; i < 20; i++) { map.zoom = .055 * 1.25 ** i; layer.draw(context); }
  assert.equal(layer.layouts.size, 8);
  layer.dispose(); assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  assert.equal(layer.layouts.size, 0); assert.equal(layer.obstacleScene, null);
  assert.equal(layer.obstacleIndex, null); assert.equal(layer.annotationCells, null); layer.draw(context);
});

test('names are coloured by size: regions gold, towns plain, smaller places parchment', () => {
  for (const [theme, scheme] of [['dark', 'dark'], ['light', 'light']]) {
    const { map, layer } = fixture(), painted = new Map();
    const context = { save() {}, restore() {}, setTransform() {}, measureText: text => ({ width: text.length * 7 }), strokeText() {},
      fillText(text) { painted.set(text, { fill: this.fillStyle, font: this.font, halo: this.strokeStyle }); }, drawImage() {} };
    layer.canvasFactory = () => ({ getContext: () => context });
    map.model.preferences.theme = theme;
    layer.labels = [label('Misthalin', 'region'), label('Lumbridge', 'town', 3400), label('Mill', 'place', 3000)];
    layer.artwork(context, 1);
    assert.equal(painted.get('Misthalin').fill, LABEL_INKS[scheme].region, theme);
    assert.equal(painted.get('Lumbridge').fill, LABEL_INKS[scheme].town, theme);
    assert.equal(painted.get('Mill').fill, LABEL_INKS[scheme].place, theme);
    assert.match(painted.get('Mill').font, /^700 /);
    assert.equal(new Set(Object.values(LABEL_INKS[scheme])).size, 3);
  }
});

test('viewport-edge badge repairs hide a conflicting label without invalidating the pan cache', () => {
  const { map, context, layer } = fixture(); layer.draw(context);
  map.taskCountPlacements = [{ ...layer.lastPlacements[0] }]; layer.draw(context);
  assert.deepEqual(layer.lastPlacements, []); assert.equal(layer.layoutBuilds, 1);
  map.model.preferences.showTaskCounts = false; layer.draw(context);
  assert.equal(layer.lastPlacements.length, 1);
  map.model.preferences.showPlaceNames = false; layer.draw(context);
  assert.deepEqual(layer.lastPlacements, []);
});

test('failed optional data load and disposal during loading leave map controls usable', async () => {
  const f = fixture();
  const failed = new MapPlaceLabels(f.map, {}, { load: () => Promise.reject(new Error('offline')) });
  await failed.ready; failed.draw(f.context); assert.deepEqual(failed.lastPlacements, []);
  let finish;
  const late = new MapPlaceLabels(f.map, {}, { load: () => new Promise(resolve => { finish = resolve; }) });
  await Promise.resolve(); late.dispose(); finish({ labels: [label('late', 'town')] }); await late.ready;
  assert.deepEqual(late.labels, []);
});

test('removed count badges stop suppressing names even if the count raster cache is retained', () => {
  const { map, context, layer } = fixture();
  const point = placeLabelPoint(layer.labels[0], map.zoom);
  map.visibleTaskCounts = new Map([['one', 3]]);
  map.taskCountRenderer = { cache: { counts: map.visibleTaskCounts,
    placements: [{ x: point.x - 200, y: point.y - 200, width: 400, height: 400 }] } };
  map.taskCountPlacements = [{ x: point.x + map.offset.x - 200, y: point.y + map.offset.y - 200, width: 400, height: 400 }];
  layer.draw(context); assert.deepEqual(layer.lastPlacements, []);
  map.visibleTaskCounts = new Map(); map.taskCountPlacements = []; layer.draw(context);
  assert.equal(layer.lastPlacements.length, 1);
});

test('small continuous zoom steps reuse collision layout while projecting text at fixed size', () => {
  const { map, context, layer } = fixture();
  map.zoom = .351; layer.draw(context); const first = layer.lastPlacements[0];
  for (const zoom of [.352, .353, .354]) { map.zoom = zoom; layer.draw(context); }
  assert.equal(layer.layoutBuilds, 1); assert.equal(layer.artworkBuilds, 1);
  const last = layer.lastPlacements[0];
  assert.equal(last.width, first.width); assert.equal(last.fontSize, first.fontSize);
  assert.ok(last.x > first.x);
});

test('town names fit between repeated visible ID rows without covering badges or other names', () => {
  const index = new RectangleIndex(), obstacles = [];
  for (let row = 0; row < 4; row++) for (let column = 0; column < 6; column++) {
    const rect = { x: column * 44.8 + 2, y: row * 44.8 + 31, width: 39, height: 12 };
    obstacles.push(rect); index.add({ x: rect.x - 1.5, y: rect.y - 1.5, width: rect.width + 3, height: rect.height + 3 });
  }
  const entries = [{ id: 'Lumbridge', x: 50, y: 29, width: 65, height: 20 },
    { id: 'Varrock', x: 150, y: 74, width: 54, height: 20 }];
  const placed = fitPlaceLabels(entries, index);
  assert.equal(placed.length, 2);
  for (const entry of placed) {
    assert.ok(obstacles.every(rect => !overlaps(entry, rect)));
    assert.ok(Math.abs(entry.y - entries.find(item => item.id === entry.id).y) <= 24);
  }
  const blocked = new RectangleIndex(); blocked.add({ x: -100, y: -100, width: 500, height: 500 });
  assert.deepEqual(fitPlaceLabels(entries, blocked), []);
});

test('padded nearby fitting reuses ordinary pans and reveals incoming names on a long pan', () => {
  const { map, context, layer } = fixture();
  layer.labels.push(label('Far', 'town', 4800, 3200));
  layer.draw(context); assert.equal(layer.lastPlacements.length, 1);
  const index = layer.obstacleIndex;
  map.offset.x -= 100; layer.draw(context);
  assert.equal(layer.fitBuilds, 1); assert.equal(layer.layoutBuilds, 1);
  map.offset.x -= 260; layer.draw(context);
  assert.equal(layer.lastPlacements.length, 2); assert.equal(layer.fitBuilds, 2);
  assert.equal(layer.layoutBuilds, 1); assert.equal(layer.obstacleIndex, index);
});

test('nearby badge indexing includes incoming labels after a long pan', () => {
  const { map, context, layer } = fixture();
  const far = label('Far', 'town', 5000, 3200); layer.labels.push(far);
  const badges = layer.labels.map(entry => {
    const point = placeLabelPoint(entry, map.zoom);
    return { x: point.x + 10, y: point.y, width: 8, height: 8 };
  });
  map.visibleTaskCounts = new Map([['one', 3]]);
  map.taskCountRenderer = { cache: { counts: map.visibleTaskCounts, placements: badges } };
  layer.draw(context);
  assert.equal(layer.badgeIndex.blocked(badges[0]), true);
  assert.equal(layer.badgeIndex.blocked(badges[1]), false);
  map.offset.x -= 360; layer.draw(context);
  assert.equal(layer.badgeIndex.blocked(badges[1]), true);
  assert.ok(layer.placements.every(entry => badges.every(badge => !overlaps(entry, badge))));
});

test('a steady frame after zoom restores the margin before an ordinary pan', () => {
  const { map, context, layer } = fixture();
  layer.labels.push(label('Incoming', 'town', 4600, 3200));
  layer.draw(context);
  map.zoom = .351; layer.draw(context);
  assert.equal(layer.fitMoving, true);
  assert.equal(layer.placements.some(entry => entry.id === 'Incoming'), false);
  layer.draw(context);
  assert.equal(layer.fitMoving, false);
  assert.equal(layer.placements.some(entry => entry.id === 'Incoming'), true);
  const fits = layer.fitBuilds;
  map.offset.x -= 120; layer.draw(context);
  assert.equal(layer.fitBuilds, fits);
  assert.ok(layer.lastPlacements.some(entry => entry.id === 'Incoming'));
});

test('quest start markers from the cache are not shown as place names', () => {
  const labels = [
    { id: 'quest', name: 'Start of Carnillean Rising', level: 'town', x: 1, y: 1, priority: 9 },
    { id: 'town', name: 'Ardougne', level: 'town', x: 2, y: 2, priority: 1 },
  ];
  assert.deepEqual(selectPlaceLabels(labels, .4).map(l => l.id), ['town']);
});

const fittingEntry = (id, overrides = {}) => ({ id, name: id, level: 'town', priority: 0,
  x: 40, y: 40, width: 40, height: 20, fontSize: 14, lines: [id], ...overrides });
const rectangleIndex = rectangles => {
  const index = new RectangleIndex();
  for (const rectangle of rectangles) index.add(rectangle);
  return index;
};

test('level wins before explicit priority and input order when only one name fits', () => {
  const entries = [fittingEntry('detail', { level: 'place', priority: 9999 }),
    fittingEntry('town', { priority: 999 }), fittingEntry('region', { level: 'region', priority: -10 })];
  const bounds = { x: 40, y: 40, width: 40, height: 20 };
  for (const ordered of [entries, [...entries].reverse()]) {
    assert.deepEqual(fitPlaceLabels(ordered, new RectangleIndex(), undefined, { bounds }).map(entry => entry.id), ['region']);
  }
});

test('horizontal adjustment can fit beside an obstacle that blocks every vertical adjustment', () => {
  const obstacle = { x: 57, y: -100, width: 6, height: 300 };
  const entry = fittingEntry('town', { width: 12, x: 54, fontSize: 12 });
  const [placed] = fitPlaceLabels([entry], rectangleIndex([obstacle]));
  assert.ok(placed);
  assert.notEqual(placed.x, entry.x);
  assert.ok(!overlaps(placed, obstacle));
  assert.ok(Math.abs(placed.x + placed.width / 2 - (entry.x + entry.width / 2)) <= 48);
});

test('fitting shrinks text only as far as readable size when a narrower viewport needs it', () => {
  const entry = fittingEntry('Wide town', { x: 10, width: 80, fontSize: 14 });
  const bounds = { x: 0, y: 0, width: 75, height: 100 };
  const [placed] = fitPlaceLabels([entry], new RectangleIndex(), undefined, { bounds });
  assert.ok(placed);
  assert.ok(placed.width < entry.width);
  assert.ok(placed.fontSize >= 12 && placed.fontSize < 14);
  assert.ok(placed.x >= bounds.x && placed.x + placed.width <= bounds.width);
  assert.deepEqual(fitPlaceLabels([entry], rectangleIndex([{ x: -200, y: -200, width: 500, height: 500 }])), []);
});

test('fitting prefers nearby space outside unlocked interiors while preserving hard markers', () => {
  const entry = fittingEntry('town', { x: 44, width: 12, fontSize: 12 });
  const owned = { x: 40, y: -100, width: 20, height: 300 };
  const [outside] = fitPlaceLabels([entry], new RectangleIndex(), undefined, { unlockedIndex: rectangleIndex([owned]) });
  assert.ok(outside && !overlaps(outside, owned));
  const marker = { x: 48, y: -100, width: 4, height: 300 };
  const everywhere = { x: -200, y: -200, width: 500, height: 500 };
  const [inside] = fitPlaceLabels([entry], rectangleIndex([marker]), undefined,
    { unlockedIndex: rectangleIndex([everywhere]) });
  assert.ok(inside && overlaps(inside, everywhere));
  assert.ok(!overlaps(inside, marker));
});

function chunkObstacleFixture(zoom = 1) {
  const cells = new Map([['left', { x: 0, y: 0 }], ['right', { x: 1, y: 0 }]]);
  const owner = { id: 'owner' };
  return { zoom, cells, unlocked: new Set(['left', 'right']), model: { preferences: { highvis: false } },
    cellStates: new Map([...cells.keys()].map(id => [id, { owners: [owner], colourPaint: null }])),
    cellId(column, row) { return row === 0 ? column === 0 ? 'left' : column === 1 ? 'right' : null : null; } };
}

test('chunk obstacles reserve exposed perimeter strokes while leaving shared unlocked edges usable', () => {
  const map = chunkObstacleFixture();
  const { hard, unlocked } = placeLabelChunkObstacles(map);
  assert.equal(unlocked.length, 2);
  const borders = hard.filter(rect => rect.type === 'unlocked border');
  assert.ok(borders.length > 0);
  assert.ok(borders.some(rect => overlaps(rect, { x: -1, y: 40, width: 2, height: 10 })));
  assert.ok(borders.every(rect => !overlaps(rect, { x: 127, y: 40, width: 2, height: 10 })));
  assert.ok(borders.every(rect => rect.width < 12 || rect.height < 12));
});

test('chunk colour obstacles follow the painted accent zoom and slice-width thresholds', () => {
  const map = chunkObstacleFixture(.6);
  map.cellStates.get('left').colourPaint = { segments: [{}] };
  const accents = () => placeLabelChunkObstacles(map).hard.filter(rect => rect.type === 'chunk colour accent');
  assert.deepEqual(accents(), []);
  map.zoom = .625;
  assert.equal(accents().length, 4);
  assert.ok(accents().every(rect => rect.width < 12 || rect.height < 12));
  map.cellStates.get('left').colourPaint = { segments: Array.from({ length: 8 }, () => ({})) };
  assert.deepEqual(accents(), []);
  map.zoom = 1;
  assert.equal(accents().length, 32);
});

test('leader collision uses the painted segment rather than its diagonal bounding rectangle', () => {
  const badge = { x: 100, y: 100, width: 20, height: 20, source: { x: 0, y: 0 }, callout: true };
  assert.equal(placeLabelLeaderIntersects({ x: 45, y: 45, width: 10, height: 10 }, badge), true);
  assert.equal(placeLabelLeaderIntersects({ x: 45, y: 15, width: 10, height: 10 }, badge), false);
  assert.equal(placeLabelLeaderIntersects({ x: 45, y: 45, width: 10, height: 10 }, { ...badge, callout: false }), false);
});

test('current repaired badge leaders guard cached names on small viewport pans', () => {
  const { map, context, layer } = fixture();
  layer.draw(context);
  const first = layer.lastPlacements[0];
  map.offset.x += 10;
  const middle = { x: first.x + 10 + first.width / 2, y: first.y + first.height / 2 };
  map.taskCountPlacements = [{ x: middle.x + 100, y: middle.y + 100, width: 20, height: 20,
    source: { x: middle.x - 100, y: middle.y - 100 }, callout: true, repaired: true }];
  layer.draw(context);
  assert.ok(layer.lastPlacements.every(entry => !placeLabelLeaderIntersects(entry, map.taskCountPlacements[0])));
  map.taskCountPlacements = [];
  layer.draw(context);
  assert.equal(layer.lastPlacements.length, 1);
});

test('viewport resizing refits names and retains readable on-screen text', () => {
  const { map, context, layer } = fixture();
  layer.draw(context);
  const fits = layer.fitBuilds;
  map.width = 720; map.height = 450;
  layer.draw(context);
  assert.ok(layer.fitBuilds > fits);
  for (const entry of layer.lastPlacements) {
    assert.ok(entry.fontSize >= 12);
    assert.ok(entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= map.width && entry.y + entry.height <= map.height);
  }
});

test('panel boxes reserve individual visible paint and clip it to the stage', () => {
  const panel = (left, top, width, height, hidden = false) => ({ hidden,
    getBoundingClientRect: () => ({ left, top, width, height }) });
  let selector;
  const host = { querySelectorAll(value) {
    selector = value;
    return [panel(120, 230, 50, 60), panel(80, 180, 40, 50), panel(280, 290, 40, 30),
      panel(130, 240, 50, 50, true), panel(150, 250, 0, 50), panel(500, 200, 50, 50)];
  } };
  const stage = { parentElement: host,
    getBoundingClientRect: () => ({ left: 100, top: 200, width: 200, height: 100 }) };
  assert.deepEqual(placeLabelPanelBoxes(stage), [
    { x: 20, y: 30, width: 50, height: 60 },
    { x: 0, y: 0, width: 20, height: 30 },
    { x: 180, y: 90, width: 20, height: 10 },
  ]);
  const selectors = selector.split(',').map(value => value.trim());
  assert.ok(selectors.includes('.floating-panel'));
  assert.ok(selectors.includes('.map-summary'));
  assert.ok(!selectors.includes('.map-dock') && !selectors.includes('.map-dock-panels'));
  // Names sit under the hover tooltip instead of jumping away as the pointer moves.
  assert.ok(!selectors.includes('#map-tooltip'));
  assert.deepEqual(placeLabelPanelBoxes(null), []);
  assert.deepEqual(placeLabelPanelBoxes({ parentElement: null }), []);
});

test('closing or resizing a painted panel changes its boxes without reserving dock gaps', () => {
  const box = { left: 30, top: 20, width: 60, height: 40 };
  const panel = { hidden: false, getBoundingClientRect: () => box };
  const stage = { parentElement: { querySelectorAll: () => [panel] },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) };
  assert.equal(placeLabelPanelBoxes(stage)[0].width, 60);
  box.width = 90;
  assert.equal(placeLabelPanelBoxes(stage)[0].width, 90);
  panel.hidden = true;
  assert.deepEqual(placeLabelPanelBoxes(stage), []);
});

test('scrolled dock panels reserve only their visible painted portion', () => {
  const scroller = { getBoundingClientRect: () => ({ left: 20, top: 50, width: 80, height: 100 }) };
  const panel = { hidden: false, closest: selector => selector === '.map-dock-panels' ? scroller : null,
    getBoundingClientRect: () => ({ left: 20, top: 0, width: 80, height: 75 }) };
  const stage = { parentElement: { querySelectorAll: () => [panel] },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) };
  assert.deepEqual(placeLabelPanelBoxes(stage), [{ x: 20, y: 50, width: 80, height: 25 }]);
});

test('panels from another map do not suppress names in an independent map stage', () => {
  const otherMap = {}, ownMap = {};
  const panel = owner => ({ hidden: false, closest: selector => selector === '.map-panel' ? owner : null,
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 50, height: 40 }) });
  const stage = { closest: () => ownMap, parentElement: { querySelectorAll: () => [panel(otherMap), panel(ownMap)] },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) };
  assert.deepEqual(placeLabelPanelBoxes(stage), [{ x: 20, y: 30, width: 50, height: 40 }]);
});

test('several crowded region and town fits remain disjoint from names and hard obstacles', () => {
  const obstacles = [{ x: 60, y: 0, width: 6, height: 200 }, { x: 0, y: 85, width: 200, height: 5 }];
  const entries = Array.from({ length: 12 }, (_, index) => fittingEntry(`name-${index}`, {
    level: index % 3 === 0 ? 'region' : 'town', x: 35 + index % 4 * 10, y: 45 + Math.floor(index / 4) * 10,
    width: 35, fontSize: index % 3 === 0 ? 17 : 14,
  }));
  for (const ordered of [entries, [...entries].reverse(), [...entries.slice(6), ...entries.slice(0, 6)]]) {
    const placed = fitPlaceLabels(ordered, rectangleIndex(obstacles), undefined,
      { bounds: { x: 0, y: 0, width: 200, height: 200 } });
    assert.ok(placed.length >= 3);
    for (const entry of placed) {
      assert.ok(entry.fontSize >= 12);
      assert.ok(obstacles.every(obstacle => !overlaps(entry, obstacle)));
      assert.ok(placed.every(other => entry === other || !overlaps(entry, other)));
    }
  }
});

test('panel events refit cached names and disposal releases observers and listeners', () => {
  const previousResize = globalThis.ResizeObserver, previousMutation = globalThis.MutationObserver;
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnects = 0; observers.push(this); }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnects++; }
  }
  globalThis.ResizeObserver = Observer; globalThis.MutationObserver = Observer;
  let layer;
  try {
    const { map, context, canvas } = fixture();
    const listeners = new Map(), removed = [];
    const panel = { hidden: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) };
    const host = { querySelectorAll: () => [panel],
      addEventListener(name, callback, capture) { listeners.set(name, callback); assert.equal(capture, true); },
      removeEventListener(name, callback, capture) { removed.push(name); assert.equal(callback, listeners.get(name)); assert.equal(capture, true); } };
    map.stage = { parentElement: host,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: map.width, height: map.height }) };
    let invalidations = 0; map.invalidate = () => invalidations++;
    layer = new MapPlaceLabels(map, {}, { canvasFactory: () => canvas });
    layer.labels = [label('Lumbridge', 'town')];
    layer.draw(context); assert.equal(layer.lastPlacements.length, 1);
    const fits = layer.fitBuilds, artwork = layer.artworkBuilds;
    const unchanged = invalidations;
    for (let repeat = 0; repeat < 3; repeat++) {
      observers.find(observer => observer.observed.includes(host)).callback([{ type: 'attributes' }]);
      layer.draw(context);
    }
    assert.equal(invalidations, unchanged, 'unchanged tooltip/panel styles never schedule another frame');
    assert.equal(layer.fitBuilds, fits);
    panel.hidden = false;
    observers.find(observer => observer.observed.includes(host)).callback([{ type: 'attributes' }]);
    layer.draw(context);
    assert.ok(invalidations > 0 && layer.fitBuilds > fits);
    assert.deepEqual(layer.lastPlacements, []);
    assert.equal(layer.artworkBuilds, artwork);
    panel.hidden = true; listeners.get('toggle')(); layer.draw(context);
    assert.equal(layer.lastPlacements.length, 1);
    const cachedFits = layer.fitBuilds;
    map.offset.x += 20; listeners.get('scroll')(); layer.draw(context);
    assert.equal(layer.fitBuilds, cachedFits);
    layer.dispose();
    assert.deepEqual(removed.sort(), ['scroll', 'toggle']);
    assert.ok(observers.every(observer => observer.disconnects > 0));
    const stopped = invalidations;
    for (const observer of observers) observer.callback([{ type: 'attributes' }]);
    assert.equal(invalidations, stopped);
  } finally {
    if (layer && !layer.disposed) layer.dispose();
    if (previousResize === undefined) delete globalThis.ResizeObserver; else globalThis.ResizeObserver = previousResize;
    if (previousMutation === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = previousMutation;
  }
});
