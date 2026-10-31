import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { genericWorkerData } from './helpers/worker-dataset.mjs';

const definitions = { challenges: { Extra: { Alpha: { Chunks: ['12850'] }, Beta: { Chunks: ['12851'] }, Draft: { Chunks: ['12852'] } } },
  drops: {}, equipment: {}, codeItems: {}, chunks: { '12850': {}, '12851': {}, '12852': {} },
  walkableChunks: ['12850','12851','12852'], walkableChunksF2P: ['12850','12851','12852'] };
function state(index) {
  const value = createGroupState(['one','two'].map(id => ({ id, name: `Player ${index}`, unlocked: [index % 2 ? '12851' : '12850'] })));
  value.tasks = [{ id: 'custom:cache', category: 'Custom', label: `Picker ${index}` }];
  return value;
}
// Observe the retained graph and ledger at reply time without adding production
// protocol fields. The loader fails closed if the cache implementation moves.
const accountingProbe = `
import { registerHooks } from 'node:module';
import { parentPort } from 'node:worker_threads';
const measures = [];
let ledger;
globalThis.__cacheAccounting = { measures, setLedger: value => { ledger = value; } };
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  let source = String(result.source), anchor, replacement;
  if (url.endsWith('/tasks/snapshot-cache.mjs')) {
    anchor = 'const metadata = new WeakMap(), results = new WeakMap(), slots = new Map();';
    replacement = anchor + \`
  globalThis.__cacheAccounting.measures.push(() => [...entries].map(([key, value]) => {
      const entry = metadata.get(value);
      return { owner: 'picker:' + entry.owner, cost: snapshotBytes(value, entry.state,
        context(value.baseline), locations(value.baseline), entry.predictionBytes)
        + Buffer.byteLength(key) + Buffer.byteLength(entry.owner) };
    }));\`;
  } else if (url.endsWith('/tasks/eligibility-cache.mjs')) {
    anchor = 'const retained = new Map();';
    replacement = anchor + \`
  globalThis.__cacheAccounting.setLedger(() => [...retained.values()].map(({ cost, owner }) => ({ cost, owner })));\`;
  } else return result;
  if (!source.includes(anchor)) throw new Error('Cache accounting probe anchor changed.');
  return { ...result, source: source.replace(anchor, replacement) };
} });
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (message, ...rest) => {
  if (message.id !== undefined) message = { ...message,
    accounting: { measured: measures.flatMap(measure => measure()), charged: ledger() } };
  return post(message, ...rest);
};
`;
async function fixture(t, cacheBytes, accounting = false) {
  const world = buildWorld(definitions);
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    env: { ...process.env, ...(cacheBytes ? { RS3_CALCULATOR_CACHE_BYTES: String(cacheBytes) } : {}) },
    workerData: genericWorkerData({ definitions, world: { chunks: world.chunks, surface: world.surface } }),
    ...(accounting ? { execArgv: ['--import', 'data:text/javascript,' + encodeURIComponent(accountingProbe)] } : {}),
  });
  t.after(() => worker.terminate());
  assert.equal((await once(worker, 'message'))[0].type, 'ready');
  let sequence = 0;
  return async (picker, memberId, parameters) => {
    const response = once(worker, 'message');
    // Deliberately collide revision, member IDs, opaque input and draft across
    // all pickers. Only the picker namespace separates complete snapshots.
    worker.postMessage({ id: ++sequence, pickerId: `picker-${picker}`, state: state(picker), memberId, input: 'same', ...parameters });
    const message = (await response)[0];
    assert.equal(message.error, undefined);
    return accounting ? { ...message.result, accounting: message.accounting } : message.result;
  };
}
const normalize = result => {
  const copy = structuredClone(result);
  delete copy.cache;
  if (copy.metrics) delete copy.metrics.elapsedMs;
  if (copy.result?.metrics) delete copy.result.metrics.elapsedMs;
  return copy;
};

