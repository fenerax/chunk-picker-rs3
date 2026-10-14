import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Node's test runner isolates this file. Select before any application import.
process.env.RS3_DATASET = 'open-f2p';
const { createServer } = await import('../app/server.mjs');
const { selectedDataset } = await import('../app/dataset-runtime.mjs');

test('public F2P game persists commands, protects viewer access and serves its module graph', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'public-candidate-server-'));
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  app = await createServer({ dataDir: path.join(directory, 'game'), packsDir: path.join(directory, 'packs'),
    packSelection: path.join(directory, 'packs', 'selection.json'), port: 0, host: '127.0.0.1',
    publicOrigin: undefined, loopbackPort: undefined, predictionPrewarm: false,
    idleMemoryOptions: { delayMs: 60000 }, shutdownDeadlineMs: 2000,
  });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  let cookie;
  async function request(route, { body, auth = cookie, expect = 200 } = {}) {
    const url = new URL(route, origin);
    assert.equal(url.origin, origin);
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      signal: AbortSignal.timeout(30000), headers: { ...(auth ? { Cookie: auth } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Do not include invitation paths, response bodies or cookies in failures.
    assert.equal(response.status, expect, 'Unexpected HTTP status');
    return response;
  }
  const json = async (route, options) => (await request(route, options)).json();
  const joined = await request('/join/' + app.store.getAccessToken(), { auth: null, expect: 303 });
  cookie = joined.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const session = await json('/api/session');
  assert.equal(session.admin, true);
  assert.equal(session.label, 'Administrator');
  assert.equal(selectedDataset.datasetId ?? selectedDataset.id, 'open-f2p');
  let state = (await json('/api/state?view=play-v1')).state;
  assert.deepEqual(state.members.map(({ id, name }) => ({ id, name })), selectedDataset.gameDefaults.members.map(({ id, name }) => ({ id, name })));
  assert.ok(state.members.every(member => member.sourceMapId == null));
  const memberId = state.members[0].id;
  const definitions = await json('/api/definitions');
  const cells = Object.keys(definitions.chunks);
  const startingCell = String(selectedDataset.gameDefaults.startingCell);
  const neighbors = Object.values(definitions.sections?.[startingCell] ?? {}).flat().map(String);
  const neighbor = neighbors.find(id => cells.includes(id) && id !== startingCell
    && Object.values(definitions.sections?.[id] ?? {}).flat().map(String).includes(startingCell));
  assert.ok(cells.includes(startingCell) && neighbor, 'Public dataset needs a reciprocal starting neighbor');
  async function command(command) {
    const response = await json('/api/command?view=play-v1', { body: { expectedRevision: state.revision, command } });
    state = response.state;
    return response;
  }
  await command({ type: 'set-chunk', memberId, chunkId: startingCell, status: 'unlocked' });
  await command({ type: 'set-chunk', memberId, chunkId: neighbor, status: 'selected' });
  const beforeRoll = new Set(state.members[0].unlocked);
  await command({ type: 'roll', memberId, count: 1 });
  assert.ok(state.members[0].unlocked.some(id => !beforeRoll.has(id)));
  const tasks = await json(`/api/tasks?memberId=${encodeURIComponent(memberId)}`);
  const task = tasks.tasks.find(row => row.id.startsWith(`${selectedDataset.identityNamespace}:activity:`)
    && row.status === 'available' && !row.completed);
  assert.ok(task, 'Owned public cells generate an available activity');
  await command({ type: 'complete-task', memberId, taskId: task.id, completed: true });
  state = (await json('/api/state?view=play-v1')).state;
  assert.ok(state.members[0].completedTasks.includes(task.id));
  await command({ type: 'undo' });
  assert.ok(!state.members[0].completedTasks.includes(task.id));
  await command({ type: 'complete-task', memberId, taskId: task.id, completed: true });
  const note = 'Public game verification note';
  await command({ type: 'set-note', memberId, chunkId: startingCell, note });
  const shell = await request('/');
  const csp = shell.headers.get('content-security-policy');
  assert.match(csp, /(?:^|;)\s*script-src 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(shell.headers.get('x-frame-options'), 'DENY');
  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(await shell.text(), /id=["']original-sync-open["']/);
  for (const route of ['/original-sync.mjs', '/api/original-sync/preview', '/api/original-sync/status', '/api/migration', '/api/import', '/api/import/preview']) {
    await request(route, { expect: 404 });
  }
  state = (await json('/api/state?view=play-v1')).state;
  assert.equal(state.members[0].notes[startingCell], note);
  assert.ok(state.members[0].completedTasks.includes(task.id));
  await command({ type: 'set-note', memberId, chunkId: startingCell, note: 'Temporary note' });
  await command({ type: 'undo' });
  assert.equal(state.members[0].notes[startingCell], note);

  const invitation = await json('/api/invites', { body: { label: 'Observer', viewer: true }, expect: 201 });
  const viewerJoin = await request(new URL(invitation.link).pathname, { auth: null, expect: 303 });
  const viewerCookie = viewerJoin.headers.get('set-cookie')?.split(';')[0];
  assert.ok(viewerCookie);
  const viewer = await json('/api/session', { auth: viewerCookie });
  assert.equal(viewer.readOnly, true);
  assert.equal(viewer.capabilities.canWrite, false);
  await json('/api/state?view=play-v1', { auth: viewerCookie });
  const revision = state.revision;
  await request('/api/command?view=play-v1', { auth: viewerCookie, expect: 403,
    body: { expectedRevision: revision, command: { type: 'set-note', memberId, chunkId: startingCell, note: 'Forbidden edit' } } });
  state = (await json('/api/state?view=play-v1')).state;
  assert.equal(state.revision, revision);
  assert.equal(state.members[0].notes[startingCell], note);
  const art = await json('/api/art-status');
  assert.equal(art.placeholderPictures, true);
  assert.deepEqual(art.availableRoutes, []);
  const placeholder = await request('/placeholder-art/item.svg');
  assert.match(placeholder.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await placeholder.text(), /<svg\b/);

  // Fetch static and literal lazy imports. This does not execute browser UI.
  const queue = ['/', '/data/dataset-runtime.json'], seen = new Set();
  function enqueue(specifier, from) {
    if (/^(?:node:|data:|#)/.test(specifier)) return;
    const url = new URL(specifier, new URL(from, origin));
    assert.equal(url.origin, origin, 'Module graph must use same-origin resources');
    const route = url.pathname + url.search;
    if (!seen.has(route) && !queue.includes(route)) queue.push(route);
  }
  while (queue.length) {
    assert.ok(seen.size < 600, 'Module graph traversal must remain bounded');
    const route = queue.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    const source = await (await request(route)).text();
    if (route === '/' || /\.html$/.test(route)) {
      for (const match of source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)) enqueue(match[1], route);
    } else if (/\.mjs(?:\?|$)/.test(route)) {
      for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
        // These literal imports belong only to the runtime's Node branch.
        if (route === '/dataset-runtime.mjs' && ['./datasets.mjs', './dataset-inputs.mjs'].includes(match[1])) continue;
        enqueue(match[1], route);
      }
      for (const match of source.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) enqueue(match[1], route);
      for (const match of source.matchAll(/\bmodule\s*:\s*["']([^"']+\.mjs)["']/g)) enqueue(match[1], route);
    } else if (/\.css(?:\?|$)/.test(route)) {
      // Unused optional font faces have separate browser verification.
      const css = source.replace(/@font-face\s*\{[^}]*\}/g, '');
      for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) enqueue(match[1], route);
    }
  }
  assert.ok([...seen].some(route => /\.mjs$/.test(route)), 'The shell exposes its application modules');
});
