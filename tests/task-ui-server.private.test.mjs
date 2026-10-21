import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createHash } from 'node:crypto';
import { taskArtworkProvenance, taskItemIcon } from '../app/web/task-artwork.mjs';

test('authenticated task artwork serves exact installed versioned PNG bytes', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const temporary = path.join(root, '.local/test-temp'); await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, 'task-artwork-server-'));
  let server;
  t.after(async () => { await server?.close(); await rm(directory, { recursive: true, force: true }); });
  server = await createServer({ dataDir: path.join(directory, 'duo'),
    definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] },
    taskMap: {}, port: 0, predictionPrewarm: false });
  await server.listen(); const origin = `http://127.0.0.1:${server.address().port}`;
  const joined = await fetch(server.inviteUrl, { redirect: 'manual' }); assert.equal(joined.status, 303);
  const headers = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  for (const artwork of taskArtworkProvenance) {
    const route = taskItemIcon(artwork.names[0], () => null), response = await fetch(`${origin}${route}`, { headers });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), artwork.sha256);
  }
});

