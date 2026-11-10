// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { openStore } from '../app/storage/store.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { snapshotStore, snapshotPath, storeWriteBlocked } from '../app/storage/snapshot.mjs';
import { hasOwnedStorage } from '../app/storage/owned-detection.mjs';
import { SNAPSHOT_EXCLUSIONS } from '../app/storage/store-identity-policy.mjs';
import { fixture, options, commands, world, taskCatalogue, now } from './helpers/owned-format2-fixture.mjs';
import { atomic, encode, exists, inventory, json, sha } from '../scripts/linux/files.mjs';
import { backupStopped, restoreStopped, verifyBackup } from '../scripts/linux/recovery.mjs';
import { captureOwnedClosure, verifyOwnedClosure, ownedRecoveryOptions, recoverySources } from '../scripts/linux/owned-recovery.mjs';
import { captureOnline } from '../scripts/linux/online.mjs';
import { readRelease } from '../scripts/linux/runtime.mjs';
import { openRegistry, registryRecoveryDocument } from '../app/storage/registry.mjs';
import { captureServiceCheckpoint, publishServiceBackup, verifyServiceBackup } from '../scripts/linux/service-checkpoint.mjs';
import { restoreServiceStopped, releaseServiceQuarantine } from '../scripts/linux/service-recovery.mjs';
import { offhostBackup } from '../scripts/linux/offhost-backup.mjs';
import { createGroupState, importBackup, cancelTaskClaimUndo } from '../app/core/state.mjs';
import { validateOwnedHistory } from '../scripts/linux/probe.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const handles = new Map();
async function opened(dataDir, ownedFormat2, extra = {}) {
  const store = await openStore({ dataDir, ownedFormat2, initialState: fixture().state,
    world, taskCatalogue, retention: false, completionCodec: false, now, ...extra });
  handles.set(store, dataDir); return store;
}
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-closure-'));
  t.after(async () => {
    for (const [store, dir] of handles) if (dir.startsWith(root + path.sep)) { await store.close(); handles.delete(store); }
    await rm(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'game'), owned = options(path.join(root, 'catalogue'));
  owned.validateCapture = (dir, options) => validateOwnedHistory(dir, options, { importBackup, cancelTaskClaimUndo });
  const settings = { dataDir, backupDir: path.join(root, 'backups'), scratchRoot: path.join(root, 'scratch'),
    controlDir: path.join(root, 'control'), current: path.join(root, 'current.json'), minFreeBytes: 0 };
  await mkdir(settings.controlDir);
  await mkdir(path.join(root, 'release')); await writeFile(path.join(root, 'release', 'input'), 'synthetic-release');
  const config = encode({ coreRoot: path.join(root, 'release'), dataDir });
  await writeFile(path.join(root, 'config.json'), config);
  await writeFile(settings.current, encode({ config: { path: path.join(root, 'config.json'), sha256: sha(config) } }));
  const release = await readRelease(settings.current, dataDir);
  const probe = async (_release, dir, output) => {
    const source = await ownedRecoveryOptions(dir);
    if (source) await validateOwnedHistory(dir, source, { importBackup, cancelTaskClaimUndo });
    const store = await opened(dir, source ?? false);
    try { const backup = await store.backup(); await writeFile(output, encode(backup)); return backup; }
    finally { await store.close(); }
  };
  const bind = dir => writeFile(dir + '.dataset.json', encode({ synthetic: true }));
  return { root, dataDir, owned, settings, release, probe, bind };
}
async function populate(f) {
  const store = await opened(f.dataDir, f.owned);
  for (const command of commands) await store.command(command, store.getInfo().revision);
  const expected = await store.backup(); await store.close(); await f.bind(f.dataDir);
  // Force closure discovery through BOTH archived History and a packed compact
  // preimage. Preserve every event/preimage byte rather than generating a copy.
  const historyId = 'history-0000000000000001-0000000000000007-0000000000000001.json.gz';
  await mkdir(path.join(f.dataDir, 'history'), { recursive: true });
  await writeFile(path.join(f.dataDir, 'history', historyId), gzipSync(encode({ format: 'rs3-chunk-picker-history', events: expected.state.history.slice(0, -1) })));
  const state = { ...expected.state, history: expected.state.history.slice(-1),
    provenance: { ...expected.state.provenance, historyArchive: [{ id: historyId }] } };
  await writeFile(path.join(f.dataDir, 'state.json'), encode({ format: 'rs3-chunk-picker', schemaVersion: 1,
    ...ownedCodec(fixture().base, fixture().pin).encode(state) }));
  const backups = path.join(f.dataDir, 'backups'), names = (await readdir(backups)).filter(name => name.endsWith('.json.gz'));
  const snapshots = [];
  for (const name of names) snapshots.push({ id: name, document: gunzipSync(await readFile(path.join(backups, name))).toString('utf8') });
  await mkdir(path.join(backups, 'archives'));
  await writeFile(path.join(backups, 'archives', 'archive-0000000000000001.json.gz'), gzipSync(encode({ format: 'rs3-chunk-picker-retained-archive', snapshots })));
  for (const name of names) await rm(path.join(backups, name));
  const archived = await opened(f.dataDir, f.owned);
  try {
    const complete = await archived.backup();
    assert.deepEqual(complete.state.history, expected.state.history);
    return complete;
  } finally { await archived.close(); }
}
function sameLogical(actual, expected) {
  assert.equal(sha(JSON.stringify(actual.state)), sha(JSON.stringify(expected.state)));
  assert.equal(sha(JSON.stringify(actual.state.history)), sha(JSON.stringify(expected.state.history)));
  assert.deepEqual(actual.state.history.map(event => event.undo), expected.state.history.map(event => event.undo));
}
test('stopped backup restores exact logical/History hashes and Undo with only release inputs', async t => {
  const f = await setup(t), expected = await populate(f);
  const backup = await backupStopped({ ...f.settings, release: f.release, probe: f.probe, ownedFormat2: f.owned });
  await verifyBackup(backup.target);
  assert.equal((await readdir(path.join(backup.target, 'catalogue'))).length, 1);
  const target = path.join(f.root, 'clean'), owned = options(path.join(f.root, 'clean-catalogue'));
  let decisions = 0;
  await restoreStopped({ ...f.settings, backup: backup.target, dataDir: target, release: f.release, probe: f.probe,
    ownedFormat2: owned, assertRestoreAllowed: async pickers => { decisions++; assert.deepEqual(pickers, [f.owned.pickerId]); } });
  assert.equal(decisions, 2);
  const restored = await opened(target, owned); t.after(() => restored.close());
  sameLogical(await restored.backup(), expected);
  const original = await opened(f.dataDir, f.owned); t.after(() => original.close());
  const pack = JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, 'backups/archives/archive-0000000000000001.json.gz'))));
  for (const row of pack.snapshots) assert.deepEqual(await restored.readBackup(row.id), await original.readBackup(row.id));
  const revision = restored.getInfo().revision;
  const command = { type: 'undo' };
  assert.deepEqual(await restored.command(command, revision), await original.command(command, revision));
});
test('online capture drains an in-flight write and blocks the next write through publication', async t => {
  const f = await setup(t);
  let entered, resume;
  const hook = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { resume = resolve; });
  let block = false;
  const store = await opened(f.dataDir, f.owned, { beforeCommit: async () => { if (block) { entered(); await pending; block = false; } } });
  t.after(() => store.close()); await f.bind(f.dataDir); block = true;
  const first = store.command(commands[0], 0); await hook;
  let next;
  const capture = snapshotStore(f.dataDir, id, { step: async label => {
    if (label === 'capture.owned-base') {
      assert(storeWriteBlocked(f.dataDir));
      next = store.command(commands[1], 1);
      assert.equal(store.getInfo().revision, 1);
    }
  } });
  resume(); const expected = { state: await first }; await capture; await next;
  const root = snapshotPath(f.dataDir, id); t.after(() => rm(path.dirname(root), { recursive: true, force: true }));
  await verifyOwnedClosure(root, ['store']);
  const captured = await opened(path.join(root, 'store'), await ownedRecoveryOptions(path.join(root, 'store')));
  t.after(() => captured.close()); sameLogical(await captured.backup(), expected);
  await captured.close();
  assert.equal(store.getInfo().revision, 2);
  const delivered = await captureOnline({ settings: f.settings, release: f.release,
    request: async (_release, _route, _method, body) => {
      await cp(root, snapshotPath(f.dataDir, body.id), { recursive: true });
      await atomic(path.join(snapshotPath(f.dataDir, body.id), 'complete.json'), encode({ id: body.id, heldMs: 0 }));
      return { id: body.id, heldMs: 0 };
    } });
  await verifyOwnedClosure(path.dirname(delivered.dataDir), ['store']); await delivered.cleanup();
});
test('owned capture reports hold-duration fields in its response and published completion record', async t => {
  const f = await setup(t), store = await opened(f.dataDir, f.owned); await f.bind(f.dataDir);
  assert.equal((await json(path.join(f.dataDir, 'state.json'))).storage.schemaVersion, 2);
  const result = await snapshotStore(f.dataDir, id);
  const root = snapshotPath(f.dataDir, id), complete = await json(path.join(root, 'complete.json'));
  for (const record of [result, complete]) {
    assert.deepEqual(Object.keys(record), ['id', 'heldMs']);
    assert.equal(record.id, id);
    assert(Object.hasOwn(record, 'heldMs'));
    assert.equal(typeof record.heldMs, 'number');
  }
  await verifyOwnedClosure(root, ['store']);
  assert.equal(storeWriteBlocked(f.dataDir), false);
  await store.close();
});
test('owned capture admits the complete pinned payload only above the protected reserve', async t => {
  const f = await setup(t); await populate(f);
  await mkdir(path.join(f.dataDir, 'warm-store'));
  await writeFile(path.join(f.dataDir, 'warm-store', 'ignored.bin'), Buffer.alloc(4096));
  await writeFile(path.join(f.dataDir, 'plugin-items.json'), encode({ synthetic: true }));
  const files = await inventory(f.dataDir, { ignoreRoot: SNAPSHOT_EXCLUSIONS });
  assert(files.some(row => row.path.startsWith('history/')));
  assert(files.some(row => row.path.startsWith('backups/archives/')));
  const base = path.join(f.owned.catalogueRoot, `catalogue-${fixture().pin.sha256}.json.gz`);
  const payload = files.reduce((sum, row) => sum + BigInt(row.bytes ?? 0), 0n)
    + BigInt((await readFile(f.dataDir + '.dataset.json')).length) + BigInt((await readFile(base)).length);
  const reserve = 64n * 1024n * 1024n, target = snapshotPath(f.dataDir, id);
  const before = await inventory(f.dataDir);
  let available = reserve + payload - 1n, checks = 0, copied = 0;
  const mock = t.mock.method(fs, 'statfs', async (root, options) => {
    checks++; assert.equal(root, path.dirname(target)); assert.deepEqual(options, { bigint: true });
    assert.equal(await exists(target), false);
    return { bavail: available, bsize: 1n };
  });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  t.after(() => rm(path.dirname(target), { recursive: true, force: true }));
  const capture = () => snapshotStore(f.dataDir, id, { ownedFormat2: f.owned,
    step: async label => { if (label === 'capture.owned-base') copied++; } });
  await assert.rejects(capture(), /Insufficient free space for recovery work and reserve/);
  assert.equal(checks, 1); assert.equal(copied, 0); assert.equal(await exists(target), false);
  assert.deepEqual(await inventory(f.dataDir), before);
  available++;
  await capture();
  assert.equal(checks, 2); assert.equal(copied, 1);
  await verifyOwnedClosure(target, ['store']);
  assert(await exists(path.join(target, 'complete.json')));
  assert.deepEqual(await inventory(f.dataDir), before);
});
test('service capture refuses a stopped owned store without a catalogue source before publication', async t => {
  const f = await setup(t), multiPicker = { registryDir: path.join(f.root, 'registry'), pickerRoot: path.join(f.root, 'pickers'), tombstoneDir: path.join(f.root, 'ledger') };
  await mkdir(f.dataDir);
  const registry = await openRegistry({ ...multiPicker, legacyDir: f.dataDir });
  try {
    const picker = (await registry.firstLogin('discord', 'synthetic-stopped')).picker;
    const dir = registry.pickerDirectory(picker.id);
    const initialState = { ...createGroupState(picker.memberIds.map(id => ({ id, name: 'Synthetic member' }))),
      tasks: fixture().base.tasks, identityRegistry: fixture().base.identityRegistry };
    const store = await opened(dir, { ...f.owned, pickerId: picker.id }, { initialState });
    await store.close(); await f.bind(dir);
    assert.equal((await json(path.join(dir, 'state.json'))).storage.schemaVersion, 2);
    assert.deepEqual(await recoverySources([dir]), [null]);
    const before = await inventory(dir), binding = await readFile(dir + '.dataset.json'), steps = [];
    await assert.rejects(captureServiceCheckpoint({ settings: { ...f.settings, multiPicker }, registry, id,
      spaceCheck: async () => {}, step: async label => { steps.push(label); } }), /Owned recovery dependency closure is missing/);
    assert(steps.includes('capture.registry'));
    assert.equal(steps.includes('capture.manifest'), false);
    assert.equal(steps.includes('capture.complete'), false);
    assert.equal(await exists(snapshotPath(f.dataDir, id)), false);
    assert.deepEqual(await inventory(dir), before);
    assert.deepEqual(await readFile(dir + '.dataset.json'), binding);
    assert.equal(storeWriteBlocked(dir), false);
  } finally { await registry.close(); }
});
test('verifier refuses missing/corrupt bases, static and History dependencies even with rehashed inventories', async t => {
  const f = await setup(t); await populate(f);
  const backup = await backupStopped({ ...f.settings, release: f.release, probe: f.probe, ownedFormat2: f.owned });
  const dependencies = (await inventory(backup.target)).filter(row => !row.directory
    && /^(catalogue|store\/(?:static|history))\//.test(row.path));
  assert(dependencies.some(row => row.path.startsWith('catalogue/')));
  assert(dependencies.some(row => row.path.startsWith('store/history/')));
  for (const row of dependencies) {
    const file = path.join(backup.target, row.path), bytes = await readFile(file);
    await rm(file); await assert.rejects(verifyBackup(backup.target));
    await writeFile(file, 'corrupt');
    const manifest = await json(path.join(backup.target, 'manifest.json'));
    await atomic(path.join(backup.target, 'manifest.json'), encode({ ...manifest, files: (await inventory(backup.target)).filter(row => row.path !== 'manifest.json') }));
    await assert.rejects(verifyBackup(backup.target)); await writeFile(file, bytes);
    await atomic(path.join(backup.target, 'manifest.json'), encode({ ...manifest, files: (await inventory(backup.target)).filter(row => row.path !== 'manifest.json') }));
  }
});
test('release-scoped probe refuses null History and invalid event invariants before capture completion', async t => {
  const f = await setup(t); await populate(f);
  const relative = (await inventory(f.dataDir)).find(row => row.path.startsWith('history/') && !row.directory).path;
  const original = JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, relative))));
  const config = path.join(f.root, 'probe-config.json'), output = path.join(f.root, 'refused-portable.json');
  await writeFile(config, encode({ coreRoot: fileURLToPath(new URL('../', import.meta.url)), datasetId: 'open-f2p' }));
  let probes = 0;
  const validateCapture = async dir => {
    probes++;
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/linux/probe.mjs', import.meta.url)), config, dir, output],
      { stdio: 'pipe', windowsHide: true });
  };
  for (const events of [[null], [{ ...original.events[0], id: 'synthetic-invalid-event' }]]) {
    const bytes = gzipSync(encode({ ...original, events }));
    await writeFile(path.join(f.dataDir, relative), bytes);
    await assert.rejects(snapshotStore(f.dataDir, id, { ownedFormat2: { ...f.owned, validateCapture } }), /Recovery probe refused/);
    assert.equal(await exists(snapshotPath(f.dataDir, id)), false);
    assert.equal(await exists(output), false);
    assert.equal(storeWriteBlocked(f.dataDir), false);
  }
  assert.equal(probes, 2);
});
test('detached verification refuses changed History bytes against capture-time pins', async t => {
  const f = await setup(t); await populate(f);
  const backup = await backupStopped({ ...f.settings, release: f.release, probe: f.probe, ownedFormat2: f.owned });
  const closure = await json(path.join(backup.target, 'owned-closure.json'));
  assert.equal(closure.validated, true);
  const pin = closure.files.find(row => row.path.startsWith('store/history/'));
  assert(pin); assert(closure.files.some(row => row.path.startsWith('catalogue/')));
  assert.deepEqual(closure.files, (await inventory(backup.target)).filter(row => !row.directory
    && (row.path.startsWith('store/') || row.path === 'store.dataset.json' || row.path.startsWith('catalogue/'))));
  for (const row of closure.files) { assert(Number.isSafeInteger(row.bytes)); assert.match(row.sha256, /^[a-f0-9]{64}$/); }
  const file = path.join(backup.target, pin.path), bytes = await readFile(file);
  assert.equal(pin.sha256, sha(bytes)); assert.equal(pin.bytes, bytes.length);
  const segment = JSON.parse(gunzipSync(bytes)); segment.events[0].at = '2026-01-02T00:00:00.000Z';
  await writeFile(file, gzipSync(encode(segment)));
  // Rehash the outer transport inventory: the independent validation pins must
  // still refuse the changed segment, without loading any release validators.
  const manifest = await json(path.join(backup.target, 'manifest.json'));
  await atomic(path.join(backup.target, 'manifest.json'), encode({ ...manifest,
    files: (await inventory(backup.target)).filter(row => row.path !== 'manifest.json') }));
  await assert.rejects(verifyOwnedClosure(backup.target, ['store']), /dependency hash or size mismatch/);
  await assert.rejects(verifyBackup(backup.target), /dependency hash or size mismatch/);
});
test('owned capture refuses dependency changes after the release probe passes', async t => {
  const f = await setup(t), store = await opened(f.dataDir, f.owned); await f.bind(f.dataDir);
  const source = await inventory(f.dataDir);
  await assert.rejects(snapshotStore(f.dataDir, id, { step: async label => {
    if (label === 'capture.owned-validated') {
      const file = path.join(snapshotPath(f.dataDir, id), 'store', 'state.json');
      await writeFile(file, (await readFile(file, 'utf8')) + '\n');
    }
  } }), /dependency hash or size mismatch after validation/);
  assert.equal(await exists(snapshotPath(f.dataDir, id)), false);
  assert.deepEqual(await inventory(f.dataDir), source);
  await store.close();
});
test('owned probe applies the release dataset before a cold store import', async t => {
  const f = await setup(t), store = await opened(f.dataDir, f.owned);
  const expected = await store.backup(); await f.bind(f.dataDir);
  await snapshotStore(f.dataDir, id); await store.close();
  const config = path.join(f.root, 'probe-config.json'), output = path.join(f.root, 'portable.json');
  await writeFile(config, encode({ coreRoot: fileURLToPath(new URL('../', import.meta.url)), datasetId: 'open-f2p' }));
  const previous = process.env.RS3_DATASET;
  try {
    process.env.RS3_DATASET = 'synthetic-conflicting-dataset';
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/linux/probe.mjs', import.meta.url)), config,
      path.join(snapshotPath(f.dataDir, id), 'store'), output], { stdio: 'pipe', windowsHide: true });
    sameLogical(await json(output), expected);
  } finally {
    if (previous === undefined) delete process.env.RS3_DATASET; else process.env.RS3_DATASET = previous;
  }
});
test('interrupted closure never publishes complete or replaces an existing capture', async t => {
  const f = await setup(t), store = await opened(f.dataDir, f.owned); t.after(() => store.close()); await f.bind(f.dataDir);
  for (const fail of ['capture.owned-base', 'capture.owned-dependencies-durable', 'capture.owned-manifest', 'capture.owned-complete']) {
    await assert.rejects(snapshotStore(f.dataDir, id, { step: async label => { if (label === fail) throw new Error('Synthetic interruption'); } }), /Synthetic interruption/);
    assert.equal(await exists(snapshotPath(f.dataDir, id)), false);
  }
  await snapshotStore(f.dataDir, id); const before = await inventory(snapshotPath(f.dataDir, id));
  await assert.rejects(snapshotStore(f.dataDir, id), { code: 'EEXIST' }); assert.deepEqual(await inventory(snapshotPath(f.dataDir, id)), before);
  t.after(() => rm(path.dirname(snapshotPath(f.dataDir, id)), { recursive: true, force: true }));
});
test('raw owned restore refuses without a live deletion authority or when that authority rejects it', async t => {
  const f = await setup(t); await populate(f);
  const backup = await backupStopped({ ...f.settings, release: f.release, probe: f.probe, ownedFormat2: f.owned });
  const target = path.join(f.root, 'deleted');
  const args = { ...f.settings, backup: backup.target, dataDir: target, release: f.release, probe: f.probe, ownedFormat2: f.owned };
  await assert.rejects(restoreStopped(args), /tombstone authority/);
  await assert.rejects(restoreStopped({ ...args, assertRestoreAllowed: async () => { throw new Error('Synthetic tombstone'); } }), /Synthetic tombstone/);
  assert.equal(await exists(target), false);
});
test('service restore resumes after legacy cleanup, retains tombstones and installs bases first', async t => {
  const f = await setup(t), multiPicker = { registryDir: path.join(f.root, 'registry'), pickerRoot: path.join(f.root, 'pickers'), tombstoneDir: path.join(f.root, 'ledger') };
  await mkdir(f.dataDir);
  const registry = await openRegistry({ ...multiPicker, legacyDir: f.dataDir }); t.after(() => registry.close());
  const legacy = await registry.registerLegacy({ memberIds: ['member-1', 'member-2'], accounts: [], droppedMemberships: 0 });
  const live = (await registry.firstLogin('discord', 'synthetic-live')).picker;
  const deleted = (await registry.firstLogin('discord', 'synthetic-deleted')).picker;
  const expected = new Map();
  for (const picker of [legacy, live, deleted]) {
    const dir = registry.pickerDirectory(picker.id);
    const initialState = { ...createGroupState(picker.memberIds.map(id => ({ id, name: 'Synthetic member' }))),
      tasks: fixture().base.tasks, identityRegistry: fixture().base.identityRegistry };
    const store = await opened(dir, picker === legacy ? false : { ...f.owned, pickerId: picker.id }, { initialState });
    await store.command(commands.at(-1), 0); expected.set(picker.id, await store.backup()); await store.close(); await f.bind(dir);
  }
  const settings = { ...f.settings, multiPicker };
  const clockReads = [], steps = [];
  const capture = await captureServiceCheckpoint({ settings, registry, id, ownedFormat2: f.owned, spaceCheck: async () => {},
    step: async label => { steps.push(label); }, ownedBarrierNow: () => {
      clockReads.push({ phase: steps.at(-1), blocked: [legacy, live, deleted].map(p => storeWriteBlocked(registry.pickerDirectory(p.id))) });
      return performance.now();
    } });
  const source = snapshotPath(f.dataDir, id); t.after(() => rm(path.dirname(source), { recursive: true, force: true }));
  assert.deepEqual(clockReads, [{ phase: undefined, blocked: [false, false, false] },
    { phase: 'capture.complete', blocked: [true, true, true] }]);
  const complete = await json(path.join(source, 'complete.json'));
  assert.deepEqual(Object.keys(capture), Object.keys(complete));
  for (const record of [capture, complete]) {
    assert(Object.hasOwn(record, 'heldMs')); assert.equal(typeof record.heldMs, 'number');
    assert(Object.hasOwn(record, 'globalBarrierMs')); assert.equal(typeof record.globalBarrierMs, 'number');
    assert.equal(record.pickerBarriers.length, 3);
    for (const barrier of record.pickerBarriers) assert.deepEqual(Object.keys(barrier), ['id', 'heldMs']);
  }
  await verifyServiceBackup(source);
  const published = await publishServiceBackup({ source, settings, release: f.release, assertRelease: async () => {} });
  assert.equal((await verifyBackup(published.target)).releasePointerSha256, sha(f.release.pointerBytes));
  await registry.beginPickerDeletion(deleted.id);
  const ledger = await readFile(path.join(multiPicker.tombstoneDir, 'ledger.json'));
  await registry.close();
  const destination = path.join(f.root, 'clean'); await mkdir(destination);
  const target = { ...settings, dataDir: path.join(destination, 'legacy'), controlDir: path.join(destination, 'control'),
    multiPicker: { ...multiPicker, registryDir: path.join(destination, 'registry'), pickerRoot: path.join(destination, 'pickers') } };
  const owned = options(path.join(destination, 'catalogue'));
  const restore = { settings: target, backup: source, release: f.release, assertStopped: async () => {}, probe: f.probe, ownedFormat2: owned };
  const legacyStage = path.join(target.controlDir, 'service-restore', legacy.id);
  await assert.rejects(restoreServiceStopped({ ...restore, step: async label => {
    if (label === 'restore.stage-reset') {
      assert.equal(await exists(legacyStage), false);
      assert(await exists(path.join(target.dataDir, 'state.json')));
      throw new Error('Synthetic interruption after legacy cleanup');
    }
  } }), /Synthetic interruption after legacy cleanup/);
  const result = await restoreServiceStopped(restore);
  assert.equal(result.excluded, 1); assert.equal(result.quarantined.length, 0);
  assert.equal(await exists(legacyStage), false);
  const resumedComplete = await restoreServiceStopped(restore);
  assert.deepEqual(resumedComplete, result);
  assert.equal(await exists(path.join(target.multiPicker.pickerRoot, deleted.id)), false);
  const restored = await opened(path.join(target.multiPicker.pickerRoot, live.id), { ...owned, pickerId: live.id });
  t.after(() => restored.close()); sameLogical(await restored.backup(), expected.get(live.id));
  const restoredLedger = await json(path.join(multiPicker.tombstoneDir, 'ledger.json'));
  assert(restoredLedger.pickers.some(row => row.pickerId === deleted.id));
  assert.equal(restoredLedger.issuedPickerIds.length, JSON.parse(ledger).issuedPickerIds.length);
  const installed = await json(path.join(target.multiPicker.registryDir, 'registry.json'));
  assert.equal(installed.pickers.find(row => row.id === deleted.id)?.lifecycle, 'deleted');
});

