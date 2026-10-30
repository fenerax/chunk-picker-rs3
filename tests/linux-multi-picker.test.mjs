import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chown, copyFile, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { withDirectoryBarriers, withStoreWrite, snapshotStore, snapshotPath } from '../app/storage/snapshot.mjs';
import { openRegistry } from '../app/storage/registry.mjs';
import { createPickerCheckpoint } from '../app/picker-router-checkpoint.mjs';
import { captureServiceCheckpoint, verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { restoreServiceStopped, listServicePickers, releaseServiceQuarantine, reconcileServiceRecoveryTombstones } from '../scripts/linux/service-recovery.mjs';
import { atomic, encode, inventory, json, sha } from '../scripts/linux/files.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { assertServiceStopped, repairServiceOwnership, serviceBackup } from '../scripts/linux/service-operator.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';

process.env.RS3_DATASET = 'open-starter';
const { createGroupState, exportBackup } = await import('../app/core/state.mjs');
const { createServer } = await import('../app/server.mjs');
const { resolveDataset } = await import('../app/datasets.mjs');
const { bindDatasetStorage } = await import('../app/dataset-binding.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const dataset = await resolveDataset({ datasetId: 'open-starter' });
const reconcile = async () => {};
const stopped = async () => {};

// Recovery checks an immutable release. Other full-suite tests create temporary
// directories in the checkout, so pin an independent tracked-file release copy.
const releaseRoot = await mkdtemp(path.join(tmpdir(), 'linux-multi-release-'));
after(() => rm(releaseRoot, { recursive: true, force: true }));
for (const file of execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean)) {
  const target = path.join(releaseRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.resolve(file), target);
}

async function fixture(t, count = 2) {
  const root = await mkdtemp(path.join(tmpdir(), 'linux-multi-picker-'));
  const settings = { dataDir: path.join(root, 'legacy'), controlDir: path.join(root, 'control'),
    backupDir: path.join(root, 'backups'), scratchRoot: path.join(root, 'scratch'), minFreeBytes: 0,
    multiPicker: { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') } };
  await mkdir(settings.dataDir); await mkdir(settings.controlDir);
  let registry = await openRegistry({ ...settings.multiPicker, legacyDir: settings.dataDir });
  const legacy = await registry.registerLegacy({ memberIds: ['one', 'two'], accounts: [], droppedMemberships: 0 });
  const pickers = [legacy];
  for (let index = 0; index < count; index++) pickers.push((await registry.firstLogin('discord', 'synthetic-' + index)).picker);
  for (const picker of pickers) {
    const dir = registry.pickerDirectory(picker.id);
    await writeFile(path.join(dir, 'state.json'), encode(exportBackup(createGroupState(picker.memberIds.map((id, index) => ({ id, name: 'Player ' + (index + 1) }))))));
    await bindDatasetStorage(dir, dataset);
    for (const name of ['accounts.json', 'invites.json', 'access-token', 'overlays.json', 'future-secret.json']) await writeFile(path.join(dir, name), 'synthetic-private-credential');
    // MP7 limits parse each active picker's plugin keys at startup.
    await writeFile(path.join(dir, 'plugin-keys.json'), encode({ keys: [], note: 'synthetic-private-credential' }));
  }
  const config = { coreRoot: releaseRoot, dataDir: settings.dataDir, datasetId: 'open-starter', host: '127.0.0.1', port: 0, loopbackPort: 1, multiPicker: settings.multiPicker };
  const configFile = path.join(root, 'config.json'); await writeFile(configFile, encode(config));
  const pointerFile = path.join(root, 'current.json'); await writeFile(pointerFile, encode({ config: { path: configFile, sha256: sha(encode(config)) } }));
  const release = await readRelease(pointerFile, settings.dataDir);
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); await registry?.close(); await rm(root, { recursive: true, force: true }); await rm(settings.dataDir + '.snapshots', { recursive: true, force: true }); });
  const close = async () => { await registry?.close(); registry = null; };
  const dir = picker => picker.kind === 'legacy-shared' ? settings.dataDir : path.join(settings.multiPicker.pickerRoot, picker.id);
  const capture = async () => { const id = randomUUID(); await captureServiceCheckpoint({ settings, registry, id, minFreeBytes: 0 }); return snapshotPath(settings.dataDir, id); };
  const target = async () => {
    const dest = path.join(root, 'recovered'); await mkdir(dest);
    const next = { ...settings, dataDir: path.join(dest, 'legacy'), controlDir: path.join(dest, 'control'), backupDir: path.join(dest, 'backups'), scratchRoot: path.join(dest, 'scratch'),
      multiPicker: { registryDir: path.join(dest, 'registry'), pickerRoot: path.join(dest, 'pickers'), tombstoneDir: settings.multiPicker.tombstoneDir } };
    return next;
  };
  return { root, settings, registry, pickers, release, dir, capture, close, target, cleanup: work => cleanups.push(work) };
}
const portableProbe = async (_release, dir) => {
  const document = await json(path.join(dir, 'state.json'));
  if (document.format !== 'rs3-chunk-picker') throw new Error('Incompatible synthetic picker.');
  return document;
};

test('per-picker checkpoints capture complete real writes while other stores keep moving', async t => {
  const f = await fixture(t), stores = [], started = [], finish = Promise.withResolvers();
  for (const picker of f.pickers.slice(1)) {
    const ready = Promise.withResolvers(); started.push(ready.promise);
    const dir = f.dir(picker);
    // Replace synthetic credentials before asking a real store decoder to open.
    for (const name of ['accounts.json', 'invites.json', 'plugin-keys.json', 'access-token', 'overlays.json', 'future-secret.json']) await rm(path.join(dir, name));
    stores.push(await openStore({ dataDir: dir, beforeCommit: async () => { ready.resolve(); await finish.promise; }, retention: false }));
  }
  f.cleanup(async () => { for (const store of stores) await store.close(); });
  const writes = stores.map(store => store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0));
  await Promise.all(started);
  const capturing = f.capture();
  // The roster checkpoint does not reserve every store: each copy has its own cut.
  await new Promise(resolve => setImmediate(resolve));
  const successors = stores.map(store => store.command({ type: 'set-rule', ruleId: 'access.shared', value: true }, 1));
  finish.resolve();
  const backup = await capturing; await Promise.all([...writes, ...successors]);
  const revisions = [];
  for (const picker of f.pickers.slice(1)) {
    const revision = (await json(path.join(backup, 'pickers', picker.id, 'state.json'))).state.revision;
    assert([1, 2].includes(revision)); revisions.push(revision);
  }
  assert(stores.every(store => store.getInfo().revision === 2));
  const target = await f.target();
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
  assert.equal(result.restored, 3);
  for (const [i, picker] of f.pickers.slice(1).entries()) assert.equal((await json(path.join(target.multiPicker.pickerRoot, picker.id, 'state.json'))).state.revision, revisions[i]);
});

