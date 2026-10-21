import test from 'node:test';
import assert from 'node:assert/strict';
import { baseLocationId, buildChunkPlanningIndex, buildChunkPlanningIndexIncremental, createChunkPlanning } from '../app/web/chunk-planning.mjs';

const fixture = () => ({ chunks: { '12342': { Sections: { '1': { Object: { Anvil: 1 } }, '2': { NPC: { Banker: 1 } } } }, 'Puro-Puro': { Object: { Portal: 1 } }, 'Dorgesh-Kaan': {}, '9000': { Name: 'Dorgesh-Kaan' } }, clues: { easy: { '12342-1': true, 'Puro-Puro': false } }, codeItems: { chunksPlus: { 'Village[+]': ['12342-1', 'Puro-Puro'] } } });
const task = (id, record, sources = []) => ({ id, label: id, category: 'Extra', record, sources, status: 'blocked', blockers: [{ detail: 'Personal quest required.' }] });

test('incremental planning preserves the complete index and cancels changed views between slices', async t => {
  const definitions = fixture(), result = { tasks: Array.from({ length: 10 }, (_, index) => task(`task:${index}`, { Objects: ['Anvil'] })) };
  const expected = buildChunkPlanningIndex(definitions, result);
  let clock = 0; t.mock.method(performance, 'now', () => clock += 5);
  const actual = await buildChunkPlanningIndexIncremental(definitions, result);
  assert.deepEqual(actual.byLocation, expected.byLocation); assert.deepEqual(actual.clueLocations, expected.clueLocations);
  assert.equal(actual.canonical('9000'), expected.canonical('9000'));
  let current = true;
  const cancelled = buildChunkPlanningIndexIncremental(definitions, result, undefined, () => current); current = false;
  await assert.rejects(cancelled, /viewed chunk changed/);
});

test('numeric sections aggregate into their base without truncating named interiors', () => {
  assert.equal(baseLocationId('12342-1'), '12342'); assert.equal(baseLocationId('Puro-Puro'), 'Puro-Puro'); assert.equal(baseLocationId('Dorgesh-Kaan'), 'Dorgesh-Kaan');
  const definitions = fixture(), row = task('section', { Chunks: ['12342-1'] });
  const index = buildChunkPlanningIndex(definitions, { tasks: [row] });
  assert.ok(index.byLocation.get('12342').has(row.id)); assert.ok(index.byLocation.get('12342-1').has(row.id)); assert.equal(index.byLocation.get('12342-2'), undefined);
});

test('declared aliases, feature locations and interior aliases retain exact physical evidence', () => {
  const definitions = fixture(), alias = task('alias', { Chunks: ['Village[+]'] }), feature = task('feature', { Objects: ['Anvil'] }), interior = task('interior', { Chunks: ['Dorgesh-Kaan'] });
  const index = buildChunkPlanningIndex(definitions, { tasks: [alias, feature, interior] });
  assert.ok(index.byLocation.get('Puro-Puro').has('alias')); assert.ok(index.byLocation.get('12342').has('feature'));
  assert.equal(index.byLocation.get('12342').get('feature').evidence[0].location, '12342-1');
  assert.ok(index.byLocation.get('9000').has('interior')); assert.equal(index.byLocation.get('Puro'), undefined);
});

test('clue markers remain separate from gated task doability and source associations', () => {
  const definitions = fixture(), clue = task('clue', { ClueTier: 'easy' }, [{ location: 'Puro-Puro', kind: 'objects', name: 'Portal' }]);
  const index = buildChunkPlanningIndex(definitions, { tasks: [clue] });
  assert.deepEqual(index.clueLocations.get('Puro-Puro'), [{ tier: 'easy', location: 'Puro-Puro', marker: false }]);
  assert.equal(index.byLocation.get('Puro-Puro').get('clue').task.status, 'blocked');
  assert.equal(index.byLocation.get('Puro-Puro').get('clue').task.blockers[0].detail, 'Personal quest required.');
  assert.ok(index.clueLocations.get('12342').length); assert.equal(index.byLocation.get('12342'), undefined, 'A true clue-location marker invents no task');
});

