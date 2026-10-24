import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapControlDiscovery, PHONE_CONTROLS_KEY } from '../app/web/map-control-discovery.mjs';
import { createScreenRoll } from '../app/web/screen-roll.mjs';
import { handleScreenEscape } from '../app/web/screen-controls.mjs';
import { readFile } from 'node:fs/promises';

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
  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  checkVisibility() { return !this.hidden && !this.viewerHidden && (!this.parentNode || this.parentNode.checkVisibility()); }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.isButton); }
}

function fixture({ saved, blocked = false, viewer = false, phone = true } = {}) {
  const ids = ['phone-map-actions', 'phone-legend-open', 'phone-legend-sheet', 'phone-legend-content',
    'phone-legend-close', 'phone-map-controls', 'phone-undo-host', 'legend-details', 'undo',
    'phone-map-primary', 'phone-controls-toggle', 'phone-map-extras', 'phone-roll-host', 'pick', 'roll-two', 'center-map', 'map-hover'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node()]));
  const toolbar = new Node(), history = new Node(), ownUndo = new Node(), sandbox = new Node(), home = new Node(), hint = new Node();
  nodes['map-toolbar'] = toolbar;
  const rollGroup = new Node(); toolbar.append(rollGroup);
  rollGroup.append(nodes.pick); rollGroup.append(nodes['roll-two']); toolbar.append(nodes['center-map']);
  for (const id of ['pick', 'roll-two', 'center-map']) nodes[id].isButton = true;
  nodes.pick.viewerHidden = nodes['roll-two'].viewerHidden = viewer;
  toolbar.append(history); toolbar.append(sandbox); history.append(nodes.undo); history.append(ownUndo);
  home.append(nodes['legend-details']); home.append(hint); nodes['legend-details'].open = false;
  nodes['phone-legend-sheet'].append(nodes['phone-legend-content']); nodes['phone-legend-sheet'].hidden = true;
  nodes['phone-map-actions'].append(nodes['phone-undo-host']);
  nodes['phone-map-actions'].append(nodes['phone-map-extras']);
  nodes['phone-map-primary'].append(nodes['phone-roll-host']); nodes['phone-map-primary'].append(nodes['phone-controls-toggle']);
  toolbar.scrollLeft = 0; toolbar.clientWidth = 300; toolbar.scrollWidth = 1000;
  toolbar.scrollTo = ({ left }) => { toolbar.scrollLeft = Math.max(0, Math.min(700, left)); toolbar.emit('scroll'); };
  const document = new Node(); document.querySelector = () => toolbar;
  for (const node of Object.values(nodes)) node.ownerDocument = document;
  const media = new Node(); media.matches = phone;
  const values = new Map(saved === undefined ? [] : [[PHONE_CONTROLS_KEY, saved]]);
  const storage = () => {
    if (blocked === true) throw new Error('Storage blocked');
    return {
      getItem: key => { if (blocked === 'methods') throw new Error('Read blocked'); return values.get(key); },
      setItem: (key, value) => { if (blocked === 'methods') throw new Error('Write blocked'); values.set(key, value); },
    };
  };
  const c = { $: id => nodes[id], closeChunkMenu() {}, mapDisplay: { close() {} } };
  const controller = createMapControlDiscovery(c, { document, media, storage }); controller.mount();
  return { nodes, toolbar, rollGroup, values, history, ownUndo, sandbox, home, hint, document, media, c, controller };
}

test('phone starts folded with the live roll and Undo outside the hidden controls', () => {
  const h = fixture();
  assert.equal(h.toolbar.hidden, true); assert.equal(h.nodes['phone-map-extras'].hidden, true);
  assert.equal(h.nodes['phone-controls-toggle'].attributes['aria-expanded'], 'false');
  assert.equal(h.nodes.pick.parentNode, h.nodes['phone-roll-host']);
  assert.equal(h.nodes.pick.checkVisibility(), true); assert.equal(h.nodes.undo.checkVisibility(), true);
  assert.equal(h.nodes['roll-two'].checkVisibility(), false);
});

test('one tap reveals controls and focuses the first available action; collapse closes the legend and restores focus', () => {
  const h = fixture(), toggle = h.nodes['phone-controls-toggle'];
  toggle.emit('click');
  assert.equal(h.toolbar.hidden, false); assert.equal(h.nodes['phone-map-extras'].hidden, false);
  assert.equal(toggle.attributes['aria-expanded'], 'true'); assert.equal(h.document.activeElement, h.nodes['roll-two']);
  h.controller.open(); toggle.emit('click');
  assert.equal(h.toolbar.hidden, true); assert.equal(h.controller.isOpen(), false);
  assert.equal(h.document.activeElement, toggle);
});

test('phone choice persists in both directions and restores on another mount', () => {
  const h = fixture(); h.nodes['phone-controls-toggle'].emit('click');
  assert.equal(h.values.get(PHONE_CONTROLS_KEY), 'expanded');
  const restored = fixture({ saved: h.values.get(PHONE_CONTROLS_KEY) });
  assert.equal(restored.toolbar.hidden, false);
  restored.nodes['phone-controls-toggle'].emit('click');
  assert.equal(restored.values.get(PHONE_CONTROLS_KEY), 'folded');
  assert.equal(fixture({ saved: 'unexpected' }).toolbar.hidden, true);
});

test('blocked storage acquisition, reads and writes still allow folding', () => {
  for (const blocked of [true, 'methods']) {
    const h = fixture({ blocked });
    h.nodes['phone-controls-toggle'].emit('click'); assert.equal(h.toolbar.hidden, false);
    h.nodes['phone-controls-toggle'].emit('click'); assert.equal(h.toolbar.hidden, true);
  }
});

test('viewer expansion skips invisible write actions, while desktop restores original roll order', () => {
  const h = fixture({ viewer: true }); h.nodes['phone-controls-toggle'].emit('click');
  assert.equal(h.document.activeElement, h.nodes['center-map']);
  h.media.matches = false; h.media.emit('change');
  assert.equal(h.toolbar.hidden, false); assert.equal(h.nodes['phone-map-primary'].hidden, true);
  assert.deepEqual(h.rollGroup.children, [h.nodes.pick, h.nodes['roll-two']]);
  const desktop = fixture({ phone: false }); assert.equal(desktop.toolbar.hidden, false);
});

test('phone shell labels the fold toggle and removes empty viewer roll and Undo bars', async () => {
  const html = await readFile(new URL('../app/web/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/web/phone-layout.css', import.meta.url), 'utf8');
  assert.match(html, /id="phone-controls-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="map-toolbar phone-map-extras">Controls/);
  assert.match(css, /:root\[data-read-only=true\] :is\(#phone-roll-host,#phone-undo-host,\.toolbar-roll\) \{ display:none; \}/);
});

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
