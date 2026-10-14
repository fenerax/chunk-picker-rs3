import test from 'node:test';
import assert from 'node:assert/strict';
import { backlogSearchText, selectBacklogGroups, createBacklogView } from '../app/web/screen-backlog.mjs';

const task = (id, extra = {}) => ({ id, label: `Task ${id}`, category: 'Mining', ...extra });
const locationName = id => ({ '12341': 'Lumbridge', '12342': 'Varrock' })[id] ?? id;

test('Backlog search covers plain names, skills, chunk IDs and all source/declared chunk names', () => {
  const row = task('mine', { label: 'Mine ~|Copper#Ore|~', category: 'Mining', skillRequirements: { Smithing: 5 },
    record: { Chunks: ['12341-2[+]', null], Skills: { Crafting: 3 }, Requirements: { Fishing: 4 }, SkillsNeeded: { Cooking: 5 } }, sources: [null, { locations: ['12342[+]', 'Elsewhere'], location: { id: 'Cave', name: 'Deep cave' } }] });
  const status = { mine: { backlogged: true } };
  for (const query of ['copper', ' MINING ', 'Smithing', 'Crafting', 'Fishing', 'Cooking', '12341', 'Lumbridge', 'Varrock', 'elsewhere', 'deep cave']) {
    assert.deepEqual(selectBacklogGroups([row], status, query, locationName)[0].tasks.map(value => value.id), ['mine'], query);
  }
  assert.equal(selectBacklogGroups([row], status, 'prayer', locationName).length, 0);
  assert.ok(!backlogSearchText(row).includes('#ore'));
});

test('groups count only personal backlogs, deduplicate rows and distinguish missing reasons from literal labels', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(id => task(id));
  const status = { a: { backlogged: true, backlogReason: 'Later' }, b: { backlogged: true, backlogReason: ' Later ' },
    c: { backlogged: true }, d: { backlogged: true, backlogReason: 'No reason given' }, e: { backlogged: false } };
  const groups = selectBacklogGroups([...rows, rows[0], task('partner', { obligation: false }), task('hidden', { hidden: true })],
    { ...status, partner: { backlogged: true }, hidden: { backlogged: true } });
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.find(group => group.reason === 'Later').tasks.map(row => row.id), ['a', 'b']);
  assert.equal(groups.filter(group => group.label === 'No reason given').length, 2);
});

class Node {
  constructor(tag, text = '') { Object.assign(this, { tagName: tag.toUpperCase(), _text: text, children: [], events: {}, attributes: {}, value: '', open: false }); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, action) { (this.events[key] ??= []).push(action); }
  async emit(key) { for (const action of this.events[key] ?? []) await action({ target: this }); }
}
const document = { createElement: tag => new Node(tag) };
const walk = node => [node, ...node.children.flatMap(walk)];
function harness({ count = 2, editable = true, loadTasks, save, autoRender = false } = {}) {
  let memberId = 'actor1', state = { revision: 7, members: [{ id: 'actor1', name: 'Player', taskStatus: {} }, { id: 'reed', name: 'Reed', taskStatus: {} }] };
  const tasks = Array.from({ length: count }, (_, index) => task(`task:${index}`, { label: index ? `Other ${index}` : 'Copper ore' }));
  for (const member of state.members) member.taskStatus = Object.fromEntries(tasks.map(row => [row.id, { backlogged: true, backlogReason: member.id === 'actor1' ? 'Later' : 'Waiting for Player' }]));
  const host = new Node('div'), target = new Node('div'), calls = [], errors = [], painted = [];
  let changes = 0;
  const view = createBacklogView({ document, getState: () => state, getMemberId: () => memberId, canEdit: () => editable,
    command: async (payload, revision) => { calls.push({ payload, revision }); await save?.(); }, showError: error => errors.push(error), onChange: () => { changes++; if (autoRender) render(); }, locationName, loadTasks,
    row: task => { painted.push(task.id); return new Node('div', task.label); }, paint: async jobs => { for (const job of jobs) job(); } });
  const render = (open = true) => { const jobs = [], result = view.render(host, target, tasks, { open, jobs, generation: 1 }); for (const job of jobs) job(); return result; };
  const find = (tag, text) => [...walk(host), ...walk(target)].find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
  return { render, host, target, calls, errors, painted, find, tasks, state: () => state, changes: () => changes,
    member: id => { memberId = id; }, revision: value => { state = { ...state, revision: value }; }, editable: value => { editable = value; },
    search: async value => { const input = find('input'); input.value = value; await input.emit('input'); return render(); } };
}

test('reason groups start folded, paint only when opened and retain per-player folds', async () => {
  const h = harness(); h.render(); assert.deepEqual(h.painted, []);
  const details = h.find('details'); assert.equal(details.open, false);
  details.open = true; await details.emit('toggle'); assert.deepEqual(h.painted, ['task:0', 'task:1']);
  h.render(); assert.equal(h.find('details').open, true);
  h.member('reed'); h.render(); assert.equal(h.find('details').open, false); assert.ok(h.find('span', 'Waiting for Player (2)'));
  h.member('actor1'); h.render(); assert.equal(h.find('details').open, true);
});

