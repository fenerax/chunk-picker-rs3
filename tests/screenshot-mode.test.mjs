import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

// Exercise the shipped controller, with DOM events, time and PNG rendering controlled.
const source = (await readFile(new URL('../app/web/screen-capture.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function harness({ ready = true, writer = false } = {}) {
  let document;
  class Node {
    constructor(tag = 'div', text = '') {
      this.tagName = tag.toUpperCase(); this.textContent = text; this.children = [];
      this.events = new Map(); this.attributes = {}; this.hidden = false; this.isConnected = true;
      this.disabled = false; this.open = false;
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
    }
    addEventListener(type, action, capture = false) {
      const entries = this.events.get(type) ?? []; entries.push({ action, capture }); this.events.set(type, entries);
    }
    async emit(type, props = {}) {
      const event = { target: this, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...props };
      for (const { action } of [...(this.events.get(type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
        await action(event); if (event.stopped) break;
      }
      return event;
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); this.isConnected = false; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    focus(options) { this.focusOptions = options; document.activeElement = this; }
    click() { downloads.push({ href: this.href, name: this.download, connected: document.body.children.includes(this) }); }
  }
  const nodes = new Map(), timers = new Map(), calls = [], downloads = [], revoked = [], writes = [];
  const lookup = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  document = new Node(); document.documentElement = new Node('html'); document.body = new Node('body'); document.activeElement = lookup('previous-focus');
  let timerId = 0, generation = 0, render = async () => ({ blob: {}, width: 1200, height: 800, missingTiles: 0 });
  const renderCalls = [], c = {
    $: lookup, canWrite: () => writer, command: payload => writes.push(payload),
    el: (tag, text, className) => Object.assign(new Node(tag, text), { className }),
    button: (text, action) => { const node = new Node('button', text); node.addEventListener('click', action); return node; },
    closeTopMenus: () => calls.push('menus'), taskHover: { hide: () => calls.push('task-hover') },
    duoHovers: new Map([['other', { hide: () => calls.push('duo-hover') }]]),
    map: { model: ready ? {} : null, active: { name: 'Player / map!' },
      onChunk: (...args) => calls.push(['chunk', ...args]), onContext: (...args) => calls.push(['context', ...args]), setHover: value => calls.push(['hover', value]) },
    openDialog: (title, ...children) => { c.dialog = { title, children }; lookup('tool-dialog').open = true; return ++generation; },
    dialogCurrent: value => value === generation,
  };
  const context = createContext({ c, document, AbortController, MAX_MAP_IMAGE_SIDE: 16384,
    renderMapImage: (map, options) => { renderCalls.push({ map, options }); return render(map, options); },
    URL: { createObjectURL: blob => { calls.push(['url', blob]); return 'blob:map'; }, revokeObjectURL: url => revoked.push(url) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  runInContext(source, context); runInContext('createScreenCapture(c)', context); c.mapCapture.mount();
  const key = props => document.emit('keydown', { key: 'S', shiftKey: true, target: lookup('map-hover'), ...props });
  const flush = delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } };
  const dialogNode = text => c.dialog.children.flatMap(node => [node, ...node.children]).find(node => node.textContent === text);
  return { c, nodes, document, calls, writes, timers, downloads, revoked, renderCalls, key, flush, dialogNode,
    setRender: value => { render = value; }, staleDialog: () => { generation++; } };
}

test('viewer capture enters locally, fades its hint and restores focus on leave', () => {
  const h = harness(), previous = h.document.activeElement;
  h.c.mapCapture.enter();
  assert.equal(h.c.mapCapture.isActive(), true);
  assert.equal(h.document.documentElement.classList.contains('screenshot-mode'), true);
  assert.equal(h.nodes.get('screenshot-open').attributes['aria-pressed'], 'true');
  assert.equal(h.document.activeElement, h.nodes.get('map-hover'));
  assert.deepEqual(h.calls, ['menus', 'task-hover', 'duo-hover', ['hover', null]]);
  assert.equal(h.nodes.get('screenshot-hint').hidden, false); h.flush(4500);
  assert.equal(h.nodes.get('screenshot-hint').hidden, true); assert.equal(h.c.mapCapture.isActive(), true);
  h.c.mapCapture.leave();
  assert.equal(h.document.documentElement.classList.contains('screenshot-mode'), false);
  assert.equal(h.nodes.get('screenshot-open').attributes['aria-pressed'], 'false');
  assert.equal(h.document.activeElement, previous); assert.equal(previous.focusOptions.preventScroll, true);
  assert.deepEqual(h.writes, []);
});

test('the exit hint retains native Enter activation during screenshot mode', async () => {
  const h = harness(); h.c.mapCapture.enter();
  const event = await h.key({ key: 'Enter', shiftKey: false, target: h.nodes.get('screenshot-hint') });
  assert.equal(event.defaultPrevented, false); assert.equal(event.stopped, false);
});

test('two touch taps leave after the hint fades, while dragging keeps the map open', async () => {
  const h = harness(); h.c.mapCapture.enter(); h.flush(4500); const stage = h.nodes.get('map-stage');
  const touch = { pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 150 };
  await stage.emit('pointerdown', touch); await stage.emit('pointerup', { ...touch, clientX: 150, timeStamp: 1000 });
  assert.equal(h.c.mapCapture.isActive(), true);
  await stage.emit('pointerdown', touch); await stage.emit('pointerup', { ...touch, timeStamp: 1100 });
  assert.equal(h.c.mapCapture.isActive(), true);
  await stage.emit('pointerdown', touch); await stage.emit('pointerup', { ...touch, timeStamp: 1250 });
  assert.equal(h.c.mapCapture.isActive(), false);
});

test('Helper can download the whole map but cannot offer an empty visible-area image', async () => {
  const h = harness(); h.c.$('map-stage').getClientRects = () => [];
  h.c.mapCapture.downloadDialog();
  assert.equal(h.dialogNode('Visible area PNG').disabled, true);
  await h.dialogNode('Visible area PNG').emit('click'); assert.equal(h.renderCalls.length, 0);
  await h.dialogNode('Whole map PNG').emit('click'); assert.equal(h.renderCalls.length, 1);
  assert.equal(h.dialogNode('Whole map PNG').disabled, false);
  assert.equal(h.dialogNode('Visible area PNG').disabled, true);
});

test('capture waits for a map, toggles on repeated enter, and cancels the hint timer', () => {
  const unloaded = harness({ ready: false }); unloaded.c.mapCapture.enter(); unloaded.c.mapCapture.downloadDialog();
  assert.equal(unloaded.c.mapCapture.isActive(), false); assert.equal(unloaded.c.dialog, undefined);
  const h = harness(); h.c.mapCapture.enter(); assert.equal(h.timers.size, 1);
  h.c.mapCapture.enter(); assert.equal(h.c.mapCapture.isActive(), false); assert.equal(h.timers.size, 0);
  assert.doesNotThrow(() => h.c.mapCapture.leave());
});

test('Shift+S ignores typing, modifiers, repeat and open dialogs, and handles both cases', async () => {
  const h = harness();
  for (const props of [{ shiftKey: false }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true },
    ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ target: { tagName } })), { target: { isContentEditable: true } }]) {
    const event = await h.key(props); assert.equal(event.defaultPrevented, false); assert.equal(h.c.mapCapture.isActive(), false);
  }
  h.nodes.get('tool-dialog').open = true; await h.key(); assert.equal(h.c.mapCapture.isActive(), false);
  h.nodes.get('tool-dialog').open = false;
  for (const key of ['s', 'S']) { const event = await h.key({ key }); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); }
  assert.equal(h.c.mapCapture.isActive(), false);
});

test('Escape capture runs before other handlers and restores focus even with a dialog open', async () => {
  const h = harness(), previous = h.document.activeElement; let downstream = 0;
  h.document.addEventListener('keydown', () => downstream++);
  h.c.mapCapture.enter(); h.nodes.get('tool-dialog').open = true;
  const event = await h.key({ key: 'Escape', shiftKey: false, target: { tagName: 'INPUT' } });
  assert.equal(event.defaultPrevented, true); assert.equal(downstream, 0); assert.equal(h.c.mapCapture.isActive(), false);
  assert.equal(h.document.activeElement, previous);
  await h.key({ key: 'Escape', shiftKey: false }); assert.equal(downstream, 1);
  h.c.mapCapture.enter(); previous.isConnected = false;
  assert.doesNotThrow(() => h.c.mapCapture.leave()); assert.equal(h.document.activeElement, h.nodes.get('map-hover'));
});

test('capture blocks map actions and action keys while keeping callbacks usable after leave', async () => {
  const h = harness(); h.c.mapCapture.enter();
  h.c.map.onChunk(1); h.c.map.onContext(2);
  for (const key of ['/', 'Enter', 'ContextMenu', 'F10']) { const event = await h.key({ key }); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); }
  assert.equal(h.calls.some(call => Array.isArray(call) && ['chunk', 'context'].includes(call[0])), false);
  h.c.mapCapture.leave(); h.c.map.onChunk(3); h.c.map.onContext(4);
  assert.deepEqual(h.calls.slice(-2), [['chunk', 3], ['context', 4]]);
  h.c.mapCapture.enter(); h.c.mapCapture.leave(); h.c.map.onChunk(5);
  assert.deepEqual(h.calls.at(-1), ['chunk', 5]); assert.deepEqual(h.writes, []);
});

