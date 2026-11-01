import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCountAnnotationCells, taskCountObstacles } from '../app/web/map-task-count-obstacles.mjs';
import { chunkIdLayout, layoutStickerCluster } from '../app/web/map.mjs';
import { MapTaskCountRenderer } from '../app/web/map-task-count-renderer.mjs';

test('cached annotation sources retain every obstacle, including saved overlays and visible global IDs', () => {
  const ids = Array.from({ length: 9 }, (_, index) => String(12342 + index));
  const [selected, candidate, flag, sticker, tab, shared, partner, death] = ids;
  const members = [{ id: 'actor1', startingChunk: flag, stickers: { [sticker]: [{ id: 'star' }], outside: [{ id: 'ignored' }] },
    selectedRanks: new Map([[selected, 21], ['outside', 99]]) },
  { id: 'reed', stickers: {}, selectedRanks: new Map([[partner, 33]]) }];
  const map = { zoom: 1, model: { preferences: {} }, visibleMembers: members,
    cells: new Map(ids.map((id, x) => [id, { x, y: 0 }])),
    cellStates: new Map(ids.map(id => [id, { owners: [], selected: [], pending: false }])),
    active: { selectedRanks: members[0].selectedRanks }, candidateRanks: new Map([[candidate, 1]]),
    deathMarkers: new Map([[death, {}]]) };
  map.cellStates.set(selected, { owners: [members[0]], selected: [members[0]] });
  map.cellStates.set(tab, { owners: [members[0]], selected: [] });
  map.cellStates.set(shared, { owners: members, selected: [] });
  map.cellStates.set(partner, { owners: members, selected: [members[1]] });
  const sources = taskCountAnnotationCells(map);
  assert.deepEqual([...sources.keys()].sort(), [selected, candidate, flag, sticker, tab, partner, death].sort());
  const tools = { chunkIdLayout, layoutStickerCluster, startingFlagSize: () => 20 };
  const sorted = rows => rows.sort((a, b) => a.x - b.x || a.y - b.y || a.width - b.width || a.height - b.height);
  for (const size of [7.04, 12, 18, 30, 35, 64, 128, 512]) for (const showIds of [false, true]) {
    map.zoom = size / 128; map.model.preferences = { ids: showIds, chunkIdScale: 2, stickerScale: 2 };
    assert.deepEqual(sorted(taskCountObstacles(map, tools, sources)), sorted(taskCountObstacles(map, tools)),
      `Missing annotation at cell ${size}, IDs ${showIds}`);
  }
});

test('a starting flag or a sticker alone reserves its geometry beside unmarked cells', () => {
  const id = '12342', empty = '12343';
  for (const kind of ['flag', 'sticker']) {
    const members = [{ id: 'actor1', stickers: {}, ...(kind === 'flag' ? { startingChunk: id }
      : { stickers: { [id]: [{ id: 'star' }] } }) }];
    const map = { zoom: 1, model: { preferences: {} }, visibleMembers: members,
      cells: new Map([[id, { x: 0, y: 0 }], [empty, { x: 1, y: 0 }]]),
      cellStates: new Map(), active: { selectedRanks: new Map() }, candidateRanks: new Map(), deathMarkers: new Map() };
    const rectangles = taskCountObstacles(map, { chunkIdLayout, layoutStickerCluster, startingFlagSize: () => 20 });
    assert.equal(rectangles.length, 1);
    assert.deepEqual(rectangles[0], kind === 'flag' ? { x: 104, y: 104, width: 20, height: 20 }
      : { x: 100, y: 4, width: 24, height: 24 });
  }
});

test('badges stay clear of actual marker geometry at all zooms and 200% display sizes', () => {
  const id = '12342', members = ['actor1','reed'].map(owner => ({ id: owner, startingChunk: id,
    stickers: { [id]: Array.from({ length: 6 }, (_, index) => ({ id: `${owner}-${index}` })) } }));
  const context = new Proxy({ measureText: value => ({ width: value.length * 12 }) }, { get: (obj, key) => obj[key] ?? (() => {}) });
  for (const size of [7.04, 12, 18, 30, 35, 64, 128, 512]) {
    const map = { zoom: size / 128, model: { preferences: { ids: true, chunkIdScale: 2, stickerScale: 2 } },
      cells: new Map([[id, { x: 0, y: 0 }]]), visibleMembers: members,
      cellStates: new Map([[id, { owners: [members[0]], pending: false }]]),
      active: { selectedRanks: new Map([[id, 123]]) }, candidateRanks: new Map(), deathMarkers: new Map() };
    const local = taskCountObstacles(map, { chunkIdLayout, layoutStickerCluster, startingFlagSize: () => 0 });
    const obstacles = local.map(rect => ({ ...rect, x: rect.x + 250, y: rect.y + 200 }));
    const renderer = new MapTaskCountRenderer(), entries = renderer.draw(context, { counts: new Map([[id, 17]]), cells: map.cells,
      offset: { x: 250, y: 200 }, zoom: map.zoom, width: 1200, height: 1000, scale: 2, obstacles });
    assert.equal(entries.length, 1, `cell ${size}`);
    if (size >= 35) {
      const idLayout = chunkIdLayout(members, id, size, 2, 2);
      const chip = layoutStickerCluster(members, id, size, 2, idLayout.flagLift).overflow;
      if (chip) {
        const height = Math.max(Math.abs(chip.height), Math.max(7, chip.height - 2) + 2);
        obstacles.push({ x: 250 + chip.x, y: 200 + chip.y + chip.height / 2 - height / 2, width: chip.width, height });
      }
    }
    for (const a of entries) for (const b of obstacles) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
      || a.y + a.height <= b.y || b.y + b.height <= a.y, `Collision at cell ${size}`);
  }
});


test('only current-player eligible ranks reserve roll-number geometry', () => {
  const member = { id: 'one', stickers: {}, selectedRanks: new Map([['12341', 1]]) };
  const partner = { id: 'two', stickers: {}, selectedRanks: new Map([['12342', 2]]) };
  const map = { zoom: 1, model: { preferences: {} }, visibleMembers: [member, partner], active: member,
    cells: new Map([['12341', { x: 0, y: 0 }], ['12342', { x: 1, y: 0 }], ['12343', { x: 2, y: 0 }]]),
    cellStates: new Map([['12341', { owners: [], selected: [member] }], ['12342', { owners: [], selected: [partner] }],
      ['12343', { owners: [], selected: [] }]]), candidateRanks: new Map([['12343', 1]]), deathMarkers: new Map() };
  assert.deepEqual(taskCountObstacles(map, { chunkIdLayout, layoutStickerCluster }),
    [{ x: 257, y: 1, width: 126, height: 125 }]);
});