test('service export retains bindings and membership checkpoint, excludes all credentials and rejects tampering', async t => {
  const f = await fixture(t), backup = await f.capture();
  const manifest = await verifyServiceBackup(backup);
  assert.equal(manifest.pickers.length, 3); assert(manifest.pickers.every(p => p.binding.digest === dataset.digest));
  const text = await readFile(path.join(backup, 'registry.json'), 'utf8');
  assert(!text.includes('synthetic-')); assert((await json(path.join(backup, 'registry.json'))).accounts.every(a => a.identities.length === 0));
  assert(!(await inventory(backup)).some(row => /access-token|invites|accounts\.json|plugin-keys|future-secret/.test(row.path)));
  await writeFile(path.join(backup, 'pickers', f.pickers[0].id, 'state.json'), '{}');
  await assert.rejects(verifyServiceBackup(backup), /manifest/);
});

test('cross-directory deadline and thrown capture release every gate without abandoning accepted writes', async t => {
  const f = await fixture(t), dirs = f.pickers.map(f.dir), finish = Promise.withResolvers();
  const writing = withStoreWrite(dirs[0], () => finish.promise);
  await assert.rejects(withDirectoryBarriers(dirs, stopped, { maxDrainMs: 5 }), /timed out/);
  finish.resolve(); await writing;
  await assert.rejects(withDirectoryBarriers(dirs, async () => { throw new Error('Synthetic capture failure'); }), /capture failure/);
  await Promise.all(dirs.map(dir => withStoreWrite(dir, stopped)));
});

test('single-directory snapshots keep their original exclusion, independent directories and raw byte contract', async t => {
  const f = await fixture(t), dir = f.dir(f.pickers[0]), finish = Promise.withResolvers();
  const id = randomUUID(), writing = withStoreWrite(dir, () => finish.promise);
  const snapshot = snapshotStore(dir, id, { maxHoldMs: 30000 });
  await assert.rejects(snapshotStore(dir, randomUUID()), /already being captured/);
  await withStoreWrite(f.dir(f.pickers[1]), stopped);
  finish.resolve(); await writing; await snapshot;
  const copy = path.join(snapshotPath(dir, id), 'store');
  assert.equal(await readFile(path.join(copy, 'access-token'), 'utf8'), 'synthetic-private-credential');
  const expected = (await inventory(dir)).filter(row => !row.path.startsWith('store.lock'));
  assert.deepEqual(await inventory(copy), expected);
});

test('checkpoint queues admission only for registry metadata and never waits for unrelated handlers or residency', async () => {
  let opened = 0, held = 0;
  const checkpoint = createPickerCheckpoint({ serialize: async work => { held++; return work(); }, entries: new Map(), legacy: {},
    registry: { listPickers: () => Array.from({ length: 51 }, () => ({ lifecycle: 'active' })), withRecoveryCheckpoint: work => work({ pickers: [] }) } });
  const leave = await checkpoint.enter(), finish = Promise.withResolvers();
  const capturing = checkpoint.capture(async () => { opened++; await finish.promise; });
  let admitted = false;
  const waiting = checkpoint.enter().then(release => { admitted = true; release(); });
  assert.equal(admitted, false);
  assert.equal(checkpoint.counts().dormantContexts, 50); assert.equal(opened, 1);
  assert.equal(held, 0);
  finish.resolve(); await capturing;
  await waiting; leave(); (await checkpoint.enter())();
  assert.equal(checkpoint.timings().waitedRequests, 1);
  assert(checkpoint.timings().maxRequestWaitMs >= 0);
});

test('health with 50 dormant registry pickers opens none; snapshots require private master Bearer', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'linux-multi-picker-health-'));
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') };
  const dataDir = path.join(root, 'legacy'); await mkdir(dataDir);
  const registry = await openRegistry({ ...multiPicker, legacyDir: dataDir });
  for (let i = 0; i < 50; i++) await registry.firstLogin('discord', 'synthetic-' + i);
  const ids = registry.listPickers().map(p => p.id); await registry.close();
  const app = await createServer({ dataDir, multiPicker, initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    host: '127.0.0.1', port: 0, loopbackPort: 0, loopbackRole: 'public', predictionPrewarm: false });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); }); await app.listen();
  const base = `http://127.0.0.1:${app.address().port}`, publicBase = `http://127.0.0.1:${app.loopbackAddress().port}`;
  const headers = { Authorization: 'Bearer ' + app.store.getAccessToken(), 'Content-Type': 'application/json' };
  for (let i = 0; i < 3; i++) {
    const health = await (await fetch(base + '/api/health', { headers })).json();
    assert.equal(health.service.openContexts, 1); assert.equal(health.service.dormantContexts, 50); assert.equal(health.service.registry, 'ready');
  }
  for (const id of ids) assert.deepEqual(await readdir(path.join(multiPicker.pickerRoot, id)), []);
  for (const target of [publicBase, base]) {
    const response = await fetch(target + '/api/operator/service-snapshot', { method: 'POST', headers: target === base ? { Cookie: 'duo_access=' + app.store.getAccessToken(), 'Content-Type': 'application/json' } : headers, body: JSON.stringify({ id: randomUUID() }) });
    assert.equal(response.status, 403);
  }
  const id = randomUUID();
  const response = await fetch(base + '/api/operator/service-snapshot', { method: 'POST', headers, body: JSON.stringify({ id }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).pickerCount, 51);
  await verifyServiceBackup(snapshotPath(dataDir, id));
  for (const id of ids) assert.deepEqual(await readdir(path.join(multiPicker.pickerRoot, id)), []);
});

