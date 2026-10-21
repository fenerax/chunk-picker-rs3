import { genericWorkerData } from './helpers/worker-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { planTraining } from '../app/tasks/training-planner.mjs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { buildWorld } from '../app/data/world.mjs';
import { createServer } from '../app/server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../app/data/skill-guides.mjs';
import { deserialize } from 'node:v8';

const definitions = { chunks: { '12341': { Object: { Workbench: 1 } } }, challenges: {
  Extra: { Consumer: { Items: ['Token'] } }, Attack: { 'Combat goal': { Level: 7 } } } };
const generated = { category: 'Crafting', label: 'Cache producer', record: {
  PickerId: 'rs3:task:skill-guide:fixture', Level: 1, Primary: true, Objects: ['Workbench'], Output: 'Token' },
  entryIds: ['fixture-entry'], selectorEvidence: { kind: 'object', selector: 'Workbench' } };
export const fixtureCatalogue = { schemaVersion: 1, version: 'fixture', skills: [], entries: [{ id: 'fixture-entry', skill: 'Crafting', level: 1, members: false }],
  generatedTasks: [generated], trainingBreakpoints: [{ skill: 'Crafting', level: 1, members: false, entryIds: ['fixture-entry'], methodIds: ['fixture-method'], evidence: { reviewed: true } }] };
const state = () => createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }, { id: 'b', name: 'B', unlocked: [] }]);
const consumer = result => result.tasks.find(row => row.label === 'Consumer');

test('cache switches default off and persist through the ordinary rule command', () => {
  const registry = createRuleRegistry(), saved = state();
  for (const id of [SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_CORRECTIONS_RULE]) {
    assert.equal(registry.definitions.find(rule => rule.id === id)?.default, false);
  }
  const enabled = applyCommand(saved, { type: 'set-rule', ruleId: SKILL_GUIDE_TASKS_RULE, value: true }, { registry });
  assert.equal(enabled.rules[SKILL_GUIDE_TASKS_RULE], true);
  assert.equal(saved.rules[SKILL_GUIDE_TASKS_RULE], undefined);
});

test('generated outputs and downstream capabilities enter only the opted-in variant', () => {
  const saved = state(), before = structuredClone({ saved, definitions, fixtureCatalogue });
  const engine = createTaskEngine(definitions, { skillGuideCatalogue: fixtureCatalogue });
  const off = engine.evaluate(saved, 'a');
  assert.equal(consumer(off).status, 'blocked');
  assert.ok(!off.items.some(row => row.name === 'Token'));
  saved.rules[SKILL_GUIDE_TASKS_RULE] = true;
  const enabled = engine.evaluate(saved, 'a');
  assert.equal(consumer(enabled).status, 'available');
  assert.equal(enabled.tasks.find(row => row.id === generated.record.PickerId).obligation, true);
  assert.ok(enabled.items.some(row => row.name === 'Token'));
  saved.rules[SKILL_GUIDE_TASKS_RULE] = false;
  assert.deepEqual(engine.evaluate(saved, 'a').tasks, off.tasks);
  delete saved.rules[SKILL_GUIDE_TASKS_RULE];
  assert.deepEqual({ saved, definitions, fixtureCatalogue }, before);
});

test('explicit preview flags override persisted switches and generated completion keeps its permanent ID', () => {
  const saved = state(); saved.rules[SKILL_GUIDE_TASKS_RULE] = true;
  const options = { skillGuideCatalogue: fixtureCatalogue };
  assert.ok(!createTaskEngine(definitions, { ...options, skillGuideTasks: false }).evaluate(saved, 'a').tasks.some(row => row.id === generated.record.PickerId));
  const engine = createTaskEngine(definitions, { ...options, skillGuideTasks: true });
  const identity = engine.catalogue.find(row => row.id === generated.record.PickerId);
  saved.tasks.push(identity); saved.members[0].completedTasks.push(identity.id);
  assert.equal(engine.evaluate(saved, 'a').tasks.find(row => row.id === identity.id).personalCompleted, true);
  assert.equal(createTaskEngine(definitions, options).evaluate({ ...saved, rules: {} }, 'a').tasks.some(row => row.id === identity.id), false);
});

