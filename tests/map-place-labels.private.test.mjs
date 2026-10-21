import test from 'node:test';
import assert from 'node:assert/strict';
import { MapPlaceLabels, selectPlaceLabels, layoutPlaceLabels, placeLabelPoint, fitPlaceLabels,
  placeLabelChunkObstacles, placeLabelLeaderIntersects, placeLabelPanelBoxes, defaultPlaceLabels, LABEL_INKS } from '../app/web/map-place-labels.mjs';
import { RectangleIndex } from '../app/web/map-task-count-renderer.mjs';

const label = (id, level, x = 3200, y = 3200) => ({ id, name: id, level, x, y,
  priority: { region: 300, town: 200, place: 100 }[level] });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

test('only the default of a switched name is drawn: Barbarian Village, not "(Barbarian Village)"', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('../app/data/place-labels.2026-10-13.v1.json', import.meta.url), 'utf8'));
  const names = defaultPlaceLabels(data.labels).map(entry => entry.name);
  assert.ok(names.includes('Barbarian Village'));
  assert.ok(!names.includes('(Barbarian Village)') && !names.includes('Gunnarsgrunn'));
  // Names with no default sibling are untouched.
  for (const kept of ['Clan Camp', 'Kalphite Nursery', 'Xolo city']) assert.ok(names.includes(kept), kept);
  assert.equal(names.length, data.labels.length - 2);
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

const fittingEntry = (id, overrides = {}) => ({ id, name: id, level: 'town', priority: 0,
  x: 40, y: 40, width: 40, height: 20, fontSize: 14, lines: [id], ...overrides });
const rectangleIndex = rectangles => {
  const index = new RectangleIndex();
  for (const rectangle of rectangles) index.add(rectangle);
  return index;
};

function chunkObstacleFixture(zoom = 1) {
  const cells = new Map([['left', { x: 0, y: 0 }], ['right', { x: 1, y: 0 }]]);
  const owner = { id: 'owner' };
  return { zoom, cells, unlocked: new Set(['left', 'right']), model: { preferences: { highvis: false } },
    cellStates: new Map([...cells.keys()].map(id => [id, { owners: [owner], colourPaint: null }])),
    cellId(column, row) { return row === 0 ? column === 0 ? 'left' : column === 1 ? 'right' : null : null; } };
}

