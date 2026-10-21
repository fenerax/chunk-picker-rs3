import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroupState, exportBackup, importBackup } from '../app/core/state.mjs';
import { buildIdentityIndex, legacyTaskId, resolveIdentity, lookupPermanentId } from '../app/tasks/identity.mjs';
import { migrateGameplay, migrateTaskIdentities, projectMemberTaskFacts, hasCurrentProgressAliasMigration, hasGameplayMigration } from '../app/tasks/migration.mjs';

// Exact reviewed subjects/decoder spellings, independently pinned from the
// parity report and retained QXB decoder evidence. No private save fixture.
const aliases = [
  ['rs3:task:003532', 'Extra', '~|Exploration achievements#Lodestones|~ Lumbridge', 't_12129'],
  ['rs3:task:003536', 'Extra', '~|Exploration achievements#Lodestones|~ Varrock', 't_12133'],
  ['rs3:task:003538', 'Extra', '~|Exploration achievements#Lodestones|~ Falador', 't_12135'],
  ['rs3:task:003539', 'Extra', '~|Exploration achievements#Lodestones|~ Port Sarim', 't_12136'],
  ['rs3:task:00353a', 'Extra', '~|Exploration achievements#Lodestones|~ Draynor Village', 't_12137'],
  ['rs3:task:00353d', 'Extra', '~|Exploration achievements#Lodestones|~ City of Um', 't_12140'],
  ['rs3:task:001093', 'Fletching', 'Fletch a ~|runite crossbow (u)|~', 't_test_crossbow'],
  ['rs3:task:000bfc', 'Constitution', 'Create a ~|portent of restoration I|~', 't_test_portent'],
];
const decisions = [
  ['Farming', '~|Perils of Ice Mountain|~ 1', 't_9179', 'completedChallenges', true],
  ['Hunter', '~|Perils of Ice Mountain|~ 1', 't_9179', 'completedChallenges', true],
  ['Construction', '~|Perils of Ice Mountain|~ 1', 't_9179', 'backlog', ''],
  ['Smithing', '~|Beneath Cursed Tides|~ 1', 't_7204', 'completedChallenges', true],
  ['Strength', '~|Beneath Cursed Tides|~ 1', 't_7204', 'completedChallenges', true],
];
const taskMap = Object.fromEntries([...aliases.map(([, , raw, code]) => [raw, code]), ...decisions.map(([, raw, code]) => [raw, code])]);
const catalogue = [...aliases.map(([id]) => lookupPermanentId(id)), lookupPermanentId('rs3:task:00275c'), lookupPermanentId('rs3:task:001f4d')];
function saved() {
  const state = createGroupState([{ id: 'synthetic', name: 'Synthetic owner', sourceMapId: 'synthetic-map' }]);
  const chunkinfo = { completedChallenges: {}, backlog: {} };
  for (const [, category, , code] of aliases) {
    chunkinfo.completedChallenges[category] ??= {};
    chunkinfo.completedChallenges[category][code] = true;
  }
  for (const [category, , code, source, value] of decisions) {
    chunkinfo[source][category] ??= {};
    chunkinfo[source][category][code] = value;
  }
  state.legacy = { maps: { 'synthetic-map': { chunkinfo } } };
  return state;
}

test('eight exact progress aliases resolve with their old category and reject unrelated categories', () => {
  const index = buildIdentityIndex(catalogue, { taskMap });
  for (const [id, category, raw, code] of aliases) {
    assert.equal(resolveIdentity(legacyTaskId(category, raw), undefined, category).id, id);
    assert.equal(index.resolve(code, { category }).id, id);
    assert.equal(index.resolve(code, { category: 'Mining' }).status, 'unresolved');
    assert.ok(index.lookup(id).aliases.includes(legacyTaskId(category, raw)));
  }
  for (const [category, raw, code] of decisions) {
    assert.equal(index.resolve(code, { category }).status, 'unresolved');
    assert.equal(resolveIdentity(legacyTaskId(category, raw)).status, 'unresolved');
  }
});

test('fresh original challenge checks project eight canonical tasks while five quest clones remain quarantined', () => {
  const before = saved(), original = structuredClone(before);
  const result = migrateGameplay(before, { catalogue, taskMap });
  assert.deepEqual(before, original);
  assert.deepEqual(result.state.legacy.maps, original.legacy.maps);
  for (const [id] of aliases) {
    assert.equal(result.state.members[0].taskStatus[id].challengeCompleted, true);
    assert.equal(result.state.tasks.find(row => row.id === id).category, lookupPermanentId(id).category);
  }
  assert.equal(result.report.unresolved.length, decisions.length);
  assert.deepEqual(result.state.members[0].completedTasks, []);
  assert.deepEqual(result.state.members[0].questProgress, original.members[0].questProgress);
  assert.deepEqual(result.state.members[0].skillProgress, original.members[0].skillProgress);
  assert.deepEqual(result.state.members[0].teleports, original.members[0].teleports);
  assert.equal(result.state.members[0].taskStatus['rs3:task:00275c'], undefined);
  assert.equal(result.state.members[0].taskStatus['rs3:task:001f4d'], undefined);
  assert.deepEqual(importBackup(exportBackup(result.state)), result.state);
  assert.deepEqual(migrateGameplay(result.state, { catalogue, taskMap }).state, result.state);
});

