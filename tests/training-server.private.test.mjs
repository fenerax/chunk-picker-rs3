import { fixtureDataset } from './helpers/server-dataset.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { xpForLevel } from '../app/core/experience.mjs';

const testRoot = fileURLToPath(new URL('../.local/training-tests/', import.meta.url));
const definitions = { chunks: { '12850': { Object: { Tree: true, 'Copper rock': true, 'Fishing spot (crayfish)': true }, Shop: { Wares: true } }, '12851': { Object: { Willow: true } } },
  sections: { '12850': { 0: [] }, '12851': { 0: [] } }, walkableChunks: ['12850', '12851'], walkableChunksF2P: ['12850', '12851'],
  shopItems: { Wares: { 'Bronze hatchet': true, 'Bronze pickaxe': true, 'Iron pickaxe': true, 'Crayfish cage': true } }, challenges: {}, codeItems: { objectsPlus: { 'Tree[+]': ['Tree', 'Dead tree'] } } };

async function fixture(t, observed = true, skillProgress, preferences) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'server-'));
  const initialState = createGroupState([{ id: 'm', name: 'Fixture', unlocked: ['12850'] }]);
  initialState.members[0].runescapeName = 'Test';
  if (observed) initialState.members[0].skillProgress = { Woodcutting: { level: 1, xp: 10, source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-08T12:00:00Z' } };
  if (skillProgress) initialState.members[0].skillProgress = skillProgress;
  if (preferences) initialState.members[0].preferences = preferences;
  const application = await createServer({ dataset: fixtureDataset, definitions, taskMap: {}, initialState, dataDir: path.join(directory, 'state'), port: 0,
    taskWorkerOptions: { startupTimeoutMs: 30000 } });
  await application.listen();
  t.after(async () => { await application.close(); await rm(directory, { recursive: true, force: true }); });
  const url = new URL(application.inviteUrl), headers = { authorization: `Bearer ${url.pathname.split('/').at(-1)}` };
  return { application, origin: url.origin, get: route => fetch(`${url.origin}${route}`, { headers }) };
}

test('training endpoints are authenticated, return personal XP and do not save state', async t => {
  const { origin, get, application } = await fixture(t);
  const route = '/api/training-plan?memberId=m&skill=Woodcutting&targetLevel=5';
  assert.equal((await fetch(`${origin}${route}`)).status, 401);
  assert.equal((await fetch(`${origin}/api/training-catalogue`)).status, 401);
  assert.equal((await fetch(`${origin}/api/house-storage-catalogue`)).status, 401);
  const settingsModule = await get('/core/banking-settings.mjs');
  assert.equal(settingsModule.status, 200);
  assert.match(await settingsModule.text(), /datasetRuleDefinitions/);
  const runtime = await (await get('/api/dataset-runtime')).json();
  assert.ok(runtime.values['app/core/banking-settings.mjs#bankingSettingDefinitions:contract'].some(row => row.id === 'gatheringMode'));
  for (const route of ['/banking-settings.mjs', '/banking-display.mjs', '/banking.css', '/core/gathering-settings.mjs']) assert.equal((await get(route)).status, 200, route);
  const before = application.store.getState();
  const response = await get(route);
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.progress.source, 'runemetrics');
  assert.equal(plan.startingXp, 10);
  assert.equal(plan.xpNeeded, xpForLevel(5) - 10);
  assert.equal(plan.plans['best-xp'].segments[0].methodId, 'woodcutting.normal');
  assert.ok(plan.lockedMethods.some(method => method.methodId === 'woodcutting.willow' && method.blockers.some(blocker => blocker.locations?.some(location => location.chunkId === '12851'))));
  assert.equal(plan.stateRevision, before.revision);
  assert.deepEqual(application.store.getState(), before);
  const catalogue = await (await get('/api/training-catalogue')).json();
  assert.ok(catalogue.methods.length > 20);
  assert.ok((await (await get('/api/house-storage-catalogue')).json()).furniture.length > 6);
});

test('unknown personal level requests a manual level; manual plans override without persisting', async t => {
  const { get, application } = await fixture(t, false);
  const route = '/api/training-plan?memberId=m&skill=Woodcutting&targetLevel=5';
  const unknown = await (await get(route)).json();
  assert.equal(unknown.status, 'unknown-level');
  assert.equal(unknown.progress.level, null);
  const before = application.store.getState();
  const manual = await (await get(`${route}&fromLevel=1&preference=best-xp`)).json();
  assert.equal(manual.progress.source, 'manual');
  assert.equal(manual.startingXp, 0);
  assert.equal(manual.recommendation.preference, 'best-xp');
  assert.deepEqual(application.store.getState(), before);
  for (const suffix of ['&fromLevel=0', '&fromLevel=1.5', '&preference=unknown']) assert.equal((await get(`${route}${suffix}`)).status, 400);
  assert.equal((await get('/api/training-plan?memberId=bad&skill=Woodcutting&targetLevel=5')).status, 400);
  assert.equal((await get('/api/training-plan?memberId=m&skill=Unknown&targetLevel=5')).status, 400);
  assert.equal((await get('/api/training-plan?memberId=m&skill=Woodcutting&targetLevel=')).status, 400);
});

