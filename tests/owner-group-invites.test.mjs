// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inviteFixture } from './helpers/owner-invite-fixture.mjs';
import { GROUP_INVITE_POINTS, GROUP_MOVE_POINTS, MOVE_UNAVAILABLE } from '../app/storage/group-invites.mjs';
import { registryRecoveryDocument } from '../app/storage/registry.mjs';
import { validateGroupInvites } from '../app/storage/group-invites.mjs';
import { redact } from '../scripts/test-timing-reporter.mjs';
import { redactInviteTokens, redactInviteFields } from '../app/picker-context-http.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { validateOriginalRegistry } from './fixtures/registry-v1-reader.mjs';
import { stage1RegistryVersionGate } from './fixtures/registry-v2-version-gate.mjs';

async function fixture(t, extra) {
  const root = await mkdtemp(path.join(tmpdir(), 'owner-invites-'));
  let f = await inviteFixture(root, extra);
  t.after(async () => { await f.close(); await rm(root, { recursive: true }); });
  return { root, get f() { return f; }, async restart(extra) { await f.close(); f = await inviteFixture(root, extra); return f; } };
}
const doc = f => readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8').then(JSON.parse);

for (const size of [1, 2, 3, 4, 5]) test(`owner reservations and admission preserve roster size ${size}`, async t => {
  const h = await fixture(t), f = h.f;
  const owner = await f.registry.firstLogin('google', 'owner');
  for (let n = 1; n < size; n++) {
    const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
    assert.equal(f.registry.getPicker(owner.picker.id).seats.length + f.registry.getPicker(owner.picker.id).reservations.length, n + 1);
    const joined = await f.join(invite, owner.account, { runescapeName: `Player ${n}` });
    const c = f.registry.getCharacter(joined.character.id);
    assert.equal(c.placement.pickerId, owner.picker.id);
    assert.equal((await f.open(owner.picker.id)).store.getCalculationSnapshot().readState.members.length, n + 1);
    assert.equal((await f.join(invite, owner.account, { characterId: c.id })).message, 'Already joined');
  }
  const p = f.registry.getPicker(owner.picker.id); assert.equal(p.seats.length, size); assert.equal(p.reservations.length, 0);
  for (let n = size; n < 5; n++) await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await assert.rejects(f.registry.createGroupInvite(owner.account.id, owner.picker.id), /no vacant/);
  await assert.rejects(f.registry.createGroupInvite('stranger', owner.picker.id), /Only the current/);
  const ids = f.registry.listCharacters(owner.account.id).map(c => c.id); await h.restart(); assert.deepEqual(h.f.registry.listCharacters(owner.account.id).map(c => c.id), ids);
});

test('one concurrent winner; another character cannot reuse; accepted membership outlives the link', async t => {
  const { f } = await fixture(t), owner = await f.registry.firstLogin('google', 'owner'), a = await f.registry.firstLogin('google', 'a'), b = await f.registry.firstLogin('google', 'b');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), review = await f.service.review(invite.secret, a.account.id);
  const attempts = await Promise.allSettled([a, b].map(x => f.service.accept(invite.secret, x.account.id, { characterId: x.character.id }, review.review.revision)));
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1); assert.equal(attempts.filter(x => x.status === 'rejected').length, 1);
  assert.equal(f.registry.getPicker(owner.picker.id).seats.length, 2);
  assert.equal(f.registry.getPicker(a.picker.id).lifecycle, 'retired');
  assert.equal(f.registry.getPicker(b.picker.id).lifecycle, 'active');
  await assert.rejects(f.join(invite, a.account, { characterId: b.character.id }), /another character/);
  await f.registry.revokeGroupInvite(owner.account.id, owner.picker.id, invite.id);
  assert.equal(f.registry.getCharacter(a.character.id).placement.pickerId, owner.picker.id);
  assert.equal(f.registry.previewGroupInvite(invite.secret).status, 'accepted');
});

