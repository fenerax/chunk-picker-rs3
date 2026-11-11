import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { effects, installEffects, chown, lstat, symlink } from './helpers/linux-ops-effects.mjs';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';

// Load production algorithms only after installing the same controlled disk,
// process and lock boundary used by linux-tools-install. One runner hang guard.
process.env.RS3_DATASET = 'open-starter';
const restoreEffects = installEffects();
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.UTC(2026, 0, 1) });
after(() => { restoreEffects(); mock.timers.reset(); });
await import('../app/dataset-runtime.mjs');
const { withDirectoryBarriers, withStoreWrite, snapshotStore, snapshotPath } = await import('../app/storage/snapshot.mjs');
const { openRegistry, registryRecoveryDocument } = await import('../app/storage/registry.mjs');
const { createPickerCheckpoint } = await import('../app/picker-router-checkpoint.mjs');
const { captureServiceCheckpoint, verifyServiceBackup, copyServiceTree } = await import('../scripts/linux/service-checkpoint.mjs');
const { pluginItemFiles } = await import('../app/plugin-items.mjs');
const { restoreServiceStopped, listServicePickers, releaseServiceQuarantine, reconcileServiceRecoveryTombstones } = await import('../scripts/linux/service-recovery.mjs');
const { atomic, copyTree, encode, exists, inventory, json, sha } = await import('../scripts/linux/files.mjs');
const { readRelease } = await import('../scripts/linux/runtime.mjs');
const { assertServiceStopped, repairServiceOwnership, runServiceOperator, serviceBackup, serviceBackupWarnings } = await import('../scripts/linux/service-operator.mjs');
const { readBackupStatus } = await import('../app/storage/backup-status.mjs');
const { checkStart } = await import('../scripts/linux/start-check.mjs');

const { createGroupState, exportBackup } = await import('../app/core/state.mjs');
const { createServer } = await import('../app/server.mjs');
const { resolveDataset } = await import('../app/datasets.mjs');
const { bindDatasetStorage } = await import('../app/dataset-binding.mjs');
const { openStore } = await import('../app/storage/store.mjs');
const dataset = await resolveDataset({ datasetId: 'open-starter' });
const reconcile = async () => {};
const stopped = async () => {};
mock.method(globalThis, 'fetch', async () => { throw Error('Network is forbidden in Linux ops contracts'); });

