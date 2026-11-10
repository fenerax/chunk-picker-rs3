// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { buildOwnedBase } from '../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../app/storage/owned-base-schema.mjs';
import { prepareOwnedPickerState, preserveGameIdentity } from '../app/game-profile.mjs';
import { ownedCommandFixture, ownedDataset, ownedNow, ownedPickerId, ownedRegistry, ownedWorld } from '../scripts/perf/owned-command-fixture.mjs';
import { frozenRuntime } from './helpers/frozen-release.mjs';
import { BACKUP_FORMAT, materializeResidentState, validateState } from '../app/core/state.mjs';
import { fixture, options, commands, now, world, taskCatalogue, custom } from './helpers/owned-format2-fixture.mjs';
const json = JSON.stringify;
const hash = value => createHash('sha256').update(json(value)).digest('hex');
const settings = { now, world, taskCatalogue, random: () => 0, completionCodec: false };
const stores = new WeakMap();
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rs3-owned-format2-'));
  stores.set(t, []);
  t.after(async () => { for (const store of stores.get(t)) await store.close(); await rm(root, { recursive: true, force: true }); });
  return root;
}
async function open(t, dataDir, extra = {}) {
  const store = await openStore({ ...settings, dataDir, initialState: fixture().state, ...extra });
  stores.get(t).push(store); return store;
}
const gameplay = state => json(Object.fromEntries(['members', 'tasks', 'rules', 'taskClaims'].filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]])));
for (const retention of [false, { historyEntries: 2 }]) test(`format 1/2 write-reopen History hashes and exact Undo/Redo preimages (archives ${!!retention})`, async t => {
  const root = await directory(t), catalogueRoot = path.join(root, 'catalogue');
  let flat, owned;
  async function reopen() {
    await flat?.close(); await owned?.close();
    flat = await open(t, path.join(root, 'flat'), { retention });
    owned = await open(t, path.join(root, 'owned'), { retention, ownedFormat2: options(catalogueRoot) });
  }
  async function equal() {
    const one = (await flat.backup()).state, two = (await owned.backup()).state;
    assert.equal(hash(two), hash(one), 'complete logical-state hash after reopen');
    assert.equal(hash(two.history), hash(one.history), 'ordered History hash');
    assert.equal(json(two.history.map(row => row.undo)), json(one.history.map(row => row.undo)), 'exact Undo preimages');
    assert.equal(json(two.tasks), json(one.tasks), 'exact ordered row JSON');
    assert.deepEqual(two, one);
    return one;
  }
  async function run(command) {
    const revision = flat.getState().revision;
    // Coordination reads between custom edits must not rewrite saved row JSON.
    assert.deepEqual(owned.getTaskClaimState(), flat.getTaskClaimState());
    assert.deepEqual(owned.getTaskClaimSnapshot(), flat.getTaskClaimSnapshot());
    await flat.command(command, revision); await owned.command(command, revision);
    await reopen(); return equal();
  }
  await reopen(); await equal();
  for (const command of commands) {
    const before = gameplay((await flat.backup()).state);
    const after = gameplay(await run(command));
    assert.equal(gameplay(await run({ type: 'undo' })), before, `exact preimage ${command.type}`);
    assert.equal(gameplay(await run(command)), after, `Redo ${command.type}`);
  }
  const disk = JSON.parse(await readFile(path.join(root, 'owned', 'state.json')));
  assert.equal(disk.schemaVersion, 1); assert.equal(disk.storage.schemaVersion, 2);
  assert(!Object.hasOwn(disk.state, 'tasks')); assert(!Object.hasOwn(disk.state, 'identityRegistry'));
  const calculation = owned.getCalculationSnapshot();
  assert.equal(json(calculation.state), Buffer.from(calculation.stateJSON).toString());
  assert.equal(calculation.taskInputKey.length, 64);
  assert.equal(JSON.parse(owned.getStateSnapshot().stateJSON).revision, owned.getState().revision);
});
test('flag off preserves existing bytes, schema-1 static sidecars, retention and legacy context', async t => {
  const root = await directory(t), dataDir = path.join(root, 'legacy'), state = fixture().state;
  state.legacy = { synthetic: 'x'.repeat(270000) };
  let store = await open(t, dataDir, { initialState: state, retention: false });
  await store.command(commands.at(-1), 0); await store.close();
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  assert.equal(JSON.parse(before).storage.schemaVersion, 1);
  const sidecars = await readdir(path.join(dataDir, 'static'));
  store = await open(t, dataDir, { ownedFormat2: false, retention: false });
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readdir(path.join(dataDir, 'static')), sidecars);
  await store.close();
  const other = await open(t, path.join(root, 'off'), { initialState: state, ownedFormat2: false, retention: false });
  await other.command(commands.at(-1), 0);
  assert.deepEqual(await readFile(path.join(root, 'off', 'state.json')), before);
  await assert.rejects(openStore({ dataDir: path.join(root, 'refused'), ownedFormat2: { ...options(path.join(root, 'catalogue')), pickerId: 'legacy-shared' } }), /owned picker/);
});
test('format 2 and unknown storage versions refuse with flag off without replacing bytes', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned');
  const store = await open(t, dataDir, { retention: false, ownedFormat2: options(path.join(root, 'catalogue')) });
  await store.close();
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  await assert.rejects(openStore({ ...settings, dataDir }), /Invalid static storage metadata/);
  assert.deepEqual(await readFile(file), before);
  const unknown = JSON.parse(before); unknown.storage.schemaVersion = 97;
  const bytes = Buffer.from(json(unknown)); await writeFile(file, bytes);
  for (const ownedFormat2 of [false, options(path.join(root, 'catalogue'))]) {
    await assert.rejects(openStore({ ...settings, dataDir, ownedFormat2 }), /Invalid static storage metadata/);
    assert.deepEqual(await readFile(file), bytes);
  }
});
test('the actual frozen rollback loader refuses format 2 without changing its bytes', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned');
  const store = await open(t, dataDir, { retention: false, ownedFormat2: options(path.join(root, 'catalogue')) });
  await store.close();
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  assert.equal(JSON.parse(before).storage.schemaVersion, 2);
  const frozen = await frozenRuntime(t);
  await assert.rejects(frozen.openStore({ ...settings, dataDir }), /Invalid static storage metadata/);
  assert.deepEqual(await readFile(file), before);
});
test('whole-picker format-2 restore previews flat identities and publishes the reviewed replacement', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), ownedFormat2 = options(path.join(root, 'catalogue'));
  let store = await open(t, dataDir, { retention: false, ownedFormat2 });
  const backup = await store.backup();
  backup.state.members[0].journal = 'Synthetic restored journal';
  backup.state.provenance = { ...backup.state.provenance, dataset: fixture().pin.dataset };
  backup.state.tasks.find(row => row.id === custom).label = 'Synthetic restored task';
  const before = store.getState(), file = path.join(dataDir, 'state.json'), bytes = await readFile(file);
  const detached = await store.previewReplacement(backup);
  assert.doesNotThrow(() => json(detached));
  assert.deepEqual(detached.current, before);
  const preview = await store.prepareTransfer(serialize({ backup }), {
    route: '/api/restore/preview', pickerId: 'synthetic-picker', world,
    dataset: { datasetId: 'synthetic', datasetContractVersion: 1, digest: fixture().pin.dataset.digest, capabilities: {} },
  });
  assert.equal(preview.response.preview.taskCounts.changed, 1);
  assert.deepEqual(store.getState(), before);
  assert.deepEqual(await readFile(file), bytes);
  const applied = await store.applyTransfer(preview.ticket, before.revision);
  assert.equal(applied.state.members[0].journal, 'Synthetic restored journal');
  assert.equal(applied.state.tasks.find(row => row.id === custom).label, 'Synthetic restored task');
  assert.equal(applied.state.history.at(-1).type, 'restore');
  assert.equal(JSON.parse(await readFile(file)).storage.schemaVersion, 2);
  await store.close();
  store = await open(t, dataDir, { retention: false, ownedFormat2 });
  assert.deepEqual(store.getState(), applied.state);
});
test('format 1/2 currency no-ops and metadata-only reports keep identical checkpoint and publication paths', async t => {
  const root = await directory(t), flatDir = path.join(root, 'flat'), ownedDir = path.join(root, 'owned');
  const flat = await open(t, flatDir, { retention: false });
  const owned = await open(t, ownedDir, { retention: false, ownedFormat2: options(path.join(root, 'catalogue')) });
  const paths = { flat: [], owned: [] }, rename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    for (const [name, directory] of [['flat', flatDir], ['owned', ownedDir]]) {
      if (to.startsWith(directory + path.sep)) paths[name].push(path.relative(directory, to));
    }
    return rename(from, to);
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const [index, coins] of [null, null, null, 10, 10].entries()) {
    paths.flat.length = paths.owned.length = 0;
    const report = { memberId: 'member-1', keyId: '00000000-0000-4000-8000-000000000001', seq: index + 1, sentAt: now(), coins };
    assert.deepEqual(await owned.observePluginCurrency(report), await flat.observePluginCurrency(report));
    assert.deepEqual(owned.getState(), flat.getState());
    const count = async directory => (await readdir(path.join(directory, 'backups'))).length;
    const expectedBackups = index < 3 ? 0 : 1;
    assert.equal(await count(flatDir), expectedBackups);
    assert.equal(await count(ownedDir), expectedBackups);
    // Compact preimage names are deliberately unique; compare their publication role.
    const roles = rows => rows.map(file => file.startsWith('backups' + path.sep) ? 'backup' : file);
    assert.deepEqual(roles(paths.owned), roles(paths.flat));
    assert.equal(paths.owned.filter(file => file === 'state.json').length, 1);
    if (index !== 3) assert.deepEqual(paths.owned, ['state.json']);
  }
});
test('prepared proofs see complete tasks/History; fallible hooks get flat detached state and keep distinct compact preimages', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'catalogue');
  let refuse = false, fullCalls = 0, proofCalls = 0;
  const prepareState = state => {
    fullCalls++; assert.equal(typeof state.identityRegistry.entries[fixture().base.tasks[0].id], 'object');
    state.members[0].journal = 'Synthetic prepared'; return state;
  };
  prepareState.isCurrent = state => { proofCalls++; assert(state.tasks.length >= 2); return true; };
  prepareState.commandIsCurrent = prepareState.isCurrent;
  let store = await open(t, dataDir, { retention: false, ownedFormat2: options(catalogueRoot), prepareState,
    beforeCommit: ({ state }) => { assert.equal(json(state), json(materializeResidentState(state))); if (refuse) throw new Error('Synthetic refusal'); } });
  assert.equal(fullCalls, 1);
  await store.command(commands[1], 0);
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  refuse = true;
  for (let index = 0; index < 2; index++) await assert.rejects(store.command(commands[3], 1), /Synthetic refusal/);
  assert.deepEqual(await readFile(file), before);
  const backups = await readdir(path.join(dataDir, 'backups'));
  assert.equal(backups.length, 3); assert.equal(new Set(backups).size, 3);
  for (const name of backups) {
    const bytes = gunzipSync(await readFile(path.join(dataDir, 'backups', name)));
    assert.equal(JSON.parse(bytes).storage.schemaVersion, 2);
    if (name.startsWith('0000000000000001-')) assert.deepEqual(bytes, before);
  }
  await store.close();
  store = await open(t, dataDir, { retention: false, ownedFormat2: options(catalogueRoot), prepareState });
  assert.equal(fullCalls, 1); assert(proofCalls >= 4);
  assert.equal(store.getState().tasks.find(row => row.id === custom).label, 'Synthetic edit one');
});

