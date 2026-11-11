// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { prepareOwnedServingRelease, retainOwnedServingRelease, verifyOwnedServingConfiguration,
  verifyOwnedRuntimeRelease, selectOwnedServingPicker } from '../app/storage/owned-serving.mjs';
import { createGroupState, createResidentState, materializeResidentState } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { fixtureMigration } from '../scripts/perf/capacity/fixture-migration.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { catalogue } from '../scripts/perf/capacity/model.mjs';
import { createPinnedOwnedMigration } from '../app/owned-preparation.mjs';
import { projectPlayState } from '../app/play-view.mjs';
import { applyOwnedCatalogueRows } from '../app/tasks/owned-catalogue-view.mjs';
import { createTaskReuseFingerprint } from '../app/tasks/unlock-reuse.mjs';
import { eligibilityInputKey } from '../app/tasks/eligibility-cache.mjs';
import { createDeltaCommandValidator } from '../app/core/delta-validation.mjs';
import { releaseFixture } from './helpers/owned-serving-release-fixture.mjs';
async function scratch(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'owned-serving-config-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test('canonical release preparation is repeatable and contains no group facts', async () => {
  const a = await releaseFixture(), b = await releaseFixture();
  assert.deepEqual(a.release.releaseBytes, b.release.releaseBytes);
  assert.deepEqual(Object.keys(a.release.base), ['baseFormat', 'generatorVersion', 'dataset', 'tasks', 'identityRegistry']);
  assert(!a.release.releaseBytes.includes(Buffer.from('catalogue-seed')));
});
test('configuration requires exact independent release inputs and matches runtime migration identities', async t => {
  const root = await scratch(t), { release } = await releaseFixture();
  const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [path.join(root, 'pickers')] });
  const verify = options => verifyOwnedServingConfiguration(options, { dataset: selectedDataset, deletionRoots: [path.join(root, 'pickers')] });
  const verified = await verify(config); verifyOwnedRuntimeRelease(verified, release);
  for (const options of [true, null, { ...config, dataset: { ...config.dataset, digest: 'a'.repeat(64) } },
    { ...config, manifestPath: undefined }, { ...config, releaseBytes: Buffer.from('corrupt') }, { ...config, manifest: { schemaVersion: 1, bases: {} } }]) {
    await assert.rejects(verify(options));
  }
  assert.throws(() => verifyOwnedRuntimeRelease(verified, { releaseBytes: Buffer.from('different prepared identities') }), /canonical catalogue/);
  const files = await readdir(config.catalogueRoot);
  await assert.rejects(verify({ ...config, retainedManifestPaths: [path.join(config.catalogueRoot, 'absent-manifest')] }), { code: 'ENOENT' });
  assert.deepEqual(await readdir(config.catalogueRoot), files);
});
test('external catalogue containment includes junction ancestors and nonexistent leaves', async t => {
  const root = await scratch(t), { release } = await releaseFixture(), pickers = path.join(root, 'pickers'); await mkdir(pickers);
  const link = path.join(root, 'catalogue-link'); await symlink(pickers, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const catalogueRoot of [pickers, path.join(pickers, 'bases'), path.join(link, 'absent'), root]) {
    await assert.rejects(retainOwnedServingRelease(release, { catalogueRoot, deletionRoots: [pickers] }), /outside picker/);
  }
  assert.deepEqual(await readdir(pickers), []);
});

test('retained manifests require a verified durable base before server admission', async t => {
  const root = await scratch(t), { release } = await releaseFixture();
  const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [path.join(root, 'group')] });
  await assert.rejects(verifyOwnedServingConfiguration({ ...config, retainedManifestPaths: [config.manifestPath] },
    { dataset: selectedDataset, deletionRoots: [path.join(root, 'group')] }), /base unavailable/);
  await assert.rejects(verifyOwnedServingConfiguration({ ...config, retainedManifestPaths: 'invalid' },
    { dataset: selectedDataset, deletionRoots: [path.join(root, 'group')] }), /must be an array/);
});

