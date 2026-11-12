// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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

test('uncached encoding refusal is immediate and invalidation releases active pins on settlement', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 4 * MiB });
  const a = createResponseCache({ budget, maxBytes: 2 * MiB }), b = createResponseCache({ budget, maxBytes: 0 });
  const bytes = Buffer.alloc(MiB, 'Z'), retained = a.set('a', createRepresentation(bytes));
  const first = retained.encoded('br');
  const uncached = b.set('b', createRepresentation(bytes));
  await assert.rejects(uncached.encoded('gzip'), { status: 503, code: 'RESPONSE_ENCODING_BUSY', retryAfter: 1 });
  assert(retained.pinned); assert.equal(uncached.pinned, false, 'refused cache entry does no uncharged native work');
  a.clear(); assert.equal(a.get('a'), undefined);
  assert(budget.bytes >= bytes.length, 'invalidated native input remains charged');
  await first;
  assert.equal(retained.pinned, false); assert.equal(uncached.pinned, false);
  assert.equal(a.bytes, 0); assert.equal(budget.bytes, 0);
});

test('an explicitly undersized response quota refuses native work and reports its proof gap', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 0 }), cache = createResponseCache({ budget, maxBytes: 0 });
  const row = cache.set('a', createRepresentation('synthetic'));
  await assert.rejects(row.encoded('gzip'), { code: 'RESPONSE_ENCODING_BUSY' });
  assert.equal(budget.bytes, 0);
  assert.equal(budget.retentionLedger().complete, false);
  assert.deepEqual(budget.retentionLedger().blockers, ['uncacheable-encoding-exceeds-response-quota']);
  assert.equal(row.pinned, false); assert.equal(budget.bytes, 0);
});

function channel(encoding) {
  const request = { method: 'GET', headers: { 'accept-encoding': encoding } }, response = new EventEmitter();
  response.writeHead = (status, headers) => Object.assign(response, { status, headers });
  response.end = body => { response.body = body; response.emit('finish'); };
  response.destroy = () => { response.destroyed = true; response.emit('close'); };
  return { request, response };
}

for (const encoding of ['gzip', 'br']) test(`${encoding} burst admits only charged work and immediately sends identity for peers`, async () => {
  const budget = createResponseCacheBudget({ maxBytes: 3 * MiB }), cache = createResponseCache({ budget, maxBytes: 0 });
  const bytes = Buffer.alloc(MiB, 'Z'), control = createRepresentation(bytes);
  const compressed = await control.encoded(encoding), identity = await control.encoded('identity');
  const channels = Array.from({ length: 24 }, () => channel(encoding));
  const sends = channels.map((io, revision) => sendRepresentation(io.request, io.response, cache.set(revision, createRepresentation(bytes))));
  assert.equal(budget.retentionLedger().encodingStarts, 1);
  assert(budget.bytes > MiB && budget.bytes <= 3 * MiB);
  await Promise.all(sends);
  for (const [index, { response }] of channels.entries()) {
    assert.equal(response.status, 200);
    const expected = index === 0 ? compressed : identity;
    assert.deepEqual(response.body, expected.bytes); assert.equal(response.headers.ETag, expected.etag);
    assert.equal(response.headers['Content-Encoding'], index === 0 ? encoding : undefined);
  }
  assert.equal(budget.bytes, 0);
  assert.equal(budget.retentionLedger().dimensions.find(d => d.unit === 'pendingEncodings').used, 0);
});

test('a disconnect during active encoding keeps the charge until settlement and sends no reply', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 4 * MiB }), cache = createResponseCache({ budget });
  const row = cache.set('state', createRepresentation(Buffer.alloc(MiB, 'Z'))), io = channel('br');
  const sending = sendRepresentation(io.request, io.response, row);
  assert(row.pinned); const charged = budget.bytes;
  io.response.destroy(); cache.clear();
  assert.equal(budget.bytes, charged, 'socket close and eviction cannot hide active native work');
  await sending;
  assert.equal(io.response.body, undefined); assert.equal(row.pinned, false); assert.equal(budget.bytes, 0);
});

test('decode admission returns a synchronous release or refusal and respects active caps and shutdown', () => {
  const budget = createResponseCacheBudget({ maxBytes: MiB, maxPendingDecodes: 2, maxDecodeBytes: MiB / 2 });
  const first = budget.reserveDecode({ cost: MiB / 4 }), second = budget.reserveDecode({ cost: MiB / 4 });
  assert.equal(typeof first, 'function'); assert.equal(typeof second, 'function');
  assert.equal(budget.reserveDecode({ cost: 1 }), undefined); assert.equal(budget.bytes, MiB / 2);
  first(); first(); assert.equal(budget.bytes, MiB / 4);
  assert.equal(budget.reserveDecode({ cost: MiB / 2 }), undefined);
  budget.close(); assert.equal(budget.reserveDecode({ cost: 1 }), undefined);
  second(); assert.equal(budget.bytes, 0);
});
