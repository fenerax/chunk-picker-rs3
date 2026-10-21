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

test('Port Sarim retains its surface ships and separates nearby bearings', () => {
  const segments = drawMapConnections(context(), MAP_CONNECTIONS, { chunkId: '12082', zoom: .4 });
  const musa = segments.find(row => row.edge.id === 'connection-port-sarim--musa-point');
  assert.ok(musa); assert.equal(musa.type.id, 'ship');
  const ships = segments.filter(row => row.type.id === 'ship'); assert.ok(ships.length >= 3);
  assert.ok(ships.some(row => row.control), 'Actual Port Sarim routes use separated curves');
  assert.ok(segments.every(row => row.edge.kind !== 'walking'));
});