test('combat corrections are independent opt-ins and do not change disabled definitions', () => {
  const saved = state(), original = structuredClone(definitions);
  const engine = createTaskEngine(definitions, { skillGuideCatalogue: fixtureCatalogue,
    skillGuideCorrectionOverlay: data => ({ ...data, challenges: { ...data.challenges, Attack: { 'Combat goal': { Level: 3 } } } }) });
  const level = () => engine.evaluate(saved, 'a').tasks.find(row => row.label === 'Combat goal').level;
  assert.equal(level(), 7);
  saved.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true; assert.equal(level(), 3);
  assert.ok(!engine.evaluate(saved, 'a').tasks.some(row => row.id === generated.record.PickerId));
  saved.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false; assert.equal(level(), 7);
  assert.deepEqual(definitions, original);
});

test('reviewed guide membership corrections independently unlock an existing recipe and downstream item gate', () => {
  const data = { chunks: { '12341': { Object: { Workbench: 1 } } }, challenges: {
    Cooking: { 'Reviewed recipe': { Level: 1, Objects: ['Workbench'], 'Not F2P': true, Output: 'Reviewed token' } },
    Extra: { Gate: { Items: ['Reviewed token'] } } } };
  const customCatalogue = { ...fixtureCatalogue, generatedTasks: [], metadataCorrections: [{ category: 'Cooking', label: 'Reviewed recipe',
    changes: [{ field: 'Not F2P', before: true, after: false }] }] };
  const original = structuredClone(data), saved = state();
  const engine = createTaskEngine(data, { skillGuideCatalogue: customCatalogue });
  const gate = () => engine.evaluate(saved, 'a').tasks.find(row => row.label === 'Gate');
  assert.equal(gate().status, 'blocked');
  saved.rules[SKILL_GUIDE_TASKS_RULE] = true; assert.equal(gate().status, 'blocked');
  saved.rules[SKILL_GUIDE_TASKS_RULE] = false; saved.rules[SKILL_GUIDE_CORRECTIONS_RULE] = true;
  assert.equal(gate().status, 'available');
  saved.rules[SKILL_GUIDE_CORRECTIONS_RULE] = false; assert.equal(gate().status, 'blocked');
  assert.deepEqual(data, original);
});

test('training exposes reviewed breakpoint metadata without inventing methods, rates or segments', () => {
  const catalogue = { version: 'training-fixture', methods: [{ id: 'fixture-method', skill: 'Crafting', label: 'Fixture', level: 1,
    members: false, xpPerHour: 1000, requirements: [], inputs: [], outputs: [] }], sources: [] };
  const empty = { ...fixtureCatalogue, trainingBreakpoints: [] };
  const before = planTraining('Crafting', 1, 3, { catalogue, skillGuideCatalogue: empty });
  const after = planTraining('Crafting', 1, 3, { catalogue, skillGuideCatalogue: fixtureCatalogue });
  assert.equal(after.skillGuideBreakpoints.length, 1);
  assert.deepEqual(after.plans, before.plans);
  assert.deepEqual(after.availableMethods, before.availableMethods);
});

