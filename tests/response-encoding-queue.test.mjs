// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRepresentation, createResponseCache, sendRepresentation, RESPONSE_ENCODING_SIGNAL } from '../app/http-response.mjs';
import { createResponseCacheBudget } from '../app/response-cache-budget.mjs';

const KiB = 1024, MiB = KiB ** 2;
const dimension = (budget, unit) => budget.retentionLedger().dimensions.find(d => d.unit === unit);
function blocked(options = {}) {
  const budget = createResponseCacheBudget({ maxBytes: 4 * MiB, maxQueuedBytes: 512 * KiB, ...options });
  const peer = createResponseCache({ budget, maxBytes: 4 * MiB });
  const pin = { retainedBytes: 4 * MiB - 40 * KiB, pinned: true }; peer.set('peer', pin);
  const cache = createResponseCache({ budget, maxBytes: 0 });
  return { budget, peer, pin, row: text => cache.set(Symbol(), createRepresentation(text)),
    release() { pin.pinned = false; peer.clear(); } };
}
function channel(accept = 'br, identity;q=0') {
  const request = new EventEmitter(); request.headers = { 'accept-encoding': accept };
  request.method = 'GET';
  const response = new EventEmitter();
  response.writeHead = (status, headers) => Object.assign(response, { status, headers });
  response.end = body => { response.body = body; response.emit('finish'); };
  response.destroy = () => { response.destroyed = true; response.emit('close'); };
  return { request, response, result: () => ({ status: response.status, headers: response.headers, body: response.body }) };
}

test('queue count and input charges are bounded; cancelled waiters never enter native work', async () => {
  const f = blocked({ maxQueuedEncodings: 2 }), controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map((controller, i) => f.row(`synthetic-${i}`).encoded('br', { signal: controller.signal }));
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 2);
  const queued = dimension(f.budget, 'queuedInputBytes');
  assert(queued.used > 32 * KiB); assert(queued.used <= queued.cap);
  assert.equal(f.budget.bytes, f.pin.retainedBytes + queued.used);
  await assert.rejects(f.row('overflow').encoded('br'), { code: 'RESPONSE_ENCODING_BUSY' });
  controllers.forEach(controller => controller.abort());
  for (const promise of pending) await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 0);
  assert.equal(f.budget.bytes, f.pin.retainedBytes);
  f.release(); assert.equal(f.budget.retentionLedger().encodingStarts, 0);
});

test('the independent queue byte cap declines work before its count cap', async () => {
  const f = blocked({ maxQueuedEncodings: 8, maxQueuedBytes: 16 * KiB + 64 }), controller = new AbortController();
  const pending = f.row('Z'.repeat(64)).encoded('gzip', { signal: controller.signal });
  assert.equal(dimension(f.budget, 'queuedInputBytes').used, 16 * KiB + 64);
  await assert.rejects(f.row('another').encoded('gzip'), { code: 'RESPONSE_ENCODING_BUSY' });
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); f.release();
});

test('one disconnected caller does not cancel the live caller sharing its queued encoding', async () => {
  const f = blocked(), row = f.row('synthetic shared reply'), left = channel(), right = channel();
  const disconnected = sendRepresentation(left.request, left.response, row);
  const live = sendRepresentation(right.request, right.response, row);
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  left.response.destroy(); await disconnected;
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  f.release(); await live;
  const control = channel();
  await sendRepresentation(control.request, control.response, createRepresentation('synthetic shared reply'));
  assert.deepEqual(right.result(), control.result());
  assert.equal(f.budget.retentionLedger().encodingStarts, 1);
});

test('FIFO wakes only the live head as space permits', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 256 * KiB, maxQueuedBytes: 64 * KiB });
  const peer = createResponseCache({ budget }), pin = { retainedBytes: 200 * KiB, pinned: true };
  peer.set('peer', pin);
  const starts = [], gates = [0, 1, 2].map(() => Promise.withResolvers()), releases = [];
  for (let id = 0; id < 3; id++) {
    void budget.reserveEncoding({ cost: () => 80 * KiB, uncachedCost: () => 80 * KiB,
      inputBytes: () => KiB, inputCost: () => KiB, pin() {}, unpin() {} }).then(release => {
      starts.push(id); releases[id] = release; gates[id].resolve();
    });
  }
  assert.equal(dimension(budget, 'queuedEncodings').used, 3);
  pin.retainedBytes = 110 * KiB; pin.onSizeChange();
  for (let id = 0; id < 3; id++) {
    await gates[id].promise;
    assert.deepEqual(starts, Array.from({ length: id + 1 }, (_, i) => i));
    assert.equal(dimension(budget, 'queuedEncodings').used, 2 - id);
    releases[id]();
  }
  pin.pinned = false; peer.clear(); assert.equal(budget.bytes, 0);
});

