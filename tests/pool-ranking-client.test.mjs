import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoolRankingClient, createPassivePoolRankingClient, rankPoolRows } from '../app/web/pool-ranking.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('comparison opens on private HTTP origins where randomUUID is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true,
      value: { getRandomValues: bytes => bytes.fill(7) } });
    const client = createPoolRankingClient({});
    client.dispose();
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});

function harness({ api, viewer = false, passive = false } = {}) {
  let time = 0, timerId = 0;
  const state = { memberId: 'actor1', revision: 7, sandboxActive: false, pickerId: 'picker-a', datasetDigest: 'dataset-a', candidatesKey: '1,2', hidden: false, settled: false };
  const timers = new Map(), requests = [], updates = [], errors = [];
  const response = () => ({ memberId: state.memberId, stateRevision: state.revision, pickerId: state.pickerId, datasetDigest: state.datasetDigest, total: 2, checked: 0, rows: [] });
  const client = (passive ? createPassivePoolRankingClient : createPoolRankingClient)({
    scope: () => ({ memberId: state.memberId, revision: state.revision, sandboxActive: state.sandboxActive,
      ...(passive ? { pickerId: state.pickerId, datasetDigest: state.datasetDigest, candidatesKey: state.candidatesKey } : {}) }),
    canWrite: () => !viewer, foregroundSettled: () => state.settled, hidden: () => state.hidden,
    watchId: 'test_tab', now: () => time,
    setTimeout: (action, delay) => { const id = ++timerId; timers.set(id, { action, time: time + delay }); return id; },
    clearTimeout: id => timers.delete(id), onUpdate: value => updates.push(value), onError: error => errors.push(error),
    api: (path, body, signal) => { const entry = { path, body, signal }; requests.push(entry); return api ? api(entry, response) : Promise.resolve(body ? {} : response()); },
  });
  async function advance(ms) {
    const end = time + ms;
    while ([...timers.values()].some(timer => timer.time <= end)) {
      const [id, timer] = [...timers].sort(([, a], [, b]) => a.time - b.time)[0];
      time = timer.time; timers.delete(id); timer.action(); await flush();
    }
    time = end; await flush();
  }
  return { client, state, requests, updates, errors, advance, timers };
}

test('visible ranking reads cached rows immediately and renews interest only after foreground settles', async () => {
  const h = harness(); h.client.refresh(); await h.advance(12000); assert.equal(h.requests.length, 0);
  h.client.setVisible(true); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body, undefined);
  assert.equal(h.updates.length, 1);
  h.state.settled = true; h.client.refresh(); await flush();
  assert.deepEqual(h.requests[1].body, { memberId: 'actor1', revision: 7, watchId: 'test_tab', visible: true });
  await h.advance(10000);
  assert.equal(h.requests.filter(row => row.body?.visible === true).length, 2);
  assert.equal(h.requests.filter(row => row.body === undefined).length, 11);
  h.client.setVisible(false); await flush();
  assert.deepEqual(h.requests.at(-1).body, { memberId: 'actor1', revision: 7, watchId: 'test_tab', visible: false });
  const count = h.requests.length; await h.advance(30000); assert.equal(h.requests.length, count); assert.equal(h.timers.size, 0);
});

test('viewer reads use GET alone and a hidden document suspends polling', async () => {
  const h = harness({ viewer: true }); h.state.settled = true; h.client.setVisible(true); await flush(); await h.advance(11000);
  assert.equal(h.requests.length, 12); assert.ok(h.requests.every(row => row.body === undefined));
  h.state.hidden = true; h.client.refresh(); const count = h.requests.length;
  await h.advance(20000); assert.equal(h.requests.length, count);
  h.state.hidden = false; h.client.refresh(); await flush(); assert.equal(h.requests.length, count + 1);
  h.client.dispose();
});

