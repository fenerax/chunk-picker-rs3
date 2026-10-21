import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletedView } from '../app/web/completed-view.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';

// Shipped panel, isolated DOM and in-memory collaborators: no server or save files.
const task = (id, label, category = 'Custom') => ({ id, label, category, status: 'available', obligation: true });
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness(tasks = [], { history = [], results, details, realDialogs = false, scheduled = false, storage = null, now = () => new Date(), viewer = false, clipboard, loadHistory = true } = {}) {
  class Node {
    constructor(tag, text = '') { Object.assign(this, { tagName: tag.toUpperCase(), _text: text, children: [], events: {}, attributes: {}, dataset: {}, className: '', value: '', style: {} }); }
    get textContent() { return this._text + this.children.map(child => child.textContent ?? String(child)).join(''); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') { node.remove?.(); node.parent = this; } this.children.push(node); } }
    prepend(...nodes) { for (const node of nodes.reverse()) { node.remove?.(); node.parent = this; this.children.unshift(node); } }
    replaceChildren(...nodes) { for (const node of this.children) if (typeof node === 'object') node.parent = undefined; this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = undefined; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(key, action) { (this.events[key] ??= []).push(action); }
    emit(key, event = {}) { return Promise.all((this.events[key] ?? []).map(action => action({ preventDefault() {}, stopPropagation() {}, ...event }))); }
    contains(node) { return this === node || this.children.some(child => typeof child === 'object' && child.contains?.(node)); }
    querySelector(selector) { const match = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[data-role=') ? node.dataset.role === selector.match(/"([^"]+)"/)[1] : node.tagName.toLowerCase() === selector; const walk = node => { for (const child of node.children.filter(item => typeof item === 'object')) { if (match(child)) return child; const found = walk(child); if (found) return found; } }; return walk(this); }
    focus() { document.activeElement = this; }
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
    get isConnected() { return this === root || !!this.parent?.isConnected; }
  }
  const root = new Node('div'), document = { createElement: tag => new Node(tag), createTextNode: text => new Node('text', text), getElementById: id => realDialogs && id === 'dialog-content' ? root : undefined, activeElement: undefined };
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.revision = 7; state.tasks = tasks; state.history = history;
  for (const owner of state.members) { owner.taskStatus = {}; owner.completedTasks = []; }
  const calls = [], loads = [], detailLoads = [], opened = [], errors = [], backlog = [], icons = [], hover = [], undo = [], paints = [];
  let selectedMember = 'actor1', generation = 0, active = true, route;
  const el = (tag, text, cls) => { const node = new Node(tag, text); if (cls) node.className = cls; return node; };
  const button = (text, action, cls) => { const node = el('button', text, cls); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(action)); return node; };
  const input = (type, value = '') => Object.assign(el('input'), { type, value });
  const select = (values, value) => { const node = el('select'); for (const item of values) node.append(Object.assign(el('option', typeof item === 'string' ? item : item.label), { value: typeof item === 'string' ? item : item.value })); node.value = value; return node; };
  const panel = createCompletedView({ document, storage, now, canWrite: () => !viewer, getClipboard: () => clipboard, state: () => state, memberId: () => selectedMember, registry: () => createRuleRegistry(),
    loadResult: async ownerId => { loads.push(ownerId); return route ? route(ownerId) : results?.[ownerId] ?? { memberId: ownerId, stateRevision: state.revision, tasks, presentation: { tasks, alternatives: {} } }; },
    loadDetails: ownerId => { detailLoads.push(ownerId); return details(ownerId); },
    loadHistory: loadHistory ? async () => ({ history }) : undefined, openDialog: (title, ...content) => { opened.push(title); root.replaceChildren(...content); active = true; return ++generation; }, dialogCurrent: value => active && value === generation,
    showTask: (...args) => { opened.push(args); if (realDialogs) { root.replaceChildren(el('p', 'Task popup')); if (args[2]?.onReturn) root.prepend(button('Back to Completed Tasks', args[2].onReturn)); generation++; } }, command: async (payload, options) => { calls.push({ payload, options }); if (payload.type === 'set-task-status') { const owner = state.members.find(item => item.id === payload.memberId); undo.push({ memberId: owner.id, taskId: payload.taskId, status: structuredClone(owner.taskStatus[payload.taskId] ?? {}) }); owner.taskStatus[payload.taskId] = { ...owner.taskStatus[payload.taskId], ...payload }; } else if (payload.type === 'undo') { const previous = undo.pop(); if (previous) state.members.find(item => item.id === previous.memberId).taskStatus[previous.taskId] = previous.status; } state.revision++; }, showError: error => errors.push(error),
    taskIconPainter: { append: (...args) => icons.push(args) }, categoryIconPainter: { append() {} }, hoverTasks: () => ({ bind: (...args) => hover.push(args), attach: (...args) => hover.push(args) }),
    backlogForm: (...args) => backlog.push(args), el, button, input, select, field: (text, control) => { const node = el('label', text); node.append(control); return node; }, plain: value => String(value ?? '').replace(/<[^>]*>/g, '').trim(), isSandbox: () => false, schedulePaint: scheduled ? action => paints.push(action) : undefined,
  });
  const walk = node => [node, ...node.children.filter(child => typeof child === 'object').flatMap(walk)];
  const all = () => walk(root), rows = () => all().filter(node => node.className.split(' ').includes('completed-row'));
  const find = (tag, text) => all().find(node => node.tagName === tag.toUpperCase() && node.textContent === text);
  const control = label => all().find(node => node.attributes['aria-label'] === label);
  const click = async text => { const node = find('button', text) ?? control(text); assert.ok(node, `Missing button: ${text}`); await node.emit('click'); await flush(); };
  return { panel, state, root, all, rows, find, control, click, calls, loads, detailLoads, opened, errors, backlog, icons, hover, paints,
    member: value => { selectedMember = value; }, close: () => { active = false; generation++; }, route: value => { route = value; } };
}

test('completed panel filters tasks and switches player without changing the active map', async () => {
  const own = task('custom:oak', 'Chop oak logs', 'Woodcutting'), other = task('custom:rat', 'Defeat giant rat', 'Combat');
  const h = harness([own, other]); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true }; h.state.members[1].taskStatus[other.id] = { challengeCompleted: true };
  await h.panel.open(); await flush();
  assert.deepEqual(h.rows().map(row => row.dataset.taskId).sort(), [own.id, other.id].sort());
  assert.equal(h.find('button', 'Player').attributes['aria-pressed'], 'true');
  const filter = h.control('Filter completed tasks'); assert.ok(filter); filter.value = 'oak'; await filter.emit('input'); await flush();
  assert.deepEqual(h.rows().map(row => row.dataset.taskId), [own.id]);
  filter.value = ''; await filter.emit('input'); await h.click('Reed');
  assert.equal(h.find('button', 'Reed').attributes['aria-pressed'], 'true');
  assert.ok(h.loads.includes('reed')); assert.equal(h.state.members[0].id, 'actor1');
  await h.click('Both'); assert.equal(h.find('button', 'Both').attributes['aria-pressed'], 'true');
  await h.click('Done by Reed'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [other.id]);
  await h.click('All completed'); assert.equal(h.rows().length, 2);
  h.member('reed'); await h.panel.open(); await flush(); assert.equal(h.find('button', 'Reed').attributes['aria-pressed'], 'true');
});

test('untick asks inline confirmation and sends the completion owner and source task ID', async () => {
  const own = task('custom:oak', 'Chop oak logs'); const h = harness([own]); h.state.members[1].taskStatus[own.id] = { challengeCompleted: true };
  await h.panel.open(); await flush(); await h.click('Untick Chop oak logs for Reed');
  assert.equal(h.calls.length, 0); assert.ok(h.find('button', 'Cancel'));
  await h.click('Cancel'); assert.equal(h.calls.length, 0);
  await h.click('Untick Chop oak logs for Reed'); await h.click('Untick for Reed');
  assert.deepEqual(h.calls[0].payload, { type: 'set-task-status', memberId: 'reed', taskId: own.id, challengeCompleted: false });
  assert.ok(h.calls[0].options === 7 || h.calls[0].options?.expectedRevision === 7, 'Confirmation retains its reviewed revision');
  assert.equal(h.rows().length, 0); assert.equal(h.errors.length, 0);
  await h.click('Undo last change'); assert.deepEqual(h.calls.at(-1).payload, { type: 'undo' }); assert.equal(h.rows().length, 1);
});

test('unticking a grouped display row changes its saved source completion', async () => {
  const source = task('custom:source', 'Saved source method', 'Crafting'), display = { ...task('custom:display', 'Current family goal', 'Crafting'), completionIds: ['custom:source', 'custom:display'] };
  const results = { actor1: { stateRevision: 7, memberId: 'actor1', tasks: [display], presentation: { tasks: [display] } } };
  const h = harness([source], { results }); h.state.members[0].taskStatus[source.id] = { challengeCompleted: true };
  await h.panel.open(); await flush(); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [display.id]);
  await h.click('Untick Current family goal for Player'); await h.click('Untick for Player');
  assert.equal(h.calls[0].payload.taskId, source.id); assert.equal(h.calls[0].payload.memberId, 'actor1');
});

test('backlog delegates to the normal inline form with the selected player', async () => {
  const own = task('custom:oak', 'Chop oak logs'); const h = harness([own]); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true };
  await h.panel.open(); await flush(); await h.click('Backlog Chop oak logs for Player…');
  assert.equal(h.backlog.length, 1); assert.equal(h.backlog[0][1].id, own.id); assert.equal(h.backlog[0][3], 'actor1'); assert.equal(typeof h.backlog[0][2], 'function');
  await h.click('Reed'); await h.click('Backlog Chop oak logs for Reed…'); assert.equal(h.backlog.at(-1)[3], 'reed');
});

