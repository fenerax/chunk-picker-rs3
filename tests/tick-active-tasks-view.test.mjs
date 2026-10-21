import test from 'node:test';
import assert from 'node:assert/strict';
import { createTickActiveTasks } from '../app/web/tick-active-tasks.mjs';

class Element {
  constructor(tagName) {
    Object.assign(this, { tagName: tagName.toUpperCase(), children: [], parentElement: null, attributes: new Map(), listeners: new Map(),
      textContent: '', className: '', id: '', hidden: false, disabled: false, open: false });
  }
  remove() { if (this.parentElement) { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; } }
  contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  focus() { document.activeElement = this; }
  get text() { return [this.textContent, ...this.children.map(child => child.text)].join(' ').trim(); }
}
const walk = root => root.children.flatMap(child => [child, ...walk(child)]);
const byClass = (root, name) => walk(root).find(node => node.className.split(' ').includes(name));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function harness(t, { readOnly = false, sessionMember = 'ash', memberId = 'ash', revision = 7 } = {}) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: tag => new Element(tag), head: new Element('head'), activeElement: null, addEventListener() {} };
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; });
  const heading = new Element('div'), dialogs = [], commands = [], notices = [];
  let generation = 0, failure;
  const c = {
    state: { revision, members: [{ id: 'ash', name: 'Ash' }, { id: 'birch', name: 'Birch' }] },
    memberId, sessionMember, sandbox: { active: false },
    canWrite: () => !readOnly, advanced: () => false,
    el: (tag, text, cls) => { const node = new Element(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; },
    button: (text, action, cls) => { const node = c.el('button', text, cls); node.addEventListener('click', () => Promise.resolve().then(action)); return node; },
    taskFacts: task => ({ personal: task.id === 'done' }),
    openDialog: (title, ...nodes) => { dialogs.push({ title, nodes, open: true }); return ++generation; },
    closeDialog: value => { if (value === generation) dialogs.at(-1).open = false; },
    dialogCurrent: value => value === generation && dialogs.at(-1)?.open,
    command: async (payload, reviewed) => { commands.push({ payload, reviewed }); if (failure) throw failure; },
    notice: text => notices.push(text), showError: error => notices.push(error.message),
  };
  const view = createTickActiveTasks(c);
  return { c, view, heading, dialogs, commands, notices, fail: error => { failure = error; } };
}
const soloRows = [{ id: 'one', status: 'available' }, { id: 'two', status: 'available' }, { id: 'done', status: 'available' }, { id: 'blocked', status: 'blocked' }];
const openMenu = menu => { menu.open = true; menu.listeners.get('toggle')(); };

test('members get a quiet overflow entry in the Active Tasks heading; viewers never do', t => {
  const viewer = harness(t, { readOnly: true, sessionMember: null });
  viewer.view.update(soloRows, { ready: true, host: viewer.heading });
  assert.equal(viewer.heading.children.length, 0, 'no menu for viewers');
  assert.equal(viewer.view.element(), undefined);

  const member = harness(t);
  member.view.update(soloRows, { ready: true, host: member.heading });
  const menu = member.view.element();
  assert.equal(menu.tagName, 'DETAILS'); assert.equal(menu.parentElement, member.heading);
  assert.equal(menu.children[0].getAttribute('aria-label'), 'More actions for active tasks');
  const item = byClass(menu, 'task-list-menu-item');
  assert.equal(item.textContent, 'Tick all active tasks…');
  openMenu(menu); assert.equal(item.disabled, false);
  member.view.update(soloRows, { ready: true, host: member.heading });
  assert.equal(member.heading.children.length, 1, 'rendering again reuses the one menu');

  member.c.canWrite = () => false;
  member.view.update(soloRows, { ready: true, host: member.heading });
  assert.equal(member.heading.children.length, 0, 'losing write access removes it');
});

test('the entry explains why it is unavailable', t => {
  const h = harness(t);
  const reason = () => { const menu = h.view.element(); openMenu(menu); return byClass(menu, 'task-list-menu-note').textContent; };
  h.view.update(soloRows, { ready: false, host: h.heading }); assert.equal(reason(), 'Tasks are still updating.');
  h.view.update([{ id: 'done', status: 'available' }], { ready: true, host: h.heading }); assert.equal(reason(), 'Nothing here to tick.');
  h.c.memberId = 'birch'; h.view.update(soloRows, { ready: true, host: h.heading }); assert.equal(reason(), 'Switch to your own map to tick your tasks.');
  h.c.memberId = 'ash'; h.c.sandbox.active = true; h.view.update(soloRows, { ready: true, host: h.heading }); assert.equal(reason(), 'Exit Sandbox to tick tasks.');
  assert.equal(byClass(h.view.element(), 'task-list-menu-item').disabled, true);
});

test('the dialog shows counts, defaults to Cancel and sends one revision-checked command', async t => {
  const h = harness(t, { sessionMember: null, memberId: 'birch' });
  const row = (id, memberIds, extra = {}) => ({ id, task: { id, status: 'available' }, memberIds, facts: { group: false, personal: false }, ...extra });
  const rows = [row('b1', ['birch']), row('b2', ['birch']), row('shared1', ['ash', 'birch']), row('shared2', ['ash', 'birch']), row('ash-only', ['ash'])];
  h.view.update(rows, { duo: true, ready: true, host: h.heading });
  h.view.open();
  const dialog = h.dialogs.at(-1);
  assert.equal(dialog.title, 'Tick all active tasks');
  assert.equal(dialog.nodes[0].textContent, 'Tick 2 active tasks for Birch? 2 need a choice and will be left.');
  const actions = dialog.nodes.find(node => node.className === 'tick-active-actions');
  const [cancel, confirm] = actions.children;
  assert.equal(cancel.textContent, 'Cancel'); assert.equal(document.activeElement, cancel, 'Cancel is the default');
  assert.equal(confirm.textContent, 'Tick 2 tasks');
  await cancel.listeners.get('click')(); assert.equal(dialog.open, false); assert.equal(h.commands.length, 0);

  h.view.open();
  await h.dialogs.at(-1).nodes.find(node => node.className === 'tick-active-actions').children[1].listeners.get('click')(); await flush();
  assert.deepEqual(h.commands, [{ payload: { type: 'tick-active-tasks', memberId: 'birch', taskIds: ['b1', 'b2'], skipped: 2 }, reviewed: 7 }]);
  assert.equal(h.dialogs.at(-1).open, false);
  assert.deepEqual(h.notices, ['Ticked 2 tasks. Undo reverses this.']);
});

test('a stale revision keeps the dialog open with plain conflict wording', async t => {
  const h = harness(t);
  h.view.update(soloRows, { ready: true, host: h.heading });
  h.view.open();
  const dialog = h.dialogs.at(-1);
  assert.equal(dialog.nodes[0].textContent, 'Tick 2 active tasks for Ash? 1 task shown as blocked will be left.');
  h.fail(Object.assign(new Error('Revision conflict'), { status: 409 }));
  const [cancel, confirm] = dialog.nodes.find(node => node.className === 'tick-active-actions').children;
  await confirm.listeners.get('click')(); await flush();
  assert.equal(h.commands[0].payload.taskIds.join(), 'one,two'); assert.equal(h.commands[0].payload.skipped, undefined);
  assert.equal(dialog.open, true);
  assert.equal(dialog.nodes.at(-1).textContent, 'Another save arrived first. Nothing was ticked. Close this and try again.');
  assert.equal(cancel.disabled, false); assert.equal(confirm.disabled, true);
});