test('established solos freeze to Past maps on move, require fresh review after edits, and designated multi-player owners require handover', async t => {
  const { f } = await fixture(t), owner = await f.registry.firstLogin('google', 'owner'), a = await f.registry.firstLogin('google', 'a');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), source = await f.open(a.picker.id);
  const review = await f.service.review(invite.secret, a.account.id);
  assert.equal(review.characters[0].eligible, true); assert.equal(review.characters[0].sourceMode, 'onboarding');
  await source.store.command({ type: 'set-journal', memberId: 'owner', note: 'Synthetic progress' }, 0);
  await assert.rejects(f.service.accept(invite.secret, a.account.id, { characterId: a.character.id }, review.review.revision), /current map changed/);
  const refreshed = await f.service.review(invite.secret, a.account.id);
  assert.equal(refreshed.characters[0].eligible, true); assert.equal(refreshed.characters[0].sourceMode, 'solo');
  const moved = await f.service.accept(invite.secret, a.account.id, { characterId: a.character.id }, refreshed.review.revision);
  assert.equal(moved.message, 'Joined group');
  assert.equal(f.registry.getCharacter(a.character.id).placement.pickerId, owner.picker.id);
  assert.equal(f.registry.getPicker(a.picker.id).lifecycle, 'retired');
  const pastMaps = f.registry.listPastMaps(a.account.id);
  assert.equal(pastMaps.length, 1);
  const saved = await f.registry.readPastMap(a.account.id, pastMaps[0].id);
  assert.equal(saved.document.state.members[0].journal, 'Synthetic progress');
  assert.equal((await f.open(owner.picker.id)).store.getCalculationSnapshot().readState.members.find(m => m.id === f.registry.getCharacter(a.character.id).placement.memberId).journal, undefined);
  // Add-character solo is also eligible to move directly with a frozen Past map.
  const extra = await f.registry.addCharacter(a.account.id, { requestId: 'extra' });
  assert.equal(f.registry.groupJoinEligible(a.account.id, extra.character.id, owner.picker.id), true);
  // Designated owner of a multi-player group must hand over before moving.
  const other = await f.registry.firstLogin('google', 'other');
  const otherInvite = await f.registry.createGroupInvite(other.account.id, other.picker.id);
  const ownerReview = await f.service.review(otherInvite.secret, owner.account.id);
  assert.equal(ownerReview.characters[0].eligible, false);
  assert.match(ownerReview.characters[0].reason, /handover/i);
  await assert.rejects(f.service.accept(otherInvite.secret, owner.account.id, { characterId: owner.character.id }, ownerReview.review.revision), /handover/i);
  await f.join(otherInvite, owner.account);
  assert.equal(f.registry.getCharacter(owner.character.id).placement.pickerId, owner.picker.id);
});

test('retiring an established solo clears viewer memberships and capabilities referencing the retired picker', async t => {
  const h = await fixture(t), f = h.f;
  const dest = await f.registry.firstLogin('google', 'dest-owner');
  const mover = await f.registry.firstLogin('google', 'solo-mover');
  const viewer = await f.registry.firstLogin('google', 'solo-viewer');
  await f.registry.attachMembership(viewer.account.id, { pickerId: mover.picker.id, role: 'viewer', memberId: null });
  await f.registry.setCapability({ kind: 'overlay-capability', hash: 'a'.repeat(64), pickerId: mover.picker.id, accountId: viewer.account.id, memberId: null });
  const invite = await f.registry.createGroupInvite(dest.account.id, dest.picker.id);
  const review = await f.service.review(invite.secret, mover.account.id);
  assert.equal(review.characters[0].eligible, true); assert.equal(review.characters[0].sourceMode, 'solo');
  const moved = await f.service.accept(invite.secret, mover.account.id, { characterId: mover.character.id }, review.review.revision);
  assert.equal(moved.message, 'Joined group');
  assert.equal(f.registry.getPicker(mover.picker.id).lifecycle, 'retired');
  assert.equal(f.registry.getAccount(viewer.account.id).memberships.some(m => m.pickerId === mover.picker.id), false);
  assert.equal(f.registry.resolveCapability('overlay-capability', 'a'.repeat(64)), null);
  assert.equal(f.registry.getCharacter(viewer.character.id).placement.pickerId, viewer.picker.id);
  await h.restart();
  assert.equal(h.f.registry.getCharacter(mover.character.id).placement.pickerId, dest.picker.id);
  assert.equal(h.f.registry.getAccount(viewer.account.id).memberships.some(m => m.pickerId === mover.picker.id), false);
});

