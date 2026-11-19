// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { groupHttpFixture } from './helpers/group-invite-http.mjs';

async function setup(t, extra) {
  const f = await groupHttpFixture(t, extra), owner = await f.login('101'), player = await f.login('102');
  const invite = await f.send('/api/group-invites', owner.cookie, {}); assert.equal(invite.status, 200, invite.text);
  const opened = await f.send(new URL(invite.json().link).pathname, player.cookie), cookie = f.cookies(opened, player.cookie);
  const review = (await f.send('/auth/group-invite/review', cookie)).json();
  const c = review.characters[0];
  const joined = await f.send('/auth/group-invite/accept', cookie, { confirmed: true, reviewToken: review.reviewToken, characterId: c.id }); assert.equal(joined.status, 200, joined.text);
  const d = await f.document(), p = d.pickers.find(p => p.id === invite.json().pickerId);
  return { f, owner, player: { ...player, cookie }, pickerId: p.id, ownerId: p.ownerCharacterId, playerId: c.id };
}
const scope = (pickerId, characterId) => ({ 'X-Picker-Id': pickerId, 'X-Character-Id': characterId });

test('explicit successor acceptance rechecks session roles, revokes invitations, preserves maps and survives restart', async t => {
  const { f, owner, player, pickerId, ownerId, playerId } = await setup(t);
  const ownerScope = scope(pickerId, ownerId), playerScope = scope(pickerId, playerId);
  const state = await f.send('/api/state', owner.cookie, undefined, ownerScope); assert.equal(state.status, 200, state.text);
  const unconsumed = await f.send('/api/group-invites', owner.cookie, {}, ownerScope); assert.equal(unconsumed.status, 200, unconsumed.text);
  const body = { action: 'propose', confirmed: true, requestId: randomUUID(), targetCharacterId: playerId };
  const before = await f.document(), listed = await f.send('/api/group-handover', owner.cookie, undefined, ownerScope);
  assert.equal(listed.status, 200, listed.text); assert.equal(listed.json().candidates[0].id, playerId);
  assert.doesNotMatch(listed.text, /AccountId|identities|secretHash/); assert.deepEqual(await f.document(), before);
  const proposed = await f.send('/api/group-handover', owner.cookie, body, ownerScope); assert.equal(proposed.status, 200, proposed.text);
  assert.equal(proposed.json().status, 'pending');
  assert.equal((await f.send('/api/session', owner.cookie, undefined, ownerScope)).json().ownerControls.role, 'owner');
  const received = await f.send('/api/group-handover', player.cookie, undefined, playerScope); assert.equal(received.json().handovers[0].id, body.requestId);
  const response = { action: 'accept', confirmed: true, id: body.requestId };
  const accepted = await f.send('/api/group-handover', player.cookie, response, playerScope); assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.json().status, 'accepted');
  assert.equal((await f.send('/api/session', owner.cookie, undefined, ownerScope)).json().ownerControls.role, 'player');
  assert.equal((await f.send('/api/session', player.cookie, undefined, playerScope)).json().ownerControls.role, 'owner');
  assert.equal((await f.send('/api/group-invites', owner.cookie, {}, ownerScope)).status, 403);
  const invitations = await f.send('/api/group-invites', player.cookie, undefined, playerScope);
  assert.equal(invitations.status, 200, invitations.text); assert.equal(invitations.json().invites.find(i => i.id === unconsumed.json().id).status, 'revoked');
  assert.deepEqual((await f.send('/api/state', owner.cookie, undefined, ownerScope)).json(), state.json());
  // A former owner cannot restore the whole group through a stale open document.
  const restore = await f.send('/api/restore', owner.cookie, { expectedRevision: state.json().revision, state: state.json().state }, ownerScope);
  assert.equal(restore.status, 403, restore.text);
  await f.restart();
  assert.equal((await f.send('/api/group-handover', player.cookie, response, playerScope)).json().status, 'accepted');
  assert.equal((await f.send('/api/group-handover', owner.cookie, body, ownerScope)).json().status, 'accepted');
  assert.equal((await f.document()).pickers.find(p => p.id === pickerId).ownerCharacterId, playerId);
  const module = await f.send('/group-handover.mjs', player.cookie, undefined, playerScope); assert.equal(module.status, 200, module.text);
});

test('owner and target character scopes, confirmation, CSRF and conflicting selectors fail without publication', async t => {
  const { f, owner, player, pickerId, ownerId, playerId } = await setup(t);
  const extra = await f.login('103'), ownerScope = scope(pickerId, ownerId), playerScope = scope(pickerId, playerId);
  const body = { action: 'propose', confirmed: true, requestId: randomUUID(), targetCharacterId: playerId }, before = await f.document();
  for (const [cookie, payload, headers, status] of [
    ['', body, ownerScope, 403], [player.cookie, body, playerScope, 403], [extra.cookie, body, ownerScope, 403],
    [owner.cookie, { ...body, confirmed: false }, ownerScope, 400], [owner.cookie, body, { ...ownerScope, Origin: 'https://outside.example' }, 403],
    [owner.cookie, { ...body, pickerId: 'another-group' }, ownerScope, 400], [owner.cookie, body, { ...ownerScope, 'X-Picker': 'legacy' }, 403],
  ]) { const r = await f.send('/api/group-handover', cookie, payload, headers); assert.equal(r.status, status, r.text); }
  assert.deepEqual(await f.document(), before);
  const offered = await f.send('/api/group-handover', owner.cookie, body, ownerScope); assert.equal(offered.status, 200, offered.text);
  const wrong = await f.send('/api/group-handover', owner.cookie, { action: 'accept', confirmed: true, id: body.requestId }, ownerScope); assert.equal(wrong.status, 403, wrong.text);
  const decline = await f.send('/api/group-handover', player.cookie, { action: 'decline', confirmed: true, id: body.requestId }, playerScope); assert.equal(decline.json().status, 'declined');
  assert.equal((await f.document()).pickers.find(p => p.id === pickerId).ownerCharacterId, ownerId);
});

test('lost proposal and acceptance responses recover through durable same-request retries', async t => {
  let armed;
  const { f, owner, player, pickerId, ownerId, playerId } = await setup(t, { crashPoint(name) { if (name === armed) { armed = undefined; throw new Error('Synthetic publication interruption'); } } });
  const ownerScope = scope(pickerId, ownerId), playerScope = scope(pickerId, playerId), requestId = randomUUID();
  const body = { action: 'propose', confirmed: true, requestId, targetCharacterId: playerId };
  armed = 'handover-proposed'; assert.equal((await f.send('/api/group-handover', owner.cookie, body, ownerScope)).status, 503);
  await f.restart(); assert.equal((await f.send('/api/group-handover', owner.cookie, body, ownerScope)).json().status, 'pending');
  armed = 'handover-resolved';
  const accept = { action: 'accept', confirmed: true, id: requestId };
  assert.equal((await f.send('/api/group-handover', player.cookie, accept, playerScope)).status, 503);
  await f.restart(); assert.equal((await f.send('/api/group-handover', player.cookie, accept, playerScope)).json().status, 'accepted');
  assert.equal((await f.document()).handovers.length, 1);
});
