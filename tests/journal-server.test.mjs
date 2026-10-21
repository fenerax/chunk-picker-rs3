import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, commandPermissions } from '../app/server.mjs';
import { createGroupState, MAX_JOURNAL_LENGTH } from '../app/core/state.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rs3-journal-server-'));
  const definitions = { chunks: { '100': {} }, walkableChunks: ['100'], walkableChunksF2P: ['100'], challenges: {} };
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  let app, origin;
  async function start(initial) {
    app = await createServer({ dataset: fixtureDataset, dataDir: directory, definitions, taskMap: {}, initialState: initial, port: 0, predictionPrewarm: false });
    await app.listen(); origin = `http://127.0.0.1:${app.address().port}`;
  }
  await start(initialState);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const api = (route, body, cookie) => fetch(`${origin}${route}`, { redirect: 'manual',
    method: body === undefined ? 'GET' : 'POST', headers: {
      ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${app.store.getAccessToken()}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function invite(input) {
    const created = await api('/api/invites', input); assert.equal(created.status, 201);
    const link = (await created.json()).link;
    const joined = await fetch(`${origin}${new URL(link).pathname}`, { redirect: 'manual' });
    assert.equal(joined.status, 303); return joined.headers.get('set-cookie').split(';')[0];
  }
  return { api, invite, start, get app() { return app; }, get origin() { return origin; } };
}

test('journal API follows note permissions, persists both players, guards revisions and reviews native restores', async t => {
  const f = await fixture(t), { api, invite, start } = f;
  const player = await invite({ label: 'Player test', memberId: 'actor1' });
  const viewer = await invite({ label: 'Spectator test', viewer: true });
  let state = (await (await api('/api/state')).json()).state;
  assert.equal(commandPermissions['set-journal'], commandPermissions['set-note']);
  assert.equal(Object.hasOwn(state.members[0], 'journal'), false, 'Older saves load without a journal');
  const send = async (note, memberId, cookie = player) => {
    const response = await api('/api/command', { expectedRevision: state.revision, command: { type: 'set-journal', memberId, note } }, cookie);
    assert.equal(response.status, 200); state = (await response.json()).state; return state;
  };
  const revision = state.revision;
  await send('First journal\n<b>literal</b>', 'actor1');
  await send('Partner journal', 'reed');
  assert.equal(state.history.at(-1).actor.memberId, 'actor1', 'Actor remains separate from targeted map');
  const visible = (await (await api('/api/state', undefined, viewer)).json()).state;
  assert.deepEqual(visible.members.map(member => member.journal), ['First journal\n<b>literal</b>', 'Partner journal']);
  const denied = await api('/api/command', { expectedRevision: state.revision, command: { type: 'set-journal', memberId: 'actor1', note: 'Denied' } }, viewer);
  assert.equal(denied.status, 403);
  const stale = await api('/api/command', { expectedRevision: revision, command: { type: 'set-journal', memberId: 'actor1', note: 'Stale' } }, player);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).state.members[0].journal, 'First journal\n<b>literal</b>');
  const tooLong = await api('/api/command', { expectedRevision: state.revision, command: { type: 'set-journal', memberId: 'actor1', note: 'x'.repeat(MAX_JOURNAL_LENGTH + 1) } }, player);
  assert.equal(tooLong.status, 400);
  assert.equal(f.app.store.getState().revision, state.revision);
  const backup = await (await api('/api/backup')).json();
  const saved = structuredClone(backup.state.members);
  await send('Changed plan', 'actor1');
  const preview = await api('/api/restore/preview', { backup }); assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).members[0].journal, { before: 'Changed plan', after: 'First journal\n<b>literal</b>', changed: true });
  const personalPreview = await api('/api/member-restore/preview', { backup, memberId: 'actor1' }, player);
  assert.equal(personalPreview.status, 200); assert.equal((await personalPreview.json()).preview.members[0].journal.changed, true);
  const restored = await api('/api/restore', { backup, expectedRevision: state.revision }); assert.equal(restored.status, 200);
  state = (await restored.json()).state; assert.deepEqual(state.members, saved);
  await f.app.close(); await start();
  state = (await (await api('/api/state')).json()).state; assert.deepEqual(state.members, saved);
  for (const route of ['/screen-journal.mjs', '/journal.css']) assert.equal((await fetch(`${f.origin}${route}`, { headers: { Cookie: viewer } })).status, 200);
});