test('completion metadata names the owner and recorded date, while recent layout sorts newest first', async () => {
  const older = task('custom:old', 'Older completion', 'Woodcutting'), newer = task('custom:new', 'Newer completion', 'Combat');
  const history = [
    { revision: 2, type: 'set-task-status', at: '2026-09-10T12:00:00Z', command: { type: 'set-task-status', memberId: 'actor1', taskId: older.id, challengeCompleted: true }, actor: { label: 'Reed' } },
    { revision: 3, type: 'set-task-status', at: '2026-10-08T12:00:00Z', command: { type: 'set-task-status', memberId: 'reed', taskId: newer.id, challengeCompleted: true }, actor: { label: 'Player' } },
  ];
  const h = harness([older, newer], { history }); h.state.members[0].taskStatus[older.id] = { challengeCompleted: true }; h.state.members[1].taskStatus[newer.id] = { challengeCompleted: true };
  await h.panel.open(); await flush();
  const own = h.rows().find(row => row.dataset.taskId === older.id), partner = h.rows().find(row => row.dataset.taskId === newer.id);
  assert.match(own.textContent, /Player/); assert.match(partner.textContent, /Reed/);
  assert.ok(h.all().some(node => node.tagName === 'TIME' && (node.dateTime === history[0].at || node.attributes.datetime === history[0].at)) || /Sep|sept|9\/10|10\/9/.test(own.textContent), 'Recorded completion date is visible');
  const categories = h.all().filter(node => node.className.split(' ').includes('completed-category')); assert.equal(categories.length, 2);
  const layout = h.control('Completed task layout'); layout.value = 'recent'; await layout.emit('change'); await flush();
  assert.deepEqual(h.rows().map(row => row.dataset.taskId), [newer.id, older.id]);
  await h.click(older.label); assert.equal(h.opened.at(-1)[0].id, older.id);
});

