import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../app/server.mjs';

test('gallery page, preview and fixture assets use the picker admin cookie exclusively', async t => {
  const base = path.resolve('.local/gallery-server-tests'); await mkdir(base, { recursive: true });
  const dataDir = await mkdtemp(path.join(base, 'run-'));
  const server = await createServer({ dataDir, port: 0, host: '127.0.0.1', predictionPrewarm: false,
    definitions: { chunks: { 12341: {} }, challenges: {}, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] }, taskMap: {} });
  t.after(async () => { await server.close(); assert.equal(path.dirname(dataDir), base); await rm(dataDir, { recursive: true, force: true }); });
  await server.listen(); const origin = new URL(server.inviteUrl).origin;
  const join = async link => (await fetch(link, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const cookie = await join(server.inviteUrl);
  const request = (route, credentials = cookie, body) => fetch(origin + route, { headers: { ...(credentials ? { Cookie: credentials } : {}), ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const players = [];
  for (const options of [{ label: 'Player' }, { label: 'Viewer', viewer: true }]) {
    const response = await request('/api/invites', cookie, options); assert.equal(response.status, 201);
    const value = await response.json(); players.push(await join(value.link));
  }
  const before = await readFile(path.join(dataDir, 'state.json'));
  for (const route of ['/gallery', '/gallery/preview?entry=settings-map', '/gallery/preview?entry=usage-counts', '/gallery-fixtures.mjs', '/gallery-fixture-data.json', '/gallery-safety.mjs', '/gallery-capture.mjs', '/gallery-usage.mjs', '/gallery-usage-fixture.mjs']) {
    const admin = await request(route); assert.equal(admin.status, 200, route);
    assert.match(admin.headers.get('cache-control'), route.startsWith('/gallery-') ? /private/ : /no-store/);
    assert.match(admin.headers.get('content-security-policy'), /script-src 'self'/);
    for (const other of [...players, null]) assert.equal((await request(route, other)).status, 404, route);
  }
  const asset = await request('/gallery-fixtures.mjs');
  assert.equal((await fetch(`${origin}/gallery-fixtures.mjs`, { headers: { Cookie: players[0], 'If-None-Match': asset.headers.get('etag') } })).status, 404);
  assert.equal((await request('/gallery', cookie, {})).status, 404);
  // The gallery frames its preview, so only that page may be framed, and only by the picker itself.
  const framed = await request('/gallery/preview?entry=main');
  assert.equal(framed.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(framed.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  for (const route of ['/', '/gallery']) {
    const page = await request(route);
    assert.equal(page.headers.get('x-frame-options'), 'DENY', route);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/, route);
  }
  const preview = await (await request('/gallery/preview')).text();
  assert(!preview.includes('src="/main.mjs"')); assert(preview.includes('src="/gallery-preview.mjs"'));
  assert.equal((await request('/', players[1])).status, 200);
  const attempted = await fetch(`${origin}/api/command`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, Referer: `${origin}/gallery/preview?entry=main`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, command: { type: 'roll', memberId: 'player1', count: 1 } }) });
  assert.equal(attempted.status, 404); assert.equal(await attempted.text(), 'Not saved: gallery');
  for (const method of ['GET', 'POST']) {
    const usage = await fetch(`${origin}/api/usage`, { method, headers: { Cookie: cookie, Origin: origin, Referer: `${origin}/gallery/preview?entry=usage-counts`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ counts: [] }) } : {}) });
    assert.equal(usage.status, 404); assert.equal(await usage.text(), 'Not saved: gallery');
  }
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), before);
});
