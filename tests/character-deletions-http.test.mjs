// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, writeFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';

const scope = (p, c) => ({ 'X-Picker-Id': p, 'X-Character-Id': c });
async function setup(t, options) {
  const f = await groupHttpFixture(t, options), owner = await f.login('101'), player = await f.login('102');
  const invitation = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(invitation.status, 200, invitation.text);
  const opened = await f.send(new URL(invitation.json().link).pathname, player.cookie); player.cookie = f.cookies(opened, player.cookie);
  const reviewed = (await f.send('/auth/group-invite/review', player.cookie)).json(), characterId = reviewed.characters[0].id;
  const joined = await f.send('/auth/group-invite/accept', player.cookie, { confirmed: true, reviewToken: reviewed.reviewToken, characterId }); assert.equal(joined.status, 200, joined.text);
  const d = await f.document(), pickerId = invitation.json().pickerId, ownerId = d.pickers.find(p => p.id === pickerId).ownerCharacterId, memberId = d.characters.find(c => c.id === characterId).placement.memberId;
  return { f, owner, player, pickerId, ownerId, characterId, memberId, ps: scope(pickerId, characterId), os: scope(pickerId, ownerId) };
}
const route = (s, kind = 'character') => '/api/deletion?' + new URLSearchParams({ kind, ...(kind === 'account' ? {} : { character: s.characterId, picker: s.pickerId }), deleteGroup: 'true' });
async function review(f, cookie, url) { const r = await f.send(url, cookie); assert.equal(r.status, 200, r.text); return r.json(); }
const confirmation = r => ({ requestId: randomUUID(), reviewToken: r.reviewToken, confirmed: true, finalGroupConfirmed: true });
function openStream(f, cookie, headers) { return new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port: f.app().loopbackAddress().port, path: '/api/events', agent: false,
    headers: { Host: 'picker.example', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', Cookie: cookie, ...headers } }, response => {
    response.resume(); const closed = new Promise(done => { response.once('end', done); response.once('close', done); }); resolve({ request, response, closed });
  }); request.on('error', reject);
}); }

test('character deletion revokes only its exact credentials, retains other maps, and explains old links', { timeout: 30000 }, async t => {
  const s = await setup(t), { f, player, owner, ps, os, memberId, characterId, pickerId } = s;
  const directory = path.join(f.multiPicker.pickerRoot, pickerId), at = new Date().toISOString(), ids = [randomUUID(), randomUUID()], players = ['owner', memberId];
  const hash = v => createHash('sha256').update(v).digest('hex');
  await f.restart(async () => {
    await writeFile(path.join(directory, 'overlays.json'), JSON.stringify({ schemaVersion: 1, links: players.map((player, n) => ({ id: ids[n], player, widget: 'count', label: 'Synthetic overlay', createdAt: at, revoked: false, tokenHash: hash('overlay-' + n) })) }));
    await writeFile(path.join(directory, 'invites.json'), JSON.stringify({ schemaVersion: 1, invites: players.map((memberId, n) => ({ id: ids[n], memberId, label: 'Synthetic invitation', admin: false, viewer: false, createdAt: at, lastUsedAt: null, revoked: false, tokenHash: hash('invite-' + n) })), sessions: ids.map((inviteId, n) => ({ inviteId, tokenHash: hash('session-' + n), expiresAt: new Date(Date.now() + 86400000).toISOString() })) }));
  });
  const playerKey = await f.send('/api/game-plugin/keys', player.cookie, { memberId, label: 'Deleted slot' }, ps); assert.equal(playerKey.status, 201, playerKey.text);
  const ownerKey = await f.send('/api/game-plugin/keys', owner.cookie, { memberId: 'owner', label: 'Surviving slot' }, os); assert.equal(ownerKey.status, 201, ownerKey.text);
  const old = await review(f, player.cookie, route(s));
  assert.deepEqual(old.targets.map(t => t.characterId), [characterId]); assert.deepEqual(old.groups, []);
  assert.equal((await f.send(route(s), player.cookie, { requestId: randomUUID(), reviewToken: old.reviewToken })).status, 409);
  const body = confirmation(old), result = await f.send(route(s), player.cookie, body); assert.equal(result.status, 200, result.text);
  assert.equal((await f.send(route(s), player.cookie, body)).status, 200);
  const menu = await f.send('/api/characters', player.cookie); assert.equal(menu.status, 200, menu.text); assert.deepEqual(menu.json().characters, []);
  const oldCharacter = await f.send('/characters/' + characterId, player.cookie); assert.equal(oldCharacter.status, 403); assert.match(oldCharacter.text, /deleted.*character menu/s);
  const oldGroup = await f.send(`/pickers/${pickerId}/?character=${characterId}`, player.cookie); assert.equal(oldGroup.status, 403); assert.match(oldGroup.text, /no longer a member.*character menu/s);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + playerKey.json().key })).status, 401);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + ownerKey.json().key })).status, 200);
  assert.equal((await f.send('/api/state', owner.cookie, undefined, os)).json().state.members.length, 1);
  const keys = JSON.parse(await readFile(path.join(f.multiPicker.pickerRoot, pickerId, 'plugin-keys.json')));
  assert.equal(keys.keys.find(k => k.id === playerKey.json().record.id).revoked, true);
  assert.equal(keys.keys.find(k => k.id === ownerKey.json().record.id).revoked, false);
  const overlays = JSON.parse(await readFile(path.join(directory, 'overlays.json'))), invites = JSON.parse(await readFile(path.join(directory, 'invites.json')));
  assert.equal(overlays.links[1].revoked, true); assert.equal(overlays.links[0].revoked, false);
  assert.equal(invites.invites[1].revoked, true); assert.equal(invites.invites[0].revoked, false); assert.deepEqual(invites.sessions.map(s => s.inviteId), [ids[0]]);
  await f.restart();
  assert.deepEqual((await f.send('/api/characters', player.cookie)).json().characters, []);
  const again = await f.login('102', player.cookie); assert.deepEqual((await f.send('/api/characters', again.cookie)).json().characters, []);
});

