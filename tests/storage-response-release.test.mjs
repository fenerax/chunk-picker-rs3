// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { setImmediate as turn } from 'node:timers/promises';
import { buildWorld } from '../app/data/world.mjs';
import { mergeCommandState } from '../app/web/command-state.mjs';
import { fixture, options, now, taskCatalogue } from './helpers/owned-format2-fixture.mjs';

// Observe actual store roots without adding a production diagnostic API. The
// structural queue assertion also runs in CI when --expose-gc is unavailable.
const storeURL = new URL('../app/storage/store.mjs', import.meta.url).href;
const hook = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (url !== storeURL) return loaded;
  const source = String(loaded.source), anchor = '    getState: cloneCurrent,';
  assert.equal(source.split(anchor).length, 2);
  return { ...loaded, source: source.replace(anchor, `${anchor}
    responseRoots: () => ({ queue, maintenanceQueue, poolState, fullPools, playPools, calculationSnapshot }),
    responseProjection: state => playProjections.get(state),`) };
} });
const { openStore } = await import(storeURL);
hook.deregister();

const world = buildWorld({ chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] });
const note = value => ({ type: 'set-note', memberId: 'member-1', chunkId: '12341', note: value });
async function setup(t, settings = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'rs3-response-release-'));
  let store;
  t.after(async () => { await store?.close(); await rm(root, { recursive: true, force: true }); });
  const { format2 = false, ...overrides } = settings;
  const config = { dataDir: path.join(root, 'save'), initialState: fixture().state,
    world, now, random: () => 0, taskCatalogue, retention: false, completionCodec: false,
    ...(format2 ? { ownedFormat2: options(path.join(root, 'catalogue')) } : {}), ...overrides };
  store = await openStore(config);
  return { store, config, reopen: async () => { await store.close(); store = await openStore(config); return store; } };
}

for (const format2 of [false, true]) for (const releaseCommandResponses of [false, true]) {
  test(`ordered commands preserve caller errors and recover after rejection (format2=${format2}, release=${releaseCommandResponses})`, async t => {
    const entered = Promise.withResolvers(), resume = Promise.withResolvers();
    const failure = new Error('Synthetic pre-rename refusal'), attempts = [], notifications = [];
    const { store, config, reopen } = await setup(t, { format2, releaseCommandResponses,
      async beforeCommit({ state }) {
        attempts.push(state.revision);
        if (attempts.length === 1) { entered.resolve(); await resume.promise; }
        if (attempts.length === 2) throw failure;
      } });
    store.subscribe(event => notifications.push(event.revision));
    const first = store.commandSerialized(note('First'), 0, { view: 'play-v1' });
    let third, refused;
    try {
      await Promise.race([entered.promise, first.then(() => { throw new Error('Command skipped the commit barrier'); })]);
      const second = store.commandSerialized(note('Refused'), 1);
      refused = assert.rejects(second, error => error === failure);
      third = store.commandSerialized(note('Third'), 1);
      assert.deepEqual(attempts, [1], 'later commands cannot enter the blocked commit');
      assert.equal(store.getInfo().revision, 0);
      assert.equal(JSON.parse(await readFile(path.join(config.dataDir, 'state.json'))).state.revision, 0);
    } finally { resume.resolve(); }
    const firstReply = await first;
    await refused;
    const thirdReply = await third;
    assert.deepEqual(attempts, [1, 2, 2]);
    assert.deepEqual(notifications, [1, 2]);
    assert.equal(JSON.parse(firstReply.stateJSON).members[0].notes['12341'], 'First');
    assert.equal(JSON.parse(thirdReply.stateJSON).members[0].notes['12341'], 'Third');
    assert.equal(await store.responseRoots().queue, releaseCommandResponses ? undefined : thirdReply);
    const committed = store.getState(), info = store.getInfo();
    assert.equal(info.durable, true); assert.equal(info.durabilityWarnings, 0);
    assert.deepEqual((await reopen()).getState(), committed);
  });
}