for (const normalization of ['catalogueTasks', 'progressAliasesVersion']) test(`format 1/2 startup repairs stale ${normalization} with identical revisions and strict-reader refusals`, async t => {
  const root = await directory(t), catalogueRoot = path.join(root, 'catalogue');
  const { state, catalogue, migrateState } = ownedCommandFixture({ taskCount: 8, extraAliases: 6, evidenceCopies: 1 });
  const dataset = { ...ownedDataset, digest: 'b'.repeat(64) };
  state.provenance.dataset.digest = dataset.digest;
  const tasks = state.tasks.map(row => Object.fromEntries(['id', 'label', 'category', 'completionIds', 'skill', 'level']
    .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
  const original = buildOwnedBase({ dataset: state.provenance.dataset, tasks, identityRegistry: state.identityRegistry });
  const manifest = createOwnedBaseManifest([original.pin]);
  // Same dataset, different base bytes: digest equality permits normalization,
  // but the save must retain its selected original base and logical task order.
  const release = buildOwnedBase({ dataset: original.base.dataset, tasks: [...tasks].reverse(), identityRegistry: state.identityRegistry });
  assert.notEqual(release.pin.sha256, original.pin.sha256);
  const source = { pickerId: ownedPickerId, catalogueRoot, dataset: original.pin.dataset, manifest, releaseBytes: original.bytes };
  const newer = { ...source, manifest: createOwnedBaseManifest([release.pin]), releaseBytes: release.bytes, retainedManifests: [manifest] };
  const common = { initialState: state, world: ownedWorld, now: () => ownedNow, retention: false, migrateState,
    taskCatalogue: new Map(catalogue.map(row => [row.id, row])),
    prepareState: preserveGameIdentity(dataset, prepareOwnedPickerState(dataset, ownedRegistry(), ownedPickerId)) };
  const normalized = [];
  for (const owned of [false, true]) {
    const dataDir = path.join(root, owned ? 'owned' : 'flat');
    let store = await open(t, dataDir, { ...common, ownedFormat2: owned ? source : false });
    await store.close();
    const file = path.join(dataDir, 'state.json'), document = JSON.parse(await readFile(file));
    const migration = document.state.legacy.gameplayMigration;
    if (normalization === 'catalogueTasks') migration.report.catalogueTasks = 0;
    else delete migration.progressAliasesVersion;
    const stale = Buffer.from(json(document)); await writeFile(file, stale);
    const reopen = { ...common, ownedFormat2: owned ? newer : false };
    for (const strict of [{ readOnly: true }, { liveSwapStrict: true }]) {
      await assert.rejects(open(t, dataDir, { ...reopen, ...strict }), { code: 'LIVE_SWAP_MIGRATION_REQUIRED' });
      assert.deepEqual(await readFile(file), stale);
    }
    store = await open(t, dataDir, reopen);
    const ready = (await store.backup()).state;
    assert.equal(store.getInfo().revision, 1); assert.equal(ready.revision, 1);
    assert.equal(ready.legacy.gameplayMigration.report.catalogueTasks, 8);
    assert.equal(ready.legacy.gameplayMigration.progressAliasesVersion, 1);
    assert.equal(ready.history.at(-1).type, 'catalogue-refresh');
    assert.equal(json(ready.tasks), json(state.tasks));
    if (owned) assert.deepEqual(JSON.parse(await readFile(file)).storage.base,
      { datasetDigest: original.pin.dataset.digest, sha256: original.pin.sha256 });
    normalized.push(ready);
  }
  assert.deepEqual(normalized[1], normalized[0]);
  assert.equal(hash(normalized[1]), hash(normalized[0]));
});
const seams = ['catalogue-root-durable', 'preimage-durable', 'state-temporary-synced', 'commit-hook-complete',
  'base-temporary-synced', 'base-durable', 'dependencies-durable', 'state-renamed', 'state-directory-synced', 'memory-published'];
for (const seam of seams) test(`crash at ${seam} reopens old or fully readable new save`, async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'new', 'catalogue');
  const initial = await open(t, dataDir, { retention: false }); await initial.close();
  const before = await readFile(path.join(dataDir, 'state.json'));
  const child = fork(fileURLToPath(new URL('./helpers/owned-format2-crash.mjs', import.meta.url)), [dataDir, catalogueRoot, seam], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let diagnostic = ''; child.stderr.on('data', bytes => { diagnostic += bytes; });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  assert.equal(exit, 71, diagnostic);
  const bytes = await readFile(path.join(dataDir, 'state.json')), document = JSON.parse(bytes);
  const reopened = await open(t, dataDir, { retention: false, ownedFormat2: options(catalogueRoot) });
  assert([0, 1].includes(reopened.getState().revision));
  if (document.storage?.schemaVersion === 2) {
    assert.equal(reopened.getState().revision, 1);
    const baseFile = path.join(catalogueRoot, `catalogue-${document.storage.base.sha256}.json.gz`);
    assert.equal(createHash('sha256').update(gunzipSync(await readFile(baseFile))).digest('hex'), document.storage.base.sha256);
  } else assert.deepEqual(bytes, before);
});
test('two publishers deduplicate bases and ordinary writes never republish them', async t => {
  const root = await directory(t), catalogueRoot = path.join(root, 'catalogue'), publications = [];
  const rename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (from, to) => { if (path.dirname(to) === catalogueRoot) publications.push(to); return rename(from, to); });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const [one, two] = await Promise.all([open(t, path.join(root, 'one'), { retention: false, ownedFormat2: options(catalogueRoot) }),
    open(t, path.join(root, 'two'), { retention: false, ownedFormat2: options(catalogueRoot) })]);
  await one.command(commands.at(-1), 0); await two.command(commands.at(-1), 0);
  assert.equal(publications.length, 1);
  assert.equal((await readdir(catalogueRoot)).filter(name => name.endsWith('.json.gz')).length, 1);
});
test('failed base sync, verified reopen and retry sync the dependency before publishing its reference', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'catalogue');
  const initial = await open(t, dataDir, { retention: false }); await initial.close();
  let store = await open(t, dataDir, { retention: false, ownedFormat2: options(catalogueRoot) });
  const file = path.join(dataDir, 'state.json'), before = await readFile(file), { open: fsOpen, rename } = fs.promises;
  let published = false, refuseSync = true;
  const events = [];
  const failure = Object.assign(new Error('Synthetic base sync failure'), { code: 'EIO' });
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (to === file) events.push('state-rename');
    await rename(from, to); if (path.dirname(to) === catalogueRoot) published = true;
  });
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => published && target === catalogueRoot && flags === 'r'
    ? { async sync() { events.push('base-directory-sync'); if (refuseSync) throw failure; }, async close() {} } : fsOpen(target, flags, ...rest));
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(store.command(commands.at(-1), 0), error => error === failure);
  assert.deepEqual(await readFile(file), before);
  const backups = await readdir(path.join(dataDir, 'backups'));
  assert.equal(backups.length, 1); assert.deepEqual(gunzipSync(await readFile(path.join(dataDir, 'backups', backups[0]))), before);
  await store.close();
  const { releaseBytes, ...readerOptions } = options(catalogueRoot);
  store = await open(t, dataDir, { retention: false, ownedFormat2: { ...readerOptions, crash: point => events.push(point) } });
  events.length = 0;
  await assert.rejects(store.command(commands.at(-1), 0), error => error === failure);
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(events.filter(point => ['base-directory-sync', 'dependencies-durable', 'state-rename'].includes(point)), ['base-directory-sync']);
  refuseSync = false; events.length = 0;
  await store.command(commands.at(-1), 0);
  assert.deepEqual(events.filter(point => ['base-directory-sync', 'dependencies-durable', 'state-rename'].includes(point)),
    ['base-directory-sync', 'dependencies-durable', 'state-rename']);
  await store.close();
  store = await open(t, dataDir, { retention: false, ownedFormat2: readerOptions });
  assert.equal(store.getState().revision, 1);
});
test('action receipts publish in the format-2 replacement and replay after reopen', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), ownedFormat2 = options(path.join(root, 'catalogue'));
  let store = await open(t, dataDir, { retention: false, ownedFormat2 });
  const actor = { kind: 'master', label: 'Synthetic operator' };
  const session = await store.openActionSession(randomUUID(), { actor });
  const requestId = `v3.${session.scope}.${session.slot}.${session.generation}.1`;
  const result = await store.commandSerialized(commands.at(-1), 0, { actor, requestId, requestAck: 0 });
  const file = path.join(dataDir, 'state.json'), bytes = await readFile(file), saved = JSON.parse(bytes);
  assert.equal(saved.storage.schemaVersion, 2); assert.equal(saved.actionReceipts.slots[0].receipt.revision, 1);
  await store.close();
  store = await open(t, dataDir, { retention: false, ownedFormat2 });
  const replay = await store.commandSerialized(commands.at(-1), 0, { actor, requestId, requestAck: 0 });
  assert.deepEqual(replay.receipt, result.receipt); assert.equal(store.getState().revision, 1);
  assert.deepEqual(await readFile(file), bytes);
});
test('state parent sync failure adopts the complete format-2 save and reports uncertainty', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), ownedFormat2 = options(path.join(root, 'catalogue'));
  const store = await open(t, dataDir, { retention: false, ownedFormat2 });
  const file = path.join(dataDir, 'state.json'), { open: fsOpen, rename } = fs.promises;
  let published = false; const warnings = [];
  const failure = Object.assign(new Error('Synthetic state sync failure'), { code: 'EIO' });
  t.mock.method(fs.promises, 'rename', async (from, to) => { await rename(from, to); if (to === file) published = true; });
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => published && target === dataDir && flags === 'r'
    ? { async sync() { throw failure; }, async close() {} } : fsOpen(target, flags, ...rest));
  t.mock.method(console, 'warn', message => warnings.push(message));
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await store.command(commands.at(-1), 0);
  assert.equal(store.getState().revision, 1); assert.equal(warnings.length, 1); assert.match(warnings[0], /durability is uncertain/);
  const built = fixture(), document = JSON.parse(await readFile(file));
  assert.deepEqual(ownedCodec(built.base, built.pin).decode(document).state, store.getState());
});
for (const damage of ['missing', 'corrupt', 'wrong-dataset']) test(`${damage} base refuses cold store open without empty seeding or repair`, async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'catalogue'), built = fixture();
  await mkdir(dataDir); await mkdir(catalogueRoot);
  const codec = ownedCodec(built.base, built.pin), document = { format: BACKUP_FORMAT, schemaVersion: 1, ...codec.encode(validateState(built.state)) };
  if (damage === 'wrong-dataset') document.storage.base.datasetDigest = 'a'.repeat(64);
  const bytes = Buffer.from(json(document)), file = path.join(dataDir, 'state.json');
  await writeFile(file, bytes); await writeFile(path.join(dataDir, 'access-token'), 'A'.repeat(43));
  const baseFile = path.join(catalogueRoot, `catalogue-${built.pin.sha256}.json.gz`);
  const baseBytes = damage === 'corrupt' ? gzipSync(Buffer.from('synthetic corrupt bytes')) : gzipSync(built.bytes);
  if (damage !== 'missing') await writeFile(baseFile, baseBytes);
  await assert.rejects(openStore({ ...settings, dataDir, ownedFormat2: options(catalogueRoot) }), /base|pin|reference/i);
  assert.deepEqual(await readFile(file), bytes);
  if (damage === 'missing') await assert.rejects(readFile(baseFile), { code: 'ENOENT' });
  else assert.deepEqual(await readFile(baseFile), baseBytes);
});
for (const damage of ['missing', 'corrupt']) for (const withReleaseBytes of [false, true]) test(`cached base ${damage} refuses same-isolate reopen (release bytes ${withReleaseBytes})`, async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'catalogue');
  const ownedFormat2 = options(catalogueRoot), store = await open(t, dataDir, { retention: false, ownedFormat2 });
  await store.close();
  const file = path.join(dataDir, 'state.json'), before = await readFile(file);
  const baseFile = path.join(catalogueRoot, `catalogue-${fixture().pin.sha256}.json.gz`);
  const damaged = gzipSync(Buffer.from('synthetic cached corruption'));
  if (damage === 'missing') await rm(baseFile); else await writeFile(baseFile, damaged);
  if (!withReleaseBytes) delete ownedFormat2.releaseBytes;
  await assert.rejects(openStore({ ...settings, dataDir, ownedFormat2 }), /Owned catalogue base unavailable/);
  assert.deepEqual(await readFile(file), before);
  if (damage === 'missing') await assert.rejects(readFile(baseFile), { code: 'ENOENT' });
  else assert.deepEqual(await readFile(baseFile), damaged);
});
