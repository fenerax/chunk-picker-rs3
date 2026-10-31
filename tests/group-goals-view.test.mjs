import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupGoals } from '../app/web/group-goals.mjs';

class Node {
  constructor(tag, text = '') {
    Object.assign(this, { tagName: tag.toUpperCase(), textContent: text, children: [], events: {}, attributes: {}, dataset: {}, value: '', hidden: false, disabled: false });
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, handler) { this.events[event] = handler; }
  emit(event, detail = {}) { return this.events[event]?.({ preventDefault() {}, ...detail }); }
  focus() { this.focused = true; this.document.activeElement = this; }
  contains(node) { return walk(this).includes(node); }
}
const walk = root => [root, ...root.children.flatMap(walk)];
// The fold toggle only shows or hides the list, so viewers keep it.
const writeControl = node => ['INPUT', 'SELECT', 'BUTTON', 'FORM'].includes(node.tagName) && node.className !== 'group-goals-fold';
const visible = (root, predicate) => root.hidden ? [] : [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => visible(child, predicate))];
const goal = (id = 'one', extra = {}) => ({ id: `group-goal:${id}`, text: 'Get the guild key', completion: 'players', completedBy: ['actor1'], done: false, ...extra });

function ui(list = [], writable = true) {
  const document = { activeElement: null };
  const root = new Node('section');
  const c = { state: { revision: 7, groupGoals: list, tasks: [], members: [{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }] },
    document, sandbox: { active: false }, write: writable, canWrite: () => c.write, calls: [], errors: [],
    $: id => id === 'group-goals' ? root : undefined,
    plain: text => String(text ?? '').replace(/<[^>]*>/g, '').trim(), browserUUID: () => 'new-id',
    el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; node.document = document; return node; },
    input: (type, value = '') => { const node = new Node('input'); node.type = type; node.value = value; node.document = document; return node; },
    select: (choices, value) => { const node = new Node('select'); node.choices = choices; node.value = value; return node; },
    field: (text, control) => { const node = new Node('div', text); node.className = 'form-field'; node.append(control); return node; },
    button: (text, handler, cls) => { const node = new Node('button', text); node.className = cls; node.document = document; node.addEventListener('click', handler); return node; },
    command: async (...args) => { c.calls.push(args); }, showError: error => c.errors.push(error) };
  createGroupGoals(c); c.groupGoals.render();
  c.root = root;
  c.find = text => walk(root).find(node => node.textContent === text && !node.hidden);
  c.form = () => walk(root).find(node => node.tagName === 'FORM');
  c.fieldControl = text => walk(root).find(node => node.className === 'form-field' && node.textContent === text).children[0];
  c.checkbox = label => walk(root).find(node => node.type === 'checkbox' && node.attributes['aria-label'].startsWith(`${label}:`));
  return c;
}

test('empty shared list is short and offers add only when writable', () => {
  const edit = ui(); assert.ok(edit.find('Group goals')); assert.ok(edit.find('No shared goals yet.')); assert.ok(edit.find('Add goal'));
  const read = ui([], false); assert.ok(read.find('No shared goals yet.')); assert.equal(read.find('Add goal'), undefined);
  assert.equal(walk(read.root).some(writeControl), false);
});

test('empty group goals label follows the expanded state for players and viewers', async () => {
  for (const writable of [true, false]) {
    const c = ui([], writable);
    const fold = () => walk(c.root).find(node => node.className === 'group-goals-fold');
    for (const open of [true, false, true]) {
      assert.equal(fold().textContent, open ? 'Hide' : 'Show');
      assert.equal(fold().attributes['aria-label'], open ? 'Hide group goals' : 'Show group goals');
      assert.equal(fold().attributes['aria-expanded'], String(open));
      assert.equal(visible(c.root, node => node.textContent === 'No shared goals yet.').length, open ? 1 : 0);
      await fold().emit('click');
    }
    assert.equal(c.calls.length, 0);
  }
});

