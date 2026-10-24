// Pure helper/source tests only. No app, browser, provider or native process startup.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { instrumentMainSource, MAIN_ATTACH_ANCHOR, projectSnapshot, compareProjection, installAdapter } from './browser-adapter.mjs';

const rows = [
  { label: 'Catch a shrimp', meta: 'Fishing · doable now', blocked: false, category: 'Fishing' },
  { label: 'Cut a yew tree', meta: 'Woodcutting · You need level 60', blocked: true, category: 'Woodcutting' },
];
const snapshot = { pageRows: rows.map((row, i) => ({ ...row, ref: `row-${i}`, id: null, inViewport: i === 0 })),
  counts: { shown: 2, matching: 2, total: 2 }, searchValue: '', showMoreHidden: true };
const expected = { rows, counts: { shown: 2, matching: 2, total: 2 }, searchValue: '', showMoreHidden: true };

test('main attaches before the one startup anchor without replacing shipping algorithms', () => {
  const source = `import './screen.mjs';\nconst screen = make();\n${MAIN_ATTACH_ANCHOR}(handle);\n`;
  const transformed = instrumentMainSource(source);
  assert.equal(transformed, source.replace(MAIN_ATTACH_ANCHOR, `window.__r116Attach(screen);\n${MAIN_ATTACH_ANCHOR}`));
});
test('missing and duplicate anchors and preinstrumented input fail closed', () => {
  for (const source of ['', `${MAIN_ATTACH_ANCHOR};${MAIN_ATTACH_ANCHOR}`, `window.__r116Attach(screen);${MAIN_ATTACH_ANCHOR}`]) {
    assert.throws(() => instrumentMainSource(source), /R116_MAIN_ANCHOR_NOT_UNIQUE/);
  }
});
test('full first-page projection retains offviewport rows and uses no task IDs', () => {
  assert.deepEqual(projectSnapshot(snapshot), expected);
  assert.equal(projectSnapshot(snapshot).rows.length, 2);
  assert.equal('id' in projectSnapshot(snapshot).rows[1], false);
});
test('exact label/meta/blocked/count projection matches', () => {
  assert.deepEqual(compareProjection(snapshot, expected), { matches: true, reason: null });
});
test('wrong order, blocked class, explanation, category and offviewport missing row fail', () => {
  const changes = [
    { ...snapshot, pageRows: [...snapshot.pageRows].reverse() },
    { ...snapshot, pageRows: snapshot.pageRows.map((row, i) => i ? { ...row, blocked: false } : row) },
    { ...snapshot, pageRows: snapshot.pageRows.map((row, i) => i ? { ...row, meta: 'Woodcutting · unavailable' } : row) },
    { ...snapshot, pageRows: snapshot.pageRows.map((row, i) => i ? { ...row, category: 'Mining' } : row) },
    { ...snapshot, pageRows: snapshot.pageRows.slice(0, 1) },
  ];
  for (const changed of changes) assert.equal(compareProjection(changed, expected).matches, false);
});
test('counts, empty search and Show more visibility are compared independently', () => {
  for (const key of ['shown', 'matching', 'total']) {
    assert.equal(compareProjection({ ...snapshot, counts: { ...snapshot.counts, [key]: 99 } }, expected).matches, false);
  }
  assert.equal(compareProjection({ ...snapshot, searchValue: 'yew' }, expected).matches, false);
  assert.equal(compareProjection({ ...snapshot, showMoreHidden: false }, expected).matches, false);
});
test('projection accepts flat counts and pageRows but rejects missing counts', () => {
  const flatExpected = { pageRows: rows, shown: 2, matching: 2, total: 2 };
  assert.equal(compareProjection(snapshot, flatExpected).matches, true);
  assert.equal(compareProjection(snapshot, { rows }).matches, false);
});
test('injectable function is self contained and module import has no startup side effect', () => {
  const source = installAdapter.toString();
  assert.ok(source.includes('__r116ArmAll'));
  assert.ok(source.includes('observer.observe(loc.list, { childList: true })'));
  assert.equal(source.includes('ensurePlanningResult('), false);
  assert.equal(source.includes('taskRenderDone.then'), false);
  assert.equal(source.includes('startServer('), false);
});

