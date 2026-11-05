// Component scheduling probe; no browser, artwork, network or save data.
// node scripts/perf/terrain-preview.mjs [--baseline origin/main] [--pairs 5]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const baseline = option('--baseline', 'origin/main');
const pairs = Number(option('--pairs', 5));
assert(Number.isSafeInteger(pairs) && pairs > 0 && pairs <= 20);
const source = execFileSync('git', ['show', `${baseline}:app/web/map-terrain.mjs`], { encoding: 'utf8' });
const hook = registerHooks({ load(url, context, next) {
  return url.endsWith('/map-terrain.mjs?baseline') ? { format: 'module', source, shortCircuit: true } : next(url, context);
} });
const before = await import('../../app/web/map-terrain.mjs?baseline');
hook.deregister();
const after = await import('../../app/web/map-terrain.mjs');
const tiles = Array.from({ length: 32 }, (_, x) => Array.from({ length: 28 }, (_, y) => ({
  x: 29 + x, y: 71 - y, path: `terrain/28/2/0_${29 + x}_${71 - y}.png`, status: 'downloaded',
}))).flat();
const manifest = { terrain: { mapId: 28, plane: 0, zoom: 2, tiles } };
async function run({ MapTerrain }) {
  const images = [], operations = [];
  let frames = 0, resolve, published = false;
  const settled = new Promise(done => { resolve = done; });
  const terrain = new MapTerrain(manifest, { concurrency: 6, cacheLimit: 256,
    fallbackImage: { naturalWidth: 6016, naturalHeight: 6400 },
    imageFactory() { const image = { naturalWidth: 256, naturalHeight: 256 }; images.push(image); return image; },
    canvasFactory(width, height) { return { width, height, getContext: () => ({ clearRect() {},
      drawImage(image, ...args) { operations.push([image.src ?? [image.width, image.height], ...args]); } }) }; },
    requestFrame(callback) { return setTimeout(() => { frames++; callback(); }, 16); },
    cancelFrame: clearTimeout,
    changed() { if (published && terrain.committedKeys.size === tiles.length) resolve(); },
  });
  try {
    terrain.setView({ left: 0, top: 0, right: 4096, bottom: 3584 }, 0.5);
    const started = performance.now(); published = true;
    for (let i = 0; i < images.length; i++) images[i].onload();
    await settled;
    const elapsedMs = performance.now() - started;
    const digest = createHash('sha256').update(JSON.stringify([operations, [...terrain.committedKeys]])).digest('hex');
    return { elapsedMs, frames, tiles: terrain.committedKeys.size, operations: operations.length, digest };
  } finally { terrain.dispose(); }
}
const rows = [];
for (let pair = 0; pair < pairs; pair++) {
  const row = { pair: pair + 1 };
  for (const variant of pair % 2 ? ['after', 'before'] : ['before', 'after']) row[variant] = await run(variant === 'before' ? before : after);
  assert.equal(row.before.digest, row.after.digest, 'Identical drawing operations and publication order');
  rows.push(row);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const output = JSON.stringify({ node: process.version, baseline,
  baselineSha: execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(), frameDelayMs: 16, pairs, rows,
  medianMs: Object.fromEntries(['before', 'after'].map(key => [key, median(rows.map(row => row[key].elapsedMs))])),
  limitation: 'Synthetic frame timers and recorded canvas calls; excludes image decode, real rasterization, browser paint and whole-app startup.' }, null, 2);
if (option('--out')) await writeFile(option('--out'), output + '\n');
console.log(output);
