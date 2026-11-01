import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import referenceCorrections from '../app/data/reference-corrections.2026-10-31.v1.mjs';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGroupState, validateState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { resolveTaskRules, taskRuleDefault, taskRuleEnabled } from '../app/tasks/rule-defaults.mjs';
import { taskRuleDefinitions, taskRuleBehavior } from '../app/data/settings.mjs';
import { buildRulesSections, rulesCatalogue, taskRuleValue, taskRuleAutomaticValue, planTaskRuleChange } from '../app/web/rules-model.mjs';

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

import { assertPreserved } from '../scripts/private-companion/release-pack-check.mjs';
import { digestValue } from '../scripts/private-companion/release-identity.mjs';

const fresh = () => createGroupState([{ id: 'a', name: 'Fixture player' }]);
const effigyDefinition = { id: 'Ancient Effigies' };
const roundTrips = saved => {
  assert.deepEqual(validateState(saved), saved);
  assert.deepEqual(importBackup(exportBackup(saved)), saved);
};
// Match the authoritative progress fields and retained-history hashes consumed
// by the unchanged release-pack-check helper, without opening a server.
const preservationReport = saved => {
  const progress = Object.fromEntries(Object.entries(saved).filter(([key]) => !['identityRegistry', 'tasks', 'legacy', 'revision', 'history', 'provenance'].includes(key)));
  progress.provenance = Object.fromEntries(Object.entries(saved.provenance ?? {}).filter(([key]) => !['taskIdentityMigration', 'historyArchive'].includes(key)));
  const migration = saved.provenance?.taskIdentityMigration ?? {};
  return { progressFields: Object.fromEntries(Object.entries(progress).map(([key, value]) => [key, digestValue(value)])),
    progressDigest: digestValue(progress), taskIds: saved.tasks.map(task => task.id),
    historyEvents: saved.history.map(digestValue), historyTypes: saved.history.map(event => event.type),
    migrationArchives: (migration.archives ?? []).map(digestValue), migrationConversions: (migration.conversions ?? []).map(digestValue),
    migrationConflicts: (migration.conflicts ?? []).map(digestValue) };
};

for (const value of [undefined, true, false]) test(`old save is deep-equal and release-preserved: tertiary=${value}`, () => {
  let saved = fresh();
  if (value !== undefined) saved.members[0].taskRules = { 'Universal Tertiary': value };
  saved = applyCommand(saved, { type: 'set-task-rule', memberId: 'a', ruleId: 'Every Drop', value: true });
  assert.equal(saved.provenance, undefined);
  const before = structuredClone(saved), loaded = validateState(saved);
  assert.deepEqual(loaded, before);
  assert.deepEqual(saved, before);
  assert.equal(Object.hasOwn(loaded.members[0].taskRules ?? {}, 'Ancient Effigies'), false);
  assert.equal(loaded.provenance, undefined);
  assertPreserved(preservationReport(before), preservationReport(loaded));
  const corrupted = structuredClone(loaded); corrupted.members[0].taskRules = { 'Ancient Effigies': true };
  assert.throws(() => assertPreserved(preservationReport(before), preservationReport(corrupted)), /fields=members/);
  roundTrips(loaded);
});

// Codex review r1, P2 1: legacy effigy values gain no taskRuleDiagnostics provenance.
for (const value of ['false', 0, null, 'true', 1]) test(`legacy effigy values stay deep-equal and release-preserved: ${JSON.stringify(value)}`, () => {
  const saved = fresh();
  saved.members[0].taskRules = { 'Ancient Effigies': value };
  saved.legacy = { maps: { m: { rules: { 'Ancient Effigies': value } } } };
  saved.members[0].sourceMapId = 'm';
  const before = structuredClone(saved);
  const loaded = validateState(saved);
  assert.deepEqual(loaded, before);
  assert.equal(loaded.provenance?.taskRuleDiagnostics, undefined);
  assertPreserved(preservationReport(before), preservationReport(loaded));
  assert.throws(() => applyCommand(loaded, { type: 'set-task-rule', memberId: 'a', ruleId: 'Ancient Effigies', value: 'false' }), /boolean/);
});

