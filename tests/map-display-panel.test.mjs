import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Run the shipped panel with a small DOM and controlled animation frames.
// No server, game save, or real browser storage participates in these tests.
const source = (await readFile(new URL('../app/web/map-display.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function harness({ writer = true, stored, storageError = false, ready = true } = {}) {
  class Node {
    constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, action) { (this.events[type] ??= []).push(action); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    focus() { this.focused = true; }
    contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
    async emit(type) { for (const action of this.events[type] ?? []) await action({ target: this, preventDefault() {}, stopPropagation() {} }); }
  }
  const nodes = new Map(), writes = [], display = [], errors = [], closures = [], viewerChanges = [], frames = new Map(), entries = new Map();
  if (stored !== undefined) entries.set('picker.map-display', stored);
  const lookup = id => { if (!nodes.has(id)) nodes.set(id, new Node('div')); return nodes.get(id); };
  lookup('map-display-panel').hidden = true;
  const state = { revision: 7, members: [{ id: 'actor1', preferences: { ids: false, highvis: false, unlockedBorderColor: '#ffffff' } }, { id: 'reed', preferences: { ids: true, highvis: true, unlockedBorderColor: '#123456' } }] };
  const c = {
    $: lookup, state: ready ? state : undefined, memberId: ready ? 'actor1' : undefined,
    member: () => c.state?.members.find(member => member.id === c.memberId),
    canWrite: () => writer, preferences: () => ({ ...(state.members.find(member => member.id === c.memberId)?.preferences ?? {}), ...c.mapDisplay?.sizes }),
    el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; },
    input: (type, value = '') => { const node = new Node('input'); node.type = type; node.value = value; return node; },
    button: (text, action, cls) => { const node = new Node('button', text); node.className = cls; node.addEventListener('click', action); return node; },
    map: { setDisplayPreferences: preferences => display.push(structuredClone(preferences)) },
    mapTools: { startingChunk: () => closures.push('startingChunk') },
    closeDialog: () => closures.push('dialog'), closeTopMenus: () => closures.push('menus'), showError: error => errors.push(error),
    command: async payload => { writes.push(structuredClone(payload)); },
    setViewerPreference: (id, value) => viewerChanges.push({ id, value }),
  };
  let nextFrame = 1;
  const context = createContext({ c, console, document: { activeElement: lookup('map-hover') }, localStorage: { getItem: key => { if (storageError) throw new Error('Storage unavailable'); return entries.get(key) ?? null; }, setItem: (key, value) => { if (storageError) throw new Error('Storage unavailable'); entries.set(key, value); } }, requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id) });
  runInContext(source, context); runInContext('c.mapDisplay = createMapDisplay(c)', context);
  const all = () => [...nodes.values()].flatMap(function walk(node) { return [node, ...node.children.flatMap(walk)]; });
  const flushFrame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  return { c, state, nodes, all, writes, display, errors, closures, viewerChanges, frames, entries, flushFrame };
}

test('map display opens independently, closes competing panels and provides local sizes for viewers', () => {
  const h = harness({ writer: false }); h.c.mapDisplay.open();
  assert.equal(h.c.mapDisplay.isOpen(), true); assert.equal(h.nodes.get('map-display-panel').hidden, false);
  assert.deepEqual(h.closures, ['dialog', 'menus']);
  const sliders = h.all().filter(node => node.type === 'range'); assert.equal(sliders.length, 4);
  for (const slider of sliders) { assert.equal(Number(slider.min), .6); assert.equal(Number(slider.max), 2); assert.equal(Number(slider.value), 1); }
  assert.equal(h.all().filter(node => node.type === 'checkbox').length, 3, 'viewers get IDs, local task counts and place names');
  assert.equal(h.all().filter(node => node.type === 'color').length, 0);
  assert.equal(h.writes.length, 0); h.c.mapDisplay.close(); assert.equal(h.c.mapDisplay.isOpen(), false);
});

test('rapid size input batches drawing, persists locally and does not send commands', async () => {
  const h = harness(); h.c.mapDisplay.open(); const slider = h.all().find(node => node.type === 'range');
  const before = h.display.length;
  slider.value = '1.3'; await slider.emit('input'); slider.value = '1.6'; await slider.emit('input');
  assert.equal(h.frames.size, 1); assert.equal(h.display.length, before); assert.equal(h.writes.length, 0);
  h.flushFrame(); assert.equal(h.display.length, before + 1);
  assert.ok(Object.values(h.c.mapDisplay.sizes).includes(1.6));
  assert.ok(Object.values(JSON.parse(h.entries.get('picker.map-display'))).includes(1.6));
});

