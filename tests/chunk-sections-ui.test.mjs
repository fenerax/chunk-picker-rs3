import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSectionMask, sectionBoundarySegments, drawSectionOverlay, createChunkSections, sectionColor } from '../app/web/chunk-sections.mjs';

test('section colours remain distinct through Edgeville and Lumbridge fragment lists', () => {
  const colors = Array.from({ length: 42 }, (_, index) => sectionColor(index));
  assert.equal(new Set(colors.slice(0, 8)).size, 8);
  assert.equal(new Set(colors).size, 42);
  assert.ok(colors.every(color => /^#[a-fA-F0-9]{6}$/.test(color)));
});

function mask(tiles) {
  const bytes = Buffer.alloc(512);
  for (const [x, y] of tiles) { const bit = y * 64 + x; bytes[bit >>> 3] |= 1 << (bit & 7); }
  return { encoding: 'base64-bitset-lsb0-y64+x', data: bytes.toString('base64') };
}
function section(id, tiles, extra = {}) {
  return { id, kind: 'retained-section', retainedSectionIds: [id], cacheComponentIds: [], geometryStatus: 'exact', mask: mask(tiles), labelPoint: null, walkableTileCount: tiles.length, description: '', geometryReason: null, ...extra };
}
function payload(sections) {
  return { schemaVersion: 1, chunkId: '123', gridSize: 64, coordinateSystem: 'local-x-east-y-north', sections, coverage: {}, provenance: {} };
}
function drawingContext() {
  const calls = [];
  const context = { calls };
  for (const name of ['save', 'restore', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText']) {
    context[name] = (...args) => calls.push({ name, args, fillStyle: context.fillStyle, alpha: context.globalAlpha });
  }
  return context;
}
function documentHarness() {
  const ctx = drawingContext();
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.events = new Map();
      this.style = { setProperty: (key, value) => { this.style[key] = value; } };
      this.className = ''; this.textContent = ''; this.hidden = false;
      this.classList = {
        toggle: (name, state) => {
          const classes = new Set(this.className.split(' ').filter(Boolean));
          if (state ?? !classes.has(name)) classes.add(name); else classes.delete(name);
          this.className = [...classes].join(' ');
        },
        add: name => this.classList.toggle(name, true),
      };
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    addEventListener(type, callback) { const handlers = this.events.get(type) ?? new Set(); handlers.add(callback); this.events.set(type, handlers); }
    removeEventListener(type, callback) { this.events.get(type)?.delete(callback); }
    async emit(type, details = {}) { for (const handler of this.events.get(type) ?? []) await handler({ target: this, relatedTarget: null, ...details }); }
    getContext() { return ctx; }
  }
  const document = { createElement: tag => new Node(tag) };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const find = (element, className) => walk(element).find(node => node.className.split(' ').includes(className));
  const rows = element => walk(element).filter(node => node.className.split(' ').includes('chunk-section-row'));
  return { document, ctx, walk, find, rows };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('viewer section overrides retain their saved values and never save even after a dispatched change', async () => {
  const h = documentHarness(); let saves = 0;
  const ui = createChunkSections({document:h.document,canWrite:() => false,chunkId:'123',topologyKeys:['0'],overrides:{'123-0':true},load:async () => payload([section('123-0',[[0,0]])]),onOverride:async () => {saves++;}});
  await flush(); const select = h.find(ui.element,'chunk-section-select');
  assert.equal(select.disabled,true); assert.equal(select.value,'true'); select.value='false'; await select.emit('change');
  assert.equal(select.value,'true'); assert.equal(select.disabled,true); assert.equal(saves,0);
  ui.dispose();
});

test('mask decode requires exactly 512 bytes and the stated encoding; boundaries use local north-up grid edges', () => {
  const bytes = decodeSectionMask(mask([[0, 0], [7, 0], [8, 0], [63, 63]]));
  assert.equal(bytes.length, 512);
  assert.equal(bytes[0], 0x81); assert.equal(bytes[1], 0x01); assert.equal(bytes[511], 0x80);
  assert.equal(decodeSectionMask(null), null);
  assert.equal(decodeSectionMask({ ...mask([]), encoding: 'other' }), null);
  for (const size of [0, 511, 513]) assert.equal(decodeSectionMask({ encoding: 'base64-bitset-lsb0-y64+x', data: Buffer.alloc(size).toString('base64') }), null);
  assert.equal(decodeSectionMask({ ...mask([]), data: '!'.repeat(684) }), null);
  assert.deepEqual(sectionBoundarySegments(mask([[2, 3]])), [[[2, 3], [3, 3]], [[3, 3], [3, 4]], [[3, 4], [2, 4]], [[2, 4], [2, 3]]]);
  const edges = sectionBoundarySegments(mask([[2, 3], [3, 3]]));
  assert.equal(edges.length, 6);
  assert.ok(!edges.some(([a, b]) => a[0] === 3 && b[0] === 3));
  assert.deepEqual(sectionBoundarySegments(null), []);
});

test('overlay puts north tiles at the top, labels all known sections, and never outlines unknown masks', () => {
  const ctx = drawingContext();
  drawSectionOverlay(ctx, [section('123-0', [[0, 0]]), section('123-2', [[63, 63]]), section('cache-7', [[32, 32]], { kind: 'cache-component' }), section('123-3', [[4, 4]], { geometryStatus: 'unknown' })]);
  const tiles = ctx.calls.filter(call => call.name === 'fillRect' && call.args[2] === 4);
  assert.deepEqual(tiles.map(call => call.args), [[0, 252, 4, 4], [128, 124, 4, 4], [252, 0, 4, 4]]);
  assert.deepEqual(ctx.calls.filter(call => call.name === 'fillText').map(call => call.args[0]), ['0', '2', 'C1']);
});

test('shared aggregate masks get one tile fill and separately readable badges, with highlight colour precedence', () => {
  const ctx = drawingContext(), shared = [[30, 30]];
  drawSectionOverlay(ctx, [section('123-0', shared, { color: '#111111' }), section('123-1', shared, { color: '#222222' })], { highlightedId: '123-1' });
  const tile = ctx.calls.filter(call => call.name === 'fillRect' && call.args[2] === 4);
  assert.equal(tile.length, 1); assert.equal(tile[0].fillStyle, '#222222');
  const labels = ctx.calls.filter(call => call.name === 'fillText');
  assert.equal(labels.length, 2); assert.notDeepEqual(labels[0].args.slice(1), labels[1].args.slice(1));
});

test('integer label anchors identify tile centres rather than tile corners', () => {
  const ctx = drawingContext();
  drawSectionOverlay(ctx, [section('123-1', [[30, 30]], { labelPoint: { x: 30, y: 30 } })]);
  assert.deepEqual(ctx.calls.find(call => call.name === 'fillText').args, ['1', 122, 134]);
});

test('retained controls are immediate and retain section 0 semantics while geometry is pending', async () => {
  const h = documentHarness(), writes = [];
  let complete;
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0', '2'], overrides: { '123-0': false }, load: () => new Promise(resolve => { complete = resolve; }), onOverride: async (...args) => writes.push(args) });
  const rows = h.rows(ui.element), selects = rows.map(row => h.find(row, 'chunk-section-select'));
  assert.deepEqual(rows.map(row => row.dataset.sectionId), ['123-0', '123-2']);
  assert.equal(selects[0].value, 'false'); assert.equal(selects[1].value, 'auto');
  assert.deepEqual(selects[0].children.map(option => option.textContent), ['Automatic', 'Accessible', 'Blocked']);
  selects[0].value = 'auto'; await selects[0].emit('change');
  selects[1].value = 'true'; await selects[1].emit('change');
  selects[1].value = 'false'; await selects[1].emit('change');
  assert.deepEqual(writes, [['123-0', null], ['123-2', true], ['123-2', false]]);
  await flush(); complete(payload([section('123-0', [[0, 0]])])); await flush();
  assert.strictEqual(h.find(h.rows(ui.element)[0], 'chunk-section-select'), selects[0]);
  assert.match(h.find(rows[1], 'chunk-section-detail').textContent, /Outline unavailable|outline could not be loaded/);
  assert.ok(!h.ctx.calls.some(call => call.name === 'fillText' && call.args[0] === '2'));
  ui.dispose();
});

test('unmapped cache components are display only and unsafe description markup stays text', async () => {
  const h = documentHarness(), description = '<img src=x onerror=alert(1)>';
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['1'], load: async () => payload([section('123-1', [[1, 1]]), section('123-1000007', [[8, 8]], { kind: 'cache-component', description })]) });
  await flush();
  const rows = h.rows(ui.element); assert.equal(rows.length, 2);
  assert.equal(h.find(rows[1], 'chunk-section-select'), undefined);
  assert.equal(h.find(rows[1], 'chunk-section-badge').textContent, 'C1');
  assert.match(h.find(rows[1], 'chunk-section-detail').textContent, /Map only/);
  assert.ok(h.find(rows[1], 'chunk-section-detail').textContent.includes(description));
  assert.equal(h.walk(ui.element).filter(node => node.tagName === 'img').length, 0);
  ui.dispose();
});

test('focus including the select survives pointer leave, hover can temporarily select another row, and blur clears it', async () => {
  const h = documentHarness(), highlighted = [];
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0', '1'], load: async () => payload([section('123-0', [[1, 1]]), section('123-1', [[2, 2]])]), onHighlight: item => highlighted.push(item) });
  await flush(); const [a, b] = h.rows(ui.element), select = h.find(a, 'chunk-section-select');
  await a.emit('pointerenter'); assert.equal(highlighted.at(-1).id, '123-0');
  await a.emit('focusin', { target: select });
  await a.emit('pointerleave'); assert.equal(highlighted.at(-1).id, '123-0');
  await a.emit('focusout', { relatedTarget: select }); assert.equal(highlighted.at(-1).id, '123-0');
  await b.emit('pointerenter'); assert.equal(highlighted.at(-1).id, '123-1');
  await b.emit('pointerleave'); assert.equal(highlighted.at(-1).id, '123-0');
  assert.match(highlighted.at(-1).color, /^#[\da-f]{6}$/i); assert.equal(highlighted.at(-1).displayNumber, '0');
  await a.emit('focusout'); assert.equal(highlighted.at(-1), null);
  ui.dispose();
});

test('endpoint failure keeps controls usable and retry replaces unknown outlines', async () => {
  const h = documentHarness(); let attempts = 0;
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0'], load: async () => { if (++attempts === 1) throw new Error('private backend details'); return payload([section('123-0', [[4, 5]])]); } });
  await flush();
  const row = h.rows(ui.element)[0], select = h.find(row, 'chunk-section-select'), retry = h.find(ui.element, 'chunk-section-retry');
  assert.equal(retry.hidden, false); assert.equal(select.disabled, false);
  assert.match(h.find(ui.element, 'chunk-section-status').textContent, /could not be loaded/);
  assert.ok(!h.walk(ui.element).some(node => node.textContent.includes('private backend')));
  await retry.emit('click'); assert.equal(attempts, 2); assert.equal(retry.hidden, true);
  assert.strictEqual(h.find(row, 'chunk-section-select'), select);
  assert.match(h.find(row, 'chunk-section-detail').textContent, /1 walkable tiles/);
  ui.dispose();
});

test('invalid contract and malformed exact masks cannot create misleading outlines', async () => {
  for (const invalid of [payload([section('123-0', [[1, 1]], { mask: { ...mask([]), data: Buffer.alloc(511).toString('base64') } })]), { ...payload([]), coordinateSystem: 'screen-down' }]) {
    const h = documentHarness();
    const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0'], load: async () => invalid });
    await flush();
    assert.ok(!h.ctx.calls.some(call => call.name === 'fillText'));
    assert.match(h.find(h.rows(ui.element)[0], 'chunk-section-detail').textContent, /Outline unavailable|outline could not be loaded/);
    ui.dispose();
  }
});

test('failed override restores the saved value and reports a reusable row error', async () => {
  const h = documentHarness(); let fails = true;
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0'], load: async () => payload([]), onOverride: async () => { if (fails) throw new Error('detail'); } });
  const row = h.rows(ui.element)[0], select = h.find(row, 'chunk-section-select');
  select.value = 'true'; await select.emit('change');
  assert.equal(select.value, 'auto'); assert.equal(select.disabled, false); assert.ok(h.find(row, 'chunk-section-save-error'));
  fails = false; select.value = 'false'; await select.emit('change'); assert.equal(h.find(row, 'chunk-section-save-error'), undefined);
  fails = true; select.value = 'true'; await select.emit('change'); assert.equal(select.value, 'false'); assert.ok(h.find(row, 'chunk-section-save-error'));
  ui.dispose();
});

test('terrain updates redraw the shared crop and dispose unsubscribes once, clearing highlight and ignoring late load', async () => {
  const h = documentHarness(), highlights = []; let redraw, crops = 0, unsubscribed = 0, complete;
  const ui = createChunkSections({ document: h.document, chunkId: '123', topologyKeys: ['0'], load: () => new Promise(resolve => { complete = resolve; }), drawTerrain: (ctx, size) => { assert.strictEqual(ctx, h.ctx); assert.equal(size, 256); crops++; }, subscribeTerrain: callback => { redraw = callback; return () => unsubscribed++; }, onHighlight: item => highlights.push(item) });
  await flush(); const initial = crops; redraw(); assert.equal(crops, initial + 1);
  await h.rows(ui.element)[0].emit('pointerenter'); ui.dispose(); ui.dispose();
  assert.equal(unsubscribed, 1); assert.equal(highlights.at(-1), null);
  const calls = h.ctx.calls.length; complete(payload([section('123-0', [[5, 5]])])); await flush(); redraw();
  assert.equal(h.ctx.calls.length, calls);
  const events = highlights.length; await h.rows(ui.element)[0].emit('pointerenter'); assert.equal(highlights.length, events);
});
