import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchDialog } from '../app/web/screen-search.mjs';
import { createScreenDialogs } from '../app/web/screen-dialogs.mjs';
import { projectPlayTask } from '../app/play-view.mjs';
import { chunkNotesForSearch, matchingSearchChunks, searchNoteExcerpt, sortSearchSources, searchLocations, searchPage } from '../app/web/screen-search-data.mjs';

test('chunk notes search both players, deduplicates name matches, and keeps ownership attribution', () => {
  const notes = chunkNotesForSearch([{ id: 'actor1', name: 'Player', notes: { '12341': 'Mine tin here', '12342': '   ' } },
    { id: 'reed', name: 'Reed', notes: { '12341': 'Bring a tin pickaxe', '12342': 'Bank here' } }]);
  const index = [{ id: '12341', name: 'Village', search: '12341 village tin' }, { id: '12342', name: 'Edgeville', search: '12342 edgeville' }];
  assert.deepEqual(matchingSearchChunks(index, notes, 'tin').map(entry => entry.id), ['12341']);
  assert.deepEqual(matchingSearchChunks(index, notes, 'bank').map(entry => entry.id), ['12342']);
  assert.deepEqual(notes.get('12341').map(note => [note.memberId, note.name]), [['actor1', 'Player'], ['reed', 'Reed']]);
  assert.equal(notes.get('12342').length, 1);
  const excerpt = searchNoteExcerpt(`${'long note '.repeat(60)}needle here${' after'.repeat(50)}`, 'needle');
  assert.ok(excerpt.startsWith('…')); assert.ok(excerpt.includes('needle')); assert.ok(excerpt.endsWith('…')); assert.ok(excerpt.length <= 162);
});

test('Search item sources follow descending rates, stable ties and ranked methods without mutating evidence', () => {
  const sources = Object.freeze([
    { kind: 'spawn', source: 'Ground' }, { kind: 'drop', source: 'Rare', rate: '1/1,000' },
    { kind: 'task', source: 'Unknown output', unknownRate: true }, { kind: 'shop', source: 'Shop' },
    { kind: 'drop', source: 'Always drop', rate: 'Always' }, { kind: 'task', source: 'Skill output', probability: .25 },
    { kind: 'drop', source: 'Tie', rate: '2/8' }, { kind: 'drop', source: 'Nested', rate: '1/2 × 1/4', probability: .125 },
    { kind: 'drop', source: 'Zero', probability: 0 }, { kind: 'task', source: 'Craft' },
  ].map(Object.freeze));
  assert.deepEqual(sortSearchSources(sources).map(source => source.source),
    ['Shop', 'Always drop', 'Skill output', 'Tie', 'Nested', 'Rare', 'Unknown output', 'Zero', 'Ground', 'Craft']);
  assert.equal(sources[0].source, 'Ground');
});

test('location extraction covers source locations, sections and direct item locations', () => {
  assert.deepEqual(searchLocations({ locations: ['12341'], sources: [{ locations: ['12341-2', '12342'] }, { location: '12342' }] }), ['12341', '12341-2', '12342']);
  assert.deepEqual(searchLocations({ sources: [{ location: '12341-1' }] }), ['12341-1']);
  assert.equal(searchPage(Array.from({ length: 241 }), 20).page, 2);
  assert.equal(searchPage(Array.from({ length: 241 }), 2).entries.length, 1);
  assert.deepEqual(searchPage([], 0), { entries: [], page: 0, pages: 1, first: 0, last: 0 });
});

