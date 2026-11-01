import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import referenceCorrections from '../app/data/reference-corrections.2026-10-31.v1.mjs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGroupState, validateState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { taskRuleDefault } from '../app/tasks/rule-defaults.mjs';
import { taskRuleDefinitions, taskRuleBehavior } from '../app/data/settings.mjs';
import { buildRulesSections, rulesCatalogue } from '../app/web/rules-model.mjs';

const items = ['Starved ancient effigy', 'Mimic kill token', 'Spirit sapphire', 'Spirit emerald', 'Spirit ruby'];
const definitions = () => ({ chunks: { '1': { Monster: { 'Fixture monster': true } } },
  drops: { 'Fixture monster': Object.fromEntries(items.map(item => [item, { 1: 'Always' }])) },
  taskUnlocks: { Items: Object.fromEntries(items.map(item => [item + '^', [{ 'Universal tertiary': 'Nonskill' }]])) },
  challenges: { Nonskill: { 'Universal tertiary': { Category: ['Universal Tertiary'] } },
    Extra: Object.fromEntries(items.map(item => ['Use ' + item, { Items: [item] }])) } });
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
const state = rules => ({ rules: { 'content.f2p': false }, members: [{ id: 'a', unlocked: ['1'], completedTasks: [], taskRules: rules }] });

for (const [tertiary, effigies] of [[false, false], [true, false], [true, true], [false, true]]) {
  test(`source split: Universal Tertiary=${tertiary}, Ancient Effigies=${effigies}`, () => {
    const data = definitions(), saved = state({ 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies, 'Every Drop': true, 'All Droptables': true });
    const before = structuredClone({ data, saved });
    const result = createTaskEngine(data, options).evaluate(saved, 'a');
    const collection = createCollectionEngine(data).evaluate(saved, 'a', result);
    for (const item of items) {
      const allowed = item === items[0] ? effigies : tertiary;
      assert.equal(result.items.some(row => row.name === item), allowed, item);
      assert.equal(collection.tasks.some(row => row.item === item), allowed, 'collection source for ' + item);
      assert.equal(result.tasks.find(row => row.rawLabel === 'Use ' + item).status, allowed ? 'available' : 'blocked', item);
      if (allowed) assert.equal(result.items.find(row => row.name === item).sources[0].source, 'Fixture monster');
    }
    assert.deepEqual({ data, saved }, before);
  });
}

test('other effigy requirements and non-tertiary sources remain independent', () => {
  const data = definitions();
  data.taskUnlocks.Items[items[0] + '^'] = [{ 'Universal tertiary': 'Nonskill', 'Other prerequisite': 'Extra' }];
  let result = createTaskEngine(data, options).evaluate(state({ 'Ancient Effigies': true }), 'a');
  assert.equal(result.items.some(row => row.name === items[0]), false);
  delete data.taskUnlocks.Items[items[0] + '^'];
  result = createTaskEngine(structuredClone(data), options).evaluate(state({ 'Ancient Effigies': false, 'Universal Tertiary': false }), 'a');
  assert.equal(result.items.some(row => row.name === items[0]), true);
});

const fresh = () => createGroupState([{ id: 'a', name: 'Fixture player' }]);
const old = () => { const saved = fresh(); delete saved.provenance; return saved; };
for (const value of [true, false]) test(`old save copies Universal Tertiary=${value} once`, () => {
  const saved = old(); saved.members[0].taskRules = { 'Universal Tertiary': value };
  const migrated = validateState(saved);
  assert.equal(migrated.members[0].taskRules['Ancient Effigies'], value);
  assert.equal(saved.members[0].taskRules['Ancient Effigies'], undefined);
  assert.deepEqual(validateState(migrated), migrated);
  assert.deepEqual(importBackup(exportBackup(migrated)), migrated);
  const reset = applyCommand(migrated, { type: 'reset-task-rule', memberId: 'a', ruleId: 'Ancient Effigies' });
  assert.equal(validateState(reset).members[0].taskRules['Ancient Effigies'], undefined);
  const changed = applyCommand(reset, { type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: !value });
  assert.equal(validateState(changed).members[0].taskRules['Ancient Effigies'], undefined);
});