test('admission copies reviewed geography and rules while preserving existing private progress', async t => {
  const { f } = await fixture(t), owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player');
  const initial = createGroupState([{ id: 'owner', name: 'Owner', unlocked: ['12341'], blacklisted: ['12342'],
    taskRules: { 'Rare Drop': false }, journal: 'Private owner journal', notes: { '12341': 'Private owner note' } }]);
  initial.tasks = [{ id: 'synthetic:done', label: 'Synthetic task', category: 'Custom' }];
  initial.members[0].completedTasks = ['synthetic:done'];
  initial.rules = { 'house.synthetic': false };
  await writeFile(path.join(f.registry.pickerDirectory(owner.picker.id), 'state.json'), JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state: initial }));
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const reviewed = await f.service.review(invite.secret, player.account.id);
  assert.deepEqual(reviewed.review.unlocked, ['12341']); assert.equal(reviewed.review.rules['house.synthetic'], false);
  assert.ok(reviewed.review.ruleRows.some(r => r.label === 'Synthetic house rule' && r.value === false));
  await f.join(invite, player.account);
  const state = (await f.open(owner.picker.id)).store.getCalculationSnapshot().readState;
  assert.deepEqual(state.members[0], initial.members[0]);
  assert.deepEqual(state.members[1].unlocked, ['12341']); assert.deepEqual(state.members[1].blacklisted, ['12342']);
  assert.deepEqual(state.members[1].taskRules, initial.members[0].taskRules);
  assert.deepEqual(state.members[1].completedTasks, []); assert.equal(state.members[1].journal, undefined); assert.equal(state.members[1].notes, undefined);
  assert.deepEqual(state.rules, initial.rules); assert.equal(state.schemaVersion, 1);
});

test('expiry at commit releases seat; replace/revoke are independent of memberships; terminal cleanup is bounded', async t => {
  let at = Date.parse('2026-01-01T00:00:00Z'); const { f } = await fixture(t, { now: () => at });
  const owner = await f.registry.firstLogin('google', 'owner'), a = await f.registry.firstLogin('google', 'a');
  const lost = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), replacement = await f.registry.createGroupInvite(owner.account.id, owner.picker.id, lost.id);
  assert.equal(f.registry.previewGroupInvite(lost.secret).status, 'revoked'); assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, 1);
  const review = await f.service.review(replacement.secret, a.account.id); at += 7 * 86400000;
  await assert.rejects(f.service.accept(replacement.secret, a.account.id, {}, review.review.revision), /expired/);
  assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, 0);
  const pending = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.registry.revokeGroupInvite(owner.account.id, owner.picker.id, pending.id); assert.equal(f.registry.previewGroupInvite(pending.secret).status, 'revoked');
  at += 30 * 86400000; await f.registry.cleanGroupInvites(); assert.equal((await doc(f)).groupInvites.length, 0);
  await assert.rejects(Promise.resolve().then(() => f.registry.previewGroupInvite(lost.secret)), /unavailable/);
});

test('future ownership changes invalidate pending offers immediately without removing accepted membership', async t => {
  const h = await fixture(t), f = h.f, owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player');
  const accepted = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const joined = await f.join(accepted, player.account);
  const pending = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const document = await doc(f), p = document.pickers.find(p => p.id === owner.picker.id);
  // Synthetic future-stage ownership change; stage 2 exposes no handover API.
  p.ownerAccountId = player.account.id; p.ownerCharacterId = joined.character.id;
  const previous = document.accounts.find(a => a.id === owner.account.id); previous.defaultPickerId = null;
  previous.memberships.find(m => m.pickerId === p.id).role = 'player';
  document.accounts.find(a => a.id === player.account.id).memberships.find(m => m.pickerId === p.id).role = 'owner';
  await f.close(); await writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify(document));
  const restored = await h.restart();
  assert.equal(restored.registry.previewGroupInvite(pending.secret).status, 'revoked');
  await assert.rejects(restored.join(pending, owner.account), /revoked/);
  assert.equal(restored.registry.getPicker(p.id).reservations.length, 0);
  assert.equal(restored.registry.previewGroupInvite(accepted.secret).status, 'accepted');
  assert.equal(restored.registry.getCharacter(joined.character.id).placement.pickerId, p.id);
});

