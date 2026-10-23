import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createHash } from 'node:crypto';
import { taskArtworkProvenance, taskItemIcon } from '../app/web/task-artwork.mjs';

test('authenticated task UI serves its modules, dependencies and theme styles', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const temporary = path.join(root, '.local/test-temp'); await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, 'task-ui-server-'));
  const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] };
  let server;
  t.after(async () => { await server?.close(); await rm(directory, { recursive: true, force: true }); });
  server = await createServer({ dataDir: path.join(directory, 'duo'), definitions, taskMap: {}, port: 0, predictionPrewarm: false });
  await server.listen(); const origin = `http://127.0.0.1:${server.address().port}`;
  assert.ok(![8788, 8789, 8790, 8791].includes(server.address().port));
  const joined = await fetch(server.inviteUrl, { redirect: 'manual' }); assert.equal(joined.status, 303);
  const headers = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  for (const route of ['/task-hover.mjs', '/task-why.mjs', '/tasks/task-provenance.mjs', '/task-methods.mjs', '/task-equipment.mjs', '/task-artwork.mjs', '/core/task-alternatives.mjs', '/tasks/gameplay-compat.mjs', '/duo-tasks.mjs', '/duo-task-view.mjs', '/duo-task-lists.mjs', '/duo-backlog-view.mjs', '/duo-tasks.css', '/task-filters.mjs', '/task-filters-model.mjs', '/task-filters.css', '/core/progress-index.mjs', '/tasks/fact-projection.mjs', '/task-ui.css', '/bis-panel.css']) {
    const response = await fetch(`${origin}${route}`, { headers }); assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /javascript|css/, route);
    assert.ok((await response.text()).length > 20, `${route} supplies an authored module or stylesheet`);
  }
  const html = await (await fetch(origin, { headers })).text();
  assert.match(html, /href="\/task-ui\.css"/); assert.match(html, /href="\/bis-panel\.css"/);
  assert.equal((await fetch(`${origin}/task-hover.mjs`)).status, 401);
});


test('task artwork uses installed icons first and exact versioned fallback identities only', () => {
  assert.equal(taskItemIcon('Team-1 cape', () => '/installed.png'), '/installed.png');
  assert.match(taskItemIcon('Skull lantern (tier 10)', () => null), /^\/task-item-artwork\.2026-10-09\.v1\/[a-f0-9]{64}\.png$/);
  assert.equal(taskItemIcon('Skull lantern (tier 20)', () => null), null);
});
