// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { observeStateCopies } from './helpers/state-copy-observer.mjs';

const observer = observeStateCopies();
const { copyFixture, note } = await import('./helpers/state-copy-fixture.mjs');
const { applyCommand, applyResidentCommand, createResidentState, materializeResidentState, importBackup } = await import('../app/core/state.mjs');
const { ownedCodec } = await import('../app/storage/owned-codec.mjs');
const { generated, first } = await import('./helpers/owned-format2-fixture.mjs');
const { deltaAliasCases } = await import('./helpers/delta-alias-fixture.mjs');
observer.loaded();
const base = new URL('../.local/state-copy/synthetic/', import.meta.url);
await mkdir(base, { recursive: true });
const goldens = JSON.parse(await readFile(new URL('fixtures/plugin-state-copy-wire.v1.json', import.meta.url)));

async function setup(t, format, overrides) {
  const root = await mkdtemp(base);
  assert.ok(root.startsWith(fileURLToPath(base)));
  let f;
  try { f = await copyFixture(root.replaceAll('\\', '/'), format, overrides); }
  catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  t.after(async () => {
    await f.close();
    assert.ok(root.startsWith(fileURLToPath(base)));
    await rm(root, { recursive: true, force: true });
  });
  return f;
}
function bounded(counts, operation) {
  assert.deepEqual({ ...counts, partialValidations: 0 }, { structuredCopies: 0, jsonCopies: 0, residentCopies: 0,
    materializations: 0, validations: 0, partialValidations: 0 }, operation);
  console.log(JSON.stringify({ operation, ...counts }));
}
async function diskState(f) {
  const document = JSON.parse(await readFile(`${f.config.dataDir}/state.json`));
  return f.config.ownedFormat2 ? ownedCodec(f.built.base, f.built.pin).decode(document).state : document.state;
}