test('interrupted restore resumes after a durable picker checkpoint and never repeats a completed migration', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); let probes = 0, interrupted = false;
  const options = { settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile,
    probe: async (...args) => { probes++; await portableProbe(...args); await atomic(path.join(args[1], 'state.json'), encode(await json(path.join(args[1], 'state.json')))); return portableProbe(...args); } };
  await assert.rejects(restoreServiceStopped({ ...options, onProgress: async progress => {
    if (!interrupted && progress.pickers.some(row => row.status === 'restored')) { interrupted = true; throw new Error('Synthetic interruption'); }
  } }), /interruption/);
  assert.equal(probes, 1);
  await assert.rejects(checkStart(target), /incomplete/);
  assert.equal((await restoreServiceStopped(options)).restored, 3); assert.equal(probes, 3);
  assert.equal((await restoreServiceStopped(options)).restored, 3); assert.equal(probes, 3);
});

test('incompatible picker is quarantined while unrelated games restore, then explicitly released', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), incompatible = f.pickers[1];
  await f.close();
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped,
    probe: async (...args) => { if (args[1].includes(incompatible.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
  assert.equal(result.restored, 2); assert.deepEqual(result.quarantined, [incompatible.id]);
  const report = await listServicePickers(target, incompatible.id); assert.equal(report.pickers[0].quarantined, true);
  assert.deepEqual(await readdir(path.join(target.multiPicker.pickerRoot, incompatible.id)), ['operator-quarantine.json']);
  assert(!JSON.stringify(report).includes('Player'));
  await releaseServiceQuarantine({ settings: target, id: incompatible.id, release: f.release, assertStopped: stopped, probe: portableProbe });
  assert.equal((await listServicePickers(target, incompatible.id)).pickers[0].quarantined, false);
});

test('a completed restore journal does not block restoring a newer backup onto recovered disks', async t => {
  const f = await fixture(t), first = await f.capture();
  // Later gameplay makes the newer backup's manifest differ.
  await mkdir(path.join(f.dir(f.pickers[1]), 'history'), { recursive: true });
  await writeFile(path.join(f.dir(f.pickers[1]), 'history', 'synthetic.json'), encode({ revision: 2 }));
  const second = await f.capture(), target = await f.target(); await f.close();
  const options = { settings: target, release: f.release, assertStopped: stopped, probe: portableProbe };
  assert.equal((await restoreServiceStopped({ ...options, backup: first })).restored, 3);
  // The same completed restore still resumes (an operator that died before ownership repair).
  assert.equal((await restoreServiceStopped({ ...options, backup: first })).restored, 3);
  // The gameplay disks are lost again while controlDir survives.
  for (const dir of [target.dataDir, target.multiPicker.registryDir, target.multiPicker.pickerRoot]) await rm(dir, { recursive: true, force: true });
  await rm(target.dataDir + '.dataset.json', { force: true });
  assert.equal((await restoreServiceStopped({ ...options, backup: second })).restored, 3);
  await checkStart(target);
  const work = path.join(target.controlDir, 'service-restore');
  assert.equal((await readdir(work)).filter(name => name.startsWith('progress.complete-')).length, 1);
  // An incomplete journal still refuses a different backup.
  const progress = path.join(work, 'progress.json');
  await atomic(progress, encode({ ...await json(progress), phase: 'prepared' }));
  await assert.rejects(restoreServiceStopped({ ...options, backup: first }), /same backup/);
});

test('an interrupted quarantine release finishes on retry after its record is gone', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), incompatible = f.pickers[1];
  await f.close();
  await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped,
    probe: async (...args) => { if (args[1].includes(incompatible.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
  const options = { settings: target, id: incompatible.id, release: f.release, assertStopped: stopped, probe: portableProbe };
  assert.deepEqual(await releaseServiceQuarantine(options), { released: incompatible.id });
  // Model an operator that died right after deleting the quarantine record:
  // the journal says installed and the record is gone.
  const journal = path.join(target.controlDir, 'release-' + incompatible.id, 'progress.json');
  await atomic(journal, encode({ ...await json(journal), status: 'installed' }));
  assert.deepEqual(await releaseServiceQuarantine(options), { released: incompatible.id });
  assert.equal((await json(journal)).status, 'released');
  // Retrying a finished release is harmless.
  assert.deepEqual(await releaseServiceQuarantine(options), { released: incompatible.id });
  assert.equal((await listServicePickers(target, incompatible.id)).pickers[0].quarantined, false);
  // A changed install is not silently accepted.
  await atomic(journal, encode({ ...await json(journal), status: 'installed' }));
  await writeFile(path.join(target.multiPicker.pickerRoot, incompatible.id, 'state.json'), encode({ changed: true }));
  await assert.rejects(releaseServiceQuarantine(options), /destination changed/);
  // A picker that was never quarantined still has no record to release.
  await assert.rejects(releaseServiceQuarantine({ ...options, id: f.pickers[2].id }), /No quarantine record/);
});

test('service recovery refuses a missing live ledger before any probe and never initializes one', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); let probes = 0;
  target.multiPicker.tombstoneDir = path.join(f.root, 'missing-ledger');
  await assert.rejects(restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, probe: async () => { probes++; } }), /Live tombstone ledger/);
  assert.equal(probes, 0);
  await assert.rejects(readdir(target.multiPicker.tombstoneDir), { code: 'ENOENT' });
});

