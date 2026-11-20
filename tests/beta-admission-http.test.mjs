// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, origin } from './helpers/picker-routing-fixture.mjs';
import { redactInviteFields } from '../app/picker-context-http.mjs';
import { redact } from '../scripts/test-timing-reporter.mjs';
import { snapshotPath } from '../app/storage/snapshot.mjs';

const cookie = response => response.headers['set-cookie'].filter(s => s.startsWith('__Host-rs3_preauth=')).at(-1).split(';')[0];
async function issue(f, input = {}) {
  const result = await f.private('/api/operator/beta-links', { body: { action: 'issue', ...input } });
  assert.equal(result.status, 200, result.text); return result.json();
}
async function exchange(f, link) {
  const page = await f.send('/auth/beta'); assert.equal(page.status, 200); assert.match(page.text, /\/auth\/beta.mjs/);
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  const response = await f.send('/auth/beta', null, { body: { secret: new URL(link).hash.slice(1) } });
  assert.equal(response.status, 200, response.text);
  assert.deepEqual(response.json(), { next: '/auth/beta/signin' });
  const continuation = cookie(response), signin = await f.send('/auth/beta/signin', continuation);
  assert.equal(signin.status, 200); assert.match(signin.text, /first map/); assert.equal(signin.text.includes(new URL(link).hash.slice(1)), false);
  return continuation;
}

for (const provider of ['discord', 'google']) test(`${provider}: unknown sign-in and direct callback cannot create an account or persist a subject`, async t => {
  const f = await fixture(t, { admission: undefined });
  const before = await f.registry(), callback = await f.begin('77001', undefined, `/auth/${provider}`);
  const refused = await callback(); assert.equal(refused.status, 403); assert.match(refused.text, /beta is invite-only/);
  assert.match(refused.text, /group owner/); assert.match(refused.text, /provider you linked/);
  assert.deepEqual(await f.registry(), before);
  assert.equal(JSON.stringify(await f.registry()).includes('77001'), false);
  const direct = await f.send(`/auth/${provider}/callback?state=synthetic&code=synthetic`);
  assert.equal(direct.status, 400); assert.deepEqual(await f.registry(), before);
  const query = await f.begin('77002', undefined, `/auth/${provider}?returnTo=https%3A%2F%2Fwrong.example%2Fauth%2Fbeta%23bet_${'a'.repeat(43)}`);
  assert.equal((await query()).status, 403); assert.deepEqual(await f.registry(), before);
});

test('beta link survives OAuth, admits once, and existing login plus second provider remain accessible', async t => {
  const f = await fixture(t, { admission: undefined }), issued = await issue(f);
  const continuation = await exchange(f, issued.link);
  const signedIn = await f.login('77010', continuation);
  const linked = await f.login('synthetic-google-linked', signedIn, '/auth/link/google');
  assert.ok(linked); assert.ok(await f.login('synthetic-google-linked', undefined, '/auth/google')); assert.ok(await f.login('77010'));
  const doc = await f.registry(); assert.equal(doc.accounts.length, 1); assert.equal(doc.accounts[0].identities.length, 2);
  assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
  const replay = await f.send('/auth/beta', null, { body: { secret: new URL(issued.link).hash.slice(1) } }); assert.equal(replay.status, 403);
  assert.deepEqual(await f.registry(), doc);
  await f.restart(); assert.ok(await f.login('77010'));
});

test('beta continuation survives provider cancellation and contains no secret in provider URLs', async t => {
  const f = await fixture(t, { admission: undefined }), issued = await issue(f), preauth = await exchange(f, issued.link);
  const start = await f.send('/auth/discord', preauth), destination = new URL(start.headers.location);
  assert.equal(start.headers.location.includes('bet_'), false);
  const cancelled = await f.send(`/auth/discord/callback?state=${destination.searchParams.get('state')}&error=access_denied`, cookie(start));
  assert.equal(cancelled.status, 400); assert.match(cancelled.text, /cancelled/);
  assert.ok(await f.login('77011', cookie(cancelled)));
});