async function application(options) {
  let handler;
  const app = await createServer({ ...options, retention: false, predictionPrewarm: false,
    taskWorkerOptions: { residency: false }, httpServer: new EventEmitter(), httpLoopbackServer: new EventEmitter(),
    onRequestHandler: value => { handler = value; } });
  const request = async (route, { method = 'GET', headers = {}, body, publicListener = false } = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: route, complete: true, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost', ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) } });
    const chunks = [], values = new Map();
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.setHeader = (key, value) => values.set(key.toLowerCase(), value);
    res.getHeader = key => values.get(key.toLowerCase()); res.removeHeader = key => values.delete(key.toLowerCase());
    res.writeHead = (status, headers = {}) => { res.statusCode = status; res.headersSent = true; for (const [key, value] of Object.entries(headers)) res.setHeader(key, value); };
    const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
    try {
      await handler(req, res, { host: '127.0.0.1', ingressRole: publicListener ? 'public' : 'private' }); await finished;
      return { status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    } finally { req.destroy(); res.destroy(); }
  };
  return { app, request };
}

// Recovery checks the actual pinned bytes, so two invented files are sufficient.
// Decoder checks below inject the real in-process store decoder explicitly.
const releaseRoot = await mkdtemp(path.join(tmpdir(), 'linux-multi-release-'));
after(() => rm(releaseRoot, { recursive: true, force: true }));
await mkdir(path.join(releaseRoot, 'app'));
await writeFile(path.join(releaseRoot, 'app/server.mjs'), 'export {};\n');
await writeFile(path.join(releaseRoot, 'package.json'), '{"type":"module"}\n');

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
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup(); await registry?.close();
    assert.equal(effects.handles.size, 0, 'fixture closes every descriptor');
    await rm(root, { recursive: true, force: true }); await rm(settings.dataDir + '.snapshots', { recursive: true, force: true });
  });
  const close = async () => { await registry?.close(); registry = null; };
  const dir = picker => picker.kind === 'legacy-shared' ? settings.dataDir : path.join(settings.multiPicker.pickerRoot, picker.id);
  const capture = async (options = {}) => { const id = randomUUID(); await captureServiceCheckpoint({ settings, registry, id, minFreeBytes: 0, ...options }); return snapshotPath(settings.dataDir, id); };
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
  const held = Promise.withResolvers(), copy = Promise.withResolvers(); let capturing;
  for (const picker of f.pickers.slice(1)) {
    const ready = Promise.withResolvers(); started.push(ready.promise);
    const dir = f.dir(picker);
    // Replace synthetic credentials before asking a real store decoder to open.
    for (const name of ['accounts.json', 'invites.json', 'plugin-keys.json', 'access-token', 'overlays.json', 'future-secret.json']) await rm(path.join(dir, name));
    stores.push(await openStore({ dataDir: dir, beforeCommit: async () => { ready.resolve(); await finish.promise; }, retention: false }));
  }
  f.cleanup(async () => { finish.resolve(); copy.resolve(); await capturing?.catch(() => {}); for (const store of stores) await store.close(); });
  const writes = stores.map(store => store.command({ type: 'set-rule', ruleId: 'access.shared', value: false }, 0));
  await Promise.all(started);
  capturing = f.capture({ onPhase: async (phase, detail) => {
    if (phase === 'picker-barrier' && detail.id === f.pickers[0].id) { held.resolve(); await copy.promise; }
  } });
  await held.promise;
  // Hold the legacy copy explicitly while both unrelated owned stores finish.
  const successors = stores.map(store => store.command({ type: 'set-rule', ruleId: 'access.shared', value: true }, 1));
  finish.resolve();
  await Promise.all([...writes, ...successors]); copy.resolve(); const backup = await capturing;
  const revisions = [];
  for (const picker of f.pickers.slice(1)) {
    const revision = (await json(path.join(backup, 'pickers', picker.id, 'state.json'))).state.revision;
    assert.equal(revision, 2); revisions.push(revision);
  }
  assert(stores.every(store => store.getInfo().revision === 2));
  const target = await f.target();
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
  assert.equal(result.restored, 3);
  for (const [i, picker] of f.pickers.slice(1).entries()) assert.equal((await json(path.join(target.multiPicker.pickerRoot, picker.id, 'state.json'))).state.revision, revisions[i]);
});

test('service recovery round-trips every durable plugin evidence sidecar', async t => {
  const f = await fixture(t), picker = f.pickers[1], names = ['plugin-achievements.json', ...pluginItemFiles];
  assert.deepEqual(pluginItemFiles, ['plugin-items.json', 'plugin-item-journal-beta.json', 'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']);
  for (const [index, name] of names.entries()) await writeFile(path.join(f.dir(picker), name), encode({ v: 1, players: {}, synthetic: index }));
  const backup = await f.capture(); await verifyServiceBackup(backup);
  const target = await f.target();
  await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe });
  for (const name of names) {
    assert.deepEqual(await readFile(path.join(target.multiPicker.pickerRoot, picker.id, name)), await readFile(path.join(f.dir(picker), name)), name);
  }
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

test('service checkpoints, recovery copies and resumed identity checks never traverse warm artifacts', async t => {
  const f = await fixture(t), warm = path.join(f.dir(f.pickers[1]), 'warm-store');
  await mkdir(warm);
  // An invalid entry proves exclusion before lstat/hash, without a large file
  // or a timing-dependent race with calculator publication/pruning.
  await symlink(path.join(f.root, 'missing-synthetic-artifact'), path.join(warm, 'unreadable'), 'dir');
  const backup = await f.capture();
  assert(!(await inventory(backup)).some(row => row.path.includes('warm-store')));
  const copy = path.join(f.root, 'copied-gameplay');
  await copyServiceTree(f.dir(f.pickers[1]), copy, async () => {}, 'test.copy');
  assert(!(await inventory(copy)).some(row => row.path.startsWith('warm-store')));
  const listing = await listServicePickers(f.settings);
  assert.equal(listing.pickerCount, f.pickers.length);
  const target = await f.target();
  const options = { settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe: portableProbe };
  assert.equal((await restoreServiceStopped(options)).restored, f.pickers.length);
  const restoredWarm = path.join(target.multiPicker.pickerRoot, f.pickers[1].id, 'warm-store');
  await mkdir(restoredWarm);
  await symlink(path.join(f.root, 'missing-synthetic-artifact'), path.join(restoredWarm, 'unreadable'), 'dir');
  assert.equal((await restoreServiceStopped(options)).restored, f.pickers.length, 'disposable warm files cannot change a restored store identity');
});

