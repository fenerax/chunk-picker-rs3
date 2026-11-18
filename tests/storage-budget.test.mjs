// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { serialize } from 'node:v8';
import { storageBudget, storageUsage, storagePressure, withStorageBudget, DEFAULT_STORAGE_BUDGET, CAPTURE_FILE_BUDGET } from '../app/storage/storage-budget.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { collectStorage, evaluate, monitor } from '../scripts/linux/monitor.mjs';
import { runtimeEnvironment } from '../scripts/linux/runtime.mjs';

const fixed = '2026-10-07T00:00:00.000Z';
const state = () => createGroupState([{ id: 'one', name: 'Synthetic One' }, { id: 'two', name: 'Synthetic Two' }]);
const command = revision => ({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(revision % 2) });
async function fixture(t) {
  const base = path.resolve('.local/storage-budget-tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-'));
  t.after(async () => { assert(root.startsWith(base + path.sep)); await rm(root, { recursive: true }); });
  return root;
}
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = String(value);
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function disk(t, bytes) {
  const original = fs.statfs;
  fs.statfs = async () => ({ bavail: BigInt(bytes), bsize: 1n }); syncBuiltinESMExports();
  t.after(() => { fs.statfs = original; syncBuiltinESMExports(); });
}
const refusal = error => error.status === 507 && error.code === 'STORAGE_BUDGET_EXCEEDED'
  && /History and backup downloads remain available/.test(error.message);

test('budget settings are bounded, preserve descriptor margin and reach the Linux child environment', () => {
  assert.deepEqual(storageBudget({}, {}), DEFAULT_STORAGE_BUDGET);
  assert(DEFAULT_STORAGE_BUDGET.maxFiles + 512 <= CAPTURE_FILE_BUDGET);
  assert.equal(storageBudget({}, { RS3_STORE_MAX_BYTES: '123' }).maxBytes, 123);
  for (const value of ['0', '-1', '1.5', 'NaN', '', '9007199254740992'])
    assert.throws(() => storageBudget({}, { RS3_STORE_MAX_BYTES: value }), /Invalid/);
  assert.throws(() => storageBudget({ maxFiles: 4096 }, {}), /3584/);
  assert.throws(() => storageBudget({ unknown: 1 }, {}), /Invalid/);
});

test('Linux serving and monitoring use the same configured environment budgets', t => {
  environment(t, { RS3_STORE_MAX_BYTES: 123456, RS3_STORE_MAX_FILES: 1234, RS3_STORE_MIN_FREE_BYTES: 456789 });
  const env = runtimeEnvironment({ datasetId: 'open-f2p' });
  assert.deepEqual(storageBudget({}, env), storageBudget());
});

test('metadata accounting includes packed and standalone copies, History, static fields and binding, excluding capture exclusions', async t => {
  const root = await fixture(t), dir = path.join(root, 'group');
  const rows = ['backups/copy.gz', 'backups/archives/pack.gz', 'history/events.gz', 'static/tasks.gz', 'state.json'];
  for (const file of rows) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), '12345'); }
  await mkdir(path.join(dir, 'warm-store')); await writeFile(path.join(dir, 'warm-store', 'cache'), 'disposable');
  await writeFile(path.join(dir, 'store.lock'), 'lock'); await writeFile(dir + '.dataset.json', 'binding');
  assert.deepEqual(await storageUsage(dir), { bytes: 32, files: 6 });
  await link(path.join(dir, 'state.json'), path.join(dir, 'duplicate.json'));
  assert.deepEqual(await storageUsage(dir), { bytes: 37, files: 7 }, 'each capture path is charged even when its inode is shared');
});

test('replacement accounting uses net group growth while headroom reserves the full atomic output', async t => {
  const root = await fixture(t), file = path.join(root, 'state.json');
  await writeFile(file, 'x'.repeat(20));
  const limits = storageBudget({ maxBytes: 25, maxFiles: 20, minFreeBytes: 1 });
  await withStorageBudget(root, [{ file, bytes: 'x'.repeat(25) }], limits, () => writeFile(file, 'x'.repeat(25)));
  assert.equal((await storageUsage(root)).bytes, 25);
  await assert.rejects(withStorageBudget(root, [{ file, bytes: 'x'.repeat(26) }], limits, () => assert.fail('must refuse before publication')), refusal);
  disk(t, 100);
  await assert.rejects(withStorageBudget(root, [{ file, bytes: 'x' }], limits, () => assert.fail('temporary must fit too')), refusal);
});

