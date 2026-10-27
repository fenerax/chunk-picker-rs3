import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createPhoneLayout, PHONE_TAB_KEY, observeScreenBars } from '../app/web/phone-layout.mjs';

class Node {
  constructor() { this.children = []; this.attributes = {}; this.listeners = {}; this.hidden = false; this.dataset = {}; this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  append(node) { this.insertBefore(node, null); }
  insertBefore(node, next) {
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, node); node.parentNode = this;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  emit(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
  querySelectorAll() { return this.menus ?? []; }
  focus() { this.focused = true; }
}

test('showing and hiding the update banner reserves its height above the fixed phone tabs', () => {
  const heights = new Map([['topbar', 60], ['update-banner', 0], ['notice', 0], ['backup-status-notice', 40], ['sandbox-banner', 0], ['duo-catchup', 0], ['duo-live', 0]]);
  const nodes = new Map([...heights.keys()].map(id => [id, { getBoundingClientRect: () => ({ height: heights.get(id) }) }]));
  const values = new Map(), observed = [];
  class Observer { constructor(callback) { this.refresh = callback; } observe(node) { observed.push(node); } }
  const document = { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } },
    querySelector: () => nodes.get('topbar'), getElementById: id => nodes.get(id) };
  const observer = observeScreenBars(document, Observer);
  assert.equal(observed.length, 7); assert.ok(observed.includes(nodes.get('update-banner')));
  observer.refresh(); assert.equal(values.get('--topbar-height'), '100px');
  heights.set('update-banner', 44); heights.set('notice', 30); observer.refresh();
  assert.equal(values.get('--topbar-height'), '174px');
  heights.set('update-banner', 0); observer.refresh();
  assert.equal(values.get('--topbar-height'), '130px');
});

function fixture({ phone = true, saved, blocked = false } = {}) {
  const root = new Node(), tabBar = new Node(), buttons = Object.fromEntries(['map', 'tasks', 'more'].map(tab => [tab, new Node()]));
  const panels = Object.fromEntries(['map', 'tasks', 'more'].map(tab => [tab, new Node()]));
  for (const tab of ['map', 'tasks', 'more']) buttons[tab].id = `phone-tab-${tab}`;
  panels.more.setAttribute('aria-labelledby', 'phone-more-title');
  const header = new Node(), dock = new Node(), tools = new Node(), recent = new Node(), summary = new Node(), trailing = new Node();
  header.append(tools); header.append(trailing); dock.append(recent); dock.append(summary);
  const search = new Node(), account = new Node();
  tools.append(search); tools.append(account);
  tools.menus = [{ open: true }, account];
  const moreTools = new Node(), moreMap = new Node(), writes = [], changes = [];
  const storage = { getItem: () => { if (blocked) throw Error('blocked'); return saved; }, setItem: (key, value) => { if (blocked) throw Error('blocked'); writes.push([key, value]); } };
  const media = new Node(); media.matches = phone;
  const controller = createPhoneLayout({ root, tabBar, buttons, panels, tools, moreTools, moreMap, recent, summary, leadingTool: account, media, storage, onChange: (...args) => changes.push(args) });
  controller.mount();
  return { controller, root, tabBar, buttons, panels, header, dock, tools, recent, summary, trailing, moreTools, moreMap, media, writes, changes, search, account };
}

test('account leads phone More in reading and focus order and returns to the right on desktop', () => {
  const h = fixture();
  assert.deepEqual(h.tools.children, [h.account, h.search]);
  h.account.open = true;
  h.media.matches = false; h.media.emit('change');
  assert.deepEqual(h.tools.children, [h.search, h.account]);
  assert.equal(h.account.open, false);
  h.media.matches = true; h.media.emit('change');
  assert.deepEqual(h.tools.children, [h.account, h.search]);
});

test('phone tabs show only the chosen panel and persist the choice', () => {
  const h = fixture();
  assert.equal(h.panels.map.hidden, false); assert.equal(h.panels.tasks.hidden, true); assert.equal(h.panels.more.hidden, true);
  h.buttons.tasks.emit('click');
  assert.equal(h.controller.tab, 'tasks'); assert.equal(h.panels.map.hidden, true); assert.equal(h.panels.tasks.hidden, false);
  assert.equal(h.buttons.tasks.attributes['aria-selected'], 'true'); assert.equal(h.buttons.map.tabIndex, -1);
  h.buttons.more.emit('click');
  assert.equal(h.panels.more.hidden, false); assert.equal(h.panels.tasks.hidden, true);
  assert.deepEqual(h.writes, [[PHONE_TAB_KEY, 'tasks'], [PHONE_TAB_KEY, 'more']]);
});

test('reuse tools and map summary and restore their exact order on desktop', () => {
  const h = fixture({ saved: 'more' });
  assert.deepEqual(h.moreTools.children, [h.tools]); assert.deepEqual(h.moreMap.children, [h.recent, h.summary]);
  assert.equal(h.tools.menus[0].open, false);
  h.media.matches = false; h.media.emit('change');
  assert.deepEqual(h.header.children, [h.tools, h.trailing]); assert.deepEqual(h.dock.children, [h.recent, h.summary]);
  assert.equal(h.tabBar.hidden, true); assert.equal(h.panels.map.hidden, false); assert.equal(h.panels.tasks.hidden, false); assert.equal(h.panels.more.hidden, true);
  h.media.matches = true; h.media.emit('change');
  assert.equal(h.panels.more.hidden, false); assert.deepEqual(h.moreTools.children, [h.tools]);
});

