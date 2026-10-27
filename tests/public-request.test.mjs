import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRequestOrigin, normalizeIngressRole, requestContext } from '../app/security/request.mjs';

const options = { host: '100.64.0.0', publicOrigin: 'https://picker.example', ingressRole: 'public' };
const request = (peer = '127.0.0.1', headers = {}, encrypted = false) => ({
  socket: { remoteAddress: peer, encrypted }, headers: { host: 'picker.example', ...headers },
});

test('listener roles default to private and reject unknown configuration values', () => {
  assert.equal(normalizeIngressRole(), 'private');
  for (const role of ['private', 'public']) assert.equal(normalizeIngressRole(role), role);
  for (const role of ['', 'PUBLIC', 'admin', null, true]) assert.throws(() => normalizeIngressRole(role), TypeError);
  const ordinary = requestContext(request(), { host: options.host, publicOrigin: options.publicOrigin });
  assert.equal(ordinary.ingressRole, 'private');
  assert.equal(ordinary.masterAllowed, true);
  assert.equal(ordinary.publicRequest, false);
});

test('a public listener stays public with absent, malformed, chained or private forwarding metadata', () => {
  for (const peer of ['127.0.0.1', '::1', `::ffff:${'127.0.0.1'}`, '127.0.0.2', '100.64.0.0', '203.0.113.9']) {
    for (const headers of [
      {}, { 'x-forwarded-proto': 'https' }, { 'x-forwarded-host': 'picker.example' },
      ...['127.0.0.1', '::1', '100.64.0.0', 'fd7a:115c:a1e0::' + '1', '203.0.113.7',
        '127.0.0.1, 203.0.113.7', '', 'unknown', '[::1]', '127.0.0.1:123'].map(value => ({ 'x-forwarded-for': value })),
      { 'tailscale-funnel-request': 'false', 'x-forwarded-for': '127.0.0.1' },
    ]) {
      const context = requestContext(request(peer, headers), options);
      assert.equal(context.ingressRole, 'public', JSON.stringify({ peer, headers }));
      assert.equal(context.publicRequest, true);
      assert.equal(context.masterAllowed, false);
    }
  }
});

test('public proxy metadata is accepted only from the exact canonical loopback peer', () => {
  const headers = { host: '127.0.0.1:8789', 'x-forwarded-for': '2001:db8::7',
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'picker.example' };
  for (const peer of ['127.0.0.1', '::1', `::ffff:${'127.0.0.1'}`]) {
    const context = requestContext(request(peer, headers), options);
    assert.equal(context.trustedProxy, true, peer);
    assert.equal(context.address, '2001:db8::7');
    assert.equal(context.rateKey, '2001:db8::7');
    assert.equal(context.secure, true);
    assert.equal(context.origin, options.publicOrigin);
    assert.equal(context.masterAllowed, false);
  }
  for (const peer of ['127.0.0.2', '127.255.255.255', '100.64.0.0', `::ffff:${options.host}`, '203.0.113.9']) {
    const context = requestContext(request(peer, { ...headers, 'x-forwarded-host': 'spoof.example', 'tailscale-funnel-request': 'true' }), options);
    assert.equal(context.trustedProxy, false, peer);
    assert.equal(context.address, peer.startsWith('::ffff:') ? '100.64.0.0' : peer);
    assert.equal(context.secure, false);
    assert.equal(context.origin, 'http://127.0.0.1:8789');
    assert.equal(context.masterAllowed, false);
  }
});

test('missing or unusable public proxy client metadata shares an unknown-peer rate bucket', () => {
  for (const headers of [{}, { 'x-forwarded-proto': 'https' },
    ...['', 'invalid', '203.0.113.7, 203.0.113.8'].map(value => ({ 'x-forwarded-for': value }))]) {
    const context = requestContext(request('127.0.0.1', headers), options);
    assert.equal(context.address, null);
    assert.equal(context.rateKey, 'unknown:127.0.0.1');
  }
  const first = requestContext(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), options);
  const second = requestContext(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.8' }), options);
  assert.notEqual(first.rateKey, second.rateKey);
});

test('public Host allowlist permits the configured authority and literal loopback plugin hosts', () => {
  for (const host of ['picker.example', '127.0.0.1:8789', '127.0.0.2:8789', '[::1]:8789', `[${Array(7).fill(0).join(':')}:1]`]) {
    const context = requestContext(request('127.0.0.1', { host }), options);
    assert.equal(context.masterAllowed, false, host);
  }
  for (const host of [undefined, '', 'foreign.example', 'picker.example:444', 'localhost:8789', '127.1',
    '2130706433', '[127.0.0.1]', 'picker.example/evil', 'user@picker.example', 'picker.example,evil.example',
    ' picker.example', '127.0.0.1\n', '127.0.0.1:65536', ['picker.example', 'evil.example']]) {
    assert.throws(() => requestContext(request('127.0.0.1', { host }), options), { status: 403 }, String(host));
  }
  // A trusted forwarded hostname cannot excuse an unexpected actual Host.
  assert.throws(() => requestContext(request('127.0.0.1', { host: 'evil.example', 'x-forwarded-host': 'picker.example' }), options), { status: 403 });
  for (const host of ['evil.example', 'picker.example,evil.example', 'picker.example/path', '']) {
    assert.throws(() => requestContext(request('127.0.0.1', { 'x-forwarded-host': host }), options), { status: 403 });
  }
  assert.doesNotThrow(() => requestContext(request('127.0.0.1', { host: '127.0.0.1:8789' }), { ingressRole: 'public' }));
  assert.throws(() => requestContext(request(), { ingressRole: 'public' }), { status: 403 });
  assert.doesNotThrow(() => requestContext(request('127.0.0.1', { host: 'picker.example:8443' }), { ...options, publicOrigin: 'https://picker.example:8443' }));
  assert.equal(requestContext(request('127.0.0.1', { host: 'PICKER.EXAMPLE', 'x-forwarded-proto': 'https' }), options).origin, options.publicOrigin);
});

test('public browser mutations still require the configured HTTPS origin even with private-valued XFF', () => {
  const headers = { host: '127.0.0.1:8789', 'x-forwarded-for': '127.0.0.1',
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'picker.example', origin: options.publicOrigin };
  const good = request('127.0.0.1', headers);
  assert.doesNotThrow(() => checkRequestOrigin(good, requestContext(good, options)));
  for (const extra of [{ origin: undefined }, { origin: 'http://127.0.0.1:8789' },
    { 'x-forwarded-proto': 'http' }, { 'sec-fetch-site': 'cross-site' }]) {
    const bad = request('127.0.0.1', { ...headers, ...extra });
    assert.throws(() => checkRequestOrigin(bad, requestContext(bad, options)), { status: 403 });
  }
});