test('MP5 tombstone reconcile export blocks deleted picker recovery and quarantine release', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), blocked = f.pickers[1], survivor = f.pickers[2];
  await f.close();
  const restored = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped,
    probe: async (...args) => { if (args[1].includes(blocked.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
  assert.deepEqual(restored.quarantined, [blocked.id]);
  const registry = await openRegistry({ ...target.multiPicker, legacyDir: target.dataDir });
  await registry.deleteAccount(blocked.ownerAccountId, { runtimePurge: true }); await registry.close();
  const date = '2099-01-01T00:00:00.000Z', inviteId = randomUUID(), session = accountId => ({ tokenHash: sha(accountId),
    accountId, pickerId: accountId === blocked.ownerAccountId ? blocked.id : survivor.id, inviteId: null, provider: 'discord', expiresAt: date });
  // Synthetic stale issuer files model a restored pre-deletion checkpoint.
  await atomic(path.join(target.dataDir, 'invites.json'), encode({ schemaVersion: 1,
    invites: [{ id: inviteId, label: 'Player 1', tokenHash: sha(inviteId), admin: false, revoked: false, memberId: 'one',
      createdAt: date, lastUsedAt: null, claimedAccountId: blocked.ownerAccountId, claimedAt: date }],
    sessions: [session(blocked.ownerAccountId), session(survivor.ownerAccountId)] }));
  await atomic(path.join(target.dataDir, 'accounts.json'), encode({ schemaVersion: 1, accounts: [blocked, survivor].map(p => ({
    id: p.ownerAccountId, identities: [{ provider: 'discord', subject: p.id, createdAt: date, lastUsedAt: date }], memberships: [], createdAt: date, lastUsedAt: date })) }));
  await atomic(path.join(target.multiPicker.pickerRoot, blocked.id, 'plugin-keys.json'), 'synthetic-revoked-key');
  const issuerOwners = [];
  for (const name of ['accounts.json', 'invites.json']) {
    const file = path.join(target.dataDir, name);
    if (process.getuid?.() === 0) await chown(file, 1001, 1001);
    issuerOwners.push({ file, ...await lstat(file) });
  }
  let probes = 0;
  for (let i = 0; i < 2; i++) await assert.rejects(releaseServiceQuarantine({ settings: target, id: blocked.id,
    release: f.release, assertStopped: stopped, probe: async () => { probes++; } }), /excluded/);
  assert.equal(probes, 0);
  for (const owner of issuerOwners) {
    const current = await lstat(owner.file);
    assert.equal(current.uid, owner.uid); assert.equal(current.gid, owner.gid);
  }
  const issuer = await json(path.join(target.dataDir, 'invites.json'));
  assert.equal(issuer.invites[0].revoked, true);
  assert.deepEqual(issuer.sessions.map(s => s.accountId), [survivor.ownerAccountId]);
  assert.deepEqual((await json(path.join(target.dataDir, 'accounts.json'))).accounts.map(a => a.id), [survivor.ownerAccountId]);
  await assert.rejects(readdir(path.join(target.multiPicker.pickerRoot, blocked.id)), { code: 'ENOENT' });
  const checkpoint = await json(path.join(target.multiPicker.registryDir, 'registry.json'));
  const planned = await reconcileServiceRecoveryTombstones({ settings: target, checkpoint });
  assert(planned.excludedPickerIds.includes(blocked.id));
  assert(!planned.excludedPickerIds.includes(f.pickers[0].id));
  assert(!planned.checkpoint.accounts.some(a => a.id === blocked.ownerAccountId));
  assert(planned.checkpoint.accounts.every(a => a.identities.length === 0));
  assert.deepEqual(planned.checkpoint.capabilities, []);
});

test('pickers and accounts deleted after a backup remain deleted after service restore', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), [legacy, deletedPicker, retiredAccount] = f.pickers;
  await f.registry.beginPickerDeletion(deletedPicker.id);
  await f.registry.deleteAccount(retiredAccount.ownerAccountId); // Also covers MP1 records without a runtime marker.
  await f.close();
  const ledgerFile = path.join(target.multiPicker.tombstoneDir, 'ledger.json');
  // Root CI can exercise an actual owner change; ordinary runs still verify
  // ownership and all authoritative ledger decisions survive the operation.
  if (process.getuid?.() === 0) await chown(ledgerFile, 1001, 1001);
  const owner = await lstat(ledgerFile);
  let probes = 0;
  const options = { settings: target, backup, release: f.release, assertStopped: stopped,
    probe: async (...args) => { probes++; return portableProbe(...args); } };
  const result = await restoreServiceStopped(options);
  assert.equal(result.restored, 1); assert.equal(result.excluded, 2); assert.equal(result.credentialsRestored, 0);
  assert.equal(probes, 1);
  const restoredOwner = await lstat(ledgerFile);
  assert.equal(restoredOwner.uid, owner.uid); assert.equal(restoredOwner.gid, owner.gid);
  for (const picker of [deletedPicker, retiredAccount]) {
    await assert.rejects(readFile(path.join(target.multiPicker.pickerRoot, picker.id, 'state.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(target.multiPicker.pickerRoot, picker.id + '.dataset.json')), { code: 'ENOENT' });
  }
  assert(!JSON.stringify(await inventory(target.dataDir)).includes('plugin-keys.json'));
  const registry = await openRegistry({ ...target.multiPicker, legacyDir: target.dataDir });
  assert.equal(registry.getAccount(retiredAccount.ownerAccountId), null);
  assert.equal(registry.findIdentity('discord', 'synthetic-1'), null);
  assert.equal(registry.getPicker(deletedPicker.id).lifecycle, 'deleted');
  assert.equal(registry.getPicker(legacy.id).lifecycle, 'active');
  assert.deepEqual(registry.getAccount(deletedPicker.ownerAccountId).memberships, []);
  assert.equal(registry.getAccount(deletedPicker.ownerAccountId).defaultPickerId, null);
  await registry.close();
});

test('ownership repair hands the tombstone ledger back to the service user after an interrupted reconcile', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); await f.close();
  const ledger = path.join(target.multiPicker.tombstoneDir, 'ledger.json');
  await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, probe: portableProbe });
  const changed = [];
  await repairServiceOwnership({ settings: target, uid: 1001, gid: 1001, change: async file => { changed.push(file); } });
  assert(changed.includes(ledger));
  // Root CI models an operator that died after MP5 replaced the ledger.
  if (process.getuid?.() === 0) {
    await chown(ledger, 0, 0);
    await repairServiceOwnership({ settings: target, uid: 1001, gid: 1001 });
    const owner = await lstat(ledger);
    assert.equal(owner.uid, 1001); assert.equal(owner.gid, 1001);
  }
});

