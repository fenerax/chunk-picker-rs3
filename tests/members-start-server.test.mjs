import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createServer, routePermissions, commandPermissions } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { backupSaveLabel } from '../app/web/backup-status.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const banks = JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url), 'utf8'));
const bankIds = [...new Set(Object.values(banks).filter(Array.isArray).flat().map(row => row.chunkId).filter(Boolean))];
const ids = [...bankIds, '100', '200'];
const definitions = { chunks: Object.fromEntries(ids.map(id => [id, {}])), walkableChunks: ids, walkableChunksF2P: ['100', '200'] };
const command = { type: 'go-members', options: { pool: 'optionB', pairing: 'independent' } };

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-members-start-'));
  const initialState = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['100'] }, { id: 'player2', name: 'Player 2', unlocked: ['200'] }]);
  initialState.rules['content.f2p'] = true;
  initialState.tasks = [{ id: 'quest:retained', category: 'quest', label: 'Retained quest' }];
  initialState.members[0].completedTasks = ['quest:retained'];
  let application, origin;
  async function start() {
    application = await createServer({ dataDir, initialState, definitions, taskMap: {},
      host: '127.0.0.1', port: 0, predictionPrewarm: false, random: () => 0 });
    await application.listen(); origin = `http://127.0.0.1:${application.address().port}`;
  }
  await start();
  t.after(async () => { await application.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, cookie, body) {
    return fetch(`${origin}${route}`, { redirect: 'manual', ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) } });
  }
  const joined = await request(`/join/${application.store.getAccessToken()}`);
  assert.equal(joined.status, 303);
  const admin = joined.headers.get('set-cookie').split(';')[0];
  async function invite(extra) {
    const response = await request('/api/invites', admin, { label: 'Test player', ...extra });
    assert.equal(response.status, 201);
    const created = await response.json();
    const joined = await request(new URL(created.link).pathname);
    assert.equal(joined.status, 303);
    return joined.headers.get('set-cookie').split(';')[0];
  }
  return { dataDir, admin, request, invite, get application() { return application; }, async restart() { await application.close(); await start(); } };
}

test('members-start candidates and command require write access; either linked player can reset both maps', async t => {
  const f = await fixture(t);
  assert.equal(routePermissions.GET['/api/members-start'], 'write');
  assert.equal(commandPermissions['go-members'], 'write');
  assert.equal((await f.request('/api/members-start')).status, 401);
  const viewer = await f.invite({ viewer: true });
  const player = await f.invite({ memberId: 'player2' });
  assert.equal((await f.request('/api/members-start', viewer)).status, 403);
  const before = f.application.store.getState();
  assert.equal((await f.request('/api/command', viewer, { expectedRevision: before.revision, command })).status, 403);
  assert.deepEqual(f.application.store.getState(), before);
  assert.equal((await f.application.store.listBackups()).length, 0);
  const candidates = await f.request('/api/members-start', player);
  assert.equal(candidates.status, 200);
  assert.match(candidates.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await candidates.json()).data, banks);
  const saved = await f.request('/api/command', player, { expectedRevision: before.revision, command });
  assert.equal(saved.status, 200, saved.status === 200 ? undefined : await saved.text());
  const after = f.application.store.getState();
  assert.deepEqual(after.members.map(member => member.unlocked), [['16692'], ['16692']]);
  assert.deepEqual(after.members.map(member => member.f2pMap.unlocked), [['100'], ['200']]);
  assert.deepEqual(after.members[0].completedTasks, before.members[0].completedTasks);
  assert.deepEqual(after.tasks, before.tasks);
  assert.equal(after.history.at(-1).actor.memberId, 'player2');
  const sharedEvent = after.history.at(-1);
  for (const memberId of ['player1', 'player2']) {
    const history = await f.application.store.queryHistory({ player: memberId });
    assert.deepEqual(history.history.map(event => event.revision), [sharedEvent.revision],
      `The shared members reset belongs in ${memberId}'s history`);
    for (const search of ['Player 1', 'Player 2', 'Wendlewick']) {
      const response = await f.request(`/api/history?player=${memberId}&type=saves&q=${encodeURIComponent(search)}`, player);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.deepEqual(page.history.map(event => event.revision), [sharedEvent.revision],
        `History for ${memberId} finds the shared reset by ${search}`);
      const text = describeHistoryEvent(page.history[0], {
        memberName: id => after.members.find(member => member.id === id)?.name ?? id,
      });
      assert.match(text, /Player 1 at Wendlewick; Player 2 at Wendlewick/);
    }
  }
  const partner = await f.invite({ memberId: 'player1' });
  assert.equal((await f.request('/api/command', partner, { expectedRevision: after.revision, command })).status, 200);
});

test('members reset keeps a labelled pinned durable backup of the full previous state; conflicts create no backup', async t => {
  const f = await fixture(t);
  const before = await f.application.store.backup();
  const stale = await f.request('/api/command', f.admin, { expectedRevision: 999, command });
  assert.equal(stale.status, 409);
  assert.deepEqual(f.application.store.getState(), before.state);
  assert.equal((await f.application.store.listBackups()).length, 0);
  const saved = await f.request('/api/command', f.admin, { expectedRevision: before.state.revision, command });
  assert.equal(saved.status, 200, saved.status === 200 ? undefined : await saved.text());
  const backups = await f.application.store.listBackups();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].label, 'Before going members');
  const retained = JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, 'backups', backups[0].id))).toString('utf8'));
  assert.equal(retained.retentionPinned, true);
  assert.equal(retained.retentionLabel, 'Before going members');
  assert.deepEqual(retained.state, before.state);
  assert.deepEqual((await f.application.store.readBackup(backups[0].id)).state, before.state);
  await f.restart();
  assert.equal(f.application.store.getState().rules['content.f2p'], false);
  const reopenedBackup = (await f.application.store.listBackups()).find(backup => backup.id === backups[0].id);
  assert.equal(reopenedBackup.label, 'Before going members');
  assert.match(backupSaveLabel(reopenedBackup), /^Before going members · /);
  assert.deepEqual((await f.application.store.readBackup(backups[0].id)).state, before.state);
  const revision = f.application.store.getState().revision;
  assert.equal((await f.request('/api/command', f.admin, { expectedRevision: revision, command: { type: 'undo' } })).status, 200);
  const undone = f.application.store.getState();
  assert.deepEqual(undone.members, before.state.members);
  assert.deepEqual(undone.rules, before.state.rules);
  assert.deepEqual(undone.tasks, before.state.tasks);
});

test('restore choices prefer the members reset backup label over the prior event and actor', () => {
  const label = backupSaveLabel({ label: 'Before going members', revision: 1, at: '2026-10-12T12:00:00.000Z',
    event: { type: 'set-note', command: { memberId: 'player2', chunkId: '200', note: 'Old note' },
      actor: { kind: 'invite', inviteId: 'old-player', label: 'Old actor', memberId: 'player2' } } });
  assert.match(label, /^Before going members · /);
  assert.doesNotMatch(label, /Old actor|Old note|Edited note/);
});