test('deletion closes the target stream and keeps a surviving character stream open', { timeout: 30000 }, async t => {
  const s = await setup(t), a = await openStream(s.f, s.player.cookie, s.ps), b = await openStream(s.f, s.owner.cookie, s.os);
  t.after(() => { a.request.destroy(); b.request.destroy(); });
  assert.equal(a.response.statusCode, 200); assert.equal(b.response.statusCode, 200);
  const r = await review(s.f, s.player.cookie, route(s)); assert.equal((await s.f.send(route(s), s.player.cookie, confirmation(r))).status, 200);
  await a.closed; assert.equal(b.response.readableEnded, false);
});

test('group and login deletion require handover before touching another login', async t => {
  const s = await setup(t), { f, owner, player, ownerId, pickerId } = s;
  const ownerSelection = { ...s, characterId: ownerId };
  assert.equal((await f.send(route(ownerSelection), owner.cookie)).status, 409);
  assert.equal((await f.send(route(ownerSelection, 'picker'), owner.cookie)).status, 409);
  assert.equal((await f.send(route(s, 'account'), owner.cookie)).status, 409);
  assert.equal((await f.send(route(s, 'picker'), player.cookie)).status, 403);
  const offered = await f.send('/api/group-handover', owner.cookie, { action: 'propose', requestId: randomUUID(), targetCharacterId: s.characterId, confirmed: true }, s.os); assert.equal(offered.status, 200, offered.text);
  const accepted = await f.send('/api/group-handover', player.cookie, { action: 'accept', id: offered.json().id, confirmed: true }, s.ps); assert.equal(accepted.status, 200, accepted.text);
  const url = route(s, 'account'), r = await review(f, owner.cookie, url), result = await f.send(url, owner.cookie, confirmation(r)); assert.equal(result.status, 200, result.text);
  assert.equal((await f.send('/api/state', player.cookie, undefined, s.ps)).status, 200);
  assert.equal((await f.document()).pickers.find(p => p.id === pickerId).ownerCharacterId, s.characterId);
  assert.equal((await f.send('/api/characters', owner.cookie)).status, 401);
});

test('final character needs separate group acknowledgement and preserves an empty login', async t => {
  const f = await groupHttpFixture(t), a = await f.login('201'), d = await f.document(), c = d.characters[0], s = { characterId: c.id, pickerId: c.placement.pickerId };
  const url = route(s), r = await review(f, a.cookie, url), body = confirmation(r);
  assert.deepEqual(r.groups, [s.pickerId]);
  assert.equal((await f.send(url, a.cookie, { ...body, finalGroupConfirmed: false })).status, 409);
  const result = await f.send(url, a.cookie, body); assert.equal(result.status, 200, result.text);
  assert.deepEqual((await f.send('/api/characters', a.cookie)).json().characters, []);
  const accountReview = await review(f, a.cookie, route(s, 'account')), accountBody = confirmation(accountReview);
  const removed = await f.send(route(s, 'account'), a.cookie, accountBody); assert.equal(removed.status, 200, removed.text);
  assert.equal((await f.send(route(s, 'account'), a.cookie, accountBody)).status, 200);
  await f.restart(); assert.equal((await f.send('/api/characters', a.cookie)).status, 401);
  assert.equal((await f.send(route(s, 'account'), a.cookie, accountBody)).status, 200);
  assert.equal((await f.send(route(s, 'account'), a.cookie, { ...accountBody, reviewToken: randomUUID() })).status, 401);
  assert.equal((await f.send(route(s, 'account'), '', accountBody)).status, 401);
});

