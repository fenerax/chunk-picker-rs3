import { performance } from 'node:perf_hooks';

export function category(route) {
  if (route.startsWith('/api/')) return 'api';
  if ((route === '/assets/world.png' || /\/assets\/map\/(?:terrain|.*\/\d+\/\d+\/)|\/map(?:\.webp|\.png|\.jpg)/.test(route)) && !route.endsWith('.json')) return 'mapTiles';
  if (route.endsWith('.json')) return 'dataJson';
  if (/\.(?:mjs|js|css|html)$/.test(route) || route === '/') return 'appCode';
  return 'otherAssets';
}
// Additive asset classes leave the historical category denominators unchanged.
export const ASSET_CLASSES = ['terrain', 'legacyWorld', 'mapSpritesPins', 'icons', 'interiors', 'other'];
export function assetClass(route) {
  if (/^\/assets\/map\/interiors[./-]|^\/api\/interior-maps$/.test(route)) return 'interiors';
  if (/^\/assets\/map\/icons(?:[./-])|^\/assets\/icons\//.test(route)) return 'icons';
  if (/^\/assets\/map\/(?:sprites[./-]|pins[./-])/.test(route)) return 'mapSpritesPins';
  if (route === '/assets/world.png') return 'legacyWorld';
  if (/^\/assets\/map\/(?:terrain[./-]|overview[./-])/.test(route) && /\.(?:png|webp|jpg)$/.test(route)) return 'terrain';
  return 'other';
}
export function networkCollector(browser) {
  const requests = new Map(), pendingStatuses = new Map(); let changed = performance.now(), startTimestamp;
  const wireStatus = (item, status) => {
    item.wireStatus = status; item.status = status;
    if (status === 304) { item.cached = true; item.revalidated = true; }
  };
  const onEvent = ({ method, params: p }) => {
    if (method === 'Network.responseReceivedExtraInfo') {
      // Chrome can expose the cached 200 response in responseReceived while
      // ExtraInfo carries the actual 304. Either event can arrive first.
      if (!Number.isInteger(p.statusCode)) return;
      const item = requests.get(p.requestId);
      if (item) { wireStatus(item, p.statusCode); if (!item.excluded) changed = performance.now(); }
      else pendingStatuses.set(p.requestId, p.statusCode);
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      const url = new URL(p.request.url);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const route = url.pathname;
      // Persist path only; neither cookies, request bodies nor invitation URLs are retained.
      if (route.startsWith('/join/')) return;
      startTimestamp ??= p.timestamp;
      const item = { route, category: category(route), assetClass: assetClass(route), type: p.type, start: p.timestamp, wallStart: p.wallTime, excluded: p.type === 'EventSource' || route === '/api/events', cached: false, revalidated: false };
      if (pendingStatuses.has(p.requestId)) { wireStatus(item, pendingStatuses.get(p.requestId)); pendingStatuses.delete(p.requestId); }
      requests.set(p.requestId, item);
      changed = performance.now();
    } else if (requests.has(p.requestId)) {
      const item = requests.get(p.requestId);
      if (method === 'Network.requestServedFromCache') item.cached = true;
      if (method === 'Network.responseReceived') {
        item.status = item.wireStatus ?? p.response.status; item.response = p.timestamp;
        item.revalidated ||= item.status === 304;
        item.cached ||= !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache || item.revalidated);
        item.encodedBodyBytes = Number(p.response.headers['content-length'] ?? p.response.headers['Content-Length']) || 0;
        const timing = p.response.timing;
        item.ttfbMs = timing && timing.receiveHeadersEnd >= 0 ? timing.receiveHeadersEnd : (p.timestamp - item.start) * 1000;
      }
      if (method === 'Network.loadingFinished') { item.end = p.timestamp; item.transferBytes = p.encodedDataLength; }
      if (method === 'Network.dataReceived') item.decodedBodyBytes = (item.decodedBodyBytes ?? 0) + p.dataLength;
      if (method === 'Network.loadingFailed') { item.end = p.timestamp; item.failed = !p.canceled; item.cancelled = !!p.canceled; }
      if (!item.excluded) changed = performance.now();
    }
  };
  browser.listeners.add(onEvent);
  return { requests, idle: () => [...requests.values()].every(item => item.excluded || item.end !== undefined) && performance.now() - changed >= 750,
    close: () => browser.listeners.delete(onEvent), start: () => startTimestamp };
}
