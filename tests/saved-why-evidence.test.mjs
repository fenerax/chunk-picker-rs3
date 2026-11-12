// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createResponseCache } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';
import { createSavedWhyEvidence, forgetSavedWhyChain, savedWhyCharge } from '../app/saved-why-evidence.mjs';

const makeEntry = () => ({ revision: 7, fullGzip: gzipSync(JSON.stringify({ tasks: [{ id: 'fixture', record: {} }] })) });
function timers() {
  const active = new Map(); let sequence = 0;
  return { active, setTimeout(fn) { active.set(++sequence, fn); return sequence; }, clearTimeout(id) { active.delete(id); } };
}

test('saved parsed evidence reserves shared ledger bytes before decode and releases all lifecycle owners', async t => {
  const cache = createResponseCache(), clock = timers(), owner = createSavedWhyEvidence({ cache, clock });
  t.after(() => owner.close());
  const entry = makeEntry(), charge = savedWhyCharge(entry.fullGzip.readUInt32LE(entry.fullGzip.length - 4), entry.fullGzip.buffer.byteLength);
  const pending = owner.read(entry, 7);
  assert.equal(cache.bytes, charge); assert.equal(owner.stats().bytes, charge); assert.equal(owner.stats().pending, 1);
  const graph = await pending;
  assert.equal(await owner.read(entry, 7), graph); assert.equal(clock.active.size, 1);
  for (const invalidate of [
    () => forgetSavedWhyChain(entry),
    async () => { entry.revision = 8; await owner.read(entry, 7); entry.revision = 7; },
    () => cache.clear(),
    () => [...clock.active.values()][0](),
  ]) {
    await invalidate();
    assert.equal(clock.active.size, 0); assert.equal(owner.stats().entries, 0);
    assert.equal(owner.stats().bytes, 0); assert.equal(cache.bytes, 0);
    await owner.read(entry, 7);
  }
  const previous = await owner.read(entry, 7);
  entry.fullGzip = gzipSync(JSON.stringify({ tasks: [{ id: 'replacement' }] }));
  const replaced = await owner.read(entry, 7);
  assert.notEqual(replaced, previous); assert.equal(clock.active.size, 1); assert.equal(owner.stats().entries, 1);
  entry.fullGzip = Buffer.alloc(0);
  assert.equal(await owner.read(entry, 7), undefined); assert.equal(clock.active.size, 0); assert.equal(cache.bytes, 0);
  entry.fullGzip = makeEntry().fullGzip; await owner.read(entry, 7);
  await owner.close(); assert.equal(cache.bytes, 0); assert.equal(clock.active.size, 0);
  assert.equal(await owner.read(makeEntry(), 7), undefined);
});

test('saved decode admission shares limits and keeps in-flight invalidations charged until settlement', async t => {
  const entry = makeEntry(), charge = savedWhyCharge(entry.fullGzip.readUInt32LE(entry.fullGzip.length - 4), entry.fullGzip.buffer.byteLength);
  const cache = createResponseCache({ maxEntries: 1, maxBytes: charge }), clock = timers();
  const owner = createSavedWhyEvidence({ cache, clock }); t.after(() => owner.close());
  const read = owner.read(entry, 7);
  cache.clear();
  assert.equal(clock.active.size, 0); assert.equal(owner.stats().entries, 0);
  assert.equal(cache.bytes, charge, 'native decode still owns its reservation');
  assert.equal(await owner.read(makeEntry(), 7), undefined, 'no concurrent over-admission');
  assert.equal(await read, undefined); assert.equal(cache.bytes, 0);
  await owner.read(entry, 7);
  cache.set('response', { retainedBytes: charge });
  assert.equal(owner.stats().entries, 0); assert.equal(clock.active.size, 0);
  assert.equal(cache.bytes, charge, 'response eviction reuses the existing quota');
  assert.equal(await owner.read({ revision: 7, fullGzip: gzipSync('x'.repeat(1024 * 1024 + 1)) }, 7), undefined);
  const small = createSavedWhyEvidence({ cache: createResponseCache({ maxBytes: charge - 1 }), clock });
  t.after(() => small.close()); assert.equal(await small.read(entry, 7), undefined); assert.equal(small.stats().bytes, 0);
  const forged = Buffer.from(gzipSync('x'.repeat(10_000))); forged.writeUInt32LE(10, forged.length - 4);
  assert.equal(await owner.read({ revision: 7, fullGzip: forged }, 7), undefined);
  const invalid = { revision: 7, fullGzip: gzipSync('invalid json') };
  assert.equal(await owner.read(invalid, 7), undefined);
  assert.equal(owner.stats().bytes, 0); assert.equal(clock.active.size, 0);
});