test('cross-directory deadline and thrown capture release every gate without abandoning accepted writes', async t => {
  const f = await fixture(t), dirs = f.pickers.map(f.dir), finish = Promise.withResolvers();
  const writing = withStoreWrite(dirs[0], () => finish.promise);
  const expired = assert.rejects(withDirectoryBarriers(dirs, stopped, { maxDrainMs: 5 }), /timed out/);
  mock.timers.tick(5); await expired;
  finish.resolve(); await writing;
  await assert.rejects(withDirectoryBarriers(dirs, async () => { throw new Error('Synthetic capture failure'); }), /capture failure/);
  await Promise.all(dirs.map(dir => withStoreWrite(dir, stopped)));
});

test('single-directory snapshots keep their original exclusion, independent directories and raw byte contract', async t => {
  const f = await fixture(t), dir = f.dir(f.pickers[0]), finish = Promise.withResolvers();
  const id = randomUUID(), writing = withStoreWrite(dir, () => finish.promise);
  const snapshot = snapshotStore(dir, id);
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
});

test('health with 50 dormant registry pickers opens none; snapshots require private master Bearer', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'linux-multi-picker-health-'));
  const multiPicker = { registryDir: path.join(root, 'registry'), pickerRoot: path.join(root, 'pickers'), tombstoneDir: path.join(root, 'ledger') };
  const dataDir = path.join(root, 'legacy'); await mkdir(dataDir);
  const registry = await openRegistry({ ...multiPicker, legacyDir: dataDir });
  for (let i = 0; i < 50; i++) await registry.firstLogin('discord', 'synthetic-' + i);
  const ids = registry.listPickers().map(p => p.id); await registry.close();
  const { app, request } = await application({ dataDir, multiPicker, initialState: createGroupState([{ id: 'one', name: 'Player 1' }, { id: 'two', name: 'Player 2' }]),
    host: '127.0.0.1', port: 0, loopbackPort: 0, loopbackRole: 'public', predictionPrewarm: false });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer ' + app.store.getAccessToken(), 'Content-Type': 'application/json' };
  for (let i = 0; i < 3; i++) {
    const health = await (await request('/api/health', { headers })).json();
    assert.equal(health.service.openContexts, 1); assert.equal(health.service.dormantContexts, 50); assert.equal(health.service.registry, 'ready');
  }
  for (const id of ids) assert.deepEqual(await readdir(path.join(multiPicker.pickerRoot, id)), []);
  for (const publicListener of [true, false]) {
    const response = await request('/api/operator/service-snapshot', { publicListener, method: 'POST', headers: publicListener ? headers : { Cookie: 'duo_access=' + app.store.getAccessToken(), 'Content-Type': 'application/json' }, body: { id: randomUUID() } });
    assert.equal(response.status, 403);
  }
  const id = randomUUID();
  const response = await request('/api/operator/service-snapshot', { method: 'POST', headers, body: { id } });
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

// Interpret only the printed repair; source bytes come from the operator's
// offline quarantine copy, checked against the instruction's literal digests.
async function followReleaseRepair(error, offline, inspection) {
  assert.equal(error?.code, 'OPERATOR_ACTION_REQUIRED', error?.message);
  assert.doesNotMatch(error.message, /from the verified backup/);
  const match = error.message.match(/^(?:Restore destination changed\. )?Move (.+) aside for inspection; (?:restore (.+) and (.+) from an offline copy of the quarantine source matching store digest ([a-f0-9]{64}) and binding SHA-256 ([a-f0-9]{64}); )?create (.+) containing only operator-quarantine.json with exactly (\{.*\}); write (.+) containing exactly (\{.*\}); recreate (.+) and write (.+) containing exactly (\{.*\}); then rerun quarantine release with the same picker and release\.$/);
  assert(match, error.message);
  const [, paths, retained, binding, storeHash, bindingHash, target, markerJSON, record, recordJSON, stage, journal, journalJSON] = match;
  await mkdir(inspection);
  for (const file of paths.split(', ')) await rename(file, path.join(inspection, randomUUID()));
  if (retained) {
    assert.equal(sha(encode(await inventory(offline))), storeHash);
    assert.equal(sha(await readFile(offline + '.dataset.json')), bindingHash);
    await copyTree(offline, retained); await copyFile(offline + '.dataset.json', binding);
  }
  await mkdir(target); await writeFile(path.join(target, 'operator-quarantine.json'), markerJSON);
  await writeFile(record, recordJSON);
  await mkdir(stage); await writeFile(journal, journalJSON);
  return paths.split(', ');
}

