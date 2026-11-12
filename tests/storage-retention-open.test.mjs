// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fixture as ownedFixture, options as ownedOptions } from './helpers/owned-format2-fixture.mjs';

const storeURL = new URL('../app/storage/store.mjs', import.meta.url).href;
const probe = globalThis[Symbol.for('retention-open-test')] = {};
function reset() {
  Object.assign(probe, { imports: 0, candidates: 0, decodes: 0, indexes: 0, started: 0, completed: 0, beforeMaintenance: undefined });
}
reset();
// Observe the real parsing/validation boundaries and gate the actual queue.
// No production test hooks, clocks, time budgets or reduced validation paths.
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url !== storeURL) return result;
  let source = String(result.source);
  function instrument(anchor, addition) {
    assert.equal(source.split(anchor).length, 2, `Instrumentation anchor: ${anchor}`);
    source = source.replace(anchor, `${anchor}\n${addition}`);
  }
  instrument('async function importStoredBackup(document, ownsDocument = false, forImport = false, retentionCache) {',
    '__probe.imports++; if (retentionCache) __probe.candidates++;');
  instrument('async function decodeStoredBytes(bytes, forImport) {', '__probe.decodes++;');
  instrument('async function retainedArchiveIndex(forImport = false) {', '__probe.indexes++;');
  instrument('async function maintainRetention() {', '__probe.started++; await __probe.beforeMaintenance?.();');
  instrument('catch (error) { retentionFailure = error.message; }', '__probe.completed++;');
  return { ...result, source: `const __probe = globalThis[Symbol.for('retention-open-test')];\n${source}` };
} });
const { openStore } = await import(storeURL);
hook.deregister();
const now = () => '2026-10-07T00:00:00.000Z';
const command = revision => ({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(revision % 2) });

