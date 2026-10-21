import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('equipment API validates trusted names, authorizes each player, preserves imports, and survives restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-obtained-equipment-'));
  const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'], challenges: {},
    equipment: { 'Rune pickaxe': { slot: 'main hand weapon', class: 'melee', tier: 1 } } };
  let app, origin;
  const start = async initialState => {
    app = await createServer({ dataDir: directory, definitions, taskMap: {}, initialState, port: 0, predictionPrewarm: false });
    await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  };
  await start(createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = (route, body, cookie) => fetch(`${origin}${route}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${app.store.getAccessToken()}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const invite = async input => {
    const response = await api('/api/invites', input); assert.equal(response.status, 201);
    const joined = await fetch(`${origin}${new URL((await response.json()).link).pathname}`, { redirect: 'manual' });
    return joined.headers.get('set-cookie').split(';')[0];
  };
  const player = await invite({ label: 'Player 1 test', memberId: 'player1' }), viewer = await invite({ label: 'Viewer test', viewer: true });
  for (const name of ['bis-preferences.mjs', 'bis-recorded.mjs', 'bis-comparison-view.mjs', 'bis-compare.mjs', 'bis-results.mjs', 'bis-compare.css']) {
    const response = await api(`/${name}`, undefined, viewer);
    assert.equal(response.status, 200, `${name} is served for viewers`);
    assert.match(response.headers.get('content-type'), name.endsWith('.css') ? /text\/css/ : /javascript/);
  }
  let state = app.store.getState();
  const command = (memberId = 'player1', equipmentName = 'Rune pickaxe', obtained = true) => ({ type: 'set-obtained-equipment', memberId, equipmentName, obtained });
  const send = (value, cookie = player, expectedRevision = state.revision) => api('/api/command', { command: value, expectedRevision }, cookie);
  for (const [value, cookie, expected] of [[command('player2'), player, 403], [command(), viewer, 403], [command('player1', 'Fake gear'), player, 400], [command('player1', '__proto__'), player, 400], [command('player1', 'Rune pickaxe', 'yes'), player, 400]]) {
    assert.equal((await send(value, cookie)).status, expected);
  }
  const saved = await send(command()); assert.equal(saved.status, 200); state = app.store.getState();
  assert.deepEqual(state.members[0].obtainedEquipment, ['Rune pickaxe']);
  assert.deepEqual(state.members[0].completedTasks, []);
  assert.equal((await send(command(), player, 0)).status, 409);
  const visible = await (await api('/api/state', undefined, viewer)).json();
  assert.deepEqual(visible.state.members[0].obtainedEquipment, ['Rune pickaxe']);
  const partner = await send(command('player2'), null); assert.equal(partner.status, 200); state = app.store.getState();
  assert.equal((await send({ type: 'undo' }, player)).status, 403);
  const backup = await (await api('/api/backup')).json();
  assert.deepEqual(backup.state.members.map(row => row.obtainedEquipment), [['Rune pickaxe'], ['Rune pickaxe']]);
  const document = { maps: { old: { chunks: {}, chunkinfo: { manualEquipment: { 'Rune pickaxe': true } } } } };
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'old' }, { id: 'player2', name: 'Player 2', mapId: 'old' }];
  const preview = await api('/api/import/preview', { document, members }); assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).state.members[0].obtainedEquipment, ['Rune pickaxe']);
  const imported = await api('/api/import', { document, members, expectedRevision: state.revision }); assert.equal(imported.status, 200);
  state = app.store.getState(); assert.deepEqual(state.members.map(row => row.obtainedEquipment), [['Rune pickaxe'], ['Rune pickaxe']]);
  const memberPreview = await api('/api/member-restore/preview', { document, members, memberId: 'player1' }, player);
  assert.equal(memberPreview.status, 200);
  const memberImported = await api('/api/member-restore', { document, members, memberId: 'player1', expectedRevision: state.revision }, player);
  assert.equal(memberImported.status, 200);
  assert.deepEqual(app.store.getState().members[0].obtainedEquipment, ['Rune pickaxe']);
  await app.close(); await start();
  assert.deepEqual(app.store.getState().members.map(row => row.obtainedEquipment), [['Rune pickaxe'], ['Rune pickaxe']]);
});
