import test from 'node:test';
import assert from 'node:assert/strict';
import { originalMapCode, readOriginalMapCode, createOriginalMapCodeUpload } from '../app/web/original-map-code.mjs';
import { PUBLIC_GAMEPLAY_FIELDS, PUBLIC_FIREBASE_URL } from '../app/web/original-public.mjs';

const map = { chunks: { unlocked: { '*fb*_12850': '12850' }, selected: { '12594': 1 } }, rules: { Quests: true }, chunkinfo: { checkedAllTasks: { Mining: { t_synthetic: true } } } };
const syntheticFetch = calls => async (url, options) => {
  calls.push({ url, options });
  const field = new URL(url).pathname.split('/').at(-1).replace('.json', '');
  return Response.json(map[field] ?? null);
};
test('map codes are normalized and reject URLs, paths and oversized input before fetching', async () => {
  assert.equal(originalMapCode(' Synthetic_303-A '), 'synthetic_303-a');
  for (const value of ['', '../maps', 'https://example.com', 'x'.repeat(65), null]) {
    await assert.rejects(readOriginalMapCode(value, { fetchImpl() { assert.fail('No reads for invalid codes'); } }), /Enter an original map code/);
  }
});
test('browser reads only the shared public gameplay whitelist with GET and no credentials', async () => {
  const calls = [], result = await readOriginalMapCode('Synthetic303', { fetchImpl: syntheticFetch(calls) });
  assert.deepEqual(result, map);
  assert.deepEqual(calls.map(call => call.url), PUBLIC_GAMEPLAY_FIELDS.map(field => `${PUBLIC_FIREBASE_URL}/maps/synthetic303/${field}.json`));
  for (const { options } of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  }
});
test('map-code upload reuses paste wire data under its independent feature format', async () => {
  const payload = await createOriginalMapCodeUpload('synthetic303', { includeTasks: true }, { memberId: 'destination' }, { fetchImpl: syntheticFetch([]) });
  const request = await payload.toBackupRequest();
  const stream = request.headers['Content-Encoding'] ? request.body.stream().pipeThrough(new DecompressionStream('gzip')) : request.body.stream();
  const wire = await new Response(stream).json();
  assert.equal(wire.file.format, 'rs3-original-map-code');
  assert.equal(wire.file.chunksText.join(''), '12850');
  assert.deepEqual(JSON.parse(wire.file.gameplayText.join('')), map);
  assert.equal(wire.file.includeTasks, true); assert.equal(wire.file.includeRules, false);
});
test('missing, denied, malformed, oversized and cancelled reads never produce an import', async () => {
  for (const response of [() => Response.json(null), () => new Response('', { status: 403 }), () => new Response('{'), () => new Response('x'.repeat(8 * 1024 * 1024 + 1))]) {
    await assert.rejects(readOriginalMapCode('synthetic303', { fetchImpl: async () => response() }));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readOriginalMapCode('synthetic303', { signal: controller.signal, fetchImpl() { assert.fail('No cancelled reads'); } }), { name: 'AbortError' });
});