for (const changed of [true, false]) test(`quarantine release repair is literal after a probe that ${changed ? 'changed' : 'did not change'} its copy`, async t => {
  // Cover source, sibling store/binding, installed target, each source cleanup
  // window, and completed cleanup (including the record-free entry point).
  for (const stop of ['install.stage-directory', 'install.rename-store', 'install.rename-binding',
    'release.installed', 'release.remove-binding', 'release.remove-record', 'release.complete', null]) {
    await t.test(stop ?? 'completed release', async t => {
      const f = await fixture(t), backup = await f.capture(), settings = await f.target(), picker = f.pickers[1];
      await f.close();
      await restoreServiceStopped({ settings, backup, release: f.release, assertStopped: stopped,
        probe: async (...args) => { if (args[1].includes(picker.id)) throw new Error('Synthetic incompatibility'); return portableProbe(...args); } });
      const target = path.join(settings.multiPicker.pickerRoot, picker.id);
      const quarantine = path.join(settings.controlDir, 'quarantine', picker.id);
      const offline = path.join(f.root, 'offline-quarantine');
      await copyTree(quarantine, offline); await copyFile(quarantine + '.dataset.json', offline + '.dataset.json');
      const stage = path.join(settings.controlDir, 'release-' + picker.id), journal = path.join(stage, 'progress.json');
      let probes = 0, expected;
      const options = { settings, id: picker.id, release: f.release, assertStopped: stopped, probe: async (...args) => {
        probes++;
        if (changed) {
          const file = path.join(args[1], 'state.json'), document = await json(file);
          // The staged-binding case changes only the binding; the others
          // change only the store, proving either side counts as a migration.
          if (stop !== 'install.rename-binding') {
            document.state.members[0].name = 'Player 2';
            await writeFile(file, encode(document));
          }
          else await writeFile(args[1] + '.dataset.json', encode(await json(args[1] + '.dataset.json')) + '\n');
        }
        expected = { digest: sha(encode(await inventory(args[1]))), binding: sha(await readFile(args[1] + '.dataset.json')),
          state: sha(await readFile(path.join(args[1], 'state.json'))) };
        return portableProbe(...args);
      } };
      const fault = new Error('Injected process death');
      if (stop) await assert.rejects(releaseServiceQuarantine({ ...options, step: async label => { if (label === stop) throw fault; } }), error => error === fault);
      else await releaseServiceQuarantine(options);
      const row = await json(journal);
      assert.equal(row.probeChanged, changed); assert.equal(row.digest, expected.digest); assert.equal(row.bindingSha256, expected.binding);
      let corrupt;
      if (stop === 'install.stage-directory') corrupt = path.join(stage, 'store', 'state.json');
      else if (stop === 'install.rename-store') corrupt = path.join(row.installStage, 'store', 'state.json');
      else if (stop === 'install.rename-binding') corrupt = path.join(row.installStage, 'store.dataset.json');
      else corrupt = path.join(target, 'state.json');
      await writeFile(corrupt, '{}');
      const before = sha(encode(await inventory(path.join(settings.controlDir, 'quarantine'))));
      const error = await releaseServiceQuarantine(options).then(() => null, error => error);
      assert.equal(sha(encode(await inventory(path.join(settings.controlDir, 'quarantine')))), before, 'refusal preserves quarantine');
      const consumed = ['release.remove-binding', 'release.remove-record', 'release.complete', null].includes(stop);
      const expectedPaths = [], current = await json(journal);
      for (const file of [target, target + '.dataset.json', current.installStage, stage,
        ...(consumed ? [quarantine, quarantine + '.dataset.json'] : [])]) if (file && await exists(file)) expectedPaths.push(file);
      const paths = await followReleaseRepair(error, offline, path.join(f.root, 'inspection'));
      assert.deepEqual(paths, expectedPaths);
      assert.deepEqual(await json(journal), { id: picker.id, status: 'pending', releaseIdentity: f.release.identity });
      assert.deepEqual(await readdir(target), ['operator-quarantine.json']);
      assert.equal(sha(encode(await inventory(quarantine))), sha(encode(await inventory(offline))));
      assert.deepEqual(await releaseServiceQuarantine(options), { released: picker.id });
      assert.equal(probes, 2, 'repair re-probes the original quarantine source');
      assert.equal((await json(journal)).status, 'released');
      assert.equal(sha(encode(await inventory(target))), expected.digest);
      assert.equal(sha(await readFile(target + '.dataset.json')), expected.binding);
      assert(!await exists(quarantine)); assert(!await exists(quarantine + '.json'));
      await releaseServiceQuarantine(options); assert.equal(probes, 2);
      const store = await openStore({ dataDir: target, retention: false });
      try { assert.equal((await store.freeze()).sha256, expected.state); }
      finally { await store.close(); }
      if (stop === 'release.installed' || stop === 'release.remove-binding') t.diagnostic(error.message);
    });
  }
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
  // A used live ledger cannot boot an empty target, but stopped service recovery
  // seeds its scratch checkpoint before opening and publishes the live registry.
  await assert.rejects(openRegistry(target.multiPicker), /Restore registry\.json/);
  await assert.rejects(readFile(path.join(target.multiPicker.registryDir, 'registry.json')), { code: 'ENOENT' });
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

test('service health keeps the backup-age and disk-reserve warnings', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-service-health-')); t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { dataDir: path.join(root, 'legacy'), backupDir: path.join(root, 'backups'), minFreeBytes: 0 };
  await mkdir(settings.dataDir); await mkdir(settings.backupDir);
  const warnings = async (options = {}) => { const lines = []; await serviceBackupWarnings({ ...settings, ...options }, { write: text => lines.push(text.trim()) }); return lines; };
  assert.deepEqual(await warnings(), ['Recovery backup is missing or older than two days.']);
  const status = path.join(root, 'backup-status.json');
  await writeFile(status, JSON.stringify({ lastSuccessAt: new Date(Date.now() - 3 * 86400000).toISOString() }));
  assert.deepEqual(await warnings(), ['Recovery backup is missing or older than two days.']);
  await writeFile(status, JSON.stringify({ lastSuccessAt: new Date().toISOString() }));
  assert.deepEqual(await warnings(), []);
  assert.deepEqual(await warnings({ minFreeBytes: Number.MAX_SAFE_INTEGER }), ['Recovery disk free-space reserve is unavailable.']);
});

test('a stopped service backup reports to the admin status reader and honours the configured reserve', async t => {
  const f = await fixture(t); await f.close();
  const controller = { state: async () => ({ active: false, stopped: true }), stop: async () => {}, start: async () => {} };
  const run = settings => runServiceOperator({ settings, command: 'backup', argument: '--stopped', release: f.release, controller });
  const result = await run(f.settings);
  const status = await readBackupStatus(f.settings.dataDir);
  assert.equal(status.result, 'success'); assert.equal(status.warning, null); assert.equal(status.byteSize, result.byteSize);
  const lines = []; await serviceBackupWarnings(f.settings, { write: text => lines.push(text) }); assert.deepEqual(lines, []);
  // Capture checks the operator's reserve, not the 64 MiB default, before copying.
  await rm(path.join(f.settings.controlDir, 'maintenance.json'), { force: true });
  await assert.rejects(run({ ...f.settings, minFreeBytes: Number.MAX_SAFE_INTEGER }), /free space/i);
  const failed = await readBackupStatus(f.settings.dataDir);
  assert.equal(failed.result, 'failed'); assert.equal(failed.lastSuccessAt, status.lastSuccessAt);
  const reserves = [];
  const document = await json(path.join(f.settings.multiPicker.registryDir, 'registry.json'));
  const registry = { withRecoveryCheckpoint: work => work(registryRecoveryDocument(document)) };
  await captureServiceCheckpoint({ settings: { ...f.settings, minFreeBytes: 7 }, registry, id: randomUUID(), spaceCheck: async (_root, _bytes, reserve) => { reserves.push(reserve); } });
  assert(reserves.length && reserves.every(reserve => reserve === 7));
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
  const payload = 'tiny-pack-payload'; await writeFile(path.join(input, 'payload.json'), payload);
  const manifest = encode({ files: [{ path: 'payload.json', bytes: payload.length, sha256: sha(payload) }] });
  await writeFile(path.join(input, 'pack.json'), manifest);
  const history = path.join(f.dir(f.pickers[1]), 'history'); await mkdir(history, { recursive: true });
  const historyBytes = '{"revision":2}'; await writeFile(path.join(history, 'synthetic.json'), historyBytes);
  // A credential file outside the gameplay roots is never copied, so it is not counted.
  await writeFile(path.join(f.dir(f.pickers[1]), 'access-token'), 'excluded-synthetic-credential');
  const inputs = { data: { path: path.join(input, 'pack.json'), sha256: sha(manifest) } };
  const calls = [];
  const id = randomUUID();
  await captureServiceCheckpoint({ settings: f.settings, registry: f.registry, id, minFreeBytes: 7, inputs,
    spaceCheck: async (root, bytes, reserve) => { calls.push({ bytes, reserve }); } });
  assert(calls.length >= 1 + f.pickers.length + 1, 'checks before copying, before each picker and before each input');
  assert(calls.every(call => call.reserve === 7));
  assert(calls[0].bytes >= historyBytes.length + payload.length + Buffer.byteLength(manifest));
  assert(calls[0].bytes < 1 << 20);
  // A spool too small for the payload refuses before any copy and leaves nothing behind.
  const refused = randomUUID();
  await assert.rejects(captureServiceCheckpoint({ settings: f.settings, registry: f.registry, id: refused, minFreeBytes: 7, inputs,
    spaceCheck: async (root, bytes) => { if (bytes > historyBytes.length) throw new Error('Insufficient free space for recovery work and reserve.'); } }),
  /Insufficient free space/);
  await assert.rejects(readdir(snapshotPath(f.settings.dataDir, refused)), { code: 'ENOENT' });
});

test('restore resumes the intent window before installation and runs real decoder migrations sequentially', async t => {
  const f = await fixture(t), backup = await f.capture(), target = await f.target(); let once = false;
  let active = 0, probes = 0;
  const probe = async (_release, dataDir) => {
    assert.equal(active++, 0, 'decoder migrations never overlap'); probes++;
    const store = await openStore({ dataDir, retention: false });
    try { return await store.backup(); } finally { await store.close(); active--; }
  };
  await assert.rejects(restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile,
    probe,
    onProgress: async p => { if (!once && p.pickers.some(r => r.installing)) { once = true; throw new Error('Synthetic intent interruption'); } } }), /intent interruption/);
  const result = await restoreServiceStopped({ settings: target, backup, release: f.release, assertStopped: stopped, reconcileTombstones: reconcile, probe });
  assert.equal(result.restored, 3); assert.deepEqual(result.quarantined, []);
  assert.equal(probes, 3); assert.equal(active, 0);
});