test('toolbar, touch hint and map doubleclick provide capture exit paths', async () => {
  const h = harness(); await h.nodes.get('screenshot-open').emit('click');
  await h.nodes.get('screenshot-hint').emit('click'); assert.equal(h.c.mapCapture.isActive(), false);
  h.c.mapCapture.enter(); const event = await h.nodes.get('map-stage').emit('dblclick');
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.equal(h.c.mapCapture.isActive(), false);
  const inactive = await h.nodes.get('map-stage').emit('dblclick'); assert.equal(inactive.defaultPrevented, false);
});

test('a replacement map receives capture guards on its next entry', () => {
  const h = harness(); h.c.mapCapture.enter(); h.c.mapCapture.leave();
  const callbacks = [];
  h.c.map = { model: {}, onChunk: id => callbacks.push(['chunk', id]), onContext: id => callbacks.push(['context', id]), setHover() {} };
  h.c.mapCapture.enter(); h.c.map.onChunk(7); h.c.map.onContext(8); assert.deepEqual(callbacks, []);
  h.c.mapCapture.leave(); h.c.map.onChunk(9); h.c.map.onContext(10);
  assert.deepEqual(callbacks, [['chunk', 9], ['context', 10]]);
});

test('capture clears hover and suppresses new hover IDs until leave', () => {
  const h = harness();
  h.c.map.setHover(123); assert.deepEqual(h.calls.at(-1), ['hover', 123]);
  h.c.mapCapture.enter(); assert.deepEqual(h.calls.at(-1), ['hover', null]);
  h.c.map.setHover(123); assert.deepEqual(h.calls.at(-1), ['hover', null]);
  h.c.map.setHover(null); assert.deepEqual(h.calls.at(-1), ['hover', null]);
  h.c.mapCapture.leave(); h.c.map.setHover(123); assert.deepEqual(h.calls.at(-1), ['hover', 123]);
});

