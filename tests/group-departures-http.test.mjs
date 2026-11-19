// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { usageEvents } from '../app/web/usage-catalogue.mjs';

const scope = (pickerId, characterId) => ({ 'X-Picker-Id': pickerId, 'X-Character-Id': characterId });
async function setup(t, options) {
  const f = await groupHttpFixture(t, options), owner = await f.login('101'), player = await f.login('102');
  const invitation = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(invitation.status, 200, invitation.text);
  const opened = await f.send(new URL(invitation.json().link).pathname, player.cookie); player.cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', player.cookie)).json(), playerId = review.characters[0].id;
  const joined = await f.send('/auth/group-invite/accept', player.cookie, { confirmed: true, reviewToken: review.reviewToken, characterId: playerId }); assert.equal(joined.status, 200, joined.text);
  const d = await f.document(), pickerId = invitation.json().pickerId, ownerId = d.pickers.find(p => p.id === pickerId).ownerCharacterId, memberId = d.characters.find(c => c.id === playerId).placement.memberId;
  return { f, owner, player, pickerId, ownerId, playerId, memberId, os: scope(pickerId, ownerId), ps: scope(pickerId, playerId) };
}
async function depart({ f, player, ps, playerId }, actorCookie = player.cookie, headers = ps) {
  const r = await f.send('/api/group-departure', actorCookie, undefined, headers); assert.equal(r.status, 200, r.text);
  const body = { confirmed: true, requestId: randomUUID(), characterId: playerId, revision: r.json().revision };
  const left = await f.send('/api/group-departure', actorCookie, body, headers); assert.equal(left.status, 200, left.text);
  return { body, result: left.json() };
}

