// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openRegistry } from '../app/storage/registry.mjs';
import { admissionMode, BETA_LINK_FILE, createBetaLinks } from '../app/storage/beta-links.mjs';
import { assertOperatorService } from '../scripts/linux/runtime.mjs';
import { runBetaLinkCommand } from '../scripts/linux/beta-link-operator.mjs';

const DAY = 86400000;
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'beta-links-'));
  const options = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger'), admission: 'invite-only', ...overrides };
  let registry = await openRegistry(options);
  t.after(async () => { await registry.close(); assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true }); });
  return { options, get registry() { return registry; }, restart: async extra => { await registry.close(); registry = await openRegistry({ ...options, ...extra }); },
    store: async () => JSON.parse(await readFile(path.join(options.registryDir, BETA_LINK_FILE))) };
}

test('admission config defaults closed, validates values, and requires matching operator/release policies', () => {
  assert.equal(admissionMode({}), 'invite-only');
  for (const admission of [null, false, '', 'public', 1]) assert.throws(() => admissionMode({ admission }), /admission/);
  const multiPicker = { registryDir: '/registry', pickerRoot: '/pickers', tombstoneDir: '/ledger' };
  assertOperatorService({ multiPicker }, { config: { multiPicker: { ...multiPicker, admission: 'invite-only' } } });
  assert.throws(() => assertOperatorService({ multiPicker }, { config: { multiPicker: { ...multiPicker, admission: 'open' } } }), /admission/);
});

test('unknown subjects need a link; expiry, revocation and tampering create no account or issued ID', async t => {
  let at = Date.parse('2026-01-01');
  const f = await fixture(t, { now: () => at });
  const before = f.registry.listAccounts();
  const expired = await f.registry.issueBetaLink({ expiresInMs: 10 }), revoked = await f.registry.issueBetaLink();
  await f.registry.revokeBetaLink(revoked.id); at += 10;
  for (const betaSecret of [undefined, expired.secret, revoked.secret, 'bet_' + 'a'.repeat(43), expired.secret + 'x']) {
    await assert.rejects(f.registry.firstLogin('discord', 'synthetic-denied', { betaSecret }), { status: 403 });
    assert.equal(f.registry.findIdentity('discord', 'synthetic-denied'), null);
    assert.deepEqual(f.registry.listAccounts(), before); assert.equal(f.registry.listPickers().length, 0);
  }
  const ledger = JSON.parse(await readFile(path.join(f.options.tombstoneDir, 'ledger.json')));
  assert.deepEqual(ledger.issuedPickerIds, []); assert.deepEqual(ledger.issuedCharacterIds, []);
});

