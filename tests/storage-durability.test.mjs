import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openInviteStore } from '../app/storage/invites.mjs';
import { openAccountStore } from '../app/storage/accounts.mjs';
import { gunzipSync } from 'node:zlib';
import { createGroupState, importBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { openPluginKeys } from '../app/plugin-keys.mjs';
import { writeRegistryJson, lockRegistry } from '../app/storage/registry-lock.mjs';

const root = fileURLToPath(new URL('../.local/durability-tests/', import.meta.url));
const firstDay = '2026-01-01T00:00:00.000Z', nextDay = '2026-01-02T00:00:00.000Z';
const questPoints = new Map();
const initialState = () => createGroupState([{ id: 'synthetic-player', name: 'Synthetic player' }]);
async function directory(t) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'save-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('fresh initialization includes daily observations without retaining an intermediate save', async t => {
  const dataDir = await directory(t);
  const store = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  t.after(() => store.close());
  assert.equal(store.getState().progressSnapshots.days.length, 1);
  assert.deepEqual(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')), store.getState());
  assert.deepEqual(await store.listBackups(), []);
});

test('catalogue refresh includes daily observations in one write backed by the exact original save', async t => {
  const dataDir = await directory(t);
  const initial = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  const original = initial.getState();
  await initial.close();
  const previous = await readFile(path.join(dataDir, 'state.json'));
  const loaded = await openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay,
    prepareState: state => ({ ...state, rules: { ...state.rules, 'access.shared': !state.rules['access.shared'] } }) });
  t.after(() => loaded.close());
  assert.equal(loaded.getState().revision, original.revision + 1);
  assert.equal(loaded.getState().progressSnapshots.days.length, 2);
  assert.equal(loaded.getState().history.at(-1).type, 'catalogue-refresh');
  assert.deepEqual(importBackup(await readFile(path.join(dataDir, 'state.json'), 'utf8')), loaded.getState());
  const backups = await loaded.listBackups();
  assert.equal(backups.length, 1);
  // Catalogue-refresh backups add retention metadata but preserve the full old state.
  assert.deepEqual((await loaded.readBackup(backups[0].id)).state, importBackup(previous.toString('utf8')));
});

test('startup retains the exact previous save before adding daily observations without a revision or format change', async t => {
  const dataDir = await directory(t);
  const initial = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  await initial.close();
  const file = path.join(dataDir, 'state.json'), previous = await readFile(file);
  const before = new Set(await readdir(path.join(dataDir, 'backups')));
  const loaded = await openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay });
  t.after(() => loaded.close());
  const added = (await readdir(path.join(dataDir, 'backups'))).filter(name => !before.has(name));
  assert.equal(added.length, 1);
  const retained = gunzipSync(await readFile(path.join(dataDir, 'backups', added[0])));
  assert.deepEqual(retained, previous);
  const oldDocument = JSON.parse(previous), newDocument = JSON.parse(await readFile(file));
  assert.equal(newDocument.format, oldDocument.format);
  assert.equal(newDocument.schemaVersion, oldDocument.schemaVersion);
  const oldState = importBackup(retained.toString('utf8')), newState = importBackup(newDocument);
  assert.equal(newState.progressSnapshots.days.length, 2);
  assert.equal(oldState.progressSnapshots.days.length, 1);
  assert.equal(newState.revision, oldState.revision);
  assert.deepEqual(newState.history, oldState.history);
  delete oldState.progressSnapshots; delete newState.progressSnapshots;
  assert.deepEqual(newState, oldState);
  assert((await loaded.listBackups()).some(backup => backup.id === added[0]));
  await loaded.close();
  // An unchanged observation must not add another backup or rewrite the save.
  const saved = await readFile(file), backups = await readdir(path.join(dataDir, 'backups'));
  const unchanged = await openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay });
  await unchanged.close();
  assert.deepEqual(await readFile(file), saved);
  assert.deepEqual(await readdir(path.join(dataDir, 'backups')), backups);
});

