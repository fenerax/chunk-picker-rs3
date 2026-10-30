import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { withDirectoryBarriers, withStoreWrite, snapshotStore, snapshotPath } from '../app/storage/snapshot.mjs';
import { openRegistry } from '../app/storage/registry.mjs';
import { createPickerCheckpoint } from '../app/picker-router-checkpoint.mjs';
import { captureServiceCheckpoint, verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { restoreServiceStopped, listServicePickers, releaseServiceQuarantine } from '../scripts/linux/service-recovery.mjs';
import { atomic, encode, inventory, json, sha } from '../scripts/linux/files.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { assertServiceStopped, serviceBackup } from '../scripts/linux/service-operator.mjs';
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
    for (const name of ['accounts.json', 'invites.json', 'plugin-keys.json', 'access-token', 'overlays.json', 'future-secret.json']) await writeFile(path.join(dir, name), 'synthetic-private-credential');
  }
  const config = { coreRoot: path.resolve('.'), dataDir: settings.dataDir, datasetId: 'open-starter', host: '127.0.0.1', port: 0, loopbackPort: 1, multiPicker: settings.multiPicker };
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
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile,
    probe: async (...args) => { if (args[1].includes(incompatible.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
  assert.equal(result.restored, 2); assert.deepEqual(result.quarantined, [incompatible.id]);
  const report = await listServicePickers(target, incompatible.id); assert.equal(report.pickers[0].quarantined, true);
  assert.deepEqual(await readdir(path.join(target.multiPicker.pickerRoot, incompatible.id)), ['operator-quarantine.json']);
  assert(!JSON.stringify(report).includes('Player'));
  await releaseServiceQuarantine({ settings: target, id: incompatible.id, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
  assert.equal((await listServicePickers(target, incompatible.id)).pickers[0].quarantined, false);
});

test('service recovery fails closed at the clearly named MP5 call site before any probe', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); let probes = 0;
  await assert.rejects(restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, probe: async () => { probes++; } }), /MP5/);
  assert.equal(probes, 0);
});

test('MP5 tombstone reconcile export blocks deleted picker recovery and quarantine release', { todo: 'Enable when MP5 supplies its reconciliation export.' }, () => {});

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
      reconcileTombstones: reconcile, probe: rejectLegacy }), error => error.code === 'LEGACY_RESTORE_INCOMPATIBLE' && /Live data was not changed/.test(error.message));
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