test('game and imported chips retain provenance and do not invent explicit untick actions', async () => {
  const observed = task('custom:game', 'Completed quest', 'Quest'), imported = task('custom:imported', 'Imported achievement', 'Combat');
  const h = harness([observed, imported]); h.state.members[0].completedTasks = [observed.id]; h.state.members[0].taskStatus[imported.id] = { challengeCompleted: true };
  h.state.members[0].questProgress = { [observed.id]: { source: 'runemetrics', fetchedAt: '2026-10-08T12:00:00Z', runescapeName: 'DemoExplorer' } };
  h.state.legacy = { gameplayMigration: { taskStatusProvenance: [{ memberId: 'actor1', taskId: imported.id, sources: ['completedChallenges'] }] } };
  await h.panel.open(); await flush();
  await h.click('Done in-game (RuneMetrics)'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [observed.id]);
  assert.match(h.rows()[0].textContent, /Done by Player \(in-game, RuneMetrics\)/);
  assert.ok(!h.control('Untick Completed quest for Player') && !h.find('button', 'Untick Completed quest for Player'));
  await h.click('Imported from original picker'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [imported.id]);
  assert.match(h.rows()[0].textContent, /Done by Player \(ticked\)/);
});

test('600 completed rows render in bounded pages and search finds rows beyond the first page', async () => {
  const tasks = Array.from({ length: 600 }, (_, index) => task(`custom:${index}`, `Task ${String(index).padStart(3, '0')}`, 'Crafting'));
  const h = harness(tasks); h.state.members[0].taskStatus = Object.fromEntries(tasks.map(row => [row.id, { challengeCompleted: true }]));
  await h.panel.open(); await flush(); assert.equal(h.rows().length, 60);
  await h.click('Show more Crafting (540)'); assert.equal(h.rows().length, 120);
  const filter = h.control('Filter completed tasks'); filter.value = 'Task 599'; await filter.emit('input'); await flush();
  assert.deepEqual(h.rows().map(row => row.dataset.taskId), ['custom:599']);
  filter.value = ''; await filter.emit('input'); await flush();
  const layout = h.control('Completed task layout'); layout.value = 'recent'; await layout.emit('change'); await flush();
  assert.equal(h.rows().length, 60); await h.click('Show more completed tasks (540)'); assert.equal(h.rows().length, 120);
});

