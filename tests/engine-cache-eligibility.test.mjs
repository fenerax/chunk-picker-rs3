import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createEligibilityCache, createEligibilityBudget } from '../app/tasks/eligibility-cache.mjs';

const state = n => ({ schemaVersion: 1, revision: 7, rules: {}, tasks: [], history: [],
  members: [{ id: 'same', name: 'Player', unlocked: [String(10000 + n)], completedTasks: [], taskStatus: {} }] });
const proof = (n, label = 'alpha', length = 11000) => ({
  tasks: [{ id: 'task', record: { label, unlocked: String(10000 + n), payload: 'x'.repeat(length) } }], metrics: { elapsedMs: 1 },
});
const call = (cache, n, compute = () => proof(n), options) => cache.evaluate(state(n), 'same', options, compute);
function entryCost(n = 0, label = 'alpha') {
  const cache = createEligibilityCache({ byteLimit: 1024 * 1024 });
  call(cache, n, () => proof(n, label));
  assert.ok(cache.bytes > 0);
  return cache.bytes;
}

test('content keys retain 32 distinct states with colliding member IDs and revisions', () => {
  const cache = createEligibilityCache({ limit: 64, byteLimit: 1024 * 1024 });
  const expected = [];
  for (let n = 0; n < 32; n++) {
    expected.push(call(cache, n, () => proof(n, 'alpha', 1000)));
    assert.equal(expected[n].metrics.eligibilityCacheHit, false);
  }
  for (let n = 0; n < 32; n++) {
    const warm = call(cache, n, () => assert.fail('Warm state recomputed.'));
    assert.equal(warm.metrics.eligibilityCacheHit, true);
    assert.deepEqual(warm, expected[n]);
    warm.tasks[0].record.label = 'caller edit';
    assert.equal(call(cache, n).tasks[0].record.label, 'alpha');
  }
});

test('a shared byte budget evicts across variants while keeping their values isolated', () => {
  const costs = [entryCost(), entryCost(0, 'bravo'), entryCost(1)];
  const byteLimit = 2 * Math.max(...costs);
  assert.ok(3 * Math.min(...costs) > byteLimit, 'The byte budget must fit two proofs but not three.');
  const budget = createEligibilityBudget({ byteLimit });
  const a = createEligibilityCache({ limit: 4, budget }), b = createEligibilityCache({ limit: 4, budget });
  const firstA = call(a, 0), firstB = call(b, 0, () => proof(0, 'bravo'));
  assert.notDeepEqual(firstA, firstB);
  assert.equal(budget.size, 2);
  assert.ok(budget.bytes <= byteLimit);
  assert.equal(a.bytes + b.bytes, budget.bytes);
  assert.deepEqual(call(a, 0), firstA); // Touch A globally; B must be oldest.
  call(a, 1);
  assert.equal(b.size, 0);
  assert.equal(b.bytes, 0);
  assert.equal(a.size, 2);
  assert.equal(a.bytes, budget.bytes);
  const rebuiltB = call(b, 0, () => proof(0, 'bravo'));
  assert.equal(rebuiltB.metrics.eligibilityCacheHit, false);
  assert.deepEqual(rebuiltB, firstB);
  assert.ok(budget.bytes <= budget.byteLimit);
  assert.equal(a.bytes + b.bytes, budget.bytes);
});

test('entry eviction releases its charge and oversized results stay uncached', () => {
  const cost = entryCost(), budget = createEligibilityBudget({ byteLimit: 4 * cost });
  const cache = createEligibilityCache({ limit: 1, budget });
  for (const n of [0,1,0]) {
    assert.equal(call(cache, n).metrics.eligibilityCacheHit, false);
    assert.equal(cache.size, 1);
    assert.equal(cache.bytes, entryCost(n));
    assert.equal(budget.size, 1);
    assert.equal(budget.bytes, cache.bytes);
  }
  const small = createEligibilityCache({ limit: 64, byteLimit: cost - 1 });
  for (let n = 0; n < 2; n++) {
    assert.deepEqual(call(small, 0), call(createEligibilityCache(), 0));
    assert.equal(small.size, 0);
    assert.equal(small.bytes, 0);
  }
});

test('the budget charges full backing stores rather than tiny buffer slices', () => {
  const slice = Buffer.alloc(4096).subarray(0, 1);
  const budget = createEligibilityBudget({ byteLimit: slice.buffer.byteLength - 1 });
  assert.equal(budget.admit(slice, () => assert.fail('Unretained buffer evicted.')), false);
  assert.equal(budget.bytes, 0);
  assert.equal(budget.size, 0);
});

test('zero bounds and transport bypass preserve ordinary results without retention', () => {
  for (const options of [{ limit: 0 }, { byteLimit: 0 }]) {
    const cache = createEligibilityCache(options);
    assert.deepEqual(call(cache, 0), call(createEligibilityCache(), 0));
    assert.equal(cache.bytes, 0);
    assert.equal(cache.size, 0);
  }
  const cache = createEligibilityCache();
  call(cache, 0); const bytes = cache.bytes;
  assert.equal(call(cache, 0, () => proof(0), { reuseEligibility: false }).metrics.eligibilityCacheHit, false);
  assert.equal(cache.bytes, bytes);
  assert.equal(call(cache, 0).metrics.eligibilityCacheHit, true);
});

test('zero-cost buffers remain entry bounded', () => {
  const budget = createEligibilityBudget({ byteLimit: 1, entryLimit: 2 });
  let evicted = 0;
  for (let n = 0; n < 3; n++) assert.equal(budget.admit(Buffer.alloc(0), () => evicted++), true);
  assert.equal(budget.bytes, 0);
  assert.equal(budget.size, 2);
  assert.equal(evicted, 1);
});

