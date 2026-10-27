import { acquireHttpSession } from '../app/web/http-session-lock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { isTailscaleAddress, canSaveAddress, browserUUID } from '../app/web/save-address.mjs';
import { requestContext, checkRequestOrigin } from '../app/security/request.mjs';

const ip = (second, third = 0, fourth = 0) => [100, second, third, fourth].join('.');
const tailscale6 = 'fd7a:115c:a1e0::';

test('only literal Tailscale ranges extend insecure HTTP saving', () => {
  for (const hostname of [ip(64), ip(127, 255, 255), `[${tailscale6}1]`, `${tailscale6.toUpperCase()}FFFF:0:0:1`]) {
    assert.equal(isTailscaleAddress(hostname), true, hostname);
    assert.equal(canSaveAddress({ isSecureContext: false, location: { protocol: 'http:', hostname } }), true);
  }
  for (const hostname of [ip(63, 255, 255), ip(128), ip(64, 256, 1), [192, 168, 1, 1].join('.'), `[${['fd7a', '115c', 'a1e1', '', '1'].join(':')}]`, 'example.com', `${ip(64, 0, 1)}.example.com`, `${tailscale6}1/path`]) {
    assert.equal(isTailscaleAddress(hostname), false, hostname);
    assert.equal(canSaveAddress({ isSecureContext: false, location: { protocol: 'http:', hostname } }), false);
  }
  assert.equal(canSaveAddress({ isSecureContext: true }), true);
  assert.equal(canSaveAddress({ isSecureContext: false }), false);
});

test('UUID fallback uses random bytes with RFC 4122 version and variant bits', () => {
  const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = new Set(Array.from({ length: 100 }, () => browserUUID(crypto)));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(browserUUID({ randomUUID: () => 'native' }), 'native');
});

test('private Tailscale HTTP permits master credentials and same-origin writes', () => {
  for (const address of [ip(64, 0, 1), `${tailscale6}1`]) {
    const host = address.includes(':') ? `[${address}]:8901` : `${address}:8901`;
    const request = { socket: { remoteAddress: address }, headers: { host, origin: `http://${host}` } };
    const context = requestContext(request, { host: '127.0.0.1', ingressRole: 'private' });
    assert.equal(context.masterAllowed, true); assert.equal(context.publicRequest, false);
    assert.doesNotThrow(() => checkRequestOrigin(request, context));
    assert.throws(() => checkRequestOrigin({ ...request, headers: { ...request.headers, origin: 'http://example.com' } }, context), { status: 403 });
  }
});


// Whole transactions run in one microtask, matching IndexedDB's serialization of readwrite transactions.
function fakeIndexedDB() {
  const records = new Map();
  const db = { close() {}, createObjectStore() {}, transaction() {
    const ops = [], transaction = { objectStore: () => ({
      get(key) { const request = {}; ops.push(() => { request.result = records.get(key); request.onsuccess?.(); }); return request; },
      put(value, key) { ops.push(() => records.set(key, value)); },
      delete(key) { ops.push(() => records.delete(key)); },
    }) };
    queueMicrotask(() => { while (ops.length) ops.shift()(); transaction.oncomplete?.(); });
    return transaction;
  } };
  return { records, open() { const open = { result: db }; queueMicrotask(() => open.onsuccess()); return open; } };
}
function fakeChannels() {
  const members = new Set();
  return class {
    constructor(name) { this.name = name; members.add(this); }
    postMessage(data) { for (const member of members) if (member !== this && member.name === this.name) setTimeout(() => member.onmessage?.({ data: structuredClone(data) })); }
  };
}
// Each query string is a separate module instance: one per open page.
let pages = 0;
const page = async () => (await import(`../app/web/http-session-lock.mjs?page=${++pages}`)).acquireHttpSession;

test('HTTP ownership: a live owner keeps it, a reload takes over at once, and stale records are swapped atomically', async () => {
  const indexedDB = fakeIndexedDB(), BroadcastChannel = fakeChannels(), options = { BroadcastChannel, probeMs: 30 };
  const [first, duplicate, reloaded, racerA, racerB] = await Promise.all(Array.from({ length: 5 }, page));
  const release = await first('same', indexedDB, options);
  assert.equal(typeof release, 'function');
  assert.equal(await first('same', indexedDB, options), null, 'a second claim from the same page');
  assert.equal(await duplicate('same', indexedDB, options), null, 'the original tab answers for its session');
  release(); await new Promise(resolve => setTimeout(resolve));
  assert.equal(indexedDB.records.has('same'), false);

  // A reload's pagehide never finished the release: nobody answers, so the reloaded page takes over.
  indexedDB.records.set('same', 'left-by-reload');
  const resumed = await reloaded('same', indexedDB, options);
  assert.equal(typeof resumed, 'function');
  assert.notEqual(indexedDB.records.get('same'), 'left-by-reload');
  const current = indexedDB.records.get('same');

  // The page that lost a takeover race cannot delete the winner's record.
  indexedDB.records.set('stale', 'left-by-crash');
  const results = await Promise.all([racerA('stale', indexedDB, options), racerB('stale', indexedDB, options)]);
  assert.ok(results.filter(Boolean).length <= 1, 'at most one page takes over a stale session');
  resumed(); await new Promise(resolve => setTimeout(resolve));
  assert.equal(indexedDB.records.has('same'), false, `released ${current}`);

  // Without a channel no owner can answer, so a held record is never taken over.
  indexedDB.records.set('solo', 'held');
  assert.equal(await (await page())('solo', indexedDB, { BroadcastChannel: null, probeMs: 30 }), null);
  assert.equal(indexedDB.records.get('solo'), 'held');
});