test('a startup observation leaves state.json untouched if retaining the previous save fails', async t => {
  const dataDir = await directory(t);
  const initial = await openStore({ dataDir, initialState: initialState(), progressQuestPoints: questPoints, now: firstDay });
  await initial.close();
  const file = path.join(dataDir, 'state.json'), previous = await readFile(file);
  const rename = fs.promises.rename, failure = Object.assign(new Error('Synthetic backup publication failure'), { code: 'ENOSPC' });
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (path.dirname(to) === path.join(dataDir, 'backups')) throw failure;
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(openStore({ dataDir, progressQuestPoints: questPoints, now: nextDay }), error => error === failure);
  assert.deepEqual(await readFile(file), previous);
  assert(!(await readdir(dataDir)).includes('store.lock'));
});

test('plugin key publication preserves hash-only credentials and revocation across reopen', async t => {
  const dataDir = await directory(t);
  const keys = await openPluginKeys({ dataDir });
  const { key, record } = await keys.create('synthetic-player', 'Synthetic plugin');
  const saved = await readFile(path.join(dataDir, 'plugin-keys.json'), 'utf8');
  assert(!saved.includes(key));
  assert.equal(keys.authenticate({ headers: { authorization: `Bearer ${key}` } }).id, record.id);
  await keys.revoke(record.id); await keys.close();
  const reopened = await openPluginKeys({ dataDir });
  t.after(() => reopened.close());
  assert.equal(reopened.list()[0].revoked, true);
  assert.throws(() => reopened.authenticate({ headers: { authorization: `Bearer ${key}` } }), { status: 401 });
});

test('registry JSON and its exclusive lock retain their shared publication API', async t => {
  const dataDir = await directory(t), file = path.join(dataDir, 'registry.json');
  const release = await lockRegistry(dataDir);
  try {
    const document = { schemaVersion: 1, entries: [] };
    await writeRegistryJson(file, document);
    assert.deepEqual(JSON.parse(await readFile(file)), document);
    await assert.rejects(lockRegistry(dataDir), { code: 'REGISTRY_LOCKED' });
  } finally { await release(); }
  const next = await lockRegistry(dataDir); await next();
});


// Inject the filesystem boundary while retaining real temporary writes and renames.
// The synthetic directory handle works on Windows too, where opening a directory
// normally fails before its sync method can be reached.
function publicationFailure(t, file, phase = 'directory-sync', onWarning = () => {}) {
  const failure = Object.assign(new Error('Synthetic private payload must never be logged'), { code: 'EIO' });
  const { open, rename } = fs.promises;
  let published = false, syncFailures = 0;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === file && phase === 'rename') throw failure;
    await rename(from, to);
    if (to === file) published = true;
  });
  t.mock.method(fs.promises, 'open', async (target, flags, ...options) => {
    if (target === path.dirname(file) && flags === 'r' && published && phase === 'directory-sync') {
      return { async sync() { syncFailures++; throw failure; }, async close() {} };
    }
    const handle = await open(target, flags, ...options);
    if (typeof target === 'string' && target.startsWith(file + '.') && flags === 'wx') {
      if (phase === 'temp-sync') t.mock.method(handle, 'sync', async () => { throw failure; });
      if (phase === 'temp-write') t.mock.method(handle, 'writeFile', async () => { throw failure; });
    }
    return handle;
  });
  const warnings = [];
  t.mock.method(console, 'warn', message => { warnings.push(message); onWarning(); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { failure, warnings, get syncFailures() { return syncFailures; } };
}

test('a backup post-rename sync failure stops the dependent state replacement', async t => {
  const dataDir = await directory(t), store = await openStore({ dataDir, initialState: initialState(), now: firstDay });
  t.after(() => store.close());
  const file = path.join(dataDir, 'state.json'), previous = await readFile(file), state = store.getState();
  const backupsDir = path.join(dataDir, 'backups'), { open, rename } = fs.promises;
  const failure = Object.assign(new Error('Synthetic backup sync failure'), { code: 'EIO' });
  let backupFile, syncFailures = 0;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    await rename(from, to);
    if (path.dirname(to) === backupsDir) backupFile = to;
  });
  t.mock.method(fs.promises, 'open', async (target, flags, ...options) => {
    if (backupFile && target === backupsDir && flags === 'r') {
      return { async sync() { syncFailures++; throw failure; }, async close() {} };
    }
    return open(target, flags, ...options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0), error => error === failure);
  assert.equal(syncFailures, 1);
  assert.deepEqual(gunzipSync(await readFile(backupFile)), previous);
  assert.deepEqual(await readFile(file), previous);
  assert.deepEqual(store.getState(), state);
  assert.equal(store.getInfo().durabilityWarnings, 0);
});