test('worker advertises generated identities dynamically, saves completion and suppresses disabled saved goals', async t => {
  const workerDefinitions = { ...definitions, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] };
  const worker = new Worker(new URL('../app/tasks/worker.mjs', import.meta.url), {
    workerData: genericWorkerData({ definitions: workerDefinitions, world: buildWorld(workerDefinitions), skillGuideCatalogue: fixtureCatalogue }) });
  t.after(() => worker.terminate());
  const [message] = await once(worker, 'message');
  assert.equal(message.type, 'ready');
  // The worker sends its generated catalogue as one structured-clone byte string.
  const ready = { ...message, dynamicCatalogue: deserialize(message.dynamicCatalogueBytes) };
  assert.ok(!ready.catalogue.some(row => row.id === generated.record.PickerId));
  assert.ok(ready.dynamicCatalogue.some(row => row.id === generated.record.PickerId));
  let saved = state(); saved.rules[SKILL_GUIDE_TASKS_RULE] = true;
  saved = applyCommand(saved, { type: 'complete-task', memberId: 'a', taskId: generated.record.PickerId, completed: true },
    { taskCatalogue: new Map(ready.dynamicCatalogue.map(row => [row.id, row])) });
  const send = async id => {
    const response = once(worker, 'message'); worker.postMessage({ id, type: 'evaluate', state: saved, memberId: 'a' });
    const [message] = await response; assert.equal(message.error, undefined); return message.result;
  };
  assert.equal((await send(1)).tasks.find(row => row.id === generated.record.PickerId).personalCompleted, true);
  saved.rules[SKILL_GUIDE_TASKS_RULE] = false; saved.revision++;
  const disabled = await send(2), row = disabled.tasks.find(task => task.id === generated.record.PickerId);
  assert.equal(row.hidden, true); assert.equal(row.obligation, false);
  assert.ok(!disabled.items.some(item => item.name === 'Token'));
});

test('browser rule dependencies and catalogue endpoint are served by an isolated authenticated fixture', async t => {
  const worktree = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(worktree, '.skill-guide-http-test-'));
  let application;
  t.after(async () => {
    await application?.close();
    const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(worktree));
    await rm(resolved, { recursive: true, force: true });
  });
  application = await createServer({ dataDir: path.join(directory, 'data'), port: 0, taskMap: {},
    definitions: { chunks: { '12341': {} }, walkableChunks: ['12341'], walkableChunksF2P: ['12341'] },
    mapAssetsDir: path.join(directory, 'assets'), predictionPrewarm: false, iconManifests: [] });
  await application.listen();
  const joined = await fetch(application.inviteUrl, { redirect: 'manual' });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const origin = `http://127.0.0.1:${application.address().port}`;
  const rules = await fetch(`${origin}/core/rules.mjs`, { headers: { Cookie: cookie } });
  assert.equal(rules.status, 200);
  assert.match(await rules.text(), /from '\.\.\/data\/skill-guide-rules\.mjs'/);
  const constants = await fetch(`${origin}/data/skill-guide-rules.mjs`, { headers: { Cookie: cookie } });
  assert.equal(constants.status, 200); const module = await constants.text();
  assert.match(module, /from ["']\.\.\/dataset-runtime\.mjs["']/);
  assert.match(module, /datasetValue\("app\/data\/skill-guide-rules\.mjs#SKILL_GUIDE_TASKS_RULE"\)/);
  const runtimeResponse = await fetch(`${origin}/api/dataset-runtime`, { headers: { Cookie: cookie } });
  assert.equal(runtimeResponse.status, 200);
  const runtime = await runtimeResponse.json();
  assert.equal(runtime.dataset.digest, application.world.datasetDigest);
  assert.equal(runtime.values['app/data/skill-guide-rules.mjs#SKILL_GUIDE_TASKS_RULE'], SKILL_GUIDE_TASKS_RULE);
  assert.equal(runtime.values['app/data/skill-guide-rules.mjs#SKILL_GUIDE_CORRECTIONS_RULE'], SKILL_GUIDE_CORRECTIONS_RULE);
  const response = await fetch(`${origin}/api/skill-guide-catalogue`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const catalogue = await response.json(); assert.equal(catalogue.schemaVersion, 1); assert.ok(Array.isArray(catalogue.entries));
  const rawResponse = await fetch(`${origin}/data/skill-guides.2026-10-08.v1.json`, { headers: { Cookie: cookie } });
  assert.equal(rawResponse.status, 200);
  assert.deepEqual(await rawResponse.json(), catalogue);
});
