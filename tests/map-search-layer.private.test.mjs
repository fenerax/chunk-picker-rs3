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

test('public map API changes only the search layer; model updates retain roll and open-chunk state', () => {
  const world = buildWorld({ chunks: { '7495': {}, '7494': {} }, walkableChunks: [], walkableChunksF2P: [] });
  const state = { revision: 1, members: [{ id: 'one', unlocked: ['7495'], selected: ['7494'], pendingRoll: ['7495'] }] };
  const map = Object.assign(Object.create(ChunkMap.prototype), {
    searchLayer: new MapSearchLayer(), cells: new Map(), dirty: {}, deathMarkers: new Map(), markerImages: new Map(),
    initialized: true, connectionChunkId: '7494', schedule() { this.scheduled = (this.scheduled ?? 0) + 1; },
  });
  const model = { world, state, memberId: 'one' };
  map.setModel(model);
  const before = JSON.stringify(state), active = map.active, ranks = map.candidateRanks, cellStates = map.cellStates;
  map.dirty = {};
  map.setSearchMatches(new Set(['7495', '7494-1', '7494']));
  assert.equal(map.searchLayer.matches.size, 2);
  assert.deepEqual(map.dirty, { hover: true }, 'Fallback redraws only hover');
  assert.equal(map.active, active);
  assert.equal(map.candidateRanks, ranks);
  assert.equal(map.cellStates, cellStates);
  assert.equal(map.connectionChunkId, '7494');
  assert.equal(JSON.stringify(state), before);
  map.setModel({ ...model, preferences: { theme: 'light' } });
  assert.equal(map.searchLayer.matches.size, 2);
  state.revision++;
  map.setModel(model);
  assert.equal(map.searchLayer.matches.size, 0, 'Revision snapshot catches in-place changes');
  map.setSearchMatches(['7495']);
  map.setSearchMatches([]);
  assert.equal(map.searchLayer.matches.size, 0);
});