test('departed usage actors and per-member plugin sidecars survive a group reopen after restart', async t => {
  const x = await setup(t), { f, owner, player, pickerId, memberId, os, ps } = x;
  const directory = path.join(f.multiPicker.pickerRoot, pickerId), at = new Date().toISOString(), hash = value => createHash('sha256').update(value).digest('hex');
  const players = ['owner', memberId], ids = players.map(() => randomUUID());
  const item = { baselineAt: at, items: { 100: { name: 'Synthetic item', ownedAt: at, wornAt: null, first: true } }, handled: ['rs3:task:synthetic'],
    journal: { id: 'a'.repeat(16), event: 1 }, bank: { snapshot: 'b'.repeat(16), seenAt: at, coins: 100 } };
  const sidecars = {
    'plugin-achievements.json': { v: 1, players: Object.fromEntries(players.map(p => [p, { handled: [1] }])) },
    ...Object.fromEntries(['plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json'].map(file => [file, { v: 1, players: Object.fromEntries(players.map(p => [p, item])) }])),
    'plugin-item-journal-commits.json': { v: 1, players: Object.fromEntries(players.map(p => [p, { journals: [{ id: 'a'.repeat(16), committed: 0, pending: [[1, 100, 'Synthetic item', 'live']] }] }])) },
    'plugin-keys.json': { schemaVersion: 1, keys: players.map((player, n) => ({ id: ids[n], player, label: 'Synthetic key', createdAt: at,
      lastUsedAt: null, lastWorld: null, revoked: false, tokenHash: hash('key-' + n) })) },
    'overlays.json': { schemaVersion: 1, links: players.map((player, n) => ({ id: ids[n], player, widget: 'count', label: 'Synthetic overlay', createdAt: at, revoked: false, tokenHash: hash('overlay-' + n) })) },
    'invites.json': { schemaVersion: 1, invites: players.map((memberId, n) => ({ id: ids[n], memberId, label: 'Synthetic member', admin: false, viewer: false, createdAt: at, lastUsedAt: null, revoked: false, tokenHash: hash('invite-' + n) })),
      sessions: ids.map((inviteId, n) => ({ inviteId, tokenHash: hash('session-' + n), expiresAt: new Date(Date.now() + 86400000).toISOString() })) },
  };
  await f.restart(async () => {
    for (const [file, document] of Object.entries(sidecars)) await writeFile(path.join(directory, file), JSON.stringify(document));
    const file = path.join(directory, 'state.json'), saved = JSON.parse(await readFile(file));
    saved.pluginCurrency = { format: 2, keys: Object.fromEntries(ids.map(id => [id, { highSeq: 1, seq: 1, generation: 0, sentAt: at, receivedAt: at, epoch: null }])),
      players: Object.fromEntries(players.map((p, n) => [p, { keyId: ids[n], receivedAt: at, recoverAfter: null, historyAt: null, historyRevision: null }])),
      facts: Object.fromEntries(players.map(p => [p, { coins: 100, source: 'plugin' }])), origins: [] };
    await writeFile(file, JSON.stringify(saved));
  });
  const row = { id: usageEvents[0].id, actor: memberId, device: 'phone', day: new Date().toISOString().slice(0, 10), count: 1 };
  const used = await f.send('/api/usage', player.cookie, { counts: [row] }, ps); assert.equal(used.status, 200, used.text);
  const { body } = await depart(x); await f.restart();
  const state = await f.send('/api/state', owner.cookie, undefined, os); assert.equal(state.status, 200, state.text);
  const usage = JSON.parse(await readFile(path.join(directory, 'usage.json')));
  assert.ok(usage.counts.some(r => r.actor === memberId && r.count === 1));
  for (const file of Object.keys(sidecars).filter(f => f.startsWith('plugin-') && f !== 'plugin-keys.json')) {
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, file))), sidecars[file], file);
  }
  const overlays = JSON.parse(await readFile(path.join(directory, 'overlays.json'))), invites = JSON.parse(await readFile(path.join(directory, 'invites.json')));
  assert.equal(overlays.links[1].revoked, true); assert.equal(overlays.links[0].revoked, false);
  assert.equal(invites.invites[1].revoked, true); assert.deepEqual(invites.sessions.map(s => s.inviteId), [ids[0]]);
  const keys = JSON.parse(await readFile(path.join(directory, 'plugin-keys.json'))), saved = JSON.parse(await readFile(path.join(directory, 'state.json')));
  assert.equal(keys.keys[1].revoked, true); assert.equal(keys.keys[0].revoked, false);
  assert.ok(saved.pluginCurrency.players[memberId]);
  const frozen = (await f.send('/api/past-maps/' + body.requestId, player.cookie)).json().document.state;
  assert.deepEqual(frozen.provenance.pluginItemEvidence.players[memberId].records.live.bank, item.bank);
  assert.equal(state.json().state.members.some(m => m.id === memberId), false);
  assert.equal((await f.send('/api/state', player.cookie, undefined, ps)).status, 403);
  const ownerUsage = await f.send('/api/usage', owner.cookie, { counts: [{ ...row, actor: 'owner' }] }, os); assert.equal(ownerUsage.status, 200, ownerUsage.text);
});

test('server startup reconciles two overlapping invitation intents published by an older build', async t => {
  let armed = false;
  const x = await setup(t, { crashPoint(name) { if (armed && name === 'invite-committed') { armed = false; throw Object.assign(new Error('Synthetic admission interruption'), { status: 503 }); } } });
  const { f, owner, player, playerId, os } = x;
  await depart(x);
  const solo = (await f.document()).characters.find(c => c.id === playerId).placement.pickerId;
  const newcomer = await f.login('103'), nc = (await f.send('/api/characters', newcomer.cookie)).json().characters[0];
  const incoming = await f.send('/api/group-invites', player.cookie, {}, scope(solo, playerId)); assert.equal(incoming.status, 200, incoming.text);
  const outgoing = await f.send('/api/group-invites', owner.cookie, {}, os); assert.equal(outgoing.status, 200, outgoing.text);
  newcomer.cookie = f.cookies(await f.send(new URL(incoming.json().link).pathname, newcomer.cookie), newcomer.cookie);
  const review = (await f.send('/auth/group-invite/review', newcomer.cookie)).json(); armed = true;
  assert.equal((await f.send('/auth/group-invite/accept', newcomer.cookie, { confirmed: true, reviewToken: review.reviewToken, characterId: nc.id })).status, 503);
  const old = await f.document(), i = old.groupInvites.find(i => i.id === outgoing.json().id);
  i.status = 'accepted'; i.terminalAt = i.createdAt; i.acceptingAccountId = old.characters.find(c => c.id === playerId).accountId; i.acceptingCharacterId = playerId;
  i.transaction = { source: { pickerId: solo, memberId: 'owner' }, newCharacter: false, memberId: 'm_' + randomUUID().replaceAll('-', ''), runescapeName: null, pastMapId: i.id };
  old.pickers.find(p => p.id === i.pickerId).memberIds.push(i.transaction.memberId);
  await f.restart(() => writeFile(path.join(f.multiPicker.registryDir, 'registry.json'), JSON.stringify(old)));
  const recovered = await f.document();
  assert.equal(recovered.groupInvites.some(i => i.transaction), false);
  assert.equal(recovered.characters.find(c => c.id === playerId).placement.pickerId, solo);
  assert.equal(recovered.characters.find(c => c.id === nc.id).placement.pickerId, solo);
  for (const [cookie, headers] of [[owner.cookie, os], [player.cookie, scope(solo, playerId)], [newcomer.cookie, scope(solo, nc.id)]]) {
    const r = await f.send('/api/state', cookie, undefined, headers); assert.equal(r.status, 200, r.text);
  }
});

