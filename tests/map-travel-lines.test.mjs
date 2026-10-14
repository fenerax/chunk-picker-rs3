import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelLinesControl, createTravelLinesKey, drawMapConnections, readTravelLines, writeTravelLines, travelLineType, TRAVEL_LINE_TYPES, TRAVEL_LINES_KEY } from '../app/web/map-info.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { MAP_CONNECTIONS } from '../app/data/map-connections.mjs';
import { contrastRatio, themePalettes } from '../app/web/map-tools.mjs';

const endpoint = (chunkId, x, y) => ({ chunkId, mapId: 28, plane: 0, worldX: x, worldY: y, name: chunkId });
const route = (id, kind, x = 400, y = 100) => ({ id, kind, from: endpoint('12082', 100, 100), to: endpoint(id, x, y) });
function context() {
  return { strokes: [], stack: [], dash: [],
    save() { this.stack.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, dash: this.dash }); },
    restore() { Object.assign(this, this.stack.pop()); },
    setLineDash(value) { this.dash = [...value]; }, beginPath() { this.path = []; },
    moveTo(...point) { this.path.push(['move', ...point]); }, lineTo(...point) { this.path.push(['line', ...point]); },
    quadraticCurveTo(...point) { this.path.push(['curve', ...point]); },
    stroke() { this.strokes.push({ path: this.path, color: this.strokeStyle, dash: [...this.dash], width: this.lineWidth }); },
    arc() {}, fill() {}, strokeText() {}, fillText() {} };
}
function mapFixture() {
  const map = Object.create(ChunkMap.prototype);
  map.mapInformation = { connections: { connections: [route('9001', 'boat')] } };
  map.connectionChunkId = '12082'; map.dirty = { base: false, state: false, pins: false, hover: false };
  map.offset = { x: 0, y: 0 }; map.zoom = 1; map.schedule = () => { map.scheduled = (map.scheduled ?? 0) + 1; };
  return map;
}

test('travel lines default on and persist per viewer despite malformed or blocked storage', () => {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  for (const value of [undefined, '', 'null', '{broken', '0']) { memory.set(TRAVEL_LINES_KEY, value); assert.equal(readTravelLines(storage), true); }
  writeTravelLines(storage, false); assert.equal(readTravelLines(storage), false);
  writeTravelLines(storage, true); assert.equal(readTravelLines(storage), true);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readTravelLines(blocked), true); assert.doesNotThrow(() => writeTravelLines(blocked, false));
  assert.equal(readTravelLines(null), true);
});

test('hiding travel lines skips drawing while retaining selection, eligibility, and other map layers', () => {
  const map = mapFixture(), eligibility = { byChunk: { '12082': { connected: true } } };
  const memory = new Map(); map.travelLinesStorage = { setItem: (key, value) => memory.set(key, value) };
  map.connections = eligibility;
  assert.equal(map.drawConnectionLines(context()).length, 1);
  map.setTravelLinesVisible(false); const hiddenContext = context();
  assert.deepEqual(map.drawConnectionLines(hiddenContext), []); assert.deepEqual(hiddenContext.strokes, []);
  assert.equal(map.connectionChunkId, '12082'); assert.equal(map.connections, eligibility);
  assert.deepEqual(map.dirty, { base: false, state: false, pins: false, hover: true });
  assert.equal(memory.get(TRAVEL_LINES_KEY), 'false');
  map.setTravelLinesVisible(true); assert.equal(map.drawConnectionLines(context()).length, 1);
  assert.equal(map.scheduled, 2);
});

test('native Travel lines checkbox works, and the legend key has five labelled colour and dash swatches', () => {
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; this.events = {}; this.attributes = {}; this.style = { setProperty() {} }; }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
  }
  const doc = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), createTextNode: text => new Node('text', text) };
  const map = mapFixture(), control = createTravelLinesControl(map, doc);
  assert.equal(control.tag, 'fieldset'); assert.equal(control.children[0].textContent, 'Travel lines');
  const checkbox = control.children[1].children[0]; assert.equal(checkbox.type, 'checkbox'); assert.equal(checkbox.checked, true);
  checkbox.checked = false; checkbox.events.change(); assert.equal(map.travelLinesVisible, false);
  checkbox.checked = true; checkbox.events.change(); assert.equal(map.travelLinesVisible, true);
  // The control is a single toggle; the colour key is its own element shown in the Map legend.
  assert.equal(control.children.length, 2);
  const key = createTravelLinesKey(doc); assert.equal(key.children.length, 5);
  assert.deepEqual(key.children.map(row => row.children[1].textContent), TRAVEL_LINE_TYPES.map(type => type.label));
  assert.deepEqual(key.children.map(row => row.children[0].children[0].attributes['stroke-dasharray']), TRAVEL_LINE_TYPES.map(type => type.dash.join(' ')));
});

