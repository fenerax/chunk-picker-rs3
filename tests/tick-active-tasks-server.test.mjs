import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.RS3_DATASET ??= 'open-f2p';
const { createServer } = await import('../app/server.mjs');
const { createGroupState } = await import('../app/core/state.mjs');

test('tick-active-tasks over HTTP: member guard, viewer refusal, stale revision, one History entry and guarded Undo', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-tick-active-'));
  const initial = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initial.tasks = ['one', 'two', 'three'].map(id => ({ id: `custom:${id}`, label: `Synthetic ${id}`, category: 'Custom' }));
  initial.members[0].taskStatus = { 'custom:two': { note: 'keep' } };
  const app = await createServer({ dataDir: directory, definitions: { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'] },
    taskMap: {}, initialState: initial, port: 0, predictionPrewarm: false });
  await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const api = (route, body, cookie) => fetch(`${origin}${route}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${app.store.getAccessToken()}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const invite = async input => {
    const response = await api('/api/invites', input); assert.equal(response.status, 201);
    const joined = await fetch(`${origin}${new URL((await response.json()).link).pathname}`, { redirect: 'manual' });
    return joined.headers.get('set-cookie').split(';')[0];
  };
  const player = await invite({ label: 'Tick player', memberId: 'actor1' });
  const partner = await invite({ label: 'Tick partner', memberId: 'reed' });
  const viewer = await invite({ label: 'Tick viewer', viewer: true });
  for (const asset of ['tick-active-tasks.mjs', 'tick-active-tasks-model.mjs', 'tick-active-tasks.css']) assert.equal((await api(`/${asset}`, undefined, viewer)).status, 200, asset);
  const tick = (memberId = 'actor1', taskIds = ['custom:one', 'custom:two']) => ({ type: 'tick-active-tasks', memberId, taskIds, skipped: 1 });
  const send = (command, cookie = player, expectedRevision = app.store.getState().revision) => api('/api/command', { command, expectedRevision }, cookie);

  const before = app.store.getState();
  assert.equal((await send(tick(), viewer)).status, 403, 'viewer refused');
  assert.equal((await send(tick(), partner)).status, 403, 'partner cannot tick another player\'s list');
  assert.equal((await send(tick('reed'))).status, 403, 'player cannot tick for the partner');
  assert.equal((await send(tick('actor1', ['custom:missing']))).status, 400);
  assert.equal(app.store.getState().revision, before.revision, 'refusals save nothing');

  const saved = await send(tick());
  assert.equal(saved.status, 200);
  let state = app.store.getState();
  assert.equal(state.revision, before.revision + 1);
  assert.equal(state.history.length, before.history.length + 1, 'one History entry');
  assert.equal(state.history.at(-1).type, 'tick-active-tasks');
  assert.equal(state.history.at(-1).command.skipped, 1);
  assert.deepEqual(state.members[0].taskStatus, { 'custom:one': { challengeCompleted: true }, 'custom:two': { note: 'keep', challengeCompleted: true } });
  assert.equal((await send(tick('actor1', ['custom:three']), player, before.revision)).status, 409, 'stale revision refused');
  assert.equal(app.store.getState().revision, state.revision);

  const notice = await (await api('/api/coordination', undefined, partner)).json();
  assert.equal(notice.latestUndo.canUndo, false); assert.match(notice.latestUndo.reason, /your own ticked tasks/);
  assert.equal((await send({ type: 'undo' }, partner)).status, 403, 'partner cannot undo it');
  assert.equal((await send({ type: 'undo' }, viewer)).status, 403, 'viewer cannot undo it');
  assert.equal((await send({ type: 'undo' })).status, 200, 'one Undo');
  state = app.store.getState();
  assert.deepEqual(state.members, before.members, 'Undo restores the previous state exactly');
  assert.deepEqual(state.tasks, before.tasks);

  assert.equal((await send(tick('reed', ['custom:three']), null)).status, 200, 'the admin link may tick for either player');
  assert.equal(app.store.getState().members[1].taskStatus['custom:three'].challengeCompleted, true);
});
