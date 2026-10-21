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
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
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

test('journal original picker import previews preserve the whole-save and personal-map journal', async t => {
  const { api, invite } = await fixture(t);
  const player = await invite({ label: 'Player 1 test', memberId: 'player1' });
  const document = { maps: { old: { chunks: {}, chunkNotes: 'Old-_-20journal' } } };
  const members = [{ id: 'player1', name: 'Player 1', mapId: 'old' }];
  const importPreview = await api('/api/import/preview', { document, members }); assert.equal(importPreview.status, 200);
  const imported = await importPreview.json(); assert.equal(imported.state.members[0].journal, 'Old journal');
  assert.equal(imported.preview.members[0].journal.after, 'Old journal');
  const memberImport = await api('/api/member-restore/preview', { document, members, memberId: 'player1' }, player);
  assert.equal(memberImport.status, 200); assert.equal((await memberImport.json()).preview.members[0].journal.after, 'Old journal');
});