test('one beta link has one concurrent winner and stores only a hash; existing login and linking need no link', async t => {
  const f = await fixture(t), link = await f.registry.issueBetaLink({ label: 'Synthetic reviewer' });
  const results = await Promise.allSettled(['synthetic-one', 'synthetic-two'].map(subject => f.registry.firstLogin('discord', subject, { betaSecret: link.secret })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const account = results.find(r => r.status === 'fulfilled').value.account;
  assert.equal(f.registry.listAccounts().length, 1); assert.equal(f.registry.listPickers().length, 1);
  const store = await f.store(), record = store.links[0];
  assert.equal(store.schemaVersion, 1); assert.equal(record.status, 'consumed');
  assert.equal(record.secretHash, createHash('sha256').update(link.secret).digest('hex'));
  assert.equal(JSON.stringify(store).includes(link.secret), false);
  await assert.rejects(f.registry.firstLogin('google', 'synthetic-replay', { betaSecret: link.secret }), { status: 403 });
  await f.restart();
  assert.equal((await f.registry.firstLogin('discord', account.identities[0].subject)).account.id, account.id);
  await f.registry.linkIdentity(account.id, 'google', 'synthetic-linked');
  assert.equal((await f.registry.firstLogin('google', 'synthetic-linked')).account.id, account.id);
});

for (const seam of ['beta-link-intent', 'beta-link-login', 'beta-link-consumed']) test(`interruption at ${seam} preserves the seat or committed login`, async t => {
  let armed = false;
  const f = await fixture(t, { crashPoint: name => { if (armed && name === seam) throw Error('Synthetic interruption'); } });
  const link = await f.registry.issueBetaLink(); armed = true;
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-recover', { betaSecret: link.secret }), /Synthetic interruption/);
  await f.restart({ crashPoint: undefined });
  const committed = seam !== 'beta-link-intent';
  assert.equal(Boolean(f.registry.findIdentity('discord', 'synthetic-recover')), committed);
  assert.equal((await f.registry.listBetaLinks())[0].status, committed ? 'consumed' : 'pending');
  const result = await f.registry.firstLogin('discord', 'synthetic-recover', committed ? {} : { betaSecret: link.secret });
  assert.ok(result.picker); assert.equal(f.registry.listAccounts().length, 1);
  await assert.rejects(f.registry.firstLogin('google', 'synthetic-other', { betaSecret: link.secret }), { status: 403 });
});

test('cap refusal keeps the next link usable and consumed links retain their picker allocation', async t => {
  const f = await fixture(t, { betaPickerCap: 1 });
  const one = await f.registry.issueBetaLink(), two = await f.registry.issueBetaLink();
  const first = await f.registry.firstLogin('discord', 'synthetic-cap-one', { betaSecret: one.secret });
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-cap-two', { betaSecret: two.secret }), /beta is full/);
  assert.equal(f.registry.findIdentity('discord', 'synthetic-cap-two'), null);
  assert.equal((await f.registry.listBetaLinks()).find(i => i.id === two.id).status, 'pending');
  assert.equal((await f.registry.firstLogin('discord', 'synthetic-cap-one')).picker.id, first.picker.id);
  await f.restart();
  await assert.rejects(f.registry.firstLogin('google', 'synthetic-cap-two', { betaSecret: two.secret }), /beta is full/);
});

test('operator issue/list/revoke use the registry owner and never redisclose secrets', async t => {
  let at = Date.parse('2026-01-01');
  const f = await fixture(t, { now: () => at });
  const command = input => runBetaLinkCommand({ registry: f.registry, origin: 'https://picker.example', ...input });
  const issued = await command({ command: 'beta-link-issue', argument: 'Synthetic group', expiryDays: '3' });
  assert.match(issued.link, /^https:\/\/picker\.example\/auth\/beta#bet_[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(issued.expiresAt) - at, 3 * DAY);
  const secret = new URL(issued.link).hash.slice(1);
  assert.equal(JSON.stringify(await command({ command: 'beta-link-list' })).includes(secret), false);
  assert.equal((await command({ command: 'beta-link-revoke', argument: issued.id })).status, 'revoked');
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-revoked', { betaSecret: secret }), { status: 403 });
  for (const expiryDays of ['0', '-1', '1.5', 'bad']) await assert.rejects(command({ command: 'beta-link-issue', expiryDays }), /Expiry/);
  await assert.rejects(command({ command: 'beta-link-issue', origin: 'https://wrong.example/path' }), /origin/);
  const calls = [];
  await runBetaLinkCommand({ command: 'beta-link-issue', argument: 'Synthetic reviewer', perform: async body => { calls.push(body); } });
  assert.deepEqual(calls, [{ action: 'issue', label: 'Synthetic reviewer' }]);
  const defaultLink = await f.registry.issueBetaLink(); assert.equal(Date.parse(defaultLink.expiresAt) - at, 14 * DAY);
  at += 45 * DAY; await f.restart(); assert.deepEqual(await f.registry.listBetaLinks(), []);
});

test('beta store fails closed on corruption and refuses its bounded record ceiling', async t => {
  const f = await fixture(t), link = await f.registry.issueBetaLink();
  const doc = await f.store();
  for (const mutate of [d => { d.schemaVersion = 2; }, d => { d.links[0].secretHash = link.secret; }, d => { d.links[0].status = 'unknown'; }]) {
    const bad = structuredClone(doc); mutate(bad);
    assert.throws(() => createBetaLinks({ file: '', document: bad, now: () => 0 }), /Invalid beta/);
  }
  const rows = Array.from({ length: 20000 }, (_, n) => ({ ...doc.links[0], id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, secretHash: createHash('sha256').update(String(n)).digest('hex') }));
  const full = createBetaLinks({ file: '', document: { schemaVersion: 1, links: rows }, now: () => Date.parse(doc.links[0].createdAt) });
  await assert.rejects(full.issue(), /limit/);
  await writeFile(path.join(f.options.registryDir, BETA_LINK_FILE), '{broken');
  await assert.rejects(f.restart(), /Invalid registry document/);
});