test('account membership sync failure rejects before a dependent invitation claim', async t => {
  const dataDir = await directory(t), accounts = await openAccountStore({ dataDir });
  t.after(() => accounts.close());
  const account = await accounts.ensureIdentity('discord', 'synthetic-account');
  const invites = await openInviteStore({ dataDir, accounts, masterLabel: 'Synthetic admin' });
  t.after(() => invites.close());
  const { invite } = await invites.create({ label: 'Synthetic player', memberId: 'synthetic-player' });
  const file = path.join(dataDir, 'accounts.json'), fault = publicationFailure(t, file);
  await assert.rejects((async () => {
    await accounts.attachMembership(account.id, { inviteId: invite.id, role: 'player', memberId: 'synthetic-player' });
    await invites.claim(invite.id, account.id);
  })(), error => error === fault.failure);
  assert.equal(JSON.parse(await readFile(file)).accounts[0].memberships.length, 1);
  assert.equal(accounts.get(account.id).memberships.length, 0);
  assert.equal(invites.get(invite.id).claimedAccountId, undefined);
  assert.equal(fault.syncFailures, 1);
  assert.deepEqual(fault.warnings, []);
});

test('post-rename folder sync failure adopts state, bytes and receipt before the next command', async t => {
  const dataDir = await directory(t);
  let executions = 0;
  const store = await openStore({ dataDir, initialState: initialState(), now: firstDay,
    world: { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() },
    beforeCommit: () => { executions++; } });
  t.after(() => store.close());
  const session = await store.openActionSession(randomUUID());
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const file = path.join(dataDir, 'state.json');
  const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
  const fault = publicationFailure(t, file, 'directory-sync', () => {
    // Warning is emitted only after in-memory state has caught up with rename.
    assert.equal(store.getState().revision, executions);
  });
  const result = await store.commandSerialized(command, 0, { requestId });
  const published = await readFile(file), document = JSON.parse(published);
  assert.equal(result.receipt.revision, 1);
  assert.equal(document.actionReceipts.slots[session.slot].receipt.requestId, requestId);
  const { fingerprint, ...diskReceipt } = document.actionReceipts.slots[session.slot].receipt;
  assert.deepEqual(result.receipt, diskReceipt);
  assert.deepEqual(store.getState(), importBackup(document));
  assert.equal(store.getInfo().durabilityWarnings, 1);
  assert(Number.isFinite(Date.parse(store.getInfo().lastDurabilityWarningAt)));
  assert.equal(fault.syncFailures, 1);

  // Both a stale-revision retry and a current-revision retry must replay A.
  for (const revision of [0, 1]) {
    const replay = await store.commandSerialized(command, revision, { requestId });
    assert.deepEqual(replay.receipt, result.receipt);
  }
  assert.equal(executions, 1);
  assert.deepEqual(await readFile(file), published);
  const next = await store.command({ ...command, value: true }, 1);
  assert.equal(next.revision, 2);
  assert.deepEqual(next, importBackup(await readFile(file, 'utf8')));
  assert.equal(executions, 2);
  const retained = (await readdir(path.join(dataDir, 'backups'))).find(name => name.startsWith('0000000000000001-'));
  assert(retained);
  assert.deepEqual(gunzipSync(await readFile(path.join(dataDir, 'backups', retained))), published);
  assert.equal(fault.warnings.length, 2);
  assert(fault.warnings.every(message => /published.*directory sync failed \(EIO\)/.test(message)));
  assert(!fault.warnings.join(' ').includes(fault.failure.message));
  assert.equal(store.getInfo().durabilityWarnings, 2);
});