test('fresh defaults are off, older unset saves preserve automatic on, explicit new values win', () => {
  assert.equal(fresh().members[0].taskRules?.['Ancient Effigies'], undefined);
  assert.equal(taskRuleDefault('Ancient Effigies'), false);
  assert.equal(validateState(old()).members[0].taskRules['Ancient Effigies'], true);
  const saved = old(); saved.members[0].taskRules = { 'Universal Tertiary': true, 'Ancient Effigies': false };
  assert.equal(validateState(saved).members[0].taskRules['Ancient Effigies'], false);
});

test('legacy rules are decoded, and completed gameplay migration does not revive old values', () => {
  const saved = old(); saved.members[0].sourceMapId = 'fixture-map';
  saved.legacy = { maps: { 'fixture-map': { rules: { 'Universal%20Tertiary': false } } } };
  assert.equal(validateState(saved).members[0].taskRules['Ancient Effigies'], false);
  saved.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'fixture-map' }] };
  assert.equal(validateState(saved).members[0].taskRules['Ancient Effigies'], true);
  saved.members[0].taskRules = { 'Universal Tertiary': false };
  assert.equal(validateState(saved).members[0].taskRules['Ancient Effigies'], false);
});

test('both independent switches appear in Item Sources with current descriptions', () => {
  const sections = buildRulesSections(rulesCatalogue, fresh());
  const group = sections.find(section => section.rules.some(rule => rule.id === 'Universal Tertiary'));
  const effigies = group.rules.find(rule => rule.id === 'Ancient Effigies');
  assert.ok(effigies); assert.equal(effigies.parent, null); assert.equal(effigies.default, false);
  assert.equal(effigies.description, 'Allow ancient effigies from universal tertiary drops to count towards chunk tasks');
  assert.equal(taskRuleDefinitions.find(rule => rule.id === 'Ancient Effigies').category, 'Item Sources');
  assert.doesNotMatch(group.rules.find(rule => rule.id === 'Universal Tertiary').description, /effig/i);
  assert.equal(taskRuleBehavior('Ancient Effigies').status, 'implemented-scope');
});

test('Automatic survives provenance archived by one or more restores', () => {
  const saved = old(); saved.members[0].taskRules = { 'Universal Tertiary': true };
  let restored = applyCommand(validateState(saved), { type: 'reset-task-rule', memberId: 'a', ruleId: 'Ancient Effigies' });
  for (let i = 0; i < 2; i++) {
    restored.provenance = { restore: { incomingProvenance: restored.provenance } };
    restored = validateState(restored);
    assert.equal(restored.members[0].taskRules['Ancient Effigies'], undefined);
  }
});

test('undoing an older full-member snapshot keeps the migrated effigy choice', () => {
  const saved = old(); saved.members[0].taskRules = { 'Universal Tertiary': true };
  const snapshot = structuredClone(saved.members[0]);
  saved.revision = 1;
  saved.members[0].notes = { '1': 'Fixture note' };
  saved.history = [{ id: 'revision-1', revision: 1, type: 'set-note', at: '2026-10-31T00:00:00.000Z', undo: { members: [snapshot] } }];
  const migrated = validateState(saved);
  const undone = applyCommand(migrated, { type: 'undo' });
  assert.equal(undone.members[0].notes, undefined);
  assert.equal(undone.members[0].taskRules['Ancient Effigies'], true);
  assert.equal(saved.history[0].undo.members[0].taskRules['Ancient Effigies'], undefined);
});

const roundTrips = state => {
  assert.deepEqual(validateState(state), state);
  assert.deepEqual(importBackup(exportBackup(state)), state);
};

