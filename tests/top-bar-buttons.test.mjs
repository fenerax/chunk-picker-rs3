import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { validatePreference } from '../app/core/preferences.mjs';
import { TOP_BAR_PREFERENCE, topBarButtons, hiddenTopBarButtons, validateTopBarSetting } from '../app/core/top-bar-settings.mjs';
import { createTopBarLayout, createTopBarSettings, createScreenTopBar, topBarTargets } from '../app/web/top-bar-buttons.mjs';

const now = () => '2026-10-19T12:00:00.000Z';
const state = () => createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
const hide = (saved, value, memberId = 'actor1') => applyCommand(saved, { type: 'set-preference', memberId, preferenceId: TOP_BAR_PREFERENCE, value }, { now });

class Node {
  constructor(tag = 'div', id = '') { this.tag = tag; this.id = id; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.className = ''; this.parentNode = null; }
  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, next) {
    if (next && next.parentNode !== this) throw new Error('insertBefore reference is not a child');
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node); node.parentNode = this;
  }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ target: this }); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelector(selector) { return this.all().find(node => node.className.split(' ').includes(selector.slice(1))) ?? null; }
}
const ids = root => root.children.map(node => node.id || node.textContent);

// The real top bar shape: plain buttons and two menus in one nav.
function topBar({ viewer = false } = {}) {
  const nav = new Node('nav'), byId = new Map();
  const make = (tag, id, parent, text) => { const node = new Node(tag, id); node.textContent = text ?? id; parent.append(node); if (id) byId.set(id, node); return node; };
  const menu = (id, items) => { const details = make('details', id, nav); details.open = false; const list = make('div', '', details); list.className = 'more-tools-menu'; for (const [tag, itemId, text, className] of items) { const node = make(tag, itemId, list, text); if (className) node.className = className; } return details; };
  make('button', 'helper-open', nav); make('button', 'search-open', nav);
  menu('info-tools', [['p', 'info-game-heading', 'Game', 'menu-heading'], ['button', 'bis-open'], ['p', '', 'Our run', 'menu-heading'], ['button', 'history-open']]);
  make('button', 'runemetrics-open', nav);
  menu('admin-tools', [['button', 'invites-open']]);
  menu('more-tools', [['button', 'help-open'], ['button', 'settings-open']]);
  if (viewer) for (const id of ['settings-open', 'runemetrics-open']) byId.get(id).hidden = byId.get(id).disabled = true;
  const $ = id => nav.all().find(node => node.id === id) ?? null;
  const document = { createElement: tag => new Node(tag), getElementById: $ };
  return { nav, byId, document, $, moreMenu: () => byId.get('more-tools').querySelector('.more-tools-menu') };
}

test('the saved choice is a personal preference with History, backup, undo and a one-command reset', () => {
  const original = state();
  assert.equal(original.members[0].preferences, undefined);
  assert.deepEqual(hiddenTopBarButtons(original.members[0].preferences), []);
  const changed = hide(original, ['search', 'info']);
  assert.deepEqual(changed.members[0].preferences, { [TOP_BAR_PREFERENCE]: ['search', 'info'] });
  assert.equal(changed.members[1].preferences, undefined);
  assert.equal(changed.history.at(-1).type, 'set-preference');
  validateState(changed);
  const restored = importBackup(exportBackup(changed));
  assert.deepEqual(hiddenTopBarButtons(restored.members[0].preferences), ['search', 'info']);
  const reset = hide(restored, []);
  assert.deepEqual(hiddenTopBarButtons(reset.members[0].preferences), []);
  assert.equal(reset.history.length, changed.history.length + 1);
  const undone = applyCommand(reset, { type: 'undo' }, { now });
  assert.deepEqual(undone.members[0].preferences[TOP_BAR_PREFERENCE], ['search', 'info']);
  assert.deepEqual(applyCommand(changed, { type: 'undo' }, { now }).members, original.members);
});

test('reading keeps top bar order and ignores locked, unknown or unreadable values', () => {
  assert.deepEqual(hiddenTopBarButtons({ [TOP_BAR_PREFERENCE]: ['sync', 'helper'] }), ['helper', 'sync']);
  assert.deepEqual(hiddenTopBarButtons({ [TOP_BAR_PREFERENCE]: ['more', 'admin', 'search'] }), ['search']);
  for (const value of [undefined, null, 'search', { search: true }]) assert.deepEqual(hiddenTopBarButtons({ [TOP_BAR_PREFERENCE]: value }), []);
  assert.deepEqual(hiddenTopBarButtons(undefined), []);
});

