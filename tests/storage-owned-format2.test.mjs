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
import { openStore } from '../app/storage/store.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
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
test('base directory sync failure is strict and leaves the old save with its durable preimage', async t => {
  const root = await directory(t), dataDir = path.join(root, 'owned'), catalogueRoot = path.join(root, 'catalogue');
  const initial = await open(t, dataDir, { retention: false }); await initial.close();
  const store = await open(t, dataDir, { retention: false, ownedFormat2: options(catalogueRoot) });
  const file = path.join(dataDir, 'state.json'), before = await readFile(file), { open: fsOpen, rename } = fs.promises;
  let published = false;
  const failure = Object.assign(new Error('Synthetic base sync failure'), { code: 'EIO' });
  t.mock.method(fs.promises, 'rename', async (from, to) => { await rename(from, to); if (path.dirname(to) === catalogueRoot) published = true; });
  t.mock.method(fs.promises, 'open', async (target, flags, ...rest) => published && target === catalogueRoot && flags === 'r'
    ? { async sync() { throw failure; }, async close() {} } : fsOpen(target, flags, ...rest));
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(store.command(commands.at(-1), 0), error => error === failure);
  assert.deepEqual(await readFile(file), before);
  const backups = await readdir(path.join(dataDir, 'backups'));
  assert.equal(backups.length, 1); assert.deepEqual(gunzipSync(await readFile(path.join(dataDir, 'backups', backups[0]))), before);
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
