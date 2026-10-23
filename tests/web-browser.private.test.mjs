import { appendTaskClaim, createTaskClaimClock } from '../app/web/task-claims.mjs';
import { observeScreenBars } from '../app/web/phone-layout.mjs';
import { readScreenGraph, runScreenGraph } from './browser-screen-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { buildWorld } from '../app/data/world.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress.mjs';
import { resolveTaskAlternatives } from '../app/core/task-alternatives.mjs';
import { originalSettings, settingDefinitions } from '../app/data/settings.mjs';
import { createInfoPanels, createNoteEditor, reviewedNoteRevision } from '../app/web/info-panels.mjs';
import { createChunkQuestList } from '../app/web/chunk-quest-filters.mjs';
import { createMapTools, applyTheme } from '../app/web/map-tools.mjs';
import { createDeathChunks } from '../app/web/death-chunks.mjs';
import { createDeathSettings } from '../app/web/death-settings.mjs';
import { createMiningSettings } from '../app/web/mining-settings.mjs';
import { createWoodcuttingSettings } from '../app/web/woodcutting-settings.mjs';
import { createBankingSettings } from '../app/web/banking-settings.mjs';
import { mergeCommandState, projectChunkState, projectTaskState } from '../app/web/command-state.mjs';
import { createOriginalSync } from '../app/web/dataset-panels.mjs';
import { projectDisplayWorld, hydrateDisplayWorld } from '../app/display-world.mjs';
import { ChunkMap } from '../app/web/map.mjs';
import { createMapTaskCounts } from '../app/web/map-task-counts.mjs';
import { createChunkPlanning } from '../app/web/chunk-planning.mjs';
import { createRulesPanel } from '../app/web/rules-panel.mjs';
import { createTaskHover } from '../app/web/task-hover.mjs';
import { createTaskMethods } from '../app/web/task-methods.mjs';
import { renderTaskEquipment } from '../app/web/task-equipment.mjs';
import { taskItemIcon, taskIcon, taskCategoryIcon } from '../app/tasks/task-icons.mjs';
import { createSandbox } from '../app/web/sandbox.mjs';
import { openSandboxRules } from '../app/web/sandbox-rules.mjs';
import { openTeleportsDialog } from '../app/web/teleports.mjs';
import { createTaskIconPainter } from '../app/web/task-icon-painter.mjs';
import { createDuoResultCache, selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';
import { createDuoBacklogView } from '../app/web/duo-backlog-view.mjs';
import { createTaskFilters, appendTaskPin } from '../app/web/task-filters.mjs';
import { appendTaskWhy, catalogued, createRuleDescriber } from '../app/web/task-why.mjs';
import { isTaskPinned, createTaskPinChecker } from '../app/web/task-filters-model.mjs';
import { createActivityFilterControls, selectActivityRows } from '../app/web/activity-filters.mjs';
import { createCompletedView } from '../app/web/completed-view.mjs';
import { createDuoCoordination } from '../app/web/duo-coordination.mjs';
import { createFeedback } from '../app/web/feedback.mjs';
import { historyChangeTypes, historyChangeType } from '../app/web/history-text.mjs';
import { backupSaveLabel } from '../app/web/backup-status.mjs';
import { artStatusText } from '../app/web/art-status.mjs';
import { datasetStatusText } from '../app/web/dataset-status.mjs';
import { readBackupRequest, BACKUP_UPLOAD_TYPE } from '../app/backup-transfer.mjs';
import { Readable } from 'node:stream';

// Execute complete shipped UI modules with browser collaborators and controlled
// responses. Only module imports and automatic startup are replaced; no function
// bodies are extracted. These fixtures never contact a server or write gameplay.
const screenGraph = await readScreenGraph();
const settingsSource = (await readFile(new URL('../app/web/settings-panel.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const task = { id: 'custom:note', label: 'Test task', category: 'Custom', status: 'available' };
const taskResult = revision => ({ stateRevision: revision, memberId: 'player1', tasks: [], presentation: { tasks: [], alternatives: {} }, metrics: { availableCount: 0, elapsedMs: 1 }, access: { areas: [] } });
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
// Registration and recovery add promise hops before a command reaches the wire.
// Drain the current turn without guessing their count or resolving deferred IO.
const flush = () => new Promise(resolve => setImmediate(resolve));

function viewerHarness(options) {
  const h = harness(options);
  h.run('applySession({readOnly:true, capabilities:{canWrite:false},admin:false}); renderState()');
  return h;
}

function duoFixture(h) {
  const make = (id, label) => ({ id: `rs3:task:${id}`, label, category: 'Mining', status: 'available', obligation: true });
  const own = make('own', 'Player 1 goal'), shared = make('shared', 'Shared goal'), partner = make('partner', 'Player 2 goal'), suppressed = make('suppressed', 'Unpresented goal'), resource = { ...make('resource', 'Partner resource'), obligation: false };
  const resultFor = (memberId, tasks, revision = 7) => ({ ...taskResult(revision), memberId, format: 'play-v1', tasks,
    presentation: { tasks: tasks.filter(row => row !== suppressed).map(({ id }) => ({ id })) } });
  const player1 = resultFor('player1', [own, shared, suppressed, resource]), player2 = resultFor('player2', [shared, partner, resource]);
  h.context.player1Result = player1; h.context.player2Result = player2;
  h.run('state.tasks = []; result = player1Result; document.getElementById("hide-completed").checked = true; renderTasks()');
  return { own, shared, partner, player1, player2, resultFor };
}
const activeLabels = h => {
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  return walk(h.nodes.get('active-tasks')).filter(node => node.className === 'task-label-button').map(node => node.textContent);
};

const dialogNodes = h => {
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  return walk(h.nodes.get('dialog-content'));
};
const completedIds = h => dialogNodes(h).filter(node => node.className === 'completed-row').map(node => node.dataset.taskId).sort();
async function reviewPlayer(h, name) {
  const choice = dialogNodes(h).find(node => node.className === 'completed-player' && node.textContent === name);
  assert.ok(choice, `Missing Completed review player ${name}`); await choice.emit('click'); await flush(); await flush();
}
async function enableDuo(h) { h.run("document.getElementById('group-view').checked = true; renderTasks()"); await h.run('duoLoading'); await flush(); }

async function sseWriteFixture(group = true) {
  const h = harness(), f = duoFixture(h), acknowledgement = deferred(), selected = deferred(), peer = deferred();
  const selectedResult = { ...f.resultFor('player1', [f.own], 8), ...(group ? { projection: 'duo-sidebar-v1' } : {}) };
  const peerResult = f.resultFor('player2', [f.partner], 8), next = h.snapshot(); next.revision = 8; next.members[0].unlocked = ['12341'];
  h.route(path => path === '/api/command' ? acknowledgement.promise : path.includes('player2') ? peer.promise : selected.promise);
  h.run(`document.getElementById('group-view').checked = ${group}; connectEvents()`);
  const saving = h.run("command({type:'set-chunk',memberId:'player1',chunkId:'12341',status:'unlocked'})"); await flush();
  return { h, f, acknowledgement, selected, peer, selectedResult, peerResult, next, saving,
    notify: revision => h.eventSources[0].emit('revision', { data: JSON.stringify({ revision }) }),
    load: () => h.run('clearTimeout(syncTimer); syncTimer = null; loadTasks()') };
}

function harness({ realPlanning = false, localStorage } = {}) {
  class Node {
    constructor(tag = 'div', text = '') { Object.assign(this, { tagName: tag.toUpperCase(), textContent: text, children: [], events: {}, attributes: {}, dataset: {}, value: '', style: { setProperty() {} } }); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') { node.remove?.(); node.parent = this; } this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) if (typeof node === 'object') node.parent = undefined; this.children = []; this.append(...nodes); }
    prepend(...nodes) { for (const node of nodes) { node.remove?.(); node.parent = this; } this.children.unshift(...nodes); }
    get firstChild() { return this.children[0] ?? null; }
    insertBefore(node, before) { node.remove?.(); node.parent = this; const index = this.children.indexOf(before); if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
    get parentElement() { return this.parent; }
    replaceWith(node) { this.after(node); this.remove(); }
    querySelectorAll(selector) { const found = []; const visit = node => { for (const child of node.children.filter(item => typeof item === 'object')) { if (selector === 'button' && child.tagName === 'BUTTON') found.push(child); visit(child); } }; visit(this); return found; }
    after(...nodes) { if (this.parent) { const parent = this.parent, index = parent.children.indexOf(this); for (const node of nodes) { node.remove?.(); node.parent = parent; } parent.children.splice(index + 1, 0, ...nodes); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    querySelector(selector) { const match = node => selector.startsWith('.') ? (node.className ?? '').split(' ').includes(selector.slice(1)) : selector.startsWith('[data-role=') ? node.dataset.role === selector.match(/"([^"]+)"/)[1] : node.tagName.toLowerCase() === selector; const walk = node => { for (const child of node.children.filter(item => typeof item === 'object')) { if (match(child)) return child; const found = walk(child); if (found) return found; } }; return walk(this); }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    emit(key, event = {}) { return Promise.all((this.events[key] ?? []).map(action => action(event))); }
    contains(node) { return this === node || this.children.some(child => typeof child === 'object' && child.contains?.(node)); }
    get isConnected() { return !!this.connected || !!this.parent?.isConnected; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const nodes = new Map(), timers = new Map(), deathTimers = new Map(), calls = [], intentCalls = [], deathCalls = [], renders = [], eventSources = [], planningPrimes = [], planningRenders = [];
  const document = { getElementById: id => { if (!nodes.has(id)) { const node = new Node(); node.connected = true; nodes.set(id, node); } return nodes.get(id); }, createElement: tag => new Node(tag), createTextNode: value => new Node('text', value), querySelector: selector => document.getElementById(selector), documentElement: new Node(), activeElement: undefined };
  document.head = document.getElementById('test-head'); document.body = document.getElementById('test-body');
  document.getElementById('pool-ranking-panel').hidden = true;
  document.getElementById('test-task-header').append(document.getElementById('task-count'));
  document.body.append(document.getElementById('test-task-header'));
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]); initialState.revision = 7; initialState.tasks = [task];
  initialState.members[0].notes = { '12341': 'Original chunk note' }; initialState.members[0].taskStatus = { [task.id]: { note: 'Original task note' } };
  initialState.members[1].notes = {};
  initialState.members[0].preferences = {};
  const definitions = { chunks: { '12341': {}, '12342': {} }, walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] }, world = buildWorld(definitions);
  const map = { members: initialState.members, setModel(value) { this.members = value.state.members; }, centerOnChunk() {}, centerOnUnlocked() {} };
  let route = async (path, body) => {
    if (path !== '/api/command') throw new Error(`Unexpected request: ${path}`);
    const state = structuredClone(run('state')); state.revision++;
    const payload = body.command, owner = state.members.find(member => member.id === payload.memberId);
    if (payload.type === 'set-note') owner.notes[payload.chunkId] = payload.note;
    if (payload.type === 'set-journal') owner.journal = payload.note;
    if (payload.type === 'set-task-status') owner.taskStatus[payload.taskId] = { ...owner.taskStatus[payload.taskId], ...payload };
    if (payload.type === 'set-chunk') {
      for (const field of ['unlocked', 'selected', 'blacklisted']) owner[field] = owner[field].filter(id => id !== payload.chunkId);
      if (payload.status !== 'locked') owner[payload.status].push(payload.chunkId);
    }
    return { state, pools: {} };
  };
  const context = createContext({ createMapTaskCounts, historyChangeTypes, historyChangeType, backupSaveLabel, appendTaskClaim, createTaskClaimClock, document, localStorage, initialState, initialDefinitions: definitions, initialWorld: world, initialMap: map, renders,
    observeScreenBars: doc => observeScreenBars(doc, context.ResizeObserver),
    artStatusText, datasetStatusText, loadArtStatus: async () => null, installPictureFallbacks() {}, observeArtStatus: listener => listener(null),
    createActivityFilterControls: (collaborators, options) => createActivityFilterControls({ ...collaborators, storage: localStorage }, options), selectActivityRows,
    createChunkQuestList: (collaborators, entries) => { collaborators.storage = localStorage; return createChunkQuestList(collaborators, entries); },
    createMapDisplay: () => ({ sizes: { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1 }, open() {}, close() {}, refresh() {}, isOpen: () => false }), createHelperView: () => ({}), createBackupStatus: () => ({ start() {}, refresh: async () => {}, line: () => null }), createSandbox, openSandboxRules, createTaskHover, createTaskMethods, renderTaskEquipment, resolveTaskAlternatives, createDuoResultCache, selectDuoTasks, createDuoTaskView, createTaskFilters, appendTaskPin, appendTaskWhy, catalogued, createRuleDescriber, isTaskPinned, createTaskPinChecker, createCompletedView, createDuoCoordination, openTeleportsDialog,
    selectDuoTaskLists, createDuoBacklogView, buildWorld, createRuleRegistry, originalSettings, settingDefinitions, createRulesPanel,
    taskItemIcon, taskIcon, taskCategoryIcon, createTaskIconPainter, skillIcon: () => null, itemIcon: () => null, loadIcons: async () => false, interiorCandidates: () => [], interiorPanel: () => ({}), describeHistoryEvent: event => event.type, createFeedback: () => ({ open() {}, setSession() {}, start() {}, stop() {} }), createUpdates: () => ({ seen() {}, openList() {} }), createRuneMetricsControls: () => ({}), createGamePlugin: () => ({ refresh: async () => {}, render() {}, open() {}, controls: () => ({}) }), createStickerPicker: () => ({ open() {}, close() {}, isOpen: () => false, element: { contains: () => false } }), createInfoPanels, createNoteEditor, reviewedNoteRevision, createMapTools, applyTheme, createTaskFactsIndex, goalProgress, createDeathSettings, createMiningSettings, createWoodcuttingSettings, createBankingSettings, mergeCommandState, projectChunkState, projectTaskState, createOriginalSync,
    EventSource: class extends Node { constructor(url) { super(); this.url = url; eventSources.push(this); } },
    createDeathChunks: ctx => createDeathChunks({ ...ctx, setTimeout: action => { const id = Symbol(); deathTimers.set(id, action); return id; }, clearTimeout: id => deathTimers.delete(id) }),
    createChunkPlanning: ctx => realPlanning ? createChunkPlanning(ctx) : ({ render: id => { planningRenders.push(id); const node = new Node(); node.append(new Node('details'), new Node('details')); return node; }, prime: value => planningPrimes.push(value) }), AbortController, Uint8Array, crypto: { randomUUID: () => 'test-id', getRandomValues: values => values.fill(1) },
    addEventListener() {},
    setTimeout: (action, delay) => { const id = Symbol(); timers.set(id, { action, delay }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: action => { Promise.resolve().then(action); return 1; }, performance: { now: () => 0, mark() {} },
    fetch: async (requestPath, options) => { const url = new URL(requestPath, 'http://fixture.invalid'); url.searchParams.delete('view'); for (const parameter of ['lane', 'peerFor', 'revision', 'projection']) url.searchParams.delete(parameter); const path = url.pathname + url.search; let body; if (options?.headers?.['Content-Type'] === BACKUP_UPLOAD_TYPE) { const stream = Readable.fromWeb(options.body.stream()); stream.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])); body = (await readBackupRequest(stream)).body; } else body = options?.body ? JSON.parse(options.body) : undefined; if (path === '/api/prediction-intent') { intentCalls.push({ body, options }); return { ok: true, json: async () => ({ ...body, stateRevision: body.revision, prepared: true }) }; } if (path.startsWith('/api/death-estimates?')) { deathCalls.push({ path, options }); const ownerId = new URL(path, 'http://fixture.invalid').searchParams.get('memberId'); return { ok: true, json: async () => ({ memberId: ownerId, stateRevision: run('state.revision'), candidateIds: [], estimates: [] }) }; } calls.push({ path, requestPath, body, options }); const value = await route(path, body); return value?.ok === false ? { ...value, json: async () => value.value } : { ok: true, json: async () => value }; },
  });
  const run = code => runInContext(code, context);
  run(settingsSource); runScreenGraph(context, screenGraph);
  run("sessionAdmin = true; registry = createRuleRegistry(); state = initialState; definitions = initialDefinitions; world = initialWorld; map = initialMap; memberId = 'player1'; pool = { eligible: [], excluded: [] }; const shippedRenderTasks = renderTasks; renderTasks = () => { renders.push({ state: state.revision, tasks: result?.stateRevision }); shippedRenderTasks(); }; renderState();");
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  const all = () => [...nodes.values()].flatMap(walk);
  const find = (tag, text) => all().find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
  const click = text => { const node = find('button', text); assert.ok(node, text); return node.emit('click'); };
  const adopt = next => { context.next = next; run('adopt(next, {});'); };
  const snapshot = () => structuredClone(run('state'));
  return { run, context, nodes, calls, intentCalls, deathCalls, deathTimers, renders, timers, eventSources, planningPrimes, planningRenders, map, find, all, click, adopt, snapshot, route: action => { route = action; } };
}

const planningResult = (revision = 7, chunkId = '12341', memberId = 'player1') => ({ format: 'chunk-planning-v1', stateRevision: revision, memberId, chunkId,
  rows: [{ task: { id: 'rs3:task:planning', label: 'Planning goal', category: 'Extra', status: 'available' }, evidence: [{ location: chunkId, reason: 'Declared location requirement' }] }],
  clueLocations: [], access: { bases: [chunkId], areas: [], sections: [] } });

test('Group foreground defers chunk planning and explicit death requests until both players settle', async () => {
  const h = harness(), peer = deferred();
  h.route(path => path === '/api/tasks?memberId=player2' ? peer.promise
    : path === '/api/tasks?memberId=player1' ? taskResult(7)
      : path.startsWith('/api/chunk-planning?') ? planningResult() : Promise.reject(new Error(`Unexpected ${path}`)));
  h.run("document.getElementById('group-view').checked = true; chunkTab = 'contents'; showChunk('12341')");
  const planning = h.run("ensurePlanningResult('12341')"), death = h.run("deathChunks.estimateChunk('12341')");
  await flush(); await flush();
  assert.equal(h.run('result.stateRevision'), 7, 'selected rows publish while the peer is pending');
  assert.equal(h.run('foregroundSettled()'), false);
  assert.ok(!h.calls.some(call => call.path.startsWith('/api/chunk-planning')));
  assert.equal(h.deathCalls.length, 0); assert.equal(h.deathTimers.size, 0);
  peer.resolve({ ...taskResult(7), memberId: 'player2' });
  await Promise.all([planning, death]); await flush();
  assert.equal(h.run('foregroundSettled()'), true);
  assert.equal(h.calls.filter(call => call.path.startsWith('/api/chunk-planning')).length, 1);
  assert.equal(h.deathCalls.length, 1); assert.equal(h.deathTimers.size, 1, 'duo paint releases the background batch');
  assert.ok(!h.calls.some(call => call.path === '/api/state'));
});

function sandboxHarness() {
  const h = harness();
  const baseline = { ...taskResult(7), format: 'play-v1', tasks: [task], presentation: { tasks: [{ id: task.id }] } };
  h.context.baseline = baseline;
  h.run("result = baseline; shownResult = baseline; statePools = { player1: { eligible: [{ id: '12341' }, { id: '12342' }], excluded: [], accessible: [] } }; pool = statePools.player1; sandbox.mount(); renderState();");
  h.route(async (path, body) => {
    assert.equal(path, '/api/sandbox/evaluate');
    const added = body.changes.unlockChunks.map(id => ({ id: `custom:chunk:${id}`, label: `New goal ${id}`, category: 'Custom', status: 'available' }));
    const tasks = [task, ...added];
    return { format: 'sandbox-v1', memberId: body.memberId, stateRevision: body.baseRevision, changes: body.changes,
      result: { ...taskResult(body.baseRevision), tasks, presentation: { tasks: tasks.map(row => ({ id: row.id })) } },
      possibleCount: tasks.length, rollPool: { eligible: [], excluded: [], accessible: [] },
      delta: { tasksAdded: added, tasksRemoved: [] } };
  });
  return h;
}

test('sandbox task rules use a personal hypothetical editor with no saved-panel status', async () => {
  const h = sandboxHarness(); await h.run('sandbox.enter()'); h.run('rulesDialog()');
  assert.equal(h.nodes.get('dialog-title').textContent, 'Sandbox task rules');
  await h.click('Try this rule');
  assert.equal(h.calls.at(-1).body.changes.taskRules['Multi Step Processing'], false);
  assert.ok(h.all().some(node => node.textContent.includes('Nothing was saved.')));
  assert.ok(!h.all().some(node => node.textContent === 'Saved. Undo is available in History.'));
});

function hydratedMapHarness() {
  const h = harness();
  h.context.hydratedWorld = hydrateDisplayWorld(projectDisplayWorld(h.context.initialWorld));
  h.run('world = hydratedWorld');
  Object.assign(h.map, { cells: new Map(), deathMarkers: new Map(), dirty: {}, initialized: true, schedule() {}, setSectionHighlight() {} });
  h.map.setModel = function (model) { return ChunkMap.prototype.setModel.call(this, model); };
  const envelope = revision => {
    const state = h.snapshot(); state.revision = revision;
    const pools = Object.fromEntries(state.members.map(owner => [owner.id, { eligible: [], excluded: [], accessible: [], partnerConnections: { byChunk: {} } }]));
    return { format: 'play-v1', schemaVersion: 1, state, pools };
  };
  return { ...h, envelope };
}

function questSearchResult() {
  const quests = [
    ...Array.from({ length: 130 }, (_, index) => ({ id: `quest:done-${index}`, label: `Finished quest ${index}`, category: 'Quest', status: 'available', blockers: [], questStatus: 'done', canDoNow: false })),
    { id: 'quest:new', label: 'New ready quest', category: 'Quest', status: 'available', blockers: [], questStatus: 'not-started', canDoNow: true, level: 5 },
    { id: 'quest:started', label: 'Started ready quest', category: 'Quest', status: 'available', blockers: [], questStatus: 'in-progress', canDoNow: true, level: 1 },
    { id: 'quest:blocked', label: 'Started blocked quest', category: 'Quest', status: 'blocked', blockers: ['locked chunk'], questStatus: 'in-progress', canDoNow: false, level: 10 },
  ];
  return { ...taskResult(7), tasks: [...quests.map(({ questStatus, canDoNow, ...row }) => row), { id: 'mining:test', label: 'Mining task', category: 'Mining', status: 'available', blockers: [] }], activityInfo: { quests: [{ name: 'Quests', tasks: quests }] } };
}
const searchRows = h => dialogNodes(h).filter(node => node.className === 'search-result');
const searchLabels = h => searchRows(h).map(row => row.querySelector('.search-result-title').querySelector('span').textContent);
const questSearchChip = (h, label) => {
  const group = dialogNodes(h).find(node => node.attributes['aria-label'] === 'Quest progress');
  assert.ok(group); const chip = group.children.find(node => node.textContent === label); assert.ok(chip); return chip;
};
async function openQuestSearch(h, full = questSearchResult()) {
  h.route(() => full); h.context.questSearchSlim = { ...taskResult(7), format: 'play-v1' };
  h.run('result=questSearchSlim;chunkSearch=[];searchDialog()');
  const mode = dialogNodes(h).find(node => node.tagName === 'SELECT' && node.children.some(option => option.value === 'Quests'));
  assert.ok(mode); mode.value = 'Quests'; await mode.emit('change'); return mode;
}

test('settings and task-rule save continuations leave superseded controls and content alone', async () => {
  for (const panel of ['settings', 'rules']) {
    const h = harness(), response = deferred(); h.route(() => response.promise); h.run(panel === 'settings' ? 'settingsPanels.settings()' : 'rulesDialog()');
    const control = h.all().find(node => node.attributes['aria-label'] === (panel === 'settings' ? 'Theme' : 'Show Skill Tasks')); assert.ok(control);
    const saving = control.emit('change'); await flush(); h.run('customTaskDialog()'); const content = h.nodes.get('dialog-content').children[0];
    const state = h.snapshot(); state.revision = 8; response.resolve({ state, pools: {} }); await saving;
    assert.equal(h.nodes.get('dialog-content').children[0], content); assert.equal(control.disabled, true);
  }
});

const filterNodes = h => { const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)]; return walk(h.run('activeTaskFilters().element')); };
const filterControl = (h, id) => filterNodes(h).find(node => node.id === id);
const filterSkill = (h, category) => filterNodes(h).find(node => node.dataset?.taskSkill === category);
async function chooseTaskControl(h, id, value) {
  const node = filterControl(h, id); assert.ok(node, `Missing ${id}`);
  if (typeof value === 'boolean') node.checked = value; else node.value = value;
  await node.emit('change'); await flush();
}