for (const format of [1, 2]) {
  test(`format ${format}: command, write, snapshots and plugin wire preserve the validated bytes without whole-state work`, async t => {
    const f = await setup(t, format), original = f.store.getState();
    bounded((await observer.measure(() => f.plugin())).counts, `format ${format} plugin startup`);
    const before = await readFile(`${f.config.dataDir}/state.json`), command = note('Synthetic command');
    const expected = applyCommand(original, command, f.config);
    const { result, counts } = await observer.measure(() => f.store.commandSerialized(command, 0, { view: 'play-v1' }));
    bounded(counts, `format ${format} command/write/reply`);
    assert.ok(counts.partialValidations > 0, 'changed gameplay still crosses the validator');
    assert.deepEqual(f.calls, [], 'replacement-only hook is not invoked for commands');
    assert.equal(result.revision, 1);
    assert.deepEqual(await diskState(f), expected, 'disk is exactly the independently fully validated command output');
    const bytes = await readFile(`${f.config.dataDir}/state.json`, 'utf8'), document = JSON.parse(bytes);
    const expectedDocument = format === 2 ? { ...document, ...ownedCodec(f.built.base, f.built.pin).encode(expected) }
      : { ...document, state: expected };
    assert.equal(bytes, JSON.stringify(expectedDocument) + '\n', 'exact physical bytes encode the validated output');
    assert.deepEqual(f.store.getState(), expected);
    const backups = await readdir(`${f.config.dataDir}/backups`);
    assert.equal(backups.length, 1);
    assert.deepEqual(gunzipSync(await readFile(`${f.config.dataDir}/backups/${backups[0]}`)), before, 'backup bytes are unchanged');
    const wire = [];
    bounded((await observer.measure(async () => wire.push(await f.call('status')))).counts, `format ${format} plugin status`);
    bounded((await observer.measure(async () => {
      wire.push(await f.call('report', { v: 1, seq: 1, sentAt: '2026-01-01T00:00:00.000Z', position: { x: 0, z: 100, floor: 0 } }));
      wire.push(await f.call('tasks'));
    })).counts, `format ${format} plugin report/tasks`);
    await f.store.commandSerialized({ type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first] }, 1);
    bounded((await observer.measure(async () => wire.push(await f.call('tasks')))).counts, `format ${format} completed plugin tasks`);
    assert.ok(JSON.parse(wire.at(-1)).done.all.length > 0, 'golden includes a completed task');
    assert.deepEqual(wire, goldens.find(row => row.format === format).wire, 'exact v1 wire bytes captured from 4e20eee1');
    bounded((await observer.measure(() => f.store.getStateSnapshot())).counts, `format ${format} state snapshot`);
    const old = f.store.getCalculationSnapshot().readState, tasks = old.tasks, legacy = old.legacy;
    await f.store.commandSerialized(note('Later revision'), 2);
    const next = f.store.getCalculationSnapshot().readState;
    assert.equal(next.tasks, tasks); assert.equal(next.legacy, legacy, 'unchanged retained evidence is not copied each revision');
    assert.equal(old.members[0].notes['100'], 'Synthetic command');
    assert.equal(next.members[0].notes['100'], 'Later revision');
    const tick = await observer.measure(() => f.store.commandSerialized({ type: 'tick-active-tasks', memberId: 'member-2', taskIds: [first] }, 3));
    bounded(tick.counts, `format ${format} canonical tick`);
    assert.ok(tick.counts.partialValidations > 0);
  });

  test(`format ${format}: returned objects cannot mutate storage and a partially applied command is discarded`, async t => {
    const f = await setup(t, format), before = f.store.getState(), bytes = await readFile(`${f.config.dataDir}/state.json`);
    const read = f.store.getCalculationSnapshot().readState, claim = f.store.getTaskClaimReadState();
    for (const action of [() => { read.members[0].name = 'External'; }, () => read.tasks.pop(),
      () => { read.identityRegistry.entries[generated].label = 'External'; }, () => { read.legacy.synthetic.retained = false; },
      () => { read.rules['access.shared'] = false; }, () => { claim.members[0].unlocked.push('100'); },
      () => { claim.identityRegistry.entries[generated] = {}; }]) assert.throws(action, TypeError);
    const detached = f.store.getCalculationSnapshot().state;
    detached.members[0].name = 'Detached external'; detached.tasks[0].label = 'Detached external';
    detached.identityRegistry.entries[generated].label = 'Detached external';
    f.store.getState().legacy.synthetic.retained = false;
    f.store.getTaskClaimState().members[0].name = 'Detached external';
    const counts = (await observer.measure(async () => {
      await assert.rejects(f.store.commandSerialized({ type: 'tick-active-tasks', memberId: 'member-1',
        taskIds: [generated, 'custom:missing'] }, 0), /Unknown task/);
    })).counts;
    if (format === 1) bounded(counts, `format ${format} failed registration`);
    else assert.ok(counts.validations > 0, 'catalogue registration retains full resident validation');
    assert.deepEqual(f.store.getState(), before);
    assert.deepEqual(await readFile(`${f.config.dataDir}/state.json`), bytes);
    assert.equal(f.store.getCalculationSnapshot().readState, read);
    assert.equal(f.store.getTaskClaimReadState(), claim);
  });

  test(`format ${format}: general hooks remain detached, cannot alter published bytes and can veto a write`, async t => {
    let refuse = false, hookState;
    const f = await setup(t, format, { beforeCommit({ state }) {
      hookState = state; state.members[0].name = 'External hook mutation'; state.tasks[0].label = 'External hook mutation';
      if (refuse) throw new Error('Synthetic commit refusal');
    } });
    await f.store.commandSerialized(note('Committed'), 0);
    const committed = f.store.getState();
    assert.notEqual(committed.members[0].name, hookState.members[0].name);
    assert.deepEqual(await diskState(f), committed);
    hookState.legacy.synthetic.retained = false;
    assert.equal(f.store.getState().legacy.synthetic.retained, true);
    const bytes = await readFile(`${f.config.dataDir}/state.json`);
    refuse = true;
    await assert.rejects(f.store.commandSerialized(note('Refused'), 1), /Synthetic commit refusal/);
    assert.deepEqual(f.store.getState(), committed);
    assert.deepEqual(await readFile(`${f.config.dataDir}/state.json`), bytes);
  });

  test(`format ${format}: an in-flight write keeps readers on a complete committed revision`, async t => {
    const entered = Promise.withResolvers(), resume = Promise.withResolvers();
    const f = await setup(t, format, { beforeCommit: async () => { entered.resolve(); await resume.promise; } });
    const old = f.store.getCalculationSnapshot().readState, bytes = await readFile(`${f.config.dataDir}/state.json`);
    const command = f.store.commandSerialized(note('Published later'), 0);
    try {
      await Promise.race([entered.promise, command.then(() => assert.fail('Commit hook was skipped'))]);
      assert.equal(f.store.getCalculationSnapshot().readState, old);
      assert.equal(old.revision, 0); assert.equal(old.members[0].notes, undefined);
      assert.deepEqual(await readFile(`${f.config.dataDir}/state.json`), bytes);
    } finally { resume.resolve(); }
    await command;
    assert.equal(f.store.getCalculationSnapshot().readState.members[0].notes['100'], 'Published later');
    assert.equal(old.revision, 0); assert.equal(old.members[0].notes, undefined);
  });

  test(`format ${format}: imports, restores and migration hooks retain full validation`, async t => {
    // Keep this restore in the current isolate to observe the full validator;
    // isolated transfer/restore workers have their own integration coverage.
    const f = await setup(t, format, { prepareState: state => state });
    const backup = await f.store.backup(), bytes = await readFile(`${f.config.dataDir}/state.json`);
    const invalid = structuredClone(backup); invalid.state.tasks[0].memberIds = ['synthetic-absent'];
    const imported = await observer.measure(() => assert.throws(() => importBackup(invalid), /absent member/));
    assert.ok(imported.counts.validations > 0);
    const restored = await observer.measure(async () => {
      await assert.rejects(f.store.replace(invalid, 0), /absent member/);
      await f.store.previewReplacement(backup);
      await f.store.replace(backup, 0);
    });
    assert.ok(restored.counts.validations >= 3, 'restore input, hydrated history and final result retain full validation');
    assert.deepEqual(f.calls, ['replace']);
    assert.notDeepEqual(await readFile(`${f.config.dataDir}/state.json`), bytes);
    assert.deepEqual(await diskState(f), f.store.getState());
    const migration = await observer.measure(() => assert.rejects(setup(t, format, { migrateState(state) {
      state.tasks[0].memberIds = ['synthetic-absent']; return state;
    } }), /absent member/));
    assert.ok(migration.counts.validations > 0, 'migration output crosses the full validator');
  });
}