// In-memory protocol fixture only: no browser engine, DOM package, app imports or network.
function emptyContrastFixture({ opening = false } = {}) {
  const callbacks = new Map(), microtasks = [], calls = [], observers = [], frames = [];
  let tick = 0;
  const node = (tagName, textContent = '') => ({ tagName, textContent, children: [], hidden: false,
    isConnected: true, classList: { contains: () => false }, getAttribute: () => null,
    closest: () => null, getBoundingClientRect: () => ({ width: 400, height: 100, top: 0, left: 0, right: 400, bottom: 100 }),
    querySelectorAll: () => [] });
  const highest = node('BUTTON', 'Highest level 0'), doable = node('BUTTON', 'Doable 0'), blocked = node('BUTTON', 'Blocked 4'), all = node('BUTTON', 'All 4');
  let selected = opening ? highest : blocked, exposePane = !opening, taskSelected = !opening;
  for (const chip of [highest, doable, blocked, all]) chip.getAttribute = name => name === 'aria-pressed' ? String(chip === selected) : null;
  const summary = node('SUMMARY', 'Possible Tasks'), pane = node('DETAILS'), bar = node('DIV'), list = node('DIV');
  pane.open = true; pane.children = [summary, bar, list];
  bar.children = [highest, doable, blocked, all]; bar.nextElementSibling = list;
  const emptyNote = node('P', 'No tasks in this view.');
  list.children = [emptyNote]; list.firstElementChild = emptyNote;
  pane.querySelectorAll = selector => selector === '.task-filter-bar' ? [bar] : [];
  const tasks = node('BUTTON', 'Tasks'); tasks.getAttribute = name => name === 'aria-selected' ? String(taskSelected) : name === 'role' ? 'tab' : null;
  const content = node('DIV'); content.querySelectorAll = selector => selector === 'details' ? exposePane ? [pane] : []
    : selector === '[role="tab"][data-tab="tasks"]' ? [tasks] : [];
  const dialog = { open: true };
  const elements = { 'chunk-content': content, 'chunk-info': { hidden: false }, member: { value: 'explorer-1' },
    'group-view': { checked: false }, 'tool-dialog': dialog };
  const document = { getElementById: id => elements[id] ?? null, addEventListener: (type, callback) => callbacks.set(type, callback) };
  class FixtureResponse {
    async arrayBuffer() { throw new Error('Unexpected body consumption in pure fixture'); }
    async text() { throw new Error('Unexpected body consumption in pure fixture'); }
    async json() { throw new Error('Unexpected body consumption in pure fixture'); }
    clone() { throw new Error('Unexpected response clone in pure fixture'); }
  }
  class FixtureObserver {
    constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
    observe(root, options) { this.root = root; this.options = options; }
    disconnect() { this.closed = true; }
    takeRecords() { return []; }
  }
  const window = { fetch: () => { throw new Error('Unexpected network in pure fixture'); }, addEventListener: () => {} };
  const context = vm.createContext({ window, document, performance: { now: () => ++tick },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), innerWidth: 1000, innerHeight: 1000,
    Response: FixtureResponse, MutationObserver: FixtureObserver, URL, location: { href: 'http://fixture.invalid/' },
    localStorage: { setItem: () => {} }, queueMicrotask: callback => microtasks.push(callback),
    requestAnimationFrame: callback => frames.push(callback) });
  vm.runInContext(`(${installAdapter.toString()})()`, context);
  const screen = { memberId: 'explorer-1', state: { revision: 7 }, chunkId: '12345', duoEnabled: () => false,
    mapTaskCounts: { at(id) { calls.push(['mapTaskCounts.at', id]); return [
      { memberIds: ['explorer-1'], taskIdByMember: { 'explorer-1': 'task-own' } },
      { memberIds: ['explorer-2'], taskIdByMember: { 'explorer-2': 'task-peer' } },
    ]; } },
    closeDialog: () => { calls.push('closeDialog'); dialog.open = false; },
    showChunk(id) { calls.push(['showChunk', id, this.chunkTab]); this.chunkId = id; } };
  window.__r116Attach(screen);
  const nativeContrast = () => {
    // isTrusted is a fixture field here, not a browser-generated trust assertion.
    callbacks.get('click')({ isTrusted: true, target: doable, timeStamp: ++tick,
      composedPath: () => [doable, bar, pane, document, window] });
    selected = doable; // Simulate the existing synchronous chip handler, then its microtask.
    while (microtasks.length) microtasks.shift()();
  };
  const nativeTasks = ({ autoOpen = true } = {}) => {
    callbacks.get('click')({ isTrusted: true, target: tasks, timeStamp: ++tick, composedPath: () => [tasks, content, document, window] });
    taskSelected = true; exposePane = true; pane.open = autoOpen;
    if (autoOpen) callbacks.get('toggle')({ isTrusted: true, target: pane, timeStamp: ++tick });
  };
  const nativeSummary = () => {
    callbacks.get('click')({ isTrusted: true, target: summary, timeStamp: ++tick, composedPath: () => [summary, pane, content, document, window] });
    pane.open = true;
    callbacks.get('toggle')({ isTrusted: true, target: pane, timeStamp: ++tick });
  };
  const mutate = () => { for (const observer of observers) if (!observer.closed) observer.callback([{ type: 'childList', target: content }]); };
  const nextFrame = () => { assert.ok(frames.length); frames.shift()(++tick - 0.5); };
  return { window, screen, calls, nativeContrast, nativeTasks, nativeSummary, mutate, nextFrame, observers };
}