test('hash-only one-time link, migration preimage, reader refusal, sanitized checkpoint and no secret revival', async t => {
  const h = await fixture(t), f = h.f, owner = await f.registry.firstLogin('google', 'owner');
  const original = await readFile(path.join(f.options.registryDir, 'registry.json'), 'utf8');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), saved = await doc(f);
  assert.equal(saved.schemaVersion, 3); assert.equal(saved.groupInvites[0].secretHash.length, 64);
  assert.throws(() => validateOriginalRegistry(saved), /Invalid registry/);
  assert.throws(() => stage1RegistryVersionGate(saved), /Unsupported newer registry version/);
  assert.equal(JSON.stringify(saved).includes(invite.secret), false); assert.equal(JSON.stringify(f.registry.listGroupInvites(owner.account.id, owner.picker.id)).includes('secret'), false);
  assert.equal(await readFile(path.join(f.options.registryDir, 'registry.pre-invites-v2.json'), 'utf8'), original);
  assert.equal(redact(`https://picker.example/join/${invite.secret}`), 'https://picker.example/join/<token>');
  assert.equal(redactInviteTokens(`https://picker.example/join/${invite.secret}`), 'https://picker.example/join/[redacted]');
  assert.deepEqual(redactInviteFields({ message: `%2fjoin%2f${invite.secret}` }), { message: '/join/[redacted]' });
  const recovered = registryRecoveryDocument(saved); assert.equal(recovered.groupInvites[0].secretHash, null); assert.equal(recovered.groupInvites[0].status, 'revoked'); assert.equal(recovered.pickers[0].reservations.length, 0);
  await h.restart(); assert.equal(h.f.registry.previewGroupInvite(invite.secret).status, 'pending');
  await h.f.close(); await writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify({ ...saved, schemaVersion: 6 }));
  await assert.rejects(inviteFixture(h.root), /Unsupported newer registry/);
});

test('migration refuses a damaged preimage without upgrading or reserving a seat', async t => {
  const { f } = await fixture(t), owner = await f.registry.firstLogin('google', 'owner');
  await writeFile(path.join(f.options.registryDir, 'registry.pre-invites-v2.json'), '{');
  await assert.rejects(f.registry.createGroupInvite(owner.account.id, owner.picker.id), /preimage differs/);
  assert.equal((await doc(f)).schemaVersion, 2);
  assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, 0);
});

test('recovery validation rejects missing intents and mismatched reservation references', async t => {
  const { f } = await fixture(t), owner = await f.registry.firstLogin('google', 'owner');
  await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  const saved = await doc(f);
  const missing = structuredClone(saved); delete missing.groupInvites[0].transaction;
  assert.throws(() => validateGroupInvites(missing), /Invalid group invitation/);
  const mismatched = structuredClone(saved); mismatched.pickers[0].reservations[0].id = '00000000-0000-4000-8000-000000000000';
  assert.throws(() => validateGroupInvites(mismatched), /Invalid group invitation/);
});