test('More is locked and invalid lists are refused before saving', () => {
  assert.equal(topBarButtons.find(row => row.id === 'more').locked, true);
  assert.throws(() => validatePreference(TOP_BAR_PREFERENCE, ['more']), /More can't be hidden/);
  assert.throws(() => hide(state(), ['search', 'more']), /More can't be hidden/);
  for (const value of [['admin'], ['search', 'search'], 'search', null, {}, [1], new Array(1)]) {
    assert.throws(() => validateTopBarSetting(TOP_BAR_PREFERENCE, value), TypeError);
    assert.throws(() => hide(state(), value), TypeError);
  }
  const invalid = state(); invalid.members[0].preferences = { [TOP_BAR_PREFERENCE]: ['more'] };
  assert.throws(() => validateState(invalid), TypeError);
  assert.deepEqual(validatePreference(TOP_BAR_PREFERENCE, ['helper', 'search', 'info', 'sync']), ['helper', 'search', 'info', 'sync']);
});

test('hidden buttons move into More with their listeners and come back in their original places', () => {
  const bar = topBar(), layout = createTopBarLayout({ document: bar.document, lookup: bar.$ });
  const original = ids(bar.nav), infoItems = ids(bar.byId.get('info-tools').querySelector('.more-tools-menu'));
  const overflow = bar.$('top-bar-overflow');
  assert.equal(bar.moreMenu().firstChild, overflow); assert.equal(overflow.hidden, true);
  let searched = 0; bar.$('search-open').addEventListener('click', () => searched++);
  layout.apply(['search', 'info', 'sync']);
  assert.deepEqual(ids(bar.nav), ['helper-open', 'info-tools', 'admin-tools', 'more-tools']);
  assert.equal(bar.$('info-tools').hidden, true);
  assert.deepEqual(ids(overflow), ['search-open', 'runemetrics-open', 'info-game-heading', 'bis-open', 'Our run', 'history-open', 'Tools']);
  assert.equal(overflow.hidden, false); assert.equal(bar.$('more-tools').hidden, false);
  assert.ok(bar.moreMenu().all().includes(bar.$('settings-open')));
  bar.$('search-open').click(); assert.equal(searched, 1);
  layout.apply(['helper']);
  assert.deepEqual(ids(bar.nav), ['search-open', 'info-tools', 'runemetrics-open', 'admin-tools', 'more-tools']);
  assert.deepEqual(ids(bar.byId.get('info-tools').querySelector('.more-tools-menu')), infoItems);
  assert.equal(bar.$('info-tools').hidden, false);
  layout.apply([]);
  assert.deepEqual(ids(bar.nav), original); assert.equal(overflow.hidden, true); assert.deepEqual(ids(overflow), ['Tools']);
});

test('More and Settings cannot be hidden, and an empty overflow stays out of the menu', () => {
  const bar = topBar(), layout = createTopBarLayout({ document: bar.document, lookup: bar.$ });
  layout.apply(['more', 'admin', 'settings']);
  assert.deepEqual(layout.hidden, []);
  assert.equal(bar.$('more-tools').hidden, false); assert.equal(bar.$('top-bar-overflow').hidden, true);
  bar.$('runemetrics-open').hidden = true; layout.apply(['sync']);
  assert.equal(bar.$('top-bar-overflow').hidden, true, 'an unavailable button adds no empty Tools heading');
  bar.$('runemetrics-open').hidden = false; layout.apply(['sync']);
  assert.equal(bar.$('top-bar-overflow').hidden, false);
  const missing = createTopBarLayout({ document: bar.document, lookup: () => null });
  assert.doesNotThrow(() => missing.apply(['search']));
});

function settingsHarness({ prefs = {}, fail = false, advanced = false, available = () => true } = {}) {
  const calls = [], errors = [];
  let saved = { ...prefs };
  const el = (tag, text, className = '') => { const node = new Node(tag); if (text !== undefined) node.textContent = text; node.className = className; return node; };
  const settings = createTopBarSettings({
    el, input: type => { const node = el('input'); node.type = type; return node; },
    button: (text, action) => { const node = el('button', text); node.addEventListener('click', action); return node; },
    command: async command => { calls.push(command); if (fail) throw new Error('Save failed'); saved = { ...saved, [command.preferenceId]: command.value }; },
    preferences: () => saved, showError: error => errors.push(error.message), advanced: () => advanced, available,
  });
  const box = settings.rows('actor1');
  const control = label => box.all().find(node => node.tag === 'input' && node.getAttribute('aria-label') === `Show ${label}`);
  const change = async label => { const node = control(label); node.checked = !node.checked; for (const listener of node.listeners.change) await listener(); };
  const reset = () => box.all().find(node => node.tag === 'button' && node.textContent === 'Reset to default');
  return { settings, box, calls, errors, control, change, reset, saved: () => saved };
}

test('Settings lists each button with a switch, keeps More locked, and resets to default', async () => {
  const h = settingsHarness();
  assert.deepEqual(h.box.all().filter(node => node.tag === 'input').map(node => node.getAttribute('aria-label')), ['Show Helper', 'Show Search', 'Show Info', 'Show Sync levels', 'Show More']);
  assert.equal(h.control('More').checked, true); assert.equal(h.control('More').disabled, true);
  assert.equal(h.control('More').listeners.change, undefined);
  assert.equal(h.reset().disabled, true);
  await h.change('Search'); await h.change('Info');
  assert.deepEqual(h.calls.map(call => call.value), [['search'], ['search', 'info']]);
  assert.deepEqual(h.calls[0], { type: 'set-preference', memberId: 'actor1', preferenceId: TOP_BAR_PREFERENCE, value: ['search'] });
  assert.equal(h.control('Search').checked, false); assert.equal(h.reset().disabled, false);
  assert.ok(h.box.all().some(node => node.textContent === 'In the More menu.'));
  for (const listener of h.reset().listeners.click) await listener();
  assert.deepEqual(h.calls.at(-1).value, []);
  assert.equal(h.control('Search').checked, true); assert.equal(h.reset().disabled, true);
  await h.change('Info'); await h.change('Info');
  assert.deepEqual(h.saved()[TOP_BAR_PREFERENCE], []);
});

test('a failed save shows the error and the switches return to the saved choice', async () => {
  const h = settingsHarness({ fail: true, prefs: { [TOP_BAR_PREFERENCE]: ['helper'] } });
  await h.change('Search');
  assert.deepEqual(h.errors, ['Save failed']);
  assert.equal(h.control('Search').checked, true); assert.equal(h.control('Helper').checked, false);
});

test('unavailable buttons are left out, technical detail needs Advanced, and search finds the rows', () => {
  const h = settingsHarness({ available: id => id !== 'sync' });
  assert.equal(h.control('Sync levels'), undefined); assert.ok(h.control('More'));
  assert.equal(h.box.all().some(node => String(node.textContent).startsWith('Saved as')), false);
  const advanced = settingsHarness({ advanced: true, prefs: { [TOP_BAR_PREFERENCE]: ['info'] } });
  assert.ok(advanced.box.all().some(node => node.textContent === `Saved as ${TOP_BAR_PREFERENCE}: ["info"]`));
  for (const query of ['', 'top bar', 'helper', 'sync levels', 'reset']) assert.equal(h.settings.matches(query), true);
  assert.equal(h.settings.matches('pickaxe'), false);
});

function screen({ writable = true, hidden = ['search', 'info'] } = {}) {
  const bar = topBar({ viewer: !writable });
  const saved = state(); saved.members[0].preferences = { [TOP_BAR_PREFERENCE]: hidden };
  let applied = 0;
  const c = { $: bar.$, state: saved, memberId: 'actor1', canWrite: () => writable, panelContext: {},
    preferences(id = this.memberId) { return { ...saved.members.find(member => member.id === id).preferences }; },
    applyPreferences: () => { applied++; return 'applied'; }, el() {}, button() {}, input() {}, command() {}, showError() {} };
  createScreenTopBar(c, { document: bar.document });
  return { bar, c, applied: () => applied };
}

test('the screen follows the shown player and keeps the existing preference pass', () => {
  const s = screen();
  assert.equal(s.c.applyPreferences(), 'applied'); assert.equal(s.applied(), 1);
  assert.equal(s.bar.$('search-open').parentNode, s.bar.$('top-bar-overflow'));
  assert.equal(s.bar.$('info-tools').hidden, true);
  assert.equal(s.c.panelContext.topBar, s.c.topBar);
  s.c.memberId = 'reed'; s.c.applyPreferences();
  assert.equal(s.bar.$('search-open').parentNode, s.bar.nav);
});

test('viewer links keep the default bar and never get write controls', () => {
  const s = screen({ writable: false });
  s.c.applyPreferences();
  assert.equal(s.bar.$('search-open').parentNode, s.bar.nav);
  assert.equal(s.bar.$('info-tools').hidden, false);
  assert.equal(s.bar.$('top-bar-overflow').hidden, true);
  assert.equal(s.bar.$('settings-open').hidden, true, 'Settings stays hidden for viewers');
  assert.equal(s.bar.$('runemetrics-open').hidden, true);
  assert.equal(topBarTargets.more, 'more-tools');
});
