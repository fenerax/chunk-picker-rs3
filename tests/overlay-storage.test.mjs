import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openOverlays } from '../app/overlays.mjs';

const root = fileURLToPath(new URL('../.local/overlay-storage-tests/', import.meta.url));

async function fixture(t) {
  await fs.promises.mkdir(root, { recursive: true });
  const dataDir = await fs.promises.mkdtemp(path.join(root, 'save-'));
  const overlays = await openOverlays({ dataDir, store: { subscribe: () => () => {} },
    authenticateAdmin: () => ({ admin: true }), checkRequestOrigin() {} });
  t.after(async () => {
    await overlays.close();
    assert.equal(path.dirname(dataDir), root.slice(0, -1));
    await fs.promises.rm(dataDir, { recursive: true });
  });
  async function request(route, body, onResponse) {
    let status, result;
    const request = { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      iterator: async function* () { yield Buffer.from(JSON.stringify(body)); } };
    const response = { writeHead(value) { status = value; }, end(bytes) { onResponse?.(); result = JSON.parse(bytes); } };
    await overlays.handle(request, response, { route, security: { origin: 'https://picker.example' } });
    return { status, ...result };
  }
  return { dataDir, file: path.join(dataDir, 'overlays.json'), request,
    create: onResponse => request('/api/overlays', { label: 'Synthetic overlay', widget: 'count', player: 'duo' }, onResponse) };
}

function publicationSpy(t, file, syncFailure) {
  const { open, rename } = fs.promises, events = [], warnings = [];
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    await rename(from, to);
    if (to === file) events.push('rename');
  });
  t.mock.method(fs.promises, 'open', async (target, flags, ...options) => {
    if (target === path.dirname(file) && flags === 'r') {
      events.push('directory-open');
      // Windows cannot open a real directory handle; exercise sync on every OS.
      return {
        async sync() { events.push('directory-sync'); if (syncFailure) throw syncFailure; },
        async close() { events.push('directory-close'); },
      };
    }
    const handle = await open(target, flags, ...options);
    if (typeof target === 'string' && target.startsWith(file + '.') && flags === 'wx') {
      events.push('temporary-open');
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
      t.mock.method(handle, 'sync', async () => { await sync(); events.push('temporary-sync'); });
      t.mock.method(handle, 'close', async () => { await close(); events.push('temporary-close'); });
    }
    return handle;
  });
  t.mock.method(console, 'warn', message => warnings.push(message));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { events, warnings };
}

for (const operation of ['create', 'revoke']) test(`overlay ${operation} syncs its parent directory after rename before acknowledgement`, async t => {
  const f = await fixture(t);
  const created = operation === 'revoke' ? await f.create() : undefined;
  const { events, warnings } = publicationSpy(t, f.file);
  const acknowledged = () => events.push('acknowledged');
  const result = operation === 'create' ? await f.create(acknowledged) : await f.request(`/api/overlays/${created.overlay.id}/revoke`, {}, acknowledged);
  assert.equal(result.status, operation === 'create' ? 201 : 200);
  assert.deepEqual(events, ['temporary-open', 'temporary-sync', 'temporary-close', 'rename',
    'directory-open', 'directory-sync', 'directory-close', 'acknowledged']);
  assert.deepEqual(warnings, []);
  const key = new URLSearchParams(new URL((created ?? result).link).hash.slice(1)).get('key');
  const tokenHash = createHash('sha256').update(key).digest('hex');
  assert.equal(await fs.promises.readFile(f.file, 'utf8'), `${JSON.stringify({ schemaVersion: 1, links: [{ ...result.overlay, tokenHash }] })}\n`);
});

test('overlays adopt published creation and revocation and warn when directory sync fails', async t => {
  const f = await fixture(t);
  const failure = Object.assign(new Error('Synthetic private data must never be logged'), { code: 'EIO' });
  const { events, warnings } = publicationSpy(t, f.file, failure);
  const created = await f.create();
  assert.equal(created.status, 201);
  assert.deepEqual((await f.request('/api/overlays')).links, [created.overlay]);
  const revoked = await f.request(`/api/overlays/${created.overlay.id}/revoke`, {});
  assert.equal(revoked.status, 200);
  assert.equal(revoked.overlay.revoked, true);
  assert.deepEqual((await f.request('/api/overlays')).links, [revoked.overlay]);
  const disk = JSON.parse(await fs.promises.readFile(f.file, 'utf8'));
  assert.equal(disk.links[0].revoked, true);
  assert.equal(events.filter(event => event === 'directory-sync').length, 2);
  assert.deepEqual(warnings, Array(2).fill('[storage] overlays: write published, but parent directory sync failed (EIO); crash durability is uncertain.'));
});
