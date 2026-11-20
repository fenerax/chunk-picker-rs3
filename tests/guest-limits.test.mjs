// @test quick
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestLimits, GUEST_LIMITS } from '../app/guest-limits.mjs';

const refused = (work, status) => assert.throws(work, error => error.status === status && (status !== 429 || error.retryAfter > 0));
test('guest admission has per-IP/global ceilings, IP binding, fixed expiry and reload reuse', () => {
  let at = 0;
  const limits = createGuestLimits({ now: () => at });
  const one = limits.open('a'), two = limits.open('a');
  assert.notEqual(one.token, two.token);
  refused(() => limits.open('a'), 429);
  for (let index = 0; index < GUEST_LIMITS.sessionsGlobal - 2; index++) limits.open(`ip-${index}`);
  refused(() => limits.open('another'), 429);
  refused(() => limits.acquire(one.token, 'b'), 401);
  refused(() => limits.acquire('invalid', 'a'), 401);
  at = GUEST_LIMITS.lifetimeMs - 1;
  assert.deepEqual(limits.open('a', one.token), one, 'Reload does not allocate or renew');
  limits.acquire(one.token, 'a').release();
  at++;
  refused(() => limits.acquire(one.token, 'a'), 401);
  assert.notEqual(limits.open('a', one.token).token, one.token);
  limits.close(); refused(() => limits.open('new'), 503);
});
test('guest requests and admissions share IP/global rate windows across tokens', () => {
  let at = 0;
  const limits = createGuestLimits({ now: () => at, sessionsPerIP: 20, sessionsGlobal: 30, admissionsPerIP: 2,
    admissionsGlobal: 3, requestsPerIP: 2, requestsGlobal: 3 });
  const one = limits.open('a'), two = limits.open('a'), three = limits.open('b');
  refused(() => limits.open('a'), 429); refused(() => limits.open('c'), 429);
  limits.acquire(one.token, 'a').release(); limits.acquire(two.token, 'a').release();
  refused(() => limits.acquire(one.token, 'a'), 429);
  limits.acquire(three.token, 'b').release(); refused(() => limits.acquire(three.token, 'b'), 429);
  at = 60000;
  limits.acquire(one.token, 'a').release(); assert.ok(limits.open('c').token);
});
test('guest capacity remains held until explicit release, including across expiry', () => {
  let at = 0;
  const limits = createGuestLimits({ now: () => at });
  const one = limits.open('a'), two = limits.open('b');
  const active = limits.acquire(one.token, 'a');
  refused(() => limits.acquire(two.token, 'b'), 429);
  at = GUEST_LIMITS.lifetimeMs;
  const replacement = limits.open('c');
  refused(() => limits.acquire(replacement.token, 'c'), 429);
  active.release(); active.release();
  limits.acquire(replacement.token, 'c').release();
});
test('guest upload admission enforces independent per-IP, global and aggregate byte budgets', () => {
  let at = 0;
  const limits = createGuestLimits({ now: () => at, uploadsPerIP: 1, uploadsGlobal: 2, uploadBytesGlobal: 100 });
  const one = limits.open('a'), two = limits.open('b'), three = limits.open('c');
  const first = limits.admitUpload(one.token, 'a');
  refused(() => limits.admitUpload(one.token, 'a'), 429);
  first.reserveBytes(70);
  // Worker calculation slot remains free while an upload is in progress.
  const worker = limits.acquire(two.token, 'b');
  worker.release();
  const second = limits.admitUpload(two.token, 'b');
  refused(() => limits.admitUpload(three.token, 'c'), 429);
  refused(() => second.reserveBytes(40), 429);
  second.reserveBytes(30);
  first.release(); first.release();
  second.reserveBytes(40);
  second.release();
  limits.admitUpload(three.token, 'c').release();
});
