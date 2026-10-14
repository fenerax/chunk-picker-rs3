import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('Roll Stats API permits authenticated viewers, validates revision and exposes only public statistics', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-roll-stats-api-'));
  const initialState = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  initialState.provenance = { retainedEvidence: 'PRIVATE PROVENANCE EVIDENCE' };
  const definitions = { chunks: { '12341': { Nickname: 'Lumbridge' } }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] };
  const app = await createServer({ dataDir, initialState, definitions, taskMap: {}, port: 0, predictionPrewarm: false,
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'), retention: { backupDays: 90, historyEntries: 2 } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const api = route => fetch(origin + route, { headers });
  assert.equal((await fetch(origin + '/api/roll-stats')).status, 401);
  await app.store.command({ type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'unlocked' }, 0,
    { actor: { kind: 'invite', inviteId: 'secret-invite', label: 'PRIVATE ACTOR LABEL', memberId: 'actor1' } });
  for (let revision = 1; revision < 7; revision++) {
    await app.store.command({ type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'PRIVATE NOTE BODY' }, revision);
  }
  assert.ok(app.store.getInfo().retention.historyArchives > 0);
  const created = await fetch(origin + '/api/invites', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewer: true, label: 'Roll Stats viewer' }) });
  assert.equal(created.status, 201);
  const joined = await fetch((await created.json()).link, { redirect: 'manual' });
  const viewerHeaders = { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  const before = app.store.getState(), savedBefore = await readFile(path.join(dataDir, 'state.json'));
  const response = await fetch(origin + '/api/roll-stats?stateRevision=7', { headers: viewerHeaders });
  assert.equal(response.status, 200);
  const body = await response.text(), stats = JSON.parse(body);
  assert.deepEqual(Object.keys(stats).sort(), ['asOf', 'duo', 'members', 'revision', 'stateRevision']);
  assert.equal(stats.stateRevision, 7);
  assert.equal(stats.revision, 7);
  assert.equal(stats.members[0].name, 'Player');
  assert.equal(stats.members[0].totalUnlocked, 1);
  assert.equal(stats.members[0].datedUnlocked, 1);
  assert.deepEqual(Object.keys(stats.members[0].unlocks[0]).sort(), ['at', 'chunkId', 'revision', 'type']);
  for (const secret of ['PRIVATE NOTE BODY', 'PRIVATE PROVENANCE EVIDENCE', 'PRIVATE ACTOR LABEL', 'secret-invite', '"undo"', '"history"', '"command"', '"provenance"']) {
    assert.ok(!body.includes(secret), secret);
  }
  assert.equal((await api('/api/roll-stats')).status, 200);
  for (const query of ['stateRevision=', 'stateRevision=-1', 'stateRevision=1.5', 'stateRevision=NaN', 'stateRevision=9007199254740992', 'stateRevision=7&stateRevision=7']) {
    assert.equal((await api('/api/roll-stats?' + query)).status, 400, query);
  }
  const stale = await fetch(origin + '/api/roll-stats?stateRevision=6', { headers: viewerHeaders });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).state.revision, 7);
  const mutation = await fetch(origin + '/api/command', { method: 'POST', headers: { ...viewerHeaders, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: { type: 'set-chunk', memberId: 'actor1', chunkId: '12341', status: 'locked' }, expectedRevision: 7 }) });
  assert.equal(mutation.status, 403);
  assert.deepEqual(app.store.getState(), before);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), savedBefore);
  for (const route of ['/screen-roll-stats.mjs', '/roll-stats.css']) {
    const asset = await fetch(origin + route, { headers: viewerHeaders });
    assert.equal(asset.status, 200, route);
    assert.match(asset.headers.get('content-type'), route.endsWith('.mjs') ? /javascript/ : /text\/css/);
    assert.ok((await asset.text()).length > 0);
    assert.match(asset.headers.get('content-security-policy'), /script-src 'self'/);
  }
});