test('schema-1 legacy and owned rosters migrate through stage 1 to invitations without changing gameplay or access', async t => {
  const h = await fixture(t), f = h.f, owner = await f.registry.firstLogin('google', 'owner');
  await f.open(owner.picker.id);
  const legacy = await f.registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [1, 2].map(n => ({
    id: `00000000-0000-4000-8000-00000000000${n}`, identities: [{ provider: 'discord', subject: String(n) }], memberships: [{ role: 'player', memberId: n === 1 ? 'one' : 'two' }] })) });
  const gameplay = JSON.stringify({ format: 'rs3-chunk-picker', schemaVersion: 1, state: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]) });
  await writeFile(path.join(f.options.legacyDir, 'state.json'), gameplay);
  const old = await doc(f), ledgerFile = path.join(f.options.tombstoneDir, 'ledger.json'), ledger = JSON.parse(await readFile(ledgerFile));
  old.schemaVersion = 1; delete old.characters;
  for (const a of old.accounts) for (const field of ['initialProvisioned', 'lastCharacterId', 'pendingCreation']) delete a[field];
  for (const p of old.pickers) for (const field of ['seats', 'reservations', 'ownerCharacterId']) delete p[field];
  ledger.schemaVersion = 1; delete ledger.issuedCharacterIds; delete ledger.characters;
  await f.close(); await writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify(old)); await writeFile(ledgerFile, JSON.stringify(ledger));
  const migrated = await h.restart();
  await migrated.registry.createGroupInvite(owner.account.id, owner.picker.id);
  assert.equal((await doc(migrated)).schemaVersion, 3); assert.equal(migrated.registry.getPicker(legacy.id).seats.length, 2);
  assert.equal(migrated.registry.getPicker(legacy.id).ownerCharacterId, null);
  assert.equal(await readFile(path.join(f.options.legacyDir, 'state.json'), 'utf8'), gameplay);
  assert.equal(migrated.registry.findIdentity('discord', '1').memberships[0].memberId, 'one');
  await assert.rejects(migrated.registry.createGroupInvite(owner.account.id, legacy.id), /Only the current/);
});

test('destination changes require a new review; duplicate names and character quotas preserve reservation', async t => {
  const { f } = await fixture(t, { caps: { charactersPerAccount: 2 } }), owner = await f.registry.firstLogin('google', 'owner');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id), review = await f.service.review(invite.secret, owner.account.id), dest = await f.open(owner.picker.id);
  await dest.store.command({ type: 'set-journal', memberId: 'owner', note: 'Changed' }, 0);
  await assert.rejects(f.service.accept(invite.secret, owner.account.id, {}, review.review.revision), /map changed/);
  await f.join(invite, owner.account, { runescapeName: 'Sample' });
  const next = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await assert.rejects(f.join(next, owner.account, { runescapeName: 'sample' }), { code: 'DUPLICATE_CHARACTER_NAME' });
  await assert.rejects(f.join(next, owner.account), /character limit/);
  assert.equal(f.registry.previewGroupInvite(next.secret).status, 'pending');
});

test('sanitized recovery reclaims a joined login without restoring secrets or giving it owner authority', async t => {
  const h = await fixture(t), f = h.f, owner = await f.registry.firstLogin('google', 'owner'), player = await f.registry.firstLogin('google', 'player');
  const invite = await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await f.join(invite, player.account, { characterId: player.character.id });
  const recovered = registryRecoveryDocument(await doc(f));
  await f.close(); await writeFile(path.join(f.options.registryDir, 'registry.json'), JSON.stringify(recovered));
  const restored = await h.restart(); const code = await restored.registry.issueRelinkCode(player.account.id);
  const account = await restored.registry.claimIdentity(code.code, 'google', 'reclaimed');
  assert.equal(account.id, player.account.id); assert.equal(restored.registry.selectCharacter(account.id).id, player.character.id);
  assert.equal(account.memberships[0].role, 'player'); assert.equal(restored.registry.getPicker(owner.picker.id).ownerAccountId, owner.account.id);
  assert.throws(() => restored.registry.previewGroupInvite(invite.secret), /unavailable/);
});