test('online operator backup uses the private service dispatch without opening dormant pickers', async t => {
  const f = await fixture(t); await f.close();
  for (const name of ['accounts.json', 'invites.json', 'plugin-keys.json', 'access-token', 'overlays.json', 'future-secret.json']) await rm(path.join(f.settings.dataDir, name));
  const { app, request: dispatch } = await application({ dataDir: f.settings.dataDir, multiPicker: f.settings.multiPicker, host: '127.0.0.1', port: 0 });
  f.cleanup(() => app.close());
  const request = async (_release, route, method = 'GET', body) => {
    const response = await dispatch(route, { method, headers: { Authorization: 'Bearer ' + app.store.getAccessToken(), 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 200); return response.json();
  };
  const { backupOnline } = await import('../scripts/linux/operator.mjs');
  const result = await backupOnline({ settings: f.settings, release: f.release, request });
  assert.equal((await verifyServiceBackup(result.target)).pickers.length, 3);
  assert.equal((await request(f.release, '/api/health')).service.openContexts, 1);
});

test('dead local journal owners are reclaimed while live kernel guards refuse concurrent restores', async t => {
  const f = await fixture(t);
  const guardRoot = path.join(f.settings.controlDir, 'service-operation'); await mkdir(guardRoot);
  const owner = { pid: 900000001, host: hostname(), nonce: '0'.repeat(32) };
  await atomic(path.join(guardRoot, 'registry.lock'), encode(owner));
  await atomic(path.join(f.settings.controlDir, 'operation.lock'), encode(owner));
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
  assert.equal(initialized, false);
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
  const serveUrl = new URL('../scripts/linux/serve.mjs', import.meta.url).href;
  const module = source => 'data:text/javascript,' + encodeURIComponent(source);
  const privateRuntime = module('export const operatorSettings = async () => ({multiPicker:{},controlDir:"private-control",dataDir:"game",current:"pointer"}); export const readRelease = async () => ({config:{}}); export const assertOperatorService = () => {}; export const openApplication = async () => ({ready:Promise.resolve(),close:async()=>{}});');
  const privateFiles = module('export const noLinks = async () => {}; export const exists = async () => { throw Object.assign(new Error("Private control directory"),{code:"EACCES"}); }; export const json = async () => { throw new Error("Private control directory"); };');
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === serveUrl) {
      if (specifier === './runtime.mjs') return { url: privateRuntime, shortCircuit: true };
      if (specifier === './files.mjs') return { url: privateFiles, shortCircuit: true };
      if (specifier === 'node:fs/promises') return { url: module('export const readFile = async () => Buffer.from("synthetic");'), shortCircuit: true };
    }
    return next(specifier, context);
  } });
  let output = '';
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const write = t.mock.method(process.stdout, 'write', (chunk, ...args) => {
    // Native test-runner events share stdout as binary frames.
    if (typeof chunk !== 'string') return stdoutWrite(chunk, ...args);
    output += chunk; return true;
  });
  const before = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  try { await import(serveUrl); assert.equal(output, 'Picker ready.\n'); }
  finally {
    hook.deregister(); write.mock.restore();
    for (const [signal, previous] of before) for (const listener of process.listeners(signal)) if (!previous.includes(listener)) process.removeListener(signal, listener);
  }
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
  const destinations = new Set(f.pickers.flatMap(p => {
    const dir = p.kind === 'legacy-shared' ? target.dataDir : path.join(target.multiPicker.pickerRoot, p.id);
    return [dir, dir + '.dataset.json'];
  }));
  // Model controlDir on another mount on Windows as well as POSIX. Other
  // atomic writes and same-destination-filesystem renames retain native behavior.
  let interruptAfterStore = true;
  effects.hook = async ({ operation, args: [from, to], stage }) => {
    if (operation !== 'rename') return;
    if (stage === 'before' && String(from).startsWith(target.controlDir + path.sep) && destinations.has(String(to))) {
      throw Object.assign(new Error('Synthetic cross-device rename'), { code: 'EXDEV' });
    }
    if (stage === 'after' && String(to) === target.dataDir && interruptAfterStore) { interruptAfterStore = false; throw new Error('Synthetic store rename interruption'); }
  };
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
  } finally { effects.hook = null; }
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
  const second = send(B); let completed;
  try { completed = await second; }
  finally {
    lifecycle = 'deleting'; finish.resolve(); await barrier;
    await Promise.all([first, second]); await router.close();
  }
  assert.equal(completed, 200, 'Resident B runs while A still holds its checkpoint gate.');
  assert.equal(await first, 403); assert.deepEqual(calls, [B]); assert.deepEqual(handled, [B, B]);
});

