import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenDialogs, keepDialogFocusVisible } from '../app/web/screen-dialogs.mjs';
import { handleScreenEscape } from '../app/web/screen-controls.mjs';
import { createHelperView } from '../app/web/helper.mjs';

class Node extends EventTarget {
  constructor() { super(); this.isConnected = true; this.open = false; this.children = []; this.dataset = {}; this.attributes = {}; this.classes = new Set(); this.classList = { contains: key => this.classes.has(key), toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key) }; }
  replaceChildren(...nodes) { this.children = nodes; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  closest(selector) { return selector === 'details:not([open])' ? this.closedMenu : this.hiddenAncestor; }
  focus() { this.document.activeElement = this; }
  show() { this.open = true; this.modal = false; this.focus(); }
  showModal() { this.open = true; this.modal = true; this.focus(); }
  close() { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close'))); }
}

function dialogs(t) {
  const previous = globalThis.document, dialog = new Node(), header = new Node(), canvas = new Node(), opener = new Node();
  const document = { activeElement: opener, querySelector: () => header };
  for (const node of [dialog, header, canvas, opener]) node.document = document;
  globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const nodes = { 'tool-dialog': dialog, 'dialog-title': new Node(), 'dialog-content': new Node(), 'map-hover': canvas };
  const c = { $: id => nodes[id], dialogGeneration: 0, duoHovers: new Map() };
  createScreenDialogs(c); c.bindDialogLifecycle();
  return { c, document, dialog, opener, canvas, nodes };
}

test('modal and modeless tools return focus to their opener on close', async t => {
  const h = dialogs(t);
  for (const title of ['History', 'Search']) {
    h.opener.focus(); h.c.openDialog(title); assert.equal(h.document.activeElement, h.dialog);
    h.c.closeDialog(); await Promise.resolve(); assert.equal(h.document.activeElement, h.opener);
  }
});

test('tools opened from a closed menu return focus to its visible summary', async t => {
  const h = dialogs(t), summary = new Node(); summary.document = h.document;
  h.opener.closedMenu = { querySelector: () => summary };
  h.c.openDialog('Settings'); h.c.closeDialog(); await Promise.resolve();
  assert.equal(h.document.activeElement, summary);
});

test('removed or hidden openers fall back to the accessible map control', async t => {
  const h = dialogs(t);
  for (const invalid of ['removed', 'hidden']) {
    h.opener.isConnected = invalid !== 'removed'; h.opener.hiddenAncestor = invalid === 'hidden' ? {} : undefined;
    h.document.activeElement = h.opener; h.c.openDialog('Task details'); h.c.closeDialog(); await Promise.resolve();
    assert.equal(h.document.activeElement, h.canvas);
  }
});

test('replacing Search with a modal preserves the original opener and ignores queued close events', async t => {
  const h = dialogs(t);
  h.c.openDialog('Search'); h.c.openDialog('Task details'); await Promise.resolve();
  assert.equal(h.dialog.open, true); assert.equal(h.document.activeElement, h.dialog);
  h.c.closeDialog(); await Promise.resolve(); assert.equal(h.document.activeElement, h.opener);
});

test('initial page focus uses the map fallback instead of returning to body', async t => {
  const h = dialogs(t); h.document.body = h.opener;
  h.c.openDialog('Search'); h.c.closeDialog(); await Promise.resolve();
  assert.equal(h.document.activeElement, h.canvas);
});

test('removed task openers fall back to task search and hidden map falls back to the chosen phone tab', async t => {
  const h = dialogs(t), taskSearch = new Node(), phoneTab = new Node();
  for (const node of [taskSearch, phoneTab]) node.document = h.document;
  h.nodes['task-filter'] = taskSearch; h.nodes['phone-tab-tasks'] = phoneTab;
  h.opener.closest = selector => selector === '.task-sidebar' ? {} : undefined;
  h.c.openDialog('Task details'); h.opener.isConnected = false; h.c.closeDialog(); await Promise.resolve();
  assert.equal(h.document.activeElement, taskSearch);
  h.document.activeElement = h.document.body = new Node(); h.document.body.document = h.document;
  h.document.documentElement = { dataset: { phoneTab: 'tasks' } }; h.canvas.hiddenAncestor = {};
  h.c.openDialog('Search'); h.c.closeDialog(); await Promise.resolve();
  assert.equal(h.document.activeElement, phoneTab);
});

test('Escape closes a tool over Helper and leaves Helper open until the next press', async t => {
  const previous = globalThis.document, document = new EventTarget(), elements = new Map();
  globalThis.document = document; t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  document.createElement = () => { const node = new Node(); node.document = document; return node; };
  const workspace = document.createElement(), launch = document.createElement(), dialog = document.createElement();
  document.head = document.createElement(); workspace.after = page => { elements.set('helper-page', page); };
  const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
  document.getElementById = id => elements.get(id) ?? [...elements.values()].flatMap(descendants).find(node => node.id === id);
  document.querySelector = () => workspace;
  elements.set('helper-open', launch); elements.set('tool-dialog', dialog);
  for (const [id, value] of [['map-menu', { hidden: true }], ['chunk-info', { hidden: true }]]) elements.set(id, value);
  const c = { $: id => elements.get(id), closeDialog: () => dialog.close(), stickerPicker: { isOpen: () => false } };
  document.addEventListener('keydown', event => handleScreenEscape(c, event));
  const helper = createHelperView({ document, api: async () => ({}), getState: () => ({ revision: 1, members: [{ id: 'actor1', name: 'Player' }] }), getMemberId: () => 'actor1', getResult: () => undefined });
  t.after(() => helper.close()); helper.open(); dialog.open = true;
  const press = () => { const event = new Event('keydown', { cancelable: true }); event.key = 'Escape'; document.dispatchEvent(event); return event; };
  assert.equal(press().defaultPrevented, true); assert.equal(dialog.open, false); assert.equal(elements.get('helper-page').hidden, false);
  assert.equal(press().defaultPrevented, true); assert.equal(elements.get('helper-page').hidden, true);
});

function escapeFixture() {
  const calls = [], summary = { focus: () => calls.push('summary') };
  const nodes = { 'tool-dialog': { open: true }, 'map-menu': { hidden: false }, 'map-hover': { focus: () => calls.push('map focus') },
    'info-tools': { open: true, querySelector: () => summary }, 'more-tools': { open: false }, 'chunk-info': { hidden: false }, 'chunk-close': { click: () => { calls.push('chunk'); nodes['chunk-info'].hidden = true; } } };
  let sticker = true, display = true;
  const c = { $: id => nodes[id], closeDialog: () => { calls.push('dialog'); nodes['tool-dialog'].open = false; },
    closeChunkMenu: () => { calls.push('menu'); nodes['map-menu'].hidden = true; },
    stickerPicker: { isOpen: () => sticker, close: options => { assert.equal(options.restoreFocus, true); calls.push('sticker'); sticker = false; } },
    mapDisplay: { isOpen: () => display, close: () => { calls.push('display'); display = false; } } };
  const press = () => { const event = { key: 'Escape', target: { tagName: 'INPUT' }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; handleScreenEscape(c, event); return event; };
  return { c, calls, press };
}

test('Escape dismisses one foremost tool at a time without closing the surfaces behind it', () => {
  const h = escapeFixture();
  const expected = [['dialog'], ['dialog','sticker'], ['dialog','sticker','summary'], ['dialog','sticker','summary','display'], ['dialog','sticker','summary','display','menu','map focus'], ['dialog','sticker','summary','display','menu','map focus','chunk']];
  for (const calls of expected) { assert.equal(h.press().defaultPrevented, true); assert.deepEqual(h.calls, calls); }
  assert.equal(h.press().defaultPrevented, false);
});

test('Escape already handled by a nested picker does not dismiss its parent', () => {
  const h = escapeFixture(); handleScreenEscape(h.c, { key: 'Escape', defaultPrevented: true }); assert.deepEqual(h.calls, []);
});


test('a dialog result hands focus to its destination when it closes', async t => {
  const h = dialogs(t), destination = new Node(); destination.document = h.document;
  h.c.openDialog('Search');
  h.c.closeDialog(h.c.dialogGeneration, { focusTarget: destination });
  await Promise.resolve(); assert.equal(h.document.activeElement, destination);
  // The destination must not leak into the next ordinary dialog lifecycle.
  h.opener.focus(); h.c.openDialog('Settings'); h.c.closeDialog();
  await Promise.resolve(); assert.equal(h.document.activeElement, h.opener);
});

test('a stale dialog close cannot change the current focus destination', async t => {
  const h = dialogs(t), stale = new Node(); stale.document = h.document;
  const generation = h.c.openDialog('Search'); h.c.openDialog('Settings');
  h.c.closeDialog(generation, { focusTarget: stale });
  assert.equal(h.dialog.open, true);
  await Promise.resolve(); // Discard the queued Search → modal close while it is open.
  h.c.closeDialog(); await Promise.resolve();
  assert.equal(h.document.activeElement, h.opener);
});


test('F4 phone map names a region with semantics that allow naming', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
  const dock = html.match(/<[^>]+class="map-dock"[^>]*>/)?.[0];
  assert.ok(dock); assert.match(dock, /role="region"/); assert.match(dock, /aria-label="Map information"/);
});

test('F4 Completed Tasks review is outside its interactive summary', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
  const details = html.match(/<details id="completed-details">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(details); assert.doesNotMatch(details.match(/<summary>([\s\S]*?)<\/summary>/)[1], /<(?:button|input|a)\b/);
  assert.match(details, /<button id="completed-review"/);
});


test('dialog focus reveals a whole control after native caret scrolling and progressive detail reflow', () => {
  const dialog = new EventTarget(); dialog.open = true;
  let frame, mutation, resize, box = { top: 190, bottom: 265, height: 75 };
  const active = { getBoundingClientRect: () => box };
  const content = { clientTop: 1, clientHeight: 160, scrollTop: 100, contains: node => node === active, getBoundingClientRect: () => ({ top: 60 }) };
  const document = { activeElement: active, querySelector: () => ({}) };
  const view = { requestAnimationFrame: callback => { assert.equal(frame, undefined); frame = callback; },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} } };
  const flush = () => { const callback = frame; frame = undefined; callback(); };
  keepDialogFocusVisible({ document, dialog, content, view });
  dialog.dispatchEvent(new Event('focusin')); mutation(); resize(); flush();
  assert.equal(content.scrollTop, 144); assert.equal(document.activeElement, active);
  box = { top: 35, bottom: 79, height: 44 }; mutation(); flush();
  assert.equal(content.scrollTop, 118);
  box = { top: 190, bottom: 234, height: 44 }; resize(); flush();
  assert.equal(content.scrollTop, 131);
  box = { top: 70, bottom: 114, height: 44 }; dialog.dispatchEvent(new Event('focusin')); flush();
  assert.equal(content.scrollTop, 131);
  dialog.open = false; mutation(); flush(); assert.equal(content.scrollTop, 131);
  dialog.open = true; document.activeElement = {}; resize(); flush(); assert.equal(content.scrollTop, 131);
});
