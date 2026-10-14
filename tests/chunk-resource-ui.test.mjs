import { appendTaskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';
import { readScreenGraph, runScreenGraph } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { CACHE_SECTION_OFFSET } from '../app/data/cache-topology.mjs';
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

// Execute the shipped module with inert panel collaborators, without startup,
// server requests or gameplay writes.
const screenGraph = await readScreenGraph();
function harness() {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener() {}
  }
  const nodes = new Map(), document = { hidden: false, addEventListener() {}, createElement: tag => new Node(tag), getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, new Node('div')); return nodes.get(id);
  } };
  document.getElementById('pool-ranking-panel').hidden = true;
  const inert = () => ({});
  const context = createContext({ appendTaskClaim, createTaskClaimClock, createMapTaskCounts, createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), document, createSandbox, createCompletedView, createDuoCoordination, openTeleportsDialog, createDuoResultCache, selectDuoTasks, createDuoTaskView, createTaskFilters, appendTaskPin, isTaskPinned, createTaskPinChecker, CACHE_SECTION_OFFSET, createTaskIconPainter, originalSettings: {}, setTimeout, clearTimeout,
    crypto: webcrypto, Uint8Array, AbortController, addEventListener() {},
    createRuleRegistry: inert, createSettingsPanel: inert, createRulesPanel: inert, createInfoPanels: inert, createMapTools: inert,
    skillIcon: () => null, itemIcon: () => null, loadIcons: async () => false, interiorCandidates: () => [], interiorPanel: () => ({}), describeHistoryEvent: event => event.type, createFeedback: () => ({ open() {} }), createUpdates: () => ({ seen() {}, openList() {} }), createRuneMetricsControls: () => ({}), createStickerPicker: () => ({ open() {}, close() {}, isOpen: () => false, element: { contains: () => false } }), createOriginalSync: inert, createDeathChunks: inert, createChunkPlanning: () => ({ render: () => new Node('div') }),
  });
  const run = code => runInContext(code, context);
  runScreenGraph(context, screenGraph);
  run("memberId = 'actor1'; state = { members: [{ id: 'actor1', name: 'Player', unlocked: [], selected: [], blacklisted: [], pendingRoll: [] }] }; world = { chunks: new Map(), areas: new Map(), surface: new Set(), sectionTopology: new Map() }; pool = { eligible: [], excluded: [] }");
  const walk = node => [node, ...node.children.flatMap(walk)];
  const render = record => { context.record = record; return walk(run('chunkContents(record)')); };
  return { run, render, nodes, context, walk };
}

test('Advanced object provenance is visible without becoming a contents group', () => {
  const h = harness(); h.run('state.members[0].preferences = { advanced:true }'); const rows = h.render({ Object: { Oak: 2, Anvil: 1, Furnace: 1, Bench: 2 },
    ObjectProvenance: { Oak: { source: 'game-data', classKey: 'woodcutting:oak' }, Anvil: { source: 'retained-only', classKey: 'facility:anvil' },
      Bench: { source: 'retained-only', classKey: null } },
    NPC: { Oak: 1 } });
  assert.equal(rows.filter(node => node.textContent === 'Game data').length, 1);
  // Unclassified objects such as benches were never compared, so only the anvil is flagged.
  assert.equal(rows.filter(node => node.textContent === 'Not in game data').length, 1);
  assert.match(rows.find(node => node.textContent === 'Game data').title, /game files/);
  assert.ok(rows.some(node => node.textContent === 'Oak × 2'));
  assert.ok(rows.some(node => node.textContent === 'Object (4)'));
  assert.ok(!rows.some(node => node.textContent?.includes('ObjectProvenance')));
});

test('cache component labels remove the internal offset and preserve sections', () => {
  const h = harness();
  h.run("state.members[0].preferences = { defaultChunkinfo: 'features' }");
  const rows = h.render({ Sections: { 2: { Object: { Anvil: 1 } } },
    CacheComponents: { '12341-1000007': { Object: { Willow: 4 }, ObjectProvenance: { Willow: { source: 'game-data' } } } } });
  assert.ok(rows.some(node => node.textContent === 'Section 2'));
  assert.ok(rows.some(node => node.textContent === 'Walkable area 7'));
  const component = rows.find(node => node.tagName === 'details' && node.children[0].textContent === 'Walkable area 7');
  assert.equal(component.open, true);
  assert.match(component.title, /Current access depends/);
  assert.ok(rows.some(node => node.textContent === 'Willow × 4'));
  assert.ok(!rows.some(node => node.textContent?.includes('1000007')));
});