test('capacity eviction skips a checkpointed context so resident handlers keep running', async () => {
  const { createPickerRouter } = await import('../app/picker-router.mjs');
  const { Readable, Writable } = await import('node:stream');
  const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(c => 'p_' + c.repeat(32));
  const dir = id => path.join(tmpdir(), 'synthetic-checkpoint-evict', id);
  const held = Promise.withResolvers(), finish = Promise.withResolvers();
  const calls = [], closed = [], handled = [];
  const router = createPickerRouter({ maxOpenContexts: 4,
    registry: { getPicker: () => ({ lifecycle: 'active', provisioning: 'ready' }), pickerDirectory: dir },
    legacy: { authenticate: request => ({ kind: 'account', accountId: request.headers.picker, pickerId: request.headers.picker }) },
    // The real close enters the picker's write barrier, as retention and plugin keys do.
    openContext: async id => { calls.push(id); return { close: () => withStoreWrite(dir(id), async () => { closed.push(id); }),
      handle: async (_req, res) => { handled.push(id); res.writeHead(200); res.end('{}'); } }; },
  });
  async function send(id) {
    const request = Readable.from([]); Object.assign(request, { headers: { host: 'localhost', picker: id }, method: 'GET', url: '/api/state', complete: true, socket: { remoteAddress: '127.0.0.1' } });
    const headers = new Map(), response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value); response.getHeader = name => headers.get(name.toLowerCase());
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    await router.handle(request, response, { host: '127.0.0.1' }); return response.statusCode;
  }
  for (const id of [B, C, D]) assert.equal(await send(id), 200);
  // B is the least recently used idle context, and a checkpoint now holds it.
  // B's own requests wait for its copy by design; other pickers must not.
  const barrier = withDirectoryBarriers([dir(B)], async () => { held.resolve(); await finish.promise; });
  await held.promise;
  let completed;
  try {
    completed = [await send(A), await send(D)];
  } finally { finish.resolve(); await barrier; await router.close(); }
  assert.deepEqual(completed, [200, 200], 'Cold A and resident D must not wait for B\'s checkpoint.');
  assert.deepEqual(calls, [B, C, D, A]); assert.equal(closed[0], C);
  assert.deepEqual(handled, [B, C, D, A, D]);
});