test('whole-save restore and import preserve post-departure assignments over HTTP and restart', async t => {
  const x = await setup(t), { f, owner, memberId, os } = x;
  const before = (await f.send('/api/state', owner.cookie, undefined, os)).json().state;
  const command = await f.send('/api/command', owner.cookie, { expectedRevision: before.revision,
    command: { type: 'add-task', task: { id: 'custom:historical', label: 'Former assignment', category: 'Custom', memberIds: [memberId] } } }, os); assert.equal(command.status, 200, command.text);
  await depart(x);
  let backup = (await f.send('/api/backup', owner.cookie, undefined, os)).json();
  const restore = async (cookie, headers, backup, rosterMapping) => {
    const preview = await f.send('/api/restore/preview', cookie, { backup, rosterMapping }, headers); assert.equal(preview.status, 200, preview.text);
    const current = (await f.send('/api/state', cookie, undefined, headers)).json().state;
    const result = await f.send('/api/restore', cookie, { backup, rosterMapping, expectedRevision: current.revision, previewToken: preview.json().previewToken }, headers); assert.equal(result.status, 200, result.text);
  };
  await restore(owner.cookie, os, backup);
  backup = (await f.send('/api/backup', owner.cookie, undefined, os)).json();
  const target = await f.login('104'), char = (await f.send('/api/characters', target.cookie)).json().characters[0], headers = scope(char.placement.pickerId, char.id);
  await restore(target.cookie, headers, backup, { owner: 'owner' });
  await f.restart();
  for (const [cookie, scopeHeaders] of [[owner.cookie, os], [target.cookie, headers]]) {
    const state = await f.send('/api/state', cookie, undefined, scopeHeaders); assert.equal(state.status, 200, state.text);
    assert.deepEqual(state.json().state.tasks.find(t => t.id === 'custom:historical').memberIds, [memberId]);
  }
});

test('a delayed preview for a remaining member cannot republish into a departed browser scope', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const dataset = { ...fixtureDataset, capabilities: { ...fixtureDataset.capabilities, features: { ...fixtureDataset.capabilities.features, runeMetrics: true, externalNames: true } } };
  const x = await setup(t, { dataset, progressSources: { webSource: 'official-api', officialApi: { async snapshot() { entered.resolve(); await release.promise;
    return { source: 'official-api', sourceLabel: 'Official API', fetchedAt: new Date().toISOString(), skills: [], quests: [] }; } } } });
  const { f, owner, player, os, ps } = x, state = (await f.send('/api/state', owner.cookie, undefined, os)).json().state;
  const named = await f.send('/api/command', owner.cookie, { expectedRevision: state.revision, command: { type: 'set-runescape-name', memberId: 'owner', name: 'OwnerSample' } }, os); assert.equal(named.status, 200, named.text);
  const pending = f.send('/api/runemetrics/preview', player.cookie, { memberId: 'owner' }, ps);
  await entered.promise; await depart(x); release.resolve();
  const denied = await pending; assert.equal(denied.status, 403, denied.text); assert.equal(denied.json().previewId, undefined);
  assert.equal((await f.send('/api/state', owner.cookie, undefined, os)).status, 200);
});

