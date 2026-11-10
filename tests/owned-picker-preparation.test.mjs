// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { openStore } from '../app/storage/store.mjs';
import { exportBackup } from '../app/core/state.mjs';
import { prepareOwnedPickerState, preserveGameIdentity } from '../app/game-profile.mjs';
import { ownedCommandFixture, ownedCommandSequence, ownedDataset, ownedNow, ownedPickerId,
  ownedRegistry, ownedWorld } from '../scripts/perf/owned-command-fixture.mjs';

async function fixture(t, { fullPath = false, retention = false, historyPrefix = 0 } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'owned-preparation-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const dataset = structuredClone(ownedDataset), registry = ownedRegistry(), calls = { full: [], load: 0, command: 0, migration: [] };
  const { state, catalogue, migrateState: migrate } = ownedCommandFixture({ taskCount: 8, extraAliases: 6, evidenceCopies: 1 });
  state.revision = historyPrefix;
  state.history = Array.from({ length: historyPrefix }, (_, index) => ({ id: `revision-${index + 1}`,
    revision: index + 1, type: 'catalogue-refresh', at: ownedNow }));
  const check = prepareOwnedPickerState(dataset, registry, ownedPickerId);
  const prepare = (state, context) => {
    calls.full.push(context.operation);
    assert.equal(context.migration.state, state);
    assert.equal(context.catalogue.length, 8);
    return check(state, context);
  };
  if (!fullPath) for (const [key, operation] of [['isCurrent', 'load'], ['commandIsCurrent', 'command']]) {
    prepare[key] = state => { calls[operation]++; return check[key](state); };
  }
  const migrateState = (state, context) => { calls.migration.push(context.operation); return migrate(state, context); };
  migrateState.isCurrent = migrate.isCurrent;
  const options = { dataDir, world: ownedWorld, initialState: state, prepareState: preserveGameIdentity(dataset, prepare),
    prepareImportState: prepare, migrateState, retention, now: ownedNow };
  let store;
  const open = async () => { store = await openStore(options); const opened = store; t.after(() => opened.close()); return store; };
  await open();
  return { dataDir, dataset, registry, calls, options, store, open, catalogue };
}

test('owned commands and reopen recheck authorization without full preparation or a save rewrite', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.calls.full, ['initialize']);
  for (const command of ownedCommandSequence) await f.store.command(command, f.store.getInfo().revision);
  assert.equal(f.calls.command, ownedCommandSequence.length);
  assert.deepEqual(f.calls.full, ['initialize']);
  assert.deepEqual(f.calls.migration, ['initialize']);
  const state = f.store.getState(), history = await f.store.queryHistory();
  const bytes = await readFile(path.join(f.dataDir, 'state.json'));
  const backups = await f.store.listBackups();
  await f.store.close();
  const reopened = await f.open();
  assert.equal(f.calls.load, 1);
  assert.deepEqual(f.calls.full, ['initialize']);
  assert.deepEqual(reopened.getState(), state);
  assert.deepEqual(await reopened.queryHistory(), history);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), bytes);
  assert.deepEqual(await reopened.listBackups(), backups);
});

for (const mismatch of ['unregistered member', 'missing required member']) {
  test(`owned ${mismatch} is refused with 403 on the next command and load`, async t => {
    const f = await fixture(t), before = f.store.getState();
    const bytes = await readFile(path.join(f.dataDir, 'state.json'));
    if (mismatch === 'unregistered member') f.registry.memberIds = ['synthetic-a'];
    else f.registry.memberships.push({ pickerId: ownedPickerId, memberId: 'synthetic-missing', role: 'player' });
    await assert.rejects(f.store.command(ownedCommandSequence[0], before.revision), { status: 403 });
    assert.equal(f.calls.command, 1);
    assert.deepEqual(f.store.getState(), before);
    assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), bytes);
    await f.store.close();
    await assert.rejects(f.open(), { status: 403 });
    assert.equal(f.calls.load, 1);
    assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), bytes);
    assert(!(await readdir(f.dataDir)).includes('store.lock'));
  });
}

test('a viewer without a player row does not become a required member', async t => {
  const f = await fixture(t);
  f.registry.memberships.push({ pickerId: ownedPickerId, memberId: null, role: 'viewer' });
  await f.store.command(ownedCommandSequence[0], 0);
  await f.store.close();
  assert.equal((await f.open()).getInfo().revision, 1);
});