test('existing canonical saves retry only unresolved reviewed rows, preserve overrides, and do not revive cleared progress', () => {
  const before = saved(), member = before.members[0];
  before.tasks = catalogue.map(({ id, label, category }) => ({ id, label, category }));
  member.taskStatus = { 'rs3:task:003532': { challengeCompleted: false, note: 'Explicit override' } };
  before.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: member.id, sourceMapId: member.sourceMapId }],
    unresolved: [...aliases.map(([, category, raw, code]) => ({ memberId: member.id, sourceMapId: member.sourceMapId,
      source: 'completedChallenges', category, legacyKey: code, decodedKey: code, reason: 'legacy task ID has no exact label in its category catalogue', candidates: [raw] })),
    ...decisions.map(([category, raw, code, source]) => ({ memberId: member.id, sourceMapId: member.sourceMapId,
      source, category, legacyKey: code, decodedKey: code, reason: 'legacy task ID has no exact label in its category catalogue', candidates: [raw] }))] };
  const stale = before.legacy.gameplayMigration.unresolved[0];
  before.legacy.gameplayMigration.warnings = [`Could not migrate ${stale.source} ${stale.category}/${stale.legacyKey} for member ${member.id}: ${stale.reason}.`];
  const snapshot = structuredClone(before);
  assert.equal(hasCurrentProgressAliasMigration(before), false);
  assert.equal(hasGameplayMigration(before, member), true, 'Alias upgrades must keep legacy field fallback disabled');
  const result = migrateGameplay(before, { catalogue, taskMap });
  assert.equal(hasCurrentProgressAliasMigration(result.state), true);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(result.state.legacy.maps, snapshot.legacy.maps);
  assert.equal(result.report.unresolved.length, decisions.length);
  assert.equal(result.state.members[0].taskStatus['rs3:task:003532'].challengeCompleted, false);
  for (const [id] of aliases.slice(1)) assert.equal(result.state.members[0].taskStatus[id].challengeCompleted, true);
  assert.ok(!result.warnings.some(warning => warning.includes('Extra/t_12129')));
  assert.deepEqual(migrateGameplay(result.state, { catalogue, taskMap }).state, result.state);
  delete result.state.members[0].taskStatus['rs3:task:003536'];
  const cleared = migrateGameplay(result.state, { catalogue, taskMap }).state;
  assert.equal(cleared.members[0].taskStatus['rs3:task:003536'], undefined);
});

test('saved historical runite rename preserves evidence, canonical false, read-only projection and portable restore', () => {
  const id = 'rs3:task:001093', old = legacyTaskId('Fletching', aliases[6][2]);
  const before = createGroupState([{ id: 'synthetic', name: 'Synthetic owner' }]);
  before.tasks = [{ id: old, label: 'Fletch a runite crossbow (u)', category: 'Fletching' }];
  before.members[0].taskStatus = { [old]: { challengeCompleted: true, note: 'Retain decoder evidence' }, [id]: { challengeCompleted: false } };
  const original = structuredClone(before);
  assert.equal(projectMemberTaskFacts(before, before.members[0], catalogue).taskStatus[id].challengeCompleted, false);
  assert.deepEqual(before, original);
  const result = migrateTaskIdentities(before, { catalogue });
  assert.equal(result.state.members[0].taskStatus[id].challengeCompleted, false);
  assert.equal(result.state.members[0].taskStatus[id].note, 'Retain decoder evidence');
  assert.ok(result.report.conflicts.some(row => row.reason === 'conflicting alias status fields'));
  assert.equal(result.report.lostRecords, 0);
  assert.deepEqual(result.state.provenance.taskIdentityMigration.archives[0].members, original.members);
  assert.deepEqual(importBackup(exportBackup(result.state)), result.state);
});

test('same-category competing decoder evidence stays ambiguous and preserves the original check', () => {
  const [id, category, raw, code] = aliases[0], other = aliases[1][2];
  const history = { conflicts: [{ label: other, ids: [code] }] };
  const index = buildIdentityIndex(catalogue, { taskMap, history });
  assert.equal(index.resolve(code, { category }).status, 'ambiguous');
  const before = saved();
  const result = migrateGameplay(before, { catalogue, taskMap, taskMapHistory: history });
  assert.ok(result.report.unresolved.some(row => row.category === category && row.legacyKey === code && row.reason === 'ambiguous legacy task ID'));
  assert.equal(result.state.members[0].taskStatus[id], undefined);
  assert.equal(result.state.legacy.maps['synthetic-map'].chunkinfo.completedChallenges[category][code], true);
  const competing = 'rs3:task:test-progress-competitor';
  const exact = legacyTaskId(category, raw);
  const savedState = createGroupState([{ id: 'synthetic', name: 'Synthetic owner' }]);
  savedState.tasks = [{ id: exact, label: raw, category }];
  savedState.members[0].taskStatus = { [exact]: { challengeCompleted: true } };
  const migrated = migrateTaskIdentities(savedState, { catalogue: [...catalogue, { id: competing, label: 'Competing objective', category,
    rawLabel: 'Competing objective', aliases: [exact] }] });
  assert.deepEqual(migrated.state.members[0].taskStatus[exact], { challengeCompleted: true });
  assert.ok(migrated.report.unresolved.some(row => row.originalId === exact && row.reason === 'ambiguous'));
  assert.deepEqual(importBackup(exportBackup(migrated.state)).members[0].taskStatus[exact], { challengeCompleted: true });
});