test('reviews bind session, account, exact targets and current roster; origin is checked', async t => {
  const s = await setup(t), { f, owner, player } = s, url = route(s), r = await review(f, player.cookie, url), body = confirmation(r);
  assert.equal((await f.send(url, owner.cookie, body)).status, 409);
  assert.equal((await f.send(url, player.cookie, body, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.send(url + '&character=' + s.characterId, player.cookie, body)).status, 403);
  assert.equal((await f.send(url, player.cookie, { ...body, accountId: randomUUID() })).status, 400);
  const write = await f.send('/api/command', owner.cookie, { command: { type: 'set-note', memberId: 'owner', chunkId: '12341', note: 'Late write' }, expectedRevision: (await f.send('/api/state', owner.cookie, undefined, s.os)).json().state.revision }, s.os);
  assert.equal(write.status, 200, write.text);
  assert.equal((await f.send(url, player.cookie, body)).status, 409);
  const fresh = await review(f, player.cookie, url), signedOut = await f.send('/auth/signout', player.cookie, {}); assert.equal(signedOut.status, 303, signedOut.text);
  assert.equal((await f.send(url, player.cookie, confirmation(fresh))).status, 401);
  assert.equal((await f.document()).characters.find(c => c.id === s.characterId).lifecycle, 'active');
});

for (const seam of ['deletion-intent', 'departure-keys', 'departure-overlays', 'departure-sessions', 'deletion-retired', 'deletion-complete']) test(`HTTP interruption at ${seam} recovers exact deletion on restart`, async t => {
  let armed = false;
  const s = await setup(t, { crashPoint(name) { if (armed && name === seam) { armed = false; throw new Error('Synthetic deletion interruption'); } } });
  const { f, player } = s, url = route(s), r = await review(f, player.cookie, url);
  const key = await f.send('/api/game-plugin/keys', player.cookie, { memberId: s.memberId, label: 'Revoked' }, s.ps); assert.equal(key.status, 201, key.text);
  armed = true; assert.equal((await f.send(url, player.cookie, confirmation(r))).status, 503);
  await f.restart();
  assert.equal((await f.document()).characters.find(c => c.id === s.characterId).lifecycle, 'retired');
  assert.deepEqual((await f.send('/api/characters', player.cookie)).json().characters, []);
  assert.equal((await f.send('/api/plugin/v1/status', '', undefined, { Authorization: 'Bearer ' + key.json().key })).status, 401);
  assert.equal((await f.send('/api/state', s.owner.cookie, undefined, s.os)).status, 200);
});

test('restoring old registry and saved gameplay reapplies deletion before serving', async t => {
  const s = await setup(t), { f, player } = s, registryFile = path.join(f.multiPicker.registryDir, 'registry.json'), bytes = await readFile(registryFile);
  const backup = (await f.send('/api/backup', s.owner.cookie, undefined, s.os)).json();
  const directory = path.join(f.multiPicker.pickerRoot, s.pickerId), frozen = path.join(f.root, 'older-gameplay');
  await cp(directory, frozen, { recursive: true, filter: source => !path.basename(source).startsWith('store.lock') });
  const r = await review(f, player.cookie, route(s)); assert.equal((await f.send(route(s), player.cookie, confirmation(r))).status, 200);
  await f.restart(async () => { await writeFile(registryFile, bytes); await rm(directory, { recursive: true }); await cp(frozen, directory, { recursive: true }); });
  assert.deepEqual((await f.send('/api/characters', player.cookie)).json().characters, []);
  assert.equal((await f.send('/api/state', s.owner.cookie, undefined, s.os)).json().state.members.length, 1);
  const refused = await f.send('/api/restore/preview', s.owner.cookie, { backup, rosterMapping: { owner: 'owner', [s.memberId]: s.memberId } }, s.os);
  assert.equal(refused.status, 422, refused.text);
  assert.match(refused.text, /departed slot|Historical slots/);
  assert.equal((await f.send('/api/state', s.owner.cookie, undefined, s.os)).json().state.members.length, 1);
});

test('a delayed preview cannot republish into a deleted character scope', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const dataset = { ...fixtureDataset, capabilities: { ...fixtureDataset.capabilities, features: { ...fixtureDataset.capabilities.features, runeMetrics: true, externalNames: true } } };
  const s = await setup(t, { dataset, progressSources: { webSource: 'official-api', officialApi: { async snapshot() { entered.resolve(); await release.promise;
    return { source: 'official-api', sourceLabel: 'Official API', fetchedAt: new Date().toISOString(), skills: [], quests: [] }; } } } });
  const { f, owner, player, os, ps } = s, state = (await f.send('/api/state', owner.cookie, undefined, os)).json().state;
  assert.equal((await f.send('/api/command', owner.cookie, { expectedRevision: state.revision, command: { type: 'set-runescape-name', memberId: 'owner', name: 'OwnerSample' } }, os)).status, 200);
  const pending = f.send('/api/runemetrics/preview', player.cookie, { memberId: 'owner' }, ps); await entered.promise;
  const r = await review(f, player.cookie, route(s)); assert.equal((await f.send(route(s), player.cookie, confirmation(r))).status, 200);
  release.resolve(); const denied = await pending; assert.equal(denied.status, 403, denied.text); assert.equal(denied.json().previewId, undefined);
  assert.equal((await f.send('/api/state', owner.cookie, undefined, os)).status, 200);
});