for (const field of ['id', 'contractVersion', 'digest']) test(`owned dataset ${field} mismatch is refused with 422 on command, load and replace`, async t => {
  const f = await fixture(t), foreign = structuredClone(ownedDataset);
  foreign[field === 'id' ? 'datasetId' : field === 'contractVersion' ? 'datasetContractVersion' : field] = field === 'contractVersion' ? 2 : 'foreign';
  const prepareState = preserveGameIdentity(foreign, prepareOwnedPickerState(foreign, f.registry, ownedPickerId));
  const { state: initial } = ownedCommandFixture({ taskCount: 8, extraAliases: 6, evidenceCopies: 1 });
  await assert.rejects(f.store.replace({ ...initial, provenance: { dataset: { ...initial.provenance.dataset,
    [field]: field === 'contractVersion' ? 2 : 'foreign' } } }, 0), { status: 422 });
  // Simulate a changed dataset provider after the store opened, without private inputs.
  const key = field === 'id' ? 'datasetId' : field === 'contractVersion' ? 'datasetContractVersion' : field;
  const previous = f.dataset[key];
  try {
    f.dataset[key] = foreign[key];
    await assert.rejects(f.store.command(ownedCommandSequence[0], 0), { status: 422 });
  } finally { f.dataset[key] = previous; }
  await f.store.close();
  const bytes = await readFile(path.join(f.dataDir, 'state.json'));
  await assert.rejects(openStore({ ...f.options, prepareState }), { status: 422 });
  assert.deepEqual(await readFile(path.join(f.dataDir, 'state.json')), bytes);
});

test('replace, portable import and restore run full migration and preparation despite current proofs', async t => {
  const f = await fixture(t);
  await f.store.command(ownedCommandSequence[0], 0);
  const portable = await f.store.backup(), snapshot = (await f.store.listBackups())[0];
  for (const incoming of [f.store.getState(), portable, await f.store.readBackup(snapshot.id)]) {
    const full = f.calls.full.length, migrations = f.calls.migration.length;
    await f.store.replace(incoming, f.store.getInfo().revision);
    assert.equal(f.calls.full.length, full + 1);
    assert.equal(f.calls.full.at(-1), 'replace');
    assert.equal(f.calls.migration.length, migrations + 1);
    assert.equal(f.calls.migration.at(-1), 'replace');
    assert.equal(f.store.getState().history.at(-1).type, 'restore');
    assert.equal(f.store.getState().history.length, 1);
  }
});

test('replacement still validates hook output and isolates retained hook references', async t => {
  const f = await fixture(t);
  let corrupt = false, retained;
  const check = prepareOwnedPickerState(ownedDataset, f.registry, ownedPickerId);
  const hook = Object.assign((state, context) => {
    retained = state;
    if (corrupt) state.members[0].unlocked = ['invalid-chunk'];
    return check(state, context);
  }, { isCurrent: check.isCurrent, commandIsCurrent: check.commandIsCurrent });
  await f.store.close();
  const store = await openStore({ ...f.options, prepareState: preserveGameIdentity(ownedDataset, hook) });
  t.after(() => store.close());
  const before = store.getState(), incoming = exportBackup(before);
  corrupt = true;
  await assert.rejects(store.replace(incoming, before.revision), /chunk ID/);
  assert.deepEqual(store.getState(), before);
  corrupt = false;
  await store.replace(incoming, before.revision);
  const committed = store.getState();
  retained.members[0].journal = 'Retained hook reference';
  assert.deepEqual(store.getState(), committed);
  assert.deepEqual(incoming, exportBackup(before));
});

test('isolated import, restore and member restore always run the full caller hook', async t => {
  const f = await fixture(t), backup = await f.store.backup();
  for (const route of ['/api/import/preview', '/api/restore/preview', '/api/member-restore/preview']) {
    const member = route.startsWith('/api/member-restore'), before = f.store.getState();
    const fullCalls = f.calls.full.length, proofs = [f.calls.load, f.calls.command];
    const reviewed = await f.store.prepareTransfer(serialize({ backup,
      ...(member ? { memberId: 'synthetic-a', sourceMemberId: 'synthetic-a' }
        : { rosterMapping: { 'synthetic-a': 'synthetic-a', 'synthetic-b': 'synthetic-b' } }) }),
    { route, pickerId: ownedPickerId, dataset: f.dataset, world: ownedWorld,
      migration: { definitions: { challenges: {} }, taskMap: {}, catalogue: f.catalogue }, requiredMemberIds: ['synthetic-a'] });
    assert.equal(f.calls.full.length, fullCalls + 1);
    assert.equal(f.calls.full.at(-1), member ? 'command' : 'replace');
    assert.deepEqual([f.calls.load, f.calls.command], proofs, 'Transfer cannot use gameplay/load currency proofs');
    assert.deepEqual(f.store.getState(), before, 'Preview must leave committed gameplay untouched');
    await f.store.applyTransfer(reviewed.ticket, before.revision);
    assert.equal(f.store.getInfo().revision, before.revision + 1);
  }
});

