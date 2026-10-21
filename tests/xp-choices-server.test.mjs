import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('XP API reads personal imports, validates trusted choices, checks owners/revisions and persists undo', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-lamp-choices-'));
  const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'],
    challenges: { Quest: { 'Test quest': { Chunks: ['100'], XpReward: { 'Mining|Fishing': 250 } } } } };
  const initial = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initial.members[0].sourceMapId = 'old'; initial.legacy = { maps: { old: { chunkinfo: { assignedXpRewards: { Quest: { 'Test quest': { Mining: 250 } } } } } } };
  let app, origin;
  const start = async state => {
    app = await createServer({ dataDir: directory, definitions, taskMap: {}, initialState: state, port: 0, predictionPrewarm: false });
    await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  };
  await start(initial);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = (route, body, cookie) => fetch(`${origin}${route}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${app.store.getAccessToken()}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const invite = async input => {
    const response = await api('/api/invites', input); assert.equal(response.status, 201);
    const joined = await fetch(`${origin}${new URL((await response.json()).link).pathname}`, { redirect: 'manual' });
    return joined.headers.get('set-cookie').split(';')[0];
  };
  const player = await invite({ label: 'Lamp player', memberId: 'actor1' }), viewer = await invite({ label: 'Lamp viewer', viewer: true });
  const read = await api('/api/xp-choices?memberId=actor1', undefined, viewer); assert.equal(read.status, 200);
  const view = await read.json(), row = view.rows.find(row => row.label === 'Test quest');
  assert.deepEqual(row.choices, ['Mining']); assert.equal(row.source, 'imported');
  assert.equal((await api('/api/xp-choices?memberId=unknown', undefined, viewer)).status, 400);
  for (const asset of ['lamp-choices.mjs', 'lamp-choices.css', 'core/xp-choices.mjs']) assert.equal((await api(`/${asset}`, undefined, viewer)).status, 200);
  const command = (memberId = 'actor1', choices = ['Fishing']) => ({ type: 'set-xp-choices', memberId, taskId: row.id, choices });
  const send = (value, cookie = player, expectedRevision = app.store.getState().revision) => api('/api/command', { command: value, expectedRevision }, cookie);
  assert.equal((await send(command('reed'))).status, 403);
  assert.equal((await send(command(), viewer)).status, 403);
  assert.equal((await send(command('actor1', ['Attack']))).status, 400);
  const before = app.store.getState();
  assert.equal((await send(command())).status, 200);
  assert.equal((await send(command(), player, before.revision)).status, 409);
  let state = app.store.getState(); assert.deepEqual(state.members[0].xpChoices[row.id], ['Fishing']);
  assert.deepEqual(state.legacy, before.legacy); assert.equal(state.history.at(-1).type, 'set-xp-choices');
  assert.deepEqual((await (await api('/api/xp-choices?memberId=actor1', undefined, viewer)).json()).rows.find(source => source.id === row.id).choices, ['Fishing']);
  assert.equal((await send(command('reed'), null)).status, 200);
  const undoView = await (await api('/api/coordination', undefined, player)).json();
  assert.equal(undoView.latestUndo.canUndo, false); assert.match(undoView.latestUndo.reason, /signed-in player/);
  assert.equal((await send({ type: 'undo' })).status, 403, 'player cannot undo partner XP choices');
  assert.equal((await send({ type: 'undo' }, null)).status, 200);
  assert.equal((await send({ type: 'undo', undoRevision: state.revision })).status, 200);
  const restored = await (await api('/api/xp-choices?memberId=actor1', undefined, viewer)).json();
  assert.deepEqual(restored.rows.find(source => source.id === row.id).choices, ['Mining']);
  assert.equal((await send(command('actor1', [null]))).status, 200);
  await app.close(); await start();
  state = app.store.getState(); assert.deepEqual(state.members[0].xpChoices[row.id], [null]);
});