test('owned quarantine retains its closure and releases only after restaged verification', async t => {
  const f = await setup(t), multiPicker = { registryDir: path.join(f.root, 'registry'),
    pickerRoot: path.join(f.root, 'pickers'), tombstoneDir: path.join(f.root, 'ledger') };
  await mkdir(f.dataDir);
  const registry = await openRegistry({ ...multiPicker, legacyDir: f.dataDir }); t.after(() => registry.close());
  const legacy = await registry.registerLegacy({ memberIds: ['member-1', 'member-2'], accounts: [], droppedMemberships: 0 });
  const owned = (await registry.firstLogin('discord', 'synthetic-quarantine')).picker;
  let expected;
  for (const picker of [legacy, owned]) {
    const dir = registry.pickerDirectory(picker.id), store = await opened(dir,
      picker === legacy ? false : { ...f.owned, pickerId: picker.id },
      { initialState: { ...createGroupState(picker.memberIds.map(id => ({ id, name: 'Synthetic member' }))),
        tasks: fixture().base.tasks, identityRegistry: fixture().base.identityRegistry } });
    if (picker === owned) expected = await store.backup();
    await store.close(); await f.bind(dir);
  }
  const settings = { ...f.settings, multiPicker };
  await captureServiceCheckpoint({ settings, registry, id, ownedFormat2: f.owned, spaceCheck: async () => {} });
  const backup = snapshotPath(f.dataDir, id); t.after(() => rm(path.dirname(backup), { recursive: true, force: true }));
  await registry.close();
  const destination = path.join(f.root, 'clean'); await mkdir(destination);
  const target = { ...settings, dataDir: path.join(destination, 'legacy'), controlDir: path.join(destination, 'control'),
    multiPicker: { ...multiPicker, registryDir: path.join(destination, 'registry'), pickerRoot: path.join(destination, 'pickers') } };
  let failing = true, ownedProbes = 0;
  const probe = async (...args) => {
    const source = await ownedRecoveryOptions(args[1]);
    if (source) {
      ownedProbes++; assert.equal(source.pickerId, owned.id);
      if (failing) throw new Error('Synthetic temporary probe failure');
    }
    return f.probe(...args);
  };
  const restored = await restoreServiceStopped({ settings: target, backup, release: f.release,
    assertStopped: async () => {}, probe, ownedFormat2: options(path.join(destination, 'catalogue')) });
  assert.deepEqual(restored.quarantined, [owned.id]); assert.equal(ownedProbes, 1);
  const quarantine = path.join(target.controlDir, 'quarantine'), metadata = path.join(quarantine, owned.id + '.owned');
  const closure = path.join(metadata, 'owned-closure.json'), bytes = await readFile(closure);
  assert(await exists(path.join(metadata, 'catalogue')));
  assert.equal(await exists(path.join(target.controlDir, 'service-restore', owned.id)), false);
  assert.equal((await json(path.join(quarantine, owned.id + '.json'))).ownedFormat2, true);
  const release = { settings: target, id: owned.id, release: f.release, assertStopped: async () => {}, probe };
  failing = false;
  const before = await inventory(path.join(quarantine, owned.id));
  await rm(closure);
  await assert.rejects(releaseServiceQuarantine(release), /Owned quarantine dependency closure is missing; release refused/);
  assert.equal(ownedProbes, 1);
  assert.deepEqual(await inventory(path.join(quarantine, owned.id)), before);
  assert.deepEqual(await readdir(path.join(target.multiPicker.pickerRoot, owned.id)), ['operator-quarantine.json']);
  await writeFile(closure, bytes);
  // A valid marker alone is insufficient: its dependency pins remain binding.
  const base = (await readdir(path.join(metadata, 'catalogue')))[0], baseFile = path.join(metadata, 'catalogue', base);
  const baseBytes = await readFile(baseFile); await writeFile(baseFile, 'synthetic-corruption');
  await assert.rejects(releaseServiceQuarantine(release), /Owned dependency hash or size mismatch/);
  assert.equal(ownedProbes, 1); await writeFile(baseFile, baseBytes);
  assert.deepEqual(await releaseServiceQuarantine(release), { released: owned.id });
  assert.equal(ownedProbes, 2);
  const store = await opened(path.join(target.multiPicker.pickerRoot, owned.id),
    { ...options(path.join(destination, 'catalogue')), pickerId: owned.id });
  sameLogical(await store.backup(), expected); await store.close();
  assert.equal(await exists(metadata), false);
  assert.equal(await exists(path.join(quarantine, owned.id + '.json')), false);
  assert.deepEqual(await releaseServiceQuarantine(release), { released: owned.id });
  assert.equal(ownedProbes, 2);
});

