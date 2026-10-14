import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMapInformation, indexPinDetails, mapConnectionsForChunk, drawMapConnections } from '../app/web/map-info.mjs';
import { MapPinRenderer } from '../app/web/map-pin-renderer.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { MAP_CONNECTIONS, getMapConnectionsForChunk } from '../app/data/map-connections.mjs';

const detail = { id: 'fish', categoryLabel: 'Fishing spot', description: 'Trout and salmon', provenance: [{ source: 'fixture' }] };
const endpoint = (chunkId, worldX, worldY) => ({ chunkId, areaId: null, sectionId: `${chunkId}-1`, mapId: 28, plane: 0, worldX, worldY });
const edges = { connections: [
  { id: 'out', from: endpoint('12339', 100, 200), to: endpoint('9001', 300, 400), bidirectional: false, directionVerified: true },
  { id: 'back', from: endpoint('9001', 300, 400), to: endpoint('12339', 100, 200), bidirectional: true },
  { id: 'underground', from: endpoint('12339', 100, 200), to: { ...endpoint('9999', 500, 600), mapId: 1 } },
] };

test('optional information loader accepts the authenticated reference shape and fails quietly', async () => {
  const data = { schemaVersion: 1, pinDetails: { pins: [detail] }, connections: edges };
  const calls = [];
  assert.equal(await loadMapInformation(async route => { calls.push(route); return { ok: true, json: async () => data }; }), data);
  assert.deepEqual(calls, ['/api/map-info']);
  assert.equal(await loadMapInformation(async () => ({ ok: false })), null);
  assert.equal(await loadMapInformation(async () => { throw Error('offline'); }), null);
  assert.equal(await loadMapInformation(async () => ({ ok: true, json: async () => ({ schemaVersion: 1 }) })), null);
  assert.equal(indexPinDetails({ pins: [detail] }).get('fish'), detail);
});

test('connection lookup includes incoming links, sections and areas without partial ID matches', () => {
  assert.deepEqual(mapConnectionsForChunk(edges, '9001').map(edge => edge.id), ['out', 'back']);
  assert.deepEqual(mapConnectionsForChunk(edges, '12339-1').map(edge => edge.id), ['out', 'back', 'underground']);
  assert.deepEqual(mapConnectionsForChunk(edges, '123'), []);
  assert.deepEqual(mapConnectionsForChunk(edges, null), []);
  assert.equal(mapConnectionsForChunk({ connections: [{ from: { areaId: 'Cave' }, to: {} }] }, 'Cave').length, 1);
  assert.equal(mapConnectionsForChunk({ connections: [{ from: { chunkId: 'Old area', displayChunkId: '16670' }, to: {} }] }, '16670').length, 1);
});

test('projected map-label chunks return the same reference connections as retained lookup', () => {
  for (const id of ['16670', '13357', '15171', '9001', '12850', '12850-1']) {
    assert.deepEqual(mapConnectionsForChunk(MAP_CONNECTIONS, id).map(edge => edge.id), getMapConnectionsForChunk(id).map(edge => edge.id), id);
  }
});

function drawingContext() {
  return { paths: [], stack: [], setLineDash(value) { this.dash = value; },
    save() { this.stack.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, dash: this.dash }); },
    restore() { Object.assign(this, this.stack.pop()); },
    beginPath() { this.path = []; }, moveTo(...point) { this.path.push(point); }, lineTo(...point) { this.path.push(point); },
    stroke() { this.paths.push({ points: this.path, color: this.strokeStyle, width: this.lineWidth }); },
    arc() {}, fill() {}, strokeText() {}, fillText() {} };
}

test('drawing projects surface endpoints, arrows directed records, and restores canvas style', () => {
  const context = drawingContext(); context.strokeStyle = 'old'; context.lineWidth = 9; context.globalAlpha = 0.2; context.dash = [1];
  const segments = drawMapConnections(context, edges, { chunkId: '9001', offset: { x: 10, y: 20 }, zoom: 2, style: { color: 'blue' } });
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].from, { x: 210, y: 420 });
  assert.deepEqual(segments[0].to, { x: 610, y: 820 });
  // A dark casing and ringed endpoints sit under the coloured strokes; count only the coloured ones.
  const coloured = context.paths.filter(path => path.color === 'blue');
  assert.equal(coloured.length, 3, 'Two links and one directional arrow');
  assert.equal(context.strokeStyle, 'old'); assert.equal(context.lineWidth, 9); assert.equal(context.globalAlpha, 0.2); assert.deepEqual(context.dash, [1]);
  assert.equal(drawMapConnections(context, edges, { chunkId: '12339' }).length, 2, 'Off-map endpoints are skipped');
  assert.deepEqual(drawMapConnections(context, edges, { chunkId: 'unknown' }), []);
  const unknownDirection = drawingContext();
  drawMapConnections(unknownDirection, { connections: [{ ...edges.connections[0], directionVerified: undefined }] }, { chunkId: '9001' });
  assert.equal(unknownDirection.paths.filter(path => path.color === '#ffd36b').length, 1, 'An absent reverse dependency must not acquire an arrowhead');
});

test('pin hits return exact-ID details and never reuse hidden or aggregated-out pins', () => {
  const pin = { id: 'fish', worldX: 100, worldY: 100, categoryId: 'fishing-spot', label: 'Fishing spot' };
  const renderer = new MapPinRenderer({ categories: [{ id: 'fishing-spot' }] }, { pins: [pin] }, { canvasFactory: () => null });
  const context = { globalAlpha: 1, beginPath() {}, arc() {}, fill() {}, stroke() {} };
  const view = { offset: { x: 20, y: 30 }, zoom: 2, width: 600, height: 600, unlocked: new Set() };
  renderer.setDetails({ pins: [detail] }); renderer.draw(context, view);
  assert.deepEqual(renderer.hitAt({ x: 220, y: 230 }), { pin, detail });
  assert.equal(renderer.detailAt({ x: 220, y: 230 }), detail);
  assert.equal(renderer.detailFor('unmatched-old-id'), null);
  assert.equal(renderer.hitAt({ x: 100, y: 100 }), null);
  renderer.setFilters({ hiddenPinIds: ['fish'] });
  assert.equal(renderer.hitAt({ x: 220, y: 230 }), null, 'Hidden targets vanish before the next frame');
  renderer.draw(context, view); assert.equal(renderer.detailAt({ x: 220, y: 230 }), null);
  renderer.dispose();
});

test('ChunkMap exposes pin and selected-area connection hooks without changing eligibility connections', () => {
  const eligibility = { byChunk: {} }, map = Object.create(ChunkMap.prototype);
  map.connections = eligibility; map.dirty = {}; map.schedule = () => {};
  map.pins = { setDetails(value) { this.details = value; }, at: () => ({ id: 'fish' }), detailAt: () => detail, hitAt: () => ({ pin: { id: 'fish' }, detail }) };
  map.offset = { x: 0, y: 0 }; map.zoom = 1;
  map.setMapInformation({ pinDetails: { pins: [detail] }, connections: edges });
  assert.equal(map.pinDetailAt(), detail); assert.equal(map.pinAt().id, 'fish'); assert.equal(map.pinHitAt().detail, detail);
  assert.equal(map.setConnectionChunk('9001').length, 2);
  assert.equal(map.drawConnectionLines(drawingContext()).length, 2);
  assert.equal(map.connections, eligibility);
  map.setConnectionChunk(null); assert.equal(map.drawConnectionLines(drawingContext()).length, 0);
});