test('transport key uses distinct patterns and readable dark, gray and light colours', () => {
  for (const [edge, id] of [[{ kind: 'boat' }, 'ship'], [{ kind: 'canoe' }, 'canoe'], [{ kind: 'transport', label: 'Magic carpet ride' }, 'carpet'], [{ kind: 'portal' }, 'teleport'], [{ kind: 'lodestone' }, 'teleport'], [{ kind: 'retained-connection', label: 'Somewhere' }, 'other']]) assert.equal(travelLineType(edge).id, id);
  assert.equal(new Set(TRAVEL_LINE_TYPES.map(type => type.dash.join(','))).size, 5, 'Colour alone never identifies transport');
  for (const theme of ['dark', 'gray', 'light']) for (const type of TRAVEL_LINE_TYPES) {
    const palette = themePalettes[theme], color = palette.scheme === 'light' ? type.lightColor : type.color;
    assert.ok(contrastRatio(color, palette.panel) >= 3, `${theme} ${type.id} graphical swatch`);
    const map = mapFixture(); map.model = { preferences: { theme } }; map.mapInformation.connections.connections = [route('9001', type.id === 'ship' ? 'boat' : type.id)];
    assert.ok(map.drawConnectionLines(context()).length);
    const ctx = context(); map.drawConnectionLines(ctx);
    assert.ok(ctx.strokes.some(stroke => stroke.color === color && stroke.dash.join() === type.dash.join()));
  }
});

test('explicit travel modes between neighbouring chunks are retained while walking stays hidden', () => {
  const edges = ['ship', 'carpet', 'boat', 'canoe', 'teleport', 'walking'].map(kind => ({ ...route(kind, kind), to: endpoint('12083', 400, 100) }));
  const segments = drawMapConnections(context(), { connections: edges }, { chunkId: '12082' });
  assert.deepEqual(segments.map(row => row.type.id), ['ship', 'carpet', 'canoe', 'teleport']);
});

test('parallel routes keep screen-space curves and deterministic lanes at low zoom', () => {
  const edges = [route('a', 'boat'), route('b', 'boat', 700), route('c', 'canoe', 550)];
  for (const zoom of [1, .25]) {
    const ctx = context(), segments = drawMapConnections(ctx, { connections: edges }, { chunkId: '12082', zoom });
    assert.equal(segments.length, 3);
    assert.equal(new Set(segments.map(segment => segment.control.y)).size, 3);
    assert.ok(Math.max(...segments.map(segment => segment.control.y)) - Math.min(...segments.map(segment => segment.control.y)) >= 44);
    const reversed = drawMapConnections(context(), { connections: [...edges].reverse() }, { chunkId: '12082', zoom });
    for (const segment of segments) assert.deepEqual(reversed.find(row => row.edge.id === segment.edge.id).control, segment.control);
    assert.ok(ctx.strokes.some(stroke => stroke.path.some(command => command[0] === 'curve')));
    assert.deepEqual(segments[0].from, { x: 100 * zoom, y: 100 * zoom }, 'Source positions remain exact');
  }
});

test('different transport types between the same chunks survive reverse deduplication', () => {
  const boat = route('a', 'boat'), canoe = { ...boat, id: 'canoe', kind: 'canoe' };
  const back = { ...boat, id: 'boat-back', from: boat.to, to: boat.from };
  const directed = { ...boat, id: 'one-way', directionVerified: true, bidirectional: false };
  const ctx = context(); const segments = drawMapConnections(ctx, { connections: [boat, canoe, back, directed] }, { chunkId: '12082' });
  assert.equal(segments.length, 3); assert.equal(segments.filter(row => row.type.id === 'ship').length, 2);
  assert.equal(ctx.strokes.filter(stroke => stroke.color === travelLineType(boat).color && stroke.dash.length === 0).length, 1, 'Only verified one-way routes acquire arrows');
  assert.ok(segments.every(row => row.control), 'Matching destinations get separate lanes');
});