test('stopped ownership reclaims a dead MP5 reconciliation lock but refuses live and unverifiable owners', async t => {
  const f = await fixture(t); await f.close();
  const { lockRegistry } = await import('../app/storage/registry-lock.mjs');
  const { hostname } = await import('node:os');
  const ledger = path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json'), lock = path.join(f.settings.multiPicker.tombstoneDir, 'registry.lock');
  const checkpoint = await json(path.join(f.settings.multiPicker.registryDir, 'registry.json'));
  // Persist the real reconciled ledger, then model the exact dead-owner record
  // left by process loss after replacement. No subprocess or PID race.
  await reconcileServiceRecoveryTombstones({ settings: f.settings, checkpoint });
  await atomic(lock, encode({ pid: 900000001, host: hostname(), nonce: '0'.repeat(32) }));
  assert(await exists(ledger));
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

test('MP15 stopped operator issues one private link without provider subjects and revokes the prior code', async t => {
  const f = await fixture(t, 1), accountId = f.pickers[1].ownerAccountId;
  await f.registry.unlinkIdentity(accountId, 'discord'); await f.close();
  const publicOriginFile = path.join(f.root, 'origin'); await writeFile(publicOriginFile, 'https://picker.example');
  const options = { settings: f.settings, command: 'relink-code', argument: accountId,
    release: { ...f.release, config: { ...f.release.config, publicOriginFile } },
    controller: { state: async () => ({ active: false, stopped: true }) },
    serviceIdentity: async () => ({ uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 }) };
  const first = await runServiceOperator(options), second = await runServiceOperator(options);
  const code = result => new URL(result.claimLink).searchParams.get('code');
  const registry = await openRegistry(f.settings.multiPicker); f.cleanup(() => registry.close());
  await assert.rejects(registry.claimIdentity(code(first), 'discord', 'synthetic-player'), { status: 409 });
  assert.equal((await registry.claimIdentity(code(second), 'discord', 'synthetic-player')).id, accountId);
  assert.equal((await readFile(path.join(f.settings.multiPicker.registryDir, 'registry.json'), 'utf8')).includes(code(second)), false);
});

test('MP15 online operator forwards only the target account through the private API', async t => {
  const f = await fixture(t, 1), accountId = f.pickers[1].ownerAccountId;
  await f.registry.unlinkIdentity(accountId, 'discord');
  let calls = 0;
  const result = await runServiceOperator({ settings: f.settings, command: 'relink-code', argument: accountId, release: f.release,
    controller: { state: async () => ({ active: true, stopped: false }) },
    request: async (release, route, method, body) => {
      calls++; assert.equal(release, f.release); assert.equal(route, '/api/operator/relink-code'); assert.equal(method, 'POST');
      assert.deepEqual(body, { accountId });
      const issued = await f.registry.issueRelinkCode(body.accountId);
      return { claimLink: 'https://picker.example/auth/reclaim?code=' + issued.code };
    } });
  assert.equal(calls, 1);
  assert.equal((await f.registry.claimIdentity(new URL(result.claimLink).searchParams.get('code'), 'google', 'synthetic-player')).id, accountId);
});

test('MP15 refused stopped issuance repairs registry and ledger ownership', async t => {
  const f = await fixture(t, 1), accountId = f.pickers[1].ownerAccountId;
  // Keep the target linked so issuance refuses after openRegistry replaces both files.
  await f.close();
  const publicOriginFile = path.join(f.root, 'origin'); await writeFile(publicOriginFile, 'https://picker.example');
  const service = { uid: process.getuid?.() === 0 ? 1001 : process.getuid?.() ?? 0,
    gid: process.getuid?.() === 0 ? 1001 : process.getgid?.() ?? 0 };
  let identityReads = 0;
  await assert.rejects(runServiceOperator({ settings: f.settings, command: 'relink-code', argument: accountId,
    release: { ...f.release, config: { ...f.release.config, publicOriginFile } },
    controller: { state: async () => ({ active: false, stopped: true }) },
    serviceIdentity: async () => { identityReads++; return service; } }), { status: 409 });
  if (process.getuid) for (const file of [path.join(f.settings.multiPicker.registryDir, 'registry.json'),
    path.join(f.settings.multiPicker.tombstoneDir, 'ledger.json')]) {
    const owner = await lstat(file);
    assert.equal(owner.uid, service.uid); assert.equal(owner.gid, service.gid);
  }
  assert.equal(identityReads, 1);
});