test('metadata sampling tolerates a regular file being unlinked by packing', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'copy.gz'), '12345');
  const original = fs.lstat;
  fs.lstat = async (...args) => { const info = await original(...args); if (info.isFile()) info.nlink = 0; return info; };
  syncBuiltinESMExports();
  t.after(() => { fs.lstat = original; syncBuiltinESMExports(); });
  assert.deepEqual(await storageUsage(root), { bytes: 5, files: 1 });
});

test('concurrent groups cannot reserve the same filesystem space, and failures release reservations', async t => {
  const root = await fixture(t), a = path.join(root, 'a'), b = path.join(root, 'b');
  await mkdir(a); await mkdir(b);
  const limits = storageBudget({ minFreeBytes: 1000 });
  disk(t, 1000 + 1024 * 1024 + 8192);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const plan = dir => [{ file: path.join(dir, 'state.json'), bytes: Buffer.alloc(4096) }];
  const first = withStorageBudget(a, plan(a), limits, async () => { entered.resolve(); await release.promise; throw Error('synthetic write failure'); });
  const failed = assert.rejects(first, /synthetic write failure/);
  t.after(() => release.resolve());
  await entered.promise;
  await assert.rejects(withStorageBudget(b, plan(b), limits, () => assert.fail('space already reserved')), refusal);
  release.resolve(); await failed;
  await withStorageBudget(b, plan(b), limits, async () => {});
});

test('large multi-file publications are refused as a whole before any dependency is written', async t => {
  const root = await fixture(t), limits = storageBudget({ maxBytes: 1024 * 1024 });
  const rows = ['state.json', 'backups/preimage.gz', 'static/tasks.gz'].map(file => ({ file: path.join(root, file), bytes: Buffer.alloc(400000) }));
  await assert.rejects(withStorageBudget(root, rows, limits, () => assert.fail('aggregate exceeds group budget')), refusal);
  assert.deepEqual(await readdir(root), []);
});

test('an already over-budget save can reopen on the next day without writing a startup observation', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'group'), progressQuestPoints = new Map();
  let store = await openStore({ dataDir, initialState: state(), now: fixed, retention: false, progressQuestPoints });
  t.after(() => store.close());
  const saved = await readFile(path.join(dataDir, 'state.json'));
  await store.close();
  environment(t, { RS3_STORE_MAX_BYTES: 1 });
  store = await openStore({ dataDir, now: '2026-10-08T00:00:00.000Z', retention: false, progressQuestPoints });
  assert.equal(store.getState().revision, 0);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), saved);
  assert.equal((await store.backup()).state.revision, 0);
});

for (const dimension of ['bytes', 'files', 'headroom']) test(`${dimension} refusal preserves the current save, History, exports and all retained downloads`, async t => {
  const root = await fixture(t), dataDir = path.join(root, 'group');
  let store = await openStore({ dataDir, initialState: state(), now: fixed, retention: { historyEntries: 2 } });
  t.after(() => store.close());
  for (let revision = 0; revision < 5; revision++) await store.command(command(revision), revision);
  const saved = await readFile(path.join(dataDir, 'state.json')), rows = await store.listBackups(), usage = await store.storageUsage();
  await store.close();
  environment(t, dimension === 'bytes' ? { RS3_STORE_MAX_BYTES: usage.bytes + 1 }
    : dimension === 'files' ? { RS3_STORE_MAX_FILES: usage.files + 8 } : {});
  store = await openStore({ dataDir, now: fixed, retention: { historyEntries: 2 } });
  if (dimension === 'headroom') disk(t, 1);
  const before = await storageUsage(dataDir);
  await assert.rejects(store.command(command(5), 5), refusal);
  const document = await store.backup();
  await assert.rejects(store.replace(document, 5), refusal);
  const dataset = { datasetId: 'duo-legacy', datasetContractVersion: 1, digest: 'synthetic', capabilities: {} };
  const prepared = await store.prepareTransfer(serialize({ backup: document }), { dataset, world: { chunks: new Map() }, route: '/api/restore/preview' });
  await assert.rejects(store.applyTransfer(prepared.ticket, 5), refusal);
  assert.equal(store.getState().revision, 5);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), saved);
  assert.deepEqual(await storageUsage(dataDir), before, 'refusal writes no orphan preimages or dependencies');
  assert.equal(document.state.history.length, 5);
  assert.equal((await store.queryHistory({ limit: 20 })).history.length, 5);
  const exported = await store.exportBackup({ dataset, gzip: true });
  assert.equal(JSON.parse(gunzipSync(exported.bytes ?? exported)).state.revision, 5);
  for (const row of rows) assert.equal((await store.readBackup(row.id)).state.revision, row.revision);
});

