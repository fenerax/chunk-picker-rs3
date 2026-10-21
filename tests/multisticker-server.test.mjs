import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('sticker API saves lists, rejects stale revisions, round-trips backups and survives restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-multisticker-server-'));
  const definitions = { chunks: { '7495': { Name: 'Wendlewick' } }, walkableChunks: ['7495'], walkableChunksF2P: ['7495'] };
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2' }]);
  initialState.legacy = { maps: { qxa: { chunks: { stickered: { '*fb*_7495': 'mining' },
    stickeredColors: { '*fb*_7495': '-_-23FF0000' }, stickeredNotes: { '*fb*_7495': 'Coal-_-20here' } } } } };
  let app = await createServer({ dataDir: directory, definitions, taskMap: {}, initialState, port: 0 });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.listen();
  let origin = `http://127.0.0.1:${app.address().port}`;
  const api = (route, body) => fetch(`${origin}${route}`, { method: body ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${app.store.getAccessToken()}`, ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let state = (await (await api('/api/state')).json()).state;
  const send = async command => {
    const response = await api('/api/command', { expectedRevision: state.revision, command });
    assert.equal(response.status, 200);
    const body = await response.json(); state = { ...state, ...body.state };
    return state;
  };
  const scope = { memberId: 'player1', chunkId: '7495' };
  const before = state.revision;
  await send({ type: 'add-sticker', ...scope, sticker: { type: 'star', color: '#f5c451', text: 'Quest route' } });
  const list = state.members[0].stickers['7495'];
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'mining'); assert.equal(list[0].text, 'Coal here');
  assert.equal(list[1].type, 'star');
  const stale = await api('/api/command', { expectedRevision: before, command: { type: 'clear-stickers', ...scope } });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).state.members[0].stickers['7495'], list);
  const id = list[1].id;
  await send({ type: 'update-sticker', ...scope, stickerId: id, sticker: { type: 'heart', color: '#e5484d', text: '<b>Meet Player 2</b>' } });
  assert.equal(state.members[0].stickers['7495'][1].id, id);
  const saved = structuredClone(state.members);
  const backup = await (await api('/api/backup')).json();
  assert.deepEqual(backup.state.members, saved);
  await send({ type: 'clear-stickers', ...scope });
  assert.deepEqual(state.members[0].stickers['7495'], []);
  const restored = await api('/api/restore', { expectedRevision: state.revision, backup });
  assert.equal(restored.status, 200);
  state = (await restored.json()).state;
  assert.deepEqual(state.members, saved);
  await app.close();
  app = await createServer({ dataDir: directory, definitions, taskMap: {}, port: 0 });
  await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  state = (await (await api('/api/state')).json()).state;
  assert.deepEqual(state.members, saved);
  await send({ type: 'remove-sticker', ...scope, stickerId: id });
  assert.equal(state.members[0].stickers['7495'].length, 1);
  await send({ type: 'undo' });
  assert.deepEqual(state.members, saved);
  await send({ type: 'set-sticker', ...scope, sticker: null });
  assert.deepEqual(state.members[0].stickers['7495'], []);
});
