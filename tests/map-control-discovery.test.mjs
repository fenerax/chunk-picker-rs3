import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapControlDiscovery, mountMembersStartEntry } from '../app/web/map-control-discovery.mjs';
import { createScreenRoll } from '../app/web/screen-roll.mjs';
import { handleScreenEscape } from '../app/web/screen-controls.mjs';

class Node {
  constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  append(node) { this.insertBefore(node, null); }
  insertBefore(node, next) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node); node.parentNode = this;
  }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  emit(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
  setAttribute(name, value) { this.attributes[name] = value; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.focused = true; }
}

function fixture() {
  const ids = ['phone-map-actions', 'phone-legend-open', 'phone-legend-sheet', 'phone-legend-content',
    'phone-legend-close', 'phone-map-controls', 'phone-undo-host', 'legend-details', 'undo'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node()]));
  const toolbar = new Node(), history = new Node(), ownUndo = new Node(), sandbox = new Node(), home = new Node(), hint = new Node();
  toolbar.append(history); toolbar.append(sandbox); history.append(nodes.undo); history.append(ownUndo);
  home.append(nodes['legend-details']); home.append(hint); nodes['legend-details'].open = false;
  nodes['phone-legend-sheet'].append(nodes['phone-legend-content']); nodes['phone-legend-sheet'].hidden = true;
  nodes['phone-map-actions'].append(nodes['phone-undo-host']);
  toolbar.scrollLeft = 0; toolbar.clientWidth = 300; toolbar.scrollWidth = 1000;
  toolbar.scrollTo = ({ left }) => { toolbar.scrollLeft = Math.max(0, Math.min(700, left)); toolbar.emit('scroll'); };
  const document = new Node(); document.querySelector = () => toolbar;
  const media = new Node(); media.matches = true;
  const c = { $: id => nodes[id], closeChunkMenu() {}, mapDisplay: { close() {} } };
  const controller = createMapControlDiscovery(c, { document, media }); controller.mount();
  return { nodes, toolbar, history, ownUndo, sandbox, home, hint, document, media, c, controller };
}

test('phone Legend displays the live key and its controls, preserving its home and disclosure state', () => {
  const h = fixture(), legend = h.nodes['legend-details'], layer = new Node();
  let changes = 0; layer.addEventListener('change', () => changes++); legend.append(layer);
  h.controller.open();
  assert.equal(legend.parentNode, h.nodes['phone-legend-content']);
  assert.equal(legend.open, true); assert.equal(h.nodes['phone-legend-sheet'].hidden, false);
  assert.equal(h.nodes['phone-legend-open'].attributes['aria-expanded'], 'true');
  assert.equal(h.nodes['phone-legend-close'].focused, true);
  layer.emit('change'); assert.equal(changes, 1);
  h.controller.close({ restoreFocus: true });
  assert.deepEqual(h.home.children, [legend, h.hint]); assert.equal(legend.open, false);
  assert.equal(h.nodes['phone-legend-open'].focused, true);
  legend.open = true; h.controller.open(); h.controller.close(); assert.equal(legend.open, true);
});

test('the same Undo stays reachable on phone and returns to its original desktop position', () => {
  const h = fixture(); let undos = 0; h.nodes.undo.addEventListener('click', () => undos++);
  assert.equal(h.nodes.undo.parentNode, h.nodes['phone-undo-host']);
  assert.deepEqual(h.history.children, [h.ownUndo]);
  h.nodes.undo.emit('click'); assert.equal(undos, 1);
  h.controller.open(); h.media.matches = false; h.media.emit('change');
  assert.deepEqual(h.history.children, [h.nodes.undo, h.ownUndo]);
  assert.equal(h.nodes['phone-map-actions'].hidden, true); assert.equal(h.controller.isOpen(), false);
  assert.deepEqual(h.home.children, [h.nodes['legend-details'], h.hint]);
  h.media.matches = true; h.media.emit('change'); h.controller.mount();
  assert.equal(h.nodes.undo.parentNode, h.nodes['phone-undo-host']);
  assert.equal(h.nodes['phone-map-controls'].listeners.click.length, 1);
});

test('More controls advances through the unchanged toolbar and can return to its beginning', () => {
  const h = fixture(), more = h.nodes['phone-map-controls'];
  more.emit('click'); assert.equal(h.toolbar.scrollLeft, 240);
  more.emit('click'); more.emit('click'); assert.equal(h.toolbar.scrollLeft, 700);
  assert.equal(more.textContent, 'First controls'); more.emit('click');
  assert.equal(h.toolbar.scrollLeft, 0); assert.equal(more.textContent, 'More controls');
});

test('outside interaction and Escape dismiss the legend without dismissing map display underneath', () => {
  const h = fixture(); h.controller.open();
  h.document.emit('pointerdown', { target: h.nodes['phone-legend-content'] }); assert.equal(h.controller.isOpen(), true);
  h.document.emit('pointerdown', { target: h.toolbar }); assert.equal(h.controller.isOpen(), false);
  h.controller.open();
  const c = { ...h.c, $: id => id === 'tool-dialog' ? { open: false } : undefined,
    stickerPicker: { isOpen: () => false }, mapControlDiscovery: h.controller,
    mapDisplay: { isOpen: () => true, close: () => assert.fail('Map display must remain open') } };
  let prevented = false;
  handleScreenEscape(c, { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.controller.isOpen(), false);
});

test('Ready for members follows the existing capability seam and rechecks writer and sandbox access', async () => {
  const entry = new Node(); let writable = true, available = true, reviews = 0;
  const c = { $: () => entry, canWrite: () => writable, panelContext: {
    membersStart: () => { reviews++; }, membersStartAvailable: () => available }, showError: assert.fail };
  const control = mountMembersStartEntry(c);
  entry.emit('click'); await new Promise(setImmediate); assert.equal(reviews, 1);
  available = false; entry.emit('click'); await new Promise(setImmediate);
  assert.equal(reviews, 1); assert.equal(entry.disabled, true);
  available = true; writable = false; control.refresh();
  assert.equal(entry.hidden, true); entry.emit('click'); await new Promise(setImmediate); assert.equal(reviews, 1);
  writable = true; delete c.panelContext.membersStart; control.refresh();
  assert.equal(entry.hidden, true); entry.emit('click'); await new Promise(setImmediate); assert.equal(reviews, 1);
});

test('roll labels follow the selected player while two choices remain one player’s choices', () => {
  const nodes = Object.fromEntries(['pick', 'roll-two', 'unpick'].map(id => [id, new Node()]));
  let owner = { name: 'Player A', unlocked: [], pendingRoll: [] }, anywhere = false, writable = true;
  const c = { $: id => nodes[id], member: () => owner, canWrite: () => writable, sandbox: { active: false },
    preferences: () => ({ randomStartAlways: anywhere }) };
  createScreenRoll(c); c.rollCandidateCount = () => 2; c.renderRollControls();
  assert.equal(nodes.pick.textContent, 'Roll for Player A');
  assert.equal(nodes['roll-two'].textContent, 'Roll 2 choices for Player A');
  assert.equal(nodes['roll-two'].attributes['aria-label'], 'Roll two choices for Player A');
  owner = { ...owner, name: 'Player B' }; c.renderRollControls();
  assert.equal(nodes.pick.textContent, 'Roll for Player B');
  assert.match(nodes['roll-two'].title, /for Player B/);
  anywhere = true; c.renderRollControls(); assert.equal(nodes.pick.textContent, 'Roll anywhere for Player B');
  writable = false; c.renderRollControls(); assert.equal(nodes.pick.disabled, true); assert.equal(nodes['roll-two'].disabled, true);
});
