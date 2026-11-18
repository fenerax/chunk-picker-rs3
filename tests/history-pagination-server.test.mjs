import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';

test('HTTP Undo checks archived travel facts ownership and retains authenticated admin invite rights', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-history-undo-access-'));
  const initialState = createGroupState([{ id: 'owner', name: 'Owner' }, { id: 'other', name: 'Other' }]);
  const app = await createServer({ dataDir, initialState, port: 0, predictionPrewarm: false, taskMap: {},
    definitions: { chunks: {}, walkableChunks: [], walkableChunksF2P: [] },
    mapAssetsDir: path.join(dataDir, 'assets'), gameDataDir: path.join(dataDir, 'game-data'),
    retention: { backupDays: 90, historyEntries: 1 } });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true }); });
  await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`;
  const master = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const api = (route, body, auth = master) => fetch(origin + route, { method: 'POST',
    headers: { ...auth, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const invite = async input => {
    const response = await api('/api/invites', input);
    assert.equal(response.status, 201);
    const joined = await fetch(origin + new URL((await response.json()).link).pathname, { redirect: 'manual' });
    assert.equal(joined.status, 303);
    return { Cookie: joined.headers.get('set-cookie').split(';')[0] };
  };
  const owner = await invite({ label: 'Owner', memberId: 'owner' });
  const other = await invite({ label: 'Other', memberId: 'other' });
  const unassigned = await invite({ label: 'Unassigned' });
  const admin = await invite({ label: 'Admin', memberId: 'other', admin: true });
  const send = (command, auth) => api('/api/command', { command, expectedRevision: app.store.getInfo().revision, admin: true }, auth);
  for (const archived of [false, true]) for (const auth of [owner, master, admin]) {
    const recorded = await send({ type: 'set-transport-facts', memberId: 'owner', facts: { currencies: { coins: 100 } } }, owner);
    assert.equal(recorded.status, 200, await recorded.text());
    const undoRevision = app.store.getInfo().revision;
    if (archived) {
      for (let index = 0; index < 4; index++) await app.store.command({ type: 'set-journal', memberId: 'other', note: `Later ${undoRevision}-${index}` }, app.store.getInfo().revision);
      assert.equal(app.store.getHistoryEvent(undoRevision), undefined);
    }
    const baseline = app.store.getState();
    for (const denied of [other, unassigned]) {
      const response = await send({ type: 'undo', undoRevision }, denied);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).message, 'You can only undo travel facts for your signed-in player.');
      assert.deepEqual(app.store.getState(), baseline);
    }
    const undone = await send({ type: 'undo', undoRevision }, auth);
    assert.equal(undone.status, 200, await undone.text());
    assert.equal(app.store.getState().members[0].transportFacts, undefined);
  }
});

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
  assert.equal(whole.preview.currentRevision, 2); assert.deepEqual(whole.preview.members[0].notes.changed, ['12341']);
  assert.equal(whole.state.provenance, undefined);
  assert.equal(whole.state.history, undefined);
  assert.deepEqual(whole.preview.history.removed, ['revision-1', 'revision-2']);
  assert.equal(typeof whole.previewToken, 'string');
  assert.deepEqual(app.store.getState(), before, 'Preview must remain read-only');
  const uploaded = await (await api('/api/restore/preview', { backup: baseline })).json();
  assert.deepEqual(uploaded.preview, whole.preview, 'Uploaded and retained backups produce the same reviewed differences');
  assert.deepEqual(uploaded.state, whole.state);
  assert.deepEqual(uploaded.transferReport, whole.transferReport);
  assert.equal(typeof uploaded.previewToken, 'string');
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
