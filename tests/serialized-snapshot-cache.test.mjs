import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerializedSnapshotCache, serializedSnapshotBytes } from '../app/tasks/serialized-snapshot-cache.mjs';
import { createWorkerCacheBudget } from '../app/tasks/snapshot-cache.mjs';
import { createSnapshotHotSet, createSnapshotHeapMeter } from '../app/tasks/snapshot-hot-set.mjs';
import { createEligibilityBudget } from '../app/tasks/eligibility-cache.mjs';

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
  let record = [...cache.entries.values()][0];
  const before = budget.bytes;
  assert.equal(record.bytes, undefined);
  assert.equal(hotSet.bytes, before);
  snapshot.whyIndex = { tasks: snapshot.baseline.tasks, byId: new Map([['synthetic', snapshot.baseline.tasks[0]]]) };
  snapshot.estimates.set('chunk', { detail: '雪'.repeat(2000) });
  cache.refresh(snapshot);
  record = Map.prototype.get.call(cache.entries, 'key');
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

test('refreshing a demoted snapshot re-admits its decoded graph to both budgets', () => {
  const hotSet = createSnapshotHotSet({ entryLimit: 1, byteLimit: 128 * 1024 });
  const { cache, budget, snapshot: a } = fixture(1024 * 1024, hotSet);
  a.baseline.large = 'a'.repeat(5000);
  const b = { baseline: { tasks: [{ id: 'b' }], metrics: {}, large: 'b'.repeat(5000) } };
  const balance = () => {
    const records = [...cache.entries.values()], hot = records.filter(record => record.value);
    assert.equal(hot.length, 1, 'only one decoded graph is retained');
    assert.equal(hotSet.size, hot.length);
    assert.equal(hotSet.bytes, hot.reduce((sum, record) => sum + record.cost, 0));
    assert.equal(budget.bytes, records.reduce((sum, record) => sum + record.cost, 0), 'ledger covers every retained representation');
  };
  assert.equal(cache.set('a', a, undefined, 'one'), true);
  balance();
  assert.equal(cache.set('b', b, undefined, 'two'), true);
  balance();
  const demoted = Map.prototype.get.call(cache.entries, 'a');
  assert.equal(demoted.value, undefined);
  assert.ok(demoted.bytes instanceof Buffer);
  cache.refresh(a);
  balance();
  assert.equal(Map.prototype.get.call(cache.entries, 'a').value, a);
  assert.equal(Map.prototype.get.call(cache.entries, 'b').value, undefined);
  assert.equal(cache.isCurrent('a', a), true);
  assert.deepStrictEqual(cache.entries.get('b').baseline, b.baseline, 'demoted contents remain exact after re-admission');
  balance();
  cache.entries.clear();
  assert.equal(budget.bytes, 0); assert.equal(hotSet.bytes, 0);
});

test('measuring a demoted snapshot stages promotion without retaining another decoded graph', () => {
  const hotSet = createSnapshotHotSet({ entryLimit: 1 });
  const { cache, budget, snapshot: a } = fixture(1024 * 1024, hotSet);
  const b = { baseline: { tasks: [], metrics: {} } };
  cache.set('a', a, undefined, 'one'); cache.set('b', b, undefined, 'two');
  const retained = Map.prototype.get.call(cache.entries, 'a'), before = budget.bytes, wireCost = retained.cost;
  const measured = cache.measure(a);
  assert.ok(measured > wireCost, 'decoded heap costs more than these wire bytes');
  assert.equal(retained.value, undefined, 'measurement must not promote the resident record');
  assert.equal([...cache.entries.values()].filter(record => record.value).length, 1);
  assert.equal(hotSet.size, 1); assert.equal(budget.bytes, before);
  cache.refresh(a);
  assert.equal([...cache.entries.values()].filter(record => record.value).length, 1);
  assert.equal(budget.bytes, [...cache.entries.values()].reduce((sum, record) => sum + record.cost, 0));
});

for (const entryLimit of [0, 1]) test(`preserved baselines resolve across full and sandbox caches with ${entryLimit} hot entries`, () => {
  const budget = createEligibilityBudget({ byteLimit: 12000, ownerByteLimit: 6000 });
  const hotSet = createSnapshotHotSet({ entryLimit });
  const complete = createSerializedSnapshotCache(budget, { hotSet });
  const sandbox = createSerializedSnapshotCache(budget, { hotSet });
  let seed = 42;
  const bytes = Uint8Array.from({ length: 1500 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24;
  });
  const baseline = { baseline: { tasks: [{ id: 'base' }], metrics: {}, bytes } };
  const draft = { baseline: { tasks: [{ id: 'draft' }], metrics: {}, bytes: bytes.slice() } };
  assert.equal(complete.set('base', baseline, undefined, 'one'), true);
  sandbox.stage('draft', draft, undefined, 'one');
  const before = budget.bytes, cost = sandbox.measure(draft);
  assert.ok(cost < 6000 && before < 6000 && cost + before > 6000, 'each snapshot fits alone but the pair exceeds the owner cap');
  assert.equal(sandbox.fits(draft, [baseline]), false);
  assert.equal(sandbox.set('draft', draft, undefined, 'one', { preserve: [baseline] }), false);
  assert.equal(complete.isCurrent('base', baseline), true);
  assert.equal(sandbox.entries.size, 0);
  assert.equal(budget.bytes, before, 'rejected draft preserves the baseline charge');
  const restored = complete.entries.get('base');
  assert.deepStrictEqual(restored.baseline, baseline.baseline);
  assert.equal(sandbox.fits(draft, [restored]), false, 'hydrated baseline resolves its current ledger token too');
  complete.entries.clear();
  assert.equal(budget.bytes, 0); assert.equal(hotSet.size, 0);
});

test('prepared prediction state joins the heap charge and survives cold demotion', () => {
  const hotSet = createSnapshotHotSet({ entryLimit: 1 });
  const { cache, snapshot, budget } = fixture(1024 * 1024, hotSet);
  cache.set('base', snapshot, undefined, 'one');
  const before = budget.bytes;
  snapshot.predictionState = { revision: 4, members: [{ id: 'one' }], retained: '雪'.repeat(2000) };
  snapshot.predictionRevision = 4;
  cache.refresh(snapshot);
  assert.ok(budget.bytes > before + 4000, 'validated state storage is charged as heap');
  assert.equal(budget.bytes, hotSet.bytes);
  cache.set('other', { baseline: { tasks: [], metrics: {} } }, undefined, 'two');
  assert.equal(Map.prototype.get.call(cache.entries, 'base').value, undefined);
  const restored = cache.entries.get('base');
  assert.deepStrictEqual(restored.predictionState, snapshot.predictionState);
  assert.equal(restored.predictionRevision, 4);
  assert.equal(hotSet.size, 1);
  cache.entries.clear(); assert.equal(budget.bytes, 0);
});
