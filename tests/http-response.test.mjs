import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createRepresentation, negotiateEncoding, sendRepresentation, createResponseCache } from '../app/http-response.mjs';

function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(bytes) { this.body = bytes; } };
}
test('quality negotiation respects explicit refusals, wildcard and identity preference', () => {
  assert.equal(negotiateEncoding('br, gzip'), 'br');
  assert.equal(negotiateEncoding('gzip;q=0.8, br;q=0.4, identity;q=0'), 'gzip');
  assert.equal(negotiateEncoding('gzip;q=0'), 'identity');
  assert.equal(negotiateEncoding('*;q=0.5, identity;q=0'), 'br');
  assert.equal(negotiateEncoding('gzip;q=0.5'), 'identity');
  assert.throws(() => negotiateEncoding('*;q=0'), { status: 406 });
});
test('representations coalesce encodings and give each encoding a strong validator', async () => {
  const bytes = Buffer.from(JSON.stringify({ payload: 'repeat '.repeat(4000) })), representation = createRepresentation(bytes);
  assert.equal(representation.encoded('gzip'), representation.encoded('gzip'));
  const validators = new Set();
  for (const encoding of ['identity', 'gzip', 'br']) {
    const accept = encoding === 'identity' ? 'identity' : `${encoding}, identity;q=0`;
    const result = response();
    await sendRepresentation({ method: 'GET', headers: { 'accept-encoding': accept } }, result, representation);
    assert.equal(result.status, 200); assert.match(result.headers['Cache-Control'], /^private/);
    assert.equal(result.headers.Vary, 'Accept-Encoding'); validators.add(result.headers.ETag);
    const decoded = encoding === 'gzip' ? gunzipSync(result.body) : encoding === 'br' ? brotliDecompressSync(result.body) : result.body;
    assert.deepEqual(decoded, bytes);
    const conditional = response();
    await sendRepresentation({ method: 'GET', headers: { 'accept-encoding': accept, 'if-none-match': `"other", W/${result.headers.ETag}` } }, conditional, representation);
    assert.equal(conditional.status, 304); assert.equal(conditional.body, undefined);
    assert.match(conditional.headers['Cache-Control'], /^private/); assert.equal(conditional.headers.Vary, 'Accept-Encoding');
  }
  assert.equal(validators.size, 3);
  const head = response(); await sendRepresentation({ method: 'HEAD', headers: {} }, head, representation);
  assert.equal(head.headers['Content-Length'], bytes.length); assert.equal(head.body, undefined);
});
test('response cache evicts old entries and declines oversize payloads', () => {
  const cache = createResponseCache({ maxEntries: 2, maxBytes: 8 });
  const first = createRepresentation('one'), second = createRepresentation('two'), third = createRepresentation('three');
  cache.set('first', first); cache.set('second', second); cache.get('first'); cache.set('third', third);
  assert.equal(cache.get('second'), undefined); assert.equal(cache.get('first'), first);
  assert.equal(cache.bytes, 8);
  const large = createRepresentation('oversized'); assert.equal(cache.set('large', large), large); assert.equal(cache.get('large'), undefined);
  cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
});
test('completed compressed variants count toward cache eviction', async () => {
  const cache = createResponseCache({ maxBytes: 60 }), representation = createRepresentation(Buffer.alloc(50));
  cache.set('payload', representation); assert.equal(cache.bytes, 50);
  await representation.encoded('gzip');
  assert.equal(cache.get('payload'), undefined); assert.equal(cache.bytes, 0);
});

test('collected gzip preserves exact bytes and validators for Unicode, pools and incompressible input', async () => {
  const { createGzipRepresentation } = await import('../app/http-response.mjs');
  const { randomBytes } = await import('node:crypto');
  const fixtures = [
    ['{"text":"', 'a'.repeat(32767) + '🦊', ' Île \\ud800",', '"pools":', JSON.stringify({ a: { eligible: [] }, b: { eligible: ['first', 'second'], count: 2 } }), '}'],
    ['"', '\ud83e', '', '\udd8a', '\ud800', '"'],
    [JSON.stringify({ random: randomBytes(1024 * 1024).toString('base64'), pools: {} })],
  ];
  for (const parts of fixtures) {
    const control = createRepresentation(Buffer.from(parts.join('')));
    const candidate = await createGzipRepresentation(parts);
    const expected = await control.encoded('gzip'), actual = await candidate.encoded('gzip');
    assert.deepEqual(actual, expected);
    assert.deepEqual(gunzipSync(actual.bytes), control.bytes);
    assert.equal(candidate.retainedBytes, actual.bytes.length);
    assert.equal(candidate.bytes, undefined);
    assert.throws(() => candidate.encoded('identity'), TypeError);
    for (const method of ['GET', 'HEAD']) {
      const result = response();
      await sendRepresentation({ method, headers: { 'accept-encoding': 'gzip' } }, result, candidate);
      assert.equal(result.status, 200); assert.equal(result.headers['Content-Length'], actual.bytes.length);
      assert.equal(result.headers['Content-Encoding'], 'gzip'); assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
      assert.equal(result.body, method === 'HEAD' ? undefined : actual.bytes);
      for (const match of ['*', `"other", W/${expected.etag}`, expected.etag]) {
        const conditional = response();
        await sendRepresentation({ method, headers: { 'accept-encoding': 'gzip', 'if-none-match': match } }, conditional, candidate);
        assert.equal(conditional.status, 304); assert.equal(conditional.headers.ETag, expected.etag);
      }
    }
  }
});