test('an empty completion panel renders an explanatory empty state', async () => {
  const h = harness([task('custom:oak', 'Chop oak logs')]); await h.panel.open(); await flush();
  assert.equal(h.rows().length, 0); assert.match(h.root.textContent, /no completed|nothing completed|no tasks completed/i); assert.equal(h.errors.length, 0);
});

test('collapsed categories stay collapsed across filtering and reopen on demand', async () => {
  const own = task('custom:oak', 'Chop oak logs', 'Woodcutting'); const h = harness([own]); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true };
  await h.panel.open(); await flush();
  const category = h.all().find(node => node.className === 'completed-category'); category.open = false; await category.emit('toggle');
  const filter = h.control('Filter completed tasks'); filter.value = 'oak'; await filter.emit('input'); await flush();
  const replacement = h.all().find(node => node.className === 'completed-category'); assert.equal(replacement.open, false); assert.equal(h.rows().length, 0);
  replacement.open = true; await replacement.emit('toggle'); assert.equal(h.rows().length, 1);
});

test('a late player result cannot replace a newer player selection', async () => {
  const own = task('custom:oak', 'Chop oak logs'), pending = deferred(); const h = harness([own]); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true };
  await h.panel.open(); await flush(); h.route(() => pending.promise);
  await h.click('Reed'); await h.click('Player');
  pending.resolve({ memberId: 'reed', stateRevision: 7, tasks: [own], presentation: { tasks: [own], alternatives: {} } }); await flush();
  assert.equal(h.find('button', 'Player').attributes['aria-pressed'], 'true'); assert.equal(h.rows().length, 1);
});

test('a late result load cannot replace a closed dialog', async () => {
  const own = task('custom:oak', 'Chop oak logs'), pending = deferred(); const h = harness([own]); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true };
  h.route(() => pending.promise); const opening = h.panel.open(); await flush(); h.close(); const before = h.root.textContent;
  pending.resolve({ memberId: 'actor1', stateRevision: 7, tasks: [own], presentation: { tasks: [own], alternatives: {} } }); await opening; await flush();
  assert.equal(h.root.textContent, before); assert.equal(h.rows().length, 0);
});