async function fixture(t, format, dates = Array(6).fill('2026-01-01T00:00:00.000Z')) {
  const base = path.resolve('.local', 'retention', 'tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, `format-${format}-`)), dataDir = path.join(root, 'store');
  const stores = [], releases = [];
  t.after(async () => {
    for (const release of releases) release();
    for (const store of stores.toReversed()) await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const config = { dataDir, completionCodec: false, releaseCommandResponses: format === 2,
    ...(format === 2 ? { ownedFormat2: ownedOptions(path.join(root, 'catalogue')) } : {}) };
  async function open(extra = {}) {
    const store = await openStore({ ...config, now, retention: { backupDays: 1 }, ...extra });
    stores.push(store);
    return store;
  }
  let date = dates[0];
  const seed = await open({ initialState: ownedFixture().state, retention: false, now: () => date });
  for (let revision = 0; revision < dates.length; revision++) {
    date = dates[revision];
    await seed.command(command(revision), revision);
  }
  const snapshots = await seed.listBackups(), current = seed.getState();
  await seed.close();
  const sources = new Map(await Promise.all(snapshots.map(async row => [row.id, await readFile(path.join(dataDir, 'backups', row.id))])));
  function pause() {
    const entered = Promise.withResolvers(), resume = Promise.withResolvers();
    releases.push(resume.resolve);
    probe.beforeMaintenance = () => {
      probe.beforeMaintenance = undefined;
      entered.resolve();
      return resume.promise;
    };
    return { entered: entered.promise, resume: resume.resolve };
  }
  return { dataDir, config, open, snapshots, sources, current, pause };
}
async function standaloneRevisions(dataDir) {
  return (await readdir(path.join(dataDir, 'backups'))).filter(id => /^\d{16}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(id))
    .map(id => Number(id.slice(0, 16))).sort((a, b) => a - b);
}

for (const format of [1, 2]) {
  test(`format ${format}: open resolves before retained decoding; reads and close drain the reserved pass`, async t => {
    const f = await fixture(t, format), startupDiagnostics = {};
    reset();
    const store = await f.open({ startupDiagnostics });
    assert.equal(probe.imports, 1, 'only the authoritative current save is imported');
    assert.equal(probe.candidates, 0);
    assert.equal(probe.decodes, 0, 'no retained gzip has been decoded');
    assert.equal(probe.indexes, 0, 'no retained archive has been indexed');
    assert.equal(probe.started, 0, 'maintenance has not started when open resolves');
    assert.equal(startupDiagnostics.retentionMs, 0);
    assert.deepEqual(store.getState(), f.current);
    const gate = f.pause();
    // Queue a read before the deferred callback starts: its ordering is already
    // reserved, so it must observe the completed retention pass.
    const browsing = store.listBackups().then(rows => {
      assert.equal(probe.completed, 1);
      return rows;
    });
    await assert.rejects(store.freeze(), { code: 'LIVE_SWAP_BUSY' });
    await gate.entered;
    // Gameplay has its own revision queue and can commit while packing waits.
    await store.command(command(6), 6);
    assert.equal(store.getInfo().revision, 7);
    const closing = store.close({ beforeUnlock() {
      assert.equal(probe.completed, 2, 'startup and final close passes finish before ownership release');
    } });
    assert.strictEqual(store.close(), closing);
    await assert.rejects(store.prepareSnapshot(), { code: 'PICKER_UPDATING' });
    await assert.rejects(store.command(command(7), 7), /closed/);
    gate.resume();
    assert.equal((await browsing).length, 7);
    await closing;
    assert.equal(probe.candidates, 4, 'only the middle old snapshots need packing');
    assert.equal(store.getInfo().retention.failure, undefined);
    assert.deepEqual(await standaloneRevisions(f.dataDir), [0, 5, 6]);
    assert(!(await readdir(f.dataDir)).includes('store.lock'));
    for (const forImport of [false, true]) {
      const row = f.snapshots.find(row => row.revision === 2);
      assert.equal((await store.readBackup(row.id, { forImport })).state.revision, 2);
    }
  });

  test(`format ${format}: deferred retention preserves recent, daily, first/latest and pinned tiers`, async t => {
    const dates = ['2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', '2026-01-01T02:00:00.000Z',
      '2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z', '2026-01-02T02:00:00.000Z',
      '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'];
    const f = await fixture(t, format, dates), pinned = f.snapshots.find(row => row.revision === 1);
    const file = path.join(f.dataDir, 'backups', pinned.id), label = 'Synthetic pinned checkpoint';
    const document = JSON.parse(gunzipSync(f.sources.get(pinned.id)));
    document.retentionPinned = true; document.retentionLabel = label;
    await writeFile(file, gzipSync(JSON.stringify(document)));
    await utimes(file, new Date(pinned.at), new Date(pinned.at));
    await writeFile(`${file}.meta.json`, JSON.stringify({ label }));
    const pinnedBytes = await readFile(file);
    const baseline = await f.open({ retention: false }), before = await baseline.listBackups();
    await baseline.close();
    reset();
    const store = await f.open();
    assert.equal(probe.started, 0);
    assert.deepEqual(await store.listBackups(), before);
    assert.equal(probe.completed, 1);
    assert.deepEqual(await standaloneRevisions(f.dataDir), [0, 1, 2, 5, 6, 7]);
    assert.deepEqual(await readFile(file), pinnedBytes);
    assert.equal(store.getInfo().retention.failure, undefined);
    await store.close();
  });

  for (const mismatch of [false, true]) test(`format ${format}: interrupted archive ${mismatch ? 'mismatch retains the source' : 'duplicate recovers after open'}`, async t => {
    const f = await fixture(t, format), first = await f.open();
    const rows = await first.listBackups(), target = rows.find(row => row.revision === 2);
    const portable = await first.readBackup(target.id, { forImport: true });
    await first.close();
    const archivesDir = path.join(f.dataDir, 'backups', 'archives'), [packId] = await readdir(archivesDir);
    const packFile = path.join(archivesDir, packId), packBytes = await readFile(packFile);
    const source = path.join(f.dataDir, 'backups', target.id);
    await writeFile(source, f.sources.get(target.id));
    await utimes(source, new Date(target.at), new Date(target.at));
    if (mismatch) {
      const pack = JSON.parse(gunzipSync(packBytes)), snapshot = pack.snapshots.find(row => row.id === target.id);
      snapshot.document += ' ';
      await writeFile(packFile, gzipSync(JSON.stringify(pack)));
    }
    // A process crash can leave unpublished temp siblings. Neither open nor
    // retention treats these partial bytes as authoritative state or archives.
    const leftovers = [path.join(f.dataDir, 'state.json.123.aaaaaaaaaaaaaaaa.tmp'), `${packFile}.123.aaaaaaaaaaaaaaaa.tmp`];
    for (const file of leftovers) await writeFile(file, 'incomplete');
    reset();
    const store = await f.open();
    assert.equal(probe.started, 0);
    assert.equal(probe.imports, 1);
    assert.equal(probe.decodes, 0);
    assert.deepEqual(store.getState(), f.current);
    assert.deepEqual(await store.listBackups(), rows, 'the interrupted duplicate is listed once');
    if (mismatch) {
      assert.match(store.getInfo().retention.failure, /differs from its preserved standalone/);
      assert.deepEqual(await readFile(source), f.sources.get(target.id));
    } else {
      assert.equal(store.getInfo().retention.failure, undefined);
      await assert.rejects(stat(source), { code: 'ENOENT' });
      await store.prepareSnapshot();
      assert.deepEqual(await readFile(packFile), packBytes, 'a settled pass never rewrites the archive');
    }
    for (const forImport of [false, true]) assert.deepEqual(await store.readBackup(target.id, { forImport }), portable);
    for (const file of leftovers) assert.equal(await readFile(file, 'utf8'), 'incomplete');
    await store.close();
  });

  for (const mode of ['readOnly', 'liveSwapStrict', 'disabled']) test(`format ${format}: ${mode} schedules no startup retention`, async t => {
    const f = await fixture(t, format);
    reset();
    const store = await f.open(mode === 'disabled' ? { retention: false } : { [mode]: true });
    // This turn is only a scheduling barrier, never a latency assertion.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(probe.started, 0);
    assert.equal(probe.candidates, 0);
    if (mode !== 'readOnly') {
      const checkpoint = await store.freeze();
      assert.equal(checkpoint.revision, 6);
    }
    await assert.rejects(store.prepareSnapshot(), { code: 'PICKER_UPDATING' });
    await store.close();
    assert.equal(probe.started, 0, 'frozen/strict/read-only close only drains existing work');
    assert.deepEqual(await standaloneRevisions(f.dataDir), [0, 1, 2, 3, 4, 5]);
  });
}