test('empty contrasting DOM view has empty search and normalized native filter key, and can arm All', () => {
  const { window, nativeContrast } = emptyContrastFixture();
  nativeContrast();
  const s = window.__r116Snap();
  assert.equal(s.searchValue, '');
  assert.equal(s.selectedFilterKey, 'doable');
  assert.equal(s.pageRows.length, 0);
  assert.equal(s.countText, null); // No count inferred from a chip when the shipping paged list is absent.
  const ack = window.__r116ArmAll({ token: 'empty-contrast', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false } });
  assert.equal(ack.status, 'pending');
  assert.equal(ack.before.searchValue, '');
  assert.equal(ack.contrastNative.after.selectedFilterKey, 'doable');
  assert.equal(ack.native, null);
});

test('OpenChunk calls existing UI methods with contents tab and returns passive snapshot, outside episodes only', () => {
  const { window, calls, nativeContrast } = emptyContrastFixture();
  const s = window.__r116OpenChunk(23456);
  assert.deepEqual(calls, ['closeDialog', ['showChunk', '23456', 'contents']]);
  assert.equal(s.chunkId, '23456');
  assert.equal(s.paneCount, 1);
  nativeContrast();
  window.__r116ArmAll({ token: 'setup-guard', scope: { memberId: 'explorer-1', chunkId: '23456', revision: 7, group: false } });
  assert.throws(() => window.__r116OpenChunk(34567), /R116_SETUP_DURING_ARMED_EPISODE/);
  assert.equal(calls.length, 2);
});

test('source-faithful empty initial projection accepts explicit null counts without inventing displayed counts', () => {
  assert.equal(compareProjection({ pageRows: [], counts: { shown: null, matching: null, total: null }, searchValue: '', showMoreHidden: null },
    { rows: [], counts: { shown: null, matching: null, total: null }, searchValue: '', showMoreHidden: null }).matches, true);
});