test('opening a completed task reviews the selected player and Back preserves filters and layout', async () => {
  const own = task('custom:oak', 'Chop oak logs', 'Woodcutting'), other = task('custom:rat', 'Defeat giant rat', 'Combat');
  const h = harness([own, other], { realDialogs: true }); h.state.members[1].taskStatus[own.id] = { challengeCompleted: true }; h.state.members[1].taskStatus[other.id] = { challengeCompleted: true };
  await h.panel.open(); await flush(); await h.click('Reed');
  const filter = h.control('Filter completed tasks'); filter.value = 'oak'; await filter.emit('input');
  const layout = h.control('Completed task layout'); layout.value = 'recent'; await layout.emit('change');
  await h.click(own.label); const opened = h.opened.at(-1);
  assert.equal(opened[0].id, own.id); assert.equal(opened[1], true); assert.equal(opened[2].memberId, 'reed'); assert.equal(opened[2].result.memberId, 'reed');
  await h.click('Back to Completed Tasks'); assert.equal(h.find('button', 'Reed').attributes['aria-pressed'], 'true');
  assert.equal(h.control('Filter completed tasks').value, 'oak'); assert.equal(h.control('Completed task layout').value, 'recent');
  assert.deepEqual(h.rows().map(row => row.dataset.taskId), [own.id]);
});

test('scheduled row painting yields to the browser and discards obsolete filter and dialog work', async () => {
  const tasks = Array.from({ length: 600 }, (_, index) => task(`custom:${index}`, `Task ${String(index).padStart(3, '0')}`, 'Crafting'));
  const h = harness(tasks, { scheduled: true }); h.state.members[0].taskStatus = Object.fromEntries(tasks.map(row => [row.id, { challengeCompleted: true }]));
  await h.panel.open(); await flush(); assert.equal(h.rows().length, 0); assert.equal(h.paints.length, 1);
  const filter = h.control('Filter completed tasks'); filter.value = 'Task 599'; await filter.emit('input');
  while (h.paints.length) h.paints.shift()(); assert.deepEqual(h.rows().map(row => row.dataset.taskId), ['custom:599']);
  filter.value = ''; await filter.emit('input'); assert.equal(h.rows().length, 0); assert.ok(h.paints.length);
  h.close(); const paintedBeforeClose = h.icons.length; while (h.paints.length) h.paints.shift()();
  assert.equal(h.rows().length, 0); assert.equal(h.icons.length, paintedBeforeClose);
});

test('slim completed rows filter and page without loading details, then share full evidence on task open', async () => {
  const tasks = Array.from({ length: 600 }, (_, index) => task(`custom:${index}`, `Task ${String(index).padStart(3, '0')}`, 'Crafting')), pending = deferred();
  const slim = { format: 'play-v1', memberId: 'actor1', stateRevision: 7, tasks, presentation: { tasks, alternatives: {} } };
  const h = harness(tasks, { realDialogs: true, results: { actor1: slim }, details: () => pending.promise });
  h.state.members[0].taskStatus = Object.fromEntries(tasks.map(row => [row.id, { challengeCompleted: true }]));
  await h.panel.open(); await h.click('Show more Crafting (540)');
  const filter = h.control('Filter completed tasks'); filter.value = 'Task 599'; await filter.emit('input');
  assert.deepEqual(h.rows().map(row => row.dataset.taskId), ['custom:599']); assert.equal(h.detailLoads.length, 0); assert.equal(h.hover.length, 0);
  await h.click('Task 599'); const review = h.opened.at(-1);
  assert.equal(review[1], false); assert.equal(review[2].result, slim); assert.equal(h.detailLoads.length, 0);
  const first = review[2].loadResult(), second = review[2].loadResult(); assert.deepEqual(h.detailLoads, ['actor1']);
  const full = { memberId: 'actor1', stateRevision: 7, tasks: tasks.map(row => ({ ...row, record: { Description: 'Full requirement evidence' } })), presentation: { tasks, alternatives: {} } };
  pending.resolve(full); const loaded = await Promise.all([first, second]); assert.equal(loaded[0], full); assert.equal(loaded[1], full);
  await h.click('Back to Completed Tasks'); await h.click('Task 599');
  assert.equal(h.opened.at(-1)[1], true); assert.equal(h.opened.at(-1)[2].result, full); assert.equal(h.detailLoads.length, 1);
});