test('flag-off capture and dependency guards never parse whole storage-1 state or retained documents', async t => {
  const f = await setup(t), store = await opened(f.dataDir, false); await store.close(); await f.bind(f.dataDir);
  const document = await json(path.join(f.dataDir, 'state.json'));
  document.state.legacy = { synthetic: { storage: { schemaVersion: 2 }, padding: 'x'.repeat(65536),
    escaped: '\\"storage\\":{\\"schemaVersion\\":2}' } };
  document.storage ??= { schemaVersion: 1, fields: {} };
  const bytes = encode(document), retained = encode({ synthetic: 'opaque-retained-document' });
  await writeFile(path.join(f.dataDir, 'state.json'), bytes);
  await mkdir(path.join(f.dataDir, 'backups'), { recursive: true });
  await writeFile(path.join(f.dataDir, 'backups', 'synthetic.json.gz'), gzipSync(retained));
  const parse = JSON.parse, parsed = [];
  t.mock.method(JSON, 'parse', (text, ...rest) => {
    if (text === bytes || text === retained) parsed.push(text);
    return parse(text, ...rest);
  });
  assert.equal(await hasOwnedStorage(path.join(f.dataDir, 'state.json')), false);
  await snapshotStore(f.dataDir, id);
  const root = snapshotPath(f.dataDir, id);
  assert.equal(await verifyOwnedClosure(root, ['store']), null);
  assert.equal(await captureOwnedClosure(root, ['store'], [null]), false);
  const picker = 'p_' + '1'.repeat(32), registry = { withRecoveryCheckpoint: work => work(registryRecoveryDocument({ schemaVersion: 1, accounts: [], capabilities: [],
    pickers: [{ id: picker, kind: 'legacy-shared', ownerAccountId: null, lifecycle: 'active', provisioning: 'ready', memberIds: ['member-1', 'member-2'], createdAt: now() }] })) };
  const multiPicker = { registryDir: path.join(f.root, 'registry'), pickerRoot: path.join(f.root, 'pickers'), tombstoneDir: path.join(f.root, 'ledger') };
  const serviceId = '00000000-0000-4000-8000-000000000002';
  await captureServiceCheckpoint({ settings: { ...f.settings, multiPicker }, registry, id: serviceId, spaceCheck: async () => {} });
  await verifyServiceBackup(snapshotPath(f.dataDir, serviceId));
  assert.deepEqual(parsed, []);
  assert.equal(await readFile(path.join(root, 'store', 'state.json'), 'utf8'), bytes);
});
test('off-site success requires verification of the remotely restored owned closure', async t => {
  const f = await setup(t); await populate(f);
  await backupStopped({ ...f.settings, release: f.release, probe: f.probe, ownedFormat2: f.owned });
  const snapshotId = 'c'.repeat(64), time = now();
  let staged, tag, corrupt = false, pinged = 0;
  const run = async args => {
    if (args[0] === 'snapshots') return encode(args.includes('--tag') ? [] : [{ id: snapshotId, time, tags: ['chunk-picker', tag] }]);
    if (args[0] === 'backup') { staged = args.at(-2); tag = args[args.lastIndexOf('--tag') + 1]; return JSON.stringify({ message_type: 'summary', snapshot_id: snapshotId }) + '\n'; }
    if (args[0] === 'restore') {
      const target = path.join(args[args.indexOf('--target') + 1], path.relative(path.parse(staged).root, staged));
      await cp(staged, target, { recursive: true });
      if (corrupt) await writeFile(path.join(target, 'catalogue', `catalogue-${fixture().pin.sha256}.json.gz`), 'corrupt');
      return '';
    }
    throw new Error('Unexpected synthetic repository operation');
  };
  // Pin the capture time independently of job time, just as the production job does.
  const backup = (await readdir(f.settings.backupDir))[0], manifestFile = path.join(f.settings.backupDir, backup, 'manifest.json');
  await atomic(manifestFile, encode({ ...await json(manifestFile), snapshotAt: time }));
  const args = { settings: f.settings, config: {}, run, bundle: async ({ output }) => mkdir(output),
    releaseReader: async () => f.release, ping: async () => { pinged++; }, now: () => Date.parse(time) };
  await offhostBackup(args); assert.equal(pinged, 1);
  corrupt = true; await assert.rejects(offhostBackup(args)); assert.equal(pinged, 1);
  assert.equal((await json(path.join(f.settings.controlDir, 'offhost-status.json'))).result, 'failed');
});
test('flag-off format-1 raw, service and stopped artifacts are byte-identical to origin/main', async t => {
  const f = await setup(t), reference = path.join(f.root, 'reference'); await mkdir(reference);
  const archive = path.join(f.root, 'reference.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, 'origin/main', 'app', 'scripts']);
  execFileSync('tar', ['-xf', archive, '-C', reference]);
  const load = file => import(pathToFileURL(path.join(reference, file)).href);
  const old = await load('app/storage/store.mjs'), snapshot = await load('app/storage/snapshot.mjs');
  const recovery = await load('scripts/linux/recovery.mjs'), service = await load('scripts/linux/service-checkpoint.mjs');
  t.mock.method(performance, 'now', () => 0);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now()) });
  const roots = [];
  for (const [index, api] of [old, { openStore }].entries()) {
    const dataDir = path.join(f.root, 'flat-' + index);
    const store = await api.openStore({ dataDir, initialState: fixture().state, now, retention: false });
    await store.close(); await writeFile(path.join(dataDir, 'access-token'), Buffer.alloc(32, 1).toString('base64url') + '\n');
    await f.bind(dataDir); roots.push(dataDir);
  }
  const compare = async (left, right) => assert.deepEqual(await inventory(left), await inventory(right));
  await compare(roots[0], roots[1]);
  await snapshot.snapshotStore(roots[0], id); await snapshotStore(roots[1], id);
  await compare(snapshotPath(roots[0], id), snapshotPath(roots[1], id));
  const probe = async (_release, dir, output) => { const bytes = await readFile(path.join(dir, 'state.json')); await writeFile(output, bytes); return JSON.parse(bytes); };
  const before = await recovery.backupStopped({ ...f.settings, dataDir: roots[0], release: f.release, probe });
  const after = await backupStopped({ ...f.settings, dataDir: roots[1], release: f.release, probe });
  await compare(before.target, after.target);
  const pick = 'p_' + '1'.repeat(32), document = { schemaVersion: 1, accounts: [], capabilities: [],
    pickers: [{ id: pick, kind: 'legacy-shared', ownerAccountId: null, lifecycle: 'active', provisioning: 'ready', memberIds: ['member-1', 'member-2'], createdAt: now() }] };
  const registry = { withRecoveryCheckpoint: work => work(structuredClone(document)) };
  const multi = index => ({ registryDir: path.join(f.root, 'registry-' + index), pickerRoot: path.join(f.root, 'pickers-' + index), tombstoneDir: path.join(f.root, 'ledger-' + index) });
  const serviceId = '00000000-0000-4000-8000-000000000002';
  await service.captureServiceCheckpoint({ settings: { dataDir: roots[0], multiPicker: multi(0) }, registry, id: serviceId, spaceCheck: async () => {} });
  await captureServiceCheckpoint({ settings: { dataDir: roots[1], multiPicker: multi(1) }, registry, id: serviceId, spaceCheck: async () => {} });
  await compare(snapshotPath(roots[0], serviceId), snapshotPath(roots[1], serviceId));
  for (const root of roots) t.after(() => rm(path.dirname(snapshotPath(root, id)), { recursive: true, force: true }));
});
