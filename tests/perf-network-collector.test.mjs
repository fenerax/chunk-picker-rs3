import test from 'node:test';
import assert from 'node:assert/strict';
import { assetClass, category, networkCollector } from '../scripts/perf/network-collector.mjs';

test('asset classes separate terrain, map pins and icons without changing historical categories', () => {
  assert.equal(assetClass('/assets/world.png'), 'legacyWorld');
  for (const route of ['/assets/map/terrain/28/2/0_29_60.png', '/assets/map/terrain.cache-v1/28/2/0_29_60.png', '/assets/map/overview.v1/colour-0.25.webp']) assert.equal(assetClass(route), 'terrain');
  for (const route of ['/assets/map/sprites.cache-v1/12-16.png', '/assets/map/pins.normalized.json']) assert.equal(assetClass(route), 'mapSpritesPins');
  for (const route of ['/assets/map/icons/attack.png', '/assets/map/icons-skills.v1/manifest.json', '/assets/map/icons-items.v1/123.png']) assert.equal(assetClass(route), 'icons');
  for (const route of ['/assets/map/interiors.cache-v1/12/2/1.png', '/api/interior-maps']) assert.equal(assetClass(route), 'interiors');
  assert.equal(assetClass('/main.mjs'), 'other');
  assert.equal(assetClass('/assets/map/terrain.optimized-manifest.json'), 'other');
  assert.equal(assetClass('/assets/map/manifest.json'), 'other');
  assert.equal(category('/assets/map/pins.normalized.json'), 'dataJson');
  assert.equal(category('/assets/world.png'), 'mapTiles');
});

function fixture() {
  const browser = { listeners: new Set() }, collector = networkCollector(browser);
  const emit = (method, params) => { for (const listener of browser.listeners) listener({ method: `Network.${method}`, params }); };
  const request = requestId => emit('requestWillBeSent', { requestId, request: { url: 'http://127.0.0.1/assets/map/tile.png?private=never-retained' },
    type: 'Image', timestamp: 10, wallTime: 100 });
  const response = (requestId, options = {}) => emit('responseReceived', { requestId, timestamp: 10.05,
    response: { status: 200, headers: { 'content-length': '4096' }, timing: { receiveHeadersEnd: 25 }, ...options } });
  const extra = (requestId, statusCode) => emit('responseReceivedExtraInfo', { requestId, statusCode,
    headers: { 'content-length': '0', 'set-cookie': 'not-retained' } });
  const finish = requestId => {
    emit('dataReceived', { requestId, dataLength: 1024, encodedDataLength: 0 });
    emit('loadingFinished', { requestId, timestamp: 10.1, encodedDataLength: 257 });
  };
  return { browser, collector, request, response, extra, finish };
}

test('a cached 200 response and wire 304 count as revalidation regardless of CDP event ordering', () => {
  for (const ordering of ['before-request', 'before-response', 'after-response', 'after-finished']) {
    const f = fixture();
    if (ordering === 'before-request') f.extra('tile', 304);
    f.request('tile');
    if (ordering === 'before-response') f.extra('tile', 304);
    f.response('tile');
    if (ordering === 'after-response') f.extra('tile', 304);
    f.finish('tile');
    if (ordering === 'after-finished') f.extra('tile', 304);
    const item = f.collector.requests.get('tile');
    assert.equal(item.status, 304, ordering); assert.equal(item.cached, true, ordering); assert.equal(item.revalidated, true, ordering);
    assert.equal(item.transferBytes, 257); assert.equal(item.encodedBodyBytes, 4096); assert.equal(item.decodedBodyBytes, 1024);
    assert.equal(item.ttfbMs, 25); assert.equal(item.start, 10); assert.equal(item.response, 10.05); assert.equal(item.end, 10.1);
    assert.equal([...f.collector.requests.values()].filter(request => request.cached).length, 1);
    assert.equal(item.route, '/assets/map/tile.png');
    assert.ok(!JSON.stringify(item).includes('never-retained')); assert.ok(!JSON.stringify(item).includes('not-retained'));
    f.collector.close(); assert.equal(f.browser.listeners.size, 0);
  }
});

test('ordinary wire 200 stays a miss while direct cache hits retain their separate classification', () => {
  const f = fixture();
  f.request('miss'); f.response('miss'); f.extra('miss', 200); f.finish('miss');
  f.request('disk'); f.extra('disk', 200); f.response('disk', { fromDiskCache: true }); f.finish('disk');
  f.request('memory'); f.response('memory');
  for (const listener of f.browser.listeners) listener({ method: 'Network.requestServedFromCache', params: { requestId: 'memory' } });
  f.finish('memory');
  const miss = f.collector.requests.get('miss'); assert.equal(miss.cached, false); assert.equal(miss.revalidated, false);
  for (const id of ['disk', 'memory']) { const item = f.collector.requests.get(id); assert.equal(item.status, 200); assert.equal(item.cached, true); assert.equal(item.revalidated, false); }
  assert.equal([...f.collector.requests.values()].filter(request => request.cached).length, 2);
  f.collector.close();
});

test('a directly reported 304 remains a revalidation without ExtraInfo', () => {
  const f = fixture(); f.request('tile'); f.response('tile', { status: 304 }); f.finish('tile');
  const item = f.collector.requests.get('tile'); assert.equal(item.cached, true); assert.equal(item.revalidated, true); assert.equal(item.status, 304);
  assert.equal(item.transferBytes, 257); assert.equal(item.ttfbMs, 25); f.collector.close();
});