for (const event of ['close', 'aborted', 'shutdown']) test(`${event} removes a queued HTTP encoding before it can run`, async () => {
  const f = blocked(), io = channel(), shutdown = new AbortController();
  io.request[RESPONSE_ENCODING_SIGNAL] = shutdown.signal;
  const sending = sendRepresentation(io.request, io.response, f.row('synthetic pending reply'));
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  if (event === 'close') io.response.destroy();
  else if (event === 'aborted') { io.request.aborted = true; io.request.emit('aborted'); }
  else shutdown.abort();
  await sending;
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 0);
  assert.equal(io.response.body, undefined);
  f.release(); assert.equal(f.budget.retentionLedger().encodingStarts, 0);
});

test('eviction cancels queued work and preserves the live identity reply and validator', async () => {
  const f = blocked(), cache = createResponseCache({ budget: f.budget }), io = channel('br');
  const row = cache.set('state', createRepresentation('synthetic identity fallback'));
  const sending = sendRepresentation(io.request, io.response, row);
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  cache.delete('state'); await sending;
  const control = channel('identity');
  await sendRepresentation(control.request, control.response, createRepresentation('synthetic identity fallback'));
  assert.deepEqual(io.result(), control.result());
  f.release(); assert.equal(f.budget.retentionLedger().encodingStarts, 0);
});

test('a full queue falls back to identity or cleanly refuses an identity-forbidden request', async () => {
  const f = blocked({ maxQueuedEncodings: 0 }), io = channel('br');
  await sendRepresentation(io.request, io.response, f.row('synthetic fallback'));
  const control = channel('identity');
  await sendRepresentation(control.request, control.response, createRepresentation('synthetic fallback'));
  assert.deepEqual(io.result(), control.result());
  const forbidden = channel();
  await assert.rejects(sendRepresentation(forbidden.request, forbidden.response, f.row('synthetic fallback')), { status: 503, code: 'RESPONSE_ENCODING_BUSY' });
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 0); f.release();
});

test('live queued replies keep exact compressed bytes and ETags', async () => {
  for (const encoding of ['gzip', 'br']) {
    const f = blocked(), io = channel(`${encoding}, identity;q=0`), row = f.row('synthetic queued reply');
    const sending = sendRepresentation(io.request, io.response, row);
    assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
    f.release(); await sending;
    const control = channel(`${encoding}, identity;q=0`);
    await sendRepresentation(control.request, control.response, createRepresentation('synthetic queued reply'));
    assert.deepEqual(io.result(), control.result()); assert.equal(f.budget.bytes, 0);
  }
});

test('successive disconnected 1 MiB revisions behind a 3 MiB quota leave no work or inputs queued', async () => {
  const budget = createResponseCacheBudget({ maxBytes: 3 * MiB }), peer = createResponseCache({ budget });
  const pin = { retainedBytes: 3 * MiB, pinned: true }; peer.set('peer', pin);
  const cache = createResponseCache({ budget, maxBytes: 0 }), sends = [];
  for (let revision = 0; revision < 24; revision++) {
    const io = channel('br'), row = cache.set(revision, createRepresentation(Buffer.alloc(MiB, String(revision % 10))));
    sends.push(sendRepresentation(io.request, io.response, row)); io.response.destroy();
  }
  await Promise.all(sends);
  assert.equal(dimension(budget, 'queuedEncodings').used, 0); assert.equal(dimension(budget, 'queuedInputBytes').used, 0);
  pin.pinned = false; peer.clear(); assert.equal(budget.bytes, 0); assert.equal(budget.retentionLedger().encodingStarts, 0);
});

test('budget shutdown removes all queued work', async () => {
  const f = blocked(), pending = f.row('synthetic shutdown').encoded('br');
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 1);
  f.budget.close(); await assert.rejects(pending, { code: 'RESPONSE_ENCODING_BUSY' });
  assert.equal(dimension(f.budget, 'queuedEncodings').used, 0); f.release(); assert.equal(f.budget.bytes, 0);
});
