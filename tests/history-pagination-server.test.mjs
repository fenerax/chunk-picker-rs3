import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('authenticated History API validates filters, pages readable archive matches and preserves the bare-route contract', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-history-api-'));
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  const definitions = { chunks: { '12341': { Nickname: 'Lumbridge' } }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] };
  const app = await createServer({ dataDir, initialState: state, definitions, taskMap: {}, port: 0, predictionPrewarm: false,
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'),
    retention: { backupDays: 90, historyEntries: 2 } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const api = route => fetch(origin + route, { headers });
  assert.equal((await fetch(origin + '/api/history?limit=1')).status, 401);
  for (let revision = 0; revision < 8; revision++) await app.store.command({ type: 'set-note', memberId: 'actor1', chunkId: '12341', note: String(revision) }, revision);
  const legacy = await (await api('/api/history')).json();
  assert.ok(Array.isArray(legacy.history)); assert.ok(Array.isArray(legacy.previousHistory));
  assert.equal(legacy.nextBefore, undefined);
  const page = await (await api('/api/history?limit=2&q=lumbridge&player=actor1&type=notes&stateRevision=8')).json();
  assert.deepEqual(page.history.map(event => event.revision), [8, 7]);
  assert.equal(page.nextBefore, 7); assert.equal(page.hasMore, true); assert.equal(page.stateRevision, 8);
  const older = await (await api('/api/history?limit=2&before=3&stateRevision=8')).json();
  assert.deepEqual(older.history.map(event => event.revision), [2, 1]);
  assert.equal(older.nextBefore, null); assert.equal(older.hasMore, false);
  const details = await (await api('/api/history/1?stateRevision=8')).json();
  assert.equal(details.event.command.note, '0'); assert.equal(details.stateRevision, 8);
  assert.equal(details.event.undo, undefined); assert.equal(details.event.hasUndo, true);
  assert.equal((await api('/api/history/999?stateRevision=8')).status, 404);
  assert.equal((await api('/api/history/1?stateRevision=7')).status, 409);
  assert.equal((await api('/api/history/invalid')).status, 400);
  for (const query of ['limit=501', 'limit=0', 'limit=', 'limit=1.5', 'before=-1', 'before=9007199254740992', 'type=set-note', 'limit=1&limit=2', 'q=' + 'x'.repeat(201)]) {
    assert.equal((await api('/api/history?' + query)).status, 400, query);
  }
  const stale = await api('/api/history?limit=2&stateRevision=7');
  assert.equal(stale.status, 409); assert.equal((await stale.json()).state.revision, 8);
  const backups = (await (await api('/api/backups')).json()).backups;
  assert.equal(backups.find(backup => backup.revision === 1).event.type, 'set-note');
  assert.equal(backups.find(backup => backup.revision === 0).event, null);
  const created = await fetch(origin + '/api/invites', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewer: true, label: 'History viewer' }) });
  assert.equal(created.status, 201);
  const viewInvite = new URL((await created.json()).link);
  const joined = await fetch(viewInvite, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const viewer = await fetch(origin + '/api/history?limit=1', { headers: { Cookie: cookie } });
  assert.equal(viewer.status, 200); assert.equal((await viewer.json()).history.length, 1);
  assert.equal((await fetch(origin + '/api/history/1', { headers: { Cookie: cookie } })).status, 200);
});

