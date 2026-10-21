import { appendTaskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';
import { readScreenGraph, runScreenGraph } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { ChunkMap } from '../app/web/map.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';
import { createOriginalSync } from '../app/web/dataset-panels.mjs';
import { createTaskIconPainter } from '../app/web/task-icon-painter.mjs';
import { createSandbox } from '../app/web/sandbox.mjs';
import { createCompletedView } from '../app/web/completed-view.mjs';
import { createDuoCoordination } from '../app/web/duo-coordination.mjs';
import { openTeleportsDialog } from '../app/web/teleports.mjs';
import { createDuoResultCache, selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';
import { createTaskFilters, appendTaskPin } from '../app/web/task-filters.mjs';
import { isTaskPinned, createTaskPinChecker } from '../app/web/task-filters-model.mjs';
import { createMapTaskCounts } from '../app/web/map-task-counts.mjs';

test('membership overlay leaves F2P untinted and gives every unwalkable square, with or without a record, one wash and texture', () => {
  const members = String(SURFACE_GRID.startId), free = String(SURFACE_GRID.startId - 1), unwalkable = String(SURFACE_GRID.startId + SURFACE_GRID.stride);
  const world = buildWorld({ chunks: { [members]: {}, [free]: {}, [unwalkable]: {} }, walkableChunks: [members, free], walkableChunksF2P: [free] });
  const map = Object.assign(Object.create(ChunkMap.prototype), { model: { world, preferences: {} }, cells: new Map([...world.surface].map(id => [id, {}])), offset: { x: 0, y: 0 }, zoom: 0.5, width: 127, height: 127 });
  const cells = [
    { id: members, column: 0, row: 0, x: 0, y: 0 },
    { id: free, column: 0, row: 1, x: 0, y: 64 },
    { id: unwalkable, column: 1, row: 0, x: 64, y: 0 },
  ];
  const fills = [], strokes = [];
  const context = {
    fillRect(...rect) { fills.push({ rect, color: this.fillStyle }); },
    beginPath() { this.path = []; }, moveTo(...point) { this.path.push(point); }, lineTo(...point) { this.path.push(point); },
    setLineDash(dash) { this.dash = [...dash]; }, stroke() { strokes.push({ path: this.path, color: this.strokeStyle, dash: this.dash ?? [] }); },
  };
  map.drawMembership(context, cells, 64);
  // The right column has one unwalkable record and one absent record. Both share one wash.
  assert.equal(fills.length, 3);
  assert.deepEqual(fills.map(fill => fill.rect), [[64, 0, 64, 64], [64, 64, 64, 64], [0, 0, 64, 64]]);
  assert.equal(fills[0].color, fills[1].color);
  assert.notEqual(fills[0].color, fills[2].color);
  assert.ok(strokes[0].path.length > 0, 'Unclassified terrain has a visible texture');
  assert.deepEqual(strokes[0].dash, [1, 5]);
  assert.ok(strokes[1].path.length > 0, 'Members land keeps diagonal hatching');
  assert.deepEqual(strokes[1].dash, []);
  assert.deepEqual(context.dash, [], 'Overlay restores the solid stroke for later map layers');
});

test('collapsible map legend describes only the active map layers and chunk states', async () => {
  class Node {
    children = []; style = { setProperty() {} };
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener() {}
  }
  const nodes = new Map();
  const document = {
    hidden: false, addEventListener() {},
    createElement: () => new Node(),
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
  };
  document.getElementById('pool-ranking-panel').hidden = true;
  const context = createContext({ appendTaskClaim, createTaskClaimClock, createMapTaskCounts, createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), document, crypto: webcrypto, Uint8Array, AbortController, addEventListener() {}, createSandbox, createCompletedView, createDuoCoordination, openTeleportsDialog, createDuoResultCache, selectDuoTasks, createDuoTaskView, createTaskFilters, appendTaskPin, isTaskPinned, createTaskPinChecker, createTaskIconPainter, originalSettings: {}, skillIcon: () => null, itemIcon: () => null, loadIcons: async () => false, interiorCandidates: () => [], interiorPanel: () => ({}), describeHistoryEvent: event => event.type, createFeedback: () => ({ open() {} }), createUpdates: () => ({ seen() {}, openList() {} }), createRuneMetricsControls: () => ({}), createStickerPicker: () => ({ open() {}, close() {}, isOpen: () => false, element: { contains: () => false } }), createOriginalSync, createRuleRegistry: () => ({}), createSettingsPanel: () => ({}), createRulesPanel: () => ({}), createInfoPanels: () => ({}), createMapTools: () => ({}), createChunkPlanning: () => ({}), createDeathChunks: () => ({}), setTimeout() {}, clearTimeout() {} });
  runScreenGraph(context, await readScreenGraph());
  runInContext("state = { members: [{ id: 'actor1' }] }; memberId = 'actor1'; map = { members: state.members, overlay: 'membership' }; renderLegend();", context);
  const labels = () => nodes.get('map-legend').children.map(node => node.children[1]);
  assert.ok(labels().includes('Not walkable'));
  assert.ok(labels().includes('Members-only land'));
  runInContext('map.overlay = null; renderLegend();', context);
  assert.ok(!labels().includes('Not walkable'));
  assert.ok(!labels().includes('In roll pool (numbered)'));
  assert.ok(!labels().includes('Roll choices'));
  assert.ok(!labels().includes('Estimated death chunk'));
  assert.ok(!labels().includes('Map icons'));
  assert.ok(labels().includes('Active task count'));
  runInContext('mapDisplay.sizes.showTaskCounts = false; renderLegend();', context);
  assert.ok(!labels().includes('Active task count'));
  runInContext('mapDisplay.sizes.showTaskCounts = true; renderLegend();', context);
  runInContext("state.members = [{ id: 'actor1', name: 'Player', unlocked: ['1'], selected: ['2'], pendingRoll: [] }, { id: 'reed', name: 'Reed', unlocked: ['3'], selected: [], pendingRoll: ['4'] }]; map.members = state.members; pool = { eligible: [{ id: '2' }] }; map.deathMarkers = new Map([['2', {}]]); map.pins = { enabled: new Set(['bank']) }; map.connections = { byChunk: { '3': { connected: false } } }; document.getElementById('group-view').checked = true; renderLegend();", context);
  for (const label of ['Unlocked', 'Player only', 'Reed only', 'In roll pool (added by hand)', 'Roll choices', 'Estimated death chunk', 'Map icons', 'Disconnected partner']) assert.ok(labels().includes(label), label);
  runInContext("document.getElementById('group-view').checked = false; renderLegend();", context);
  for (const label of ['Player only', 'Reed only', 'Roll choices', 'Disconnected partner']) assert.ok(!labels().includes(label), label);
});
