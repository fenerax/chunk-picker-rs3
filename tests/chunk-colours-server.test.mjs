import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, commandPermissions } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { SURFACE_GRID } from '../app/data/surface-grid.mjs';

const chunkId = String(SURFACE_GRID.startId);

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-chunk-colours-server-'));
  const definitions = { chunks: { [chunkId]: { Name: 'Wendlewick' } },
    walkableChunks: [chunkId], walkableChunksF2P: [chunkId] };
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { await rm(dataDir, { recursive: true, force: true }); }
  });
  const start = async initial => {
    app = await createServer({ dataDir, definitions, taskMap: {}, ...(initial ? { initialState: initial } : {}),
      port: 0, host: '127.0.0.1', predictionPrewarm: false,
      gameDataDir: path.join(dataDir, 'game'), mapAssetsDir: path.join(dataDir, 'assets') });
    await app.listen();
  };
  await start(initialState);
  const request = (route, body, credentials = { Authorization: `Bearer ${app.store.getAccessToken()}` }) => {
    const origin = `http://127.0.0.1:${app.address().port}`;
    return fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { ...credentials, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const state = async credentials => {
    const response = await request('/api/state', undefined, credentials);
    assert.equal(response.status, 200);
    return (await response.json()).state;
  };
  const command = (command, expectedRevision = app.store.getInfo().revision, credentials) =>
    request('/api/command', { expectedRevision, command }, credentials);
  const send = async (edit, credentials) => {
    const response = await command(edit, undefined, credentials);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).state;
  };
  const invite = async options => {
    const created = await request('/api/invites', { label: 'Synthetic colour test', ...options });
    assert.equal(created.status, 201);
    const joined = await request(new URL((await created.json()).link).pathname, undefined, {});
    assert.equal(joined.status, 303);
    const cookie = joined.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return { Cookie: cookie };
  };
  return { request, state, command, send, invite, restart: async () => { await app.close(); await start(); } };
}

const tint = { type: 'set-chunk-colour', memberId: 'actor1', chunkId, colour: 'red' };
const rename = { type: 'rename-chunk-colour', memberId: 'actor1', colour: 'red', name: 'Next' };
const member = (state, id = 'actor1') => state.members.find(row => row.id === id);

test('chunk colour writes follow player/admin permissions while viewers read saved tints and names', async t => {
  assert.equal(commandPermissions[tint.type], 'write');
  assert.equal(commandPermissions[rename.type], 'write');
  const f = await fixture(t);
  const viewer = await f.invite({ viewer: true });
  const player = await f.invite({ memberId: 'reed' });
  const admin = await f.invite({ admin: true });
  const original = await f.state();
  // Generic map annotations use the existing writer permission: either player
  // can annotate either map, just as they can edit notes and stickers.
  await f.send(tint, player);
  const saved = await f.send(rename, admin);
  assert.equal(member(saved).chunkColours[chunkId], 'red');
  assert.equal(member(saved).chunkColourNames.red, 'Next');
  assert.deepEqual(member(saved, 'reed'), member(original, 'reed'));
  const readable = await f.state(viewer);
  assert.deepEqual(readable.members, saved.members);
  for (const route of ['/chunk-colour-picker.mjs', '/map-chunk-colours.mjs', '/core/chunk-colours.mjs', '/chunk-colours.css']) {
    const asset = await f.request(route, undefined, viewer);
    assert.equal(asset.status, 200, route);
    assert.match(asset.headers.get('content-type'), route.endsWith('.css') ? /text\/css/ : /javascript/, route);
    assert.ok((await asset.text()).length > 0, route);
  }
  for (const edit of [{ ...tint, colour: 'blue' }, { ...rename, name: 'Blocked' }, { type: 'undo' }]) {
    const denied = await f.command(edit, saved.revision, viewer);
    assert.equal(denied.status, 403, edit.type);
  }
  assert.deepEqual((await f.state()).members, saved.members);
  assert.equal((await f.state()).revision, saved.revision);
});

test('chunk colours reject stale writes and Undo restores exact tint and name overrides', async t => {
  const f = await fixture(t), original = await f.state();
  const painted = await f.send(tint);
  for (const edit of [{ ...tint, colour: 'yellow' }, rename]) {
    const stale = await f.command(edit, original.revision);
    assert.equal(stale.status, 409, edit.type);
    assert.deepEqual((await stale.json()).state.members, painted.members);
  }
  assert.equal((await f.state()).revision, painted.revision);
  const named = await f.send(rename);
  assert.equal(member(named).chunkColourNames.red, 'Next');
  const unrenamed = await f.send({ type: 'undo' });
  assert.deepEqual(unrenamed.members, painted.members);
  const cleared = await f.send({ ...tint, colour: null });
  assert.equal(member(cleared).chunkColours[chunkId], null, 'clear is a durable explicit override');
  const restored = await f.send({ type: 'undo' });
  assert.deepEqual(restored.members, painted.members);
  const unpainted = await f.send({ type: 'undo' });
  assert.deepEqual(unpainted.members, original.members, 'Undo removes a newly introduced tint override');
});

test('all authored chunk colour IDs and explicit clears survive backup and restart', async t => {
  const f = await fixture(t);
  for (const colour of ['red', 'yellow', 'green', 'blue', null]) {
    const saved = await f.send({ ...tint, colour });
    assert.equal(member(saved).chunkColours[chunkId], colour);
  }
  await f.send({ ...tint, memberId: 'reed', colour: 'blue' });
  const saved = await f.send(rename);
  const backupResponse = await f.request('/api/backup');
  assert.equal(backupResponse.status, 200);
  assert.deepEqual((await backupResponse.json()).state.members, saved.members);
  await f.restart();
  assert.deepEqual((await f.state()).members, saved.members);
});
