// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepresentation, createResponseCache, sendRepresentation } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';

const MiB = 1024 ** 2;
test('a cached input plus output larger than a custom quota uses the existing identity bytes and validator', async () => {
  const budget = createResponseCacheBudget({ maxBytes: MiB }), cache = createResponseCache({ budget, maxBytes: MiB });
  const bytes = Buffer.alloc(768 * 1024, 'Z'), row = cache.set('state', createRepresentation(bytes));
  assert.equal(cache.size, 1);
  const expected = await row.encoded('identity');
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await sendRepresentation({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, response, row);
  assert.deepEqual(response.body, expected.bytes); assert.equal(response.headers.ETag, expected.etag);
  assert.equal(response.headers['Content-Encoding'], undefined);
  assert.equal(cache.size, 1); assert.equal(budget.bytes, bytes.length);
  assert.equal(budget.retentionLedger().encodingStarts, 0);
  assert.equal(budget.retentionLedger().complete, false);
  assert.deepEqual(budget.retentionLedger().blockers, ['uncacheable-encoding-exceeds-response-quota']);
  cache.clear(); assert.equal(budget.bytes, 0);
});

test('pressure fallback preserves custom identity validators, HEAD and 304; forbidden identity gets 503', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 128 * 1024 }), cache = createResponseCache({ budget });
  const pin = { retainedBytes: 128 * 1024, pinned: true }; cache.set('peer', pin);
  const row = createRepresentation('synthetic fallback', { identityETag: '"synthetic-identity"' }); row.encodingBudget = budget;
  for (const [method, validator, status] of [['GET', undefined, 200], ['HEAD', undefined, 200], ['GET', '"synthetic-identity"', 304]]) {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
    await sendRepresentation({ method, headers: { 'accept-encoding': 'br', ...(validator ? { 'if-none-match': validator } : {}) } }, response, row);
    assert.equal(response.status, status); assert.equal(response.headers.ETag, '"synthetic-identity"');
    assert.equal(response.headers['Content-Encoding'], undefined);
    assert.equal(response.body, method === 'HEAD' || status === 304 ? undefined : row.bytes);
  }
  await assert.rejects(sendRepresentation({ method: 'GET', headers: { 'accept-encoding': 'br, identity;q=0' } }, {}, row), {
    status: 503, code: 'RESPONSE_ENCODING_BUSY', retryAfter: 1,
  });
  assert.equal(budget.retentionLedger().encodingStarts, 0);
  pin.pinned = false; cache.clear();
  assert.deepEqual(await row.encoded('br'), await createRepresentation('synthetic fallback').encoded('br'));
  assert.equal(budget.retentionLedger().encodingStarts, 1); assert.equal(budget.bytes, 0);
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