test('primed location indexes survive result wrappers and first panel open without traversing tasks again', async () => {
  class Node {
    constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.events = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, action) { this.events[name] = action; }
  }
  const el = (tag, text) => new Node(tag, text), state = { revision: 1, members: [{ id: 'a' }] };
  let definitions = fixture(), traversals = 0;
  const row = task('primed', {}); Object.defineProperty(row, 'record', { get() { traversals++; return { Chunks: ['12342-1'] }; } });
  let result = { memberId: 'a', stateRevision: 1, tasks: [row] };
  const planning = createChunkPlanning({ el, button: (text, action) => { const node = el('button', text); node.events.click = action; return node; }, details: (title, ...nodes) => { const node = el('details'); node.append(el('summary', title), ...nodes); return node; }, list: () => el('ul'), plain: value => value, state: () => state, memberId: () => 'a', selectedChunkId: () => '12342', definitions: () => definitions, ensureResult: async () => result, showTask() {} });
  const primed = planning.prime(result); assert.equal(traversals, 1);
  assert.equal(planning.prime(result), primed); assert.equal(traversals, 1);
  state.revision = 2; result = { ...result, stateRevision: 2 };
  assert.equal(planning.prime(result), primed); assert.equal(traversals, 1);
  const node = planning.render('12342'); node.children[1].open = true; node.children[1].events.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(traversals, 1, 'First Possible Tasks open uses the primed index');
  const walk = node => [node, ...node.children.flatMap(walk)];
  // The panel opens on "Highest level" (doable tasks only); All shows every linked task.
  walk(node.children[1]).find(node => node.tag === 'button' && node.textContent.startsWith('All')).events.click();
  assert.ok(walk(node.children[1]).some(node => node.textContent === 'primed'));
  result = { ...result, tasks: [...result.tasks] }; assert.notEqual(planning.prime(result), primed); assert.equal(traversals, 2);
  definitions = fixture(); planning.prime(result); assert.equal(traversals, 3);
});