test('chunk panel prefers world resource contents and falls back to retained definitions', () => {
  const h = harness();
  h.run("world.areas.set('interior', { name: 'Interior' }); definitions = { chunks: { interior: { Object: { Retained: 1 } } } }; world.resourceContents = new Map([['interior', { Object: { Derived: 2 }, ObjectProvenance: { Derived: { source: 'game-data' } } }]]); showChunk('interior')");
  let rows = h.walk(h.nodes.get('chunk-content'));
  assert.ok(rows.some(node => node.textContent === 'Derived × 2'));
  assert.ok(!rows.some(node => node.textContent === 'Retained × 1'));
  h.run("world.resourceContents = undefined; showChunk('interior')");
  rows = h.walk(h.nodes.get('chunk-content'));
  assert.ok(rows.some(node => node.textContent === 'Retained × 1'));
  assert.ok(!rows.some(node => node.textContent === 'Game data'));
});

test('unreached cache-only placements remain visible with a player-specific availability note', () => {
  const h = harness(), record = { CacheComponents: { '12341-1000007': {
    Object: { Furnace: 2, Anvil: 1 }, ObjectProvenance: {
      Furnace: { source: 'game-data', cacheOnly: true }, Anvil: { source: 'game-data', cacheOnly: false },
    },
  } } };
  h.run("state.revision = 3; result = { memberId: 'actor1', stateRevision: 3, access: { bases: ['12341'], components: ['12341-1000001'] } }");
  const label = 'Behind a door or inaccessible';
  let rows = h.render(record);
  assert.ok(rows.some(node => node.textContent === 'Furnace × 2'));
  assert.ok(rows.some(node => node.textContent === 'Anvil × 1'));
  assert.equal(rows.filter(node => node.textContent === label).length, 1);
  assert.match(rows.find(node => node.textContent === label).title, /not currently reachable/);
  assert.ok(!h.run('result.access.components.includes("12341-1000007")'));

  for (const setup of [
    "result.access.components.push('12341-1000007')",
    "result.access.components = []; result.access.bases = []",
    "result.access.bases = ['12341']; result.stateRevision = 2",
    "result.stateRevision = 3; result.memberId = 'reed'",
    "result = undefined",
  ]) {
    h.run(setup); rows = h.render(record);
    assert.ok(!rows.some(node => node.textContent === label), setup);
    assert.ok(rows.some(node => node.textContent === 'Furnace × 2'), setup);
  }
});

test('merged game and retained resources render their game quantity once and names remain text', () => {
  const h = harness(); h.run('state.members[0].preferences = { advanced:true }'); const name = 'Furnace<img src=x onerror=alert(1)>', unsafeClass = '\"><script>alert(2)</script>';
  const rows = h.render({ Object: { [name]: 3 }, ObjectProvenance: { [name]: {
    source: 'game-data', cacheOnly: false, classKey: unsafeClass,
    components: ['12341-1000001', '12341-1000007'], retainedLocations: ['12341-2'], placements: ['a', 'b', 'c'],
  } } });
  assert.equal(rows.filter(node => node.textContent === 'Furnace × 3').length, 1);
  assert.equal(rows.filter(node => node.textContent === 'Game data').length, 1);
  assert.ok(!rows.some(node => node.textContent === 'Behind a door or inaccessible'));
  assert.ok(!rows.find(node => node.textContent === 'Game data').title.includes(unsafeClass));
  assert.ok(!rows.some(node => ['img', 'script'].includes(node.tagName) || node.innerHTML));
});

test('aggregate cache-only rows are inaccessible only when none of their locations is reached', () => {
  const h = harness(), record = { Object: { Furnace: 3 }, ObjectProvenance: { Furnace: {
    source: 'game-data', cacheOnly: true, components: ['12341-1000007', '12341-1000008'],
  } } };
  h.run("state.revision = 3; result = { memberId: 'actor1', stateRevision: 3, access: { bases: ['12341'], components: ['12341-1000001'] } }");
  let rows = h.render(record);
  assert.equal(rows.filter(node => node.textContent === 'Furnace × 3').length, 1);
  assert.equal(rows.filter(node => node.textContent === 'Behind a door or inaccessible').length, 1);
  h.run("result.access.components.push('12341-1000008')");
  rows = h.render(record);
  assert.equal(rows.filter(node => node.textContent === 'Furnace × 3').length, 1);
  assert.ok(!rows.some(node => node.textContent === 'Behind a door or inaccessible'));
});