test('resumed recovery reapplies newer tombstones and purges an already installed owned picker', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), blocked = f.pickers[1]; await f.close();
  const options = { settings: target, backup, release: f.release, assertStopped: stopped, probe: portableProbe };
  let interrupted = false;
  await assert.rejects(restoreServiceStopped({ ...options, onProgress: async p => {
    if (!interrupted && p.pickers.some(row => row.id === blocked.id && row.status === 'restored')) {
      interrupted = true; throw new Error('Synthetic deletion interruption');
    }
  } }), /deletion interruption/);
  assert(await readFile(path.join(target.multiPicker.pickerRoot, blocked.id, 'state.json')));
  const registry = await openRegistry({ ...f.settings.multiPicker, legacyDir: f.settings.dataDir });
  await registry.beginPickerDeletion(blocked.id); await registry.close();
  const result = await restoreServiceStopped(options);
  assert.equal(result.restored, 2); assert.equal(result.excluded, 1);
  await assert.rejects(readdir(path.join(target.multiPicker.pickerRoot, blocked.id)), { code: 'ENOENT' });
  assert.equal((await json(path.join(target.multiPicker.registryDir, 'registry.json'))).pickers.find(p => p.id === blocked.id).lifecycle, 'deleted');
});

test('recovery refuses invalid ledgers and never infers tombstones from checkpoint lifecycle rows', async t => {
  const f = await fixture(t); await f.close();
  const checkpoint = await json(path.join(f.settings.multiPicker.registryDir, 'registry.json'));
  const file = path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'), ledger = await readFile(file);
  await atomic(file, '{}');
  await assert.rejects(reconcileServiceRecoveryTombstones({ settings: f.settings, checkpoint }), /Invalid registry/);
  assert.equal(await readFile(file, 'utf8'), '{}');
  await atomic(file, ledger);
  const blocked = f.pickers[1]; checkpoint.pickers.find(p => p.id === blocked.id).lifecycle = 'deleted';
  for (const account of checkpoint.accounts) {
    account.memberships = account.memberships.filter(m => m.pickerId !== blocked.id);
    if (account.defaultPickerId === blocked.id) account.defaultPickerId = null;
  }
  await assert.rejects(reconcileServiceRecoveryTombstones({ settings: f.settings, checkpoint }), /Invalid registry/);
  assert.deepEqual(await readFile(file), ledger);
  assert(await readFile(path.join(f.dir(blocked), 'state.json')));
});

test('operator inspection validates IDs and stopped proof covers every store and both registry roots', async t => {
  const f = await fixture(t); await f.close();
  const controller = { state: async () => ({ stopped: true }) };
  await assertServiceStopped(f.settings, controller);
  await assert.rejects(listServicePickers(f.settings, '../outside'), /Unknown/);
  const file = path.join(f.dir(f.pickers[1]), 'store.lock'); await writeFile(file, 'synthetic');
  await assert.rejects(assertServiceStopped(f.settings, controller), /ownership/); await rm(file);
  await writeFile(path.join(f.settings.multiPicker.tombstoneDir, 'registry.lock'), 'synthetic');
  await assert.rejects(assertServiceStopped(f.settings, controller), /ownership/);
});

test('stopped service backup uses a sanitized consistent checkpoint and preserves the external ledger', async t => {
  const f = await fixture(t); await f.close();
  const ledger = await readFile(path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'));
  const result = await serviceBackup({ settings: f.settings, release: f.release, stopped: true,
    assertStopped: () => assertServiceStopped(f.settings, { state: async () => ({ stopped: true }) }) });
  assert.equal((await verifyServiceBackup(result.target)).pickers.length, 3);
  assert.deepEqual(await readFile(path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json')), ledger);
});

test('service backup carries complete pinned pack payloads and omits unrelated input files', async t => {
  const f = await fixture(t), input = path.join(f.root, 'pack'); await mkdir(input);
  const payload = 'synthetic-pack-payload'; await writeFile(path.join(input, 'payload.json'), payload);
  await writeFile(path.join(input, 'unrelated-secret'), 'synthetic-secret');
  const manifest = encode({ files: [{ path: 'payload.json', bytes: Buffer.byteLength(payload), sha256: sha(payload) }] });
  await writeFile(path.join(input, 'pack.json'), manifest);
  const id = randomUUID(); await captureServiceCheckpoint({ settings: f.settings, registry: f.registry, id, minFreeBytes: 0,
    inputs: { data: { path: path.join(input, 'pack.json'), sha256: sha(manifest) } } });
  const backup = snapshotPath(f.settings.dataDir, id); await verifyServiceBackup(backup);
  assert.equal(await readFile(path.join(backup, 'inputs/data/payload.json'), 'utf8'), payload);
  assert(!(await inventory(backup)).some(r => r.path.includes('unrelated-secret')));
});

test('service backup counts the gameplay and pack payload against the spool reserve before copying', async t => {
  const f = await fixture(t), input = path.join(f.root, 'pack'); await mkdir(input);
  const payload = 'x'.repeat(4096); await writeFile(path.join(input, 'payload.json'), payload);
  const manifest = encode({ files: [{ path: 'payload.json', bytes: payload.length, sha256: sha(payload) }] });
  await writeFile(path.join(input, 'pack.json'), manifest);
  const history = path.join(f.dir(f.pickers[1]), 'history'); await mkdir(history, { recursive: true });
  await writeFile(path.join(history, 'synthetic.json'), 'y'.repeat(65536));
  // A credential file outside the gameplay roots is never copied, so it is not counted.
  await writeFile(path.join(f.dir(f.pickers[1]), 'access-token'), 'z'.repeat(1 << 20));
  const inputs = { data: { path: path.join(input, 'pack.json'), sha256: sha(manifest) } };
  const calls = [];
  const id = randomUUID();
  await captureServiceCheckpoint({ settings: f.settings, registry: f.registry, id, minFreeBytes: 7, inputs,
    spaceCheck: async (root, bytes, reserve) => { calls.push({ bytes, reserve }); } });
  assert(calls.length >= 1 + f.pickers.length + 1, 'checks before copying, before each picker and before each input');
  assert(calls.every(call => call.reserve === 7));
  assert(calls[0].bytes >= 65536 + 4096 + Buffer.byteLength(manifest));
  assert(calls[0].bytes < 1 << 20);
  // A spool too small for the payload refuses before any copy and leaves nothing behind.
  const refused = randomUUID();
  await assert.rejects(captureServiceCheckpoint({ settings: f.settings, registry: f.registry, id: refused, minFreeBytes: 7, inputs,
    spaceCheck: async (root, bytes) => { if (bytes > 65536) throw new Error('Insufficient free space for recovery work and reserve.'); } }),
  /Insufficient free space/);
  await assert.rejects(readdir(snapshotPath(f.settings.dataDir, refused)), { code: 'ENOENT' });
});

test('restore resumes the intent window before installation and runs real decoder migrations sequentially', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); let once = false;
  await assert.rejects(restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile,
    onProgress: async p => { if (!once && p.pickers.some(r => r.installing)) { once = true; throw new Error('Synthetic intent interruption'); } } }), /intent interruption/);
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile });
  assert.equal(result.restored, 3); assert.deepEqual(result.quarantined, []);
});