test('preferred derived section auto-opens and pending evidence cannot replace a different chunk view', async () => {
  class Node {
    constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.events = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, action) { this.events[name] = action; }
  }
  const el = (tag, text) => new Node(tag, text), state = { revision: 1, members: [{ id: 'a' }] }; let selected = '12342', release;
  const pending = new Promise(resolve => { release = resolve; });
  const planning = createChunkPlanning({ el, button: (text, action) => { const node = el('button', text); node.events.click = action; return node; }, details: (title, ...nodes) => { const node = el('details'); node.append(el('summary', title), ...nodes); return node; }, list: () => el('ul'), plain: value => value, state: () => state, memberId: () => 'a', selectedChunkId: () => selected, definitions: fixture, preferences: () => ({ defaultChunkinfo: 'clues' }), ensureResult: async () => pending, showTask() {} });
  const node = planning.render('12342'); assert.equal(node.children[0].open, true); assert.equal(node.children[1].open, false);
  node.children[0].events.toggle(); selected = 'Puro-Puro'; release({ stateRevision: 1, tasks: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(node.children[0].children[1].children[0].textContent, 'Loading tasks for this chunk…');
});

test('focused planning rows preserve every filter, clue marker and hidden task shown by the full index', async () => {
  class Node {
    constructor(tag, text) { Object.assign(this, { tag, textContent: text ?? '', children: [], events: {}, attributes: {}, value: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, action) { this.events[name] = action; }
  }
  const el = (tag, text) => new Node(tag, text), definitions = fixture(), state = { revision: 1, members: [{ id: 'a' }] };
  const tasks = [
    { ...task('highest', { Objects: ['Anvil'] }), category: 'Smithing', level: 50, status: 'available' },
    { ...task('lower', { Objects: ['Anvil'] }), category: 'Smithing', level: 10, status: 'available' },
    { ...task('hidden', { Chunks: ['12342-1'] }), hidden: true },
    task('clue', { ClueTier: 'easy' }, [{ location: '12342-1', name: 'Anvil' }]),
  ];
  const full = { tasks, memberId: 'a', stateRevision: 1, access: { bases: ['12342'], sections: ['12342-1'], areas: [] } };
  const index = buildChunkPlanningIndex(definitions, full);
  const focused = { format: 'chunk-planning-v1', chunkId: '12342', memberId: 'a', stateRevision: 1, access: full.access,
    rows: [...index.byLocation.get('12342').values()].map(({ task: { record, sources, ...display }, evidence }) => ({ task: { ...display, ...(record.ClueTier ? { record: { ClueTier: record.ClueTier } } : {}) }, evidence })),
    clueLocations: index.clueLocations.get('12342') };
  let fullRequests = 0, focusedRequests = 0;
  const context = { el, button: (text, action) => { const node = el('button', text); node.events.click = action; return node; },
    details: (title, ...nodes) => { const node = el('details'); node.append(el('summary', title), ...nodes); return node; }, list: () => el('ul'), plain: value => value,
    state: () => state, memberId: () => 'a', selectedChunkId: () => '12342', showTask() {}, ensureResult: async () => { fullRequests++; return full; } };
  const fallbackView = createChunkPlanning({ ...context, definitions: () => definitions }).render('12342');
  const focusedView = createChunkPlanning({ ...context, definitions: () => { throw new Error('Focused planning must not rebuild the declaration index'); },
    ensurePlanningResult: async chunkId => { assert.equal(chunkId, '12342'); focusedRequests++; return focused; } }).render('12342');
  for (const view of [fallbackView, focusedView]) for (const section of view.children) { section.open = true; section.events.toggle(); }
  await new Promise(resolve => setImmediate(resolve));
  const walk = node => [node, ...node.children.flatMap(walk)];
  const projection = node => walk(node).map(({ tag, textContent, attributes }) => ({ tag, textContent, attributes }));
  for (const filter of ['Highest level', 'Doable', 'Blocked', 'All']) {
    for (const view of [fallbackView, focusedView]) walk(view.children[1]).find(node => node.tag === 'button' && node.textContent.startsWith(filter)).events.click();
    assert.deepEqual(projection(focusedView), projection(fallbackView), filter);
  }
  assert.ok(walk(focusedView).some(node => node.textContent === 'hidden'), 'Hidden catalogue tasks remain visible in location planning');
  assert.equal(fullRequests, 2); assert.equal(focusedRequests, 2);
});

test('If unlocked lists the predicted new tasks, highest per skill, only for chunks this member has not unlocked', async () => {
  class Node {
    constructor(tag, text) { this.tag = tag; this.textContent = text ?? ''; this.children = []; this.events = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, action) { this.events[name] = action; }
  }
  const el = (tag, text) => new Node(tag, text), state = { revision: 1, members: [{ id: 'a' }] };
  const result = { memberId: 'a', stateRevision: 1, tasks: [task('linked', {})] };
  const predicted = { delta: { tasksAdded: [
    { id: 'w50', label: 'Cut a willow', category: 'Woodcutting', level: 30 },
    { id: 'w60', label: 'Cut a maple', category: 'Woodcutting', level: 45 },
    { id: 'q', label: 'Finish a quest', category: 'Quest' },
  ] } };
  let unlockable = true, predictions = 0;
  const context = { el, button: (text, action) => { const node = el('button', text); node.events.click = action; return node; },
    details: (title, ...nodes) => { const node = el('details'); node.append(el('summary', title), ...nodes); return node; }, list: () => el('ul'), plain: value => value,
    state: () => state, memberId: () => 'a', selectedChunkId: () => '12342', definitions: fixture, ensureResult: async () => result, showTask() {},
    unlockable: () => unlockable, predictUnlock: async () => { predictions++; return predicted; } };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const open = async () => { const node = createChunkPlanning(context).render('12342'); node.children[1].open = true; node.children[1].events.toggle(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); return node.children[1]; };
  let section = await open();
  const chip = walk(section).find(node => node.tag === 'button' && node.textContent.startsWith('If unlocked'));
  assert.ok(chip); assert.equal(chip.textContent, 'If unlocked'); assert.equal(predictions, 0, 'no prediction until asked');
  chip.events.click(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(chip.textContent, 'If unlocked 2', 'highest woodcutting task plus the quest');
  const texts = walk(section).map(node => node.textContent);
  assert.ok(texts.includes('Cut a maple')); assert.ok(texts.includes('Finish a quest'));
  assert.ok(texts.some(text => /Lower-level tasks in the same skills \(1\)/.test(text)));
  unlockable = false; section = await open();
  assert.ok(!walk(section).some(node => node.tag === 'button' && node.textContent.startsWith('If unlocked')), 'hidden for unlocked chunks');
  assert.ok(predictions >= 1);
});


test('clue locations show place names and section numbers while raw markers require Advanced', async () => {
  class Node {
    constructor(tag, text) { Object.assign(this, { tag, textContent: text ?? '', children: [], events: {}, value: '' }); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    addEventListener(name, action) { this.events[name] = action; }
  }
  const el = (tag, text) => new Node(tag, text);
  const walk = node => [node, ...node.children.flatMap(walk)];
  for (const [advanced, canWrite] of [[false, true], [true, true], [true, false]]) {
    const context = {
      el, button: text => el('button', text), details: (title, ...nodes) => { const node = el('details'); node.append(el('summary', title), ...nodes); return node; },
      plain: String, state: () => ({ revision: 1, members: [{ id: 'a' }] }), memberId: () => 'a', selectedChunkId: () => '12342',
      world: () => ({ chunks: new Map([['12342', { name: 'Edgeville' }]]) }), preferences: () => ({ advanced }), canWrite: () => canWrite,
      ensurePlanningResult: async () => ({ format: 'chunk-planning-v1', stateRevision: 1, rows: [], clueLocations: [{ tier: 'easy', location: '12342-1', marker: true }], access: { sections: ['12342-1'] } }),
    };
    const view = createChunkPlanning(context).render('12342'), clues = view.children[0]; clues.open = true; clues.events.toggle();
    await new Promise(resolve => setImmediate(resolve));
    const text = walk(clues).map(node => node.textContent).join('\n');
    assert.match(text, /easy · Edgeville · Section 1/);
    assert.match(text, /Reachable with your current chunks/);
    assert.equal(/Location ID: 12342-1/.test(text), advanced && canWrite);
    assert.equal(/Reference marker: true/.test(text), advanced && canWrite);
  }
});