test('resident proofs are dropped after catalogue edits and recover only after full normalization', async t => {
  const f = await setup(t, 2);
  await f.store.commandSerialized({ type: 'tick-active-tasks', memberId: 'member-1', taskIds: [generated] }, 0);
  const normalized = await observer.measure(() => f.store.commandSerialized(note('Normalize after registration'), 1));
  assert.ok(normalized.counts.validations > 0, 'an unproved root must cross full resident validation');
  bounded((await observer.measure(() => f.store.commandSerialized(note('Reuse normalized root'), 2))).counts, 'resident recovered proof');
});

test('historical alias Undo and its following notes match the original resident command path', async t => {
  const row = deltaAliasCases().find(row => row.name === 'Undo restoring a historical alias');
  const f = await setup(t, 2, { initialState: row.state, taskCatalogue: row.catalogue });
  let reference = createResidentState(f.store.getState(), f.built.base, f.config.registry);
  for (const command of [row.command, note('Normalize historical alias'), note('Reuse canonical baseline')]) {
    reference = applyResidentCommand(reference, command, f.config);
    await f.store.commandSerialized(command, f.store.getInfo().revision);
    assert.equal(JSON.stringify(f.store.getState()), JSON.stringify(materializeResidentState(reference)));
    assert.deepEqual(await diskState(f), f.store.getState());
  }
});
