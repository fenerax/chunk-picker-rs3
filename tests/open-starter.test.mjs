import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

// Select before importing any app module. These tests never import a server or
// storage module and do not create/open save files.
process.env.RS3_DATASET = 'open-starter';
const { selectedDataset: dataset, materializeDatasetValues } = await import('../app/dataset-runtime.mjs');
const { resolveDataset, decodeDatasetValue } = await import('../app/datasets.mjs');
const { loadDatasetInputs } = await import('../app/dataset-bootstrap.mjs');
const { buildWorld, surfaceCoordinates } = await import('../app/data/world.mjs');
const { createTaskEngine } = await import('../app/tasks/engine.mjs');
const { evaluateRollPool, createRuleRegistry, taskCompletion } = await import('../app/core/rules.mjs');
const { authoredIdentityRegistry, resolveTaskAlias, isPermanentId } = await import('../app/tasks/identity.mjs');
const { createGroupState, validateState } = await import('../app/core/state.mjs');
const { validatePreference } = await import('../app/core/preferences.mjs');
const { personalCustomTaskRows } = await import('../app/web/custom-tasks-model.mjs');
const { datasetStatusText } = await import('../app/web/dataset-status.mjs');
const { definitionBytes, taskBytes } = await loadDatasetInputs(dataset);
const definitions = JSON.parse(definitionBytes), taskMap = JSON.parse(taskBytes);
const world = buildWorld(definitions, { dataset });
const engine = createTaskEngine(definitions, { dataset });

test('Advanced dataset status preserves ordinary copy and adds explicit F2P coverage and omissions', () => {
  assert.equal(datasetStatusText({ id: 'open-starter', version: '1.0.0', health: 'healthy' }), 'Game data: open-starter · 1.0.0 · healthy');
  assert.equal(datasetStatusText({ id: 'open-f2p', version: '0.1.0', health: 'healthy', coverage: {
    cells: 5, connections: 8, sources: 12, tasks: 12, wikiPages: 3,
    omitted: ['Quests', 'Members areas'],
  } }), 'Game data: open-f2p · 0.1.0 · healthy. Coverage: 5 cells, 8 connections, 12 sources, 12 tasks, 3 Wiki pages. Omitted: Quests; Members areas.');
});

test('explicit starter selection owns all bytes and never invokes tracked values', async () => {
  assert.equal(dataset.id, 'open-starter');
  assert.equal(dataset.coordinateSystem, 'open-starter-grid-v1');
  assert.equal(dataset.capabilities.independent, true);
  assert.equal(dataset.capabilities.legacyHistory, false);
  assert.ok(Object.values(dataset.capabilities.features).every(value => value === false));
  const independentlyResolved = await resolveDataset({ datasetId: 'open-starter', root: '/unavailable', packsDir: '/unavailable', selectionPath: '/unavailable' });
  assert.equal(independentlyResolved.digest, dataset.digest);
  assert.equal(dataset.value('app/data/identity-registry.mjs#authoredTasks', () => { throw new Error('Legacy initializer invoked'); }).length, 5);
  assert.throws(() => dataset.json('rs3-chunkpicker-chunkinfo-export.json'), /unavailable/);
  assert.throws(() => dataset.bytes('reference/original-picker/tasksMap.json'), /unavailable/);
  assert.throws(() => dataset.value('unlisted-value'), /unavailable/);
  await assert.rejects(resolveDataset({ datasetId: 'unknown' }), { code: 'DATASET_PACK_INVALID' });
  await assert.rejects(resolveDataset({ datasetId: 'open-starter', digest: '0'.repeat(64) }), { code: 'DATASET_PACK_INVALID' });
});

test('input receipts hash independently authored served bytes and copies protect bytes', () => {
  for (const file of dataset.files.filter(file => file.kind === 'input')) {
    const bytes = dataset.bytes(file.path);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.doesNotThrow(() => JSON.parse(bytes));
    bytes.fill(0);
    assert.equal(createHash('sha256').update(dataset.bytes(file.path)).digest('hex'), file.sha256);
  }
  assert.ok(dataset.files.every(file => !file.path.startsWith('reference/') && !file.path.startsWith('local-')));
});

test('invented grid has complete reciprocal neighbours and section zero joins', () => {
  assert.equal(world.chunks.size, 30);
  assert.equal(world.surface.size, 30);
  assert.deepEqual(world.issues, []);
  for (const [id, neighbors] of world.neighbors) {
    assert.ok(surfaceCoordinates(id));
    assert.deepEqual(new Set(world.sectionTopology.get(id).get('0')), new Set(neighbors));
    for (const neighbor of neighbors) assert.ok(world.neighbors.get(neighbor).includes(id));
  }
  assert.deepEqual(world.neighbors.get('100'), ['99', '116']);
  assert.equal(surfaceCoordinates('1'), null);
});

test('tasks use registered stable identities and retain exact aliases', () => {
  const registry = authoredIdentityRegistry();
  assert.equal(registry.schemaVersion, 1);
  assert.equal(Object.keys(registry.entries).length, 7);
  assert.equal(engine.catalogue.length, 5);
  assert.equal(new Set(engine.catalogue.map(row => row.id)).size, 5);
  for (const [label, id] of Object.entries(taskMap)) {
    assert.ok(isPermanentId(id));
    assert.equal(resolveTaskAlias(label).id, id);
    assert.equal(registry.entries[id].category, 'Extra');
  }
  assert.equal(resolveTaskAlias('Keep a journey note').id, 'rs3:task:custom:open-starter:journal');
});

