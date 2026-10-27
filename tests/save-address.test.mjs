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


test('HTTP ownership is atomic, never expires, and releases only on document closure', async () => {
  const owners = new Set();
  const indexedDB = { open() {
    const open = {};
    queueMicrotask(() => {
      open.result = { close() {}, transaction() {
        const transaction = { objectStore: () => ({
          add(_value, key) { queueMicrotask(() => {
            if (owners.has(key)) { transaction.error = { name: 'ConstraintError' }; transaction.onabort(); }
            else { owners.add(key); transaction.oncomplete(); }
          }); },
          delete(key) { queueMicrotask(() => { owners.delete(key); transaction.oncomplete(); }); },
        }) };
        return transaction;
      } };
      open.onsuccess();
    });
    return open;
  } };
  const contenders = await Promise.all([acquireHttpSession('same', indexedDB), acquireHttpSession('same', indexedDB)]);
  assert.equal(contenders.filter(Boolean).length, 1);
  assert.equal(await acquireHttpSession('same', indexedDB), null);
  contenders.find(Boolean)(); await Promise.resolve();
  const recovered = await acquireHttpSession('same', indexedDB);
  assert.equal(typeof recovered, 'function'); recovered();
});