function harness(t, { size = 241, evidence, delayed = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class Node {
    constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.events = {}; this.attributes = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    insertBefore(node, before) { const index = this.children.indexOf(before); if (index < 0) this.children.push(node); else this.children.splice(index, 0, node); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, action) { (this.events[type] ??= []).push(action); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    focus() { this.focused = true; }
    async emit(type) { for (const action of this.events[type] ?? []) await action({ target: this }); }
  }
  const dialog = new Node('dialog'), content = new Node('div'), ids = Array.from({ length: size }, (_, i) => String(10000 + i));
  const matches = [], opens = [], items = []; let chunkLoads = 0, fullLoads = 0, resolve;
  const pending = delayed ? new Promise(value => { resolve = value; }) : undefined;
  const state = { revision: 7, members: [{ id: 'actor1', name: 'Player', unlocked: [], selected: [], notes: { [ids[0]]: 'ore by the gate' } },
    { id: 'reed', name: 'Reed', unlocked: [], selected: [], notes: { [ids[0]]: 'Bring ore home' } }] };
  const c = { state, memberId: 'actor1', sandbox: { active: false }, dialogGeneration: 0,
    world: { chunks: new Map(ids.map(id => [id, { name: `Chunk ${id}` }])), areas: new Map() },
    chunkSearch: ids.map(id => ({ id, name: `Chunk ${id}`, search: `${id} chunk ore` })),
    result: evidence ?? { tasks: [] },
    map: { setSearchMatches: ids => matches.push([...ids]), centerOnChunk: id => opens.push(id) },
    $: id => id === 'tool-dialog' ? dialog : content,
    member: () => state.members.find(member => member.id === c.memberId), advanced: () => false,
    el: (tag, text, cls) => { const node = new Node(tag, text); node.className = cls; return node; },
    input: type => { const node = new Node('input'); node.type = type; return node; },
    select: (choices, value) => { const node = new Node('select'); node.value = value; return node; },
    button: (label, action) => { const node = new Node('button', label); node.addEventListener('click', action); return node; },
    field: (label, node) => node,
    ensureChunkSearch: async () => { chunkLoads++; }, ensureFullResult: () => { fullLoads++; return pending ?? Promise.resolve(c.result); },
    showChunk: id => opens.push(id), showItem: item => items.push(item), showTask: task => opens.push(task.id), renderTasks() {},
  };
  const search = createSearchDialog(c);
  c.openDialog = (title, ...nodes) => { search.clear(); dialog.open = true; content.replaceChildren(...nodes); return ++c.dialogGeneration; };
  c.closeDialog = () => { search.clear(); dialog.open = false; c.dialogGeneration++; };
  c.dialogCurrent = generation => dialog.open && generation === c.dialogGeneration;
  const all = () => content.children.flatMap(function walk(node) { return [node, ...node.children.flatMap(walk)]; });
  const find = text => all().find(node => node.textContent === text);
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const query = () => all().find(node => node.type === 'search'), mode = () => all().find(node => node.tagName === 'SELECT');
  const type = async value => { query().value = value; await query().emit('input'); t.mock.timers.tick(120); await settle(); };
  t.after(() => search.clear());
  return { c, search, all, find, query, mode, type, settle, matches, opens, items, resolve: value => resolve(value), loads: () => [chunkLoads, fullLoads] };
}

test('paging reaches every result while highlights cover the whole result set and notes name both players', async t => {
  const h = harness(t); h.search.open(); await h.settle(); await h.type('ore');
  assert.equal(h.all().filter(node => node.className === 'search-result').length, 120);
  assert.equal(h.matches.at(-1).length, 241);
  assert.ok(h.find('Player’s note: ore by the gate')); assert.ok(h.find('Reed’s note: Bring ore home'));
  const loads = h.loads();
  await h.find('Next').emit('click'); await h.find('Next').emit('click');
  assert.ok(h.find('Chunk 10240')); assert.equal(h.find('Next').disabled, true);
  assert.deepEqual(h.loads(), loads, 'paging never reruns search or loads evidence');
  assert.equal(h.matches.at(-1).length, 241);
  await h.find('View').emit('click'); assert.deepEqual(h.opens, ['10240', '10240']); assert.deepEqual(h.matches.at(-1), []);
});

test('off-map numeric and named interiors are distinct destinations with accurate types and notes', async t => {
  const h = harness(t);
  const name = 'Lair of the Rex Matriarchs';
  h.c.world.surface = new Set(['12850']);
  h.c.world.chunks = new Map([['1', { name }], ['12950', { name: 'Dorgesh-Kaan mine' }], ['12850', { name: 'Lumbridge' }]]);
  h.c.world.areas = new Map([[name, { name }]]);
  h.c.chunkSearch = [...h.c.world.chunks, ...h.c.world.areas].map(([id, row]) => ({ id, name: row.name, search: `${id} ${row.name}`.toLowerCase() }));
  h.c.state.members[0].notes = { '1': 'Numeric entrance note', [name]: 'Named interior note' };
  h.search.open(); await h.settle(); await h.type(name);
  assert.equal(h.all().filter(node => node.className === 'search-result').length, 2);
  assert.ok(h.find(`1 · ${name}`)); assert.ok(h.find(name));
  assert.ok(h.find('Off-map record · 1')); assert.ok(h.find(`Interior or connected area · ${name}`));
  assert.ok(h.find('No chunks highlighted'));
  assert.ok(h.find('Player’s note: Numeric entrance note')); assert.ok(h.find('Player’s note: Named interior note'));
  await h.find('View').emit('click'); assert.deepEqual(h.opens, [name, name]);
  h.search.open(); await h.settle(); await h.type('Dorgesh-Kaan mine');
  assert.ok(h.find('Off-map record · 12950')); assert.ok(h.find('No chunks highlighted'));
  await h.type('Lumbridge'); assert.ok(h.find('Surface chunk · Locked')); assert.ok(h.find('1 chunk highlighted in pink'));
});

test('opening Search clears the quest selection before taking over the shared highlight layer', async t => {
  const h = harness(t); let clears = 0; h.c.questMap = { clear() { clears++; } };
  h.search.open(); await h.settle();
  assert.equal(clears, 1); await h.type('ore'); assert.ok(h.matches.at(-1).length);
});

test('input coalesces, clears map immediately, and rejects stale visible result actions during loading', async t => {
  const h = harness(t); h.search.open(); await h.settle(); await h.type('ore');
  const oldView = h.find('View'); const before = h.loads()[0];
  for (const value of ['c', 'ch', 'chunk']) { h.query().value = value; await h.query().emit('input'); }
  assert.deepEqual(h.matches.at(-1), []); assert.equal(h.loads()[0], before);
  t.mock.timers.tick(120); await h.settle(); assert.equal(h.loads()[0], before + 1);
  await assert.rejects(oldView.emit('click'), /search changed/);
  await h.type(''); assert.deepEqual(h.matches.at(-1), []);
  h.search.clear(); assert.deepEqual(h.matches.at(-1), []);
});

test('viewers can toggle local highlights and item details receive sorted copies', async t => {
  const sources = [{ kind: 'drop', source: 'Rare', probability: .01, location: '10000' }, { kind: 'drop', source: 'Common', probability: .5, location: '10001' }];
  const h = harness(t, { evidence: { items: [{ name: 'Ore', sources }], tasks: [] } }); h.c.canWrite = () => false;
  h.search.open(); await h.settle(); await h.type('ore');
  const toggle = h.all().find(node => node.type === 'checkbox'); assert.ok(!toggle.disabled);
  toggle.checked = false; await toggle.emit('change'); assert.deepEqual(h.matches.at(-1), []);
  toggle.checked = true; await toggle.emit('change'); assert.equal(h.matches.at(-1).length, 241);
  h.mode().value = 'Items & drops'; await h.mode().emit('change'); assert.deepEqual(h.matches.at(-1), ['10000', '10001']);
  await h.find('View').emit('click'); assert.deepEqual(h.items[0].sources.map(source => source.source), ['Common', 'Rare']);
  assert.equal(sources[0].source, 'Rare');
});

test('map count excludes non-surface records and names a single highlighted chunk', async t => {
  const h = harness(t); h.c.world.surface = new Set(['10000']); h.search.open(); await h.settle(); await h.type('ore');
  assert.ok(h.find('1 chunk highlighted in pink'));
});

test('Tasks and training map matches include nested requirement locations', async t => {
  const h = harness(t, { evidence: { training: { Mining: { level: 50, primary: true } }, tasks: [
    { label: 'Mine ore', category: 'Mining', status: 'available', sources: [{ locations: ['10000-2', '10001'] }] },
    { label: 'Other ore', category: 'Mining', status: 'blocked', sources: [{ locations: ['10002'] }] },
  ] } });
  h.search.open(); await h.settle(); await h.type('ore'); h.mode().value = 'Tasks'; await h.mode().emit('change');
  assert.deepEqual(h.matches.at(-1), ['10000-2', '10001', '10002']);
  const images = h.all().filter(node => node.className === 'task-icon');
  assert.equal(images.length, 2);
  assert.equal(images[0].src, '/assets/SVG/rs3/mining-rs3.svg');
  assert.equal(images[0].width, 22); assert.equal(images[0].height, 22);
  await h.type('mining'); h.mode().value = 'Training methods'; await h.mode().emit('change');
  assert.deepEqual(h.matches.at(-1), ['10000-2', '10001']);
});

test('compact Task search enriches all locations without replacing rows, actions or the current page', async t => {
  const tasks = Array.from({ length: 241 }, (_, i) => ({ id: `task:${i}`, label: `Mine ore ${i}`, category: 'Mining', status: 'available', sources: [{ locations: [String(10000 + i)] }] }));
  const h = harness(t, { delayed: true, evidence: { format: 'play-v1', tasks: tasks.map(projectPlayTask) } });
  assert.equal(h.c.result.tasks[0].sources, undefined, 'fixture uses the shipped compact projection');
  h.search.open(); await h.settle(); await h.type('ore'); h.mode().value = 'Tasks'; await h.mode().emit('change');
  assert.equal(h.loads()[1], 1); assert.ok(h.find('Finding matching task locations…'));
  assert.equal(h.all().filter(node => node.className === 'search-result').length, 120);
  await h.find('Next').emit('click'); assert.ok(h.find('Page 2 of 3'));
  const view = h.find('View');
  h.resolve({ tasks: [...tasks.map(task => ({ ...task, label: 'Enriched label' })), { id: 'extra', label: 'Extra ore', sources: [{ location: '99999' }] }] }); await h.settle();
  assert.ok(h.find('Page 2 of 3')); assert.ok(h.find('Mine ore 120')); assert.ok(!h.find('Enriched label'));
  assert.equal(h.matches.at(-1).length, 241); assert.ok(!h.matches.at(-1).includes('99999'));
  assert.equal(h.find('View'), view, 'enrichment leaves rendered row actions untouched');
  await view.emit('click'); assert.deepEqual(h.opens, ['task:120']);
});

test('compact Tasks fetch locations only for enabled nonempty highlights and ignore a disabled pending result', async t => {
  const task = { id: 'ore', label: 'Mine ore', category: 'Mining', status: 'available', sources: [{ location: '10000' }] };
  const h = harness(t, { delayed: true, evidence: { format: 'play-v1', tasks: [projectPlayTask(task)] } });
  h.search.open(); await h.settle(); h.mode().value = 'Tasks'; await h.mode().emit('change'); assert.equal(h.loads()[1], 0);
  const toggle = h.all().find(node => node.type === 'checkbox'); toggle.checked = false; await toggle.emit('change');
  await h.type('ore'); assert.equal(h.loads()[1], 0);
  toggle.checked = true; await toggle.emit('change'); assert.equal(h.loads()[1], 1);
  toggle.checked = false; await toggle.emit('change'); h.resolve({ tasks: [task] }); await h.settle(); assert.deepEqual(h.matches.at(-1), []);
  toggle.checked = true; await toggle.emit('change'); await h.settle(); assert.deepEqual(h.matches.at(-1), ['10000']);
  assert.equal(h.loads()[1], 1, 'enabling the cached layer reuses its lookup');
});

test('viewer Task search remains usable when optional map evidence fails', async t => {
  const h = harness(t, { evidence: { format: 'play-v1', tasks: [{ id: 'ore', label: 'Mine ore', category: 'Mining', status: 'available' }] } });
  let attempts = 0;
  h.c.canWrite = () => false; h.c.ensureFullResult = async () => {
    if (++attempts === 1) throw new Error('Unavailable');
    return { tasks: [{ id: 'ore', sources: [{ location: '10000' }] }] };
  };
  h.search.open(); await h.settle(); await h.type('ore'); h.mode().value = 'Tasks'; await h.mode().emit('change'); await h.settle();
  assert.ok(h.find('Mine ore')); assert.ok(h.find('Task map locations are unavailable. Try the highlight switch again.'));
  assert.ok(!h.find('Retry search'));
  const toggle = h.all().find(node => node.type === 'checkbox'); toggle.checked = false; await toggle.emit('change');
  toggle.checked = true; await toggle.emit('change'); await h.settle(); assert.deepEqual(h.matches.at(-1), ['10000']);
  assert.equal(attempts, 2); await h.find('View').emit('click'); assert.deepEqual(h.opens, ['ore']);
});

for (const scope of ['query', 'mode', 'member', 'revision', 'close']) {
  test(`late compact Task locations cannot publish after a ${scope} change`, async t => {
    const task = { id: 'ore', label: 'Mine ore', category: 'Mining', status: 'available', sources: [{ location: '10000' }] };
    const h = harness(t, { delayed: true, evidence: { format: 'play-v1', tasks: [projectPlayTask(task)] } });
    h.search.open(); await h.settle(); await h.type('ore'); h.mode().value = 'Tasks'; await h.mode().emit('change');
    if (scope === 'query') { h.query().value = 'other'; await h.query().emit('input'); }
    if (scope === 'mode') { h.mode().value = 'Chunks'; await h.mode().emit('change'); }
    if (scope === 'member') h.c.memberId = 'reed';
    if (scope === 'revision') h.c.state.revision++;
    if (scope === 'close') h.c.closeDialog();
    const before = [...h.matches.at(-1)]; h.resolve({ tasks: [task] }); await h.settle();
    assert.deepEqual(h.matches.at(-1), before);
    assert.ok(!h.find('1 chunk highlighted in pink'));
  });
}

test('late evidence never repaints after search scope changes or closes', async t => {
  const h = harness(t, { delayed: true }); h.search.open(); await h.settle(); await h.type('ore');
  h.mode().value = 'Items & drops'; const render = h.mode().emit('change');
  h.c.closeDialog(); h.resolve({ items: [{ name: 'Late ore', sources: [{ location: '10000' }] }] }); await render;
  assert.ok(!h.find('Late ore')); assert.deepEqual(h.matches.at(-1), []);
});

test('Search Escape closes even after a saved revision changes', async t => {
  const previous = globalThis.document, document = new EventTarget(); globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const h = harness(t); h.search.open(); await h.settle(); await h.type('ore');
  h.c.state.revision++;
  const escape = new Event('keydown', { cancelable: true }); escape.key = 'Escape'; document.dispatchEvent(escape);
  assert.equal(h.c.$('tool-dialog').open, false); assert.equal(escape.defaultPrevented, true); assert.deepEqual(h.matches.at(-1), []);
});

test('uifix: a note match opens Note for the matching owners while a name match keeps the chosen tab', async t => {
  const h=harness(t);
  const chunkId=h.c.chunkSearch[0].id;
  for(const [query,owner] of [['gate',h.c.state.members[0].id],['home',h.c.state.members[1].id]]) {
    h.c.chunkTab='contents'; h.search.open(); await h.settle(); await h.type(query);await h.find('View').emit('click');
    assert.equal(h.c.chunkTab,'note');assert.deepEqual(h.c.chunkNoteReveal,{chunkId,memberIds:[owner],query});
  }
  h.c.chunkTab='contents'; h.search.open(); await h.settle(); await h.type(chunkId); await h.find('View').emit('click');
  assert.equal(h.c.chunkTab,'contents');
  assert.equal(h.c.chunkNoteReveal,undefined);
});

test('shipped dialog lifecycle allows Search map interaction and restores modal tools without stale close cleanup', async t => {
  const previous = globalThis.document, document = new EventTarget(); globalThis.document = document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const h = harness(t), dialog = h.c.$('tool-dialog'), content = h.c.el('div'), header = h.c.el('form'), title = h.c.el('h2'), classes = new Set();
  dialog.classList = { contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) };
  dialog.show = () => { dialog.open = true; dialog.modal = false; }; dialog.showModal = () => { dialog.open = true; dialog.modal = true; };
  dialog.close = () => { dialog.open = false; queueMicrotask(() => { void dialog.emit('close'); }); };
  h.c.$ = id => ({ 'tool-dialog': dialog, 'dialog-content': content, 'dialog-title': title }[id]);
  document.querySelector = () => header; h.c.duoHovers = new Map();
  createScreenDialogs(h.c); h.c.bindDialogLifecycle(); h.c.searchDialog(); await h.settle();
  assert.equal(dialog.modal, false); assert.ok(classes.has('search-dialog'));
  const query = content.children[0]; query.value = 'ore'; await query.emit('input'); t.mock.timers.tick(120); await h.settle();
  assert.equal(h.matches.at(-1).length, 241);
  h.c.openDialog('Another tool'); await h.settle();
  assert.equal(dialog.modal, true); assert.ok(!classes.has('search-dialog')); assert.deepEqual(h.matches.at(-1), []);
  h.c.searchDialog(); await h.settle();
  content.children[0].value = 'ore'; await content.children[0].emit('input'); t.mock.timers.tick(120); await h.settle();
  // A previously queued native close event must not clear the new open Search.
  await dialog.emit('close'); assert.equal(h.matches.at(-1).length, 241);
  dialog.open = false; await dialog.emit('close'); assert.deepEqual(h.matches.at(-1), []);
});


test('F4 blank chunk search shows surface results before numeric off-map records', async t => {
  const h = harness(t, { size: 1 });
  const interiors = Array.from({ length: 125 }, (_, i) => ({ id: String(i + 1), name: `Interior ${i + 1}`, search: `${i + 1} interior` }));
  h.c.world.surface = new Set(['10000']);
  h.c.chunkSearch = [...interiors, ...h.c.chunkSearch];
  h.c.world.chunks = new Map(h.c.chunkSearch.map(row => [row.id, { name: row.name }]));
  h.search.open(); await h.settle();
  assert.ok(h.find('Chunk 10000'));
  assert.equal(h.all().filter(node => node.className === 'search-result').length, 120);
  await h.type('125'); assert.ok(h.find('Off-map record · 125'));
});
