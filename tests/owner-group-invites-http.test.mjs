// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';

test('login retained quota returns actionable HTTP refusals while its existing map stays readable', async t => {
  const f = await groupHttpFixture(t), owner = await f.login('101');
  f.multiPicker.loginStorage = { maxMaps: 1 };
  await f.restart();
  const before = await f.document();
  const refused = await f.send('/api/characters', owner.cookie, { requestId: 'second-character' });
  assert.equal(refused.status, 507, refused.text);
  assert.equal(refused.json().code, 'LOGIN_STORAGE_BUDGET_EXCEEDED');
  assert.match(refused.json().message, /login.*storage limit.*Existing maps/s);
  assert.deepEqual(await f.document(), before);
  assert.equal((await f.send('/api/state', owner.cookie)).status, 200);
  f.multiPicker.loginStorage = { maxBytes: 1 };
  await f.restart();
  const state = await f.send('/api/state', owner.cookie);
  assert.equal(state.status, 200, state.text);
  const command = await f.send('/api/command', owner.cookie, { expectedRevision: state.json().state.revision, command: { type: 'set-journal', memberId: 'owner', note: 'Synthetic note' } });
  assert.equal(command.status, 507, command.text);
  assert.equal(command.json().code, 'LOGIN_STORAGE_BUDGET_EXCEEDED');
  assert.match(command.json().message, /login.*storage limit/);
});

test('GET previews only, secret exchange survives first login, explicit untouched-solo acceptance and retry', async t => {
  const f = await groupHttpFixture(t), owner = await f.login('101');
  const created = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(created.status, 200, created.text);
  const invite = created.json(), link = new URL(invite.link), before = await f.document();
  assert.equal(before.groupInvites[0].status, 'pending'); assert.equal(before.pickers.find(p => p.id === invite.pickerId).reservations.length, 1);
  assert.equal(JSON.stringify(before).includes(link.pathname.slice(6)), false);
  const opened = await f.send(link.pathname); assert.equal(opened.status, 303, opened.text); assert.equal(opened.headers.location, '/auth/group-invite'); assert.equal(opened.headers['referrer-policy'], 'no-referrer');
  const continuation = f.cookies(opened), preview = await f.send('/auth/group-invite', continuation);
  assert.equal(preview.status, 200); assert.match(preview.text, /Sign in with Discord/); assert.doesNotMatch(preview.text, /gin_|secretHash|ownerAccountId|Player 1/);
  assert.deepEqual(await f.document(), before);
  const player = await f.login('102', continuation); assert.equal(player.response.headers.location, '/auth/group-invite');
  const d = await f.document(), account = d.accounts.find(a => a.identities.some(i => i.subject === '102'));
  const c = d.characters.find(c => c.accountId === account.id), solo = c.placement.pickerId;
  assert.equal(d.pickers.find(p => p.id === solo).seats.length, 1); assert.equal(d.pickers.find(p => p.id === solo).ownerCharacterId, c.id);
  const page = await f.send('/auth/group-invite', player.cookie); assert.match(page.text, /group-invites.mjs/);
  const reviewed = await f.send('/auth/group-invite/review', player.cookie); assert.equal(reviewed.status, 200, reviewed.text);
  const review = reviewed.json(); assert.equal(review.characters[0].eligible, true);
  assert.equal((await f.document()).groupInvites[0].status, 'pending');
  const body = { reviewToken: review.reviewToken, characterId: c.id, confirmed: true };
  const refused = await f.send('/auth/group-invite/accept', player.cookie, { ...body, confirmed: false }); assert.equal(refused.status, 400);
  const accepted = await f.send('/auth/group-invite/accept', player.cookie, body); assert.equal(accepted.status, 200, accepted.text); assert.equal(accepted.json().message, 'Joined group');
  const placed = await f.document(); assert.equal(placed.groupInvites[0].status, 'accepted'); assert.equal(placed.pickers.find(p => p.id === solo).lifecycle, 'retired');
  assert.equal(placed.characters.find(x => x.id === c.id).placement.pickerId, invite.pickerId);
  const retry = await f.send('/auth/group-invite/accept', player.cookie, body); assert.equal(retry.status, 200, retry.text); assert.equal(retry.json().message, 'Already joined');
  const state = await f.send(`/api/state?character=${c.id}`, player.cookie); assert.equal(state.status, 200, state.text); assert.equal(state.json().state.members.length, 2);
  const old = await f.send(`/pickers/${solo}/?character=${c.id}`, player.cookie); assert.equal(old.status, 403);
  await f.restart(); assert.equal((await f.send(`/api/state?character=${c.id}`, player.cookie)).status, 200);
  const raw = await readFile(path.join(f.multiPicker.registryDir, 'registry.json'), 'utf8'); assert.equal(raw.includes(link.pathname.slice(6)), false);
});

