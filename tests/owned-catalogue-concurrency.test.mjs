// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../app/storage/store.mjs';
import { createOwnedStorage, ownedArtifactSource } from '../app/storage/owned-storage.mjs';
import { acquireProcessGuard } from '../app/storage/process-guard.mjs';
import { snapshotStore, snapshotPath } from '../app/storage/snapshot.mjs';
import { verifyOwnedClosure } from '../scripts/linux/owned-recovery.mjs';
import { validateOwnedHistory } from '../scripts/linux/probe.mjs';
import { importBackup, cancelTaskClaimUndo } from '../app/core/state.mjs';
import { fixture, options, now, world as fixtureWorld, taskCatalogue } from './helpers/owned-format2-fixture.mjs';
import { rebaseOptions } from './helpers/owned-rebase-fixture.mjs';
const gate = () => Promise.withResolvers();
const world = { ...fixtureWorld, surface: new Set(fixtureWorld.chunks.keys()) };
const note = value => ({ type: 'set-note', memberId: 'member-1', chunkId: '100', note: value });
const reference = built => ({ datasetDigest: built.pin.dataset.digest, sha256: built.pin.sha256 });

test('owned catalogue shared/exclusive save invariants', { timeout: 120000 }, async t => {
  async function setup(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'rs3-catalogue-concurrent-'));
    const stores = [], releases = [], catalogueRoot = path.join(root, 'catalogue');
    t.after(async () => { for (const release of releases) release(); for (const store of stores) await store.close(); await rm(root, { recursive: true, force: true }); });
    async function open(name, extra = {}, storeOptions = {}) {
      const dataDir = path.join(root, name), owned = { ...options(catalogueRoot), ...extra };
      owned.validateCapture = (dir, reader) => validateOwnedHistory(dir, reader, { importBackup, cancelTaskClaimUndo });
      const store = await openStore({ dataDir, ownedFormat2: owned, initialState: fixture().state, now, world, taskCatalogue, retention: false, completionCodec: false, ...storeOptions });
      stores.push(store); await writeFile(dataDir + '.dataset.json', '{}\n');
      return { store, dataDir, storage: ownedArtifactSource(dataDir), owned };
    }
    return { root, catalogueRoot, releases, open };
  }
  await t.test('B commits while A is paused after publication; each group still serializes its own commands', async t => {
    const f = await setup(t), published = gate(), resume = gate(); f.releases.push(() => resume.resolve());
    let paused = false;
    const a = await f.open('a', { crash: async phase => { if (paused && phase === 'memory-published') { published.resolve(); await resume.promise; } } });
    const b = await f.open('b'); paused = true;
    const first = a.store.commandSerialized(note('A'), 0, { view: 'play-v1' }); await published.promise;
    const sameGroup = a.store.command(note('A next'), 1);
    const other = await b.store.commandSerialized(note('B'), 0, { view: 'play-v1' });
    assert.equal(other.revision, 1); assert.equal(a.store.getInfo().revision, 1);
    assert.equal(JSON.parse(await readFile(path.join(a.dataDir, 'state.json'))).state.revision, 1);
    assert.equal(JSON.parse(await readFile(path.join(b.dataDir, 'state.json'))).state.revision, 1);
    // A shared batch owns the same exclusive kernel guard as before.
    await assert.rejects(acquireProcessGuard(f.catalogueRoot), /Another server/);
    const child = fork(fileURLToPath(new URL('./helpers/catalogue-process-guard.mjs', import.meta.url)), [f.catalogueRoot], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
    const reply = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    assert.equal(reply.acquired, false); assert.match(reply.message, /Another server/);
    paused = false; resume.resolve(); await Promise.all([first, sameGroup]);
    assert.equal(a.store.getInfo().revision, 2); assert.equal(b.store.getInfo().revision, 1);
    const release = await acquireProcessGuard(f.catalogueRoot); await release();
  });
  await t.test('recovery drains other groups, excludes new shared saves, and captures the selected bytes', async t => {
    const f = await setup(t), saved = gate(), resume = gate(), capturing = gate(), finish = gate(), requested = gate(), lateQueued = gate();
    f.releases.push(() => resume.resolve(), () => finish.resolve());
    let paused = false;
    const a = await f.open('a'), b = await f.open('b', { crash: async phase => { if (paused && phase === 'memory-published') { saved.resolve(); await resume.promise; } } });
    const c = await f.open('c'); await a.store.command(note('captured'), 0);
    const bytes = await readFile(path.join(a.dataDir, 'state.json'));
    paused = true; const save = b.store.command(note('in flight'), 0); await saved.promise;
    const original = a.storage.withLease.bind(a.storage);
    t.mock.method(a.storage, 'withLease', (work, admission) => original(work, { ...admission, onQueued: () => requested.resolve() }));
    const id = '00000000-0000-4000-8000-000000000011';
    const capture = snapshotStore(a.dataDir, id, { step: async phase => {
      if (phase === 'capture.owned-base') { capturing.resolve(); await finish.promise; }
    } }); await requested.promise;
    const cLease = c.storage.withLease.bind(c.storage);
    t.mock.method(c.storage, 'withLease', (work, admission) => cLease(work, { ...admission, onQueued: () => lateQueued.resolve() }));
    const late = c.store.command(note('after capture'), 0); await lateQueued.promise;
    assert.equal(c.store.getInfo().revision, 0);
    paused = false; resume.resolve(); await capturing.promise;
    assert.equal(c.store.getInfo().revision, 0);
    finish.resolve(); await capture; await Promise.all([save, late]);
    const captured = snapshotPath(a.dataDir, id);
    assert.deepEqual(await readFile(path.join(captured, 'store/state.json')), bytes);
    await verifyOwnedClosure(captured, ['store']);
    assert.equal(c.store.getInfo().revision, 1);
  });
  await t.test('retained-base selection waits for shared saves and stays exclusive until selection finishes', async t => {
    const f = await setup(t), entered = gate(), resume = gate(), selecting = gate(), finish = gate(), queued = gate(), lateQueued = gate();
    f.releases.push(() => resume.resolve(), () => finish.resolve());
    const { source, newer, target } = rebaseOptions(f.catalogueRoot);
    let paused = false;
    const a = await f.open('a', source), b = await f.open('b', { crash: async phase => {
      if (paused && phase === 'memory-published') { entered.resolve(); await resume.promise; }
    } });
    const targetDir = path.join(f.root, 'publisher'); await mkdir(targetDir);
    const publisher = createOwnedStorage({ ...newer }, targetDir); await publisher.ensurePublished();
    let hold = false;
    const selector = createOwnedStorage({ ...source, crash: async phase => {
      if (hold && phase === 'catalogue-base-selected') { selecting.resolve(); await finish.promise; }
    } }, a.dataDir);
    await selector.select(reference(fixture()));
    paused = true; const shared = b.store.command(note('before retained selection'), 0); await entered.promise;
    assert.equal(JSON.parse(await readFile(path.join(b.dataDir, 'state.json'))).state.revision, 1);
    hold = true;
    const select = selector.withLease(() => selector.select(reference(target)), { mode: 'exclusive', onQueued: () => queued.resolve() }); await queued.promise;
    assert.equal(selector.base.dataset.digest, fixture().pin.dataset.digest);
    const late = a.storage.withLease(() => {}, { mode: 'shared', onQueued: () => lateQueued.resolve() }); await lateQueued.promise;
    resume.resolve(); await selecting.promise;
    assert.equal(selector.base.dataset.digest, target.pin.dataset.digest);
    assert.deepEqual(gunzipSync(await readFile(path.join(f.catalogueRoot, `catalogue-${target.pin.sha256}.json.gz`))), target.bytes);
    finish.resolve(); await Promise.all([shared, select, late]);
  });
  await t.test('interrupted selection and cancelled standby activation restore the previous writer pin', async t => {
    const f = await setup(t), { source, newer, target } = rebaseOptions(f.catalogueRoot);
    const a = await f.open('a', source);
    const publisher = createOwnedStorage(newer, a.dataDir); await publisher.ensurePublished();
    let interrupt = false;
    const storage = createOwnedStorage({ ...source, crash: phase => {
      if (interrupt && phase === 'catalogue-base-selected') throw Error('synthetic selection interruption');
    } }, a.dataDir, { readOnly: true });
    await storage.select(reference(fixture()));
    interrupt = true;
    await assert.rejects(storage.select(reference(target)), /selection interruption/);
    assert.equal(storage.base.dataset.digest, fixture().pin.dataset.digest);
    interrupt = false;
    await assert.rejects(storage.activate(reference(target), () => { throw Error('synthetic activation cancelled'); }), /activation cancelled/);
    assert.equal(storage.base.dataset.digest, fixture().pin.dataset.digest);
    await storage.activate(reference(target));
    assert.equal(storage.base.dataset.digest, target.pin.dataset.digest);
    assert.equal(JSON.parse(await readFile(path.join(a.dataDir, 'state.json'))).state.revision, 0);
  });
  for (const boundary of ['catalogue-exclusive-admitted', 'catalogue-exclusive-releasing']) await t.test(`standby shutdown at ${boundary} cancels ownership without changing bytes`, async t => {
    const f = await setup(t), writer = await f.open('a');
    await writer.store.command(note('before handover'), 0);
    const checkpoint = await writer.store.freeze(); await writer.store.close();
    const bytes = await readFile(path.join(writer.dataDir, 'state.json'));
    let armed = false, closing, standby;
    standby = await f.open('a', { crash: phase => {
      if (armed && phase === boundary) { armed = false; closing = standby.store.close(); }
    } }, { readOnly: true });
    const notifications = [];
    standby.store.subscribe(event => notifications.push(event)); armed = true;
    await assert.rejects(standby.store.activate(checkpoint), /cancelled by shutdown/);
    assert.equal(armed, false); await closing;
    assert.deepEqual(notifications, []);
    assert.deepEqual(await readFile(path.join(writer.dataDir, 'state.json')), bytes);
    const next = await f.open('a'); assert.equal(next.store.getInfo().revision, 1);
  });
});