for (const [seam, newCharacter] of [...GROUP_INVITE_POINTS.map(s => [s, s === 'invite-ids']),
  ...['invite-committed', 'invite-roster-prepared', 'invite-roster', 'invite-placed'].map(s => [s, true])]) test(`crash/retry at ${seam} (${newCharacter ? 'new' : 'existing'} character) preserves reservation, IDs and one placement`, async t => {
  const h = await fixture(t), owner = await h.f.registry.firstLogin('google', 'owner'), a = await h.f.registry.firstLogin('google', 'a');
  const creating = ['invite-backed-up', 'invite-versioned', 'invite-created'].includes(seam);
  const invite = creating ? null : await h.f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  await h.f.close();
  const url = new URL('./helpers/owner-invite-fixture.mjs', import.meta.url).href;
  const script = `import { inviteFixture } from ${JSON.stringify(url)}; const [root,seam,owner,a,invite,newCharacter]=JSON.parse(process.argv[1]); const f=await inviteFixture(root,{crashPoint(name){if(name===seam)process.exit(86);}}); if(invite) await f.join(invite,a.account, newCharacter?{}:{characterId:a.character.id}); else await f.registry.createGroupInvite(owner.account.id,owner.picker.id); await f.close();`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([h.root, seam, owner, a, invite, newCharacter])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 86, result.output);
  const f = await h.restart(); const before = (await doc(f)).groupInvites;
  await f.service.recover();
  if (creating) {
    assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, seam === 'invite-created' ? 1 : 0);
    assert.equal((await doc(f)).schemaVersion, 5);
    await f.registry.firstLogin('google', 'after-interruption');
    await f.registry.createGroupInvite(owner.account.id, owner.picker.id);
  } else {
    const input = newCharacter ? {} : { characterId: a.character.id };
    const joined = await f.join(invite, a.account, input);
    assert.equal(f.registry.getCharacter(joined.character.id).placement.pickerId, owner.picker.id);
    assert.equal(f.registry.getPicker(owner.picker.id).seats.length, 2);
    assert.equal(f.registry.getPicker(owner.picker.id).reservations.length, 0);
    if (before[0].acceptingCharacterId) assert.equal(joined.character.id, before[0].acceptingCharacterId);
  }
});

for (const size of [2, 3, 4, 5]) test(`direct multi-player move preserves source group, same-login sibling, Past map and ledger retirement for roster ${size}`, async t => {
  const h = await fixture(t), f = h.f;
  const sourceOwner = await f.registry.firstLogin('google', 'source-owner');
  const destOwner = await f.registry.firstLogin('google', 'dest-owner');
  const mover = await f.registry.firstLogin('google', 'mover');
  // Put mover in source group (and when size >= 3, add a second same-login character of mover too).
  const firstInvite = await f.registry.createGroupInvite(sourceOwner.account.id, sourceOwner.picker.id);
  await f.join(firstInvite, mover.account, { characterId: mover.character.id });
  let sibling;
  if (size >= 3) {
    const sibInvite = await f.registry.createGroupInvite(sourceOwner.account.id, sourceOwner.picker.id);
    sibling = (await f.join(sibInvite, mover.account, { runescapeName: 'Sibling' })).character;
  }
  for (let n = sibling ? 3 : 2; n < size; n++) {
    const p = await f.registry.firstLogin('google', `extra-${size}-${n}`);
    const inv = await f.registry.createGroupInvite(sourceOwner.account.id, sourceOwner.picker.id);
    await f.join(inv, p.account, { characterId: p.character.id });
  }
  const sourceStore = (await f.open(sourceOwner.picker.id)).store;
  const oldMemberId = f.registry.getCharacter(mover.character.id).placement.memberId;
  await sourceStore.command({ type: 'set-journal', memberId: oldMemberId, note: `Source note ${size}` }, sourceStore.getInfo().revision);
  const handover = await f.registry.proposeGroupHandover(sourceOwner.account.id, sourceOwner.character.id, sourceOwner.picker.id, { requestId: `00000000-0000-4000-8000-00000000000${size}`, targetCharacterId: mover.character.id });
  assert.equal(handover.status, 'pending');
  const destInvite = await f.registry.createGroupInvite(destOwner.account.id, destOwner.picker.id);
  const review = await f.service.review(destInvite.secret, mover.account.id);
  const moverRow = review.characters.find(c => c.id === mover.character.id);
  assert.equal(moverRow.eligible, true); assert.equal(moverRow.sourceMode, 'group');
  const moved = await f.service.accept(destInvite.secret, mover.account.id, { characterId: mover.character.id }, review.review.revision);
  assert.equal(moved.message, 'Joined group');
  assert.equal(f.registry.getCharacter(mover.character.id).placement.pickerId, destOwner.picker.id);
  assert.equal(f.registry.getPicker(sourceOwner.picker.id).lifecycle, 'active');
  assert.equal(f.registry.getPicker(sourceOwner.picker.id).seats.length, size - 1);
  assert.equal(f.registry.getPicker(destOwner.picker.id).seats.length, 2);
  if (sibling) assert.equal(f.registry.getCharacter(sibling.id).placement.pickerId, sourceOwner.picker.id);
  const afterSource = (await f.open(sourceOwner.picker.id)).store.getReadState();
  assert.equal(afterSource.members.some(m => m.id === oldMemberId), false);
  assert.ok(afterSource.history.some(e => e.type === 'member-departed'));
  assert.ok(f.registry.retiredMemberIds(sourceOwner.picker.id).includes(oldMemberId));
  const afterDest = (await f.open(destOwner.picker.id)).store.getReadState();
  const newMemberId = f.registry.getCharacter(mover.character.id).placement.memberId;
  assert.equal(afterDest.members.find(m => m.id === newMemberId).journal, undefined);
  const pastMaps = f.registry.listPastMaps(mover.account.id);
  assert.equal(pastMaps.length, 1);
  const saved = await f.registry.readPastMap(mover.account.id, pastMaps[0].id);
  assert.equal(saved.document.state.members.find(m => m.id === oldMemberId).journal, `Source note ${size}`);
  assert.equal((await doc(f)).handovers.find(x => x.id === handover.id).status, 'cancelled');
  assert.equal((await f.join(destInvite, mover.account, { characterId: mover.character.id })).message, 'Already joined');
  await h.restart();
  assert.equal(h.f.registry.getCharacter(mover.character.id).placement.pickerId, destOwner.picker.id);
  assert.equal(h.f.registry.getPicker(sourceOwner.picker.id).seats.length, size - 1);
});

