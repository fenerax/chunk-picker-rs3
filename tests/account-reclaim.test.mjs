import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openRegistry, registryRecoveryDocument } from '../app/storage/registry.mjs';
import { reconcileTombstones } from '../app/storage/tombstones.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'account-reclaim-'));
  const options = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') };
  let clock = Date.now(), registry = await openRegistry({ ...options, now: () => clock });
  const target = await registry.firstLogin('discord', 'synthetic-target');
  await registry.unlinkIdentity(target.account.id, 'discord');
  const file = path.join(options.registryDir, 'registry.json'), ledger = path.join(options.tombstoneDir, 'ledger.json');
  const f = { root, options, target, file, ledger, get registry() { return registry; }, advance: ms => { clock += ms; },
    close: () => registry.close(), open: async () => { registry = await openRegistry(options); } };
  t.after(async () => { await registry.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}
async function unchanged(f, operation) {
  const before = await Promise.all([readFile(f.file), readFile(f.ledger)]);
  await assert.rejects(operation(), { status: 409 });
  assert.deepEqual(await Promise.all([readFile(f.file), readFile(f.ledger)]), before);
}

test('MP15 issue refuses missing, retired, deleted-picker and linked accounts', async t => {
  const f = await fixture(t), r = f.registry;
  await unchanged(f, () => r.issueRelinkCode(randomUUID()));
  await r.linkIdentity(f.target.account.id, 'discord', 'synthetic-target');
  await unchanged(f, () => r.issueRelinkCode(f.target.account.id));
  await r.unlinkIdentity(f.target.account.id, 'discord');
  await r.beginPickerDeletion(f.target.picker.id);
  await unchanged(f, () => r.issueRelinkCode(f.target.account.id));
  await r.deleteAccount(f.target.account.id);
  await unchanged(f, () => r.issueRelinkCode(f.target.account.id));
});

test('MP15 used, expired, revoked and malformed codes refuse without registry or ledger writes', async t => {
  const f = await fixture(t), r = f.registry;
  const first = await r.issueRelinkCode(f.target.account.id);
  const second = await r.issueRelinkCode(f.target.account.id);
  await unchanged(f, () => r.claimIdentity(first.code, 'discord', 'synthetic-player'));
  for (const value of ['', 'invalid', null]) await unchanged(f, () => r.claimIdentity(value, 'discord', 'synthetic-player'));
  f.advance(86400000);
  await unchanged(f, () => r.claimIdentity(second.code, 'discord', 'synthetic-player'));
  const third = await r.issueRelinkCode(f.target.account.id);
  assert.equal((await r.claimIdentity(third.code, 'discord', 'synthetic-player')).id, f.target.account.id);
  await unchanged(f, () => r.claimIdentity(third.code, 'discord', 'synthetic-player'));
});

test('MP15 target gaining an identity or being retired refuses without changes', async t => {
  const f = await fixture(t), r = f.registry;
  const issued = await r.issueRelinkCode(f.target.account.id);
  await r.linkIdentity(f.target.account.id, 'google', 'synthetic-other');
  await unchanged(f, () => r.claimIdentity(issued.code, 'discord', 'synthetic-player'));
  await r.deleteAccount(f.target.account.id);
  await unchanged(f, () => r.claimIdentity(issued.code, 'discord', 'synthetic-player'));
});

test('MP15 source with another membership or owned picker refuses without changes', async t => {
  const f = await fixture(t), r = f.registry;
  const source = await r.firstLogin('discord', 'synthetic-player');
  const issued = await r.issueRelinkCode(f.target.account.id);
  await r.attachMembership(source.account.id, { pickerId: f.target.picker.id, role: 'viewer', memberId: null });
  await unchanged(f, () => r.claimIdentity(issued.code, 'discord', 'synthetic-player', { emptyAccountId: source.account.id }));
  await r.removeMembership(source.account.id, f.target.picker.id, null);
  await f.close();
  const document = JSON.parse(await readFile(f.file));
  const id = 'p_' + randomUUID().replaceAll('-', '');
  document.pickers.push({ ...source.picker, id, lifecycle: 'deleted' });
  const ledger = JSON.parse(await readFile(f.ledger)); ledger.issuedPickerIds.push(id);
  ledger.pickers.push({ pickerId: id, lifecycle: 'deleted', deletingAt: new Date().toISOString(), deletedAt: new Date().toISOString() });
  await writeFile(f.file, JSON.stringify(document)); await writeFile(f.ledger, JSON.stringify(ledger)); await f.open();
  await unchanged(f, () => f.registry.claimIdentity(issued.code, 'discord', 'synthetic-player', { emptyAccountId: source.account.id }));
});

test('MP15 only hashes persist and service backups exclude claim credentials', async t => {
  const f = await fixture(t), issued = await f.registry.issueRelinkCode(f.target.account.id);
  assert.equal(Date.parse(issued.expiresAt) - Date.now() > 86300000, true);
  const bytes = await readFile(f.file, 'utf8');
  assert.equal(bytes.includes(issued.code), false);
  const document = registryRecoveryDocument(JSON.parse(bytes));
  assert.equal(Object.hasOwn(document, 'relinkCodes'), false);
  await f.close(); await f.open();
  const claimed = await f.registry.claimIdentity(issued.code, 'google', 'synthetic-player');
  assert.equal(claimed.id, f.target.account.id);
});

test('MP15 concurrent claims consume once and link exactly one identity', async t => {
  const f = await fixture(t), issued = await f.registry.issueRelinkCode(f.target.account.id);
  const results = await Promise.allSettled(['discord', 'google'].map(provider => f.registry.claimIdentity(issued.code, provider, 'synthetic-player')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal(f.registry.getAccount(f.target.account.id).identities.length, 1);
});

const childProgram = String.raw`
import { readFile } from 'node:fs/promises';
import { openRegistry } from './app/storage/registry.mjs';
import { reconcileTombstones } from './app/storage/tombstones.mjs';
const [file, step] = process.argv.slice(1), input = JSON.parse(await readFile(file));
const registry = await openRegistry({ ...input.options, crashPoint: name => { if (name === step) process.exit(86); } });
await registry.claimIdentity(input.code, 'discord', 'synthetic-player', { emptyAccountId: input.source });
await reconcileTombstones({ registry, revokeAccount: async () => {} });
await registry.close(); process.exit(1);
`;
const steps = ['relink-before-commit', 'relink-committed', 'relink-retired', 'relink-reconciled',
  ...['revoked', 'drained', 'directory-removed', 'binding-removed'].map(s => 'picker-purge-' + s), 'picker-deleted', 'picker-purge-complete', 'account-purge-complete'];
for (const step of steps) test(`MP15 process death at ${step} preserves one identity and recovers retirement`, async t => {
  const f = await fixture(t), source = await f.registry.firstLogin('discord', 'synthetic-player');
  const issued = await f.registry.issueRelinkCode(f.target.account.id);
  const input = path.join(f.root, 'input.json');
  await writeFile(input, JSON.stringify({ options: f.options, source: source.account.id, code: issued.code }), { mode: 0o600 });
  await f.close();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childProgram, input, step], { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'ignore' });
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 86);
  const raw = JSON.parse(await readFile(f.file));
  assert.equal(raw.accounts.flatMap(a => a.identities).filter(i => i.subject === 'synthetic-player').length, 1);
  await f.open();
  if (step === 'relink-before-commit') {
    assert.equal(f.registry.findIdentity('discord', 'synthetic-player').id, source.account.id);
    assert.equal(f.registry.isAccountDeleted(source.account.id), false);
    await f.registry.claimIdentity(issued.code, 'discord', 'synthetic-player', { emptyAccountId: source.account.id });
  }
  await reconcileTombstones({ registry: f.registry, revokeAccount: async () => {} });
  assert.equal(f.registry.findIdentity('discord', 'synthetic-player').id, f.target.account.id);
  assert.equal(f.registry.isAccountDeleted(source.account.id), true);
  assert.equal(f.registry.deletionRecords().accounts.find(a => a.accountId === source.account.id).purgeProgress, 'complete');
  await assert.rejects(readFile(path.join(f.options.pickerRoot, source.picker.id, 'state.json')), { code: 'ENOENT' });
  await unchanged(f, () => f.registry.claimIdentity(issued.code, 'discord', 'synthetic-player'));
  const fresh = await f.registry.firstLogin('google', 'synthetic-fresh');
  assert.notEqual(fresh.account.id, source.account.id); assert.notEqual(fresh.picker.id, source.picker.id);
});

