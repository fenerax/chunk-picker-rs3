import test from 'node:test';
import assert from 'node:assert/strict';
import { createStickerPicker, bindStickerFlyout } from '../app/web/sticker-picker.mjs';

// Model focus, capture/bubble events, geometry and detached DOM nodes so the
// tests exercise the actual picker together with its menu event boundary.
class Node {
  constructor(tag, text, className, document) {
    Object.assign(this, { tag, textContent: text, className, ownerDocument: document, children: [], listeners: [], attributes: {}, style: {}, value: '', hidden: false, disabled: false });
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  addEventListener(type, handler, capture = false) { this.listeners.push({ type, handler, capture: capture === true }); }
  removeEventListener(type, handler, capture = false) { this.listeners = this.listeners.filter(item => item.type !== type || item.handler !== handler || item.capture !== (capture === true)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange() {}
  get lastChild() { return this.children.at(-1); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) { return this.all().filter(node => selector === 'input[type=search]' ? node.tag === 'input' && node.type === 'search' : selector === 'button[aria-label]' ? node.tag === 'button' && node.attributes['aria-label'] : node.tag === selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  get offsetWidth() { return Math.min(this.width ?? 284, parseFloat(this.style.maxWidth) || Infinity); }
  get offsetHeight() { return Math.min(this.height ?? 420, parseFloat(this.style.maxHeight) || Infinity); }
  getBoundingClientRect() {
    const left = this.left ?? (this.parent?.getBoundingClientRect().left ?? 0) + (parseFloat(this.style.left) || 0);
    const top = this.top ?? (this.parent?.getBoundingClientRect().top ?? 0) + (parseFloat(this.style.top) || 0);
    const width = this.offsetWidth, height = this.offsetHeight;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  dispatch(type, fields = {}) {
    const path = []; for (let node = this; node; node = node.parent) path.push(node);
    const event = { type, target: this, relatedTarget: null, stopped: false, defaultPrevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...fields };
    const invoke = (node, capture) => { for (const item of [...node.listeners]) if (item.type === type && item.capture === capture) item.handler(event); };
    for (const node of [...path].reverse()) { invoke(node, true); if (event.stopped) return event; }
    // pointerenter/leave do not bubble in the browser.
    for (const node of ['pointerenter', 'pointerleave'].includes(type) ? [this] : path) { invoke(node, false); if (event.stopped) break; }
    return event;
  }
  click() { if (!this.disabled) { this.dispatch('pointerdown'); this.focus(); return this.dispatch('click'); } }
}
function fixture(t, { width = 1000, height = 700, viewportHeight = height, menuLeft = 30, menuTop = 60 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const document = { activeElement: null };
  document.defaultView = Object.assign(new Node('window', '', '', document), { innerWidth: width, innerHeight: viewportHeight });
  const el = (tag, text, cls) => new Node(tag, text, cls, document);
  const root = el('document'), host = el('div'), menu = el('div'), trigger = el('button', 'Sticker ▸', 'sticker-action');
  Object.assign(host, { width, height, left: 0, top: 0 });
  Object.assign(menu, { left: menuLeft, top: menuTop, width: 210, height: 240 });
  Object.assign(trigger, { left: menuLeft + 5, top: menuTop + 180, width: 200, height: 34 });
  root.append(host); host.append(menu); menu.append(trigger); trigger.focus();
  let owner = 'actor1';
  const state = { revision: 9, members: [{ id: 'actor1', stickers: {}, preferences: {} }, { id: 'reed', stickers: {}, preferences: {} }] };
  const writes = [], errors = [], full = [];
  const picker = createStickerPicker({ el, host, button: (text, action, cls) => { const node = el('button', text, cls); node.addEventListener('click', action); return node; },
    state: () => state, memberId: () => owner, member: () => state.members.find(member => member.id === owner),
    world: () => ({ chunks: new Map([['101', { name: 'Wendlewick' }]]) }), showError: error => errors.push(error), openFullDialog: id => full.push(id),
    command(payload, revision) { let resolve, reject; const pending = new Promise((yes, no) => { resolve = yes; reject = no; }); writes.push({ payload, revision, resolve, reject }); return pending; },
  });
  const flyout = bindStickerFlyout({ picker, trigger, menu, chunkId: '101', closeMenu: () => { menu.hidden = true; flyout.destroy(); } });
  // Same outside-click rule as main.mjs: popup is a sibling of the menu.
  root.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) { menu.hidden = true; flyout.destroy(); } });
  const labelled = label => picker.element.all().find(node => node.attributes['aria-label'] === label);
  const text = value => picker.element.all().find(node => node.textContent === value);
  return { document, host, menu, trigger, picker, flyout, state, writes, errors, full, labelled, text, switchOwner: value => { owner = value; } };
}
const flush = () => new Promise(resolve => queueMicrotask(resolve));

test('hover opens beside the menu without moving keyboard focus or closing its parent', t => {
  const ui = fixture(t); ui.trigger.dispatch('pointerenter');
  assert.equal(ui.picker.isOpen(), true); assert.equal(ui.menu.hidden, false);
  assert.equal(ui.document.activeElement, ui.trigger);
  assert.equal(ui.trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(ui.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.picker.element.getBoundingClientRect().left, ui.menu.getBoundingClientRect().right + 4);
});

test('pointer crosses the gap into the flyout and only dismisses after leaving both surfaces', t => {
  const ui = fixture(t); ui.trigger.dispatch('pointerenter');
  ui.menu.dispatch('pointerleave'); t.mock.timers.tick(180);
  assert.equal(ui.picker.isOpen(), true);
  ui.picker.element.dispatch('pointerenter'); t.mock.timers.tick(500);
  assert.equal(ui.picker.isOpen(), true);
  ui.picker.element.dispatch('pointerleave', { relatedTarget: ui.menu }); t.mock.timers.tick(500);
  assert.equal(ui.picker.isOpen(), true);
  ui.picker.element.dispatch('pointerleave'); t.mock.timers.tick(261);
  assert.equal(ui.picker.isOpen(), false); assert.equal(ui.menu.hidden, false);
  assert.equal(ui.trigger.getAttribute('aria-expanded'), 'false');
});

test('ArrowRight and Enter open; Escape and ArrowLeft return focus and stop parent dismissal', t => {
  const ui = fixture(t);
  for (const [openKey, closeKey] of [['ArrowRight', 'Escape'], ['Enter', 'ArrowLeft']]) {
    const openEvent = ui.trigger.dispatch('keydown', { key: openKey });
    assert.equal(openEvent.defaultPrevented, true);
    assert.equal(ui.document.activeElement, ui.labelled('Search stickers'));
    const closeEvent = ui.document.activeElement.dispatch('keydown', { key: closeKey });
    assert.equal(closeEvent.stopped, true); assert.equal(closeEvent.defaultPrevented, true);
    assert.equal(ui.picker.isOpen(), false); assert.equal(ui.document.activeElement, ui.trigger);
    assert.equal(ui.menu.hidden, false);
  }
});

test('hovered flyout consumes Escape and ArrowLeft while another menu item retains focus', t => {
  const ui = fixture(t), details = new Node('button', 'Chunk details', '', ui.document);
  ui.menu.append(details);
  let parentDismissals = 0;
  ui.host.addEventListener('keydown', event => { if (event.key === 'Escape') parentDismissals++; });
  for (const key of ['Escape', 'ArrowLeft']) {
    details.focus(); ui.trigger.dispatch('pointerenter');
    assert.equal(ui.document.activeElement, details, 'hover preserves the initial menu focus');
    const event = details.dispatch('keydown', { key });
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(ui.picker.isOpen(), false); assert.equal(ui.menu.hidden, false);
    assert.equal(ui.document.activeElement, ui.trigger); assert.equal(parentDismissals, 0);
  }
});

test('click opens and catalogue pointerdown stays inside the menu interaction; close button restores focus', t => {
  const ui = fixture(t); ui.trigger.click();
  assert.equal(ui.document.activeElement, ui.labelled('Search stickers'));
  const event = ui.labelled('Add heart').dispatch('pointerdown');
  assert.equal(event.stopped, true); assert.equal(ui.menu.hidden, false); assert.equal(ui.picker.isOpen(), true);
  ui.labelled('Close sticker picker').click();
  assert.equal(ui.picker.isOpen(), false); assert.equal(ui.document.activeElement, ui.trigger);
});

test('flyout flips left at the right edge and fits a 390px viewport including its lower edge', t => {
  const ui = fixture(t, { menuLeft: 730, menuTop: 440 }); ui.trigger.dispatch('pointerenter');
  const box = ui.picker.element.getBoundingClientRect();
  assert.equal(box.right, ui.menu.getBoundingClientRect().left - 4); assert.ok(box.bottom <= 692);
  ui.flyout.destroy(); t.mock.timers.reset();
  const narrow = fixture(t, { width: 390, height: 900, viewportHeight: 700, menuLeft: 170, menuTop: 440 });
  narrow.trigger.dispatch('pointerenter'); const mobile = narrow.picker.element.getBoundingClientRect();
  assert.ok(mobile.left >= 8 && mobile.right <= 382); assert.ok(mobile.top >= 8 && mobile.bottom <= 692);
  assert.equal(narrow.labelled('Search stickers').style.fontSize, 'var(--type-input-mobile)');
});

test('catalogue rerenders remain anchored and opening by hover preserves the owner and reviewed revision', async t => {
  const ui = fixture(t); ui.trigger.dispatch('pointerenter'); ui.switchOwner('reed');
  ui.labelled('Add heart').click();
  assert.deepEqual(ui.writes[0].payload, { type: 'add-sticker', memberId: 'actor1', chunkId: '101', sticker: { type: 'heart', color: '#f5c451', text: '' } });
  assert.equal(ui.writes[0].revision, 9); assert.equal(ui.labelled('Add heart').disabled, true);
  ui.state.members[0].stickers['101'] = [{ id: 'heart-one', ...ui.writes[0].payload.sticker }]; ui.state.revision = 10;
  ui.writes[0].resolve({ state: ui.state }); await flush();
  assert.equal(ui.picker.isOpen(), true); assert.equal(ui.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.picker.element.getBoundingClientRect().left, ui.menu.getBoundingClientRect().right + 4);
  ui.labelled('Add skull').click(); assert.equal(ui.writes[1].revision, 10);
  ui.writes[1].reject(new Error('Save failed')); await flush();
  assert.equal(ui.errors.length, 1); assert.equal(ui.labelled('Add skull').disabled, false);
});

test('destroy cancels delayed hover and detaches listeners without intercepting the panel picker', t => {
  const ui = fixture(t); ui.trigger.dispatch('pointerenter'); ui.menu.dispatch('pointerleave'); ui.flyout.destroy();
  assert.equal(ui.picker.isOpen(), false); assert.equal(ui.trigger.listeners.length, 0);
  ui.picker.open('101', { x: 80, y: 90 }); t.mock.timers.tick(300);
  assert.equal(ui.picker.isOpen(), true); assert.equal(ui.document.activeElement, ui.labelled('Search stickers'));
  assert.equal(ui.picker.element.dispatch('pointerdown').stopped, false);
});

test('Label & more ends the submenu session and preserves the full editor chunk', t => {
  const ui = fixture(t); ui.trigger.click(); ui.text('Label & more…').click();
  assert.deepEqual(ui.full, ['101']); assert.equal(ui.picker.isOpen(), false);
  assert.equal(ui.menu.hidden, true);
  assert.equal(ui.trigger.getAttribute('aria-expanded'), 'false');
});

test('viewport resizing clamps the open catalogue and releases the resize listener on teardown', t => {
  const ui = fixture(t, { menuLeft: 730 }); ui.trigger.dispatch('pointerenter');
  ui.document.defaultView.innerWidth = 390; ui.document.defaultView.dispatch('resize');
  const box = ui.picker.element.getBoundingClientRect();
  assert.ok(box.left >= 8 && box.right <= 382);
  ui.flyout.destroy(); assert.equal(ui.document.defaultView.listeners.length, 0);
});

test('a direct panel picker replaces the submenu and survives parent-menu teardown', t => {
  const ui = fixture(t); ui.trigger.dispatch('pointerenter'); ui.menu.dispatch('pointerleave');
  ui.picker.open('101', { x: 80, y: 90 });
  assert.equal(ui.trigger.getAttribute('aria-expanded'), 'false');
  ui.flyout.destroy(); t.mock.timers.tick(300);
  assert.equal(ui.picker.isOpen(), true);
  assert.equal(ui.document.activeElement, ui.labelled('Search stickers'));
});
