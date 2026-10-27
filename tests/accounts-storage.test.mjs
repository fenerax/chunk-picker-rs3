import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openAccountStore } from '../app/storage/accounts.mjs';
import { openInviteStore } from '../app/storage/invites.mjs';

const root = fileURLToPath(new URL('../.local/accounts-storage-tests/', import.meta.url));
const publicContext = { masterAllowed: false, publicRequest: true, secure: true };
const privateContext = { masterAllowed: true, publicRequest: false, secure: false };
const cookie = token => ({ headers: { cookie: `duo_access=${token}` } });
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, options = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'storage-'));
  const masterToken = randomUUID();
  let accounts, invites;
  async function start() {
    accounts = await openAccountStore({ dataDir, now: options.now });
    invites = await openInviteStore({ dataDir, masterToken, masterLabel: 'Administrator', accounts, ...options });
  }
  await start();
  t.after(async () => { await invites.close(); await accounts.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, masterToken, get accounts() { return accounts; }, get invites() { return invites; }, async restart() { await invites.close(); await accounts.close(); await start(); } };
}
async function claim(f, provider = 'discord', subject = randomUUID(), player = 'player_one') {
  const account = await f.accounts.ensureIdentity(provider, subject);
  const { invite, token } = await f.invites.create({ label: 'Player', memberId: player });
  await f.invites.claim(invite.id, account.id);
  await f.accounts.attachMembership(account.id, { inviteId: invite.id, role: 'player', memberId: player });
  const session = await f.invites.issueAccountSession(account.id, invite.id, provider);
  return { account, invite, token, session, subject };
}

test('minimal identities persist, link explicitly and never merge accounts', async t => {
  let at = Date.parse('2026-10-20T00:00:00Z');
  const f = await fixture(t, { now: () => at });
  const firstSubject = randomUUID(), secondSubject = randomUUID(), otherSubject = randomUUID();
  const first = await f.accounts.ensureIdentity('discord', firstSubject);
  at += 60000;
  const reused = await f.accounts.ensureIdentity('discord', firstSubject);
  assert.equal(first.id, reused.id);
  assert.notEqual(first.identities[0].lastUsedAt, reused.identities[0].lastUsedAt);
  const second = await f.accounts.ensureIdentity('google', secondSubject);
  await assert.rejects(() => f.accounts.linkIdentity(first.id, 'google', secondSubject), { status: 409 });
  assert.equal(f.accounts.list().length, 2);
  await f.accounts.linkIdentity(first.id, 'google', otherSubject);
  await assert.rejects(() => f.accounts.linkIdentity(first.id, 'google', randomUUID()), { status: 409 });
  await f.accounts.unlinkIdentity(first.id, 'discord');
  const publicAccounts = JSON.stringify(f.accounts.list());
  assert.equal(publicAccounts.includes(firstSubject), false);
  assert.equal(publicAccounts.includes(otherSubject), false);
  await f.restart();
  assert.equal(f.accounts.findIdentity('google', otherSubject).id, first.id);
  assert.equal(f.accounts.findIdentity('discord', firstSubject), null);
  assert.equal(f.accounts.get(second.id).identities.length, 1);
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'));
  for (const identity of persisted.accounts.flatMap(account => account.identities)) assert.deepEqual(Object.keys(identity).sort(), ['createdAt', 'lastUsedAt', 'provider', 'subject']);
  const copy = f.accounts.get(first.id); copy.identities[0].subject = randomUUID();
  assert.equal(f.accounts.findIdentity('google', otherSubject).id, first.id);
  await f.accounts.unlinkIdentity(first.id, 'google');
  await f.restart();
  assert.deepEqual(f.accounts.get(first.id).identities, []);
});