test('eight duo pickers retain 16 isolated complete snapshots with identical member IDs and revisions', async t => {
  const send = await fixture(t), expected = new Map();
  for (let picker = 0; picker < 8; picker++) for (const member of ['one','two']) {
    const cold = await send(picker, member, { type: 'death-estimates', chunkIds: [] });
    assert.equal(cold.cache.baselineHit, false);
    expected.set(`${picker}:${member}`, normalize(await send(picker, member, { type: 'evaluate' })));
  }
  assert.notDeepEqual(expected.get('0:one'), expected.get('1:one'));
  for (let picker = 0; picker < 8; picker++) for (const member of ['one','two']) {
    assert.equal((await send(picker, member, { type: 'death-estimates', chunkIds: [] })).cache.baselineHit, true);
    assert.deepEqual(normalize(await send(picker, member, { type: 'evaluate' })), expected.get(`${picker}:${member}`));
  }
});

test('16 sandbox drafts remain warm and cannot reuse another picker’s state', async t => {
  const send = await fixture(t), expected = new Map();
  const draft = { type: 'sandbox', chunkId: { changes: { unlockChunks: ['12852'] } } };
  for (let picker = 0; picker < 8; picker++) for (const member of ['one','two']) {
    const cold = await send(picker, member, draft);
    assert.equal(cold.cache.hypotheticalHit, false);
    expected.set(`${picker}:${member}`, normalize(cold));
  }
  assert.notDeepEqual(expected.get('0:one'), expected.get('1:one'));
  for (let picker = 0; picker < 8; picker++) for (const member of ['one','two']) {
    const warm = await send(picker, member, draft);
    assert.equal(warm.cache.baselineHit, true);
    assert.equal(warm.cache.hypotheticalHit, true);
    assert.deepEqual(normalize(warm), expected.get(`${picker}:${member}`));
  }
});

test('complete and sandbox caches share a bounded byte LRU under picker churn', async t => {
  const send = await fixture(t, 1024 * 1024), request = { type: 'sandbox', chunkId: { changes: { unlockChunks: ['12852'] } } };
  for (let picker = 0; picker < 64; picker++) await send(picker, 'one', request);
  await send(0, 'one', request);
  assert.equal((await send(0, 'one', request)).cache.hypotheticalHit, true);
  await send(64, 'one', request);
  const retained = await send(0, 'one', request);
  assert.equal(retained.cache.baselineHit, true);
  assert.equal(retained.cache.hypotheticalHit, true);
  const evicted = await send(1, 'one', request);
  assert.equal(evicted.cache.baselineHit, false);
  assert.equal(evicted.cache.hypotheticalHit, false);
});


test('empty sandbox retained projections are charged to their owning cache before reply', async t => {
  const limit = 256 * 1024, send = await fixture(t, limit, true);
  const sum = rows => rows.reduce((total, row) => total + row.cost, 0);
  let maxEntries = 0;
  for (let input = 0; input < 48; input++) {
    const { accounting: { measured, charged }, cache } = await send(input % 2, 'one', {
      type: 'sandbox', input: String(input), chunkId: { changes: {} },
    });
    assert.equal(cache.baselineHit, false);
    const snapshots = charged.filter(row => row.owner !== 'eligibility');
    assert.ok(measured.length > 0, 'exercise retained snapshots, not oversized bypass');
    assert.equal(sum(measured), sum(snapshots), 'measured snapshot payload must equal the charged payload');
    assert.ok(sum(charged) <= limit, 'shared budget');
    assert.ok(sum(measured) <= limit - Math.floor(limit / 3), 'snapshot pool budget');
    for (const owner of new Set(measured.map(row => row.owner))) {
      assert.ok(sum(measured.filter(row => row.owner === owner)) <= Math.floor(limit / 2), 'per-picker budget');
    }
    maxEntries = Math.max(maxEntries, measured.length);
  }
  assert.ok(maxEntries > 1 && maxEntries < 48, 'multiple inputs must be retained and then evicted');
});