test('atomic write, synced temporary, durable preimages and failure cleanup match with either flag', async t => {
  const traces = [];
  for (const releaseCommandResponses of [false, true]) {
    const trace = [], failure = new Error('Synthetic atomic refusal');
    let refuse = true, monitor = false, stateTemporary;
    const { store, config, reopen } = await setup(t, { releaseCommandResponses,
      async beforeCommit() {
        trace.push('beforeCommit');
        assert.equal(trace.at(-2), 'stateSync', 'temporary contents were synced before the hook');
        assert.equal(JSON.parse(await readFile(stateTemporary)).state.revision, 1);
        assert.equal(JSON.parse(await readFile(path.join(config.dataDir, 'state.json'))).state.revision, 0);
        if (refuse) throw failure;
      } });
    const file = path.join(config.dataDir, 'state.json'), previous = await readFile(file);
    store.getCalculationSnapshot(); store.getStateSnapshot({ view: 'play-v1' });
    const oldRoots = store.responseRoots(), oldProjection = store.responseProjection(oldRoots.poolState);
    const originalOpen = fs.promises.open, originalRename = fs.promises.rename;
    fs.promises.open = async (target, ...args) => {
      const stateWrite = monitor && String(target).startsWith(`${file}.`) && String(target).endsWith('.tmp');
      if (monitor && target === config.dataDir) trace.push('directorySyncAttempt');
      const handle = await originalOpen(target, ...args);
      if (stateWrite) {
        stateTemporary = target;
        const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
        handle.writeFile = async (...values) => { const result = await write(...values); trace.push('stateWrite'); return result; };
        handle.sync = async () => { const result = await sync(); trace.push('stateSync'); return result; };
      }
      return handle;
    };
    fs.promises.rename = async (from, to) => {
      const result = await originalRename(from, to);
      if (monitor && to === file) trace.push('stateRename');
      return result;
    };
    syncBuiltinESMExports();
    try {
      monitor = true;
      await assert.rejects(store.commandSerialized(note('Refused'), 0), error => error === failure);
      assert.deepEqual(trace.filter(value => value !== 'directorySyncAttempt'), ['stateWrite', 'stateSync', 'beforeCommit']);
      assert.deepEqual(await readFile(file), previous);
      assert.equal(store.getInfo().revision, 0);
      assert.equal(store.responseRoots().calculationSnapshot, oldRoots.calculationSnapshot);
      assert.equal(store.responseRoots().fullPools, oldRoots.fullPools);
      assert.equal(store.responseRoots().playPools, oldRoots.playPools);
      assert.equal(store.responseProjection(oldRoots.poolState), oldProjection);
      assert.ok((await readdir(config.dataDir)).every(name => !name.endsWith('.tmp')));
      const backups = await readdir(path.join(config.dataDir, 'backups'));
      assert.equal(backups.length, 1);
      assert.deepEqual(gunzipSync(await readFile(path.join(config.dataDir, 'backups', backups[0]))), previous);
      refuse = false; trace.length = 0;
      const reply = await store.commandSerialized(note('Committed'), 0);
      assert.equal(reply.revision, 1);
      assert.ok(trace.indexOf('stateRename') > trace.indexOf('beforeCommit'));
      assert.equal(trace.at(-1), 'directorySyncAttempt');
      assert.equal(store.getInfo().durable, true);
      assert.ok((await readdir(config.dataDir)).every(name => !name.endsWith('.tmp')));
      traces.push([...trace]);
      monitor = false;
      const committed = store.getState();
      assert.deepEqual((await reopen()).getState(), committed);
    } finally {
      fs.promises.open = originalOpen; fs.promises.rename = originalRename; syncBuiltinESMExports();
    }
  }
  assert.deepEqual(traces[1], traces[0], 'flag does not change publication IO order');
});