test('group restore sends one revision-bound subset command, with matches only and personal search state', async () => {
  const h = harness(); h.render(); const input = h.find('input');
  await h.search('copper'); assert.strictEqual(h.find('input'), input, 'Search stays mounted while typing');
  assert.ok(h.find('span', 'Later (1)'));
  await h.find('button', 'Restore these').emit('click');
  assert.deepEqual(h.calls, [{ payload: { type: 'clear-backlog', memberId: 'actor1', taskIds: ['task:0'] }, revision: 7 }]);
  h.member('reed'); h.render(); assert.equal(h.find('input').value, '');
  h.member('actor1'); h.render(); assert.equal(h.find('input').value, 'copper');
});

test('more than ten requires confirmation, Cancel does not save, and Restore all remains unfiltered', async () => {
  const h = harness({ count: 11 }); h.render();
  await h.find('button', 'Restore these').emit('click'); assert.equal(h.calls.length, 0); assert.ok(h.find('span', 'Restore 11 tasks for Player?'));
  await h.find('button', 'Cancel').emit('click'); assert.equal(h.calls.length, 0);
  await h.search('copper'); await h.find('button', 'Restore all (11)').emit('click'); assert.equal(h.calls.length, 0);
  await h.find('button', 'Restore').emit('click');
  assert.deepEqual(h.calls, [{ payload: { type: 'clear-backlog', memberId: 'actor1' }, revision: 7 }]);
  const ten = harness({ count: 10 }); ten.render(); await ten.find('button', 'Restore these').emit('click'); assert.equal(ten.calls.length, 1);
});

test('stale or wrong-player confirmations and permission changes cannot submit', async () => {
  for (const change of [h => h.revision(8), h => h.member('reed'), h => h.editable(false)]) {
    const h = harness({ count: 11 }); h.render(); await h.find('button', 'Restore these').emit('click');
    const restore = h.find('button', 'Restore'); change(h); await restore.emit('click');
    assert.equal(h.calls.length, 0); assert.equal(h.errors.length, 1);
  }
});

test('bulk restore controls stay disabled until a save finishes and rapid clicks cannot submit twice', async () => {
  let release; const saving = new Promise(resolve => { release = resolve; });
  const h = harness({ save: () => saving, autoRender: true }); h.render();
  const first = h.find('button', 'Restore these').emit('click');
  assert.equal(h.calls.length, 1);
  assert.ok([...walk(h.host), ...walk(h.target)].filter(node => node.tagName === 'BUTTON').every(node => node.disabled));
  await h.find('button', 'Restore these').emit('click'); assert.equal(h.calls.length, 1);
  release(); await first;
  assert.equal(h.find('button', 'Restore these').disabled, false);
});

test('view-only links retain search and readable folded groups without restore controls', async () => {
  const h = harness({ editable: false }); h.render();
  assert.ok(!h.host.textContent.includes('Undo'));
  assert.equal(walk(h.host).filter(node => node.tagName === 'BUTTON').length, 0);
  assert.equal(walk(h.target).filter(node => node.tagName === 'BUTTON').length, 0);
  const details = h.find('details'); details.open = true; await details.emit('toggle'); assert.equal(h.painted.length, 2);
  await h.search('copper'); assert.ok(h.find('span', 'Later (1)')); assert.equal(h.calls.length, 0);
  assert.ok(!h.host.textContent.includes('Restore these'));
});

test('thin rows load chunk search once per revision and never load closed Backlog details', async () => {
  let loads = 0;
  const h = harness({ loadTasks: async memberId => { loads++; return { memberId, stateRevision: 7,
    tasks: [task('task:0', { record: { Chunks: ['12341'] } }), task('task:1', { sources: [{ locations: ['12342'] }] })] }; } });
  for (const row of h.tasks) Object.assign(row, { locations: [], sources: [], record: {} });
  h.render(false); h.find('input').value = 'Lumbridge'; h.render(false); await new Promise(resolve => setImmediate(resolve)); assert.equal(loads, 0);
  h.render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 1); assert.deepEqual(h.render().rows.map(task => task.id), ['task:0']);
  await h.search('Varrock'); assert.deepEqual(h.render().rows.map(task => task.id), ['task:1']); assert.equal(loads, 1);
});

test('chunk-search failures can retry, and stale metadata does not leak across players', async () => {
  let fail = true, resolveLoad;
  const h = harness({ loadTasks: memberId => fail ? Promise.reject(new Error('Offline')) : new Promise(resolve => { resolveLoad = () => resolve({ memberId, stateRevision: 7, tasks: [task('task:0', { locations: ['12341'] })] }); }) });
  h.render(); await h.search('Lumbridge'); await new Promise(resolve => setImmediate(resolve)); h.render(); assert.ok(h.find('button', 'Retry chunk search'));
  fail = false; await h.find('button', 'Retry chunk search').emit('click'); h.render(); await new Promise(resolve => setImmediate(resolve));
  h.member('reed'); h.render(); const before = h.changes(); resolveLoad(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.changes(), before); await h.search('Lumbridge'); assert.equal(h.render().rows.length, 0);
});

test('large folded groups paginate their rows after opening', async () => {
  const h = harness({ count: 75 }); h.render(); const details = h.find('details'); details.open = true; await details.emit('toggle');
  assert.equal(h.painted.length, 70); await h.find('button', 'Show more (5)').emit('click'); assert.equal(h.painted.length, 75);
});