test('processing endpoint uses current personal levels and saved choices without saving the calculation', async t => {
  const observed = level => ({ level, xp: xpForLevel(level), source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-15T12:00:00Z' });
  const { get, application } = await fixture(t, false, { Fishing: observed(10), Cooking: observed(50) },
    { gatheringProcessing: 'cook-drop', gatheringCookingFacility: 'fire' });
  const before = application.store.getState();
  const response = await get('/api/training-plan?memberId=m&skill=Fishing&targetLevel=11&preference=best-xp');
  assert.equal(response.status, 200);
  const plan = await response.json(), processing = plan.recommendation.segments[0].banking.processing;
  assert.equal(processing.mode, 'cook-drop'); assert(processing.processingXpPerHour.Cooking > 0);
  assert(processing.gatheringFraction < 1);
  assert.deepEqual(application.store.getState(), before);
});

test('RuneMetrics capped skills with virtual XP return an already-complete plan', async t => {
  const { get } = await fixture(t, false, { Cooking: { level: 99, xp: xpForLevel(100), source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-08T12:00:00Z' } });
  const response = await get('/api/training-plan?memberId=m&skill=Cooking&targetLevel=99');
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.xpNeeded, 0);
  assert.equal(plan.plans.balanced.hours, 0);
});

test('Mining endpoint consumes saved preferences and Strength, validates temporary options and never saves a plan', async t => {
  const observed = level => ({ level, xp: xpForLevel(level) + 10, source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-12T12:00:00Z' });
  const { get, application } = await fixture(t, false, { Mining: observed(20), Strength: observed(40) },
    { miningPickaxe: 'bronze', miningAttention: 'afk' });
  const before = application.store.getState();
  const route = '/api/training-plan?memberId=m&skill=Mining&targetLevel=21&preference=best-xp';
  const saved = await (await get(route)).json();
  const segment = saved.recommendation.segments[0];
  assert.equal(segment.mining.pickaxeId, 'bronze');
  assert.equal(segment.mining.profileId, 'afk');
  assert.equal(segment.mining.strengthLevel, 40);
  assert.equal(segment.actions, null);
  assert.ok(segment.orePerHour > 0);
  const override = await (await get(`${route}&miningPickaxe=iron&miningAttention=active`)).json();
  assert.equal(override.recommendation.segments[0].mining.pickaxeId, 'iron');
  assert.ok(override.recommendation.hours < saved.recommendation.hours);
  for (const suffix of ['&miningPickaxe=dragon', '&miningAttention=perfect']) assert.equal((await get(route + suffix)).status, 400);
  const catalogue = await (await get('/api/training-catalogue')).json();
  assert.ok(catalogue.mining.pickaxes.some(tool => tool.id === 'rune+3'));
  assert.ok(catalogue.mining.profiles.some(profile => profile.id === 'afk'));
  assert.deepEqual(application.store.getState(), before);
});

test('Woodcutting endpoint uses personal hatchet, validates overrides and keeps plans read-only', async t => {
  const observation = { level: 30, xp: xpForLevel(30) + 10, source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-12T12:00:00Z' };
  const { get, application } = await fixture(t, false, { Woodcutting: observation }, { woodcuttingHatchet: 'bronze' });
  const before = application.store.getState();
  const route = '/api/training-plan?memberId=m&skill=Woodcutting&targetLevel=32&preference=best-xp';
  const saved = await (await get(route)).json();
  assert.equal(saved.startingXp, observation.xp);
  assert.equal(saved.recommendation.segments[0].woodcutting.hatchetId, 'bronze');
  assert.ok(saved.recommendation.segments[0].logsPerHour > 0);
  const override = await (await get(`${route}&woodcuttingHatchet=mithril`)).json();
  assert.equal(override.recommendation.segments[0].woodcutting.hatchetId, 'mithril');
  assert.ok(override.recommendation.hours < saved.recommendation.hours);
  assert.equal((await get(`${route}&woodcuttingHatchet=dragon`)).status, 400);
  const unusable = await get(`${route}&woodcuttingHatchet=rune`);
  assert.equal(unusable.status, 400);
  assert.match((await unusable.json()).message, /Rune hatchet requires Woodcutting 50.*Best for my level/);
  const catalogue = await (await get('/api/training-catalogue')).json();
  assert.deepEqual(catalogue.woodcutting.hatchets.map(tool => tool.id), ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune']);
  for (const file of ['/woodcutting-settings.mjs', '/core/woodcutting-settings.mjs', '/training/woodcutting-rates.mjs', '/training/woodcutting-rules.mjs', '/data/training/woodcutting-rates.v1.json']) assert.equal((await get(file)).status, 200, file);
  assert.deepEqual(application.store.getState(), before);
});

test('Fishing endpoint uses personal exact XP and returns catches without changing the save', async t => {
  const observation = { level: 10, xp: xpForLevel(10) + 12, source: 'runemetrics', runescapeName: 'Test', fetchedAt: '2026-10-12T12:00:00Z' };
  const { get, application } = await fixture(t, false, { Fishing: observation });
  const before = application.store.getState();
  const response = await get('/api/training-plan?memberId=m&skill=Fishing&targetLevel=12&preference=best-xp');
  assert.equal(response.status, 200);
  const plan = await response.json(), segment = plan.recommendation.segments[0];
  assert.equal(plan.startingXp, observation.xp); assert.equal(plan.recommendation.complete, true);
  assert.ok(segment.xpPerHour > 0 && segment.fishPerHour > 0 && segment.fishProduced > 0);
  assert.equal(segment.fishing.methodId, 'crayfish'); assert.equal(segment.species[0].id, 'crayfish');
  assert.equal((await get('/fishing-display.mjs')).status, 200);
  assert.deepEqual(application.store.getState(), before);
});