test('leave preserves a downloadable Past map, revokes exact plugin scopes, fences the old tab and survives restart/retry', async t => {
  const x = await setup(t), { f, owner, player, pickerId, playerId, memberId, os, ps } = x;
  const before = (await f.send('/api/state', player.cookie, undefined, ps)).json().state;
  const progress = await f.send('/api/command', player.cookie, { expectedRevision: before.revision, command: { type: 'set-journal', memberId, note: 'Saved before leaving' } }, ps); assert.equal(progress.status, 200, progress.text);
  const playerKey = await f.send('/api/game-plugin/keys', player.cookie, { memberId, label: 'Synthetic departing key' }, ps); assert.equal(playerKey.status, 201, playerKey.text);
  const ownerKey = await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Synthetic remaining key' }, os); assert.equal(ownerKey.status, 201, ownerKey.text);
  const { body, result } = await depart(x);
  const meta = (await f.send('/api/past-maps', player.cookie)).json().maps; assert.equal(meta.length, 1); assert.equal(meta[0].id, body.requestId);
  const map = await f.send('/api/past-maps/' + body.requestId, player.cookie); assert.equal(map.status, 200, map.text);
  assert.equal(map.json().document.state.members.find(m => m.id === memberId).journal, 'Saved before leaving');
  const exported = await f.send('/api/past-maps/' + body.requestId + '/download', player.cookie); assert.equal(exported.status, 200); assert.match(exported.headers['content-disposition'], /attachment/); assert.deepEqual(exported.json(), map.json().document);
  assert.equal((await f.send('/api/past-maps/' + body.requestId, owner.cookie)).status, 404);
  assert.equal((await f.send('/api/past-maps/' + body.requestId, player.cookie, {})).status, 405);
  assert.equal((await f.send('/past-maps/' + body.requestId, player.cookie)).status, 200);
  assert.equal((await f.send('/api/state', player.cookie, undefined, ps)).status, 403);
  assert.equal((await f.send('/api/command', player.cookie, { expectedRevision: before.revision, command: { type: 'set-journal', memberId, note: 'Old tab' } }, ps)).status, 403);
  const follow = await f.send(result.character.href, player.cookie); assert.equal(follow.status, 303, follow.text);
  const solo = (await f.document()).characters.find(c => c.id === playerId).placement;
  const fresh = await f.send('/api/state', player.cookie, undefined, scope(solo.pickerId, playerId)); assert.equal(fresh.status, 200, fresh.text); assert.equal(fresh.json().state.members[0].journal, undefined);
  const live = await f.send('/api/state', owner.cookie, undefined, os); assert.equal(live.status, 200, live.text); assert.equal(live.json().state.members.length, 1);
  const tasks = await f.send('/api/tasks?memberId=owner', owner.cookie, undefined, os); assert.equal(tasks.status, 200, tasks.text);
  const keys = JSON.parse(await readFile(path.join(f.multiPicker.pickerRoot, pickerId, 'plugin-keys.json')));
  assert.equal(keys.keys.find(k => k.player === memberId).revoked, true); assert.equal(keys.keys.find(k => k.player === 'owner').revoked, false);
  assert.equal((await f.document()).capabilities.some(k => k.memberId === memberId && k.pickerId === pickerId), false);
  await f.restart();
  const retry = await f.send('/api/group-departure', player.cookie, body, ps); assert.equal(retry.status, 200, retry.text); assert.deepEqual(retry.json(), result);
  assert.equal((await f.send('/api/past-maps', player.cookie)).json().maps.length, 1);
});

