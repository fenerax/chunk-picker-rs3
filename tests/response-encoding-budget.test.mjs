// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepresentation, createResponseCache, sendRepresentation } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';
import { serviceMemoryBudget } from '../app/service-memory-budget.mjs';

const MiB = 1024 ** 2;
for (const encoding of ['gzip', 'br']) test(`${encoding} is charged and pinned through peer pressure with one shared promise and identical replies`, async () => {
  const configuration = serviceMemoryBudget({ env: { RS3_MEMORY_PROFILE: 'budget-672' } });
  const budget = createResponseCacheBudget({ maxBytes: configuration.responseBytes });
  const a = createResponseCache({ budget, maxBytes: 48 * MiB }), b = createResponseCache({ budget, maxBytes: 128 * MiB });
  const bytes = Buffer.from('Synthetic response '.repeat(65536));
  const representation = a.set('state', createRepresentation(bytes)), pending = representation.encoded(encoding);
  assert.equal(representation.pinned, true);
  assert(budget.bytes > bytes.length, 'output is reserved before native work');
  for (const key of ['peer-1', 'peer-2', 'peer-3']) b.set(key, { retainedBytes: 120 * MiB });
  const same = a.get('state'); assert.equal(same, representation);
  assert.equal(same.encoded(encoding), pending, 'second GET reuses the existing encoding promise');
  assert(budget.bytes <= configuration.responseBytes);
  const actual = await pending, expected = await createRepresentation(bytes).encoded(encoding);
  assert.equal(representation.pinned, false); assert.deepEqual(actual, expected);
  const reply = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });
  const request = { method: 'GET', headers: { 'accept-encoding': `${encoding}, identity;q=0` } };
  const left = reply(), right = reply();
  await sendRepresentation(request, left, representation);
  await sendRepresentation(request, right, createRepresentation(bytes));
  assert.deepEqual({ status: left.status, headers: left.headers, body: left.body },
    { status: right.status, headers: right.headers, body: right.body });
  a.clear(); b.clear(); assert.equal(budget.bytes, 0);
});

test('uncached encodings wait for charged native work and invalidation releases pins on settlement', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 4 * MiB });
  const a = createResponseCache({ budget, maxBytes: 2 * MiB }), b = createResponseCache({ budget, maxBytes: 0 });
  const bytes = Buffer.alloc(MiB, 'Z'), retained = a.set('a', createRepresentation(bytes));
  const first = retained.encoded('br');
  const uncached = b.set('b', createRepresentation(bytes)), second = uncached.encoded('gzip');
  assert(retained.pinned); assert.equal(uncached.pinned, false, 'refused cache entry does no uncharged native work');
  a.clear(); assert.equal(a.get('a'), undefined);
  assert(budget.bytes >= bytes.length, 'invalidated native input remains charged');
  await Promise.all([first, second]);
  assert.equal(retained.pinned, false); assert.equal(uncached.pinned, false);
  assert.equal(a.bytes, 0); assert.equal(budget.bytes, 0);
});

test('an explicitly undersized response quota serializes an uncacheable encoding and reports its proof gap', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 0 }), cache = createResponseCache({ budget, maxBytes: 0 });
  const row = cache.set('a', createRepresentation('synthetic')), pending = row.encoded('gzip');
  assert(row.pinned); assert(budget.bytes > 0);
  assert.equal(budget.retentionLedger().complete, false);
  assert.deepEqual(budget.retentionLedger().blockers, ['uncacheable-encoding-exceeds-response-quota']);
  assert.deepEqual(await pending, await createRepresentation('synthetic').encoded('gzip'));
  assert.equal(row.pinned, false); assert.equal(budget.bytes, 0);
});