for (const seam of GROUP_MOVE_POINTS) test(`crash/retry at ${seam} (multi-player direct move) recovers Past map, source roster and destination placement`, async t => {
  const h = await fixture(t);
  const sourceOwner = await h.f.registry.firstLogin('google', 'src-owner');
  const destOwner = await h.f.registry.firstLogin('google', 'dst-owner');
  const mover = await h.f.registry.firstLogin('google', 'mover');
  const joinSource = await h.f.registry.createGroupInvite(sourceOwner.account.id, sourceOwner.picker.id);
  await h.f.join(joinSource, mover.account, { characterId: mover.character.id });
  const sourceStore = (await h.f.open(sourceOwner.picker.id)).store;
  const oldMemberId = h.f.registry.getCharacter(mover.character.id).placement.memberId;
  await sourceStore.command({ type: 'set-journal', memberId: oldMemberId, note: `Crash move ${seam}` }, sourceStore.getInfo().revision);
  const destInvite = await h.f.registry.createGroupInvite(destOwner.account.id, destOwner.picker.id);
  const review = await h.f.service.review(destInvite.secret, mover.account.id);
  await h.f.close();
  const crashFile = fileURLToPath(new URL('./fixtures/departure-crash.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [crashFile, JSON.stringify([h.root, seam, [destInvite.secret, mover.account.id, { characterId: mover.character.id }, review.review.revision], 'join'])], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; }); child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 86, result.output);
  const f = await h.restart();
  await f.service.recover();
  assert.equal(f.registry.getCharacter(mover.character.id).placement.pickerId, destOwner.picker.id);
  assert.equal(f.registry.getPicker(sourceOwner.picker.id).seats.length, 1);
  assert.equal(f.registry.getPicker(destOwner.picker.id).seats.length, 2);
  assert.equal((await f.open(sourceOwner.picker.id)).store.getReadState().members.some(m => m.id === oldMemberId), false);
  const pastMaps = f.registry.listPastMaps(mover.account.id);
  assert.equal(pastMaps.length, 1);
  assert.equal((await f.registry.readPastMap(mover.account.id, pastMaps[0].id)).document.state.members.find(m => m.id === oldMemberId).journal, `Crash move ${seam}`);
  assert.equal((await f.join(destInvite, mover.account, { characterId: mover.character.id })).message, 'Already joined');
});
