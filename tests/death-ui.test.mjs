import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createDeathChunks, deathMarkersFor, estimateHoursLabel } from '../app/web/death-chunks.mjs';

const fixtureState = () => createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
const estimate = (chunkId, hours, extras = {}) => ({ chunkId, memberId: 'actor1', stateRevision: 0, thresholdHours: 1000, hours, death: hours > 1000, status: 'estimated-exceeds', breakdown: [], unknown: [], assumptions: [], ...extras });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };



function controllerFixture(options = {}) {
  class Node {
    constructor(tag, text, className) { Object.assign(this, { tag, textContent: text, className, children: [], attributes: {}, connected: false }); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    get isConnected() { return this.connected || this.parent?.isConnected; }
  }
  const state = fixtureState(), calls = [], requests = [], timers = new Map(), map = { setDeathMarkers(value) { this.markers = value; } };
  const view = { state, memberId: 'actor1', chunkId: 'candidate', open: true, pool: { eligible: [{ id: 'candidate' }] } };
  const el = (tag, text, className) => new Node(tag, text, className);
  const ctx = { state: () => view.state, memberId: () => view.memberId, selectedChunkId: () => view.chunkId, isChunkOpen: () => view.open,
    pool: () => view.pool, map: () => map, el, details: (label, ...children) => { const node = el('details'); node.append(el('summary', label), ...children); return node; },
    list: values => { const node = el('ul'); values.forEach(value => node.append(el('li', value))); return node; },
    setTimeout: action => { const key = Symbol(); timers.set(key, action); return key; }, clearTimeout: key => timers.delete(key),
    api: path => { calls.push(path); const request = deferred(); requests.push(request); return request.promise; }, ...options };
  const controller = createDeathChunks(ctx);
  const runTimer = () => { const [key, action] = timers.entries().next().value; timers.delete(key); action(); };
  const response = (rows, extras = {}) => ({ memberId: view.memberId, stateRevision: view.state.revision, candidateIds: rows.map(row => row.chunkId), estimates: rows, ...extras });
  const texts = node => [node.textContent, ...node.children.flatMap(child => typeof child === 'object' ? texts(child) : child)].filter(Boolean).join(' ');
  return { controller, view, calls, requests, timers, map, runTimer, response, texts };
}




test('on-demand estimates coalesce requests and cache only within the state revision', async () => {
  const h = controllerFixture(), first = h.controller.estimateChunk('candidate'), second = h.controller.estimateChunk('candidate');
  assert.equal(h.calls.length, 1); assert.match(h.calls[0], /memberId=actor1&chunkId=candidate$/);
  h.requests[0].resolve(h.response([estimate('candidate', 2000)]));
  assert.equal((await first).hours, 2000); assert.equal((await second).hours, 2000);
  await h.controller.estimateChunk('candidate'); assert.equal(h.calls.length, 1);
  h.view.state = structuredClone(h.view.state); h.view.state.revision++;
  const changed = h.controller.estimateChunk('candidate'); assert.equal(h.calls.length, 2);
  h.requests[1].resolve(h.response([estimate('candidate', 1800, { stateRevision: 1 })])); assert.equal((await changed).hours, 1800);
  h.controller.dispose();
});

test('chunk estimate shows acquisition percentile, training supply cost and unknown evidence', async () => {
  const h = controllerFixture(), panel = h.controller.panel('candidate'); panel.connected = true;
  const drop = { label: 'Obtain rare item', kind: 'drop', hours: 1667, expectedKills: 100000, secondsPerKill: 60, kills95: 299572, acquisition95Hours: 4993,
    source: { source: 'Rat' }, sources: [{ title: 'Drop source', url: 'https://runescape.wiki/w/Rat' }],
    alternatives: [{ source: { source: 'Rat' }, hours: 1667 }, { source: { source: 'Imp' }, hours: null, unknown: [{ detail: 'No numeric probability.' }] }] };
  const training = { label: '99 Fletching', kind: 'training', hours: 3000, targetLevel: 99, skill: 'Fletching', startingXp: 2411,
    route: [{ label: 'Cut oak longbows', actions: 886532, xpPerAction: 14.7, hours: 3000, processingSeconds: 1595760, supplySeconds: 9204240, viaPartner: true }] };
  h.requests[0].resolve(h.response([estimate('candidate', 3000, { slowest: training, breakdown: [drop, training], unknown: [{ label: 'Another duty', detail: 'Drop rate unknown (Very rare)' }] })])); await flush();
  const text = h.texts(panel);
  assert.match(text, /Longest task with a known time: 99 Fletching/); assert.match(text, /95% chance to have the drop by: about 4,993 h/);
  assert.match(text, /gathering supplies about 2,557 h/); assert.match(text, /uses connected partner territory/);
  assert.match(text, /Drop rate unknown \(Very rare\)/); assert.match(text, /60 seconds per kill is a placeholder/);
  assert.match(text, /Imp · unknown · The drop rate is unknown/);
  assert.equal(panel.attributes['aria-live'], 'polite');
  h.controller.dispose();
});

test('responses for a closed or replaced chunk panel do not update its contents', async () => {
  const h = controllerFixture(), panel = h.controller.panel('candidate'); panel.connected = true;
  h.view.chunkId = 'other'; h.requests[0].resolve(h.response([estimate('candidate', 2000)])); await flush();
  assert.match(h.texts(panel), /Estimating new tasks/); assert.doesNotMatch(h.texts(panel), /Estimated death chunk/);
  h.controller.dispose();
});

test('multiple unresolved issues for one duty count as one duty with missing data', async () => {
  const h = controllerFixture(), panel = h.controller.panel('candidate'); panel.connected = true;
  h.requests[0].resolve(h.response([estimate('candidate', 20, { unknown: [
    { id: 'same-duty', label: 'Obtain an item', detail: 'Drop probability is unknown.' },
    { id: 'same-duty', label: 'Obtain an item', detail: 'A preparation method has no timing data.' },
  ] })])); await flush();
  const text = h.texts(panel);
  assert.match(text, /1 task has missing data/); assert.match(text, /Unknown estimates \(1 task; 2 details\)/);
  assert.match(text, /Drop probability is unknown/); assert.match(text, /preparation method has no timing data/);
  assert.doesNotMatch(text, /2 tasks/);
  h.controller.dispose();
});

test('hour labels avoid false decimal precision and preserve unknown estimates', () => {
  assert.equal(estimateHoursLabel(null), 'unknown'); assert.equal(estimateHoursLabel(0), '0 h');
  assert.equal(estimateHoursLabel(0.3), 'less than 1 h'); assert.equal(estimateHoursLabel(1700.12), 'about 1,700 h');
});

test('Advanced reveals calculation IDs while unknown death estimates remain clear in both modes', async () => {
  for (const advanced of [false, true]) {
    const h = controllerFixture({ preferences: () => ({ advanced }) }), panel = h.controller.panel('candidate'); panel.connected = true;
    const value = estimate('candidate', null, { catalogueVersion: 'test-catalogue', unknown: [{ id: 'raw-task-id', code: 'unknown-drop-probability', detail: 'No supported positive numeric drop probability is recorded.' }] });
    h.requests[0].resolve(h.response([value])); await flush();
    const text = h.texts(panel);
    assert.match(text, /1 task has missing data/); assert.match(text, /The drop rate is unknown/);
    assert.equal(text.includes('Calculation diagnostics'), advanced);
    assert.equal(text.includes('Task ID: raw-task-id'), advanced);
    assert.equal(text.includes('unknown-drop-probability'), advanced);
    assert.equal(text.includes('test-catalogue'), advanced);
    assert.doesNotMatch(text, /Unpriced|priced obligation|new obligations/);
    h.controller.dispose();
  }
});
