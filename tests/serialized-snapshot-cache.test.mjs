import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerializedSnapshotCache, serializedSnapshotBytes } from '../app/tasks/serialized-snapshot-cache.mjs';
import { createWorkerCacheBudget } from '../app/tasks/snapshot-cache.mjs';
import { createSnapshotHotSet, createSnapshotHeapMeter } from '../app/tasks/snapshot-hot-set.mjs';

function fixture(limit = 1024 * 1024, hotSet) {
  const contexts = new WeakMap(), locations = new WeakMap(), budget = createWorkerCacheBudget(limit);
  const cache = createSerializedSnapshotCache(budget, { hotSet, context: value => contexts.get(value), locations: value => locations.get(value),
    restoreContext: (value, context) => contexts.set(value, context), restoreLocations: (value, data) => locations.set(value, data) });
  const row = { id: 'synthetic', record: { label: '雪', bytes: new Uint8Array([3, 5]) }, explanation: 'source', blockers: [] };
  Object.defineProperty(row, 'processingPrimary', { value: true });
  const baseline = { tasks: [row], presentation: { tasks: [row] }, metrics: { availableCount: 1 } };
  Object.defineProperty(baseline, 'processing', { value: { items: new Set(['item']) } });
  Object.defineProperty(baseline.metrics, 'eligibilityCacheHit', { value: true });
  const snapshot = { baseline, estimates: new Map(), revision: 4,
    planningIndex: { byLocation: new Map([['10000', new Map([[row.id, { task: row, evidence: [] }]])]]), canonical: value => value } };
  return { cache, budget, contexts, locations, snapshot };
}

test('snapshots retain only charged wire bytes and restore complete aliased results and deferred views', () => {
  const { cache, budget, contexts, locations, snapshot } = fixture();
  const context = { equipment: { catalogue: snapshot.baseline.tasks }, state: { revision: 4 }, memberId: 'one' };
  contexts.set(snapshot.baseline, context); locations.set(snapshot.baseline, { synthetic: ['10000'] });
  snapshot.predict = () => assert.fail('A retained prediction closure must be rebuilt.');
  const expected = JSON.stringify(snapshot.baseline);
  assert.equal(cache.set('key', snapshot, context.state, 'one'), true);
  const record = [...cache.entries.values()][0];
  assert.deepEqual(Object.keys(record).sort(), ['bytes', 'cost', 'owner']);
  assert.equal(record.cost, serializedSnapshotBytes('key', 'one', record.bytes));
  assert.equal(budget.bytes, record.cost);
  assert.ok(budget.bytes > record.bytes.buffer.byteLength);
  const restored = cache.entries.get('key');
  assert.notEqual(restored, snapshot);
  assert.equal(restored.predict, undefined);
  assert.equal(JSON.stringify(restored.baseline), expected);
  assert.equal(restored.baseline.presentation.tasks[0], restored.baseline.tasks[0]);
  assert.equal(restored.planningIndex.byLocation.get('10000').get('synthetic').task, restored.baseline.tasks[0]);
  assert.equal(contexts.get(restored.baseline).equipment.catalogue, restored.baseline.tasks);
  assert.deepEqual(locations.get(restored.baseline), { synthetic: ['10000'] });
  assert.deepEqual(restored.baseline.processing, snapshot.baseline.processing);
  assert.equal(restored.baseline.tasks[0].processingPrimary, true);
  assert.equal(restored.baseline.metrics.eligibilityCacheHit, true);
  restored.baseline.tasks[0].record.bytes[0] = 99;
  restored.baseline.tasks[0].explanation = 'caller mutation';
  assert.equal(JSON.stringify(cache.entries.get('key').baseline), expected);
});

test('lazy fields, replacement, eviction and clear keep exact backing allocations in the shared ledger', () => {
  const { cache, budget, snapshot } = fixture(32 * 1024);
  cache.set('key', snapshot, undefined, 'one');
  const restored = cache.entries.get('key'), before = budget.bytes;
  restored.estimates.set('chunk', { explanation: 'estimate'.repeat(200) });
  cache.refresh(restored, true);
  assert.ok(budget.bytes > before);
  assert.deepEqual(cache.entries.get('key').estimates, restored.estimates);
  assert.equal(cache.isCurrent('key', restored), true);
  for (let index = 0; index < 12; index++) cache.set(String(index), { baseline: snapshot.baseline }, undefined, String(index));
  assert.equal(cache.entries.has('key'), false);
  assert.equal(cache.isCurrent('key', restored), false);
  assert.ok(budget.bytes <= 32 * 1024);
  assert.equal(budget.bytes, [...cache.entries].reduce((sum, [key, record]) => sum + serializedSnapshotBytes(key, record.owner, record.bytes), 0));
  const count = cache.entries.size;
  let seed = 42;
  const incompressible = Uint8Array.from({ length: 64 * 1024 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24;
  });
  assert.equal(cache.set('huge', { baseline: { tasks: [], metrics: {}, incompressible } }, undefined, 'one'), false);
  assert.equal(cache.entries.size, count, 'oversized admission preserves existing snapshots');
  cache.entries.clear();
  assert.equal(budget.bytes, 0);
});

