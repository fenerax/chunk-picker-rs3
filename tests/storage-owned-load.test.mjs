import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { openStore } from '../app/storage/store.mjs';
import { applyCommand, createGroupState, exportBackup, importBackup, BACKUP_FORMAT, SCHEMA_VERSION } from '../app/core/state.mjs';
import { createHash } from 'node:crypto';
import { buildWorld } from '../app/data/world.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';
import { migrateGameplay, hasGameplayMigration, hasCurrentProgressAliasMigration, hasCurrentJournalMigration } from '../app/tasks/migration.mjs';
import { startupSchemaFixtures, startupCatalogue, startupDefinitions, startupTaskMap } from '../scripts/perf/storage-fixtures.mjs';

async function directory(t) {
  const root = path.resolve('.local', 'storage-owned-load-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
const original = () => exportBackup(createGroupState([{ id: 'actor1', name: 'Player' }]));

test('private-file owned validation preserves public import errors and rejects without replacing evidence', async t => {
  const unsafe = original();
  unsafe.state.members[0].taskStatus = JSON.parse('{"__proto__":{"note":"unsafe"}}');
  const unknownReference = original();
  unknownReference.state.members[0].completedTasks = ['unknown task'];
  const invalidRevision = original();
  invalidRevision.state.revision = -1;
  const nonfinite = JSON.stringify(original()).replace('"revision":0', '"revision":1e999');
  const documents = ['{broken', 'null', '[]', JSON.stringify({ ...original(), format: 'wrong' }),
    JSON.stringify({ ...original(), schemaVersion: 99 }), JSON.stringify({ ...original(), state: null }),
    JSON.stringify(unsafe), JSON.stringify(unknownReference), JSON.stringify(invalidRevision), nonfinite];
  for (const bytes of documents) {
    let expected;
    assert.throws(() => importBackup(bytes), error => { expected = error.message; return true; });
    const dataDir = await directory(t);
    await writeFile(path.join(dataDir, 'state.json'), bytes);
    await assert.rejects(() => openStore({ dataDir }), error => error.cause?.message === expected);
    assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
    assert.deepEqual(await readdir(path.join(dataDir, 'backups')), []);
    assert(!(await readdir(dataDir)).includes('store.lock'));
  }
});

test('load preparation that only reorders object keys preserves the revision, bytes and backups', async t => {
  const dataDir = await directory(t);
  const state = applyCommand(createGroupState([{ id: 'actor1', name: 'Player' }]),
    { type: 'set-rule', ruleId: 'access.shared', value: false }, { now: '2026-10-07T12:00:00.000Z' });
  const bytes = `${JSON.stringify(exportBackup(state), null, 2)}\n`;
  await writeFile(path.join(dataDir, 'state.json'), bytes);
  let retainedInput;
  const store = await openStore({ dataDir, prepareState(input) {
    retainedInput = input;
    return Object.fromEntries(Object.entries(input).reverse());
  } });
  t.after(() => store.close());
  retainedInput.members[0].name = 'Hook retains a detached input';
  assert.deepEqual(store.getState(), state);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), bytes);
  assert.deepEqual(await store.listBackups(), []);
  await store.close();
  const reopened = await openStore({ dataDir });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getState(), state);
});

// Startup proof paths must preserve full private state, portable History, both
// owners' projections, and the existing fail-closed dependency guarantees.
const digest = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const startupWorld = buildWorld({ chunks: { '12341': {}, '12342': {}, '12343': {} }, walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'] });
const fullSnapshot = store => {
  const value = store.getStateSnapshot({ view: 'play-v1' });
  return { state: JSON.parse(value.stateJSON), pools: value.pools, format: value.format, revision: value.revision };
};
function ownerRows(state) {
  const registry = createRuleRegistry();
  const rows = startupCatalogue;
  return state.members.flatMap(member => [false, true].map(group => ({ memberId: member.id, group,
    lists: selectDuoTaskLists({ state, registry, selectedMemberId: member.id, results: (group ? state.members : [member]).map(owner => ({ memberId: owner.id, stateRevision: state.revision, tasks: rows })) }) })));
}

test('proven current load preserves archived state, both owners and group/personal rows without rewriting files', async t => {
  const dataDir = await directory(t);
  const state = startupSchemaFixtures(createGroupState, migrateGameplay).find(fixture => fixture.name === 'current-v2').state;
  // Exercise static sidecars as well as archived events.
  state.legacy.evidence = 'Synthetic retained evidence. '.repeat(12000);
  const first = await openStore({ dataDir, initialState: state, world: startupWorld, retention: { historyEntries: 2 } });
  for (let i = 0; i < 6; i++) await first.command({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(i % 2) }, i);
  const saved = first.getState(), portable = await first.backup(), play = fullSnapshot(first), rows = ownerRows(saved);
  assert(saved.provenance.historyArchive.length > 0);
  assert.equal(Object.keys(play.pools).length, 2);
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  const backups = await first.listBackups();
  await first.close();
  const migrateState = () => { throw new Error('proven current migration ran'); };
  migrateState.isCurrent = () => true;
  const prepareState = () => { throw new Error('proven current preparation ran'); };
  prepareState.isCurrent = () => true;
  const reopened = await openStore({ dataDir, world: startupWorld, migrateState, prepareState });
  t.after(() => reopened.close());
  assert.equal(digest(reopened.getState()), digest(saved));
  assert.equal(digest(await reopened.backup()), digest(portable));
  assert.deepEqual(fullSnapshot(reopened), play);
  assert.deepEqual(ownerRows(reopened.getState()), rows);
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), bytes);
  assert.deepEqual(await reopened.listBackups(), backups);
});

