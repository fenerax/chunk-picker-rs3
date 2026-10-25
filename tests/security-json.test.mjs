import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestJSON } from '../app/security/json.mjs';
import { createRateLimits, createStreamLimits, writeEvent } from '../app/security/request.mjs';

test('JSON nesting is bounded before parsing and delimiters inside escaped strings are ignored', () => {
  const nested = levels => '{"value":' + '['.repeat(levels) + '0' + ']'.repeat(levels) + '}';
  assert.deepEqual(parseRequestJSON(nested(127)), JSON.parse(nested(127)));
  assert.throws(() => parseRequestJSON(nested(128)), { status: 400, message: 'JSON nesting exceeds the 128 level limit.' });
  assert.throws(() => parseRequestJSON(nested(100000)), { status: 400 });
  const strings = { value: ['{'.repeat(1000), '\\"[{}]\\', '"'.repeat(1000)] };
  assert.deepEqual(parseRequestJSON(JSON.stringify(strings)), strings);
  for (const malformed of ['{"a":}', '{"a":"unterminated', '{"a": [1}']) assert.throws(() => parseRequestJSON(malformed), { status: 400 });
});

test('expensive request budgets reserve synchronously across routes and identities with a global ceiling', () => {
  let at = 0;
  const limits = createRateLimits({ now: () => at, expensive: 2, expensiveGlobal: 3, expensiveWindowMs: 1000 });
  limits.expensive('invite-A'); limits.expensive('invite-A');
  assert.throws(() => limits.expensive('invite-A'), { status: 429, retryAfter: 1 });
  limits.expensive('invite-B');
  assert.throws(() => limits.expensive('invite-C'), { status: 429 });
  at = 1000;
  assert.doesNotThrow(() => limits.expensive('invite-A'));
  assert.throws(() => createRateLimits({ expensive: 0 }), TypeError);
});

test('expensive budget overflow cannot evict a live identity to reset its budget', () => {
  const limits = createRateLimits({ now: () => 0, expensive: 1, expensiveGlobal: 100, maxClients: 1 });
  limits.expensive('A');
  assert.throws(() => limits.expensive('A'), { status: 429 });
  assert.throws(() => limits.expensive('B'), { status: 429 });
});


test('stream reservations release once and slow consumers are destroyed at backpressure', () => {
  const admit = createStreamLimits({ streamsPerIdentity: 1, streamsGlobal: 2 });
  assert.equal(admit('A', { destroyed: true }), false);
  assert.equal(admit('B', { writableEnded: true }), false);
  const first = new EventEmitter(), second = new EventEmitter();
  admit('A', first); admit('B', second);
  assert.throws(() => admit('A', new EventEmitter()), { status: 429 });
  assert.throws(() => admit('C', new EventEmitter()), { status: 429 });
  first.emit('finish'); first.emit('close'); admit('A', new EventEmitter());
  assert.throws(() => admit('C', new EventEmitter()), { status: 429 });
  let writes = 0;
  const slow = { destroyed: false, write() { writes++; return false; }, destroy() { this.destroyed = true; } };
  assert.equal(writeEvent(slow, 'event'), false); assert.equal(slow.destroyed, true);
  assert.equal(writeEvent(slow, 'another'), false); assert.equal(writes, 1);
});