test('online operator backup uses the private service dispatch without opening dormant pickers', async t => {
  const f = await fixture(t); await f.close();
  for (const name of ['accounts.json', 'invites.json', 'plugin-keys.json', 'access-token', 'overlays.json', 'future-secret.json']) await rm(path.join(f.settings.dataDir, name));
  const app = await createServer({ dataDir: f.settings.dataDir, multiPicker: f.settings.multiPicker, host: '127.0.0.1', port: 0, predictionPrewarm: false });
  f.cleanup(() => app.close()); await app.listen();
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = async (_release, route, method = 'GET', body) => {
    const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200); return response.json();
  };
  const { backupOnline } = await import('../scripts/linux/operator.mjs');
  const result = await backupOnline({ settings: f.settings, release: f.release, request });
  assert.equal((await verifyServiceBackup(result.target)).pickers.length, 3);
  assert.equal((await request(f.release, '/api/health')).service.openContexts, 1);
});

test('operator process death releases the kernel guard and a restore can resume its dead local journal owner', async t => {
  const f = await fixture(t), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  const moduleUrl = new URL('../scripts/linux/service-lock.mjs', import.meta.url).href;
  const code = `import { serviceOperation } from ${JSON.stringify(moduleUrl)}; await serviceOperation(${JSON.stringify({ controlDir: f.settings.controlDir })}, 'restore', async () => process.exit(0));`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code]);
  const { serviceOperation } = await import('../scripts/linux/service-lock.mjs');
  assert.equal(await serviceOperation(f.settings, 'restore', async () => 'resumed'), 'resumed');
  await serviceOperation(f.settings, 'restore', async () => {
    assert.deepEqual(await serviceOperation(f.settings, 'health', () => assert.fail()), { skipped: true });
    await assert.rejects(serviceOperation(f.settings, 'restore', () => assert.fail()), { code: 'REGISTRY_LOCKED' });
  });
});

test('incompatible legacy refuses restore before any live target changes and is never quarantined', async t => {
  const f = await fixture(t), backup = await f.capture(); await f.close();
  // Deliberately put an owned picker first: legacy preflight must still precede it.
  const manifest = await json(path.join(backup, 'manifest.json'));
  manifest.pickers.reverse(); await atomic(path.join(backup, 'manifest.json'), encode(manifest));
  const before = { legacy: await inventory(f.settings.dataDir), pickers: await inventory(f.settings.multiPicker.pickerRoot), registry: await inventory(f.settings.multiPicker.registryDir) };
  let probes = 0;
  const rejectLegacy = async (_release, store) => {
    probes++; assert(store.includes(f.pickers[0].id));
    await atomic(path.join(store, 'state.json'), '{}'); // A failed migration touches scratch only.
    throw new Error('Synthetic incompatible legacy.');
  };
  for (const settings of [f.settings, await f.target()]) {
    await assert.rejects(restoreServiceStopped({ settings, backup, release: f.release, assertStopped: stopped,
      probe: rejectLegacy }), error => error.code === 'LEGACY_RESTORE_INCOMPATIBLE' && /Live data was not changed/.test(error.message));
    await assert.rejects(readdir(path.join(settings.controlDir, 'quarantine')), { code: 'ENOENT' });
  }
  assert.equal(probes, 2);
  assert.deepEqual(await inventory(f.settings.dataDir), before.legacy);
  assert.deepEqual(await inventory(f.settings.multiPicker.pickerRoot), before.pickers);
  assert.deepEqual(await inventory(f.settings.multiPicker.registryDir), before.registry);
});