test('retained backup IDs preview and restore whole or owned maps without uploading hydrated snapshots', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-retained-restore-api-'));
  const state = createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
  state.members[0].notes = { '12341': 'Player baseline' };
  state.members[1].notes = { '12341': 'Reed baseline' };
  state.provenance = { retainedEvidence: 'Private source evidence stays on the server' };
  const definitions = { chunks: { '12341': { Nickname: 'Lumbridge' } }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] };
  const app = await createServer({ dataDir, initialState: state, definitions, taskMap: {}, port: 0, predictionPrewarm: false,
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data') });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  await app.listen();
  const invite = new URL(app.inviteUrl), origin = invite.origin;
  const headers = { Authorization: `Bearer ${invite.pathname.slice('/join/'.length)}` };
  const api = (route, body, auth = headers) => fetch(origin + route, body === undefined ? { headers: auth }
    : { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await app.store.command({ type: 'set-note', memberId: 'actor1', chunkId: '12341', note: 'Player current' }, 0);
  await app.store.command({ type: 'set-note', memberId: 'reed', chunkId: '12341', note: 'Reed current' }, 1);
  const backupId = (await app.store.listBackups()).find(backup => backup.revision === 0).id;
  const baseline = await app.store.readBackup(backupId), before = app.store.getState();
  const wholeResponse = await api('/api/restore/preview?view=play-v1', { backupId });
  assert.equal(wholeResponse.status, 200);
  const whole = await wholeResponse.json();
  assert.equal(whole.preview.currentRevision, 2); assert.equal(whole.state.members[0].notes['12341'], 'Player baseline');
  assert.equal(whole.state.provenance, undefined);
  assert.equal(whole.state.history.length, 1); assert.equal(whole.state.history[0].type, 'restore');
  assert.deepEqual(app.store.getState(), before, 'Preview must remain read-only');
  const uploaded = await (await api('/api/restore/preview', { backup: baseline })).json();
  assert.deepEqual(uploaded, whole.preview, 'Uploaded-backup preview retains its existing root response');
  const personalResponse = await api('/api/member-restore/preview', { backupId, memberId: 'actor1' });
  const personal = await personalResponse.json();
  assert.equal(personalResponse.status, 200, personal.message);
  assert.equal(personal.preview.currentRevision, 2);
  assert.equal(personal.state.members[0].notes['12341'], 'Player baseline');
  assert.equal(personal.state.members[1].notes['12341'], 'Reed current');
  assert.equal(personal.state.provenance, undefined);
  const uploadedPersonal = await (await api('/api/member-restore/preview', { backup: baseline, memberId: 'actor1' })).json();
  assert.equal(uploadedPersonal.state, undefined); assert.deepEqual(uploadedPersonal.preview, personal.preview);
  for (const route of ['/api/restore/preview', '/api/restore', '/api/member-restore/preview', '/api/member-restore']) {
    for (const payload of [{ backupId, backup: baseline }, { backupId, document: {} }, { backupId: '../state.json' }, { backupId: null }]) {
      assert.equal((await api(route, { ...payload, memberId: 'actor1', expectedRevision: 2 })).status, 400, route);
    }
    assert.equal((await api(route, { backupId: '0000000000000000-ffffffffffffffff.json.gz', memberId: 'actor1', expectedRevision: 2 })).status, 404, route);
  }
  const createInvite = async fields => {
    const created = await (await api('/api/invites', fields)).json();
    const joined = await fetch(created.link, { redirect: 'manual' });
    return { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  };
  const own = await createInvite({ label: 'Player phone', memberId: 'actor1' });
  const viewer = await createInvite({ label: 'Viewer', viewer: true });
  assert.equal((await api('/api/restore/preview', { backupId }, own)).status, 403);
  assert.equal((await api('/api/member-restore/preview', { backupId, memberId: 'reed' }, own)).status, 403);
  assert.equal((await api('/api/member-restore/preview', { backupId, memberId: 'actor1' }, viewer)).status, 403);
  assert.equal((await api('/api/member-restore/preview', { backupId, memberId: 'actor1' }, own)).status, 200);
  const stalePersonal = await api('/api/member-restore?view=play-v1', { backupId, memberId: 'actor1', expectedRevision: 1 }, own);
  assert.equal(stalePersonal.status, 409); assert.deepEqual(app.store.getState(), before);
  const restoredPersonal = await api('/api/member-restore?view=play-v1', { backupId, memberId: 'actor1', expectedRevision: 2 }, own);
  assert.equal(restoredPersonal.status, 200);
  const savedPersonal = await restoredPersonal.json();
  assert.equal(savedPersonal.format, 'play-v1'); assert.equal(savedPersonal.state.revision, 3);
  assert.equal(savedPersonal.state.members[0].notes['12341'], 'Player baseline');
  assert.equal(savedPersonal.state.members[1].notes['12341'], 'Reed current');
  const staleWhole = await api('/api/restore', { backupId, expectedRevision: 2 });
  assert.equal(staleWhole.status, 409); assert.equal(app.store.getInfo().revision, 3);
  const restoredWhole = await api('/api/restore?view=play-v1', { backupId, expectedRevision: 3 });
  assert.equal(restoredWhole.status, 200);
  const savedWhole = await restoredWhole.json();
  assert.equal(savedWhole.format, 'play-v1'); assert.equal(savedWhole.state.revision, 4);
  assert.equal(savedWhole.state.members[0].notes['12341'], 'Player baseline');
  assert.equal(savedWhole.state.members[1].notes['12341'], 'Reed baseline');
  assert.equal(savedWhole.state.history[0].type, 'restore');
});