test('final group deletion revokes pending owner invitations and releases reservations', async t => {
  const f = await groupHttpFixture(t), a = await f.login('601'), d = await f.document(), c = d.characters[0], s = { characterId: c.id, pickerId: c.placement.pickerId };
  const invite = await f.send('/api/group-invites', a.cookie, {}, scope(s.pickerId, s.characterId)); assert.equal(invite.status, 200, invite.text);
  const r = await review(f, a.cookie, route(s)), deleted = await f.send(route(s), a.cookie, confirmation(r)); assert.equal(deleted.status, 200, deleted.text);
  const after = await f.document(); assert.equal(after.groupInvites.find(i => i.id === invite.json().id).status, 'revoked'); assert.deepEqual(after.pickers.find(p => p.id === s.pickerId).reservations, []);
  const other = await f.login('602'), opened = await f.send(new URL(invite.json().link).pathname, other.cookie);
  const pendingCookie = f.cookies(opened, other.cookie), refused = await f.send('/auth/group-invite/review', pendingCookie); assert.equal(refused.status, 200, refused.text);
  assert.equal(refused.json().invite.status, 'revoked'); assert.equal(refused.json().review, null);
  const characterId = (await f.send('/api/characters', other.cookie)).json().characters[0].id;
  assert.equal((await f.send('/auth/group-invite/accept', pendingCookie, { confirmed: true, reviewToken: refused.json().reviewToken, characterId })).status, 409);
});

test('join recovers after old-slot retirement publishes before the registry placement', async t => {
  let armed = false;
  const s = await setup(t, { crashPoint(name) { if (armed && name === 'retirement-slot') { armed = false; throw Object.assign(new Error('Synthetic old-slot interruption'), { status: 503 }); } } }), { f, owner, pickerId } = s;
  const a = await f.login('603'), c = (await f.send('/api/characters', a.cookie)).json().characters[0], invite = await f.send('/api/group-invites', owner.cookie, {}, s.os);
  const opened = await f.send(new URL(invite.json().link).pathname, a.cookie); a.cookie = f.cookies(opened, a.cookie);
  const r = (await f.send('/auth/group-invite/review', a.cookie)).json(); armed = true;
  assert.equal((await f.send('/auth/group-invite/accept', a.cookie, { confirmed: true, reviewToken: r.reviewToken, characterId: c.id })).status, 503);
  await f.restart();
  assert.equal((await f.document()).characters.find(row => row.id === c.id).placement.pickerId, pickerId);
  assert.equal((await f.send('/api/state', a.cookie, undefined, scope(pickerId, c.id))).status, 200);
});

