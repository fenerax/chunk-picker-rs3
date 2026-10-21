import test from 'node:test';
import assert from 'node:assert/strict';
import { customTaskForMember, personalCustomTaskRows } from '../app/web/custom-tasks-model.mjs';
import { selectTaskFilters } from '../app/web/task-filters-model.mjs';
import { selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { createScreenCustomTasks } from '../app/web/screen-custom-tasks.mjs';
import { createDuoTaskView } from '../app/web/duo-task-view.mjs';

const members = () => [{ id: 'actor1', name: 'Player', runescapeName: 'DemoExplorer', completedTasks: [], taskStatus: {}, skillProgress: { Mining: { level: 40, source: 'runemetrics', runescapeName: 'DemoExplorer' } } },
  { id: 'reed', name: 'Reed', runescapeName: 'SecondActor1', completedTasks: [], taskStatus: {}, skillProgress: { Mining: { level: 60, source: 'runemetrics', runescapeName: 'SecondActor1' } } }];
const saved = (id, extra = {}) => ({ id: `custom:${id}`, label: id, category: 'Custom', ...extra });
const registry = { resolve: () => ({ 'tasks.completion': 'any' }) };

test('personal custom rows use saved edits, assignments and both ID formats, discarding deleted results', () => {
  const state = { members: members(), tasks: [saved('legacy'), saved('mine', { skill: 'Mining', level: 50, memberIds: ['reed'] }),
    { ...saved('imported'), id: 'rs3:task:custom:0001' }] };
  const old = [{ ...saved('mine'), label: 'old' }, saved('deleted')];
  assert.deepEqual(personalCustomTaskRows(old, state, state.members[0]).map(row => row.id), ['custom:legacy', 'rs3:task:custom:0001']);
  const mine = personalCustomTaskRows(old, state, state.members[1]).find(row => row.id === 'custom:mine');
  assert.equal(mine.label, 'mine'); assert.equal(mine.category, 'Mining'); assert.equal(mine.level, 50);
});

test('group custom attribution follows assignment and skill/level filters use saved levels of the admitted owner', () => {
  const state = { revision: 0, members: members(), tasks: [saved('shared', { skill: 'Mining', level: 50 }), saved('reed', { memberIds: ['reed'] }), saved('actor1', { memberIds: ['actor1'] })] };
  const results = state.members.map(member => ({ memberId: member.id, stateRevision: 0, tasks: [], presentation: { tasks: [] } }));
  const group = selectDuoTasks({ state, results, registry, selectedMemberId: 'actor1' });
  assert.deepEqual(group.rows.map(row => [row.id, row.label]).sort(), [['custom:actor1', 'Player'], ['custom:reed', 'Reed'], ['custom:shared', 'Both']]);
  const choose = ownerFilter => selectTaskFilters(group.rows, { state, memberId: 'actor1', ownerFilter, filters: { doable: true, skills: ['Mining'] } }).rows;
  assert.equal(choose('actor1').length, 0); assert.equal(choose('reed')[0].id, 'custom:shared'); assert.equal(choose('both')[0].id, 'custom:shared');
  state.members[0].taskStatus['custom:shared'] = { favorite: true };
  assert.equal(selectTaskFilters(group.rows, { state, memberId: 'actor1', filters: { doable: true, pinned: true, skills: ['Mining'] } }).rows.length, 0);
  assert.equal(selectTaskFilters([customTaskForMember(state.tasks[0], { id: 'actor1' })], { state: { members: [{ id: 'actor1' }] }, memberId: 'actor1', filters: { doable: true } }).rows.length, 0);
  state.members[1].runescapeName = 'newname'; assert.equal(choose('reed').length, 0, 'Old-account observations do not qualify');
});

class Node {
  constructor(tag, text = '') { Object.assign(this, { tag, textContent: text, children: [], events: {}, attributes: {}, dataset: {}, value: '', disabled: false }); }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, action) { this.events[type] = action; }
  async emit(type) { return this.events[type]?.({ preventDefault() {} }); }
  focus() {}
}
const walk = node => [node, ...node.children.flatMap(walk)];
test('group claiming is disabled for a custom task assigned to the partner', () => {
  const task = saved('partner', { memberIds: ['reed'] }), state = { revision: 0, members: members(), tasks: [task] };
  const view = createDuoTaskView({ document: { createElement: tag => new Node(tag) }, getState: () => state, getSelectedMember: () => 'actor1',
    command() {}, backlog() {}, showTask() {}, showError() {}, canEdit: () => true });
  const presented = customTaskForMember(task, state.members[1]);
  const row = view.row({ id: task.id, task: presented, memberIds: ['reed'], label: 'Reed', facts: { group: false, completedBy: [] }, tasksByMember: { reed: presented } });
  assert.equal(walk(row).find(node => node.className === 'task-claim-action').disabled, true);
});
function ui(task, writable = true) {
  const c = { state: { revision: 7, members: members(), tasks: task ? [task] : [] }, sandbox: { active: false }, dialogGeneration: 0,
    canWrite: () => writable, plain: text => text, browserUUID: () => 'new', calls: [],
    el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; },
    input: (type, value = '') => { const node = new Node('input'); node.type = type; node.value = String(value); return node; },
    select: (options, value) => { const node = new Node('select'); node.options = options; node.value = value; return node; },
    field: (name, control) => { const node = new Node('field', name); node.append(control); return node; },
    button: (text, action) => { const node = new Node('button', text); node.addEventListener('click', action); return node; },
    openDialog: (title, stack) => { c.title = title; c.stack = stack; return ++c.dialogGeneration; },
    dialogCurrent: generation => generation === c.dialogGeneration,
    closeDialog: generation => { if (c.dialogCurrent(generation)) { c.stack = null; c.dialogGeneration++; } },
    command: async (...args) => { c.calls.push(args); }, showError: error => { c.error = error; } };
  createScreenCustomTasks(c);
  c.control = name => c.stack.children.find(node => node.textContent === name).children[0];
  c.find = text => walk(c.stack).find(node => node.textContent === text);
  return c;
}

