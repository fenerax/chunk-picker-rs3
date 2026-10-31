import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { createSnapshotCache, snapshotBytes, createWorkerCacheBudget } from '../app/tasks/snapshot-cache.mjs';
import { createEligibilityBudget } from '../app/tasks/eligibility-cache.mjs';

const value = label => ({ baseline: { tasks: [{ label: label.repeat(400) }], metrics: {} }, estimates: new Map() });
const state = { revision: 1, members: [{ id: 'same', unlocked: [] }] };
const cost = snapshotBytes(value('a'), state) + 10;

test('complete and sandbox snapshots evict globally by measured bytes and LRU', () => {
  const budget = createEligibilityBudget({ byteLimit: 2 * cost });
  const complete = new Map(), sandbox = new Map();
  const a = createSnapshotCache(complete, budget), b = createSnapshotCache(sandbox, budget);
  const first = value('a'), second = value('b');
  a.set('a', first, state, '1'); b.set('b', second, state, '2');
  assert.equal(budget.size, 2); a.refresh(first);
  a.set('c', value('c'), state, '3');
  assert.equal(sandbox.size, 0); assert.equal(complete.size, 2);
  assert.ok(budget.bytes <= budget.byteLimit);
});

test('one picker cannot monopolize the shared budget, including eligibility storage', () => {
  const budget = createWorkerCacheBudget(8 * cost), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('peer', value('z'), state, 'peer');
  for (let i = 0; i < 30; i++) cache.set(String(i), value('a'), state, 'noisy');
  assert.ok(entries.has('peer')); assert.ok(entries.size <= 5);
  const bytes = Buffer.alloc(cost); assert.equal(budget.admit(bytes, () => {}), true);
  assert.ok(budget.bytes <= budget.byteLimit);
  assert.equal(budget.admit(Buffer.alloc(Math.floor(8 * cost / 3) + 1), () => {}), false);
});

test('lazy growth is remeasured, evicted snapshots cannot become unaccounted entries', () => {
  const budget = createEligibilityBudget({ byteLimit: 2 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a'), second = value('b');
  cache.set('a', first, state, '1'); cache.set('b', second, state, '2');
  first.planningIndex = { byLocation: new Map([['x', 'x'.repeat(20 * cost)]]), clueLocations: new Map() }; cache.refresh(first);
  assert.equal(entries.has('a'), false); assert.equal(budget.size, 1);
  delete first.planningIndex; cache.set('a', first, state, '1');
  assert.equal(budget.size, 2); assert.ok(budget.bytes <= budget.byteLimit);
  first.estimates.set('estimate', 'x'.repeat(20 * cost)); cache.refresh(first);
  assert.equal(entries.has('a'), false);
});

test('oversized snapshots are usable by the caller without retaining their state', () => {
  const budget = createWorkerCacheBudget(16), entries = new Map(), cache = createSnapshotCache(entries, budget);
  const result = value('a'); cache.set('key', result, state, 'one');
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  assert.equal(result.baseline.tasks.length, 1);
});

test('same-sized estimate replacement and prediction closures are charged before reuse', () => {
  const budget = createEligibilityBudget({ byteLimit: 3 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a');
  first.estimates.set('estimate', 'small'); cache.set('a', first, state, '1');
  first.estimates.set('estimate', 'x'.repeat(20 * cost)); cache.refresh(first, true);
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  const second = value('b'); cache.set('b', second, state, '2');
  cache.capture(second, { ...state, payload: 'x'.repeat(20 * cost) });
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
});

test('snapshot churn preserves the reserved shared eligibility space', () => {
  const budget = createWorkerCacheBudget(12 * cost), entries = new Map();
  const cache = createSnapshotCache(entries, budget), proof = Buffer.alloc(3 * cost);
  let proofEvictions = 0;
  assert.equal(budget.admit(proof, () => proofEvictions++), true);
  for (let i = 0; i < 40; i++) cache.set(String(i), value('a'), state, String(i));
  assert.equal(proofEvictions, 0); assert.equal(budget.touch(proof), true);
  assert.ok(budget.bytes <= budget.byteLimit); assert.ok(entries.size < 40);
});

test('a prediction clone is charged independently when its input aliases the baseline state', () => {
  const budget = createEligibilityBudget({ byteLimit: 10 * cost }), entries = new Map();
  const cache = createSnapshotCache(entries, budget), first = value('a');
  cache.set('a', first, state, '1'); const before = budget.bytes;
  cache.capture(first, state);
  assert.ok(budget.bytes > before, 'the private validated clone cannot be hidden by serialization aliasing');
});


test('lazy views and locations are charged without walking the stable baseline again', () => {
  let reads = 0, locations;
  const baseline = { tasks: [], metrics: {}, get stable() { reads++; return 'x'.repeat(4000); } };
  const snapshot = { baseline, estimates: new Map() };
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget, { locations: () => locations });
  cache.set('a', snapshot, state, '1');
  assert.equal(reads, 1);
  const initial = budget.bytes;
  locations = { task: ['10000'] }; cache.refresh(snapshot);
  assert.equal(reads, 1); assert.ok(budget.bytes > initial);
  baseline.currentBiS = { items: ['item'] }; baseline.activityInfo = { tasks: ['task'] };
  snapshot.includeViews = true; cache.refresh(snapshot);
  assert.equal(reads, 1);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, undefined, locations) + 2);
  const measuredReads = reads; cache.set('a', snapshot, state, '1');
  assert.equal(reads, measuredReads);
  assert.ok(budget.bytes <= budget.byteLimit);
});

test('context removal stays conservatively charged; replacement and forced changes are measured', () => {
  const snapshot = value('a');
  let context = { equipment: 'x'.repeat(4000), state };
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget, { context: () => context });
  cache.set('a', snapshot, state, '1'); const before = budget.bytes;
  context = undefined; cache.refresh(snapshot);
  assert.equal(budget.bytes, before);
  assert.ok(budget.bytes >= snapshotBytes(snapshot, state) + 2);
  context = { equipment: 'x'.repeat(8000), state }; cache.refresh(snapshot);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, context) + 2);
  snapshot.estimates.set('same', 'small'); cache.refresh(snapshot);
  snapshot.estimates.set('same', 'x'.repeat(20000)); cache.refresh(snapshot, true);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state, context) + 2);
});