test('a stale migration still runs before preparation and supplies the same context', async t => {
  const f = await fixture(t);
  await f.store.close();
  const document = JSON.parse(await readFile(path.join(f.dataDir, 'state.json')));
  delete document.state.legacy.gameplayMigration.progressAliasesVersion;
  await writeFile(path.join(f.dataDir, 'state.json'), JSON.stringify(document));
  const reopened = await f.open();
  assert.deepEqual(f.calls.full, ['initialize', 'load']);
  assert.deepEqual(f.calls.migration, ['initialize', 'load']);
  assert.equal(reopened.getState().legacy.gameplayMigration.progressAliasesVersion, 1);
});

test('a command with stale migration currency retains the full migration and preparation path', async t => {
  const f = await fixture(t);
  f.options.migrateState.isCurrent = () => false;
  await f.store.command(ownedCommandSequence[0], 0);
  assert.deepEqual(f.calls.full, ['initialize', 'command']);
  assert.deepEqual(f.calls.migration, ['initialize', 'command']);
  assert.equal(f.store.getState().revision, 1);
});

for (const archived of [false, true]) test(`fast and old full paths produce identical state, revision, Undo and History${archived ? ' with archived events' : ''}`, async t => {
  const options = { retention: archived ? { historyEntries: 2 } : false, historyPrefix: archived ? 3 : 0 };
  const fast = await fixture(t, options), full = await fixture(t, { ...options, fullPath: true });
  const originalRules = fast.store.getState().rules;
  const comparable = async store => {
    const backup = await store.backup(), state = store.getState();
    // Archive filenames contain storage entropy. Compare every live field and
    // the fully hydrated portable contents while normalizing only those names.
    if (state.provenance?.historyArchive) state.provenance.historyArchive = state.provenance.historyArchive
      .map((reference, index) => ({ ...reference, id: `synthetic-archive-${index}` }));
    return { state, portable: backup.state, revision: store.getInfo().revision, history: await store.queryHistory(),
      undo: store.getUndoEligibility(), recent: store.getRecentHistory() };
  };
  for (const command of [...ownedCommandSequence, { type: 'undo' }]) {
    for (const f of [fast, full]) await f.store.command(command, f.store.getInfo().revision);
    assert.deepEqual(await comparable(fast.store), await comparable(full.store));
  }
  const state = fast.store.getState();
  assert.deepEqual(state.members[0].completedTasks, []);
  assert.deepEqual(state.rules, originalRules);
  assert.equal(state.members[0].notes['12341'], 'Synthetic note');
  assert.equal(state.members[1].notes?.['12342'], undefined);
  assert.equal(state.revision, options.historyPrefix + 7);
  assert(archived ? state.provenance.historyArchive.length > 0 : !state.provenance.historyArchive);
  await fast.store.close(); await full.store.close();
  assert.deepEqual(await comparable(await fast.open()), await comparable(await full.open()));
});

test('identity proof composition keeps arbitrary hooks conservative and independent proofs distinct', async () => {
  const { state } = ownedCommandFixture({ taskCount: 1, extraAliases: 1, evidenceCopies: 0 });
  const ordinary = preserveGameIdentity(ownedDataset, state => state);
  assert.equal(ordinary.isCurrent, undefined);
  assert.equal(ordinary.commandIsCurrent, undefined);
  const loadOnly = Object.assign(state => state, { isCurrent: () => true });
  const wrapped = preserveGameIdentity(ownedDataset, loadOnly);
  assert.equal(wrapped.isCurrent(state), true);
  assert.equal(wrapped.commandIsCurrent, undefined);
  const check = prepareOwnedPickerState(ownedDataset, ownedRegistry(), ownedPickerId);
  const current = preserveGameIdentity(ownedDataset, check);
  assert.equal(current.isCurrent(state), true);
  assert.equal(current.commandIsCurrent(state), true);
  state.provenance.dataset.extra = true;
  assert.equal(current.isCurrent(state), false, 'Full preparation must remove extra identity fields');
  assert.equal(current.commandIsCurrent(state), false);
});