test('full completed-task evidence rejects a changed saved state, wrong player, or wrong revision', async () => {
  for (const mismatch of ['state', 'player', 'revision']) {
    const own = task('custom:oak', 'Chop oak logs'), pending = deferred(), slim = { format: 'play-v1', memberId: 'actor1', stateRevision: 7, tasks: [own] };
    const h = harness([own], { results: { actor1: slim }, details: () => pending.promise }); h.state.members[0].taskStatus[own.id] = { challengeCompleted: true };
    await h.panel.open(); await h.click(own.label); const load = h.opened.at(-1)[2].loadResult();
    const rejected = assert.rejects(load, /saved task details changed/); if (mismatch === 'state') h.state.revision++;
    pending.resolve({ memberId: mismatch === 'player' ? 'reed' : 'actor1', stateRevision: mismatch === 'revision' ? 8 : 7, tasks: [{ ...own, record: { Description: 'Obsolete details' } }] }); await rejected;
    assert.equal(h.detailLoads.length, 1);
  }
});

const datedTick = (id, day, memberId = 'actor1') => ({ type: 'set-task-status', at: new Date(2026, 9, day, 12).toISOString(), command: { memberId, taskId: id, challengeCompleted: true } });
const fixedNow = () => new Date(2026, 9, 12, 18);
const setRange = async (h, value) => { const control = h.control('Completion date range'); control.value = value; await control.emit('change'); await flush(); };

test('date range combines with search and attribution and counts undated completions', async () => {
  const tasks = [task('custom:today', 'Oak today'), task('custom:week', 'Oak this week'), task('custom:old', 'Oak older'), task('custom:unknown', 'Imported oak')];
  const h = harness(tasks, { now: fixedNow, history: [datedTick(tasks[0].id, 12), datedTick(tasks[1].id, 7, 'reed'), datedTick(tasks[2].id, 1)] });
  h.state.members[0].taskStatus = Object.fromEntries([tasks[0], tasks[2], tasks[3]].map(row => [row.id, { challengeCompleted: true }]));
  h.state.members[1].taskStatus[tasks[1].id] = { challengeCompleted: true };
  await h.panel.open('both');
  assert.equal(h.rows().length, 4); assert.match(h.root.textContent, /1 completion has no date/);
  await setRange(h, '7'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [tasks[1].id, tasks[0].id]);
  assert.match(h.root.textContent, /2 tasks of 4 · last 7 days/);
  await h.click('Done by Reed'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [tasks[1].id]);
  const search = h.control('Filter completed tasks'); search.value = 'missing'; await search.emit('input');
  assert.equal(h.rows().length, 0); assert.match(h.root.textContent, /No completed tasks match last 7 days and the current filters/);
  await h.click('Clear filters'); assert.equal(h.rows().length, 4); assert.equal(h.control('Completion date range').value, 'all');
  await setRange(h, 'today'); assert.deepEqual(h.rows().map(row => row.dataset.taskId), [tasks[0].id]);
  await setRange(h, '30'); assert.equal(h.rows().length, 3);
  assert.deepEqual(h.calls, []);
});