test('existing packing reduces file pressure without discarding snapshots, even while gameplay is over budget', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'group');
  let store = await openStore({ dataDir, initialState: state(), retention: false, now: '2026-01-01T00:00:00.000Z' });
  t.after(() => store.close());
  for (let revision = 0; revision < 8; revision++) await store.command(command(revision), revision);
  const before = await storageUsage(dataDir), snapshots = await store.listBackups(); await store.close();
  environment(t, { RS3_STORE_MAX_FILES: before.files + 8 });
  store = await openStore({ dataDir, now: fixed, retention: { backupDays: 1 } });
  await store.prepareSnapshot();
  assert((await storageUsage(dataDir)).files < before.files);
  assert.equal((await store.listBackups()).length, snapshots.length);
  for (const row of snapshots) assert.equal((await store.readBackup(row.id)).state.revision, row.revision);
  await store.command(command(8), 8);
});

test('duo-sized synthetic retained store has clear default budget margin', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'group');
  const store = await openStore({ dataDir, initialState: state(), now: fixed, retention: { historyEntries: 100 } });
  t.after(() => store.close());
  for (let revision = 0; revision < 450; revision++) await store.command(command(revision), revision);
  const usage = await store.storageUsage();
  assert(usage.files >= 450); assert(usage.files < DEFAULT_STORAGE_BUDGET.maxFiles / 7);
  assert(usage.bytes < DEFAULT_STORAGE_BUDGET.maxBytes / 100);
  assert.equal(storagePressure(usage), null);
  t.diagnostic(`Synthetic duo, 450 commits: ${usage.files} files, ${usage.bytes} bytes; defaults ${usage.limits.maxFiles} files, ${usage.limits.maxBytes} bytes.`);
});

test('monitor inventories every group, warns before the capture limit, escalates and recovers through existing notifications', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'legacy'), pickerRoot = path.join(root, 'pickers');
  const group = 'p_' + 'a'.repeat(32), groupDir = path.join(pickerRoot, group);
  await mkdir(dataDir); await mkdir(groupDir, { recursive: true });
  await writeFile(path.join(dataDir, 'state.json'), '123'); await writeFile(path.join(groupDir, 'state.json'), '12345');
  const storage = await collectStorage({ dataDir, multiPicker: { pickerRoot } });
  assert.deepEqual(storage.map(row => [row.group, row.bytes, row.files]), [['legacy', 3, 1], [group, 5, 1]]);
  const limits = storageBudget(), warnAt = Math.ceil(limits.maxFiles * 0.8);
  assert(warnAt < CAPTURE_FILE_BUDGET);
  const sample = { writerActive: true, backup: { snapshotAt: fixed }, offhost: { snapshotAt: fixed, lastSuccessAt: fixed },
    diskBytes: 20 * 1024 ** 3, ramBytes: 3 * 1024 ** 3, storage: [{ ...storage[1], files: warnAt }] };
  const now = Date.parse(fixed), sent = [], controlDir = path.join(root, 'control'), send = async text => sent.push(text);
  assert.equal(evaluate(sample, {}, now).faults['group-storage'], 'warning');
  await monitor({ controlDir }, { sample, now, send });
  await monitor({ controlDir }, { sample, now: now + 31000, send });
  assert.equal(sent.length, 1, 'repeat warning is silent');
  assert(!sent[0].includes(group));
  sample.storage[0].files = limits.maxFiles;
  await monitor({ controlDir }, { sample, now: now + 62000, send });
  assert.match(sent[1], /CRITICAL: A group/);
  const observed = JSON.parse(await readFile(path.join(controlDir, 'monitor-state.json')));
  assert.equal(observed.faults['group-storage'], 'critical');
  assert.equal(observed.storage, undefined, 'accounting does not add a durable monitor format');
  sample.storage[0].files = 1;
  await monitor({ controlDir }, { sample, now: now + 93000, send });
  assert.match(sent[2], /RECOVERED: A group/);
  assert.equal(storagePressure({ bytes: limits.maxBytes, files: 1 }, limits), 'critical');
});