test('peer-pinned global pressure preserves saved evidence without retaining a decoded fallback', async t => {
  const entry = makeEntry(), raw = entry.fullGzip.readUInt32LE(entry.fullGzip.length - 4);
  const charge = savedWhyCharge(raw, entry.fullGzip.buffer.byteLength);
  const budget = createResponseCacheBudget({ maxBytes: charge + 65536, maxEntries: 1 });
  const peer = createResponseCache({ budget, maxBytes: charge + 65536 });
  const reservation = { retainedBytes: 65536, pinned: true };
  peer.set('peer', reservation);
  const cache = createResponseCache({ budget }), clock = timers();
  const owner = createSavedWhyEvidence({ cache, clock }); t.after(() => owner.close());
  const first = owner.acquire(entry, 7);
  const shared = owner.acquire(entry, 7);
  assert.equal(owner.stats().pending, 1); assert.equal(cache.bytes, 0);
  const decoded = await first, second = await shared;
  assert.equal(second.value, decoded.value, 'refused same-evidence callers share one bounded decode');
  assert.deepEqual(decoded.value, { tasks: [{ id: 'fixture', record: {} }] });
  assert.equal(owner.stats().bytes, charge);
  decoded.release(); second.release();
  assert.deepEqual(owner.stats(), { entries: 0, pending: 0, bytes: 0, maxRawBytes: 1024 ** 2 });
  assert.equal(clock.active.size, 0); assert.equal(budget.bytes, 65536);
  reservation.pinned = false; peer.clear();
  const retained = await owner.acquire(entry, 7), again = await owner.acquire(entry, 7);
  assert.equal(again.value, retained.value); retained.release(); again.release();
});

test('invalidated saved graphs and entries collect while the owning context remains reachable', async () => {
  // GC is enabled only in this test-owned child, never in application/global config.
  const { stdout } = await promisify(execFile)(process.execPath, ['--expose-gc', fileURLToPath(new URL('./helpers/saved-why-gc.mjs', import.meta.url))], { timeout: 30_000 });
  assert.match(stdout, /collected all saved evidence/);
});

test('every saved-Why decode settlement releases charges, including failure, abort and uncached fallback', async () => {
  for (const mode of ['success', 'invalid-json', 'forgotten', 'closed', 'uncached']) {
    const budget = createResponseCacheBudget({ maxBytes: 256 * 1024, maxEntries: 1 });
    const peer = createResponseCache({ budget }), reservation = { retainedBytes: 128 * 1024, pinned: true };
    if (mode === 'uncached') peer.set('peer', reservation);
    const cache = createResponseCache({ budget });
    const owner = createSavedWhyEvidence({ cache, clock: timers() }), entry = makeEntry();
    if (mode === 'invalid-json') entry.fullGzip = gzipSync('not json');
    const decoding = owner.acquire(entry, 7);
    const result = decoding.catch(error => { assert.equal(error.name, 'AbortError', mode); });
    if (mode === 'forgotten') forgetSavedWhyChain(entry);
    const closing = mode === 'closed' ? owner.close() : undefined;
    const lease = await result; lease?.release(); await closing;
    await owner.close(); reservation.pinned = false; peer.clear();
    assert.equal(budget.bytes, 0, mode);
    assert.equal(budget.retentionLedger().dimensions.find(d => d.unit === 'pendingDecodes').used, 0, mode);
  }
});