test('own activity requirements and selected roll candidates follow shared engines', () => {
  const state = createGroupState(dataset.gameDefaults.members);
  state.members[0].unlocked = ['100'];
  const first = engine.evaluate(state, state.members[0].id);
  assert.equal(first.tasks.find(task => task.id.endsWith(':practice')).status, 'available');
  assert.equal(first.tasks.find(task => task.id.endsWith(':keepsake')).status, 'blocked');
  assert.deepEqual(evaluateRollPool(world, state, state.members[0].id).eligible.map(row => row.id), ['116', '99']);
  state.members[0].unlocked.push('116', '115');
  assert.equal(engine.evaluate(state, state.members[0].id).tasks.find(task => task.id.endsWith(':keepsake')).status, 'available');
});

test('manual starter goals validate and shared completion grants no second personal tick', () => {
  const state = createGroupState(dataset.gameDefaults.members);
  state.identityRegistry = authoredIdentityRegistry();
  state.tasks = structuredClone(dataset.gameDefaults.tasks);
  assert.equal(state.tasks.length, 2);
  assert.equal(personalCustomTaskRows([], state, state.members[0]).length, 2, 'Both seeded manual goals appear in the shared task renderer');
  state.members[0].completedTasks.push(state.tasks[0].id);
  const checked = validateState(state, createRuleRegistry());
  const result = taskCompletion(checked, state.tasks[0].id, state.members[1].id);
  assert.equal(result.group, true);
  assert.equal(result.personal, false);
  assert.deepEqual(checked.members[1].completedTasks, []);
});

test('browser snapshot materializes only the starter values without legacy module initializers', async () => {
  const values = decodeDatasetValue(await materializeDatasetValues());
  assert.equal(values['app/data/surface-grid.mjs#SURFACE_GRID'].columns, 6);
  assert.deepEqual(values['app/core/game-progress.mjs#defaultRuneScapeNames'], {});
  assert.ok(values['app/tasks/engine.mjs#F2P'] instanceof Set);
  assert.ok(Object.keys(values).length > 90);
  for (const module of ['../app/data/training/catalogue.mjs', '../app/tasks/training-planner.mjs', '../app/tasks/time-estimates.mjs',
    '../app/data/map-connections.mjs', '../app/data/cache-npcs.mjs', '../app/data/item-membership-flags.mjs', '../app/web/rules-model.mjs']) await import(module);
});

test('starter catalogue access cannot mutate provider values or game defaults', () => {
  const categories = dataset.value('app/tasks/engine.mjs#F2P');
  categories.add('Injected category');
  assert.equal(dataset.value('app/tasks/engine.mjs#F2P').has('Injected category'), false);
  assert.throws(() => { dataset.gameDefaults.members[0].name = 'Changed'; }, TypeError);
  assert.equal(dataset.gameDefaults.members[0].name, 'Explorer 1');
});

test('the authorship ledger covers every playable row without external inputs', () => {
  const provenance = dataset.json('app/open-starter-provenance.json');
  assert.deepEqual(provenance.inputs, []);
  assert.equal(provenance.rows.filter(row => row.kind === 'cell').length, 30);
  assert.equal(provenance.rows.filter(row => row.kind === 'section').length, 30);
  assert.equal(provenance.rows.filter(row => row.kind === 'task').length, 5);
  assert.equal(provenance.rows.filter(row => row.kind === 'manual-goal').length, 2);
  assert.ok(provenance.rows.every(row => row.origin === 'project-authored'));
});

test('fresh display defaults keep the map, goal list and history usable', () => {
  const defaults = dataset.value('app/data/settings.mjs#originalSettings');
  assert.equal(defaults.chunkTasks, true);
  assert.equal(defaults.recent, true);
  assert.equal(defaults.info, true);
  assert.equal(validatePreference('theme', 'light'), 'light');
  assert.equal(validatePreference('advanced', true), true);
  assert.equal(validatePreference('ids', false), false);
});

test('worker descriptor preserves selection without an inherited environment selection', async () => {
  const runtime = new URL('../app/dataset-runtime.mjs', import.meta.url).href;
  const worldModule = new URL('../app/data/world.mjs', import.meta.url).href;
  const engineModule = new URL('../app/tasks/engine.mjs', import.meta.url).href;
  const env = { ...process.env }; delete env.RS3_DATASET;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    (async()=>{const {selectedDataset:d}=await import(${JSON.stringify(runtime)});
      const {buildWorld}=await import(${JSON.stringify(worldModule)});
      const {createTaskEngine}=await import(${JSON.stringify(engineModule)});
      const definitions=d.json('app/open-starter-definitions.json');
      parentPort.postMessage({id:d.id,digest:d.digest,cells:buildWorld(definitions,{dataset:d}).chunks.size,tasks:createTaskEngine(definitions,{dataset:d}).catalogue.length});
    })().catch(error=>{throw error});`, { eval: true, env, workerData: { datasetSelection: dataset.workerSelection() } });
  const result = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => { if (code) reject(new Error(`Worker exited ${code}`)); }); });
  await worker.terminate();
  assert.deepEqual(result, { id: 'open-starter', digest: dataset.digest, cells: 30, tasks: 5 });
});