test('IDs use local viewer preferences and saved writer preferences for the reviewed member', async () => {
  for (const writer of [false, true]) {
    const h = harness({ writer }); h.c.mapDisplay.open();
    const checkbox = h.all().find(node => node.type === 'checkbox'); checkbox.checked = true; await checkbox.emit('change');
    if (writer) assert.deepEqual(h.writes, [{ type: 'set-preference', memberId: 'actor1', preferenceId: 'ids', value: true }]);
    else { assert.deepEqual(h.viewerChanges, [{ id: 'ids', value: true }]); assert.equal(h.writes.length, 0); }
  }
});

test('panel refresh follows player changes and tolerates opening before a member is loaded', () => {
  const h = harness(); h.c.mapDisplay.open(); h.c.memberId = 'reed'; h.c.mapDisplay.refresh();
  assert.equal(h.all().find(node => node.type === 'checkbox').checked, true);
  const unloaded = harness({ ready: false }); assert.doesNotThrow(() => { unloaded.c.mapDisplay.refresh(); unloaded.c.mapDisplay.open(); });
});

test('malformed or unavailable browser storage leaves usable default controls', async () => {
  for (const options of [{ stored: '{broken' }, { storageError: true }]) {
    const h = harness(options); assert.deepEqual({ ...h.c.mapDisplay.sizes }, { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1, taskCountScale: 1, showTaskCounts: true, showPlaceNames: true });
    h.c.mapDisplay.open(); const slider = h.all().find(node => node.type === 'range'); slider.value = '1.2';
    await assert.doesNotReject(slider.emit('input')); h.flushFrame(); assert.equal(h.writes.length, 0);
  }
});

test('restored sizes clamp valid numbers and reset affects only browser sizes', async () => {
  const h = harness({ stored: JSON.stringify({ rollNumberScale: 9, chunkIdScale: -.5, stickerScale: '1.4', ids: true }) });
  assert.deepEqual({ ...h.c.mapDisplay.sizes }, { rollNumberScale: 2, chunkIdScale: .6, stickerScale: 1, taskCountScale: 1, showTaskCounts: true, showPlaceNames: true });
  h.c.mapDisplay.open();
  assert.deepEqual(h.all().filter(node => node.tagName === 'OUTPUT').map(node => node.textContent), ['200%', '60%', '100%', '100%']);
  await h.nodes.get('map-display-reset').emit('click'); h.flushFrame();
  assert.deepEqual({ ...h.c.mapDisplay.sizes }, { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1, taskCountScale: 1, showTaskCounts: true, showPlaceNames: true });
  assert.deepEqual(JSON.parse(h.entries.get('picker.map-display')), { rollNumberScale: 1, chunkIdScale: 1, stickerScale: 1, taskCountScale: 1, showTaskCounts: true, showPlaceNames: true });
  assert.equal(h.writes.length, 0); assert.equal(h.state.members[0].preferences.ids, false);
});

test('place names default on and persist locally for viewers, writers and Sandbox without commands', async () => {
  for (const writer of [false, true]) {
    const h = harness({ writer }); h.c.mapDisplay.open();
    const option = h.all().find(node => node.id === 'map-display-place-names');
    assert.equal(option.checked, true);
    h.c.sandbox = { active: true }; h.c.mapDisplay.refresh(); assert.ok(!option.disabled);
    option.checked = false; await option.emit('change'); h.flushFrame();
    assert.equal(h.display.at(-1).showPlaceNames, false);
    assert.equal(h.writes.length, 0); assert.equal(h.viewerChanges.length, 0);
    const stored = h.entries.get('picker.map-display');
    const restored = harness({ writer, stored }); restored.c.mapDisplay.open();
    assert.equal(restored.all().find(node => node.id === 'map-display-place-names').checked, false);
    await restored.nodes.get('map-display-reset').emit('click'); restored.flushFrame();
    assert.equal(restored.c.mapDisplay.sizes.showPlaceNames, false);
  }
});

test('saved controls retain their reviewed owner and restore failed saves', async () => {
  const h = harness(); h.c.mapDisplay.open(); const ids = h.all().find(node => node.type === 'checkbox');
  h.c.memberId = 'reed'; ids.checked = true; await ids.emit('change');
  assert.equal(h.writes[0].memberId, 'actor1');
  h.c.mapDisplay.refresh(); const currentIds = h.all().find(node => node.type === 'checkbox'), failure = new Error('Save failed');
  h.c.command = async () => { throw failure; }; currentIds.checked = false; await currentIds.emit('change');
  assert.equal(currentIds.checked, true); assert.equal(currentIds.disabled, false); assert.deepEqual(h.errors, [failure]);
});