test('gzip aborts before and during collection, caps output, and releases admission after failure', async () => {
  const { createGzipRepresentation } = await import('../app/http-response.mjs');
  const before = new AbortController(); before.abort();
  await assert.rejects(createGzipRepresentation(['never encoded'], { signal: before.signal }), { name: 'AbortError' });
  const during = new AbortController();
  const pending = createGzipRepresentation(['a'.repeat(8 * 1024 * 1024)], { signal: during.signal });
  await assert.rejects(createGzipRepresentation(['other picker']), { status: 503 });
  setImmediate(() => during.abort());
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(createGzipRepresentation(['a'.repeat(1024 * 1024)], { maxBytes: 32 }), { status: 503 });
  await assert.rejects(createGzipRepresentation([null]), TypeError);
  assert.equal(gunzipSync((await (await createGzipRepresentation(['retry'])).encoded('gzip')).bytes).toString(), 'retry');
});

test('state build waiters coalesce, bound admission and cancel only when all have left', async () => {
  const { createStateResponseBuilds } = await import('../app/http-response.mjs');
  const builds = createStateResponseBuilds(), ready = Promise.withResolvers(), done = Promise.withResolvers();
  const a = new AbortController(), b = new AbortController();
  let runs = 0, sharedSignal;
  const work = async signal => { runs++; sharedSignal = signal; ready.resolve(); return done.promise; };
  const first = builds.run('revision', work, a.signal), second = builds.run('revision', work, b.signal);
  await ready.promise;
  await assert.rejects(builds.run('next revision', work), { status: 503 });
  a.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(sharedSignal.aborted, false);
  done.resolve('result'); assert.equal(await second, 'result'); assert.equal(runs, 1);
  const gate = Promise.withResolvers(), signals = [], callers = [];
  for (let i = 0; i < 32; i++) {
    const caller = new AbortController(); signals.push(caller);
    const pending = builds.run('bounded', signal => { sharedSignal = signal; return gate.promise; }, caller.signal);
    pending.catch(() => {}); callers.push(pending);
  }
  await assert.rejects(builds.run('bounded', work), { status: 503 });
  for (const signal of signals) signal.abort();
  await Promise.allSettled(callers); assert.equal(sharedSignal.aborted, true);
  gate.resolve(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(builds.run('failure', () => { throw new Error('injected'); }), /injected/);
  assert.equal(await builds.run('failure', () => 'retry'), 'retry');
  builds.close(); await assert.rejects(builds.run('closed', work), { status: 503 });
});

test('cache eviction and clear count only completed gzip bytes and detach callbacks', async () => {
  const { createGzipRepresentation } = await import('../app/http-response.mjs');
  const first = await createGzipRepresentation(['a'.repeat(1024 * 1024)]);
  const second = await createGzipRepresentation(['b'.repeat(1024 * 1024)]);
  const cache = createResponseCache({ maxBytes: first.retainedBytes });
  cache.set('first', first); assert.equal(cache.bytes, first.retainedBytes);
  cache.set('second', second); assert.equal(cache.get('first'), undefined); assert.equal(first.onSizeChange, undefined);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(second.onSizeChange, undefined);
});

test('disconnect after collection prevents sending a completed representation', async () => {
  const { createGzipRepresentation } = await import('../app/http-response.mjs');
  const representation = await createGzipRepresentation(['collected']);
  const result = { destroyed: true, writeHead() { assert.fail('closed socket'); }, end() { assert.fail('closed socket'); } };
  await sendRepresentation({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, result, representation);
});

test('in-flight output budget counts shared senders once and survives cache eviction', async () => {
  const { createGzipRepresentation, createResponseLeases } = await import('../app/http-response.mjs');
  const a = await createGzipRepresentation(['a'.repeat(1000)]), b = await createGzipRepresentation(['b'.repeat(1000)]);
  const leases = createResponseLeases({ maxBytes: a.retainedBytes }), cache = createResponseCache({ maxEntries: 1 });
  cache.set('a', a);
  const releaseA = leases.retain(a), releaseSharedA = leases.retain(a);
  cache.set('b', b); assert.equal(cache.get('a'), undefined);
  assert.throws(() => leases.retain(b), { status: 503 });
  releaseA(); releaseA();
  assert.throws(() => leases.retain(b), { status: 503 });
  releaseSharedA();
  const releaseB = leases.retain(b); releaseB();
  leases.retain(a)();
});
