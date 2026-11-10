// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { openStore } from '../app/storage/store.mjs';
import { ownedCodec } from '../app/storage/owned-codec.mjs';
import { stageOwnedRebase, reconcileOwnedRebase, stageOwnedDatasetUpgrade } from '../app/storage/owned-rebase.mjs';
import { snapshotStore, snapshotPath } from '../app/storage/snapshot.mjs';
import { importBackup, cancelTaskClaimUndo } from '../app/core/state.mjs';
import { validateOwnedHistory } from '../scripts/linux/probe.mjs';
import { fixture, commands, now, world, taskCatalogue, first, second, custom } from './helpers/owned-format2-fixture.mjs';
import { targetBase, rebaseOptions } from './helpers/owned-rebase-fixture.mjs';

const settings = { now, world, taskCatalogue, completionCodec: false, retention: false, random: () => 0 };
const json = JSON.stringify, sha = value => createHash('sha256').update(json(value)).digest('hex');
const local = fileURLToPath(new URL('../var/', import.meta.url));
async function setup(t) {
  await mkdir(local, { recursive: true });
  const root = await mkdtemp(path.join(local, 'owned-rebase-')), dataDir = path.join(root, 'group');
  const catalogueRoot = path.join(root, 'catalogue'), stores = [];
  const f = { root, dataDir, catalogueRoot, ...rebaseOptions(catalogueRoot), stores };
  f.newer.validateCapture = (dir, options) => validateOwnedHistory(dir, options, { importBackup, cancelTaskClaimUndo });
  f.open = async (dir = dataDir, ownedFormat2 = f.source, extra = {}) => {
    const store = await openStore({ ...settings, dataDir: dir, initialState: fixture().state, ownedFormat2, ...extra });
    stores.push(store); return store;
  };
  f.bind = async (dir = dataDir) => writeFile(dir + '.dataset.json', json({ schemaVersion: 1,
    datasetId: 'synthetic', datasetContractVersion: 1, digest: fixture().pin.dataset.digest }) + '\n');
  f.stage = extra => stageOwnedRebase({ dataDir, ownedFormat2: f.source, target: f.target, ...extra });
  f.finish = extra => reconcileOwnedRebase({ dataDir, ownedFormat2: f.source, target: f.target, ...extra });
  t.after(async () => { for (const store of stores) await store.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}
async function equal(one, two) {
  const a = (await one.backup()).state, b = (await two.backup()).state;
  assert.deepEqual(b, a); assert.equal(json(b.tasks), json(a.tasks));
  assert.equal(json(b.identityRegistry), json(a.identityRegistry));
  assert.equal(json(b.history), json(a.history)); assert.equal(sha(b.history), sha(a.history));
  return a;
}

test('format 1 -> 2 -> rebase preserves generated/custom/assigned/deleted rows, History and command/Undo replay', async t => {
  const f = await setup(t), controlDir = path.join(f.root, 'control');
  let one = await f.open(controlDir, false), two = await f.open(f.dataDir, false);
  for (const command of commands) {
    await one.command(command, one.getInfo().revision); await two.command(command, two.getInfo().revision);
  }
  await one.close(); await two.close(); await f.bind();
  one = await f.open(controlDir); two = await f.open();
  await one.command(commands.at(-1), one.getInfo().revision); await two.command(commands.at(-1), two.getInfo().revision);
  const before = await equal(one, two); await two.close();
  const preimages = new Map(await Promise.all((await readdir(path.join(f.dataDir, 'backups'))).map(async name => [name, await readFile(path.join(f.dataDir, 'backups', name))])));
  const intent = await f.stage();
  assert.equal(intent.historySHA256, sha(before.history));
  await assert.rejects(f.open(), /explicitly reconcile/);
  await f.finish(); two = await f.open(f.dataDir, f.newer);
  await equal(one, two);
  const disk = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
  assert.equal(disk.storage.base.sha256, f.target.pin.sha256);
  const pinned = JSON.parse(gunzipSync(await readFile(path.join(f.dataDir, 'backups', intent.preimage))));
  assert.equal(pinned.retentionPinned, true); assert.equal(pinned.storage.base.sha256, fixture().pin.sha256);
  for (const [name, bytes] of preimages) assert.deepEqual(await readFile(path.join(f.dataDir, 'backups', name)), bytes);
  for (const command of [{ type: 'undo' }, { type: 'undo' }, commands[6], { type: 'undo' }, commands[6]]) {
    const results = [];
    for (const store of [one, two]) {
      try { const result = await store.command(command, store.getInfo().revision); results.push({ revision: result.state?.revision ?? store.getInfo().revision }); }
      catch (error) { results.push({ name: error.name, message: error.message, code: error.code }); }
    }
    assert.deepEqual(results[1], results[0]); await equal(one, two);
  }
  for (const command of [{ type: 'synthetic-unknown' }, { type: 'undo', undoRevision: 999 }]) {
    const errors = await Promise.all([one, two].map(store => store.command(command, store.getInfo().revision).then(() => null, e => e.message)));
    assert(errors[0]); assert.equal(errors[1], errors[0]);
  }
  const conflicts = await Promise.all([one, two].map(store => store.command(commands.at(-1), 0).then(() => null, e => ({ message: e.message, revision: e.state.revision }))));
  assert.deepEqual(conflicts[1], conflicts[0]);
  const portable = JSON.parse((await two.exportBackup()).bytes.toString());
  assert(!portable.storage); const imported = await f.open(path.join(f.root, 'imported'), f.newer, { initialState: importBackup(portable) });
  const importedBackup = (await imported.backup()).state;
  assert.equal(json(importedBackup.tasks), json(portable.state.tasks));
  assert.equal(json(importedBackup.identityRegistry), json(portable.state.identityRegistry));
  assert.equal(json(importedBackup.history), json(portable.state.history));
});

test('newer release keeps the pinned base; release-bound startup preparation refuses only a digest mismatch', async t => {
  const f = await setup(t); let store = await f.open(); await store.close();
  const file = path.join(f.dataDir, 'state.json'), before = await readFile(file);
  store = await f.open(f.dataDir, f.newer); assert.deepEqual(await readFile(file), before);
  assert.deepEqual((await store.backup()).state, store.getState(), 'isolated backup reader uses the pinned catalogue');
  await store.command(commands.at(-1), 0); await store.close();
  assert.equal(JSON.parse(await readFile(file)).storage.base.sha256, fixture().pin.sha256);
  const committed = await readFile(file);
  let calls = 0;
  const prepareState = state => { calls++; return state; };
  prepareState.isCurrent = () => { calls++; return true; };
  const mismatch = { code: 'OWNED_REBASE_REFUSED', message: /dataset digest differs.*explicit upgrade staging.*slice 7/ };
  await assert.rejects(f.open(f.dataDir, f.newer, { prepareState }), mismatch);
  await assert.rejects(f.open(f.dataDir, f.newer, { migrateState: prepareState }), mismatch);
  assert.equal(calls, 0, 'neither currency proofs nor release preparation may run');
  assert.deepEqual(await readFile(file), committed);
});

function semantic(change) {
  return targetBase(projection => {
    projection.tasks.reverse(); // Restore release order for semantic migration.
    return change(projection);
  });
}
const addition = { id: 'rs3:task:synthetic-new', label: 'Synthetic new', category: 'Synthetic' };
function append(projection) {
  projection.tasks.push(addition);
  projection.identityRegistry.entries[addition.id] = { label: addition.label, kind: 'task', category: addition.category, aliases: [] };
  return projection;
}
test('explicit append migration preserves sparse Undo row slots, including archived guards', async t => {
  const f = await setup(t); let store = await f.open();
  for (const command of commands.slice(0, 6)) await store.command(command, store.getInfo().revision);
  const complete = (await store.backup()).state; await store.close(); await f.bind();
  const historyId = 'history-0000000000000001-0000000000000005-0000000000000001.json.gz';
  await writeFile(path.join(f.dataDir, 'history', historyId), gzipSync(json({ format: 'rs3-chunk-picker-history', events: complete.history.slice(0, -1) })));
  const compact = { ...complete, history: complete.history.slice(-1), provenance: { ...complete.provenance, historyArchive: [{ id: historyId }] } };
  await writeFile(path.join(f.dataDir, 'state.json'), json({ format: 'rs3-chunk-picker', schemaVersion: 1, ...ownedCodec(fixture().base, fixture().pin).encode(compact) }));
  const target = semantic(append), source = { ...f.source, retainedManifests: [target.manifest] };
  await f.stage({ target, upgrade: true }); await f.finish({ target, ownedFormat2: source });
  store = await f.open(f.dataDir, source);
  const after = (await store.backup()).state;
  assert.equal(json(after.tasks.slice(0, -1)), json(complete.tasks)); assert.equal(after.tasks.at(-1).id, addition.id);
  assert.equal(json(after.history), json(complete.history));
  await store.command({ type: 'undo' }, store.getInfo().revision);
  assert.equal(store.getState().tasks.at(-1).id, addition.id); assert(store.getState().tasks.some(row => row.id === custom));
});

test('unchanged release aliases preserve generated candidates and exact inflation through upgrade and rebase', async t => {
  const f = await setup(t); let store = await f.open(); await store.command(commands[0], 0);
  const before = (await store.backup()).state; await store.close(); await f.bind();
  const target = semantic(projection => projection), source = { ...f.source, retainedManifests: [target.manifest] };
  const expected = structuredClone(before.identityRegistry.aliases.collision);
  assert.equal(expected.at(-1), taskCatalogue.keys().next().value);
  const intent = await f.stage({ target, upgrade: true });
  assert.deepEqual(intent.migration.decisions, []);
  await f.finish({ target }); store = await f.open(f.dataDir, source);
  const upgraded = (await store.backup()).state;
  assert.equal(json(upgraded.tasks), json(before.tasks)); assert.equal(json(upgraded.history), json(before.history));
  assert.deepEqual(upgraded.identityRegistry.aliases.collision, expected); await store.close();
  const rebased = targetBase(projection => { projection.dataset.digest = 'd'.repeat(64); return projection; });
  const trust = { ...source, retainedManifests: [target.manifest, rebased.manifest] };
  await f.stage({ ownedFormat2: trust, target: rebased }); await f.finish({ ownedFormat2: trust, target: rebased });
  store = await f.open(f.dataDir, trust);
  assert.equal(json((await store.backup()).state), json(upgraded));
});

test('a release-changed alias replaces an untouched group value with the exact new order', async t => {
  const f = await setup(t); let store = await f.open(); const before = (await store.backup()).state;
  await store.close(); await f.bind();
  const target = semantic(projection => { projection.identityRegistry.aliases.collision = [first, second]; return projection; });
  const source = { ...f.source, retainedManifests: [target.manifest] };
  const intent = await f.stage({ target, upgrade: true }); assert.deepEqual(intent.migration.decisions, []);
  await f.finish({ target }); store = await f.open(f.dataDir, source);
  const after = (await store.backup()).state;
  assert.deepEqual(after.identityRegistry.aliases.collision, [first, second]);
  assert.equal(json(after.tasks), json(before.tasks)); assert.equal(json(after.history), json(before.history));
});

test('a release-changed alias with a group-generated candidate refuses explicit migration without merging', async t => {
  const f = await setup(t), store = await f.open(); await store.command(commands[0], 0);
  const before = (await store.backup()).state; await store.close(); await f.bind();
  const target = semantic(projection => { projection.identityRegistry.aliases.collision = [first, second]; return projection; });
  const intent = await f.stage({ target, upgrade: true });
  const staged = JSON.parse(await readFile(path.join(f.dataDir, 'owned-rebase', intent.id, 'state')));
  const state = ownedCodec(target.base, target.pin).decode(staged).state;
  assert.deepEqual(state.identityRegistry.aliases.collision, before.identityRegistry.aliases.collision);
  await assert.rejects(f.finish({ target }), /explicit alias migration decision required/);
  await f.finish({ action: 'abort' });
});

test('new aliases detect saved collisions and removed aliases retain saved values and order', () => {
  const original = fixture(), target = semantic(projection => {
    projection.identityRegistry.aliases['new-alias'] = [second, first];
    delete projection.identityRegistry.aliases.collision; return projection;
  });
  for (const groupValue of [undefined, [second, first], [first, second]]) {
    const state = structuredClone(original.state);
    if (groupValue !== undefined) state.identityRegistry.aliases['new-alias'] = groupValue;
    const result = stageOwnedDatasetUpgrade(state, state, original.base, target.base);
    assert.deepEqual(result.state.identityRegistry.aliases.collision, original.state.identityRegistry.aliases.collision);
    if (json(groupValue) === json([first, second])) {
      assert.deepEqual(result.state.identityRegistry.aliases['new-alias'], groupValue);
      assert.match(result.migration.decisions.join(' '), /explicit alias migration decision required/);
    } else {
      assert.deepEqual(result.state.identityRegistry.aliases['new-alias'], [second, first]);
      assert.deepEqual(result.migration.decisions, []);
    }
  }
});

test('rename/removal/collision stage exact old JSON and additive retirement; commit stops at slice-7 seams', async t => {
  const f = await setup(t), store = await f.open(); await store.command(commands[0], 0);
  const before = (await store.backup()).state; await store.close(); await f.bind();
  const target = semantic(projection => {
    projection.tasks[0].label = 'Synthetic renamed'; projection.tasks.pop();
    projection.identityRegistry.entries[first].label = 'Synthetic renamed'; delete projection.identityRegistry.entries[second];
    projection.identityRegistry.aliases.collision = [first]; return projection;
  });
  const intent = await f.stage({ target, upgrade: true });
  assert(intent.migration.retiredIds.includes(second)); assert.equal(intent.migration.names[first], 'Synthetic renamed');
  const staged = JSON.parse(await readFile(path.join(f.dataDir, 'owned-rebase', intent.id, 'state')));
  const state = ownedCodec(target.base, target.pin).decode(staged).state;
  assert.equal(json(state.tasks), json(before.tasks)); assert.equal(json(state.history), json(before.history));
  assert.deepEqual(state.identityRegistry.aliases.collision, before.identityRegistry.aliases.collision);
  await assert.rejects(f.finish({ target }), /Alias.*explicit alias migration.*Slice 7/s);
  await assert.rejects(f.open(), /explicitly reconcile/);
  await f.finish({ action: 'abort' });
  const reopened = await f.open(); assert.equal(json((await reopened.backup()).state), json(before));
  const prior = structuredClone(before); prior.provenance = { ...prior.provenance, ownedCatalogue: { retiredIds: [addition.id], names: {} } };
  assert.throws(() => stageOwnedDatasetUpgrade(prior, prior, fixture().base, semantic(append).base), /cannot be recycled/);
});

test('reorder, reassignment and live/archived full-catalogue Undo refuse an explicit boundary decision', async t => {
  const state = fixture().state;
  assert.throws(() => stageOwnedDatasetUpgrade(state, state, fixture().base, targetBase().base), /reorder.*explicit migration\/Undo-boundary/);
  const reassigned = semantic(projection => { projection.identityRegistry.entries[first].kind = 'collection'; return projection; });
  assert.throws(() => stageOwnedDatasetUpgrade(state, state, fixture().base, reassigned.base), /reassigned.*Undo-boundary/);
  for (const history of [[{ undo: { tasks: state.tasks } }], [{ undo: { tasks: state.tasks }, undoneRevision: 9 }]]) {
    assert.throws(() => stageOwnedDatasetUpgrade(state, { ...state, history }, fixture().base, semantic(append).base), /full-catalogue Undo.*explicit migration\/Undo-boundary/);
  }
});

test('registry-only additions refuse IDs retained only in restore.previousHistory', () => {
  const original = fixture(), state = original.state, id = 'rs3:goal:synthetic-history-only';
  state.provenance = { restore: { previousHistory: [{ id: 'revision-1', revision: 1, type: 'tick-active-tasks', at: now(),
    command: { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [id] },
    undo: { tasks: [{ id, label: 'Synthetic previous goal', category: 'Synthetic previous' }] } }] } };
  const complete = importBackup({ format: 'rs3-chunk-picker', schemaVersion: 1, state });
  const target = semantic(projection => {
    projection.identityRegistry.entries[id] = { label: 'Synthetic reintroduced identity', kind: 'task', category: 'Synthetic reassigned', aliases: [] };
    return projection;
  });
  assert(!original.base.identityRegistry.entries[id]); assert(!complete.identityRegistry.entries[id]);
  assert(!target.base.tasks.some(row => row.id === id)); assert.equal(complete.history.length, 0);
  assert.throws(() => stageOwnedDatasetUpgrade(complete, complete, original.base, target.base), {
    code: 'OWNED_REBASE_REFUSED', message: /Identity rs3:goal:synthetic-history-only.*historical identity.*explicit identity migration\/Undo-boundary/,
  });
});

for (const [operation, seam] of [
  ...['before-preimage', 'after-preimage', 'intent-durable'].map(seam => ['stage', seam]),
  ...['before-base-publication', 'after-base-publication', 'before-binding-publication', 'after-binding-publication',
    'before-state-rename', 'after-state-rename', 'before-intent-clear'].map(seam => ['commit', seam]),
]) test(`process crash ${operation}/${seam} is old or explicitly resumable with intact dependencies`, async t => {
  const f = await setup(t), store = await f.open(); const expected = (await store.backup()).state;
  await store.close(); await f.bind();
  if (operation === 'commit') await f.stage();
  const child = fork(fileURLToPath(new URL('./helpers/owned-rebase-crash.mjs', import.meta.url)),
    [f.dataDir, f.catalogueRoot, operation, seam], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic += chunk; });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(exit, 72, diagnostic);
  if (operation === 'commit' || seam === 'intent-durable') {
    await assert.rejects(f.open(), /explicitly reconcile/); await f.finish();
  }
  const reopened = await f.open(f.dataDir, f.newer); assert.equal(json((await reopened.backup()).state), json(expected));
  assert((await readdir(path.join(f.dataDir, 'backups'))).length >= (seam === 'before-preimage' ? 0 : 1));
});

for (const damage of ['missing-old', 'missing-new', 'corrupt-old', 'corrupt-new', 'wrong-dataset', 'untrusted-old', 'changed-content']) test(`${damage} refuses without replacing source`, async t => {
  const f = await setup(t), store = await f.open(); await store.close(); await f.bind();
  const file = path.join(f.dataDir, 'state.json'), before = await readFile(file);
  const oldFile = path.join(f.catalogueRoot, `catalogue-${fixture().pin.sha256}.json.gz`);
  let target = f.target, ownedFormat2 = f.source;
  if (damage === 'missing-old') await rm(oldFile);
  if (damage === 'corrupt-old') await writeFile(oldFile, gzipSync(Buffer.from('Corrupt synthetic base')));
  if (damage === 'missing-new') target = { ...target, releaseBytes: undefined };
  if (damage === 'corrupt-new') {
    await writeFile(path.join(f.catalogueRoot, `catalogue-${target.pin.sha256}.json.gz`), gzipSync(Buffer.from('Corrupt synthetic base')));
    target = { ...target, releaseBytes: undefined };
  }
  if (damage === 'wrong-dataset') target = targetBase(projection => { projection.dataset.id = 'synthetic-other'; return projection; });
  if (damage === 'untrusted-old') ownedFormat2 = { ...f.newer, retainedManifests: [] };
  if (damage === 'changed-content') target = semantic(append);
  await assert.rejects(f.stage({ target, ownedFormat2 }), /base|dataset|Catalogue content/i);
  assert.deepEqual(await readFile(file), before);
});

test('a live command writer refuses rebase, and capture waits for the complete stopped transaction', async t => {
  const f = await setup(t), store = await f.open(); await f.bind();
  await assert.rejects(f.stage(), /Another server/); await store.command(commands.at(-1), 0); await store.close();
  // Both hashes may share a dataset digest across generator representations.
  f.target = targetBase(projection => { projection.dataset.digest = fixture().pin.dataset.digest; return projection; });
  f.source.retainedManifests = [f.target.manifest];
  f.newer = { ...f.newer, dataset: f.target.dataset, manifest: f.target.manifest, releaseBytes: f.target.bytes };
  await f.stage();
  let entered, resume; const reached = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const commit = f.finish({ crash: async point => { if (point === 'after-binding-publication') { entered(); await gate; } } });
  await reached;
  const id = randomUUID(), capture = snapshotStore(f.dataDir, id, { ownedFormat2: f.newer });
  resume(); await commit; await capture;
  t.after(() => rm(path.dirname(snapshotPath(f.dataDir, id)), { recursive: true, force: true }));
  const captured = JSON.parse(await readFile(path.join(snapshotPath(f.dataDir, id), 'store', 'state.json')));
  assert.equal(captured.storage.base.sha256, f.target.pin.sha256);
  const closure = JSON.parse(await readFile(path.join(snapshotPath(f.dataDir, id), 'owned-closure.json')));
  assert.equal(closure.retainedManifests.length, 1);
  const restored = await f.open(path.join(snapshotPath(f.dataDir, id), 'store'), { ...f.newer, catalogueRoot: path.join(snapshotPath(f.dataDir, id), 'catalogue') });
  assert.equal(restored.getInfo().revision, 1);
});

test('format-1 and legacy-shared command/error/Undo and durable bytes match origin/main', async t => {
  const f = await setup(t), reference = path.join(f.root, 'reference'); await mkdir(reference);
  const archive = path.join(f.root, 'reference.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, 'origin/main', 'app', 'scripts']);
  execFileSync('tar', ['-xf', archive, '-C', reference]);
  const old = await import(pathToFileURL(path.join(reference, 'app/storage/store.mjs')));
  for (const kind of ['format-1', 'legacy-shared']) {
    const stores = [];
    for (const [index, api] of [old, { openStore }].entries()) {
      const dir = path.join(f.root, `${kind}-${index}`);
      const store = await api.openStore({ ...settings, dataDir: dir, initialState: fixture().state, ownedFormat2: false });
      f.stores.push(store); stores.push(store);
      await writeFile(path.join(dir, 'access-token'), Buffer.alloc(32, 1).toString('base64url') + '\n');
    }
    for (const command of [commands[1], { type: 'undo' }, { type: 'synthetic-unknown' }]) {
      const result = await Promise.all(stores.map(store => store.command(command, store.getInfo().revision).then(() => ({ state: store.getState() }), error => ({ error: error.message }))));
      assert.deepEqual(result[1], result[0]);
      assert.deepEqual(await readFile(path.join(f.root, `${kind}-1`, 'state.json')), await readFile(path.join(f.root, `${kind}-0`, 'state.json')));
    }
    await Promise.all(stores.map(store => store.close()));
    // Backup filenames are intentionally random; compare every retained byte.
    const retained = async index => Promise.all((await readdir(path.join(f.root, `${kind}-${index}`, 'backups'))).sort().map(async name => gunzipSync(await readFile(path.join(f.root, `${kind}-${index}`, 'backups', name))).toString()));
    assert.deepEqual((await retained(1)).sort(), (await retained(0)).sort());
  }
});