test('MP15 stopped checkpoint refuses pending retirement until registry replay records the external ledger', async t => {
  const f = await fixture(t), source = await f.registry.firstLogin('discord', 'synthetic-player');
  const issued = await f.registry.issueRelinkCode(f.target.account.id);
  await f.close();
  const interrupted = await openRegistry({ ...f.options, crashPoint: name => { if (name === 'relink-committed') throw Error('Synthetic interruption'); } });
  try {
    await assert.rejects(interrupted.claimIdentity(issued.code, 'discord', 'synthetic-player', { emptyAccountId: source.account.id }), /Synthetic interruption/);
  } finally { await interrupted.close(); }
  const raw = await readFile(f.file), document = JSON.parse(raw);
  assert.equal(document.relinkRetirements.length, 1);
  assert.throws(() => registryRecoveryDocument(document), { status: 409 });
  assert.deepEqual(await readFile(f.file), raw);
  assert.equal(JSON.parse(await readFile(f.ledger)).accounts.length, 0);
  await f.open();
  assert.equal(f.registry.isAccountDeleted(source.account.id), true);
  const checkpoint = registryRecoveryDocument(JSON.parse(await readFile(f.file)));
  assert.equal(checkpoint.accounts.some(a => a.id === source.account.id), false);
  assert.equal(f.registry.deletionRecords().accounts.some(a => a.accountId === source.account.id), true);
});