test('opening observes raw Tasks click, separate toggle, first actual initial projection and two raw frame opportunities', () => {
  const { window, nativeTasks, mutate, nextFrame, observers } = emptyContrastFixture({ opening: true });
  const ack = window.__r116ArmOpening({ token: 'initial-open', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false },
    expectedByFilter: { highest: { rows: [], counts: { shown: null, matching: null, total: null }, searchValue: '', showMoreHidden: null } } });
  assert.equal(ack.before.paneCount, 0);
  assert.equal(ack.kind, 'opening');
  assert.equal(window.__r116Transition('initial-open').status, 'pending');
  assert.equal(observers[0].options.subtree, true);
  mutate();
  assert.equal(window.__r116Transition('initial-open').dom, null); // Mutation without own native trigger never completes.
  nativeTasks();
  assert.equal(window.__r116Transition('initial-open').nativeTasks.targetIsExactTasksTab, true);
  assert.equal(window.__r116Transition('initial-open').nativeExpansion, null);
  assert.equal(window.__r116Transition('initial-open').expansionToggles.length, 1);
  mutate();
  const seen = window.__r116Transition('initial-open');
  assert.equal(seen.dom.initialFilterKey, 'highest');
  assert.equal(seen.dom.observedChunkContentMutation, true);
  assert.equal(seen.frames.length, 0);
  nextFrame();
  assert.equal(window.__r116Transition('initial-open').status, 'pending');
  nextFrame();
  const done = window.__r116Transition('initial-open');
  assert.equal(done.status, 'correct');
  assert.equal(done.frames.length, 2);
  assert.ok(done.frames.every(frame => frame.at !== frame.capturedAt));
  assert.equal(done.native.capturedAt, done.nativeTasks.capturedAt);
});

test('opening blocks missing selected-filter reference and scope changes', () => {
  const missing = emptyContrastFixture({ opening: true });
  missing.window.__r116ArmOpening({ token: 'no-filter-oracle', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false }, expectedByFilter: { all: { rows: [] } } });
  missing.nativeTasks(); missing.mutate();
  assert.equal(missing.window.__r116Transition('no-filter-oracle').blockedReason, 'opening-selected-filter-oracle-missing');
  const stale = emptyContrastFixture({ opening: true });
  stale.window.__r116ArmOpening({ token: 'stale-opening', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false }, expectedByFilter: {} });
  stale.screen.state.revision++;
  assert.equal(stale.window.__r116Transition('stale-opening').status, 'blocked');
});

test('manual summary expansion is a separate raw native trigger and second-frame scope changes block', () => {
  const f = emptyContrastFixture({ opening: true });
  f.window.__r116ArmOpening({ token: 'manual-expansion', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false },
    expectedByFilter: { highest: { rows: [], counts: { shown: null, matching: null, total: null }, searchValue: '', showMoreHidden: null } } });
  f.nativeTasks({ autoOpen: false }); f.mutate();
  assert.equal(f.window.__r116Transition('manual-expansion').dom, null);
  f.nativeSummary(); f.mutate();
  const observed = f.window.__r116Transition('manual-expansion');
  assert.equal(observed.nativeExpansion.label, 'Possible Tasks');
  assert.equal(observed.nativeExpansion.targetIsExactPossibleTasksSummary, true);
  assert.ok(observed.nativeExpansion.capturedAt > observed.nativeTasks.capturedAt);
  assert.equal(observed.dom.trigger, 'native-summary-expansion');
  f.nextFrame(); f.screen.state.revision++; f.nextFrame();
  assert.equal(f.window.__r116Transition('manual-expansion').status, 'blocked');
  assert.equal(f.window.__r116Transition('manual-expansion').frames.length, 1);
});

test('reference map helper calls existing at once, projects only selected-owner IDs and records refresh caveat', () => {
  const { window, calls, nativeContrast } = emptyContrastFixture();
  const record = window.__r116MapTaskIds(12345);
  assert.deepEqual(calls, [['mapTaskCounts.at', '12345']]);
  assert.deepEqual(Array.from(record.taskIds), ['task-own']);
  assert.equal(record.methodMayRefresh, true);
  assert.equal(window.__r116Read().mapTaskReads.length, 1);
  nativeContrast();
  window.__r116ArmAll({ token: 'map-helper-guard', scope: { memberId: 'explorer-1', chunkId: '12345', revision: 7, group: false } });
  assert.throws(() => window.__r116MapTaskIds(12345), /R116_MAP_TASK_READ_DURING_ARMED_EPISODE/);
  assert.equal(calls.length, 1);
});
