import test from 'node:test';
import assert from 'node:assert/strict';
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