test('add/edit form saves optional requirements and assignment through a reviewed command', async () => {
  const c = ui(); c.customTaskDialog();
  c.control('Task description').value = '  Mine coal  '; c.control('Skill (optional)').value = 'Mining';
  await c.control('Skill (optional)').emit('change'); c.control('Level (optional)').value = '30'; c.control('Assigned to').value = 'reed';
  await c.stack.emit('submit');
  assert.deepEqual(c.calls[0][0], { type: 'add-task', task: { id: 'custom:new', category: 'Mining', label: 'Mine coal', skill: 'Mining', level: 30, memberIds: ['reed'] } });
  assert.equal(c.calls[0][1], 7);
  const edit = ui(saved('mine', { skill: 'Mining', level: 30, memberIds: ['reed'] })); edit.customTaskDialog(edit.state.tasks[0]);
  edit.control('Skill (optional)').value = ''; await edit.control('Skill (optional)').emit('change'); edit.control('Assigned to').value = 'both';
  await edit.stack.emit('submit'); assert.deepEqual(edit.calls[0][0], { type: 'update-task', taskId: 'custom:mine', task: { label: 'mine' } });
});

test('delete asks for confirmation, cancel saves nothing, and confirmation uses the reviewed revision', async () => {
  const c = ui(saved('mine')); c.customTaskDialog(c.state.tasks[0]); await c.find('Delete task…').emit('click');
  assert.equal(c.title, 'Delete custom task'); assert.equal(c.calls.length, 0);
  await c.find('Cancel').emit('click'); assert.equal(c.calls.length, 0);
  c.deleteCustomTaskDialog(c.state.tasks[0]); c.state.revision = 8; await c.find('Delete task').emit('click');
  assert.deepEqual(c.calls[0][0], { type: 'delete-task', taskId: 'custom:mine' }); assert.equal(c.calls[0][1], 7);
});

test('view-only and Sandbox expose no custom write action; closed forms cannot save', async () => {
  const c = ui(saved('mine'), false), host = new Node('div'); c.customTaskDialog(); c.deleteCustomTaskDialog(c.state.tasks[0]); c.appendCustomTaskEdit(host, c.state.tasks[0]);
  assert.equal(c.stack, undefined); assert.equal(host.children.length, 0);
  const sandbox = ui(); sandbox.sandbox.active = true; sandbox.customTaskDialog(); assert.equal(sandbox.stack, undefined);
  const closed = ui(); closed.customTaskDialog(); const form = closed.stack; closed.dialogGeneration++; await form.emit('submit'); assert.equal(closed.calls.length, 0);
});