test('expired, revoked, tampered, cross-origin and wrong-ingress beta exchanges cannot admit', async t => {
  let at = Date.parse('2026-01-01');
  const f = await fixture(t, { admission: undefined, now: () => at });
  const issued = await issue(f), secret = new URL(issued.link).hash.slice(1);
  const before = await f.registry();
  for (const headers of [{ Origin: 'https://wrong.example' }, { Origin: origin, Host: 'wrong.example' }, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.send('/auth/beta', null, { body: { secret }, headers })).status, 403);
  }
  assert.equal((await f.private('/api/operator/beta-links', { body: { action: 'revoke', id: issued.id } })).status, 200);
  assert.equal((await f.send('/auth/beta', null, { body: { secret } })).status, 403);
  assert.equal((await f.send('/auth/beta', null, { body: { secret: secret + 'tampered' } })).status, 403);
  const expired = await issue(f, { expiresInMs: 1 });
  at += 1;
  assert.equal((await f.send('/auth/beta', null, { body: { secret: new URL(expired.link).hash.slice(1) } })).status, 403);
  assert.deepEqual(await f.registry(), before);
  assert.equal((await f.send('/api/operator/beta-links', null, { body: { action: 'list' } })).status, 403);
});

test('beta expiry and revocation during provider consent are rechecked before persisting a subject', async t => {
  let at = Date.parse('2026-01-01');
  const f = await fixture(t, { admission: undefined, now: () => at });
  for (const state of ['expired', 'revoked']) {
    const issued = await issue(f, { expiresInMs: 100 }), continuation = await exchange(f, issued.link);
    const callback = await f.begin(state === 'expired' ? '77022' : '77023', continuation);
    if (state === 'expired') at += 100;
    else await f.private('/api/operator/beta-links', { body: { action: 'revoke', id: issued.id } });
    assert.equal((await callback()).status, 403);
    assert.equal((await f.registry()).accounts.length, 0);
  }
});

test('two OAuth callbacks holding the same beta link have one winner', async t => {
  const f = await fixture(t, { admission: undefined }), issued = await issue(f);
  const [one, two] = await Promise.all([exchange(f, issued.link), exchange(f, issued.link)]);
  const first = await f.begin('77020', one), second = await f.begin('77021', two);
  const results = await Promise.all([first(), second()]);
  assert.deepEqual(results.map(r => r.status).sort(), [303, 403]);
  const doc = await f.registry(); assert.equal(doc.accounts.length, 1); assert.equal(doc.pickers.filter(p => p.kind === 'default').length, 1);
});

test('a valid group invitation admits a newcomer; revoking it during OAuth refuses without a subject', async t => {
  const f = await fixture(t, { admission: undefined }), issued = await issue(f);
  const owner = await f.login('77030', await exchange(f, issued.link));
  const created = await f.send('/api/group-invites', owner, { body: {} }); assert.equal(created.status, 200, created.text);
  const invitation = created.json(), inviteLink = invitation.link;
  assert.ok(inviteLink, created.text);
  const visit = await f.send(new URL(inviteLink, origin).pathname);
  assert.equal(visit.status, 303); assert.equal(visit.headers.location, '/auth/group-invite');
  const newcomer = await f.login('77031', cookie(visit));
  assert.ok(newcomer); assert.equal((await f.registry()).accounts.length, 2);
  const visitTwo = await f.send(new URL(inviteLink, origin).pathname), callback = await f.begin('77032', cookie(visitTwo));
  const revoked = await f.send('/api/group-invites', owner, { body: { revokeId: invitation.id } }); assert.equal(revoked.status, 200, revoked.text);
  assert.equal((await callback()).status, 403);
  assert.equal((await f.registry()).accounts.some(a => a.identities.some(i => i.subject === '77032')), false);
});

test('sanitized service captures exclude beta store and credentials, and redaction covers copied beta links', async t => {
  const f = await fixture(t, { admission: undefined }), issued = await issue(f);
  const id = randomUUID(), result = await f.private('/api/operator/service-snapshot', { body: { id } });
  assert.equal(result.status, 200, result.text);
  const root = snapshotPath(path.join(f.root, 'legacy'), id), names = await readdir(root, { recursive: true });
  assert.equal(names.some(name => name.includes('beta-links')), false);
  const secret = new URL(issued.link).hash.slice(1);
  for (const file of ['registry.json', 'manifest.json']) assert.equal((await readFile(path.join(root, file), 'utf8')).includes(secret), false);
  assert.equal(JSON.stringify(redactInviteFields({ link: issued.link })).includes(secret), false);
  assert.equal(redact(issued.link).includes(secret), false);
});
