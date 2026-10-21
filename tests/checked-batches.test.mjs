import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedBatches } from '../app/checked-batches.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const collect = async iterable => { const values = []; for await (const value of iterable) values.push(value); return values; };

test('inspections admit at most three reads and preserve input order despite reversed completion', { timeout: 2000 }, async () => {
  const entries = Array.from({ length: 8 }, (_, index) => index), pending = entries.map(deferred);
  const admitted = [deferred(), deferred(), deferred()], started = [];
  let active = 0, peak = 0;
  const result = collect(checkedBatches(entries, async entry => {
    started.push(entry); active++; peak = Math.max(peak, active);
    if ([3, 6, 8].includes(started.length)) admitted[[3, 6, 8].indexOf(started.length)].resolve();
    try { return await pending[entry].promise; } finally { active--; }
  }));
  await admitted[0].promise;
  assert.deepEqual(started, [0, 1, 2]);
  for (const index of [2, 1, 0]) pending[index].resolve(index);
  await admitted[1].promise;
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  for (const index of [5, 4, 3]) pending[index].resolve(index);
  await admitted[2].promise;
  assert.equal(active, 2);
  for (const index of [7, 6]) pending[index].resolve(index);
  assert.deepEqual(await result, entries);
  assert.equal(peak, 3); assert.equal(active, 0);
});

test('a failed inspection drains its batch and prevents subsequent reads', { timeout: 2000 }, async () => {
  for (const synchronous of [false, true]) {
    const pending = Array.from({ length: 4 }, deferred), admitted = deferred(), started = [];
    const failure = new Error('Synthetic input failed');
    let active = 0, finished = false;
    const result = collect(checkedBatches([0, 1, 2, 3], entry => {
      started.push(entry); active++;
      if (started.length === 3) admitted.resolve();
      if (entry === 1 && synchronous) { active--; throw failure; }
      return pending[entry].promise.finally(() => { active--; });
    }));
    result.then(() => { finished = true; }, () => { finished = true; });
    await admitted.promise;
    if (!synchronous) pending[1].reject(failure);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(finished, false);
    pending[0].resolve(0); pending[2].resolve(2);
    await assert.rejects(result, error => error === failure);
    assert.deepEqual(started, [0, 1, 2]); assert.equal(active, 0);
  }
});

test('an empty catalogue performs no reads', async () => {
  assert.deepEqual(await collect(checkedBatches([], () => assert.fail('Unexpected read'))), []);
});