for (const value of [undefined, true, false, 'false', 0, null]) test(`lazy default agrees across engine, access, collection and Settings: tertiary=${value}`, () => {
  const rules = value === undefined ? {} : { 'Universal Tertiary': value };
  const saved = state(rules), before = structuredClone(saved), allowed = ![false, 'false', 0].includes(value);
  const data = definitions(), engine = createTaskEngine(data, options), result = engine.evaluate(saved, 'a');
  assert.equal(resolveTaskRules({}, {}, rules)['Ancient Effigies'], allowed);
  assert.equal(taskRuleEnabled(rules, 'Ancient Effigies'), allowed);
  assert.equal(taskRuleValue(saved, 'a', effigyDefinition).value, allowed);
  assert.equal(result.items.some(row => row.name === items[0]), allowed);
  assert.equal(result.tasks.find(row => row.rawLabel === 'Use ' + items[0]).status, allowed ? 'available' : 'blocked');
  const collectionState = structuredClone(saved); collectionState.members[0].taskRules['Every Drop'] = true;
  assert.equal(createCollectionEngine(data).evaluate(collectionState, 'a', result).tasks.some(row => row.item === items[0]), allowed);
  assert.deepEqual(saved, before);
});

test('imported → group → member merge precedes the lazy default, and explicit effigy values win', () => {
  const saved = fresh(); saved.members[0].sourceMapId = 'fixture-map';
  saved.legacy = { maps: { 'fixture-map': { rules: { 'Universal%20Tertiary': false } } } };
  const value = () => taskRuleValue(saved, 'a', effigyDefinition).value;
  assert.equal(value(), false);
  saved.taskRules = { 'Universal Tertiary': true }; assert.equal(value(), true);
  saved.members[0].taskRules = { 'Universal Tertiary': false }; assert.equal(value(), false);
  saved.legacy.maps['fixture-map'].rules['Ancient%20Effigies'] = true; assert.equal(value(), true);
  saved.taskRules['Ancient Effigies'] = false; assert.equal(value(), false);
  saved.members[0].taskRules['Ancient Effigies'] = true; assert.equal(value(), true);
  delete saved.members[0].taskRules; delete saved.taskRules;
  saved.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'fixture-map' }] };
  assert.equal(value(), true);
  assert.equal(taskRuleDefault('Ancient Effigies'), true);
  for (const explicit of [true, false, 'false', 0, null]) {
    assert.equal(resolveTaskRules({}, { 'Ancient Effigies': explicit }, { 'Universal Tertiary': false })['Ancient Effigies'], ![false, 'false', 0].includes(explicit));
  }
});

test('Settings writes an ordinary override, Automatic deletes it, and both commands undo', () => {
  let saved = fresh(); saved.members[0].taskRules = { 'Universal Tertiary': false };
  const plan = planTaskRuleChange(saved, ['a'], effigyDefinition, true);
  assert.deepEqual(plan.commands, [{ type: 'set-task-rule', memberId: 'a', ruleId: 'Ancient Effigies', value: true }]);
  saved = applyCommand(saved, plan.commands[0]);
  assert.equal(taskRuleValue(saved, 'a', effigyDefinition).value, true);
  assert.equal(taskRuleAutomaticValue(saved, 'a', effigyDefinition).value, false);
  const reset = applyCommand(saved, { type: 'reset-task-rule', memberId: 'a', ruleId: 'Ancient Effigies' });
  assert.equal(Object.hasOwn(reset.members[0].taskRules, 'Ancient Effigies'), false);
  assert.equal(taskRuleValue(reset, 'a', effigyDefinition).value, false);
  assert.equal(applyCommand(reset, { type: 'undo' }).members[0].taskRules['Ancient Effigies'], true);
  const undone = applyCommand(saved, { type: 'undo' });
  assert.equal(Object.hasOwn(undone.members[0].taskRules, 'Ancient Effigies'), false);
  const changed = applyCommand(reset, { type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: true });
  assert.equal(taskRuleValue(changed, 'a', effigyDefinition).value, true);
  roundTrips(changed);
});

test('old sparse container patches and full-member undo snapshots stay unchanged and undo normally', () => {
  const sparse = applyCommand(fresh(), { type: 'set-task-rule', memberId: 'a', ruleId: 'Universal Tertiary', value: false });
  assert.deepEqual(sparse.history[0].undo.memberChanges[0].changes.map(patch => patch.kind), ['object', 'value']);
  assert.deepEqual(validateState(sparse), sparse);
  assert.equal(applyCommand(sparse, { type: 'undo' }).members[0].taskRules, undefined);
  const saved = fresh(), snapshot = structuredClone(saved.members[0]);
  saved.revision = 1; saved.members[0].notes = { '1': 'Fixture note' };
  saved.history = [{ id: 'revision-1', revision: 1, type: 'set-note', at: '2026-10-31T00:00:00.000Z', undo: { members: [snapshot] } }];
  const before = structuredClone(saved), loaded = validateState(saved);
  assert.deepEqual(loaded, before);
  assertPreserved(preservationReport(before), preservationReport(loaded));
  const undone = applyCommand(loaded, { type: 'undo' });
  assert.equal(undone.members[0].notes, undefined);
  assert.equal(undone.members[0].taskRules, undefined);
});