for (const format2 of [false, true]) for (const flag of [undefined, false, true]) {
  test(`backup reads release obsolete responses only when enabled (format2=${format2}, flag=${flag})`, async t => {
    const { store } = await setup(t, { format2, ...(flag === undefined ? {} : { releaseCommandResponses: flag }) });
    await store.command(note('Create a preimage'), 0);
    const backups = await store.listBackups();
    assert.equal(backups.length, 1);
    assert.equal(await store.responseRoots().maintenanceQueue, flag ? undefined : backups);
    const response = await store.readBackup(backups[0].id);
    assert.equal(response.state.revision, 0);
    assert.equal(await store.responseRoots().maintenanceQueue, flag ? undefined : response);
    await assert.rejects(store.readBackup('0000000000000000-0000000000000000.json.gz'), { code: 'ENOENT' });
    assert.equal(await store.responseRoots().maintenanceQueue, undefined);
    const recovered = await store.listBackups();
    assert.equal(recovered.length, 1);
    assert.equal(await store.responseRoots().maintenanceQueue, flag ? undefined : recovered);
  });

  test(`only enabled stores discard the response and obsolete pool/projection roots (format2=${format2}, flag=${flag})`, async t => {
    const { store } = await setup(t, { format2, ...(flag === undefined ? {} : { releaseCommandResponses: flag }) });
    const captured = store.getCalculationSnapshot(), input = captured.state;
    const bytes = Buffer.from(captured.stateJSON).toString(), key = captured.taskInputKey;
    const full = store.getStateSnapshot(), play = store.getStateSnapshot({ view: 'play-v1' });
    const old = store.responseRoots(), projection = store.responseProjection(old.poolState);
    assert.ok(old.fullPools); assert.ok(old.playPools); assert.ok(projection);
    await store.command(note('Next revision'), 0);
    const tail = store.responseRoots().queue;
    const retained = await tail;
    assert.equal(retained?.revision, flag ? undefined : 1);
    const next = store.responseRoots();
    assert.equal(next.calculationSnapshot, flag ? undefined : captured);
    assert.equal(next.fullPools, flag ? undefined : old.fullPools);
    assert.equal(next.playPools, flag ? undefined : old.playPools);
    assert.equal(next.poolState === old.poolState, !flag);
    assert.equal(store.responseProjection(old.poolState), flag ? undefined : projection);
    assert.equal(captured.state, input);
    assert.equal(captured.taskInputKey, key);
    assert.equal(Buffer.from(captured.stateJSON).toString(), bytes);
    assert.equal(JSON.parse(full.stateJSON).revision, 0);
    assert.equal(JSON.parse(play.stateJSON).revision, 0);
    assert.equal(store.getStateSnapshot().revision, 1);
    assert.equal(store.getStateSnapshot({ view: 'play-v1' }).revision, 1);
  });
}

test('standby activation drops obsolete response roots after taking over the exact durable checkpoint', async t => {
  const { store: writer, config } = await setup(t, { releaseCommandResponses: true });
  const standby = await openStore({ ...config, readOnly: true });
  try {
    const captured = standby.getCalculationSnapshot();
    standby.getStateSnapshot({ view: 'play-v1' });
    const old = standby.responseRoots();
    await writer.command(note('Published before handover'), 0);
    const checkpoint = await writer.freeze(); await writer.close();
    assert.equal((await standby.activate(checkpoint)).revision, 1);
    const next = standby.responseRoots();
    assert.equal(next.calculationSnapshot, undefined);
    assert.equal(next.fullPools, undefined); assert.equal(next.playPools, undefined);
    assert.equal(standby.responseProjection(old.poolState), undefined);
    assert.equal(JSON.parse(standby.getStateSnapshot().stateJSON).revision, 1);
    assert.equal(captured.state.revision, 0);
  } finally { await standby.close(); }
});

test('enabled play replies preserve unchanged-field merging and captured full revisions', async t => {
  const { store } = await setup(t, { releaseCommandResponses: true });
  const initial = JSON.parse(store.getStateSnapshot({ view: 'play-v1' }).stateJSON);
  const [first, second] = await Promise.all([
    store.commandSerialized(note('First'), 0, { view: 'play-v1', omitUnchanged: true }),
    store.commandSerialized(note('Second'), 1, { view: 'play-v1', omitUnchanged: true }),
  ]);
  assert.equal(first.baseRevision, 0); assert.equal(second.baseRevision, 1);
  assert.deepEqual(first.unchangedFields.sort(), ['identityRegistry', 'legacy', 'tasks']);
  const full = JSON.parse(store.getStateSnapshot({ view: 'play-v1' }).stateJSON);
  assert.deepEqual(mergeCommandState(mergeCommandState(initial, { ...first, state: JSON.parse(first.stateJSON) }),
    { ...second, state: JSON.parse(second.stateJSON) }), full);
  assert.equal(JSON.parse(first.stateJSON).members[0].notes['12341'], 'First');
});

test('settled serialized response is not reachable from the enabled queue', async t => {
  const { store } = await setup(t, { releaseCommandResponses: true });
  async function capture() {
    const response = await store.commandSerialized(note('Collectable response'), 0);
    return new WeakRef(response);
  }
  const response = await capture();
  assert.equal(await store.responseRoots().queue, undefined);
  // Leave the WeakRef creation job before one explicit collection. No polling,
  // allocation pressure, timing assertions or collection/retry loop.
  await turn();
  if (global.gc) {
    await global.gc({ execution: 'async' });
    assert.equal(response.deref(), undefined);
  }
  assert.equal(store.getInfo().revision, 1, 'store remains live while its response is released');
});

test('release flag must be boolean before any store ownership or IO', async () => {
  await assert.rejects(openStore({ dataDir: 'unused-synthetic-directory', releaseCommandResponses: '1' }),
    /releaseCommandResponses must be boolean/);
});
