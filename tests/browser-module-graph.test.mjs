import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Select the independent public dataset before importing application modules.
process.env.RS3_DATASET = 'open-f2p';
const { createServer } = await import('../app/server.mjs');

test('real browser entry and optional full-state tools serve every module dependency', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-module-graph-'));
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  app = await createServer({ dataDir: path.join(directory, 'game'), packsDir: path.join(directory, 'packs'),
    packSelection: path.join(directory, 'packs', 'selection.json'), port: 0, host: '127.0.0.1',
    predictionPrewarm: false, idleMemoryOptions: { delayMs: 60000 }, shutdownDeadlineMs: 2000 });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const joined = await fetch(`${origin}/join/${app.store.getAccessToken()}`, { redirect: 'manual' });
  assert.equal(joined.status, 303);
  const cookie = joined.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const queue = ['/'], seen = new Set();
  const get = route => fetch(new URL(route, origin), { headers: { Cookie: cookie }, redirect: 'manual',
    signal: AbortSignal.timeout(30000) });
  function enqueue(specifier, from) {
    const url = new URL(specifier, new URL(from, origin));
    assert.equal(url.origin, origin, `Same-origin browser dependency from ${from}`);
    const route = url.pathname + url.search;
    if (!seen.has(route) && !queue.includes(route)) queue.push(route);
  }
  async function walk() {
    while (queue.length) {
      assert.ok(seen.size < 600, 'Bounded browser graph');
      const route = queue.shift();
      if (seen.has(route)) continue;
      seen.add(route);
      const response = await get(route);
      assert.equal(response.status, 200, route);
      const source = await response.text();
      if (route === '/') {
        for (const match of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) enqueue(match[1], route);
      } else if (/\.mjs(?:\?|$)/.test(route)) {
        assert.match(response.headers.get('content-type'), /javascript/, route);
        for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
          // These dynamic imports execute only in dataset-runtime's Node branch.
          if (route === '/dataset-runtime.mjs' && ['./datasets.mjs', './dataset-inputs.mjs', 'node:worker_threads'].includes(match[1])) continue;
          assert.ok(match[1].startsWith('.'), `Browser-safe import in ${route}: ${match[1]}`);
          enqueue(match[1], route);
        }
        for (const match of source.matchAll(/datasetJSON\(["'](app\/data\/[^"']+\.json)["']\)/g)) enqueue(match[1].slice(3), route);
      } else {
        assert.match(response.headers.get('content-type'), /application\/json/, route);
        assert.doesNotThrow(() => JSON.parse(source), route);
      }
    }
  }
  await walk();
  assert.ok(seen.has('/main.mjs'), 'Use the script entry declared by the real shell');
  // Optional reference tools retain their own graph even when main does not
  // import it. The main-only public candidate check cannot exercise this seam.
  queue.push('/core/state.mjs', '/core/planning.mjs');
  await walk();
  for (const route of ['/core/rules.mjs', '/core/transport-access.mjs', '/core/teleport-returns.mjs', '/core/teleport-return-cache.mjs']) {
    assert.ok(seen.has(route), `Traversed ${route}`);
    assert.equal((await fetch(new URL(route, origin), { redirect: 'manual' })).status, 401, `Authenticated ${route}`);
  }
  for (const route of ['/tasks/engine.mjs', '/tasks/worker.mjs']) assert.equal((await get(route)).status, 404, route);
});
