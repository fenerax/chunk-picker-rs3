// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepresentation, createResponseCache } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';

const MiB = 1024 ** 2;
test('a cached input plus output larger than a custom quota completes exclusively and reports the excess', async () => {
  const budget = createResponseCacheBudget({ maxBytes: MiB }), cache = createResponseCache({ budget, maxBytes: MiB });
  const bytes = Buffer.alloc(768 * 1024, 'Z'), row = cache.set('state', createRepresentation(bytes));
  assert.equal(cache.size, 1);
  const actual = await row.encoded('gzip');
  assert.deepEqual(actual, await createRepresentation(bytes).encoded('gzip'));
  assert.equal(cache.size, 0); assert.equal(budget.bytes, 0);
  assert.equal(budget.retentionLedger().complete, false);
  assert.deepEqual(budget.retentionLedger().blockers, ['uncacheable-encoding-exceeds-response-quota']);
});

test('two encoding pins share the input charge and outlive clear until both settle', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 4 * MiB, maxEntries: 1 });
  const cache = createResponseCache({ budget, maxBytes: 2 * MiB });
  const bytes = Buffer.alloc(MiB, 'Z'), row = cache.set('state', createRepresentation(bytes));
  const gzip = row.encoded('gzip'), br = row.encoded('br');
  assert(row.pinned); assert(budget.bytes > 3 * MiB); assert(budget.bytes <= 4 * MiB);
  assert.equal(budget.retentionLedger().dimensions.find(d => d.unit === 'pendingEncodings').used, 2);
  cache.clear(); assert.equal(cache.get('state'), undefined);
  assert(budget.bytes > 3 * MiB, 'clear cannot hide either native reservation');
  const control = createRepresentation(bytes);
  assert.deepEqual(await gzip, await control.encoded('gzip'));
  assert.deepEqual(await br, await control.encoded('br'));
  assert.equal(row.pinned, false); assert.equal(cache.bytes, 0); assert.equal(budget.bytes, 0);
});

test('report-only default preserves eviction of pending encodings without added admission', async () => {
  const budget = createResponseCacheBudget({ maxBytes: null, maxEntries: null });
  const cache = createResponseCache({ budget, maxBytes: MiB });
  const bytes = Buffer.alloc(MiB, 'Z'), row = cache.set('first', createRepresentation(bytes));
  const pending = row.encoded('br');
  assert.equal(row.pinned, false); assert.equal(budget.bytes, MiB);
  cache.set('second', createRepresentation(bytes));
  assert.equal(cache.get('first'), undefined);
  assert.equal(budget.bytes, MiB);
  assert.deepEqual(await pending, await createRepresentation(bytes).encoded('br'));
  cache.clear(); assert.equal(budget.bytes, 0);
});