test('fresh and previously quarantined checks both respect catalogue and persisted alias competitors', () => {
  const [id, category, raw, code] = aliases[0], old = legacyTaskId(category, raw);
  const competing = { id: 'rs3:task:test-review-competitor', category, kind: 'task', label: 'Competing objective',
    rawLabel: 'Competing objective', aliases: [old, raw] };
  for (const migrated of [false, true]) for (const persisted of [false, true]) {
    const before = saved(), member = before.members[0];
    if (persisted) before.identityRegistry = { schemaVersion: 1, entries: { [competing.id]: competing },
      aliases: { [old]: competing.id, [raw]: competing.id, [code]: competing.id }, unresolved: [] };
    if (migrated) before.legacy.gameplayMigration = { schemaVersion: 2,
      migratedMembers: [{ memberId: member.id, sourceMapId: member.sourceMapId }], unresolved: [{
        memberId: member.id, sourceMapId: member.sourceMapId, source: 'completedChallenges', category,
        legacyKey: code, decodedKey: code, reason: 'legacy task ID has no exact label in its category catalogue', candidates: [raw],
      }] };
    const suppliedCatalogue = persisted ? catalogue : [...catalogue, competing];
    const result = migrateGameplay(before, { catalogue: suppliedCatalogue, taskMap });
    assert.equal(result.state.members[0].taskStatus?.[id], undefined, `migrated=${migrated}, persisted=${persisted}`);
    assert.ok(result.report.unresolved.some(row => row.category === category && row.legacyKey === code));
    assert.equal(result.state.legacy.maps['synthetic-map'].chunkinfo.completedChallenges[category][code], true);
    assert.equal(hasCurrentProgressAliasMigration(result.state), true, 'A reviewed ambiguous check must not cause repeated upgrades');
    const restored = importBackup(exportBackup(result.state));
    assert.equal(restored.members[0].taskStatus?.[id], undefined);
    assert.deepEqual(migrateGameplay(restored, { catalogue: suppliedCatalogue, taskMap }).state, restored);
  }
});

test('server startup upgrades a canonical save once and reopens without resurrecting a cleared lodestone check', async t => {
  const tempRoot = path.resolve('.local', 'test-tmp');
  await mkdir(tempRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(tempRoot, 'progress-alias-startup-'));
  const previousEnv = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TEMP = tempRoot; process.env.TMP = tempRoot;
  t.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const { createServer } = await import('../app/server.mjs');
  const before = migrateGameplay(saved(), { catalogue, taskMap }).state;
  delete before.legacy.gameplayMigration.progressAliasesVersion;
  for (const [id, category, raw, code] of aliases.slice(0, 6)) {
    delete before.members[0].taskStatus[id];
    before.legacy.gameplayMigration.unresolved.push({ memberId: before.members[0].id, sourceMapId: before.members[0].sourceMapId,
      source: 'completedChallenges', category, legacyKey: code, decodedKey: code,
      reason: 'legacy task ID has no exact label in its category catalogue', candidates: [raw] });
  }
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify(exportBackup(before)));
  const definitions = { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'],
    challenges: { Diary: Object.fromEntries(catalogue.filter(row => row.category === 'Diary').map(row => [row.rawLabel, {
      PickerId: row.id, Chunks: ['12341'],
    }])) } };
  let app;
  t.after(() => app?.close());
  const start = expectedReuse => createServer({ definitions, taskMap, dataDir, host: '127.0.0.1', port: 0,
    gameDataDir: path.join(dataDir, 'game-data'), mapAssetsDir: path.join(dataDir, 'map-assets'),
    now: '2026-10-08T12:00:00.000Z', prepareState(state, context) {
      assert.equal(context.migration.reused, expectedReuse);
      return state;
    } });
  app = await start(false);
  await app.listen();
  assert.equal(app.store.getState().revision, before.revision + 1);
  assert.equal(app.store.getState().legacy.gameplayMigration.progressAliasesVersion, 1);
  for (const [id] of aliases.slice(0, 6)) assert.equal(app.store.getState().members[0].taskStatus[id].challengeCompleted, true);
  const upgraded = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  await app.close();
  app = await start(true);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), upgraded);
  await app.store.command({ type: 'set-task-status', memberId: 'synthetic', taskId: aliases[0][0], challengeCompleted: false }, app.store.getState().revision);
  const cleared = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  await app.close();
  app = await start(true);
  assert.equal(app.store.getState().members[0].taskStatus[aliases[0][0]].challengeCompleted, false);
  assert.equal(await readFile(path.join(dataDir, 'state.json'), 'utf8'), cleared);
});
