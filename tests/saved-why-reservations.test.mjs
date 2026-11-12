// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createResponseCache } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';
import { createSavedWhyEvidence, savedWhyCharge } from '../app/saved-why-evidence.mjs';

const MiB = 1024 ** 2;
const dim = (budget, unit) => budget.retentionLedger().dimensions.find(d => d.unit === unit);
const entry = (id, size = 883 * 1024) => ({ revision: 7, fullGzip: gzipSync(JSON.stringify({
  tasks: [{ id: `synthetic-${id}`, label: 'Z'.repeat(size) }],
})) });
function fixture(t, options = {}) {
  const budget = createResponseCacheBudget({ maxBytes: 128 * MiB, ...options });
  const peer = createResponseCache({ budget, maxBytes: 128 * MiB }), pin = { retainedBytes: 27 * MiB, pinned: true };
  peer.set('peer', pin);
  const owners = [], starts = [], gates = new Map();
  const gate = id => { if (!gates.has(id)) gates.set(id, { start: Promise.withResolvers(), finish: Promise.withResolvers() }); return gates.get(id); };
  function owner() {
    const value = createSavedWhyEvidence({ cache: createResponseCache({ budget, maxBytes: 0 }),
      async decodeGzip(gzip) {
        const raw = gunzipSync(gzip), id = JSON.parse(raw).tasks[0].id;
        starts.push(id); gate(id).start.resolve(); await gate(id).finish.promise; return raw;
      } });
    owners.push(value); return value;
  }
  t.after(async () => {
    for (const value of gates.values()) value.finish.resolve();
    await Promise.all(owners.map(value => value.close()));
    pin.pinned = false; peer.clear();
  });
  return { budget, peer, pin, owner, starts, gate };
}

test('56 distinct decodes across seven owners stay inside the shared count/byte caps and remain charged until release', async t => {
  const f = fixture(t), owners = Array.from({ length: 7 }, () => f.owner());
  const requests = Array.from({ length: 56 }, (_, id) => owners[id % 7].acquire(entry(id), 7).catch(error => error));
  await Promise.all([f.gate('synthetic-0').start.promise, f.gate('synthetic-1').start.promise]);
  assert.equal(f.starts.length, 2, 'the 64 MiB decode ceiling admits only two 883 KiB inputs');
  assert.equal(dim(f.budget, 'pendingDecodes').used, 2);
  assert.equal(dim(f.budget, 'queuedDecodes').used, 32);
  assert(dim(f.budget, 'queuedInputBytes').used > 0);
  const charged = dim(f.budget, 'decodeBytes').used;
  assert(charged > 54 * MiB && charged <= 64 * MiB);
  assert.equal(f.budget.bytes, f.pin.retainedBytes + charged + dim(f.budget, 'queuedInputBytes').used);
  for (const error of await Promise.all(requests.slice(34))) assert.equal(error.code, 'SAVED_WHY_BUSY');
  for (let id = 0; id < 34; id++) {
    await f.gate(`synthetic-${id}`).start.promise;
    assert(f.budget.bytes <= 128 * MiB);
    assert(dim(f.budget, 'decodeBytes').used <= 64 * MiB);
    f.gate(`synthetic-${id}`).finish.resolve();
    const lease = await requests[id];
    assert.equal(lease.value.tasks[0].id, `synthetic-${id}`);
    assert(owners[id % 7].stats().bytes > 0, 'settled decoded graph is still charged');
    lease.release();
  }
  assert.deepEqual(f.starts, Array.from({ length: 34 }, (_, id) => `synthetic-${id}`));
  assert.equal(f.budget.bytes, f.pin.retainedBytes);
  assert.equal(dim(f.budget, 'decodeBytes').used, 0);
  assert.equal(dim(f.budget, 'queuedDecodes').used, 0);
  for (const owner of owners) assert.equal(owner.stats().bytes, 0);
});