test('custom native date inputs are inclusive, validate reversed dates and survive task details', async () => {
  const tasks = [task('custom:start', 'Start day'), task('custom:end', 'End day')];
  const h = harness(tasks, { now: fixedNow, realDialogs: true, history: [datedTick(tasks[0].id, 7), datedTick(tasks[1].id, 12)] });
  h.state.members[0].taskStatus = Object.fromEntries(tasks.map(row => [row.id, { challengeCompleted: true }]));
  await h.panel.open(); await setRange(h, 'custom');
  assert.match(h.root.textContent, /Choose a From or To date/);
  const from = h.control('Completed from'), to = h.control('Completed to');
  assert.equal(from.type, 'date'); assert.equal(to.type, 'date');
  from.value = '2026-10-07'; to.value = '2026-10-12'; await to.emit('change');
  assert.equal(h.rows().length, 2);
  await h.click(tasks[0].label); await h.click('Back to Completed Tasks');
  assert.equal(h.control('Completion date range').value, 'custom'); assert.equal(h.control('Completed from').value, '2026-10-07');
  const restoredTo = h.control('Completed to'); restoredTo.value = '2026-10-06'; await restoredTo.emit('change');
  assert.equal(h.rows().length, 0); assert.match(h.root.textContent, /From must be on or before To/);
});

test('view-only range and copy use the filtered scope, preserve order and never send commands', async () => {
  const tasks = [task('custom:new', 'New oak', 'Woodcutting'), task('custom:week', 'Week fish', 'Fishing'), task('custom:old', 'Old task', 'Custom')];
  const copied = [], values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const h = harness(tasks, { viewer: true, loadHistory: false, now: fixedNow, storage, clipboard: { writeText: async text => copied.push(text) }, history: [datedTick(tasks[0].id, 12), datedTick(tasks[1].id, 7, 'reed'), datedTick(tasks[2].id, 1)] });
  h.state.members[0].taskStatus = Object.fromEntries([tasks[0], tasks[2]].map(row => [row.id, { challengeCompleted: true }])); h.state.members[1].taskStatus[tasks[1].id] = { challengeCompleted: true };
  const before = structuredClone(h.state);
  await h.panel.open('both'); await setRange(h, '7'); await h.click('Copy filtered completed tasks');
  assert.match(copied.at(-1), /^Player & Reed · Completed · last 7 days · 2 tasks\n/);
  assert.match(copied.at(-1), /Week fish.*Done by Reed \(ticked\)/); assert.ok(!copied.at(-1).includes('Old task'));
  assert.ok(copied.at(-1).indexOf('Week fish') < copied.at(-1).indexOf('New oak'));
  const layout = h.control('Completed task layout'); layout.value = 'recent'; await layout.emit('change'); await h.click('Copy filtered completed tasks');
  assert.ok(copied.at(-1).indexOf('New oak') < copied.at(-1).indexOf('Week fish'));
  await h.click('Reed'); await h.click('Done by Player'); await h.click('Copy filtered completed tasks');
  assert.match(copied.at(-1), /^Reed · Completed · last 7 days · 1 task\n/);
  assert.match(copied.at(-1), /New oak/); assert.ok(!copied.at(-1).includes('Week fish'));
  assert.ok(!h.find('button', 'Undo last change')); assert.ok(!h.find('button', 'Untick'));
  await h.panel.open(); assert.equal(h.control('Completion date range').value, '7');
  assert.deepEqual(h.state, before); assert.deepEqual(h.calls, []);
});

test('review Copy includes folded categories and every filtered page beyond the Discord message limit', async () => {
  const tasks = Array.from({ length: 75 }, (_, index) => task(`custom:${index}`, `Completed task ${String(index).padStart(3, '0')}`, 'Crafting'));
  const h = harness(tasks, { viewer: true, now: fixedNow, history: tasks.map(row => datedTick(row.id, 12)) });
  h.state.members[0].taskStatus = Object.fromEntries(tasks.map(row => [row.id, { challengeCompleted: true }]));
  await h.panel.open(); await setRange(h, 'today'); assert.equal(h.rows().length, 60);
  const category = h.all().find(node => node.className === 'completed-category'); category.open = false; await category.emit('toggle');
  await h.click('Copy filtered completed tasks');
  const text = h.all().find(node => node.id === 'copy-completed-review-text');
  assert.equal(text.readOnly, true); assert.equal(text.selectionEnd, text.value.length);
  assert.match(text.value, /^Player · Completed · today · 75 tasks\n/);
  assert.equal(text.value.match(/\n- Completed task/g).length, 75); assert.ok(text.value.length > 2000); assert.ok(!text.value.includes('…and'));
  assert.deepEqual(h.calls, []);
});
