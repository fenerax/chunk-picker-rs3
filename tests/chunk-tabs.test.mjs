import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = (await readFile(new URL('../app/web/screen-chunks.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function fixture() {
  let focused;
  const document = { body: {}, activeElement: null };
  const node = (tag, text = '', className = '') => ({
    tagName: tag.toUpperCase(), textContent: text, className, children: [], attributes: {}, dataset: {}, listeners: {},
    append(...children) { this.children.push(...children); for (const child of children) child.parentNode = this; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(key, handler) { this.listeners[key] = handler; },
    emit(key, event = {}) { return this.listeners[key]?.(event); },
    focus() { focused = this; document.activeElement = this; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.isConnected = false; },
    contains(target) { return target === this || this.children.some(child => child.contains?.(target)); },
    querySelectorAll(selector) { return this.children.filter(child => selector === '[role="menuitem"]' && child.attributes.role === 'menuitem'); },
  });
  const menu = node('div'), map = node('canvas'); menu.hidden = true;
  const c = {
    el: node, button: (label, action, cls) => { const control = node('button', label, cls); control.addEventListener('click', action); return control; },
    chunkId: 'one', world: { cacheWalking: { topology: new Map() } },
    disposals: 0, disposeChunkNotes() { c.disposals++; },
    $: id => ({ 'map-menu': menu, 'map-hover': map })[id],
  };
  runInContext(source + '\ncreateScreenChunks(c);', createContext({
    c, document, createScreenChunkNotes() {}, createScreenChunkColours() {},
  }));
  const changes = [], renders = [];
  const tabs = ['contents', 'tasks', 'note'].map(id => ({ id, label: id === 'note' ? 'Note ●' : id,
    ...(id === 'note' ? { accessibleLabel: 'Note (saved note)' } : {}),
    render: () => { renders.push(id); return node('p', `${id} content`); },
  }));
  const wrap = c.tabStrip(tabs, 'tasks', id => changes.push(id));
  const [bar, panel] = wrap.children;
  return { c, tabs, wrap, bar, panel, menu, map, document, node, changes, renders, focused: () => focused };
}

test('chunk tabs have a named list, one selected stop, and a labelled controlled panel', () => {
  const h = fixture();
  assert.equal(h.bar.attributes.role, 'tablist');
  assert.equal(h.bar.attributes['aria-label'], 'Chunk information');
  assert.equal(h.panel.attributes.role, 'tabpanel');
  assert.equal(h.panel.tabIndex, 0);
  assert.equal(h.panel.attributes['aria-labelledby'], h.bar.children[1].id);
  assert.deepEqual(h.bar.children.map(button => button.tabIndex), [-1, 0, -1]);
  assert.deepEqual(h.bar.children.map(button => button.attributes['aria-selected']), ['false', 'true', 'false']);
  for (const button of h.bar.children) assert.equal(button.attributes['aria-controls'], h.panel.id);
  assert.equal(h.bar.children[2].attributes['aria-label'], 'Note (saved note)');
  assert.equal(h.panel.children[0].textContent, 'tasks content');
});

test('chunk arrows wrap, Home and End select and focus without replacing tab buttons', () => {
  const h = fixture(), buttons = [...h.bar.children];
  const key = (index, name, expected) => {
    let prevented = false;
    buttons[index].emit('keydown', { key: name, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.focused(), buttons[expected]);
    assert.equal(h.panel.attributes['aria-labelledby'], buttons[expected].id);
    assert.equal(h.panel.children[0].textContent, `${h.tabs[expected].id} content`);
    assert.deepEqual(h.bar.children, buttons);
    assert.equal(buttons.filter(button => button.tabIndex === 0).length, 1);
  };
  key(1, 'ArrowRight', 2); key(2, 'ArrowRight', 0); key(0, 'ArrowLeft', 2);
  key(2, 'Home', 0); key(0, 'End', 2);
  assert.deepEqual(h.changes, ['tasks', 'note', 'contents', 'note', 'contents', 'note']);
  const before = h.renders.length;
  buttons[2].emit('keydown', { key: 'Tab', preventDefault() { assert.fail('Tab must retain native navigation'); } });
  assert.equal(h.renders.length, before);
});

test('click updates relationships and separate tab strips use distinct IDs', () => {
  const h = fixture(); h.bar.children[0].emit('click');
  assert.equal(h.bar.children[0].attributes['aria-selected'], 'true');
  assert.equal(h.panel.attributes['aria-labelledby'], h.bar.children[0].id);
  const second = h.c.tabStrip(h.tabs, 'missing', () => {});
  assert.notEqual(second.children[1].id, h.panel.id);
  assert.equal(second.children[0].children[0].tabIndex, 0);
});

test('chunk menu keys wrap among enabled menu items including Wiki links', () => {
  const h = fixture();
  const items = ['button', 'button', 'a'].map(tag => { const item = h.node(tag); item.setAttribute('role', 'menuitem'); return item; });
  items[1].disabled = true; h.menu.append(...items); h.menu.hidden = false; items[0].focus();
  const key = (name, expected) => {
    let prevented = false;
    h.menu.emit('keydown', { key: name, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.focused(), items[expected]);
  };
  key('ArrowDown', 2); key('ArrowDown', 0); key('ArrowUp', 2); key('Home', 0); key('End', 2);
  h.menu.emit('keydown', { key: 'Enter', preventDefault() { assert.fail('native activation must remain'); } });
  assert.equal(h.focused(), items[2]);
});

test('closing a menu restores its opener only when it still owns focus, with map fallback', () => {
  const h = fixture(), opener = h.node('button'), item = h.node('button');
  h.menu.hidden = false; h.menu.append(item); h.c.chunkMenuReturnFocus = opener; item.focus();
  h.c.closeChunkMenu(); assert.equal(h.focused(), opener); assert.equal(h.menu.hidden, true); assert.equal(h.menu.children.length, 0);
  h.menu.hidden = false; h.menu.append(item); h.c.chunkMenuReturnFocus = opener; opener.isConnected = false; item.focus();
  h.c.closeChunkMenu(); assert.equal(h.focused(), h.map);
  h.menu.hidden = false; h.menu.append(item); h.c.chunkMenuReturnFocus = h.map; opener.isConnected = true; opener.focus();
  h.c.closeChunkMenu(); assert.equal(h.focused(), opener, 'outside pointer focus stays outside');
});

test('backlog reason dialog preserves optional reasons, owner, cancellation and refused-save drafts', async () => {
  const h = fixture(), calls = [];
  const taskSource = (await readFile(new URL('../app/web/screen-tasks.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const c = {
    el: h.node, button: h.c.button, input: type => { const node = h.node('input'); node.type = type; return node; },
    member: () => ({ name: 'Player', taskStatus: {} }), memberId: 'actor1', canWrite: () => false, preferences: () => ({}),
    plain: value => value.replace(/<[^>]*>/g, ''), sandbox: { isNewTask: () => false },
    state: { members: [] }, taskPins: () => [], appendCustomTaskEdit() {},
    iconButton: label => { const node = h.node('button'); node.setAttribute('aria-label', label); return node; },
    command: async command => calls.push(command),
  };
  const dialog = h.node('dialog'), content = h.node('div'), errors = [];
  let generation = 0;
  c.openDialog = (title, form) => { dialog.title = title; dialog.open = true; content.replaceChildren(form); return ++generation; };
  c.dialogCurrent = value => dialog.open && value === generation;
  c.closeDialog = value => { if (c.dialogCurrent(value)) { dialog.open = false; content.replaceChildren(); } };
  c.showError = error => errors.push(error);
  runInContext(taskSource + '\ncreateScreenTasks(c);', createContext({
    c, document: h.document, createTaskClaimClock: () => ({}),
    createTaskIconPainter: () => ({ append() {} }), appendTaskPin() {}, appendTaskWhy() {}, appendTaskHow() {}, isCustomTask: () => false,
  }));
  c.taskFacts = () => ({ personal: false, group: false }); c.hoverTasks = () => ({ attach() {} });
  // Viewers see a completion status instead of a completion control.
  const row = c.taskRow({ id: 'one', label: '<b>Mine copper</b>', status: 'blocked' }), status = row.children[0];
  assert.equal(status.tagName, 'SPAN'); assert.equal(status.className, 'task-completion-status'); assert.equal(status.textContent, 'Not done');
  assert.equal(row.children.some(child => child.tagName === 'INPUT'), false); assert.equal(calls.length, 0);
  c.canWrite = () => true;
  const host = h.node('div'), trigger = h.node('button'), fallback = h.node('button');
  host.querySelector = selector => selector.startsWith(':scope') ? undefined : fallback;
  trigger.focus(); c.backlogForm(host, { id: 'one', label: 'Mine copper' });
  assert.equal(dialog.title, 'Backlog task'); assert.equal(dialog.open, true);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const form = () => content.children[0];
  const find = (tag, text) => walk(form()).find(node => node.tagName === tag && node.textContent === text);
  const radios = () => walk(form()).filter(node => node.type === 'radio');
  const reason = () => walk(form()).find(node => node.type === 'text');
  const submit = () => form().emit('submit', { preventDefault() {} });
  assert.deepEqual(radios().map(node => node.value), ['', 'Later', 'Need progress', 'Task looks wrong', 'Other']);
  assert.equal(h.focused(), radios()[0]); assert.equal(radios()[0].checked, true);
  find('BUTTON', 'Cancel').emit('click'); assert.equal(dialog.open, false); assert.equal(h.focused(), trigger);
  trigger.focus(); c.backlogForm(host, { id: 'one', label: 'Mine copper' });
  trigger.isConnected = false;
  let prevented = false, stopped = false;
  form().emit('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.equal(dialog.open, false); assert.equal(h.focused(), fallback); assert.equal(calls.length, 0);
  const task = { id: 'one', label: 'Mine copper' };
  for (const preset of ['', 'Later', 'Need progress', 'Task looks wrong', 'Other']) {
    c.backlogForm(host, task, undefined, 'actor2');
    for (const radio of radios()) radio.checked = radio.value === preset;
    await submit();
    assert.equal(calls.at(-1).memberId, 'actor2'); assert.equal(calls.at(-1).taskId, 'one');
    assert.equal(calls.at(-1).type, 'set-task-status'); assert.equal(calls.at(-1).backlogged, true);
    assert.equal(calls.at(-1).backlogReason, preset); assert.equal(dialog.open, false);
  }
  c.backlogForm(host, task); reason().value = '  Wait for supplies  '; await submit();
  assert.equal(calls.at(-1).backlogReason, 'Wait for supplies');
  const refused = new Error('Save refused'); c.command = async () => { throw refused; };
  c.backlogForm(host, task, undefined, 'actor2');
  for (const radio of radios()) radio.checked = radio.value === 'Task looks wrong';
  reason().value = 'Check this method'; await submit();
  assert.equal(dialog.open, true); assert.equal(find('BUTTON', 'Backlog').disabled, false); assert.deepEqual(errors, [refused]);
  c.closeDialog(generation); c.backlogForm(host, task, undefined, 'actor2');
  assert.equal(reason().value, 'Check this method'); assert.equal(radios().find(node => node.checked).value, 'Task looks wrong');
  c.command = async command => calls.push(command); await submit();
  assert.equal(calls.at(-1).backlogReason, 'Task looks wrong: Check this method');
  c.backlogForm(host, task, undefined, 'actor2'); assert.equal(reason().value, '');
  find('BUTTON', 'Cancel').emit('click');
});