test('store opening and calculation validation preserve a synthetic old save without provenance', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'rs3-effigies-'));
  let saved = fresh(); saved.members[0].taskRules = { 'Universal Tertiary': false };
  const store = await openStore({ dataDir, initialState: saved, retention: false,
    world: { chunks: new Map(), neighbors: new Map(), walkable: new Set(), f2p: new Set() } });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  assert.deepEqual(store.getState(), saved);
  assertPreserved(preservationReport(saved), preservationReport(store.getState()));
  const snapshot = store.getCalculationSnapshot();
  assert.equal(snapshot.state.provenance, undefined);
  assert.deepEqual(validateState(snapshot.state), snapshot.state);
  assert.deepEqual(validateState(JSON.parse(Buffer.from(snapshot.stateJSON).toString())), snapshot.state);
});

test('both independent switches appear together with an Automatic explanation', () => {
  const sections = buildRulesSections(rulesCatalogue, fresh());
  const group = sections.find(section => section.rules.some(rule => rule.id === 'Universal Tertiary'));
  const effigies = group.rules.find(rule => rule.id === 'Ancient Effigies');
  assert.ok(effigies); assert.equal(effigies.parent, null); assert.equal(effigies.default, true);
  assert.equal(effigies.description, 'Allow ancient effigies from universal tertiary drops to count towards chunk tasks');
  assert.match(effigies.explanation.what, /Automatic follows Universal Tertiary/);
  assert.equal(taskRuleDefinitions.find(rule => rule.id === 'Ancient Effigies').category, 'Item Sources');
  assert.equal(taskRuleBehavior('Ancient Effigies').status, 'implemented-scope');
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

for (const value of [false, 'false', 0, true, null]) test(`explicit effigy truthiness is shared by engine and Settings: ${value}`, () => {
  const saved = state({ 'Universal Tertiary': true, 'Ancient Effigies': value }), allowed = ![false, 'false', 0].includes(value);
  assert.equal(taskRuleValue(saved, 'a', effigyDefinition).value, allowed);
  assert.equal(taskRuleEnabled(saved.members[0].taskRules, 'Ancient Effigies'), allowed);
  assert.equal(createTaskEngine(definitions(), options).evaluate(saved, 'a').items.some(row => row.name === items[0]), allowed);
});

test('restore provenance and retained undo history gain no effigy metadata', () => {
  const saved = fresh();
  saved.provenance = { restore: { incomingProvenance: { fixture: true }, previousHistory: [], incomingHistory: [] } };
  saved.members[0].taskRules = { 'Universal Tertiary': false };
  const before = structuredClone(saved), loaded = validateState(saved);
  assert.deepEqual(loaded, before);
  assertPreserved(preservationReport(before), preservationReport(loaded));
});

test('task explanations describe the same lazy value as Settings and the calculator', async () => {
  const { createRuleDescriber } = await import('../app/web/task-why.mjs');
  for (const tertiary of [undefined, true, false, 'false', 0]) {
    const saved = state(tertiary === undefined ? {} : { 'Universal Tertiary': tertiary });
    const before = structuredClone(saved), describe = await createRuleDescriber(saved, 'a');
    assert.equal(describe('Ancient Effigies').on, ![false, 'false', 0].includes(tertiary));
    assert.equal(describe('Ancient Effigies').source, 'Automatic');
    assert.deepEqual(saved, before);
  }
});

test('the lazy default preserves unrelated imported rule keys and their previous Settings interpretation', () => {
  const imported = { 'Show%20Nonskill%20Tasks': false, 'Universal%20Tertiary': false };
  const before = structuredClone(imported), resolved = resolveTaskRules(imported);
  assert.deepEqual(resolved, { ...imported, 'Ancient Effigies': false });
  assert.deepEqual(imported, before);
  const saved = fresh(); saved.members[0].sourceMapId = 'fixture-map';
  saved.legacy = { maps: { 'fixture-map': { rules: imported } } };
  assert.deepEqual(taskRuleValue(saved, 'a', { id: 'Show Nonskill Tasks' }), { value: false, source: 'Automatic', explicit: false });
  assert.equal(taskRuleValue(saved, 'a', effigyDefinition).value, false);
});