test('older sparse undo that created taskRules still validates, undoes and exports after migration', () => {
  let saved = applyCommand(fresh(), { type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: false });
  assert.deepEqual(saved.history.at(-1).undo.memberChanges[0].changes.map(patch => patch.kind), ['object', 'value']);
  delete saved.provenance;
  const migrated = validateState(saved);
  assert.equal(migrated.members[0].taskRules['Ancient Effigies'], false);
  roundTrips(migrated);
  const undone = applyCommand(migrated, { type: 'undo' });
  assert.deepEqual(undone.members[0].taskRules, { 'Ancient Effigies': false });
  roundTrips(undone);
  assert.equal(saved.history.at(-1).undo.memberChanges[0].changes.length, 2, 'the caller keeps its own history');
});

test('an older event that only created an empty taskRules no longer has an undo after migration', () => {
  let saved = applyCommand(fresh(), { type: 'set-profile', memberId: 'a', rules: fresh().rules, taskRules: {} });
  saved = applyCommand(saved, { type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: true });
  delete saved.provenance;
  const migrated = validateState(saved);
  assert.equal(migrated.history[0].undo, undefined);
  assert.ok(migrated.history[1].undo.memberChanges);
  roundTrips(migrated);
  const undone = applyCommand(migrated, { type: 'undo' });
  assert.deepEqual(undone.members[0].taskRules, { 'Ancient Effigies': true });
  roundTrips(undone);
});

test('a calculation snapshot of a fresh save keeps Ancient Effigies on Automatic', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-effigies-'));
  const store = await openStore({ dataDir, initialState: fresh(), retention: false,
    world: { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() } });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const snapshot = store.getCalculationSnapshot();
  assert.equal(validateState(snapshot.state).members[0].taskRules?.['Ancient Effigies'], undefined);
  assert.equal(validateState(JSON.parse(Buffer.from(snapshot.stateJSON).toString())).members[0].taskRules?.['Ancient Effigies'], undefined);
  assert.deepEqual(Object.keys(snapshot.state.provenance), ['ancientEffigiesMigratedMembers']);
});

for (const [tertiary, effigies] of [[false, false], [true, false], [true, true], [false, true]]) {
  test(`task source split: Universal Tertiary=${tertiary}, Ancient Effigies=${effigies}`, () => {
    const data = definitions(); delete data.chunks['1'].Monster;
    data.challenges.Extra['Fixture supplier'] = { Output: items[0] };
    delete data.taskUnlocks.Items[items[0] + '^'];
    data.taskUnlocks.Items[items[0] + '^Fixture supplier'] = [{ 'Universal tertiary': 'Nonskill' }];
    const result = createTaskEngine(data, options).evaluate(state({ 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies }), 'a');
    assert.equal(result.items.some(row => row.name === items[0]), effigies);
  });
}

for (const [tertiary, effigies] of [[false, false], [true, false], [true, true], [false, true]]) {
  test(`Slayer drops and exempt activity rewards: tertiary=${tertiary}, effigies=${effigies}`, () => {
    const data = definitions(); delete data.chunks['1'].Monster;
    data.challenges.Slayer = { 'Fixture monster task': { Source: 'drop', Output: 'Fixture monster loot' } };
    data.skillItems = { Slayer: { 'Fixture monster loot': { [items[0]]: { 1: '1/1000' }, 'Fixture ordinary drop': { 1: 'Always' } } } };
    let result = createTaskEngine(data, options).evaluate(state({ 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies }), 'a');
    assert.equal(result.items.some(row => row.name === items[0]), effigies);
    assert.equal(result.items.some(row => row.name === 'Fixture ordinary drop'), true);
    data.challenges.Nonskill['Memory of Nomad rewards'] = { Output: 'Fixture reward chest' };
    data.skillItems.Nonskill = { 'Fixture reward chest': { [items[0]]: { 1: 'Rare' } } };
    result = createTaskEngine(structuredClone(data), options).evaluate(state({ 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies }), 'a');
    const sources = result.items.find(row => row.name === items[0]).sources;
    assert.equal(sources.some(source => source.name === 'Memory of Nomad rewards'), true);
    assert.equal(sources.some(source => source.name === 'Fixture monster task'), effigies);
  });
}