for (const phase of ['temp-write', 'temp-sync', 'rename']) {
  test(`a ${phase} failure rejects without adopting state or a receipt`, async t => {
    const dataDir = await directory(t);
    const store = await openStore({ dataDir, initialState: initialState(), now: firstDay });
    t.after(() => store.close());
    const session = await store.openActionSession(randomUUID());
    const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
    const file = path.join(dataDir, 'state.json'), previous = await readFile(file), state = store.getState();
    const fault = publicationFailure(t, file, phase);
    const command = { type: 'set-rule', ruleId: 'access.shared', value: false };
    await assert.rejects(store.command(command, 0, { requestId }), error => error === fault.failure);
    assert.deepEqual(store.getState(), state);
    assert.deepEqual(await readFile(file), previous);
    assert.equal(await store.replayCommandSerialized(command, requestId), undefined);
    assert.equal(store.getInfo().durabilityWarnings, 0);
    assert.deepEqual(fault.warnings, []);
  });
}

test('invites adopt published credentials, sessions and revocation after folder sync failures', async t => {
  const dataDir = await directory(t);
  const invites = await openInviteStore({ dataDir, masterToken: 'synthetic-master', masterLabel: 'Synthetic admin' });
  t.after(() => invites.close());
  const file = path.join(dataDir, 'invites.json');
  const fault = publicationFailure(t, file, 'directory-sync', () => {
    assert.equal(invites.list().length, 1);
  });
  const { invite, token } = await invites.create({ label: 'Synthetic invite' });
  assert.equal(invites.inspectToken(token, {}).id, invite.id);
  const session = await invites.join(token, {});
  assert.equal(invites.authenticate({ headers: { cookie: `duo_access=${session}` } }, {}).inviteId, invite.id);
  await invites.revoke(invite.id);
  assert.equal(invites.authenticate({ headers: { cookie: `duo_access=${session}` } }, {}), null);
  const disk = JSON.parse(await readFile(file));
  assert.deepEqual(invites.list(), disk.invites.map(({ tokenHash, ...record }) => record));
  assert.deepEqual(disk.sessions, []);
  assert.equal(fault.syncFailures, 3);
  assert.equal(fault.warnings.length, 3);
  assert(fault.warnings.every(message => message.includes('invites: write published')));
  for (const secret of [token, session, 'synthetic-master', fault.failure.message]) assert(!fault.warnings.join(' ').includes(secret));
});

test('plugin keys adopt published credentials and revocation after folder sync failures', async t => {
  const dataDir = await directory(t), keys = await openPluginKeys({ dataDir });
  t.after(() => keys.close());
  const file = path.join(dataDir, 'plugin-keys.json');
  const fault = publicationFailure(t, file, 'directory-sync', () => { assert.equal(keys.list().length, 1); });
  const { key, record } = await keys.create('synthetic-player', 'Synthetic plugin');
  assert.equal(keys.authenticate({ headers: { authorization: `Bearer ${key}` } }).id, record.id);
  await keys.revoke(record.id);
  assert.throws(() => keys.authenticate({ headers: { authorization: `Bearer ${key}` } }), { status: 401 });
  const disk = JSON.parse(await readFile(file));
  assert.deepEqual(keys.list(), disk.keys.map(({ tokenHash, ...record }) => record));
  assert.equal(fault.syncFailures, 2);
  assert.equal(fault.warnings.length, 2);
  assert(fault.warnings.every(message => message.includes('plugin keys: write published')));
  assert(!fault.warnings.join(' ').includes(key));
  assert(!fault.warnings.join(' ').includes(fault.failure.message));
});

for (const kind of ['invites', 'plugin keys']) {
  test(`${kind} reject rename failure without changing memory or disk`, async t => {
    const dataDir = await directory(t);
    const store = kind === 'invites'
      ? await openInviteStore({ dataDir, masterToken: 'synthetic-master', masterLabel: 'Synthetic admin' })
      : await openPluginKeys({ dataDir });
    t.after(() => store.close());
    const create = () => kind === 'invites' ? store.create({ label: 'Synthetic invite' }) : store.create('synthetic-player', 'Synthetic plugin');
    await create();
    const file = path.join(dataDir, kind === 'invites' ? 'invites.json' : 'plugin-keys.json');
    const previous = await readFile(file), state = store.list(), fault = publicationFailure(t, file, 'rename');
    await assert.rejects(create(), error => error === fault.failure);
    assert.deepEqual(store.list(), state);
    assert.deepEqual(await readFile(file), previous);
    assert.deepEqual(fault.warnings, []);
  });
}