test('copying one picker does not hold global admission or other store writes; roster reconciles create/delete races', async t => {
  const f = await fixture(t, 3), blocked = Promise.withResolvers(), finish = Promise.withResolvers();
  const deleting = f.pickers[1], deletedAfterCopy = f.pickers[2], other = f.pickers[3]; let created;
  const checkpoint = createPickerCheckpoint({ serialize: work => work(), entries: new Map(), registry: f.registry });
  const id = randomUUID();
  const capturing = captureServiceCheckpoint({ settings: f.settings, registry: f.registry, checkpoint, id, minFreeBytes: 0,
    onPhase: async (phase, detail) => {
      if (phase === 'manifest') created = (await f.registry.firstLogin('discord', 'synthetic-after-manifest')).picker;
      if (phase === 'picker-barrier' && detail.id === deleting.id) { blocked.resolve(); await finish.promise; }
      if (phase === 'picker-copied' && detail.id === deletedAfterCopy.id) {
        await f.registry.beginPickerDeletion(deletedAfterCopy.id);
        await rm(f.dir(deletedAfterCopy), { recursive: true }); await rm(f.dir(deletedAfterCopy) + '.dataset.json');
      }
    } });
  await blocked.promise;
  assert.equal(checkpoint.counts().checkpoint, false);
  let initialized = false;
  const initializing = checkpoint.open(deleting.id, async () => { initialized = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(initialized, false);
  (await checkpoint.enter())();
  await withStoreWrite(f.dir(other), () => atomic(path.join(f.dir(other), 'plugin-items.json'), '{"v":1,"players":{}}'));
  await f.registry.beginPickerDeletion(deleting.id);
  await rm(f.dir(deleting), { recursive: true }); await rm(f.dir(deleting) + '.dataset.json');
  finish.resolve(); await initializing;
  const result = await capturing, backup = snapshotPath(f.settings.dataDir, id), manifest = await verifyServiceBackup(backup);
  assert.equal(result.absentPickerCount, 2);
  assert.equal(manifest.pickers.find(p => p.id === deleting.id).absent, true);
  assert.equal(manifest.pickers.find(p => p.id === deletedAfterCopy.id).absent, true);
  assert(!manifest.pickers.some(p => p.id === created.id));
  assert(!(await inventory(backup)).some(row => row.path.startsWith('pickers/' + deleting.id)));
  const target = await f.target();
  const restored = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
  assert.equal(restored.restored, 2); assert.equal(restored.excluded, 2);
  const registry = await json(path.join(target.multiPicker.registryDir, 'registry.json'));
  assert(!registry.pickers.some(p => [created.id, deleting.id, deletedAfterCopy.id].includes(p.id)));
});

test('service startup never reads private operator recovery state; privileged gate still blocks partial restores', async t => {
  const runtimeUrl = new URL('../scripts/linux/runtime.mjs', import.meta.url).href;
  const filesUrl = new URL('../scripts/linux/files.mjs', import.meta.url).href;
  const serveUrl = new URL('../scripts/linux/serve.mjs', import.meta.url).href;
  // Model EACCES at the private operator boundary on every platform, without
  // depending on POSIX modes or on the test process running unprivileged.
  const code = `import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(runtimeUrl)}) return { format: 'module', shortCircuit: true, source:
        'export const operatorSettings = async () => ({multiPicker:{},controlDir:"private-control",dataDir:"game",current:"pointer"}); export const readRelease = async () => ({config:{}}); export const assertOperatorService = () => {}; export const openApplication = async () => ({ready:Promise.resolve(),close:async()=>{}});' };
      if (url === ${JSON.stringify(filesUrl)}) return { format:'module',shortCircuit:true,source:
        'export const noLinks = async () => {}; export const exists = async () => { throw Object.assign(new Error("Private control directory"),{code:"EACCES"}); }; export const json = async () => { throw new Error("Private control directory"); };' };
      if (url === 'node:fs/promises') return { format:'module',shortCircuit:true,source:'export const readFile = async () => Buffer.from("synthetic");' };
      return next(url,context);
    }}); await import(${JSON.stringify(serveUrl)});`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }), 'Picker ready.\n');
  const root = await mkdtemp(path.join(tmpdir(), 'linux-start-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { controlDir: root, multiPicker: {} };
  await mkdir(path.join(root, 'service-restore'));
  await atomic(path.join(root, 'service-restore', 'progress.json'), encode({ phase: 'prepared' }));
  await assert.rejects(checkStart(settings), /incomplete/);
  await atomic(path.join(root, 'service-restore', 'progress.json'), encode({ phase: 'complete' }));
  await checkStart(settings);
});

test('service backups refuse quarantined pickers without losing their payload or initialization fence', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(), blocked = f.pickers[1]; await f.close();
  await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped,
    probe: async (...args) => { if (args[1].includes(blocked.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
  const payload = path.join(target.controlDir, 'quarantine'), fence = path.join(target.multiPicker.pickerRoot, blocked.id);
  const before = { payload: await inventory(payload), fence: await inventory(fence) };
  const registry = await openRegistry({ ...target.multiPicker, legacyDir: target.dataDir });
  try {
    await assert.rejects(captureServiceCheckpoint({ settings: target, registry, id: randomUUID(), minFreeBytes: 0 }), /[Qq]uarantin/);
  } finally { await registry.close(); }
  await assert.rejects(serviceBackup({ settings: target, release: f.release, stopped: true, assertStopped: stopped }), /[Qq]uarantin/);
  assert.deepEqual(await inventory(payload), before.payload);
  assert.deepEqual(await inventory(fence), before.fence);
  assert.deepEqual(await readdir(fence), ['operator-quarantine.json']);
  assert.deepEqual(await readdir(target.dataDir + '.snapshots'), []);
});

test('cross-filesystem restore and quarantine release stage atomic installs beside the destination and resume intent', async t => {
  const f = await fixture(t, 1), backup = await f.capture(), target = await f.target(), owned = f.pickers[1];
  const { default: fs } = await import('node:fs'), { syncBuiltinESMExports } = await import('node:module');
  const rename = fs.promises.rename, destinations = new Set(f.pickers.flatMap(p => {
    const dir = p.kind === 'legacy-shared' ? target.dataDir : path.join(target.multiPicker.pickerRoot, p.id);
    return [dir, dir + '.dataset.json'];
  }));
  // Model controlDir on another mount on Windows as well as POSIX. Other
  // atomic writes and same-destination-filesystem renames retain native behavior.
  let interruptAfterStore = true;
  fs.promises.rename = async (from, to) => {
    if (String(from).startsWith(target.controlDir + path.sep) && destinations.has(String(to))) {
      throw Object.assign(new Error('Synthetic cross-device rename'), { code: 'EXDEV' });
    }
    const result = await rename(from, to);
    if (String(to) === target.dataDir && interruptAfterStore) { interruptAfterStore = false; throw new Error('Synthetic store rename interruption'); }
    return result;
  };
  syncBuiltinESMExports();
  let interrupted = false, localStage;
  try {
    const options = { settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile,
      probe: async (...args) => { if (args[1].includes(owned.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } };
    await assert.rejects(restoreServiceStopped({ ...options, onProgress: async progress => {
      if (!interrupted && progress.pickers.some(row => row.installing)) { interrupted = true; throw new Error('Synthetic install interruption'); }
    } }), /install interruption/);
    const intent = (await json(path.join(target.controlDir, 'service-restore', 'progress.json'))).pickers.find(row => row.installing);
    localStage = intent.installStage;
    assert.equal(path.dirname(localStage ?? ''), path.dirname(target.dataDir));
    assert.equal((await lstat(localStage)).dev, (await lstat(path.dirname(target.dataDir))).dev);
    await assert.rejects(restoreServiceStopped(options), /store rename interruption/);
    const result = await restoreServiceStopped(options);
    assert.equal(result.restored, 1); assert.deepEqual(result.quarantined, [owned.id]);
    await assert.rejects(readdir(localStage), { code: 'ENOENT' });
    await releaseServiceQuarantine({ settings: target, id: owned.id, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
    for (const picker of f.pickers) {
      const dir = picker.kind === 'legacy-shared' ? target.dataDir : path.join(target.multiPicker.pickerRoot, picker.id);
      assert.equal(sha(await readFile(path.join(dir, 'state.json'))), sha(await readFile(path.join(backup, 'pickers', picker.id, 'state.json'))));
      assert.equal((await readdir(path.dirname(dir))).some(name => name.startsWith('.' + path.basename(dir) + '.restore-')), false);
    }
  } finally { fs.promises.rename = rename; syncBuiltinESMExports(); }
});

test('a dormant picker waiting on its checkpoint never blocks an unrelated resident handler', async () => {
  const { createPickerRouter } = await import('../app/picker-router.mjs');
  const { Readable, Writable } = await import('node:stream');
  const A = 'p_' + 'a'.repeat(32), B = 'p_' + 'b'.repeat(32);
  const dir = id => path.join(tmpdir(), 'synthetic-checkpoint-router', id);
  const held = Promise.withResolvers(), finish = Promise.withResolvers(), waiting = Promise.withResolvers();
  let lifecycle = 'active', calls = [], handled = [];
  const router = createPickerRouter({
    registry: { getPicker: id => ({ lifecycle: id === A ? lifecycle : 'active', provisioning: 'ready' }),
      pickerDirectory: id => { if (id === A) waiting.resolve(); return dir(id); } },
    legacy: { authenticate: request => ({ kind: 'account', accountId: request.headers.picker, pickerId: request.headers.picker }) },
    openContext: async id => { calls.push(id); return { close: async () => {}, handle: async (_req, res) => { handled.push(id); res.writeHead(200); res.end('{}'); } }; },
  });
  async function send(id) {
    const request = Readable.from([]); Object.assign(request, { headers: { host: 'localhost', picker: id }, method: 'GET', url: '/api/state', complete: true, socket: { remoteAddress: '127.0.0.1' } });
    const headers = new Map(), response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value); response.getHeader = name => headers.get(name.toLowerCase());
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    await router.handle(request, response, { host: '127.0.0.1' }); return response.statusCode;
  }
  assert.equal(await send(B), 200);
  const barrier = withDirectoryBarriers([dir(A)], async () => { held.resolve(); await finish.promise; });
  await held.promise;
  const first = send(A); await waiting.promise;
  const second = send(B); let timer, completed;
  try { completed = await Promise.race([second.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000); })]); }
  finally {
    clearTimeout(timer); lifecycle = 'deleting'; finish.resolve(); await barrier;
    await Promise.all([first, second]); await router.close();
  }
  assert.equal(completed, true, 'Resident B must run before A releases its checkpoint gate.');
  assert.equal(await first, 403); assert.deepEqual(calls, [B]); assert.deepEqual(handled, [B, B]);
});

test('stopped ownership reclaims a dead MP5 reconciliation lock but refuses live and unverifiable owners', async t => {
  const f = await fixture(t); await f.close();
  const { lockRegistry } = await import('../app/storage/registry-lock.mjs');
  const { hostname } = await import('node:os');
  const moduleUrl = new URL('../scripts/linux/service-recovery.mjs', import.meta.url).href;
  const ledger = path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'), lock = path.join(f.settings.multiPicker.tombstoneDir, 'registry.lock');
  const checkpoint = await json(path.join(f.settings.multiPicker.registryDir, 'registry.json'));
  // Die in the real reconciler while MP1 owns the external ledger, after its
  // atomic replacement but before finally can release the registry lock.
  const code = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.promises.rename; fs.promises.rename = async (from,to) => {
      const result = await rename(from,to); if (String(to) === ${JSON.stringify(ledger)}) process.exit(0); return result;
    }; syncBuiltinESMExports();
    const { reconcileServiceRecoveryTombstones } = await import(${JSON.stringify(moduleUrl)});
    await reconcileServiceRecoveryTombstones(${JSON.stringify({ settings: f.settings, checkpoint })});
    throw new Error('Expected reconciliation interruption');`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code]);
  assert.equal((await json(lock)).host, hostname());
  const controller = { state: async () => ({ stopped: true }) };
  await assertServiceStopped(f.settings, controller);
  await assert.rejects(readFile(lock), { code: 'ENOENT' });
  const release = await lockRegistry(f.settings.multiPicker.tombstoneDir);
  try {
    const live = await readFile(lock);
    await assert.rejects(assertServiceStopped(f.settings, controller), /ownership/);
    assert.deepEqual(await readFile(lock), live);
  } finally { await release(); }
  await atomic(lock, encode({ pid: process.pid, host: 'synthetic-foreign-host', nonce: '0'.repeat(32) }));
  const foreign = await readFile(lock);
  await assert.rejects(assertServiceStopped(f.settings, controller), /ownership/);
  assert.deepEqual(await readFile(lock), foreign);
});