test('four low-combat effigy corrections remove only their invalid output, regardless of rules', () => {
  const patches = referenceCorrections.patches.filter(patch => patch.path[0] === 'skillItems'
    && patch.path[1] === 'Slayer' && patch.path[3] === items[0]);
  assert.equal(patches.length, 4);
  assert.ok(referenceCorrections.provenance.ancientEffigies.sources.some(source => source.url.endsWith('oldid=37088939')));
  const data = definitions(); delete data.chunks['1'].Monster;
  data.challenges.Slayer = {};
  data.skillItems = { Slayer: {} };
  for (const patch of patches) {
    const name = patch.path[2];
    data.challenges.Slayer['Fixture task ' + name] = { Source: 'drop', Output: name };
    data.skillItems.Slayer[name] = { [items[0]]: patch.before, 'Fixture ordinary drop': { 1: 'Always' } };
  }
  const before = structuredClone(data), corrected = applyDefinitionOverlays(data, [{ ...referenceCorrections, patches }]);
  assert.deepEqual(data, before);
  assert.equal(applyDefinitionOverlays(corrected, [{ ...referenceCorrections, patches }]), corrected);
  for (const tertiary of [false, true]) for (const effigies of [false, true]) {
    const result = createTaskEngine(corrected, options).evaluate(state({ 'Universal Tertiary': tertiary, 'Ancient Effigies': effigies }), 'a');
    assert.equal(result.items.some(row => row.name === items[0]), false);
    assert.equal(result.items.some(row => row.name === 'Fixture ordinary drop'), true);
  }
});

test('archived pre-migration undo history is repaired when the store hydrates it', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-effigies-archive-'));
  const world = { chunks: new Map([['100', { id: '100', name: 'Fixture chunk' }]]), neighbors: new Map(), walkable: new Set(['100']), f2p: new Set(['100']) };
  const open = () => openStore({ dataDir, initialState: fresh(), world, retention: { backupDays: 90, historyEntries: 2 } });
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let store = await open();
  // Revision 1 creates the member's taskRules dictionary (a sparse container patch).
  await store.command({ type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: false }, 0);
  for (let revision = 1; revision < 7; revision++) await store.command({ type: 'set-note', memberId: 'a', chunkId: '100', note: 'Fixture note ' + revision }, revision);
  assert.ok(store.getInfo().retention.historyArchives > 0, 'the taskRules event is archived');
  await store.close();
  // Make it a save from before the Ancient Effigies switch existed.
  const file = path.join(dataDir, 'state.json'), saved = JSON.parse(await readFile(file, 'utf8'));
  const body = saved.state ?? saved;
  assert.equal(saved.storage, undefined, 'the fixture save keeps provenance inline');
  delete body.provenance.ancientEffigiesMigratedMembers;
  delete body.provenance.ancientEffigiesMigration;
  for (const member of body.members) delete member.taskRules['Ancient Effigies'];
  await writeFile(file, JSON.stringify(saved));
  store = await open();
  t.after(() => store.close());
  assert.equal(store.getState().members[0].taskRules['Ancient Effigies'], false);
  // Hydrating every archived event (backup/export/undo) must not fail validation.
  const backup = await store.backup();
  assert.equal(backup.state.members[0].taskRules['Ancient Effigies'], false);
  // Undo back through the archived events, including the one that created taskRules.
  let revision = store.getInfo().revision;
  for (let i = 0; i < 7; i++) {
    const target = (await store.backup()).state.history.filter(event => event.undo && event.undoneRevision === undefined && event.type !== 'undo').at(-1);
    if (!target) break;
    await store.command({ type: 'undo', undoRevision: target.revision }, revision);
    revision = store.getInfo().revision;
  }
  assert.deepEqual(store.getState().members[0].taskRules, { 'Ancient Effigies': false });
});

