export function createGallerySafety(report = () => {}) {
  const deny = () => { report('Not saved: gallery'); throw new Error('Not saved: gallery'); };
  return Object.freeze({ command: deny, save: deny, download: deny, applyRuneMetrics: deny, readJSON: deny });
}
// Only catalogue artwork and read-only game data may leave the fixture sandbox.
// No API/save requests, event streams, beacons or browser preference writes from this preview.
const READABLE = /^\/(?:assets\/|icons\.mjs$|data\/[\w.-]+\.json$|gallery-fixture-data\.json$)/;
export function installGallerySafety(report) {
  const safety = createGallerySafety(report), fetcher = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (url, options = {}) => {
    const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url, location.href);
    const method = (options.method ?? url?.method ?? 'GET').toUpperCase();
    if (target.origin !== location.origin || !['GET', 'HEAD'].includes(method) || !READABLE.test(target.pathname)) return safety.save();
    return fetcher(url, options);
  };
  for (const name of ['setItem', 'removeItem', 'clear']) Storage.prototype[name] = safety.save;
  globalThis.EventSource = class { constructor() { safety.save(); } };
  globalThis.WebSocket = class { constructor() { safety.save(); } };
  globalThis.XMLHttpRequest = class { constructor() { safety.save(); } };
  navigator.sendBeacon = safety.save;
  document.addEventListener('submit', event => { if (event.target.method !== 'dialog') event.preventDefault(); });
  document.addEventListener('click', event => { if (event.target.closest?.('a[download]')) { event.preventDefault(); try { safety.save(); } catch {} } });
  return safety;
}