test('invalid entry and byte bounds are rejected', () => {
  for (const value of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => createEligibilityCache({ limit: value }), TypeError);
    assert.throws(() => createEligibilityCache({ byteLimit: value }), TypeError);
    assert.throws(() => createEligibilityBudget({ byteLimit: value }), TypeError);
    assert.throws(() => createEligibilityBudget({ entryLimit: value }), TypeError);
  }
});


test('idle compression keeps large bursts fully charged without reviving evicted entries', async () => {
  const budget = createEligibilityBudget({ byteLimit: 700000, eligibilityByteLimit: 500000 });
  const a = createEligibilityCache({ limit: 8, budget }), b = createEligibilityCache({ limit: 8, budget });
  const snapshot = {};
  assert.ok(budget.admit(snapshot, () => assert.fail('proof burst displaced snapshot'), { cost: 180000, owner: 'picker:peer' }));
  for (let i = 0; i < 50; i++) {
    call(i % 2 ? a : b, i, () => proof(i, 'large', 120000));
    assert.equal(budget.bytes, a.bytes + b.bytes + 180000);
    assert.ok(a.bytes + b.bytes <= 500000); assert.ok(budget.bytes <= budget.byteLimit);
  }
  const before = a.bytes + b.bytes, size = a.size + b.size;
  assert.ok(before >= size * 120000, 'pending raw buffers have their full charge');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.size + b.size, size, 'idle jobs cannot resurrect evicted proofs');
  assert.ok(a.bytes + b.bytes < before);
  assert.equal(budget.bytes, a.bytes + b.bytes + 180000);
  assert.equal(call(a, 49, () => assert.fail('compacted proof recomputed')).metrics.eligibilityCacheHit, true);
  // A raw proof exceeding the owner quota takes synchronous compressed admission.
  call(a, 51, () => proof(51, 'large', 600000));
  assert.ok(a.bytes + b.bytes <= 500000); assert.ok(budget.bytes <= budget.byteLimit);
});


for (const mode of ['idle', 'small', 'oversized']) test(`compression failure preserves results and full charges (${mode})`, () => {
  // Isolate the injected native failure: an uncaught idle exception must fail
  // this test without terminating the test runner or affecting other cases.
  const source = `
    import assert from 'node:assert/strict';
    import zlib from 'node:zlib';
    import { syncBuiltinESMExports } from 'node:module';
    import { createEligibilityCache, createEligibilityBudget } from ${JSON.stringify(new URL('../app/tasks/eligibility-cache.mjs', import.meta.url).href)};
    let attempts = 0;
    zlib.zstdCompressSync = () => { attempts++; throw Object.assign(new Error('Compression failed'), { code: 'ERR_ZSTD_GENERIC' }); };
    syncBuiltinESMExports();
    const state = ${state.toString()}, proof = ${proof.toString()};
    const mode = ${JSON.stringify(mode)};
    const budget = createEligibilityBudget({ byteLimit: mode === 'oversized' ? 1000 : 200000 });
    const cache = createEligibilityCache({ limit: 1, budget });
    const expected = proof(0, 'alpha', mode === 'small' ? 1000 : 120000);
    expected.tasks[0].challengeSatisfied = false;
    const call = () => cache.evaluate(state(0), 'same', undefined, () => structuredClone(expected));
    assert.deepEqual(call(), expected);
    const before = cache.bytes;
    if (mode === 'idle') assert.equal(attempts, 0);
    if (mode !== 'oversized') assert.ok(before >= expected.tasks[0].record.payload.length);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 1);
    assert.equal(cache.bytes, before);
    assert.equal(budget.bytes, cache.bytes);
    const warm = call();
    assert.deepEqual(warm, expected);
    assert.equal(warm.metrics.eligibilityCacheHit, mode !== 'oversized');
    if (mode === 'oversized') { assert.equal(cache.size, 0); assert.equal(budget.bytes, 0); }
    else {
      assert.equal(attempts, 1, 'failed compression is not retried on hits');
      assert.ok(budget.admit(Buffer.allocUnsafeSlow(200000), () => {}));
      assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
});

test('large proofs preserve data, aliases and hidden facts before and after idle compression', async () => {
  const budget = createEligibilityBudget({ byteLimit: 500000 }), cache = createEligibilityCache({ budget });
  const expected = proof(0, 'large', 120000);
  expected.tasks[0].record.bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const processing = { diagnostics: [{ detail: 'fixture' }], bytes: expected.tasks[0].record.bytes };
  Object.defineProperty(expected, 'processing', { value: processing });
  Object.defineProperty(expected.tasks[0], 'processingPrimary', { value: false });
  Object.defineProperty(expected.metrics, 'processingPasses', { value: 3, configurable: true });
  const cold = call(cache, 0, () => expected), before = cache.bytes;
  const read = () => {
    const warm = call(cache, 0, () => assert.fail('proof recomputed'));
    assert.deepEqual(warm, cold);
    assert.deepEqual(warm.processing, processing);
    assert.equal(warm.processing.bytes, warm.tasks[0].record.bytes);
    for (const [left, right, key] of [[warm, cold, 'processing'], [warm.tasks[0], cold.tasks[0], 'processingPrimary'], [warm.metrics, cold.metrics, 'processingPasses']]) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(left, key), Object.getOwnPropertyDescriptor(right, key));
    }
    return warm;
  };
  read().tasks[0].record.bytes.fill(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(cache.bytes < before);
  assert.equal(budget.bytes, cache.bytes);
  read();
});