test('an archived full-member snapshot keeps the migrated choice when it is undone', () => {
  const saved = old(); saved.members[0].taskRules = { 'Universal Tertiary': true };
  const snapshot = structuredClone(saved.members[0]);
  saved.revision = 1; saved.members[0].notes = { '1': 'Fixture note' };
  const archivedEvent = { id: 'revision-1', revision: 1, type: 'set-note', at: '2026-10-31T00:00:00.000Z', undo: { members: [snapshot] } };
  // The active state is migrated without its archived event, as the store does at load.
  const active = validateState(saved);
  assert.equal(active.provenance.ancientEffigiesMigration.a.revision, 1);
  const hydrated = validateState({ ...active, history: [structuredClone(archivedEvent)] });
  assert.equal(hydrated.history[0].undo.members[0].taskRules['Ancient Effigies'], true);
  const undone = applyCommand(hydrated, { type: 'undo' });
  assert.equal(undone.members[0].notes, undefined);
  assert.equal(undone.members[0].taskRules['Ancient Effigies'], true);
  // Snapshots recorded after migration are never rewritten.
  const reset = applyCommand(undone, { type: 'reset-task-rule', memberId: 'a', ruleId: 'Ancient Effigies' });
  assert.equal(validateState(reset).members[0].taskRules['Ancient Effigies'], undefined);
});
test('a restore starts new revision numbers, so incoming migration boundaries never rewrite later events', () => {
  const saved = old();
  saved.members.push({ ...structuredClone(saved.members[0]), id: 'b', name: 'Player b' });
  saved.revision = 100;
  const migrated = validateState(saved);
  assert.equal(migrated.provenance.ancientEffigiesMigration.b.revision, 100);
  // The store keeps the incoming provenance inside the restore record and numbers from the target store.
  const restored = validateState({ ...migrated, revision: 1, history: [{ id: 'revision-1', revision: 1, type: 'restore', at: '2026-11-01T00:00:00.000Z' }],
    provenance: { restore: { incomingRevision: 100, incomingHistory: [], previousHistory: [], incomingProvenance: migrated.provenance } } });
  delete restored.members[1].taskRules;
  const later = applyCommand(validateState(restored), { type: 'set-task-rule', memberId: 'b', ruleId: 'Universal Tertiary', value: false });
  assert.deepEqual(later.history.at(-1).undo.memberChanges[0].changes.map(patch => patch.kind), ['object', 'value']);
  roundTrips(later);
  assert.equal(applyCommand(later, { type: 'undo' }).members[1].taskRules, undefined);
  assert.equal(restored.provenance.ancientEffigiesMigration, undefined, 'no boundary in the new numbering');
});

test('a member id that names an Object prototype key keeps its own migration boundary', () => {
  const saved = old(); saved.members[0].id = '__proto__'; saved.members[0].taskRules = { 'Universal Tertiary': false };
  saved.revision = 3;
  const migrated = validateState(saved);
  assert.equal(Object.getPrototypeOf(migrated.provenance.ancientEffigiesMigration), Object.prototype);
  assert.ok(Object.hasOwn(migrated.provenance.ancientEffigiesMigration, '__proto__'));
  assert.deepEqual(migrated.provenance.ancientEffigiesMigration['__proto__'], { revision: 3, value: false, dropContainers: true });
  roundTrips(migrated);
});

test('a stored null Ancient Effigies value records a boundary that still validates', () => {
  const saved = old(); saved.members[0].taskRules = { 'Ancient Effigies': null };
  const migrated = validateState(saved);
  assert.equal(migrated.provenance.ancientEffigiesMigration.a.value, null);
  roundTrips(migrated);
  assert.throws(() => validateState({ ...migrated, provenance: { ...migrated.provenance, ancientEffigiesMigration: { a: { revision: 0, value: {} } } } }),
    /Invalid Ancient effigies migration boundary/);
});