test('writer marker appearance controls use existing saved preference commands', async () => {
  const h = harness(); h.c.mapDisplay.open();
  const highvis = h.all().find(node => node.attributes['aria-label'] === 'High visibility map'); highvis.checked = true; await highvis.emit('change');
  const colour = h.all().find(node => node.type === 'color'); colour.value = '#aabbcc'; await colour.emit('change');
  assert.deepEqual(h.writes, [
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'highvis', value: true },
    { type: 'set-preference', memberId: 'actor1', preferenceId: 'unlockedBorderColor', value: '#aabbcc' },
  ]);
  assert.equal(h.frames.size, 0); assert.equal(h.entries.has('picker.map-display'), false);
});

test('Done closes the panel and starting-marker choice closes it before opening its editor', async () => {
  const h = harness(); h.c.mapDisplay.open();
  await h.nodes.get('map-display-done').emit('click'); assert.equal(h.c.mapDisplay.isOpen(), false);
  h.c.mapDisplay.open(); await h.all().find(node => node.textContent === 'Choose starting marker…').emit('click');
  assert.equal(h.c.mapDisplay.isOpen(), false); assert.equal(h.closures.at(-1), 'startingChunk'); assert.equal(h.writes.length, 0);
});

test('refresh preserves an in-flight preference draft and keeps saved controls disabled in Sandbox', async () => {
  const h = harness(); h.c.sandbox = { active: false }; h.c.mapDisplay.open();
  let resolveSave;
  h.c.command = () => new Promise(resolve => { resolveSave = resolve; });
  const ids = h.all().find(node => node.attributes['aria-label'] === 'Show chunk IDs');
  ids.checked = true; const pending = ids.emit('change');
  h.state.members[0].preferences.highvis = true; h.c.mapDisplay.refresh();
  assert.equal(ids.checked, true, 'unrelated refresh preserves the submitted draft');
  assert.equal(ids.disabled, true, 'refresh cannot enable a pending save');
  assert.equal(h.all().find(node => node.attributes['aria-label'] === 'High visibility map').checked, true);
  h.c.sandbox.active = true; h.c.mapDisplay.refresh();
  h.state.members[0].preferences.ids = true; resolveSave(); await pending;
  assert.equal(ids.checked, true); assert.equal(ids.disabled, true, 'save completion cannot enable a Sandbox editor');
  h.c.sandbox.active = false; h.c.mapDisplay.refresh(); assert.equal(ids.disabled, false);
});

test('starting-marker availability follows Sandbox refresh while local sizes remain enabled', () => {
  const h = harness(); h.c.sandbox = { active: false }; h.c.mapDisplay.open();
  const starting = h.all().find(node => node.textContent === 'Choose starting marker…');
  assert.equal(starting.disabled, false);
  h.c.sandbox.active = true; h.c.mapDisplay.refresh(); assert.equal(starting.disabled, true);
  assert.ok(h.all().filter(node => node.type === 'range').every(node => !node.disabled));
  h.c.sandbox.active = false; h.c.mapDisplay.refresh(); assert.equal(starting.disabled, false);
  assert.ok(h.all().filter(node => node.type === 'range').every(node => !node.disabled));
});

test('task count visibility and size are browser-only for writers and viewers and survive reset', async () => {
  for (const writer of [true, false]) {
    const h = harness({ writer, stored: JSON.stringify({ showTaskCounts: false, taskCountScale: 1.5 }) });
    h.c.sandbox = { active: true }; h.c.mapDisplay.open();
    const toggle = h.all().find(node => node.id === 'map-display-task-counts');
    assert.equal(toggle.checked, false); assert.ok(!toggle.disabled);
    toggle.checked = true; await toggle.emit('change');
    const slider = h.all().find(node => node.id === 'map-display-taskCountScale');
    slider.value = '2'; await slider.emit('input'); h.flushFrame();
    assert.equal(h.display.at(-1).showTaskCounts, true); assert.equal(h.display.at(-1).taskCountScale, 2);
    assert.equal(h.writes.length, 0); assert.equal(h.viewerChanges.length, 0);
    toggle.checked = false; await toggle.emit('change');
    await h.nodes.get('map-display-reset').emit('click'); h.flushFrame();
    assert.equal(h.display.at(-1).showTaskCounts, false); assert.equal(h.display.at(-1).taskCountScale, 1);
  }
});