test('valid saved choice is restored; unknown values and blocked storage are safe', () => {
  assert.equal(fixture({ saved: 'tasks' }).controller.tab, 'tasks');
  assert.equal(fixture({ saved: 'unknown' }).controller.tab, 'map');
  const h = fixture({ blocked: true });
  assert.doesNotThrow(() => h.controller.select('more'));
  assert.equal(h.panels.more.hidden, false); assert.equal(h.controller.select('bad'), false);
});

test('Admin follows the shared tools between desktop and phone without changing its role visibility', () => {
  for (const hidden of [false, true]) {
    const h = fixture({ saved: 'more' }), admin = new Node(); admin.id = 'admin-tools'; admin.hidden = hidden;
    h.tools.append(admin); h.tools.menus.push(admin);
    assert.equal(admin.parentNode.parentNode, h.moreTools); assert.equal(admin.hidden, hidden);
    h.media.matches = false; h.media.emit('change');
    assert.equal(admin.parentNode.parentNode, h.header); assert.equal(admin.hidden, hidden);
    h.media.matches = true; h.media.emit('change');
    assert.equal(admin.parentNode.parentNode, h.moreTools); assert.equal(admin.hidden, hidden);
  }
});

test('tab keyboard navigation wraps and moves focus', () => {
  const h = fixture(); let prevented = false;
  h.buttons.map.emit('keydown', { key: 'ArrowLeft', preventDefault: () => { prevented = true; } });
  assert.equal(h.controller.tab, 'more'); assert.equal(h.buttons.more.focused, true); assert.equal(prevented, true);
  h.buttons.more.emit('keydown', { key: 'Home', preventDefault() {} }); assert.equal(h.controller.tab, 'map');
  h.buttons.map.emit('keydown', { key: 'End', preventDefault() {} }); assert.equal(h.controller.tab, 'more');
});

test('phone panels are labelled tabpanels and restore desktop semantics on resize', () => {
  const h = fixture();
  for (const tab of ['map', 'tasks', 'more']) {
    assert.equal(h.panels[tab].getAttribute('role'), 'tabpanel');
    assert.equal(h.panels[tab].getAttribute('aria-labelledby'), h.buttons[tab].id);
  }
  h.media.matches = false; h.media.emit('change');
  for (const tab of ['map', 'tasks', 'more']) assert.equal(h.panels[tab].getAttribute('role'), null);
  assert.equal(h.panels.map.getAttribute('aria-labelledby'), null);
  assert.equal(h.panels.tasks.getAttribute('aria-labelledby'), null);
  assert.equal(h.panels.more.getAttribute('aria-labelledby'), 'phone-more-title');
  h.media.matches = true; h.media.emit('change');
  assert.equal(h.panels.more.getAttribute('aria-labelledby'), 'phone-tab-more');
});

test('map navigation can reveal a chunk and mount is idempotent', () => {
  const h = fixture({ saved: 'tasks' }); h.controller.mount();
  assert.equal(h.buttons.map.listeners.click.length, 1);
  h.controller.select('map'); assert.equal(h.panels.map.hidden, false);
  assert.deepEqual(h.changes.at(-1), ['map', true]);
});

test('chunk deep links and Settings map display reveal the map without changing their actions', async () => {
  const h = fixture({ phone: false }), nodes = new Map(Object.entries({
    'phone-tabs': h.tabBar, 'phone-tab-map': h.buttons.map, 'phone-tab-tasks': h.buttons.tasks, 'phone-tab-more': h.buttons.more,
    'map-panel': h.panels.map, 'phone-more': h.panels.more, 'phone-tools': h.moreTools, 'phone-map-summary': h.moreMap, 'recent-panel': h.recent
  }));
  for (const id of ['map-display-open', 'screenshot-open', 'map-image-open']) nodes.set(id, new Node());
  const chunks = [], displays = [];
  const c = { $: id => nodes.get(id), showChunk: id => chunks.push(id), closeChunkMenu() {}, map: { cancelTouchGesture() {} },
    mapDisplay: { open: () => displays.push('open') }, panelContext: {} };
  const document = { documentElement: h.root, querySelector: selector => ({ '.task-sidebar':h.panels.tasks, '.topbar nav':h.tools, '.map-summary':h.summary })[selector] };
  const source = (await readFile(new URL('../app/web/screen-phone-layout.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const context = createContext({ c, document, createPhoneLayout, PHONE_QUERY:'(max-width:720px)', matchMedia: () => h.media });
  runInContext(source + '\ncreateScreenPhoneLayout(c);', context); c.phoneLayout.mount();
  h.media.matches = true; h.media.emit('change');
  c.phoneLayout.select('tasks'); c.showChunk('12341');
  assert.equal(c.phoneLayout.tab, 'map'); assert.deepEqual(chunks, ['12341']);
  c.phoneLayout.select('more'); c.panelContext.mapDisplay();
  assert.equal(c.phoneLayout.tab, 'map'); assert.deepEqual(displays, ['open']);
  c.phoneLayout.select('more'); nodes.get('map-image-open').emit('click'); assert.equal(c.phoneLayout.tab, 'map');
});