test('claimed invitations survive account deletion and concurrent claims select one owner', async t => {
  const f = await fixture(t, { signInMode: 'optional' });
  const one = await f.accounts.ensureIdentity('discord', randomUUID());
  const two = await f.accounts.ensureIdentity('google', randomUUID());
  const { invite, token } = await f.invites.create({ label: 'Player', memberId: 'player_one' });
  const legacy = await f.invites.join(token, publicContext);
  const attempts = await Promise.allSettled([f.invites.claim(invite.id, one.id), f.invites.claim(invite.id, two.id)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected')[0].reason.status, 409);
  const owner = f.invites.get(invite.id).claimedAccountId;
  assert.equal(f.invites.authenticate(cookie(legacy), publicContext), null);
  await assert.rejects(() => f.invites.join(token, publicContext), { status: 403 });
  await assert.rejects(() => f.invites.setMember(invite.id, 'player_two'), { status: 409 });
  await assert.rejects(() => f.invites.setMember(invite.id, null), { status: 409 });
  const originalClaim = await f.invites.claim(invite.id, owner);
  await f.invites.claim(invite.id, owner);
  assert.equal(f.invites.get(invite.id).claimedAt, originalClaim.claimedAt);
  // An interruption after claim is closed to invite sessions; the owner can repair attachment.
  await assert.rejects(() => f.invites.issueAccountSession(owner, invite.id, owner === one.id ? 'discord' : 'google'), { status: 403 });
  await f.accounts.attachMembership(owner, { inviteId: invite.id, role: 'player', memberId: 'player_one' });
  await f.accounts.attachMembership(owner, { inviteId: invite.id, role: 'player', memberId: 'player_one' });
  assert.equal(f.accounts.get(owner).memberships.length, 1);
  await f.accounts.delete(owner);
  await f.restart();
  assert.equal(f.invites.get(invite.id).claimedAccountId, owner);
  await assert.rejects(() => f.invites.claim(invite.id, owner === one.id ? two.id : one.id), { status: 409 });
  await assert.rejects(() => f.invites.join(token, publicContext), { status: 403 });
});

test('account sessions are hashed, bounded, persistent, revocable and keep invite history actors', async t => {
  let at = Date.parse('2026-10-20T00:00:00Z');
  const f = await fixture(t, { signInMode: 'required', now: () => at });
  const a = await claim(f);
  const identity = f.invites.authenticate(cookie(a.session), publicContext);
  assert.equal(identity.kind, 'account');
  assert.equal(identity.admin, false);
  assert.equal(identity.memberId, 'player_one');
  assert.deepEqual(identity.account, { id: a.account.id, providers: ['discord'] });
  assert.deepEqual(identity.actor, { kind: 'invite', label: 'Player', inviteId: a.invite.id, memberId: 'player_one' });
  assert.equal(f.invites.active(identity, publicContext), true);
  const sessions = [a.session];
  for (let index = 0; index < 32; index++) { at++; sessions.push(await f.invites.issueAccountSession(a.account.id, a.invite.id, 'discord')); }
  assert.equal(f.invites.authenticate(cookie(sessions[0]), publicContext), null);
  assert.ok(f.invites.authenticate(cookie(sessions[1]), publicContext));
  const text = await readFile(path.join(f.dataDir, 'invites.json'), 'utf8');
  for (const secret of [a.session, a.token, f.masterToken]) assert.equal(text.includes(secret), false);
  assert.equal(JSON.parse(text).sessions.length, 32);
  assert.equal(JSON.parse(text).sessions.at(-1).tokenHash, digest(sessions.at(-1)));
  await f.restart();
  const active = f.invites.authenticate(cookie(sessions.at(-1)), publicContext);
  await f.invites.signOut(cookie(sessions.at(-1)));
  assert.equal(f.invites.active(active, publicContext), false);
  assert.equal(f.invites.authenticate(cookie(sessions.at(-1)), publicContext), null);
  assert.ok(f.invites.authenticate(cookie(sessions[1]), publicContext));
  await f.invites.revokeAccountSessions(a.account.id);
  assert.equal(f.invites.authenticate(cookie(sessions[1]), publicContext), null);
  const fresh = await f.invites.issueAccountSession(a.account.id, a.invite.id, 'discord');
  const beforeRevoke = f.invites.authenticate(cookie(fresh), publicContext);
  await f.invites.revoke(a.invite.id);
  assert.equal(f.invites.authenticate(cookie(fresh), publicContext), null);
  assert.equal(f.invites.active(beforeRevoke, publicContext), false);
  assert.equal(f.accounts.get(a.account.id).memberships.length, 1);
});

test('several memberships keep distinct players and removing a provider invalidates its sessions', async t => {
  const f = await fixture(t, { signInMode: 'optional' });
  const a = await claim(f);
  await f.accounts.linkIdentity(a.account.id, 'google', randomUUID());
  const { invite } = await f.invites.create({ label: 'Another player', memberId: 'player_two' });
  await f.invites.claim(invite.id, a.account.id);
  await f.accounts.attachMembership(a.account.id, { inviteId: invite.id, role: 'player', memberId: 'player_two' });
  const secondSession = await f.invites.issueAccountSession(a.account.id, invite.id, 'google');
  assert.equal(f.accounts.get(a.account.id).memberships.length, 2);
  assert.equal(f.invites.authenticate(cookie(a.session), publicContext).memberId, 'player_one');
  assert.equal(f.invites.authenticate(cookie(secondSession), publicContext).memberId, 'player_two');
  await f.accounts.unlinkIdentity(a.account.id, 'discord');
  assert.equal(f.invites.authenticate(cookie(a.session), publicContext), null);
  assert.ok(f.invites.authenticate(cookie(secondSession), publicContext));
  await f.accounts.delete(a.account.id);
  assert.equal(f.invites.authenticate(cookie(secondSession), publicContext), null);
});

test('account activity updates provider timestamps at one-minute intervals and sessions expire at 30 days', async t => {
  let at = Date.parse('2026-10-20T00:00:00Z');
  const f = await fixture(t, { signInMode: 'optional', now: () => at });
  const a = await claim(f), original = f.accounts.get(a.account.id).lastUsedAt;
  const identity = f.invites.authenticate(cookie(a.session), publicContext);
  at += 59999;
  await f.invites.touch(identity);
  assert.equal(f.accounts.get(a.account.id).lastUsedAt, original);
  at++;
  await f.invites.touch(identity);
  assert.equal(f.accounts.get(a.account.id).lastUsedAt, new Date(at).toISOString());
  assert.equal(f.accounts.get(a.account.id).identities[0].lastUsedAt, new Date(at).toISOString());
  await f.restart();
  assert.equal(f.accounts.get(a.account.id).lastUsedAt, new Date(at).toISOString());
  at = Date.parse(identity.expiresAt) - 1;
  assert.ok(f.invites.authenticate(cookie(a.session), publicContext));
  at++;
  assert.equal(f.invites.authenticate(cookie(a.session), publicContext), null);
  assert.equal(f.invites.active(identity, publicContext), false);
});

test('turning on required mode rejects existing anonymous player sessions but preserves viewers', async t => {
  const f = await fixture(t);
  const player = await f.invites.create({ label: 'Player', memberId: 'player_one' });
  const viewer = await f.invites.create({ label: 'Viewer', viewer: true });
  const playerSession = await f.invites.join(player.token, publicContext);
  const viewerSession = await f.invites.join(viewer.token, publicContext);
  const identity = f.invites.authenticate(cookie(playerSession), publicContext);
  await f.invites.close();
  const required = await openInviteStore({ dataDir: f.dataDir, masterToken: f.masterToken, masterLabel: 'Administrator', accounts: f.accounts, signInMode: 'required' });
  try {
    assert.equal(required.authenticate(cookie(playerSession), publicContext), null);
    assert.equal(required.active(identity, publicContext), false);
    assert.equal(required.authenticate(cookie(viewerSession), publicContext).readOnly, true);
  } finally { await required.close(); }
});

test('required mode blocks plain players while anonymous viewers and private administration remain available', async t => {
  const f = await fixture(t, { signInMode: 'required' });
  const player = await f.invites.create({ label: 'Player', memberId: 'player_one' });
  const viewer = await f.invites.create({ label: 'Viewer', viewer: true });
  const admin = await f.invites.create({ label: 'Administrator', admin: true });
  await assert.rejects(() => f.invites.join(player.token, publicContext), { status: 403 });
  await assert.rejects(() => f.invites.joinById(player.invite.id, publicContext), { status: 403 });
  const session = await f.invites.join(viewer.token, publicContext);
  assert.equal(f.invites.authenticate(cookie(session), publicContext).readOnly, true);
  assert.ok(await f.invites.joinById(viewer.invite.id, publicContext));
  assert.throws(() => f.invites.inspectToken(admin.token, publicContext), { status: 403 });
  assert.throws(() => f.invites.inspectToken(f.masterToken, publicContext), { status: 403 });
  assert.equal(f.invites.inspectToken(f.masterToken, privateContext), null);
  assert.equal(f.invites.inspectToken(player.token, publicContext).id, player.invite.id);
  assert.equal(Object.hasOwn(f.invites.inspectToken(player.token, publicContext), 'tokenHash'), false);
  const account = await f.accounts.ensureIdentity('discord', randomUUID());
  for (const invite of [viewer.invite, admin.invite]) await assert.rejects(() => f.invites.claim(invite.id, account.id), { status: 403 });
  assert.equal(f.invites.authenticate(cookie(await f.invites.join(admin.token, privateContext)), privateContext).admin, true);
  const master = await f.invites.join(f.masterToken, privateContext);
  assert.equal(f.invites.authenticate(cookie(master), privateContext).admin, true);
});

test('corrupt sidecars fail closed with generic errors and leave exact bytes untouched', async t => {
  const f = await fixture(t);
  await claim(f);
  await f.invites.close(); await f.accounts.close();
  for (const [name, openStore] of [['accounts.json', openAccountStore], ['invites.json', openInviteStore]]) {
    const file = path.join(f.dataDir, name), original = await readFile(file, 'utf8');
    const privateValue = randomUUID();
    for (const invalid of [`{"${privateValue}":`, JSON.stringify({ schemaVersion: 1, accounts: [{ subject: privateValue }] })]) {
      await writeFile(file, invalid);
      await assert.rejects(() => openStore({ dataDir: f.dataDir, masterLabel: 'Administrator' }), failure => {
        assert.match(failure.message, /^Invalid (?:account|invite) store\.$/);
        assert.equal(failure.message.includes(privateValue), false);
        return true;
      });
      assert.equal(await readFile(file, 'utf8'), invalid);
    }
    await writeFile(file, original);
  }
});
