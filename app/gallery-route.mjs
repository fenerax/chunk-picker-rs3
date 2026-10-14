import { selectedDataset } from './dataset-runtime.mjs';
import { readFile } from 'node:fs/promises';
import { createRepresentation, sendRepresentation, PRIVATE_NO_STORE, PRIVATE_REVALIDATE } from './http-response.mjs';

const files = new Set(['gallery.mjs', 'gallery.css', 'gallery-catalogue.mjs', 'gallery-preview.mjs', 'gallery-capture.mjs', 'gallery-fixtures.mjs', 'gallery-fixture-data.json', 'gallery-safety.mjs', 'gallery-usage.mjs', 'gallery-usage-fixture.mjs']);
export function isGalleryRoute(route) {
  return route === '/gallery' || route.startsWith('/gallery/') || route.startsWith('/gallery-') || route === '/gallery.mjs' || route === '/gallery.css';
}
// Reuse the shipped shell so a toolbar or panel markup change appears here too.
export function galleryPreviewHTML(shell) {
  return shell.replace('<script type="module" src="/main.mjs"></script>',
    '<link rel="stylesheet" href="/gallery.css"><script type="module" src="/gallery-preview.mjs"></script>');
}
export async function serveGallery(request, response, { route, identity, dataset = selectedDataset }) {
  let fromGallery = false;
  try { fromGallery = /^\/gallery(?:\/|$)/.test(new URL(request.headers.referer).pathname); } catch {}
  // Defense in depth if a future renderer bypasses the browser fixture adapter.
  if (fromGallery && route.startsWith('/api/')) {
    response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': PRIVATE_NO_STORE }); response.end('Not saved: gallery'); return true;
  }
  if (!isGalleryRoute(route)) return false;
  if (dataset.capabilities?.features?.gallery === false || !identity?.admin || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': PRIVATE_NO_STORE }); response.end('Not found.'); return true;
  }
  let bytes, type, asset = false;
  if (route === '/gallery') { bytes = await readFile(new URL('./web/gallery.html', import.meta.url)); type = 'text/html; charset=utf-8'; }
  else if (route === '/gallery/preview') {
    bytes = Buffer.from(galleryPreviewHTML(await readFile(new URL('./web/index.html', import.meta.url), 'utf8'))); type = 'text/html; charset=utf-8';
    // The gallery shows this page in its own frame; every other page stays unframeable.
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Content-Security-Policy', String(response.getHeader('Content-Security-Policy')).replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  }
  else if (route === '/gallery-fixture-data.json') {
    const digest = new URL(request.url, 'http://localhost').searchParams.get('digest');
    if (digest && digest !== dataset.digest) { response.writeHead(409); response.end('Reload the gallery.'); return true; }
    bytes = dataset.bytes('app/web/gallery-fixture-data.json'); type = 'application/json; charset=utf-8'; asset = true;
  }
  else if (files.has(route.slice(1))) { asset = true; bytes = await readFile(new URL(`./web/${route.slice(1)}`, import.meta.url)); type = route.endsWith('.css') ? 'text/css' : route.endsWith('.json') ? 'application/json' : 'text/javascript'; }
  else { response.writeHead(404); response.end('Not found.'); return true; }
  await sendRepresentation(request, response, createRepresentation(bytes, { type, cacheControl: asset ? PRIVATE_REVALIDATE : PRIVATE_NO_STORE }), { conditional: asset });
  return true;
}