test('established map refusal offers new character; owner scope, CSRF, revoke and secret-free lists', async t => {
  const f = await groupHttpFixture(t), owner = await f.login('101'), player = await f.login('102');
  const created = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(created.status, 200, created.text); const invite = created.json();
  assert.equal((await f.send('/api/group-invites', player.cookie, {}, { 'X-Picker-Id': invite.pickerId })).status, 403);
  assert.equal((await f.send('/api/group-invites', owner.cookie, {}, { Origin: 'https://outside.example' })).status, 403);
  const changed = await f.send('/api/command', player.cookie, { expectedRevision: 0, command: { type: 'set-journal', memberId: 'owner', note: 'Map progress' } }); assert.equal(changed.status, 200, changed.text);
  const opened = await f.send(new URL(invite.link).pathname, player.cookie), cookie = f.cookies(opened, player.cookie);
  const reviewed = await f.send('/auth/group-invite/review', cookie); assert.equal(reviewed.status, 200, reviewed.text); const review = reviewed.json();
  assert.equal(review.characters[0].eligible, false); assert.match(review.characters[0].reason, /map in progress.*new character/);
  const denied = await f.send('/auth/group-invite/accept', cookie, { confirmed: true, reviewToken: review.reviewToken, characterId: review.characters[0].id }); assert.equal(denied.status, 409, denied.text);
  const accepted = await f.send('/auth/group-invite/accept', cookie, { confirmed: true, reviewToken: review.reviewToken, runescapeName: 'Sample' }); assert.equal(accepted.status, 200, accepted.text);
  const d = await f.document(), character = d.characters.find(c => c.id === accepted.json().character.id); assert.equal(character.placement.pickerId, invite.pickerId);
  const prior = await f.send(`/api/state?character=${review.characters[0].id}`, cookie); assert.equal(prior.status, 200, prior.text); assert.equal(prior.json().state.members.length, 1);
  const next = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(next.status, 200, next.text);
  const replaced = await f.send('/api/group-invites', owner.cookie, { replaceId: next.json().id }); assert.equal(replaced.status, 200, replaced.text);
  const revoked = await f.send('/api/group-invites', owner.cookie, { revokeId: replaced.json().id }); assert.equal(revoked.status, 200, revoked.text);
  const listed = await f.send('/api/group-invites', owner.cookie); assert.equal(listed.status, 200); assert.doesNotMatch(listed.text, /gin_|secretHash|https:/);
  assert.deepEqual(listed.json().invites.map(i => i.status), ['accepted', 'revoked', 'revoked']);
  const module = await f.send('/group-invites.mjs', cookie); assert.equal(module.status, 200, module.text); assert.match(module.text, /New character/); assert.match(module.text, /Copy invitation link/);
});

test('interrupted admission fences destination edits until a same-character retry finishes', async t => {
  let armed = false;
  const f = await groupHttpFixture(t, { beforeCommit(change) {
    if (armed && change.operation === 'roster') { armed = false; throw Object.assign(new Error('Synthetic publication interruption'), { status: 503 }); }
  } });
  const owner = await f.login('101'), player = await f.login('102');
  const issued = await f.send('/api/group-invites', owner.cookie, {});
  const opened = await f.send(new URL(issued.json().link).pathname, player.cookie), cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', cookie)).json();
  const body = { confirmed: true, reviewToken: review.reviewToken, characterId: review.characters[0].id };
  armed = true;
  assert.equal((await f.send('/auth/group-invite/accept', cookie, body)).status, 503);
  const edit = { expectedRevision: 0, command: { type: 'set-journal', memberId: 'owner', note: 'Cannot alter the reviewed destination' } };
  assert.equal((await f.send('/api/command', owner.cookie, edit)).status, 503);
  const retry = await f.send('/auth/group-invite/accept', cookie, body);
  assert.equal(retry.status, 200, retry.text); assert.equal(retry.json().message, 'Already joined');
  const state = (await f.send('/api/state', owner.cookie)).json().state;
  assert.equal(state.members.length, 2); assert.equal(state.members[0].journal ?? '', '');
});