test('a pending login deletion rejects Add character over HTTP before allocating any group or ID', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let armed = false;
  t.after(() => release.resolve());
  const f = await groupHttpFixture(t, { async crashPoint(name) { if (armed && name === 'deletion-roster') { armed = false; entered.resolve(); await release.promise; } } });
  const login = await f.login('701'), c = (await f.document()).characters[0], url = route({ characterId: c.id, pickerId: c.placement.pickerId }, 'account');
  const r = await review(f, login.cookie, url); armed = true;
  const pending = f.send(url, login.cookie, confirmation(r)); await entered.promise;
  const registry = await f.document(), ledgerFile = path.join(f.multiPicker.tombstoneDir, 'ledger.json'), bytes = await readFile(ledgerFile);
  const denied = await f.send('/api/characters', login.cookie, { requestId: randomUUID() });
  assert.equal(denied.status, 409, denied.text); assert.match(denied.text, /Login deletion is completing/);
  assert.deepEqual(await f.document(), registry); assert.deepEqual(await readFile(ledgerFile), bytes);
  release.resolve(); assert.equal((await pending).status, 200);
  await f.restart(); assert.equal((await f.send('/api/characters', login.cookie)).status, 401);
});

test('a pending new-character acceptance refuses a stale login-deletion confirmation over HTTP', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let armed = false;
  t.after(() => release.resolve());
  const f = await groupHttpFixture(t, { async crashPoint(name) { if (armed && name === 'invite-roster') { armed = false; entered.resolve(); await release.promise; } } });
  const owner = await f.login('721'), login = await f.login('722'), url = route({}, 'account');
  const invitation = await f.send('/api/group-invites', owner.cookie, {});
  const opened = await f.send(new URL(invitation.json().link).pathname, login.cookie); login.cookie = f.cookies(opened, login.cookie);
  const deletion = await review(f, login.cookie, url);
  const inviteReview = (await f.send('/auth/group-invite/review', login.cookie)).json(); armed = true;
  const accepting = f.send('/auth/group-invite/accept', login.cookie, { confirmed: true, reviewToken: inviteReview.reviewToken });
  await entered.promise;
  const before = await f.document(), ledgerFile = path.join(f.multiPicker.tombstoneDir, 'ledger.json'), bytes = await readFile(ledgerFile);
  const refused = await f.send(url, login.cookie, confirmation(deletion)); assert.equal(refused.status, 409, refused.text); assert.match(refused.text, /lifecycle change is pending/);
  assert.deepEqual(await f.document(), before); assert.deepEqual(await readFile(ledgerFile), bytes);
  release.resolve(); assert.equal((await accepting).status, 200);
  await f.restart(); const menu = await f.send('/api/characters', login.cookie); assert.equal(menu.status, 200, menu.text); assert.equal(menu.json().characters.length, 2);
});

for (const reviewKind of ['progress', 'transfer']) test(`completed HTTP receipt retry preserves a surviving character ${reviewKind} review`, async t => {
  const dataset = { ...fixtureDataset, capabilities: { ...fixtureDataset.capabilities, features: { ...fixtureDataset.capabilities.features, runeMetrics: true, externalNames: true } } };
  const s = await setup(t, { dataset, progressSources: { webSource: 'official-api', officialApi: { async snapshot() {
    return { source: 'official-api', sourceLabel: 'Official API', fetchedAt: new Date().toISOString(), skills: [], quests: [] };
  } } } }), { f, owner, player, os } = s;
  const state = (await f.send('/api/state', owner.cookie, undefined, os)).json().state;
  assert.equal((await f.send('/api/command', owner.cookie, { expectedRevision: state.revision, command: { type: 'set-runescape-name', memberId: 'owner', name: 'OwnerSample' } }, os)).status, 200);
  const r = await review(f, player.cookie, route(s)), body = confirmation(r), deleted = await f.send(route(s), player.cookie, body); assert.equal(deleted.status, 200, deleted.text);
  const preview = await f.send('/api/runemetrics/preview', owner.cookie, { memberId: 'owner' }, os); assert.equal(preview.status, 200, preview.text);
  const backup = (await f.send('/api/backup', owner.cookie, undefined, os)).json();
  const transfer = await f.send('/api/restore/preview', owner.cookie, { backup }, os); assert.equal(transfer.status, 200, transfer.text);
  assert.ok(transfer.json().previewToken);
  const retry = await f.send(route(s), player.cookie, body); assert.equal(retry.status, 200); assert.deepEqual(retry.json(), deleted.json());
  const applied = reviewKind === 'progress'
    ? await f.send('/api/runemetrics/apply', owner.cookie, { previewId: preview.json().previewId, expectedRevision: preview.json().stateRevision }, os)
    : await f.send('/api/restore', owner.cookie, { backup, expectedRevision: preview.json().stateRevision, previewToken: transfer.json().previewToken }, os);
  assert.equal(applied.status, 200, applied.text);
});