test('download dialog renders both areas, reports progress and success, and revokes download URLs', async () => {
  for (const area of ['full', 'visible']) {
    const h = harness(); await h.nodes.get('map-image-open').emit('click');
    assert.equal(h.c.dialog.title, 'Download map image');
    const status = h.c.dialog.children.at(-1), button = h.dialogNode(area === 'full' ? 'Whole map PNG' : 'Visible area PNG');
    assert.equal(status.attributes.role, 'status');
    h.setRender(async (map, options) => {
      assert.equal(button.disabled, true); assert.equal(h.dialogNode('Cancel download').hidden, false);
      assert.equal(map, h.c.map); assert.equal(options.area, area); options.onProgress(.426);
      assert.equal(status.textContent, 'Drawing map… 43%');
      return { blob: {}, width: 1200, height: 800, missingTiles: area === 'full' ? 1 : 0 };
    });
    await button.emit('click');
    assert.deepEqual(h.downloads, [{ href: 'blob:map', name: `Player-map-${area === 'full' ? 'whole' : 'visible'}-map.png`, connected: true }]);
    assert.equal(h.document.body.children.length, 0); assert.match(status.textContent, /^Downloaded 1,200 × 800 PNG\./);
    assert.equal(status.textContent.includes('Some map artwork was unavailable.'), area === 'full');
    assert.equal(button.disabled, false); assert.equal(h.dialogNode('Cancel download').hidden, true);
    assert.deepEqual(h.revoked, []); h.flush(1000); assert.deepEqual(h.revoked, ['blob:map']); assert.deepEqual(h.writes, []);
  }
});