test('a free-space sample that overlaps another group\'s release still counts that group\'s output as used', async t => {
  const root = await fixture(t), a = path.join(root, 'a'), b = path.join(root, 'b');
  await mkdir(a); await mkdir(b);
  const limits = storageBudget({ minFreeBytes: 1000 });
  const plan = dir => [{ file: path.join(dir, 'state.json'), bytes: Buffer.alloc(4096) }];
  const reservation = 1024 * 1024 + 4096 + 4096;
  // The sample stays constant: it never sees the first group's written bytes.
  let sampling, called;
  const original = fs.statfs;
  fs.statfs = async () => { called?.resolve(); await sampling; return { bavail: BigInt(1000 + reservation + 4096), bsize: 1n }; }; syncBuiltinESMExports();
  t.after(() => { fs.statfs = original; syncBuiltinESMExports(); });
  const entered = Promise.withResolvers(), finish = Promise.withResolvers(), sampled = Promise.withResolvers();
  const first = withStorageBudget(a, plan(a), limits, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  sampling = sampled.promise; called = Promise.withResolvers();
  const second = withStorageBudget(b, plan(b), limits, () => assert.fail('stale sample admitted the second output'));
  await called.promise;
  finish.resolve(); await first;
  sampled.resolve(); called = undefined;
  await assert.rejects(second, refusal);
  // A sample taken after the release is trusted again.
  sampling = undefined;
  await withStorageBudget(b, plan(b), limits, async () => {});
});

test('stale-sample compensation applies only to that admission and never stays reserved', async t => {
  const root = await fixture(t), a = path.join(root, 'a'), b = path.join(root, 'b'), c = path.join(root, 'c');
  await mkdir(a); await mkdir(b); await mkdir(c);
  const limits = storageBudget({ minFreeBytes: 1000 });
  const plan = dir => [{ file: path.join(dir, 'state.json'), bytes: Buffer.alloc(4096) }];
  const reservation = 1024 * 1024 + 4096 + 4096;
  // Room for two outputs: B is admitted even after counting A's released bytes.
  let sampling, called, free = 1000 + 2 * reservation;
  const original = fs.statfs;
  fs.statfs = async () => { called?.resolve(); await sampling; return { bavail: BigInt(free), bsize: 1n }; }; syncBuiltinESMExports();
  t.after(() => { fs.statfs = original; syncBuiltinESMExports(); });
  const entered = Promise.withResolvers(), finish = Promise.withResolvers(), sampled = Promise.withResolvers();
  const holdB = Promise.withResolvers(), enteredB = Promise.withResolvers();
  const first = withStorageBudget(a, plan(a), limits, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  sampling = sampled.promise; called = Promise.withResolvers();
  const second = withStorageBudget(b, plan(b), limits, async () => { enteredB.resolve(); await holdB.promise; });
  await called.promise;
  finish.resolve(); await first;
  sampled.resolve(); called = undefined; sampling = undefined;
  await enteredB.promise;
  // While B holds only its own reservation, C fits in the remaining room.
  await withStorageBudget(c, plan(c), limits, async () => {});
  holdB.resolve(); await second;
});

test('repeated refusals reuse the last walk; a smaller write, admission or maintenance rescans', async t => {
  const root = await fixture(t), file = path.join(root, 'state.json'), extra = path.join(root, 'extra.json');
  await writeFile(file, 'x'.repeat(20)); await writeFile(extra, 'x'.repeat(5));
  const limits = storageBudget({ maxBytes: 25, maxFiles: 20, minFreeBytes: 1 });
  const write = bytes => withStorageBudget(root, [{ file, bytes }], limits, () => writeFile(file, bytes));
  await assert.rejects(write('x'.repeat(21)), refusal);
  // Freed space is not seen until a rescan: the cached walk still refuses.
  await rm(extra);
  await assert.rejects(write('x'.repeat(21)), refusal);
  // Maintenance clears the cached walk, so the same write is admitted.
  await withStorageBudget(root, [{ file: path.join(root, 'pack.tmp'), bytes: '' }], limits, async () => {}, { maintenance: true });
  await write('x'.repeat(21));
  assert.equal((await storageUsage(root)).bytes, 21);
  // A write that fits under the cached usage is confirmed by a fresh walk,
  // which sees the freed space; admission then clears the cached refusal.
  await writeFile(extra, 'x'.repeat(4));
  await assert.rejects(write('x'.repeat(22)), refusal);
  await rm(extra);
  await assert.rejects(write('x'.repeat(22)), refusal);
  await write('x'.repeat(20));
  await write('x'.repeat(22));
  assert.equal((await storageUsage(root)).bytes, 22);
});