test('identical in-flight bytes coalesce service-wide; one cancelled owner leaves its live peer intact', async t => {
  const f = fixture(t), left = f.owner(), right = f.owner(), a = entry('shared'), controller = new AbortController();
  const first = left.acquire(a, 7, { signal: controller.signal });
  const second = right.acquire({ ...a, fullGzip: Buffer.from(a.fullGzip) }, 7);
  await f.gate('synthetic-shared').start.promise;
  assert.equal(f.budget.retentionLedger().decodeStarts, 1); assert.equal(f.starts.length, 1);
  controller.abort(); await assert.rejects(first, { name: 'AbortError' }); await left.close();
  f.gate('synthetic-shared').finish.resolve(); const lease = await second;
  assert.equal(lease.value.tasks[0].id, 'synthetic-shared');
  const used = dim(f.budget, 'decodeBytes').used;
  assert.equal(used, savedWhyCharge(a.fullGzip.readUInt32LE(a.fullGzip.length - 4), a.fullGzip.buffer.byteLength));
  lease.release(); assert.equal(f.budget.bytes, f.pin.retainedBytes);
});

for (const action of ['disconnect', 'forget', 'shutdown', 'budget-shutdown']) test(`${action} removes a queued decode before it runs`, async t => {
  const f = fixture(t), owner = f.owner(), a = entry(action), controller = new AbortController();
  f.pin.retainedBytes = 127 * MiB; f.pin.onSizeChange();
  const pending = owner.acquire(a, 7, { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError' || error.code === 'SAVED_WHY_BUSY');
  assert.equal(dim(f.budget, 'queuedDecodes').used, 1);
  assert(f.budget.bytes > f.pin.retainedBytes, 'queued gzip input and metadata are charged');
  if (action === 'disconnect') controller.abort();
  else if (action === 'forget') owner.forget(a);
  else if (action === 'shutdown') await owner.close();
  else f.budget.close();
  await rejected;
  f.pin.pinned = false; f.peer.clear();
  assert.equal(dim(f.budget, 'queuedDecodes').used, 0);
  assert.equal(f.budget.bytes, 0); assert.equal(f.budget.retentionLedger().decodeStarts, 0);
  assert.deepEqual(f.starts, []);
});

test('an active cancelled decode remains charged until native work settles; failed projection releases its result', async t => {
  const f = fixture(t), owner = f.owner(), controller = new AbortController();
  const pending = owner.acquire(entry('cancel-active'), 7, { signal: controller.signal });
  await f.gate('synthetic-cancel-active').start.promise;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert(dim(f.budget, 'decodeBytes').used > 0);
  f.gate('synthetic-cancel-active').finish.resolve(); await owner.close();
  assert.equal(dim(f.budget, 'decodeBytes').used, 0);
  const other = f.owner(), failed = other.use(entry('projection'), 7, {}, () => { throw new Error('synthetic projection failure'); });
  const rejects = assert.rejects(failed, /synthetic projection failure/);
  await f.gate('synthetic-projection').start.promise; f.gate('synthetic-projection').finish.resolve();
  await rejects; assert.equal(f.budget.bytes, f.pin.retainedBytes);
});

test('a full FIFO and an individually oversized decode return a clean capacity error without decoding', async t => {
  const f = fixture(t, { maxQueuedEncodings: 0 }), owner = f.owner();
  f.pin.retainedBytes = 127 * MiB; f.pin.onSizeChange();
  await assert.rejects(owner.acquire(entry('full'), 7), { status: 503, code: 'SAVED_WHY_BUSY', retryAfter: 1 });
  assert.equal(f.starts.length, 0); assert.equal(f.budget.bytes, f.pin.retainedBytes);
  const small = createResponseCacheBudget({ maxBytes: MiB });
  const bounded = createSavedWhyEvidence({ cache: createResponseCache({ budget: small, maxBytes: 0 }) });
  await assert.rejects(bounded.acquire(entry('oversized'), 7), { status: 503, code: 'SAVED_WHY_BUSY', retryAfter: 1 });
  assert.equal(small.bytes, 0); await bounded.close();
});