test('a pin change after selection refuses before opening or rewriting the save', async t => {
  const root = await scratch(t), { release, migrateState } = await releaseFixture(), dataDir = path.join(root, 'group');
  const config = await retainOwnedServingRelease(release, { catalogueRoot: path.join(root, 'catalogue'), deletionRoots: [dataDir] });
  const initial = createGroupState([{ id: 'owner', name: 'Synthetic' }]); initial.provenance = { dataset: release.dataset };
  const logical = migrateState(initial, {});
  const writer = await openStore({ dataDir, initialState: logical, ownedFormat2: { ...config, pickerId: 'synthetic-picker' }, completionCodec: false, retention: false });
  await writer.close();
  const verified = await verifyOwnedServingConfiguration(config, { dataset: selectedDataset, deletionRoots: [dataDir] });
  const selected = await selectOwnedServingPicker(verified, 'synthetic-picker', dataDir);
  const before = Buffer.from(JSON.stringify({ schemaVersion: 1, state: logical }));
  await writeFile(path.join(dataDir, 'state.json'), before);
  await assert.rejects(openStore({ dataDir, ownedFormat2: selected.ownedFormat2, completionCodec: false, retention: false }), { code: 'OWNED_SERVING_REFUSED' });
  assert.equal((await readFile(path.join(dataDir, 'state.json'))).equals(before), true);
});
test('pinned preparation uses base catalogue membership and refuses another dataset on load/command/import', async () => {
  const { release, inputs } = await releaseFixture();
  const definitions = structuredClone(inputs.definitions);
  definitions.challenges.Extra ??= {}; definitions.challenges.Extra['Running only'] = { PickerId: 'rs3:task:new-running-only' };
  definitions.challenges['Ignored non-record category'] = null;
  const runtime = { parsedDefinitions: definitions, parsedTaskMap: inputs.taskMap, identityHistory: inputs.taskMapHistory,
    taskWorker: { catalogue: [...inputs.catalogue, { id: 'rs3:task:new-running-only', label: 'Running only', category: 'Extra' }], dynamicCatalogue: [] } };
  const migrate = createPinnedOwnedMigration(runtime, release.base);
  const initial = createGroupState([{ id: 'owner', name: 'Synthetic' }]); initial.provenance = { dataset: release.dataset };
  const state = migrate(initial, { operation: 'initialize' });
  assert(!state.tasks.some(row => row.id === 'rs3:task:new-running-only'));
  const original = JSON.stringify(state);
  for (const operation of ['load', 'command', 'replace']) {
    assert.equal(migrate.isCurrent(state), true);
    assert.equal(migrate(state, { operation }), state);
    const foreign = structuredClone(state); foreign.provenance.dataset.digest = 'a'.repeat(64);
    assert.throws(() => migrate(foreign, { operation }), { status: 422 });
  }
  assert.equal(JSON.stringify(state), original);
  const stale = structuredClone(state);
  stale.legacy = { ...stale.legacy, gameplayMigration: { schemaVersion: 2, progressAliasesVersion: 1, warnings: [], report: { catalogueTasks: 0 } } };
  const context = { operation: 'load' }; assert.equal(migrate.isCurrent(stale), true);
  migrate(stale, context); assert.equal(context.migration.reused, true);
  assert.equal(stale.legacy.gameplayMigration.report.catalogueTasks, stale.tasks.length);
  assert.deepEqual(stale.members, state.members); assert.deepEqual(stale.history, state.history);
});
test('retirement/current-name consumers preserve historical rows, aliases and Undo and change cache identity', async () => {
  const { release, migrateState, inputs } = await releaseFixture(), rules = createRuleRegistry();
  let flat = createGroupState([{ id: 'owner', name: 'Synthetic', unlocked: [Object.keys(inputs.definitions.chunks)[0]] }], rules);
  flat = migrateState(flat, {});
  const id = release.base.tasks[0].id;
  flat.members[0].completedTasks = [id];
  flat.provenance = { ownedCatalogue: { retiredIds: [id], names: { [id]: 'Current synthetic name' } } };
  const state = createResidentState(flat, release.base), bytes = JSON.stringify(materializeResidentState(state));
  const validator = createDeltaCommandValidator(), certified = validator.validate(state);
  assert(Object.isFrozen(certified.provenance.ownedCatalogue.names));
  assert(Object.isFrozen(certified.provenance.ownedCatalogue.retiredIds));
  assert.throws(() => { certified.provenance.ownedCatalogue.names[id] = 'Changed through old proof'; }, TypeError);
  const play = projectPlayState(state, { ownedCatalogueSemantics: true });
  assert.equal(play.tasks.find(row => row.id === id).label, 'Current synthetic name');
  const rows = applyOwnedCatalogueRows([{ id, label: 'Historical synthetic name', obligation: true }], state);
  assert.equal(rows[0].obligation, false); assert.equal(rows[0].hidden, true);
  assert.equal(JSON.stringify(materializeResidentState(state)), bytes);
  assert.equal(projectPlayState(flat).tasks.find(row => row.id === id).label, flat.tasks.find(row => row.id === id).label, 'format-1 display remains historical');
  const changed = { ...state, provenance: { ownedCatalogue: { retiredIds: [], names: {} } } };
  assert.deepEqual(projectPlayState(state), projectPlayState(flat), 'unopted display retains slice-7a parity');
  const key = createTaskReuseFingerprint({ ownedCatalogueSemantics: true });
  assert.notEqual(key(state), key(changed)); assert.notEqual(eligibilityInputKey(state, 'owner', undefined, true), eligibilityInputKey(changed, 'owner', undefined, true));
  assert.equal(createTaskReuseFingerprint()(state), createTaskReuseFingerprint()(changed));
  assert.equal(eligibilityInputKey(state, 'owner'), eligibilityInputKey(changed, 'owner'));
});
test('calculator retirement removes new obligations while the default engine remains unchanged', async () => {
  const definitions = { challenges: { Extra: { 'Synthetic obligation': { PickerId: 'rs3:task:retirement-target' } } }, chunks: {}, equipment: {}, codeItems: {} };
  const state = createGroupState([{ id: 'owner', name: 'Synthetic' }]);
  const engine = createTaskEngine(definitions, { ownedCatalogueSemantics: true }), ordinary = createTaskEngine(definitions);
  const baseline = ordinary.evaluate(state, 'owner'); const target = baseline.tasks.find(row => row.obligation);
  assert.ok(target);
  state.provenance = { ownedCatalogue: { retiredIds: [target.id] } };
  assert.equal(ordinary.evaluate(state, 'owner').tasks.find(row => row.id === target.id).obligation, true);
  assert.equal(engine.evaluate(state, 'owner').tasks.find(row => row.id === target.id).obligation, true, 'format 1 stays outside owned semantics');
  const { migrateState } = fixtureMigration({ definitions, catalogue: ordinary.catalogue, dynamicCatalogue: [], taskMap: {}, taskMapHistory: {} }, selectedDataset);
  const release = await prepareOwnedServingRelease({ dataset: selectedDataset, migrateState });
  const resident = createResidentState(migrateState(state, {}), release.base);
  assert.equal(engine.evaluate(resident, 'owner').tasks.find(row => row.id === target.id).obligation, false);
});