for (const corruption of ['missing', 'malformed', 'invalid-event']) test(`proven current load still rejects ${corruption} committed history before ready`, async t => {
  const dataDir = await directory(t);
  const first = await openStore({ dataDir, initialState: createGroupState([{ id: 'synthetic-a', name: 'Synthetic A' }]), retention: { historyEntries: 1 } });
  for (let i = 0; i < 3; i++) await first.command({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(i % 2) }, i);
  const reference = first.getState().provenance.historyArchive[0];
  await first.close();
  const file = path.join(dataDir, 'history', reference.id);
  if (corruption === 'missing') await unlink(file);
  else {
    const { gzipSync } = await import('node:zlib');
    await writeFile(file, corruption === 'malformed' ? 'broken' : gzipSync(JSON.stringify({ format: 'rs3-chunk-picker-history', events: [{ id: 'bad', revision: -1, type: 'catalogue-refresh', at: 'bad' }] })));
  }
  const bytes = await readFile(path.join(dataDir, 'state.json'));
  const migrateState = () => { throw new Error('proven current migration ran'); };
  migrateState.isCurrent = () => true;
  await assert.rejects(() => openStore({ dataDir, migrateState }));
  assert.deepEqual(await readFile(path.join(dataDir, 'state.json')), bytes);
  assert(!(await readdir(dataDir)).includes('store.lock'));
});

test('a caller preparation without a proof still receives complete archived history', async t => {
  const dataDir = await directory(t);
  const first = await openStore({ dataDir, initialState: createGroupState([{ id: 'synthetic-a', name: 'Synthetic A' }]), retention: { historyEntries: 1 } });
  for (let i = 0; i < 3; i++) await first.command({ type: 'set-rule', ruleId: 'access.shared', value: Boolean(i % 2) }, i);
  await first.close();
  let calls = 0;
  const migrateState = state => state;
  migrateState.isCurrent = () => true;
  const reopened = await openStore({ dataDir, migrateState, prepareState(state, context) {
    calls++;
    assert.equal(context.operation, 'load');
    assert.deepEqual(state.history.map(event => event.revision), [1, 2, 3]);
    state.members[0].journal = 'Caller repair';
    return state;
  } });
  t.after(() => reopened.close());
  assert.equal(calls, 1);
  assert.equal(reopened.getState().revision, 4);
  assert.equal(reopened.getState().members[0].journal, 'Caller repair');
  assert.equal((await reopened.backup()).state.history.length, 4);
});

for (const { name, state } of startupSchemaFixtures(createGroupState, migrateGameplay)) test(`startup loads and restarts ${name} with identical private, backup and play hashes`, async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, state }));
  const migrateState = input => migrateGameplay(input, { definitions: startupDefinitions, taskMap: startupTaskMap, catalogue: startupCatalogue }).state;
  migrateState.isCurrent = state => state.legacy?.gameplayMigration?.schemaVersion >= 2
    && hasCurrentProgressAliasMigration(state) && hasCurrentJournalMigration(state)
    && state.members.every(member => hasGameplayMigration(state, member));
  const first = await openStore({ dataDir, world: startupWorld, migrateState, now: '2026-10-26T00:00:00.000Z' });
  const expected = { state: digest(first.getState()), backup: digest(await first.backup()), play: digest(fullSnapshot(first)), rows: ownerRows(first.getState()) };
  await first.close();
  const reopened = await openStore({ dataDir, world: startupWorld, migrateState, now: '2026-10-26T00:00:00.000Z' });
  t.after(() => reopened.close());
  assert.deepEqual({ state: digest(reopened.getState()), backup: digest(await reopened.backup()), play: digest(fullSnapshot(reopened)), rows: ownerRows(reopened.getState()) }, expected);
});
