import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDuoBacklogGroups, createDuoBacklogView } from '../app/web/duo-backlog-view.mjs';

const owners = [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }];
const task = (id, extra = {}) => ({ id, label: id, category: 'Mining', ...extra });
const entry = (id, memberIds = ['actor1', 'reed'], reasons = {}, tasks = {}) => ({ id, stateRevision: 7, memberIds,
  tasksByMember: Object.fromEntries(memberIds.map(owner => [owner, tasks[owner] ?? task(id)])),
  factsByMember: Object.fromEntries(memberIds.map(owner => [owner, {}])),
  statusByMember: Object.fromEntries(memberIds.map(owner => [owner, { backlogged: true, backlogReason: reasons[owner] ?? 'Later' }])) });
const locationName = id => ({ '12341': 'Lumbridge', '12342': 'Varrock' })[id] ?? id;

test('shared backlog reasons split attribution and owner filters before search scopes each matching owner', () => {
  const rows = [entry('shared', undefined, { actor1: 'Waiting', reed: ' Later ' }, {
    actor1: task('shared'), reed: task('shared', { record: { Chunks: ['12342-1'] } }) }), entry('own', ['actor1'])];
  const state = { members: owners };
  const select = (owner = 'all', search = '', metadata) => selectDuoBacklogGroups(rows, state, 'actor1', owner, search, locationName, metadata);
  assert.deepEqual(select().find(group => group.reason === 'Waiting').tasks[0].memberIds, ['actor1']);
  assert.deepEqual(select().find(group => group.reason === 'Later').tasks.find(row => row.id === 'shared').memberIds, ['reed']);
  assert.equal(select('both').flatMap(group => group.tasks).length, 2);
  assert.deepEqual(select('reed').flatMap(group => group.tasks).map(row => row.id), ['shared']);
  assert.deepEqual(select('all', ' VARROCK ')[0].tasks[0].memberIds, ['reed']);
  assert.equal(select('actor1', 'varrock').length, 0);
  const metadata = new Map([['reed', new Map([['shared', 'fishing lumbridge']])]]);
  assert.deepEqual(select('all', 'lumbridge', metadata)[0].tasks[0].memberIds, ['reed']);
});

class Node {
  constructor(tag, text = '') { Object.assign(this, { tagName: tag.toUpperCase(), _text: text, children: [], events: {}, value: '', open: false }); }
  get parentElement() { return this.parent; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  setAttribute() {}
  addEventListener(key, handler) { (this.events[key] ??= []).push(handler); }
  async emit(key) { for (const handler of this.events[key] ?? []) await handler({ target: this, preventDefault() {} }); }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ count = 2, editable = true, save, loadTasks, autoRender = false } = {}) {
  let state = { revision: 7, members: owners }, selected = 'actor1', ownerFilter = 'all', enabled = true;
  const entries = Array.from({ length: count }, (_, index) => entry(`task:${index}`, undefined, {}, {
    actor1: task(`task:${index}`, { label: index ? `Other ${index}` : 'Copper ore' }),
    reed: task(`task:${index}`, { label: index ? `Other ${index}` : 'Copper ore' }),
  }));
  const host = new Node('div'), target = new Node('div'), calls = [], errors = [], painted = [];
  const view = createDuoBacklogView({ document: { createElement: tag => new Node(tag) }, getState: () => state,
    getMemberId: () => selected, getOwnerFilter: () => ownerFilter, enabled: () => enabled, canEdit: () => editable,
    command: async (payload, revision) => { calls.push({ payload, revision }); await save?.(); },
    showError: error => errors.push(error), onChange: () => { if (autoRender) render(); }, locationName, loadTasks,
    row: row => { painted.push(row); return new Node('div', row.task.label); }, paint: async jobs => { for (const job of jobs) job(); } });
  const render = (open = true) => { const jobs = [], value = view.render(host, target, entries, { open, jobs, generation: 1 }); for (const job of jobs) job(); return value; };
  const find = (tag, text) => [...walk(host), ...walk(target)].find(node => node.tagName === tag.toUpperCase() && (text === undefined || node.textContent === text));
  return { host, target, calls, errors, painted, entries, render, find,
    search: async value => { find('input').value = value; await find('input').emit('input'); return render(); },
    revision: () => { state = { ...state, revision: 8 }; }, selected: () => { selected = 'reed'; },
    filter: () => { ownerFilter = 'reed'; }, groupOff: () => { enabled = false; }, permission: () => { editable = false; } };
}