test('cancel button and dialog dismissal abort downloads, restore controls and allow retry', async () => {
  for (const dismissal of ['button', 'close', 'cancel']) {
    const h = harness(); h.c.mapCapture.downloadDialog();
    const button = h.dialogNode('Whole map PNG'), cancel = h.dialogNode('Cancel download'), status = h.c.dialog.children.at(-1);
    h.setRender((map, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))));
    const pending = button.emit('click');
    await h.dialogNode('Visible area PNG').emit('click'); assert.equal(h.renderCalls.length, 1, 'one generation runs at a time');
    if (dismissal === 'button') await cancel.emit('click'); else await h.nodes.get('tool-dialog').emit(dismissal);
    await pending; assert.equal(h.renderCalls[0].options.signal.aborted, true);
    assert.equal(status.textContent, 'Download cancelled.'); assert.equal(button.disabled, false); assert.equal(cancel.hidden, true);
    assert.deepEqual(h.downloads, []);
    h.setRender(async () => ({ blob: {}, width: 1, height: 1 })); await button.emit('click'); assert.equal(h.downloads.length, 1);
  }
});

test('render errors restore controls and stale dialog progress aborts without downloading', async () => {
  const h = harness(); h.c.mapCapture.downloadDialog(); const button = h.dialogNode('Whole map PNG'), status = h.c.dialog.children.at(-1);
  h.setRender(async () => { throw new Error('Canvas could not encode PNG'); }); await button.emit('click');
  assert.equal(status.textContent, 'Canvas could not encode PNG'); assert.equal(button.disabled, false); assert.deepEqual(h.downloads, []);
  h.setRender(async (map, options) => { h.staleDialog(); options.onProgress(.5); return { blob: {}, width: 1, height: 1 }; });
  await button.emit('click'); assert.equal(h.renderCalls.at(-1).options.signal.aborted, true);
  assert.equal(status.textContent, 'Drawing map…'); assert.deepEqual(h.downloads, []); assert.equal(button.disabled, false);
});

test('a completed image cannot download into a replacement dialog', async () => {
  const h = harness(); h.c.mapCapture.downloadDialog(); const oldStatus = h.c.dialog.children.at(-1);
  let complete;
  h.setRender(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.dialogNode('Whole map PNG').emit('click');
  h.c.mapCapture.downloadDialog(); const currentStatus = h.c.dialog.children.at(-1);
  complete({ blob: {}, width: 1, height: 1 }); await pending;
  assert.deepEqual(h.downloads, []); assert.deepEqual(h.revoked, []);
  assert.equal(currentStatus.textContent, 'Choose the whole map or the area currently on screen.');
  assert.equal(oldStatus.textContent, 'Drawing map…');
});