test('stale asynchronous projections cannot replace a newer snapshot through refresh', () => {
  const { cache, snapshot } = fixture();
  cache.set('key', snapshot, undefined, 'one');
  const stale = cache.entries.get('key');
  const newer = { baseline: snapshot.baseline, revision: 5 };
  cache.set('key', newer, undefined, 'one');
  stale.whyIndex = { tasks: stale.baseline.tasks };
  cache.refresh(stale);
  assert.equal(cache.isCurrent('key', stale), false);
  assert.equal(cache.entries.get('key').revision, 5);
});

test('one shared hot graph avoids decoding, charges heap growth and preserves lazy fields when demoted', () => {
  const hotSet = createSnapshotHotSet({ entryLimit: 1, byteLimit: 512 * 1024 });
  const { cache, budget, snapshot } = fixture(1024 * 1024, hotSet);
  const other = createSerializedSnapshotCache(budget, { hotSet });
  assert.equal(cache.set('key', snapshot, undefined, 'one'), true);
  assert.equal(cache.entries.get('key'), snapshot);
  const record = [...cache.entries.values()][0], before = budget.bytes;
  assert.equal(record.bytes, undefined);
  assert.equal(hotSet.bytes, before);
  snapshot.whyIndex = { tasks: snapshot.baseline.tasks, byId: new Map([['synthetic', snapshot.baseline.tasks[0]]]) };
  snapshot.estimates.set('chunk', { detail: '雪'.repeat(2000) });
  cache.refresh(snapshot);
  assert.ok(budget.bytes > before + 4000, 'UTF-16 strings and graph storage join the ledger');
  assert.equal(budget.bytes, hotSet.bytes);
  const expected = JSON.stringify(snapshot.baseline);
  other.set('other', { baseline: { tasks: [], metrics: {} } }, undefined, 'two');
  assert.equal(hotSet.size, 1);
  assert.equal(record.value, undefined);
  assert.ok(record.bytes instanceof Buffer);
  assert.equal(record.cost, serializedSnapshotBytes('key', 'one', record.bytes));
  assert.equal(budget.bytes, record.cost + [...other.entries.values()][0].cost);
  const restored = cache.entries.get('key');
  assert.notEqual(restored, snapshot);
  assert.equal(JSON.stringify(restored.baseline), expected);
  assert.equal(restored.whyIndex.byId.get('synthetic'), restored.baseline.tasks[0]);
  assert.deepEqual(restored.estimates, snapshot.estimates);
  assert.equal([...other.entries.values()][0].value, undefined);
  cache.entries.clear(); other.entries.clear();
  assert.equal(hotSet.size, 0); assert.equal(hotSet.bytes, 0); assert.equal(budget.bytes, 0);
});

test('hot set obeys heap and entry bounds, rejects executables and drops prediction closures', () => {
  assert.throws(() => createSnapshotHotSet({ entryLimit: -1 }), TypeError);
  const small = createSnapshotHotSet({ entryLimit: 2, byteLimit: 8192 });
  const { cache, snapshot, budget } = fixture(1024 * 1024, small);
  snapshot.baseline.large = 'x'.repeat(10000);
  cache.set('oversize', snapshot, undefined, 'one');
  assert.equal(small.size, 0, 'oversized decoded graphs stay as bytes');
  assert.ok([...cache.entries.values()][0].bytes);
  assert.ok(budget.bytes < 8192);
  const bounded = createSnapshotHotSet({ entryLimit: 2, byteLimit: 8192 });
  const full = createSerializedSnapshotCache(createWorkerCacheBudget(), { hotSet: bounded });
  for (const key of ['a', 'b', 'c']) full.set(key, { baseline: { tasks: [], metrics: {} } }, undefined, key);
  assert.equal(bounded.size, 2); assert.ok(bounded.bytes <= 8192);
  const value = full.entries.get('c');
  value.predict = () => snapshot;
  full.capture(value); full.releaseTransient();
  assert.equal(value.predict, undefined);
  const meter = createSnapshotHeapMeter();
  assert.throws(() => meter.visit({ executable() {} }), TypeError);
  assert.throws(() => meter.visit({ get value() { assert.fail('Getter must not execute'); } }), TypeError);
});