test('mixed reason buttons restore exact filtered task IDs for one owner at the captured revision', async () => {
  const h = harness(); h.entries[1].statusByMember.reed.backlogReason = 'Waiting'; h.render();
  await h.search('copper');
  await h.find('button', 'Restore Reed’s (1)').emit('click');
  assert.deepEqual(h.calls, [{ payload: { type: 'clear-backlog', memberId: 'reed', taskIds: ['task:0'] }, revision: 7 }]);
  await h.find('button', 'Restore listed for Player (2)').emit('click');
  assert.deepEqual(h.calls[1], { payload: { type: 'clear-backlog', memberId: 'actor1', taskIds: ['task:0', 'task:1'] }, revision: 7 });
});

test('large restores require confirmation; Cancel saves nothing and confirmation retains exact IDs', async () => {
  const h = harness({ count: 11 }); h.render();
  await h.find('button', 'Restore Reed’s (11)').emit('click'); assert.equal(h.calls.length, 0);
  assert.ok(h.find('span', 'Restore 11 tasks for Reed?'));
  await h.find('button', 'Cancel').emit('click'); assert.equal(h.calls.length, 0);
  await h.find('button', 'Restore Reed’s (11)').emit('click'); await h.find('button', 'Restore').emit('click');
  assert.deepEqual(h.calls, [{ payload: { type: 'clear-backlog', memberId: 'reed', taskIds: h.entries.map(row => row.id) }, revision: 7 }]);
});

test('confirmation cannot submit after revision, selected owner, filter, group or permission changes', async () => {
  for (const change of ['revision', 'selected', 'filter', 'groupOff', 'permission']) {
    const h = harness({ count: 11 }); h.render(); await h.find('button', 'Restore Reed’s (11)').emit('click');
    const restore = h.find('button', 'Restore'); h[change](); await restore.emit('click');
    assert.equal(h.calls.length, 0, change); assert.equal(h.errors.length, 1, change);
  }
});

test('confirmation cannot submit captured search matches after the search changes', async () => {
  const h = harness({ count: 11 }); h.render(); await h.find('button', 'Restore Reed’s (11)').emit('click');
  const restore = h.find('button', 'Restore'); await h.search('copper'); await restore.emit('click');
  assert.equal(h.calls.length, 0); assert.equal(h.errors.length, 1);
});

test('pending save disables all restore controls and suppresses rapid submissions across owners', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ save: () => pending, autoRender: true }); h.render();
  const saving = h.find('button', 'Restore Reed’s (2)').emit('click'); assert.equal(h.calls.length, 1);
  assert.ok([...walk(h.host), ...walk(h.target)].filter(node => node.tagName === 'BUTTON').every(node => node.disabled));
  await h.find('button', 'Restore Player’s (2)').emit('click'); assert.equal(h.calls.length, 1);
  release(); await saving; assert.equal(h.find('button', 'Restore Reed’s (2)').disabled, false);
});

test('viewer can search and open attributed rows with no restore controls', async () => {
  const h = harness({ editable: false }); h.render();
  assert.equal([...walk(h.host), ...walk(h.target)].filter(node => node.tagName === 'BUTTON').length, 0);
  assert.ok(!h.host.textContent.includes('Undo'));
  const details = h.find('details'); details.open = true; await details.emit('toggle');
  assert.equal(h.painted.length, 2); assert.equal(h.painted[0].label, 'Both');
  await h.search('copper'); assert.equal(h.render().rows.length, 1); assert.equal(h.calls.length, 0);
});

test('partner metadata search loads each owner once per revision and restores only matching partner', async () => {
  const loads = [], h = harness({ loadTasks: async memberId => {
    loads.push(memberId); return { memberId, stateRevision: 7,
      tasks: [task('task:0', { record: { Chunks: [memberId === 'reed' ? '12342' : '12341'] } })] };
  } });
  h.render(false); await h.search('varrock'); await flush();
  const result = h.render(); assert.deepEqual(new Set(loads), new Set(['actor1', 'reed']));
  assert.deepEqual(result.rows[0].memberIds, ['reed']);
  await h.find('button', 'Restore Reed’s (1)').emit('click');
  assert.deepEqual(h.calls[0].payload, { type: 'clear-backlog', memberId: 'reed', taskIds: ['task:0'] });
  await h.search('lumbridge'); await flush(); assert.equal(loads.length, 2);
  assert.deepEqual(h.render().rows[0].memberIds, ['actor1']);
});
