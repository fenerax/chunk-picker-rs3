import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createDeathChunks, deathMarkersFor, estimateHoursLabel } from '../app/web/death-chunks.mjs';

const fixtureState = () => createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
const estimate = (chunkId, hours, extras = {}) => ({ chunkId, memberId: 'player1', stateRevision: 0, thresholdHours: 1000, hours, death: hours > 1000, status: 'estimated-exceeds', breakdown: [], unknown: [], assumptions: [], ...extras });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

test('death skulls require current personal candidates above the unrounded threshold', () => {
  const state = fixtureState();
  state.members[0].unlocked = ['owned']; state.members[0].blacklisted = ['blacklisted']; state.members[0].pendingRoll = ['pending'];
  const rows = [estimate('above', 1000.000001), estimate('equal', 1000, { death: true }), estimate('below', 999.9, { death: true }),
    ...['owned', 'blacklisted', 'pending', 'outside'].map(id => estimate(id, 2000)),
    estimate('unknown', null, { death: true }), estimate('stale', 2000, { stateRevision: 1 }), estimate('partner', 2000, { memberId: 'player2' })];
  const markers = deathMarkersFor({ state, memberId: 'player1', candidateIds: rows.filter(row => row.chunkId !== 'outside').map(row => row.chunkId), estimates: rows });
  assert.deepEqual([...markers.keys()], ['above']);
});

test('skull visibility and threshold follow personal settings', () => {
  const state = fixtureState(), row = estimate('candidate', 1001);
  state.members[0].preferences = { showDeathChunks: false };
  assert.equal(deathMarkersFor({ state, memberId: 'player1', candidateIds: ['candidate'], estimates: [row] }).size, 0);
  state.members[0].preferences = { deathThresholdHours: 1001 };
  assert.equal(deathMarkersFor({ state, memberId: 'player1', candidateIds: ['candidate'], estimates: [row] }).size, 0);
  state.members[0].preferences.deathThresholdHours = 1000;
  assert.equal(deathMarkersFor({ state, memberId: 'player1', candidateIds: ['candidate'], estimates: [row] }).size, 1);
});

function controllerFixture(options = {}) {
  class Node {
    constructor(tag, text, className) { Object.assign(this, { tag, textContent: text, className, children: [], attributes: {}, connected: false }); }
    append(...nodes) { for (const node of nodes) { if (typeof node === 'object') node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = value; }
    get isConnected() { return this.connected || this.parent?.isConnected; }
  }
  const state = fixtureState(), calls = [], requests = [], timers = new Map(), map = { setDeathMarkers(value) { this.markers = value; } };
  const view = { state, memberId: 'player1', chunkId: 'candidate', open: true, pool: { eligible: [{ id: 'candidate' }] } };
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

test('background estimates are scheduled once per revision/member and candidate scoped', async () => {
  const h = controllerFixture(); h.view.state.members[0].selected = ['selected'];
  h.controller.refresh(); h.controller.refresh(); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 1);
  h.runTimer(); assert.equal(h.calls.length, 1); assert.ok(!h.calls[0].includes('chunkId'));
  h.requests[0].resolve(h.response([estimate('candidate', 2000), estimate('selected', 3000), estimate('outside', 5000)])); await flush();
  assert.deepEqual([...h.map.markers.keys()], ['candidate', 'selected']);
  h.controller.refresh(); assert.equal(h.timers.size, 0);
  h.controller.dispose();
});

test('display-only saves keep background estimates while gameplay and settings changes refresh them', async () => {
  let unchanged;
  const h = controllerFixture({
    canonicalTaskRevision: revision => unchanged?.to === revision ? unchanged.from : revision,
    compatibleTaskRevision: revision => revision === h.view.state.revision || (unchanged?.to === h.view.state.revision && revision >= unchanged.from && revision <= unchanged.to),
  });
  h.controller.refresh(); h.runTimer();
  h.requests[0].resolve(h.response([estimate('candidate', 2000)])); await flush();
  assert.deepEqual([...h.map.markers.keys()], ['candidate']);
  for (let save = 1; save <= 3; save++) {
    h.view.state = structuredClone(h.view.state); h.view.state.revision++; unchanged = { from: 0, to: h.view.state.revision };
    h.controller.refresh();
    assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 1); assert.deepEqual([...h.map.markers.keys()], ['candidate']);
  }
  assert.equal((await h.controller.estimateChunk('candidate')).hours, 2000); assert.equal(h.calls.length, 1);
  h.view.state = structuredClone(h.view.state); h.view.state.members[0].preferences = { deathThresholdHours: 3000 };
  h.controller.refresh(); assert.equal(h.timers.size, 1); assert.equal(h.map.markers.size, 0);
  h.runTimer(); assert.equal(h.calls.length, 2);
  h.view.state = structuredClone(h.view.state); h.view.state.revision++; unchanged = undefined;
  h.controller.refresh(); assert.equal(h.timers.size, 1); assert.equal(h.map.markers.size, 0);
  h.requests[1].resolve(h.response([estimate('candidate', 4000, { stateRevision: 3 })])); await flush();
  assert.equal(h.map.markers.size, 0, 'a reply for the replaced epoch is ignored');
  h.controller.dispose();
});

test('background estimates wait for foreground readiness and disabled skulls skip the batch', () => {
  let ready = false;
  const h = controllerFixture({ isForegroundReady: () => ready });
  h.controller.refresh(); assert.equal(h.timers.size, 0);
  ready = true; h.controller.refresh(); h.controller.refresh(); assert.equal(h.timers.size, 1);
  h.view.state = structuredClone(h.view.state); h.view.state.revision++;
  h.view.state.members[0].preferences = { showDeathChunks: false };
  h.controller.refresh(); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
  h.controller.dispose();
});

test('stale background responses cannot restore markers after a member switch', async () => {
  const h = controllerFixture(); h.controller.refresh(); h.runTimer();
  h.view.memberId = 'player2'; h.controller.refresh();
  h.requests[0].resolve(h.response([estimate('candidate', 2000)], { memberId: 'player1' })); await flush();
  assert.equal(h.map.markers.size, 0); assert.equal(h.timers.size, 1);
  h.controller.dispose();
});

