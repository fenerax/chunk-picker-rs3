import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openRegistry, REGISTRY_PROVISION_POINTS } from '../app/storage/registry.mjs';
import { openRegistryBackend } from '../app/storage/registry-backend.mjs';
import { DatabaseSync, backup } from 'node:sqlite';
import { readLegacyAccounts } from '../app/storage/registry-legacy.mjs';

const moduleUrl = new URL('../app/storage/registry.mjs', import.meta.url).href;
const hash = text => createHash('sha256').update(text).digest('hex');
const json = async file => {
  if (!file.endsWith('.sqlite')) return JSON.parse(await readFile(file, 'utf8'));
  const storage = await openRegistryBackend({ registryDir: path.dirname(file), registryBackend: 'sqlite', readOnly: true });
  try { return storage.readView(); } finally { storage.close(); }
};
for (const registryBackend of ['json', 'sqlite']) {
const test = (name, ...args) => baseTest(`[${registryBackend}] ${name}`, ...args);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'picker-registry-test-'));
  const options = { registryBackend, registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') };
  let registry;
  const f = { root, options, file: path.join(options.registryDir, registryBackend === 'json' ? 'registry.json' : 'registry.sqlite'), ledger: path.join(options.tombstoneDir, 'ledger.json'),
    get registry() { return registry; },
    async capture() {
      if (registryBackend === 'json') return readFile(f.file);
      const db = new DatabaseSync(f.file, { readOnly: true }), target = path.join(root, 'checkpoint.sqlite');
      try { await backup(db, target); return await readFile(target); }
      finally { db.close(); await rm(target, { force: true }); }
    },
    async open(overrides = {}) { registry = await openRegistry({ ...options, ...overrides }); return registry; },
    async close() { await registry?.close(); registry = undefined; },
    async restart(overrides = {}) { await f.close(); return f.open(overrides); } };
  t.after(async () => { await f.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}
async function child(source) {
  const childProcess = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  childProcess.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
  childProcess.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  const [code, signal] = await once(childProcess, 'close');
  return { code, signal, stdout, stderr };
}
const childOpen = options => `import { openRegistry } from ${JSON.stringify(moduleUrl)}; const options = ${JSON.stringify(options)};`;
const purge = (f, id) => rm(path.join(f.options.pickerRoot, id), { recursive: true, force: true });
const capability = (login, kind = 'plugin-key', value = 'synthetic-key') => ({ kind, hash: hash(value), pickerId: login.picker.id, accountId: login.account.id, memberId: 'owner' });

test('parallel first login allocates one durable default with an ID-derived directory', async t => {
  const f = await fixture(t); await f.open();
  const logins = await Promise.all(Array.from({ length: 24 }, () => f.registry.firstLogin('discord', 'synthetic-login'))), first = logins[0];
  assert.match(first.picker.id, /^p_[0-9a-f]{32}$/);
  assert.equal(new Set(logins.map(l => l.picker.id)).size, 1); assert.equal(new Set(logins.map(l => l.account.id)).size, 1);
  assert.deepEqual(await readdir(f.options.pickerRoot), [first.picker.id]);
  assert.equal(f.registry.pickerDirectory(first.picker.id), path.join(f.options.pickerRoot, first.picker.id));
  assert.deepEqual(first.account.memberships, [{ pickerId: first.picker.id, role: 'owner', memberId: 'owner' }]);
  assert.deepEqual(first.picker.memberIds, ['owner']); assert.equal((await json(f.file)).pickers.length, 1);
  first.account.memberships.length = 0; await f.restart();
  assert.equal((await f.registry.firstLogin('discord', 'synthetic-login')).picker.id, first.picker.id);
  assert.equal(f.registry.findIdentity('discord', 'synthetic-login').memberships.length, 1);
  for (const invalid of ['../outside', 'p_' + 'A'.repeat(32), 'p_' + '0'.repeat(32) + '/../../x', 'owner']) assert.throws(() => f.registry.pickerDirectory(invalid), { status: 400 });
  assert.throws(() => f.registry.pickerDirectory('p_' + '0'.repeat(32)), { status: 404 });
  if (process.platform !== 'win32') assert.equal((await lstat(f.file)).mode & 0o777, 0o600);
});

test('linked providers share a default and conflicting identities never merge accounts', async t => {
  const f = await fixture(t); await f.open(); const first = await f.registry.firstLogin('discord', 'synthetic-one');
  await f.registry.linkIdentity(first.account.id, 'google', 'synthetic-linked');
  const linked = await f.registry.firstLogin('google', 'synthetic-linked');
  assert.equal(linked.account.id, first.account.id); assert.equal(linked.picker.id, first.picker.id);
  const other = await f.registry.ensureIdentity('google', 'synthetic-other');
  for (const [id, provider, subject] of [[first.account.id, 'google', 'synthetic-other'], [other.id, 'discord', 'synthetic-one'], [other.id, 'google', 'synthetic-third']]) await assert.rejects(f.registry.linkIdentity(id, provider, subject), { status: 409 });
  await assert.rejects(f.registry.ensureIdentity('unreviewed', 'synthetic'), /Invalid registry identity/);
  await f.registry.unlinkIdentity(first.account.id, 'discord'); await f.restart();
  assert.equal(f.registry.findIdentity('discord', 'synthetic-one'), null);
  assert.equal(f.registry.findIdentity('google', 'synthetic-linked').id, first.account.id);
});

for (const step of REGISTRY_PROVISION_POINTS) test(`process crash at ${step} resumes one default`, { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const result = await child(childOpen(f.options) + `
    const registry = await openRegistry({ ...options, crashPoint(name) { if (name === ${JSON.stringify(step)}) process.exit(86); } });
    await registry.firstLogin('discord', 'synthetic-crash'); process.exit(1);`);
  assert.equal(result.code, 86, result.stderr);
  const before = await json(f.file), issued = (await json(f.ledger)).issuedPickerIds;
  assert.equal(before.accounts.length, 1); assert.equal(issued.length, step === 'account-recorded' ? 0 : 1);
  const pendingId = before.accounts[0].defaultPickerId; await f.open();
  const login = await f.registry.firstLogin('discord', 'synthetic-crash');
  if (pendingId) assert.equal(login.picker.id, pendingId); else assert.notEqual(login.picker.id, issued[0]);
  assert.equal(login.picker.provisioning, 'ready'); assert.equal((await json(f.file)).pickers.length, 1);
  assert.deepEqual(await readdir(f.options.pickerRoot), [login.picker.id]);
  assert.deepEqual(await readdir(f.registry.pickerDirectory(login.picker.id)), []);
  await f.restart(); assert.equal((await f.registry.firstLogin('discord', 'synthetic-crash')).picker.id, login.picker.id);
});

test('two first-login processes serialize writers and select the same picker', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = childOpen(f.options) + `
    import { setTimeout as delay } from 'node:timers/promises'; let registry;
    for (let i = 0; i < 1000; i++) {
      try { registry = await openRegistry(options); break; }
      catch (failure) { if (failure.code !== 'REGISTRY_LOCKED') throw failure; await delay(10); }
    }
    if (!registry) throw new Error('Writer unavailable');
    try { console.log((await registry.firstLogin('google', 'synthetic-race')).picker.id); } finally { await registry.close(); }`;
  const results = await Promise.all([child(source), child(source)]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(results[0].stdout.trim(), results[1].stdout.trim());
  await f.open(); assert.equal(f.registry.listPickers().length, 1); assert.equal((await json(f.ledger)).issuedPickerIds.length, 1);
});

test('IDs survive deletion and checkpoint rollback without reuse', async t => {
  const f = await fixture(t), samples = [1, 1, 2, 1, 2, 3].map(n => Buffer.alloc(16, n));
  await f.open({ pickerRandomBytes: () => samples.shift() });
  const first = await f.registry.firstLogin('discord', 'synthetic-reuse'), oldCheckpoint = await f.capture();
  await assert.rejects(f.registry.completePickerDeletion(first.picker.id), { status: 409 });
  await f.registry.beginPickerDeletion(first.picker.id);
  await assert.rejects(f.registry.ensureDefaultPicker(first.account.id), { status: 409 });
  await assert.rejects(f.registry.completePickerDeletion(first.picker.id), { status: 409 });
  await purge(f, first.picker.id); await f.registry.completePickerDeletion(first.picker.id); await f.registry.completePickerDeletion(first.picker.id);
  assert.equal(f.registry.getPicker(first.picker.id).lifecycle, 'deleted');
  assert.equal((await f.registry.ensureDefaultPicker(first.account.id)).id, 'p_' + '02'.repeat(16));
  await f.close(); await writeFile(f.file, oldCheckpoint); await f.open({ pickerRandomBytes: () => samples.shift() });
  assert.equal(f.registry.getPicker(first.picker.id).lifecycle, 'deleted');
  assert.equal((await f.registry.ensureDefaultPicker(first.account.id)).id, 'p_' + '03'.repeat(16));
  assert.equal(new Set((await json(f.ledger)).issuedPickerIds).size, 3);
});

test('allocation skips surviving unregistered directories without adopting their contents', async t => {
  const f = await fixture(t), collision = path.join(f.options.pickerRoot, 'p_' + '01'.repeat(16));
  await mkdir(collision, { recursive: true }); await writeFile(path.join(collision, 'sentinel'), 'synthetic');
  const samples = [Buffer.alloc(16, 1), Buffer.alloc(16, 2)]; await f.open({ pickerRandomBytes: () => samples.shift() });
  assert.equal((await f.registry.firstLogin('google', 'synthetic-collision')).picker.id, 'p_' + '02'.repeat(16));
  assert.equal(await readFile(path.join(collision, 'sentinel'), 'utf8'), 'synthetic');
});

function legacyAccount(provider, subject, memberships) {
  const at = '2026-01-01T00:00:00.000Z';
  return { id: randomUUID(), createdAt: at, lastUsedAt: at, identities: [{ provider, subject, createdAt: at, lastUsedAt: at }],
    memberships: memberships.map(([role, memberId]) => { const id = randomUUID(); return { id, inviteId: id, role, memberId }; }) };
}
// Today's claim flow: player invitations are claimed by one account; view-only invitations never are.
function legacyInvites(accounts, edit = invite => invite) {
  const at = '2026-01-01T00:00:00.000Z';
  return { schemaVersion: 1, sessions: [], invites: accounts.flatMap(account => account.memberships.map(({ inviteId, role, memberId }) => edit({ id: inviteId, label: 'synthetic',
    admin: false, viewer: role === 'viewer', createdAt: at, lastUsedAt: null, revoked: false, tokenHash: hash(inviteId),
    ...(role === 'player' ? { memberId, claimedAccountId: account.id, claimedAt: at } : {}) }, account))) };
}
test('legacy import preserves permissions and data and leaves both default slots free', async t => {
  const f = await fixture(t), legacyDir = path.join(f.root, 'legacy'); await mkdir(legacyDir); f.options.legacyDir = legacyDir;
  const source = { schemaVersion: 1, accounts: [legacyAccount('discord', 'synthetic-legacy-a', [['player', 'alpha']]), legacyAccount('google', 'synthetic-legacy-b', [['player', 'beta'], ['viewer', null]])] };
  const accountsFile = path.join(legacyDir, 'accounts.json'), bytes = JSON.stringify(source);
  const invitesFile = path.join(legacyDir, 'invites.json'), inviteBytes = JSON.stringify(legacyInvites(source.accounts));
  await writeFile(accountsFile, bytes); await writeFile(invitesFile, inviteBytes); await writeFile(path.join(legacyDir, 'state.json'), 'synthetic-state'); const before = (await lstat(accountsFile)).mtimeMs;
  const plan = await readLegacyAccounts({ accountsFile, invitesFile, memberIds: ['alpha', 'beta'] }); await f.open();
  // A view-only invitation cannot be claimed today, so its membership grants nothing and is not imported.
  assert.equal(plan.droppedMemberships, 1); assert.deepEqual(plan.accounts[1].memberships, [{ role: 'player', memberId: 'beta' }]);
  const legacy = await f.registry.registerLegacy(plan);
  assert.equal(legacy.kind, 'legacy-shared'); assert.equal(f.registry.pickerDirectory(legacy.id), legacyDir);
  assert.equal((await f.registry.registerLegacy(plan)).id, legacy.id);
  for (const [i, a] of source.accounts.entries()) {
    assert.equal(f.registry.getAccount(a.id).defaultPickerId, null);
    assert.deepEqual(f.registry.getAccount(a.id).memberships.map(({ role, memberId }) => ({ role, memberId })), plan.accounts[i].memberships);
    assert.equal((await f.registry.ensureDefaultPicker(a.id)).kind, 'default');
  }
  await f.registry.removeMembership(source.accounts[0].id, legacy.id, 'alpha');
  await f.registry.deleteAccount(source.accounts[1].id); assert.equal(f.registry.getPicker(legacy.id).lifecycle, 'active');
  assert.equal(await readFile(accountsFile, 'utf8'), bytes); assert.equal((await lstat(accountsFile)).mtimeMs, before);
  assert.equal(await readFile(invitesFile, 'utf8'), inviteBytes);
  assert.equal(await readFile(path.join(legacyDir, 'state.json'), 'utf8'), 'synthetic-state');
  await f.restart(); assert.equal(f.registry.pickerDirectory(legacy.id), legacyDir);
});

test('legacy import refuses corruption, unknown members, role escalation and identity collisions', async t => {
  const f = await fixture(t), legacyDir = path.join(f.root, 'legacy'); await mkdir(legacyDir); f.options.legacyDir = legacyDir;
  const accountsFile = path.join(legacyDir, 'accounts.json'), invitesFile = path.join(legacyDir, 'invites.json');
  await writeFile(invitesFile, JSON.stringify(legacyInvites([])));
  for (const source of [null, { schemaVersion: 99, accounts: [] }, { schemaVersion: 1, accounts: [legacyAccount('discord', 'synthetic', [['owner', 'alpha']])] }, { schemaVersion: 1, accounts: [legacyAccount('discord', 'synthetic', [['player', 'outside']])] }]) {
    const bytes = source === null ? '{' : JSON.stringify(source); await writeFile(accountsFile, bytes);
    await assert.rejects(readLegacyAccounts({ accountsFile, invitesFile, memberIds: ['alpha', 'beta'] }), /Invalid legacy account import/);
    assert.equal(await readFile(accountsFile, 'utf8'), bytes);
  }
  await writeFile(accountsFile, JSON.stringify({ schemaVersion: 1, accounts: [] }));
  for (const invites of ['null', '{', JSON.stringify({ schemaVersion: 1, invites: [{ id: 'not-an-invite' }], sessions: [] })]) {
    await writeFile(invitesFile, invites);
    await assert.rejects(readLegacyAccounts({ accountsFile, invitesFile, memberIds: ['alpha', 'beta'] }), /Invalid legacy account import/);
  }
  await rm(invitesFile); await assert.rejects(readLegacyAccounts({ accountsFile, invitesFile, memberIds: ['alpha', 'beta'] }), { code: 'ENOENT' });
  await f.open(); await f.registry.ensureIdentity('discord', 'synthetic-conflict');
  await assert.rejects(f.registry.registerLegacy({ memberIds: ['alpha', 'beta'], accounts: [{ id: randomUUID(), identities: [{ provider: 'discord', subject: 'synthetic-conflict' }], memberships: [] }] }), { status: 409 });
  await assert.rejects(f.registry.registerLegacy({ memberIds: ['alpha', 'beta'], accounts: [{ id: randomUUID(), identities: [], memberships: [{ role: 'player', memberId: 'outside' }] }] }), /Invalid legacy registration/);
  assert.equal(f.registry.listPickers().length, 0); assert.equal((await json(f.ledger)).issuedPickerIds.length, 0);
});

test('legacy import keeps only memberships the invitation records still honour', async t => {
  const f = await fixture(t), legacyDir = path.join(f.root, 'legacy'); await mkdir(legacyDir); f.options.legacyDir = legacyDir;
  const kept = legacyAccount('discord', 'synthetic-kept', [['player', 'alpha']]), other = legacyAccount('google', 'synthetic-other', [['player', 'beta']]);
  const revoked = legacyAccount('discord', 'synthetic-revoked', [['player', 'alpha']]), unclaimed = legacyAccount('discord', 'synthetic-unclaimed', [['player', 'beta']]);
  const elsewhere = legacyAccount('google', 'synthetic-elsewhere', [['player', 'alpha']]), moved = legacyAccount('google', 'synthetic-moved', [['player', 'alpha']]);
  const missing = legacyAccount('discord', 'synthetic-missing', [['player', 'beta']]);
  const accounts = [kept, other, revoked, unclaimed, elsewhere, moved, missing];
  const invites = legacyInvites(accounts, (invite, account) => {
    if (account === revoked) return { ...invite, revoked: true };
    if (account === unclaimed) { const { claimedAccountId, claimedAt, ...rest } = invite; return rest; }
    if (account === elsewhere) return { ...invite, claimedAccountId: other.id };
    if (account === moved) return { ...invite, memberId: 'beta' };
    return invite;
  });
  invites.invites = invites.invites.filter(invite => invite.id !== missing.memberships[0].inviteId);
  const accountsFile = path.join(legacyDir, 'accounts.json'), invitesFile = path.join(legacyDir, 'invites.json');
  await writeFile(accountsFile, JSON.stringify({ schemaVersion: 1, accounts })); await writeFile(invitesFile, JSON.stringify(invites));
  const plan = await readLegacyAccounts({ accountsFile, invitesFile, memberIds: ['alpha', 'beta'] });
  assert.equal(plan.droppedMemberships, 5);
  assert.deepEqual(plan.accounts.map(account => account.memberships), [[{ role: 'player', memberId: 'alpha' }], [{ role: 'player', memberId: 'beta' }], [], [], [], [], []]);
  await f.open(); const legacy = await f.registry.registerLegacy(plan);
  for (const account of accounts.slice(2)) assert.equal(f.registry.getAccount(account.id).memberships.length, 0);
  assert.deepEqual(f.registry.getAccount(kept.id).memberships.map(({ pickerId, role, memberId }) => ({ pickerId, role, memberId })), [{ pickerId: legacy.id, role: 'player', memberId: 'alpha' }]);
});

test('capability index retains scope and revokes hashes with memberships', async t => {
  const f = await fixture(t); await f.open();
  const first = await f.registry.firstLogin('discord', 'synthetic-cap-a'), second = await f.registry.firstLogin('google', 'synthetic-cap-b');
  const plugin = capability(first), overlay = capability(first, 'overlay-capability');
  await f.registry.setCapability(plugin); await f.registry.setCapability(overlay); await f.registry.setCapability(plugin);
  assert.deepEqual(f.registry.resolveCapability(plugin.kind, plugin.hash), plugin); assert.deepEqual(f.registry.resolveCapability(overlay.kind, overlay.hash), overlay);
  await assert.rejects(f.registry.setCapability({ ...plugin, pickerId: second.picker.id, accountId: second.account.id }), { status: 409 });
  await assert.rejects(f.registry.setCapability({ ...plugin, hash: hash('synthetic-bad-member'), memberId: 'outside' }), /Invalid registry document/);
  await assert.rejects(f.registry.setCapability({ ...plugin, hash: 'raw-secret' }), { status: 400 });
  for (const invalid of [null, '', 'z'.repeat(64)]) assert.equal(f.registry.resolveCapability('plugin-key', invalid), null);
  await f.restart(); assert.deepEqual(f.registry.resolveCapability(plugin.kind, plugin.hash), plugin);
  const detached = f.registry.resolveCapability(plugin.kind, plugin.hash); detached.memberId = 'outside'; assert.equal(f.registry.resolveCapability(plugin.kind, plugin.hash).memberId, 'owner');
  await f.registry.revokeCapability(plugin.kind, plugin.hash); assert.equal(f.registry.resolveCapability(plugin.kind, plugin.hash), null);
  await f.registry.attachMembership(second.account.id, { pickerId: first.picker.id, role: 'viewer', memberId: null });
  const viewer = { ...overlay, hash: hash('synthetic-viewer'), accountId: second.account.id, memberId: null }; await f.registry.setCapability(viewer);
  await assert.rejects(f.registry.setCapability({ ...viewer, kind: 'plugin-key' }), /Invalid registry document/);
  await f.registry.removeMembership(second.account.id, first.picker.id, null); assert.equal(f.registry.resolveCapability(viewer.kind, viewer.hash), null);
  await assert.rejects(f.registry.attachMembership(second.account.id, { pickerId: first.picker.id, role: 'owner', memberId: 'owner' }), { status: 400 });
});

test('tombstones reconcile restored accounts, memberships and capabilities before exposure', async t => {
  const f = await fixture(t); await f.open();
  const first = await f.registry.firstLogin('discord', 'synthetic-restore-a'), second = await f.registry.firstLogin('google', 'synthetic-restore-b');
  const a = capability(first), b = capability(second, 'overlay-capability', 'synthetic-other-key');
  await f.registry.setCapability(a); await f.registry.setCapability(b);
  await f.registry.attachMembership(second.account.id, { pickerId: first.picker.id, role: 'player', memberId: 'owner' }); const checkpoint = await f.capture();
  await f.registry.deleteAccount(first.account.id);
  assert.equal(f.registry.getAccount(first.account.id), null); assert.equal(f.registry.resolveCapability(a.kind, a.hash), null);
  assert.equal(f.registry.getPicker(first.picker.id).lifecycle, 'deleting');
  await purge(f, first.picker.id); await f.registry.completePickerDeletion(first.picker.id);
  await f.close(); await writeFile(f.file, checkpoint); await f.open();
  assert.equal(f.registry.getAccount(first.account.id), null); assert.equal(f.registry.findIdentity('discord', 'synthetic-restore-a'), null);
  assert.equal(f.registry.resolveCapability(a.kind, a.hash), null); assert.deepEqual(f.registry.resolveCapability(b.kind, b.hash), b);
  assert.equal(f.registry.getPicker(first.picker.id).lifecycle, 'deleted'); assert.equal(f.registry.getAccount(second.account.id).memberships.length, 1);
  assert.deepEqual(await f.registry.reconcileTombstones(), { blockedPickerIds: [first.picker.id], deletedAccountIds: [first.account.id] });
  assert.deepEqual(await f.registry.reconcileTombstones(), { blockedPickerIds: [first.picker.id], deletedAccountIds: [first.account.id] });
  assert.equal((await json(f.file)).accounts.length, 1);
});

for (const step of ['picker-tombstoned', 'picker-deleted', 'account-tombstoned']) test(`process crash at ${step} cannot resurrect credentials`, { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.open(); const login = await f.registry.firstLogin('google', 'synthetic-delete-crash');
  const key = capability(login); await f.registry.setCapability(key);
  if (step === 'picker-deleted') { await f.registry.beginPickerDeletion(login.picker.id); await purge(f, login.picker.id); } await f.close();
  const operation = step === 'account-tombstoned' ? `registry.deleteAccount(${JSON.stringify(login.account.id)})`
    : step === 'picker-deleted' ? `registry.completePickerDeletion(${JSON.stringify(login.picker.id)})` : `registry.beginPickerDeletion(${JSON.stringify(login.picker.id)})`;
  const result = await child(childOpen(f.options) + `const registry = await openRegistry({ ...options, crashPoint(name) { if (name === ${JSON.stringify(step)}) process.exit(86); } }); await ${operation}; process.exit(1);`);
  assert.equal(result.code, 86, result.stderr); await f.open(); assert.equal(f.registry.resolveCapability(key.kind, key.hash), null);
  assert.equal(f.registry.getPicker(login.picker.id).lifecycle, step === 'picker-deleted' ? 'deleted' : 'deleting');
  if (step === 'account-tombstoned') assert.equal(f.registry.getAccount(login.account.id), null); else assert.equal(f.registry.getAccount(login.account.id).memberships.length, 0);
});

test('tombstones block capabilities before registry cleanup finishes', async t => {
  let observed;
  const f = await fixture(t); await f.open({ crashPoint(name) { if (name === 'picker-tombstoned') observed = f.registry.resolveCapability('plugin-key', hash('synthetic-key')); } });
  const login = await f.registry.firstLogin('discord', 'synthetic-interval'); await f.registry.setCapability(capability(login));
  await f.registry.beginPickerDeletion(login.picker.id); assert.equal(observed, null);
});

test('writer locks contend across instances, processes and shared ledger roots', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.open(); await assert.rejects(openRegistry(f.options), { code: 'REGISTRY_LOCKED' });
  await assert.rejects(openRegistry({ ...f.options, registryDir: path.join(f.root, 'other-registry') }), { code: 'REGISTRY_LOCKED' });
  const result = await child(childOpen(f.options) + `try { await openRegistry(options); process.exit(1); } catch (failure) { process.exit(failure.code === 'REGISTRY_LOCKED' ? 0 : 2); }`); assert.equal(result.code, 0, result.stderr);
  const pending = f.registry.firstLogin('google', 'synthetic-close-drain'), close = f.registry.close(); await pending; await close; await close;
  await assert.rejects(f.registry.firstLogin('google', 'synthetic-after-close'), /closed/); await f.open(); assert.equal(f.registry.listPickers().length, 1);
});

test('foreign, malformed and live owner files fail closed and preserve their bytes', async t => {
  const f = await fixture(t); await f.open(); await f.close(); const file = path.join(f.options.registryDir, 'registry.lock');
  for (const bytes of ['{', JSON.stringify({ pid: process.pid, host: hostname() }), JSON.stringify({ pid: 2147483647, host: 'synthetic-foreign-host' })]) {
    await writeFile(file, bytes); await assert.rejects(f.open(), { code: 'REGISTRY_LOCKED' }); assert.equal(await readFile(file, 'utf8'), bytes); await rm(file);
  } await f.open();
});

test('configured caps refuse writes without losing data or consuming a default slot', async t => {
  const f = await fixture(t); await f.open({ caps: { accounts: 2, pickers: 1, capabilities: 1, capabilitiesPerPicker: 1 } });
  const first = await f.registry.firstLogin('discord', 'synthetic-limits-a'), second = await f.registry.ensureIdentity('google', 'synthetic-limits-b');
  await assert.rejects(f.registry.ensureIdentity('discord', 'synthetic-limits-c'), { status: 409 });
  await assert.rejects(f.registry.ensureDefaultPicker(second.id), { status: 409 }); assert.equal(f.registry.getAccount(second.id).defaultPickerId, null);
  assert.equal((await json(f.ledger)).issuedPickerIds.length, 1); await f.registry.setCapability(capability(first));
  await assert.rejects(f.registry.setCapability(capability(first, 'overlay-capability')), { status: 409 }); assert.ok(f.registry.resolveCapability('plugin-key', hash('synthetic-key')));
  await f.restart({ caps: { issuedPickerIds: 1 } });
  await f.registry.beginPickerDeletion(first.picker.id); await purge(f, first.picker.id); await f.registry.completePickerDeletion(first.picker.id);
  await assert.rejects(f.registry.ensureDefaultPicker(second.id), { status: 409 }); assert.equal(f.registry.getAccount(second.id).defaultPickerId, null);
});

test('corrupt registry and ledger fail closed without rewriting bytes or leaking contents', async t => {
  const f = await fixture(t); await f.open(); await f.registry.firstLogin('google', 'synthetic-corruption'); await f.close();
  for (const file of [f.file, f.ledger]) {
    const original = await readFile(file);
    for (const bytes of ['{"synthetic-secret":', JSON.stringify({ schemaVersion: 99, accounts: [] }), 'null\n']) {
      await writeFile(file, bytes); await assert.rejects(f.open(), failure => { assert.equal(failure.message.includes('synthetic-secret'), false); return true; }); assert.equal(await readFile(file, 'utf8'), bytes);
    } await writeFile(file, original);
  }
  const ledger = await readFile(f.ledger); await rm(f.ledger); await assert.rejects(f.open(), /ledger is missing/); await writeFile(f.ledger, ledger);
  await f.open(); assert.equal(f.registry.listPickers().length, 1);
});

test('roots cannot overlap and pending directories cannot escape through symlinks', async t => {
  const f = await fixture(t);
  await assert.rejects(openRegistry({ ...f.options, tombstoneDir: f.options.registryDir }), /disjoint/);
  await assert.rejects(openRegistry({ ...f.options, tombstoneDir: path.join(f.options.pickerRoot, 'ledger') }), /disjoint/);
  await assert.rejects(openRegistry({ ...f.options, tombstoneDir: path.parse(f.root).root }), /disjoint/);
  await assert.rejects(openRegistry({ ...f.options, caps: { accounts: 0 } }), /caps/);
  if (process.platform === 'win32') return;
  await f.open({ crashPoint(name) { if (name === 'registry-reserved') throw new Error('synthetic crash'); } });
  await assert.rejects(f.registry.firstLogin('discord', 'synthetic-symlink'), /synthetic crash/); assert.throws(() => f.registry.listPickers(), /restart/); await f.close();
  const id = (await json(f.file)).pickers[0].id, target = path.join(f.root, 'outside'); await mkdir(target); await symlink(target, path.join(f.options.pickerRoot, id), 'dir');
  await assert.rejects(f.open(), /Unsafe picker directory/); assert.deepEqual(await readdir(target), []);
});

}
