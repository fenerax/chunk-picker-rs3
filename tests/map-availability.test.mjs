import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAvailability, drawAvailabilityCell, availabilityDescription, createMapAvailability } from '../app/web/map-availability.mjs';
import { createPoolRanking, summarizePoolPrediction } from '../app/tasks/pool-ranking.mjs';
import { predictChunk } from '../app/core/planning.mjs';
import { createGroupState } from '../app/core/state.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('overlay uses planning additions including completion, backlog and alternatives, excluding hidden and optional tasks', () => {
  const state = createGroupState([{ id: 'one', name: 'One', unlocked: ['1'] }]);
  const tasks = [
    { id: 'done', completed: true }, { id: 'backlog', backlogged: true },
    { id: 'method-a' }, { id: 'method-b' }, { id: 'hidden', hidden: true },
    { id: 'optional', obligation: false }, { id: 'old' },
  ].map(row => ({ label: 'An option', category: 'Mining', ...row }));
  state.tasks = tasks.map(({ id, label, category }) => ({ id, label, category }));
  state.members[0].completedTasks = ['done'];
  state.members[0].taskStatus = { backlog: { backlogged: true } };
  const before = structuredClone(state);
  const prediction = predictChunk(state, 'one', '2', {
    world: { chunks: new Map([['1', {}], ['2', {}]]) },
    engine: { evaluate(value) { return { tasks: tasks.map(row => ({ ...row,
      status: value.members[0].unlocked.includes('2') || row.id === 'old' ? 'available' : 'locked' })),
    items: [], equipment: [], access: {}, training: {} }; } },
  });
  assert.deepEqual(prediction.delta.tasksAdded.map(row => row.id), ['backlog', 'done', 'method-a', 'method-b']);
  const summary = summarizePoolPrediction('2', prediction);
  assert.equal(summary.examples.length, 1, 'Truncated/deduplicated examples cannot determine the count');
  const model = projectAvailability({ rows: [summary] }, ['2']);
  assert.equal(model.counts.get('2'), 4);
  assert.equal(projectAvailability({ rows: [summary] }, ['2'], 'Mining').counts.get('2'), 4);
  assert.deepEqual(state, before);
});

test('partial pools distinguish zero from unknown, use complete retained skill counts and prune departed candidates', () => {
  const cache = createPoolRanking({ byteLimit: 1 }); cache.sync('input');
  cache.read('input', 'one', 0, ['1', '2', '3']);
  cache.remember('input', 'one', '1', { delta: { tasksAdded: [] } });
  cache.remember('input', 'one', '2', { delta: { tasksAdded: Array.from({ length: 12 }, (_, id) => ({ id, category: 'Mining' })) } });
  const data = cache.read('input', 'one', 0, ['1', '2', '3']);
  const model = projectAvailability(data, ['1', '2', '3']);
  assert.deepEqual([...model.counts], [['1', 0], ['2', 12], ['3', null]]);
  assert.deepEqual([model.checked, model.total, model.maximum], [2, 3, 12]);
  assert.equal(projectAvailability(data, ['2'], 'Mining').counts.get('2'), 12);
  assert.equal(projectAvailability(data, ['2'], 'Fishing').counts.get('2'), 0);
  assert.deepEqual([...projectAvailability(data, ['3']).counts], [['3', null]]);
  assert.equal(projectAvailability(data, ['3']).maximum, 0);
  assert.match(availabilityDescription(model, '1')[0], /0; checked/);
  assert.match(availabilityDescription(model, '3')[0], /unknown/);
});

test('canvas paints bounded inset heat, solid zero and dashed unknown without changing hit targets', () => {
  const model = projectAvailability({ rows: [{ id: '1', status: 'checked', count: 5 }, { id: '2', status: 'checked', count: 0 }] }, ['1', '2', '3']);
  const events = [];
  const context = { save() {}, restore() {}, setLineDash(value) { events.push(['dash', value]); },
    fillRect(...value) { events.push(['fill', value]); }, strokeRect(...value) { events.push(['stroke', value]); } };
  for (const id of ['1', '2', '3']) drawAvailabilityCell(context, model, id, 0, 0, 32);
  assert.equal(events.filter(([kind]) => kind === 'fill').length, 1);
  assert.equal(events.filter(([kind]) => kind === 'stroke').length, 3);
  assert.deepEqual(events.find(([kind, dash]) => kind === 'dash' && dash.length), ['dash', [3, 3]]);
  assert.ok(events.filter(([kind]) => kind === 'stroke').every(([, [x, y, width]]) => x > 0 && y > 0 && width < 32));
});

function harness(t) {
  class Node {
    constructor(tag, text) { this.tag = tag; this.textContent = text; this.children = []; this.events = {}; this.scrollTop = 0; }
    append(...values) { this.children.push(...values); }
    replaceChildren(...values) { this.children = values; }
    setAttribute() {}
    addEventListener(name, action) { this.events[name] = action; }
    contains(value) { return value === this || this.children.some(node => node.contains?.(value)); }
  }
  const document = globalThis.document;
  const listeners = {};
  globalThis.document = { hidden: false, addEventListener: (name, action) => { listeners[name] = action; } };
  t.after(() => { listeners.visibilitychange?.(); globalThis.document = document; });
  const requests = [], paints = [], centers = [];
  const c = { memberId: 'one', state: { revision: 1 }, pool: { eligible: [{ id: '2' }, { id: '3' }] },
    sandbox: { active: false }, dataset: { digest: 'dataset' }, plain: value => value ?? '',
    el: (tag, text) => new Node(tag, text), input: () => new Node('input'),
    button: (text, action) => Object.assign(new Node('button', text), { action }),
    map: { setAvailability: model => paints.push(model), centerOnChunk: id => centers.push(id) },
    api: (path, body, signal) => new Promise(resolve => requests.push({ path, body, signal, resolve })),
  };
  const overlay = createMapAvailability(c), group = overlay.controls();
  const toggle = group.children[0].children[0];
  t.after(() => { toggle.checked = false; toggle.events.change(); });
  return { c, requests, paints, centers, overlay, group, toggle };
}

test('wired controls default off, clear changed scopes, read without intent, and suspend in Sandbox', async t => {
  const h = harness(t); h.overlay.refresh(); assert.equal(h.requests.length, 0);
  h.toggle.checked = true; h.toggle.events.change();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body, undefined);
  h.requests[0].resolve({ memberId: 'one', stateRevision: 1, pickerId: 'legacy', datasetDigest: 'dataset', rows: [{ id: '2', status: 'checked', count: 0 }] });
  await flush(); assert.equal(h.paints.at(-1).counts.get('2'), 0);
  h.c.memberId = 'two'; h.overlay.refresh();
  assert.deepEqual([...h.paints.at(-1).counts.values()], [null, null]);
  assert.equal(h.requests.length, 2);
  h.c.sandbox.active = true; h.overlay.refresh(); assert.equal(h.paints.at(-1), null);
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve({ memberId: 'two', stateRevision: 1, pickerId: 'legacy', datasetDigest: 'dataset', rows: [{ id: '2', status: 'checked', count: 9 }] });
  await flush(); assert.equal(h.paints.at(-1), null);
  h.c.sandbox.active = false; h.overlay.refresh();
  assert.equal(h.paints.at(-1).counts.get('2'), null);
  assert.ok(h.requests.every(row => row.body === undefined && row.path.startsWith('/api/pool-ranking?')));
});