test('fresh owner invite rejoins with a new slot and keeps solo history as another Past map', async t => {
  const x = await setup(t), { f, owner, player, pickerId, playerId, memberId, os, ps } = x;
  await depart(x); const solo = (await f.document()).characters.find(c => c.id === playerId).placement;
  const note = await f.send('/api/command', player.cookie, { expectedRevision: 0, command: { type: 'set-journal', memberId: 'owner', note: 'Solo kept before rejoining' } }, scope(solo.pickerId, playerId)); assert.equal(note.status, 200, note.text);
  const invitation = await f.send('/api/group-invites', owner.cookie, {}, os); assert.equal(invitation.status, 200, invitation.text);
  const opened = await f.send(new URL(invitation.json().link).pathname, player.cookie); player.cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', player.cookie)).json(); assert.equal(review.characters[0].rejoining, true);
  const body = { confirmed: true, reviewToken: review.reviewToken, characterId: playerId };
  const joined = await f.send('/auth/group-invite/accept', player.cookie, body); assert.equal(joined.status, 200, joined.text);
  const c = (await f.document()).characters.find(c => c.id === playerId); assert.notEqual(c.placement.memberId, memberId);
  const used = await f.send('/api/usage', player.cookie, { counts: [{ id: usageEvents[0].id, actor: c.placement.memberId, device: 'phone', day: new Date().toISOString().slice(0, 10), count: 1 }] }, ps);
  assert.equal(used.status, 200, used.text);
  const state = await f.send('/api/state', player.cookie, undefined, ps); assert.equal(state.status, 200, state.text); assert.equal(state.json().state.members.find(m => m.id === c.placement.memberId).journal, undefined);
  const maps = (await f.send('/api/past-maps', player.cookie)).json().maps; assert.equal(maps.length, 2);
  const retained = (await f.send('/api/past-maps/' + invitation.json().id, player.cookie)).json(); assert.equal(retained.document.state.members[0].journal, 'Solo kept before rejoining');
  assert.equal((await f.send('/api/state', player.cookie, undefined, scope(solo.pickerId, playerId))).status, 403);
  assert.equal((await f.send('/auth/group-invite/accept', player.cookie, body)).json().message, 'Already joined');
});

test('owner removal is scoped and confirmed; owner departure requires accepted handover', async t => {
  const x = await setup(t), { f, owner, player, pickerId, ownerId, playerId, os, ps } = x;
  const review = (await f.send('/api/group-departure', owner.cookie, undefined, os)).json(), body = { confirmed: true, requestId: randomUUID(), characterId: playerId, revision: review.revision };
  const before = await f.document();
  for (const [cookie, value, headers, status] of [[owner.cookie, { ...body, confirmed: false }, os, 400], [owner.cookie, body, { ...os, Origin: 'https://outside.example' }, 403], [player.cookie, { ...body, characterId: ownerId }, ps, 403]]) {
    const r = await f.send('/api/group-departure', cookie, value, headers); assert.equal(r.status, status, r.text);
  }
  assert.deepEqual(await f.document(), before);
  const blocked = await f.send('/api/group-departure', owner.cookie, { ...body, characterId: ownerId }, os); assert.equal(blocked.status, 409, blocked.text);
  const removed = await f.send('/api/group-departure', owner.cookie, body, os); assert.equal(removed.status, 200, removed.text); assert.match(removed.json().message, /removed/); assert.equal(removed.json().character, undefined);
  assert.equal((await f.send('/api/past-maps', player.cookie)).json().maps[0].reason, 'removed'); assert.equal((await f.send('/api/past-maps', owner.cookie)).json().maps.length, 0);
});

test('interrupted snapshot publication is pending, fences writes, and startup completes the same departure', async t => {
  let armed = false;
  const x = await setup(t, { crashPoint(name) { if (armed && name === 'departure-snapshot') { armed = false; throw new Error('Synthetic snapshot interruption'); } } });
  const { f, player, playerId, ps } = x, review = (await f.send('/api/group-departure', player.cookie, undefined, ps)).json();
  const body = { confirmed: true, requestId: randomUUID(), characterId: playerId, revision: review.revision }; armed = true;
  assert.equal((await f.send('/api/group-departure', player.cookie, body, ps)).status, 503);
  await f.restart();
  const r = await f.send('/api/group-departure', player.cookie, body, ps); assert.equal(r.status, 200, r.text);
  assert.equal((await f.send('/api/past-maps', player.cookie)).json().maps.length, 1);
});