test('player and save changes abort old reads and reject late or mismatched summaries', async () => {
  const pending = [];
  const h = harness({ api: entry => { if (entry.body) return Promise.resolve({}); const task = deferred(); pending.push(task); return task.promise; } });
  h.client.setVisible(true); const original = h.requests[0];
  h.state.memberId = 'reed'; h.client.refresh(); assert.equal(original.signal.aborted, true);
  pending[0].resolve({ memberId: 'actor1', stateRevision: 7, rows: [] }); await flush(); assert.equal(h.updates.length, 0);
  pending[1].resolve({ memberId: 'reed', stateRevision: 6, rows: [] }); await flush(); assert.equal(h.updates.length, 0);
  await h.advance(1000); h.state.revision = 8; h.client.refresh(); assert.equal(h.requests[2].signal.aborted, true);
  pending[2].resolve({ memberId: 'reed', stateRevision: 7, rows: [] });
  pending[3].resolve({ memberId: 'reed', stateRevision: 8, rows: [] }); await flush();
  assert.equal(h.updates.length, 1); assert.equal(h.updates[0].stateRevision, 8);
  h.state.sandboxActive = true; h.client.refresh(); const count = h.requests.length;
  await h.advance(10000); assert.equal(h.requests.length, count); h.client.dispose();
});

test('foreground interruption withdraws interest while cached reads remain available', async () => {
  const h = harness(); h.state.settled = true; h.client.setVisible(true); await flush();
  h.state.settled = false; h.client.refresh(); await flush();
  assert.equal(h.requests.at(-1).body.visible, false);
  await h.advance(10000); assert.equal(h.requests.filter(row => row.body?.visible).length, 1);
  assert.ok(h.requests.filter(row => row.body === undefined).length > 1);
  h.state.settled = true; h.client.refresh(); await flush();
  assert.equal(h.requests.at(-1).body.visible, true); h.client.dispose();
});

test('rapid close and reopen serializes withdrawal before the renewed lease', async () => {
  const first = deferred(); let wait = true;
  const h = harness({ api: (entry, response) => {
    if (entry.body?.visible && wait) { wait = false; return first.promise; }
    return Promise.resolve(entry.body ? {} : response());
  } });
  h.state.settled = true; h.client.setVisible(true); await flush();
  h.client.setVisible(false); h.client.setVisible(true); await flush();
  assert.deepEqual(h.requests.filter(row => row.body).map(row => row.body.visible), [true]);
  first.resolve({}); await flush();
  assert.deepEqual(h.requests.filter(row => row.body).map(row => row.body.visible), [true, false, true]);
  h.client.dispose(); await flush();
});

test('total and skill sorts place unchecked rows last without turning unknown counts into zero', () => {
  const rows = [
    { id: '5', status: 'estimated', count: 1000, bySkill: { Mining: { count: 1000 } } },
    { id: '10', status: 'checked', count: 4, bySkill: { Mining: { count: 2 } } },
    { id: '2', status: 'checked', count: 4, bySkill: { Mining: { count: 1 } } },
    { id: '3', status: 'checked', count: 8, bySkill: {} },
  ];
  assert.deepEqual(rankPoolRows(rows).map(row => row.id), ['3', '2', '10', '5']);
  assert.deepEqual(rankPoolRows(rows, 'Mining').map(row => row.id), ['10', '2', '3', '5']);
  assert.equal(rows[0].id, '5');
});

test('passive map polling only requests saved summaries, without leases or predictions', async () => {
  const h = harness({ passive: true }); h.state.settled = true;
  h.client.setActive(true); await flush(); await h.advance(31000);
  assert.equal(h.requests.length, 32);
  assert.ok(h.requests.every(row => row.body === undefined && row.path.startsWith('/api/pool-ranking?')));
  assert.equal(h.updates.length, 32);
  h.client.setActive(false); await h.advance(10000);
  assert.equal(h.requests.length, 32); h.client.dispose();
});

test('passive reads reject late member, revision, picker, dataset, membership and generation responses', async () => {
  for (const field of ['memberId', 'revision', 'pickerId', 'datasetDigest', 'candidatesKey', 'generation']) {
    const pending = [];
    const h = harness({ passive: true, api: (entry, response) => {
      const task = deferred(); pending.push({ ...task, value: response() }); return task.promise;
    } });
    h.client.setActive(true);
    if (field === 'generation') { h.client.setActive(false); h.client.setActive(true); }
    else { h.state[field] = field === 'revision' ? 8 : 'changed'; h.client.refresh(); }
    assert.equal(h.requests[0].signal.aborted, true, field);
    pending[0].resolve(pending[0].value); await flush(); assert.equal(h.updates.length, 0, field);
    pending[1].resolve(pending[1].value); await flush(); assert.equal(h.updates.length, 1, field);
    await h.advance(1000);
    pending[2].resolve({ ...pending[2].value, datasetDigest: 'wrong' }); await flush();
    assert.equal(h.updates.length, 1, field);
    h.client.dispose();
  }
});
