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