test('unsupported lazy data releases its charge and a repaired snapshot can be admitted again', () => {
  const snapshot = value('a');
  const budget = createEligibilityBudget({ byteLimit: 1024 * 1024 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  snapshot.playResult = { unsupported() {} }; cache.refresh(snapshot);
  assert.equal(entries.size, 0); assert.equal(budget.bytes, 0);
  snapshot.playResult = { tasks: [] }; cache.set('a', snapshot, state, '1');
  assert.equal(entries.size, 1);
  assert.equal(budget.bytes, snapshotBytes(snapshot, state) + 2);
});


test('large sandbox and planning aliases share the baseline charge', () => {
  const task = { payload: 'x'.repeat(4000) };
  const snapshot = { baseline: { tasks: [task], metrics: {} }, estimates: new Map() };
  const budget = createEligibilityBudget({ byteLimit: 8000 }), entries = new Map();
  const cache = createSnapshotCache(entries, budget);
  cache.set('a', snapshot, state, '1');
  snapshot.playResult = { tasks: [task] };
  snapshot.sandboxDelta = { added: [task] };
  snapshot.planningIndex = { byLocation: new Map([['location', task]]), clueLocations: new Map() };
  cache.refresh(snapshot);
  assert.equal(entries.size, 1, 'shared payloads must fit without duplicate bulk charges');
  assert.ok(budget.bytes < 5000);
  assert.ok(budget.bytes <= budget.byteLimit);
});


test('a burst of large snapshots sharing a measured state never exceeds byte limits', () => {
  const byteLimit = 800000, ownerByteLimit = 300000, snapshotByteLimit = 600000;
  const budget = createEligibilityBudget({ byteLimit, ownerByteLimit, snapshotByteLimit });
  const entries = new Map(), cache = createSnapshotCache(entries, budget);
  const sharedState = { ...state, payload: 's'.repeat(70000) };
  const proof = Buffer.allocUnsafeSlow(180000);
  assert.ok(budget.admit(proof, () => assert.fail('snapshot churn evicted reserved proof')));
  const owners = new Map();
  for (let i = 0; i < 60; i++) {
    const owner = String(i % 3), key = String(i), shared = { payload: 'x'.repeat(80000) };
    const snapshot = { baseline: { tasks: Array(1500).fill(shared), metrics: {} }, estimates: new Map() };
    cache.set(key, snapshot, sharedState, owner); owners.set(key, owner);
    const exact = [...entries].reduce((sum, [key, value]) => sum + snapshotBytes(value, sharedState) + Buffer.byteLength(key) + Buffer.byteLength(owners.get(key)), 0);
    const independent = [...entries.values()].reduce((sum, value) => sum + serialize([value.baseline, value.estimates, sharedState]).byteLength, 0);
    assert.ok(budget.bytes >= proof.byteLength + independent, 'independent native payload sizes are covered');
    assert.ok(budget.bytes >= proof.byteLength + exact, 'all retained payloads are covered');
    assert.ok(budget.bytes <= byteLimit); assert.ok(exact <= snapshotByteLimit);
    for (const owner of ['0', '1', '2']) {
      const own = [...entries].filter(([key]) => owners.get(key) === owner)
        .reduce((sum, [key, value]) => sum + snapshotBytes(value, sharedState) + Buffer.byteLength(key) + Buffer.byteLength(owner), 0);
      assert.ok(own <= ownerByteLimit);
    }
  }
  assert.ok(entries.size < 60); assert.ok(budget.touch(proof));
});


test('immutable state sizing is shared across member snapshots and forced refresh measures changes', () => {
  let reads = 0;
  const sharedState = { ...state, get payload() { reads++; return 's'.repeat(70000); } };
  const entries = new Map(), budget = createWorkerCacheBudget(1024 * 1024), cache = createSnapshotCache(entries, budget);
  cache.set('a', value('a'), sharedState, '1'); cache.set('b', value('b'), sharedState, '1');
  assert.equal(reads, 1); const before = budget.bytes;
  sharedState.extra = 'x'.repeat(10000); cache.refresh(entries.get('a'), true);
  assert.equal(reads, 2); assert.ok(budget.bytes > before);
  // Replacing a state root must get its own measurement, including large data.
  cache.set('c', value('c'), { ...state, payload: 'x'.repeat(2 * 1024 * 1024) }, '2');
  assert.equal(entries.has('c'), false); assert.ok(budget.bytes <= budget.byteLimit);
});