test('Cancel and Escape return to newly rendered Edit or Add controls without writes', async () => {
  const c = ui([goal()]);
  const originalEdit = c.find('Edit'); await originalEdit.emit('click');
  await c.find('Cancel').emit('click');
  assert.equal(c.form(), undefined); assert.equal(c.document.activeElement, c.find('Edit'));
  assert.notEqual(c.document.activeElement, originalEdit, 'render rebuilt the trigger');
  await c.find('Add goal').emit('click');
  let prevented = false, stopped = false;
  c.form().emit('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.equal(c.form(), undefined); assert.equal(c.document.activeElement, c.find('Add goal'));
  assert.equal(c.calls.length, 0);
});

test('removed and view-only goals dismiss preserved drafts to Add or fold fallback', async () => {
  const c = ui([goal()]); await c.find('Edit').emit('click');
  c.state.groupGoals = []; c.state.revision++; c.groupGoals.render();
  await c.find('Cancel').emit('click'); assert.equal(c.document.activeElement, c.find('Add goal'));
  await c.find('Add goal').emit('click'); const form = c.form();
  c.write = false; c.groupGoals.render();
  form.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  const fold = walk(c.root).find(node => node.className === 'group-goals-fold');
  assert.equal(c.document.activeElement, fold); assert.equal(c.form(), undefined); assert.equal(c.calls.length, 0);
  c.write = true; c.groupGoals.render(); assert.equal(c.form(), undefined, 'hidden draft was dismissed');
});

test('Escape during saving preserves the draft until its revision-guarded command finishes', async () => {
  const c = ui([goal()]); await c.find('Edit').emit('click');
  let finish; c.command = (...args) => { c.calls.push(args); return new Promise(resolve => { finish = resolve; }); };
  const form = c.form(), pending = form.emit('submit');
  form.emit('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(c.form(), form); assert.equal(c.find('Cancel').disabled, true);
  assert.equal(c.calls[0][1], 7); finish(); await pending; assert.equal(c.form(), undefined);
});

test('view only and Sandbox show named progress without write controls, including a preserved editor', async () => {
  for (const sandbox of [false, true]) {
    const c = ui([goal()], sandbox);
    if (sandbox) { await c.find('Edit').emit('click'); c.sandbox.active = true; c.groupGoals.render(); }
    assert.ok(c.find('Player: done')); assert.ok(c.find('Reed: to do'));
    assert.equal(walk(c.root).some(writeControl), false);
    assert.equal(c.calls.length, 0);
  }
});

test('player and overall ticks send separate revision guarded commands; single group goals have one tick', async () => {
  const c = ui([goal()]);
  const reed = c.checkbox('Reed'); reed.checked = true; await reed.emit('change');
  assert.deepEqual(c.calls[0], [{ type: 'set-group-goal-done', goalId: 'group-goal:one', done: true, memberId: 'reed' }, 7]);
  const done = c.checkbox('Done'); done.checked = true; await done.emit('change');
  assert.deepEqual(c.calls[1], [{ type: 'set-group-goal-done', goalId: 'group-goal:one', done: true }, 7]);
  const shared = ui([goal('once', { completion: 'group', done: true })]);
  assert.equal(walk(shared.root).filter(node => node.type === 'checkbox').length, 1);
  const undo = shared.checkbox('Done'); undo.checked = false; await undo.emit('change');
  assert.equal(shared.calls[0][0].done, false);
});

test('failed tick restores acknowledged progress and stale controls respect changed permissions', async () => {
  const c = ui([goal()]); c.command = async () => { throw new Error('Connection lost'); };
  const control = c.checkbox('Reed'); control.checked = true; await control.emit('change');
  assert.equal(c.checkbox('Reed').checked, false); assert.equal(c.errors[0].message, 'Connection lost');
  c.write = false; await c.find('Edit').emit('click'); assert.equal(c.form(), undefined);
  const oldTick = c.checkbox('Done'); oldTick.checked = true; await oldTick.emit('change');
  assert.equal(oldTick.checked, false);
});

test('editor preserves its draft through render and failed save, then explicitly reviews the latest revision', async () => {
  const c = ui([goal()]); await c.find('Edit').emit('click');
  const form = c.form(), text = c.fieldControl('Goal'); text.value = 'My revised goal';
  c.state.revision = 8; c.state.groupGoals[0].text = 'Reed revised this'; c.groupGoals.render();
  assert.equal(c.form(), form); assert.equal(c.fieldControl('Goal').value, 'My revised goal');
  c.command = async (...args) => { c.calls.push(args); throw new Error('Another save arrived first'); };
  await form.emit('submit');
  assert.equal(c.calls[0][1], 7); assert.equal(c.form(), form); assert.equal(text.value, 'My revised goal');
  assert.ok(walk(c.root).some(node => node.textContent?.includes('Saved goal: Reed revised this')));
  await c.find('Keep draft').emit('click');
  c.command = async (...args) => c.calls.push(args); await form.emit('submit');
  assert.deepEqual(c.calls[1], [{ type: 'update-group-goal', goalId: 'group-goal:one', text: 'My revised goal', completion: 'players', link: null }, 8]);
  assert.equal(c.form(), undefined);
});

test('add trims short text and rejects blank/oversized goals without losing draft', async () => {
  const c = ui(); await c.find('Add goal').emit('click');
  const text = c.fieldControl('Goal'); assert.equal(text.maxLength, 200);
  text.value = ' '; await c.form().emit('submit'); assert.equal(c.calls.length, 0);
  text.value = 'x'.repeat(201); await c.form().emit('submit'); assert.equal(c.calls.length, 0);
  text.value = '  Supply Reed with logs  '; c.fieldControl('Complete').value = 'group'; await c.form().emit('submit');
  assert.deepEqual(c.calls[0], [{ type: 'add-group-goal', goalId: 'group-goal:new-id', text: 'Supply Reed with logs', completion: 'group' }, 7]);
});

test('task link search uses picker identities, includes calculated tasks, and limits result buttons', async () => {
  const c = ui(); c.result = { tasks: Array.from({ length: 12 }, (_, index) => ({ id: `rs3:task:${index}`, label: `Mine ore ${index}`, category: 'Mining' })) };
  await c.find('Add goal').emit('click'); c.fieldControl('Goal').value = 'Collect ore';
  const kind = c.fieldControl('Link (optional)'); kind.value = 'task'; await kind.emit('change');
  const search = c.fieldControl('Find a link'); search.value = 'Mine'; await search.emit('input');
  const matches = walk(c.root).find(node => node.className === 'group-goal-matches');
  assert.equal(matches.children.filter(node => node.tagName === 'BUTTON').length, 8);
  await matches.children[0].emit('click'); await c.form().emit('submit');
  assert.deepEqual(c.calls[0][0].link, { kind: 'task', id: 'rs3:task:0', label: 'Mine ore 0' });
});


test('late item results cannot replace the editor after changing the link kind', async () => {
  const c = ui(); let resolveItems;
  c.ensureFullResult = () => new Promise(resolve => { resolveItems = resolve; });
  await c.find('Add goal').emit('click');
  const kind = c.fieldControl('Link (optional)'); kind.value = 'item'; await kind.emit('change');
  const search = c.fieldControl('Find a link'); search.value = 'yew'; const request = search.emit('input');
  kind.value = ''; await kind.emit('change'); resolveItems({ items: [{ name: 'Yew logs' }] }); await request;
  const matches = walk(c.root).find(node => node.className === 'group-goal-matches');
  assert.equal(matches.hidden, true); assert.equal(matches.children.length, 0);
});

test('dismissal invalidates pending item links without changing the next draft or its focus', async () => {
  const c = ui(); let resolveItems;
  c.ensureFullResult = () => new Promise(resolve => { resolveItems = resolve; });
  await c.find('Add goal').emit('click');
  const kind = c.fieldControl('Link (optional)'); kind.value = 'item'; await kind.emit('change');
  const search = c.fieldControl('Find a link'); search.value = 'yew'; const request = search.emit('input');
  await c.find('Cancel').emit('click'); await c.find('Add goal').emit('click');
  const nextForm = c.form(), focus = c.document.activeElement;
  resolveItems({ items: [{ name: 'Yew logs' }] }); await request;
  assert.equal(c.form(), nextForm); assert.equal(c.document.activeElement, focus);
  const matches = walk(c.root).find(node => node.className === 'group-goal-matches');
  assert.equal(matches.children.length, 0); assert.equal(c.calls.length, 0);
});

test('pending saves block duplicate submit and permission changes hide the preserved editor', async () => {
  const c = ui(); let resolveSave;
  c.command = (...args) => { c.calls.push(args); return new Promise(resolve => { resolveSave = resolve; }); };
  await c.find('Add goal').emit('click'); c.fieldControl('Goal').value = 'Get logs';
  const form = c.form(), pending = form.emit('submit'); await form.emit('submit');
  assert.equal(c.calls.length, 1); assert.equal(c.fieldControl('Goal').disabled, true);
  c.write = false; c.groupGoals.render(); assert.equal(c.form(), undefined); await form.emit('submit');
  assert.equal(c.calls.length, 1); resolveSave(); await pending; assert.equal(c.form(), undefined);
});

test('changing optional link to none sends explicit null; typed unmatched links cannot save', async () => {
  const c = ui([goal('linked', { link: { kind: 'task', id: 'rs3:task:0', label: 'Picker task' } })]);
  await c.find('Edit').emit('click'); const kind = c.fieldControl('Link (optional)'); kind.value = 'item'; await kind.emit('change');
  await c.form().emit('submit'); assert.equal(c.calls.length, 0);
  kind.value = ''; await kind.emit('change'); await c.form().emit('submit'); assert.equal(c.calls[0][0].link, null);
});

test('editing text preserves an unchanged saved link without requiring the catalogue row again', async () => {
  const c = ui([goal('linked', { link: { kind: 'task', id: 'rs3:task:old', label: 'Preserved old task' } })]);
  await c.find('Edit').emit('click'); c.fieldControl('Goal').value = 'New goal wording'; await c.form().emit('submit');
  assert.equal(Object.hasOwn(c.calls[0][0], 'link'), false);
  assert.equal(c.calls[0][0].text, 'New goal wording');
});

test('ordered controls send exact indices, disable bounds, and remove only the targeted goal', async () => {
  const c = ui([goal('one'), goal('two', { text: 'Collect logs' })]);
  const rows = walk(c.root).filter(node => node.className === 'group-goal');
  const firstButtons = walk(rows[0]).filter(node => node.tagName === 'BUTTON');
  assert.equal(firstButtons.find(node => node.textContent === 'Up').disabled, true);
  await firstButtons.find(node => node.textContent === 'Down').emit('click');
  assert.deepEqual(c.calls[0], [{ type: 'move-group-goal', goalId: 'group-goal:one', index: 1 }, 7]);
  const second = walk(c.root).find(node => node.dataset.goalId === 'group-goal:two');
  assert.equal(walk(second).find(node => node.textContent === 'Down').disabled, true);
  await walk(second).find(node => node.textContent === 'Remove').emit('click');
  assert.deepEqual(c.calls[1], [{ type: 'remove-group-goal', goalId: 'group-goal:two' }, 7]);
});

test('task links open existing details for players and stay plain text for viewers', async () => {
  const c = ui([goal('linked', { text: '<b>My goal</b>', link: { kind: 'task', id: 'rs3:task:0', label: '<b>Mine ore</b>' } })]);
  const task = { id: 'rs3:task:0', label: 'Mine ore' }; c.result = { tasks: [task] }; c.showTask = row => { c.opened = row; }; c.groupGoals.render();
  assert.ok(c.find('My goal')); await c.find('Task: Mine ore').emit('click'); assert.equal(c.opened, task);
  c.write = false; c.groupGoals.render();
  assert.ok(c.find('Task: Mine ore'));
  assert.equal(visible(c.root, node => (node.tagName === 'BUTTON' || node.tagName === 'INPUT') && node.className !== 'group-goals-fold').length, 0);
});

test('the list folds to a done count and opens again for a new goal', async () => {
  const c = ui([goal('one', { done: true }), goal('two')]);
  const fold = () => walk(c.root).find(node => node.className === 'group-goals-fold');
  assert.equal(fold().textContent, '1 of 2 done'); assert.equal(fold().attributes['aria-expanded'], 'true');
  await fold().emit('click');
  assert.equal(fold().attributes['aria-expanded'], 'false'); assert.equal(visible(c.root, node => node.textContent === 'Edit').length, 0);
  await c.find('Add goal').emit('click');
  assert.equal(fold().attributes['aria-expanded'], 'true'); assert.ok(c.form());
});
