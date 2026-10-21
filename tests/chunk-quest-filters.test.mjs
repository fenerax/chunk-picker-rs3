import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkQuestList } from '../app/web/chunk-quest-filters.mjs';
import { writeActivityFilters, readActivityFilters } from '../app/web/activity-filters.mjs';

class Node {
  constructor(tag, text = '', className = '') { Object.assign(this, { tag, textContent: text, className, children: [], attributes: {}, events: {} }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, action) { this.events[key] = action; }
  emit(key) { return this.events[key]?.(); }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const entries = [['Finished', 2], ['Started', 3], ['Fresh', 1], ['Unknown', 'note']];
const full = () => ({ memberId: 'actor1', stateRevision: 7, tasks: [
  { id: 'done', category: 'Quest', baseQuest: 'Finished' },
  { id: 'started', category: 'Quest', record: { BaseQuest: 'Started' } },
  { id: 'fresh', category: 'Quest', rawLabel: 'Do a step ~|Fresh#2|~' },
  { id: 'fresh-high', category: 'Quest', rawLabel: 'Another step ~|Fresh#3|~' },
], activityInfo: { quests: [], questStates: {
  done: { questStatus: 'done', canDoNow: false, level: 0 },
  started: { questStatus: 'in-progress', canDoNow: false, level: 5 },
  fresh: { questStatus: 'not-started', canDoNow: true, level: 1 },
  'fresh-high': { questStatus: 'not-started', canDoNow: true, level: 10 },
} } });
function harness({ source, preferences, response = Promise.resolve(full()), entries: names = entries } = {}) {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  if (preferences) writeActivityFilters(storage, { 'Chunk quests': preferences });
  let calls = 0;
  const el = (tag, text, cls) => new Node(tag, text, cls);
  const button = (text, action, cls) => { const node = el('button', text, cls); node.addEventListener('click', action); return node; };
  const c = { memberId: 'actor1', chunkId: '12341', state: { revision: 7 }, el, button, storage, plain: value => String(value).replace(/~\|([^|]+)\|~/g, '$1'), fullResult: source, ensureFullResult: () => { calls++; return response; }, command: () => assert.fail('No gameplay commands') };
  const root = createChunkQuestList(c, names), walk = node => [node, ...node.children.flatMap(walk)], nodes = () => walk(root);
  const chip = name => nodes().find(node => node.tag === 'button' && node.textContent === name);
  const labels = () => nodes().filter(node => node.className === 'content-row').map(node => node.children[0].textContent);
  const select = async name => { chip(name).emit('click'); await flush(); };
  return { root, c, nodes, chip, labels, select, calls: () => calls, storage };
}

test('All shows original quest names immediately and only loads evidence when a choice needs it', async () => {
  const response = deferred(), h = harness({ response: response.promise });
  assert.deepEqual(h.labels(), ['Finished × 2', 'Started × 3', 'Fresh × 1', 'Unknown']);
  await flush(); assert.equal(h.calls(), 0);
  await h.select('Done'); assert.equal(h.calls(), 1); response.resolve(full()); await flush();
  assert.deepEqual(h.labels(), ['Finished × 2']);
  await h.select('All'); assert.equal(h.labels().length, 4); assert.equal(h.calls(), 1);
});

test('source-only quest states provide progress and readiness with unknown names excluded', async () => {
  const h = harness({ source: full() });
  await h.select('Not started'); assert.deepEqual(h.labels(), ['Fresh × 1']);
  await h.select('In progress'); assert.deepEqual(h.labels(), ['Started × 3', 'Fresh × 1']);
  await h.select('Can do now'); assert.deepEqual(h.labels(), ['Fresh × 1']);
  await h.select('All'); await h.select('Can do now'); assert.deepEqual(h.labels(), ['Fresh × 1']);
  assert.equal(h.calls(), 0); assert.equal(readActivityFilters(h.storage)['Chunk quests'].questStatuses[0], 'can-do-now');
});

test('base quests and named wish-list follow-ups retain independent progress and readiness', async () => {
  const source = full();
  source.tasks = [{ id: 'base', category: 'Quest', baseQuest: "Fur 'n Seek" },
    { id: 'wish', category: 'Quest', record: { BaseQuest: "Fur 'n Seek#Wish List" } }];
  source.activityInfo.questStates = { base: { questStatus: 'done', canDoNow: false },
    wish: { questStatus: 'not-started', canDoNow: true } };
  const h = harness({ source, entries: [["Fur 'n Seek", 1], ["Fur 'n Seek#Wish List", 1]] });
  await h.select('Done'); assert.deepEqual(h.labels(), ["Fur 'n Seek × 1"]);
  await h.select('All'); await h.select('Can do now');
  assert.deepEqual(h.labels(), ["Fur 'n Seek#Wish List × 1"]);
});

test('stored filters fail closed until metadata arrives and loading is visible', async () => {
  const response = deferred(), h = harness({ preferences: { questStatuses: ['done'] }, response: response.promise });
  assert.deepEqual(h.labels(), []); assert.ok(h.nodes().some(node => node.textContent === 'Loading quest progress…'));
  await flush(); response.resolve(full()); await flush(); assert.deepEqual(h.labels(), ['Finished × 2']);
});

test('level sort uses maximum quest level and retains displayed labels and counts', async () => {
  const h = harness({ source: full() });
  const sort = h.nodes().find(node => node.tag === 'select'); sort.value = 'level'; sort.emit('change');
  assert.deepEqual(h.labels(), ['Started × 3', 'Fresh × 1', 'Finished × 2', 'Unknown']);
  assert.equal(h.calls(), 0);
});

test('activity groups provide a fallback without overriding content names or counts', async () => {
  const source = { memberId: 'actor1', stateRevision: 7, tasks: [], activityInfo: { quests: [{ name: 'Finished', tasks: [{ id: 'x', label: 'Whole quest', questStatus: 'done', canDoNow: false, level: 1 }] }] } };
  const h = harness({ source }); await h.select('Done'); assert.deepEqual(h.labels(), ['Finished × 2']);
});

test('viewers use the same local filters without saved state changes or requests', async () => {
  const h = harness({ source: full() }), before = structuredClone(h.c.state);
  h.c.canWrite = () => false;
  await h.select('Done'); assert.deepEqual(h.labels(), ['Finished × 2']);
  await h.select('All'); await h.select('Can do now'); assert.deepEqual(h.labels(), ['Fresh × 1']);
  assert.deepEqual(h.c.state, before); assert.equal(h.calls(), 0);
});

test('metadata for a different member or revision is refused and retry is offered', async () => {
  for (const change of ['memberId', 'stateRevision']) {
    const source = full(); source[change] = change === 'memberId' ? 'reed' : 8;
    const h = harness({ response: Promise.resolve(source), preferences: { questStatuses: ['done'] } }); await flush();
    assert.deepEqual(h.labels(), []); assert.ok(h.chip('Retry quest progress'));
    assert.ok(h.nodes().some(node => node.className === 'error'));
  }
});

test('late results and errors do not publish after member, revision, chunk or attachment changes', async () => {
  for (const change of ['member', 'revision', 'chunk', 'detached']) for (const fails of [false, true]) {
    const response = deferred(), h = harness({ response: response.promise, preferences: { questStatuses: ['done'] } }); await flush();
    if (change === 'member') h.c.memberId = 'reed';
    if (change === 'revision') h.c.state.revision++;
    if (change === 'chunk') h.c.chunkId = '12342';
    if (change === 'detached') h.root.isConnected = false;
    if (fails) response.reject(Error('Stale failure')); else response.resolve(full());
    await flush(); assert.deepEqual(h.labels(), [], `${change}/${fails}`);
    assert.ok(!h.nodes().some(node => node.className === 'error'), `${change}/${fails}`);
  }
});

test('a failed load retries only on explicit action and chip changes do not recalculate', async () => {
  const response = deferred(), h = harness({ response: response.promise, preferences: { questStatuses: ['done'] } }); await flush();
  response.reject(Error('Offline')); await flush(); assert.equal(h.calls(), 1);
  await h.select('In progress'); assert.equal(h.calls(), 1);
  h.c.ensureFullResult = () => full(); await h.chip('Retry quest progress').emit('click'); await flush();
  assert.deepEqual(h.labels(), ['Finished × 2', 'Started × 3']);
  assert.ok(!h.nodes().some(node => node.className === 'error'));
});