for (const rejoin of [false, true]) for (const seam of ['departure-keys', 'departure-overlays', 'departure-sessions']) test(`${rejoin ? 'rejoin' : 'leave'} recovers physical exact-slot revocations after ${seam}`, async t => {
  let armed = false;
  const x = await setup(t, { crashPoint(name) { if (armed && name === seam) { armed = false; throw Object.assign(new Error('Synthetic revocation interruption'), { status: 503 }); } } });
  const { f, owner, player, playerId, pickerId, os } = x;
  if (rejoin) await depart(x);
  const source = (await f.document()).characters.find(c => c.id === playerId).placement, headers = scope(source.pickerId, playerId);
  const key = await f.send('/api/game-plugin/keys', player.cookie, { memberId: source.memberId, label: 'Synthetic scoped key' }, headers); assert.equal(key.status, 201, key.text);
  const ids = [randomUUID(), randomUUID()], at = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString();
  const hash = value => createHash('sha256').update(value).digest('hex'), directory = path.join(f.multiPicker.pickerRoot, source.pickerId);
  await f.restart(async () => {
    const records = [source.memberId, 'unaffected-slot'];
    await writeFile(path.join(directory, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: records.map((player, n) => ({ id: ids[n], label: 'Synthetic overlay', player, widget: 'count', createdAt: at, revoked: false, tokenHash: hash('overlay-' + n) })) }));
    await writeFile(path.join(directory, 'invites.json'), JSON.stringify({ schemaVersion: 1,
      invites: records.map((memberId, n) => ({ id: ids[n], label: 'Synthetic slot', memberId, admin: false, viewer: false, createdAt: at, lastUsedAt: null, revoked: false, tokenHash: hash('invite-' + n) })),
      sessions: ids.map((inviteId, n) => ({ inviteId, tokenHash: hash('session-' + n), expiresAt })) }));
  });
  let body, invitePath;
  if (rejoin) {
    const invite = await f.send('/api/group-invites', owner.cookie, {}, os); assert.equal(invite.status, 200, invite.text);
    invitePath = new URL(invite.json().link).pathname;
    player.cookie = f.cookies(await f.send(invitePath, player.cookie), player.cookie);
    const review = (await f.send('/auth/group-invite/review', player.cookie)).json();
    body = { confirmed: true, reviewToken: review.reviewToken, characterId: playerId }; armed = true;
    assert.equal((await f.send('/auth/group-invite/accept', player.cookie, body)).status, 503);
  } else {
    const review = (await f.send('/api/group-departure', player.cookie, undefined, headers)).json();
    body = { confirmed: true, requestId: randomUUID(), characterId: playerId, revision: review.revision }; armed = true;
    assert.equal((await f.send('/api/group-departure', player.cookie, body, headers)).status, 503);
  }
  assert.equal((await f.send('/api/state', player.cookie, undefined, headers)).status, 503);
  await f.restart();
  const overlays = JSON.parse(await readFile(path.join(directory, 'overlays.json'))), sessions = JSON.parse(await readFile(path.join(directory, 'invites.json'))), keys = JSON.parse(await readFile(path.join(directory, 'plugin-keys.json')));
  assert.equal(overlays.links[0].revoked, true); assert.equal(overlays.links[1].revoked, false);
  assert.equal(sessions.invites[0].revoked, true); assert.equal(sessions.invites[1].revoked, false);
  assert.deepEqual(sessions.sessions.map(s => s.inviteId), [ids[1]]);
  assert.equal(keys.keys.find(k => k.player === source.memberId).revoked, true);
  assert.equal((await f.document()).capabilities.some(k => k.pickerId === source.pickerId && k.memberId === source.memberId), false);
  assert.equal((await f.send('/api/past-maps', player.cookie)).json().maps.length, rejoin ? 2 : 1);
  if (rejoin) {
    // Stage-2 review tokens are transient. Reopen the same durable invitation
    // after restart; its accepted receipt still resolves to the same character.
    player.cookie = f.cookies(await f.send(invitePath, player.cookie), player.cookie);
    body.reviewToken = (await f.send('/auth/group-invite/review', player.cookie)).json().reviewToken;
  }
  const result = await f.send(rejoin ? '/auth/group-invite/accept' : '/api/group-departure', player.cookie, body, rejoin ? {} : headers); assert.equal(result.status, 200, result.text);
  if (rejoin) assert.equal((await f.document()).characters.find(c => c.id === playerId).placement.pickerId, pickerId);
});
