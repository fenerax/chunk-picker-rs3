import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { duoFixture } from './fixtures/partner.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { predictChunk } from '../app/core/planning.mjs';

const get = (result, category, name) => result.tasks.find(row => row.id === taskId(category, name));

test('own obligations use connected partner training and supplies without acquiring partner goals', () => {
  const { data, state, engine } = duoFixture(), before = structuredClone(state), result = engine.evaluate(state, 'player1');
  assert.equal(get(result, 'Extra', 'Partner').obligation, false);
  assert.equal(get(result, 'Extra', 'PartnerItem').obligation, false);
  assert.equal(get(result, 'Extra', 'Own').status, 'available');
  assert.equal(get(result, 'Extra', 'Own').obligation, true);
  assert.match(get(result, 'Extra', 'Own').explanation, /Smithing training available via Player 2's connected chunks/);
  const presentation = selectPresentedTasks(result, state, 'player1', data);
  assert.ok(!presentation.tasks.some(row => ['Partner', 'PartnerItem', 'Train'].includes(row.rawLabel)));
  const activity = buildActivityInfo(result, state, 'player1', data);
  assert.ok(!activity.activities.some(row => row.id === taskId('Extra', 'Partner')));
  assert.ok(activity.skills.find(row => row.skill === 'Smithing').primaryMethods.some(row => row.id === taskId('Smithing', 'Train') && row.obligation === false));
  const collection = createCollectionEngine(data).evaluate(state, 'player1', result);
  assert.equal(collection.tasks.length, 0, 'Partner monsters/shops do not define my collection goals');
  const gear = evaluateEquipment(result, state, 'player1', data);
  assert.ok(!gear.catalogue.some(row => row.equipmentName === 'Partner sword'));
  assert.ok(gear.tasks.some(row => row.equipmentName === 'Own sword'));
  assert.deepEqual(state, before);
});

test('disconnected partner training blocks an own obligation with a route explanation', () => {
  const { state, engine } = duoFixture(false, '12849');
  const result = engine.evaluate(state, 'player1');
  assert.equal(get(result, 'Extra', 'Own').obligation, true);
  assert.equal(get(result, 'Extra', 'Own').status, 'blocked');
  assert.match(get(result, 'Extra', 'Own').explanation, /Smithing 50.*Player 2.*not connected.*no route out/);
  assert.equal(result.access.objects.includes('Ore'), false);
});

test('prediction adds own obligations when taking personal ownership of a partner chunk', () => {
  const { state, engine, world } = duoFixture();
  const prediction = predictChunk(state, 'player1', '12851', { engine, world });
  assert.ok(prediction.delta.tasksAdded.some(row => row.id === taskId('Extra', 'Partner')));
  assert.ok(prediction.delta.tasksAdded.every(row => row.obligation !== false));
});

test('unpick reselects the forfeited chunk and undo restores both fields', () => {
  const { state, world } = duoFixture(), before = structuredClone(state.members);
  const next = applyCommand(state, { type: 'unpick', memberId: 'player1' }, { world, random: () => 0 });
  assert.deepEqual(next.members[0].selected, ['12850']);
  assert.deepEqual(applyCommand(importBackup(exportBackup(next)), { type: 'undo' }).members, before);
});

test('pick-for-me samples only a frozen offer and restores losers, with exact undo', () => {
  const { state, world } = duoFixture(); state.members[0].pendingRoll = ['12851', '12852'];
  const before = structuredClone(state), next = applyCommand(state, { type: 'pick-for-me', memberId: 'player1' }, { world, random: () => 0.99 });
  assert.deepEqual(next.members[0].unlocked, ['12850', '12852']);
  assert.deepEqual(next.members[0].selected, ['12851']); assert.deepEqual(next.members[0].pendingRoll, []);
  assert.deepEqual(applyCommand(next, { type: 'undo' }).members, before.members); assert.deepEqual(state, before);
  assert.throws(() => applyCommand(before, { type: 'pick-for-me', memberId: 'player1' }, { world, random: () => 1 }));
});

test('round-trip partner connections require directed recorded walking edges and personal travel', async () => {
  const { evaluatePartnerConnections } = await import('../app/core/territory.mjs');
  const { state, world } = duoFixture();
  const route = () => evaluatePartnerConnections(world, state, 'player1', { lodestones: [{ name: 'Lumbridge', chunkId: '12850', f2p: true }] });
  let region = route().regions[0]; assert.equal(region.connected, true); assert.match(region.out, /walking/); assert.match(region.back, /walking|Lumbridge lodestone/);
  world.sectionTopology.get('12851').set('0', []); world.sectionTopology.get('12850').set('0', []);
  assert.equal(route().regions[0].connected, false, 'Adjacency alone is insufficient');
  state.members[0].teleports = [{ id: 'out', label: 'Island spell', destination: '12851', available: true, consumable: false }];
  region = route().regions[0]; assert.equal(region.connected, true); assert.match(region.out, /Island spell/); assert.match(region.back, /Lumbridge lodestone/);
  const noLodestones = () => evaluatePartnerConnections(world, state, 'player1', { lodestones: [] });
  assert.equal(noLodestones().regions[0].connected, false); assert.equal(noLodestones().regions[0].reason, 'no route back');
  state.members[0].teleports = []; state.members[1].teleports = [{ id: 'home', destination: '12850', available: true }]; state.rules['roll.teleportScope'] = 'group';
  assert.equal(noLodestones().regions[0].connected, false, 'No personal teleport or lodestone on the island');
  world.sectionTopology.get('12850').set('0', ['12852']); world.sectionTopology.get('12852').set('0', ['12850', '12851']); world.sectionTopology.get('12851').set('0', ['12852']);
  assert.equal(noLodestones().regions[0].connected, false, 'An unclaimed intermediate cannot be walked');
});

test('own item-only obligation provenance honors required source kinds and dependency aggregates', () => {
  const { data, state } = duoFixture();
  data.chunks['12850'].Shop = { Local: true }; data.shopItems.Local = { Gem: true };
  data.challenges.Extra.DropOnly = { Items: ['Gem'], Source: 'drop' };
  data.challenges.Extra.NonShop = { Items: ['Gem'], NonShop: true };
  data.challenges.Extra.Allowed = { Items: ['Gem'], AllowedSources: ['Imp'] };
  data.challenges.Diary = { Aggregate: { Tasks: { Partner: 'Extra' } } };
  const result = createTaskEngine(data).evaluate(state, 'player1');
  for (const name of ['DropOnly', 'NonShop', 'Allowed']) { assert.equal(get(result, 'Extra', name).status, 'available'); assert.equal(get(result, 'Extra', name).obligation, false); }
  assert.equal(get(result, 'Diary', 'Aggregate').obligation, false);
});

test('partner-only Extra Set winner cannot outclass own tasks or lend actual progress', () => {
  const { data, state } = duoFixture();
  data.challenges.Extra.Own.Set = 'tools'; data.challenges.Extra.Own.Priority = 2;
  data.challenges.Extra.Partner.Set = 'tools'; data.challenges.Extra.Partner.Priority = 1;
  state.members[1].completedTasks = [taskId('Extra', 'Own')];
  const result = createTaskEngine(data).evaluate(state, 'player1'), own = get(result, 'Extra', 'Own');
  assert.equal(own.status, 'available'); assert.equal(own.challengeSatisfied, true); assert.equal(own.personalCompleted, false);
  assert.equal(result.training.Smithing.passiveLevel, 1);
  assert.equal(get(result, 'Extra', 'Partner').obligation, false);
});

test('directed one-way walking needs a return and split sections cannot bridge an island', async () => {
  const { evaluatePartnerConnections } = await import('../app/core/territory.mjs');
  const { world, state } = duoFixture();
  world.sectionTopology.get('12850').set('0', []);
  let result = evaluatePartnerConnections(world, state, 'player1', { lodestones: [] });
  assert.equal(result.byChunk['12851'].reason, 'no route back');
  state.members[0].teleports = [{ id: 'home', label: 'Home spell', destination: '12850', available: true }];
  assert.equal(evaluatePartnerConnections(world, state, 'player1', { lodestones: [] }).byChunk['12851'].connected, true);
  world.sectionTopology.set('12851', new Map([['1', []], ['2', []]]));
  state.members[0].teleports.push({ id: 'island', destination: '12851', available: true });
  state.members[1].unlocked.push('12852'); world.sectionTopology.get('12852').set('0', ['12851-2']);
  result = evaluatePartnerConnections(world, state, 'player1', { sectionsByMember: { player2: ['12851-1','12851-2'] }, lodestones: [] });
  assert.ok(result.sections.includes('12851-1')); assert.ok(!result.sections.includes('12851-2'));
  assert.equal(result.byChunk['12852'].connected, false);
  state.members[0].sectionOverrides = { '12851-1': false };
  assert.equal(evaluatePartnerConnections(world, state, 'player1', { sectionsByMember: { player2: ['12851-1','12851-2'] }, lodestones: [] }).byChunk['12851'].connected, false);
});

test('lodestones never activate through locked chunks, unreachable split sections or members travel in F2P', async () => {
  const { evaluatePartnerConnections } = await import('../app/core/territory.mjs');
  const { world, state } = duoFixture(false);
  state.members[0].teleports = [{ id: 'island', destination: '12851', available: true }];
  const stone = (location, f2p = true) => [{ name: 'Test', chunkId: location.split('-')[0], location, f2p }];
  assert.equal(evaluatePartnerConnections(world, state, 'player1', { lodestones: stone('12852') }).byChunk['12851'].reason, 'no route back');
  assert.equal(evaluatePartnerConnections(world, state, 'player1', { lodestones: stone('12850', false) }).byChunk['12851'].reason, 'no route back');
  world.sectionTopology.set('12850', new Map([['1', []], ['2', []]]));
  assert.equal(evaluatePartnerConnections(world, state, 'player1', { sectionsByMember: { player1: ['12850-1'] }, lodestones: stone('12850-2') }).byChunk['12851'].reason, 'no route back');
});

test('single imported pick-for-me offers and random-start seeding are atomic and reversible', () => {
  const { world, state } = duoFixture(); state.members[0].pendingRoll = ['12852'];
  const next = applyCommand(state, { type: 'pick-for-me', memberId: 'player1' }, { world, random: () => 0 });
  assert.deepEqual(next.members[0].pendingRoll, []); assert.ok(next.members[0].unlocked.includes('12852'));
  state.members[0].pendingRoll = ['12851', '99999']; let draws = 0;
  assert.throws(() => applyCommand(state, { type: 'pick-for-me', memberId: 'player1' }, { world, random: () => { draws++; return 0; } }), /99999/); assert.equal(draws, 0);
  state.members[0].pendingRoll = []; world.sectionTopology.set('12852', new Map([['1', []], ['2', []]]));
  const offer = applyCommand(state, { type: 'random-start', memberId: 'player1', count: 2 }, { world, random: () => 0 });
  const chosen = applyCommand(offer, { type: 'pick-for-me', memberId: 'player1' }, { world, random: () => 0.99 });
  assert.equal(chosen.members[0].sectionOverrides['12852-1'], true); assert.equal(chosen.members[0].sectionOverrides['12852-2'], undefined);
  assert.deepEqual(applyCommand(chosen, { type: 'undo' }).members, offer.members);
});

test('multiple object-producing paths preserve own construction evidence', () => {
  const { data, state } = duoFixture();
  data.challenges.Construction = { Own: { Chunks: ['12850'], 'Output Object': 'Workbench' }, Partner: { Chunks: ['12851'], 'Output Object': 'Workbench' } };
  data.challenges.Extra.Work = { Objects: ['Workbench'] };
  const result = createTaskEngine(data).evaluate(state, 'player1');
  assert.equal(get(result, 'Extra', 'Work').obligation, true); assert.ok(result.obligationAccess.objects.includes('Workbench'));
});

test('partner monsters explain combat training without copying personal levels', () => {
  const { data, state } = duoFixture(); data.challenges.Extra.Fight = { Chunks: ['12850'], Skills: { Attack: 20, Combat: 40 } };
  const result = createTaskEngine(data).evaluate(state, 'player1');
  assert.match(get(result, 'Extra', 'Fight').explanation, /Attack training available via Player 2's connected chunks/);
  assert.match(get(result, 'Extra', 'Fight').explanation, /Combat training available via Player 2's connected chunks/);
  assert.equal(result.training.Attack.passiveLevel, 1);
});

test('newly valid section connectors update partner routes without changing own sections', () => {
  const { data, state } = duoFixture();
  data.chunks['12851'] = { Sections: { '1': {}, '2': { Object: { Anvil: true, Ore: true } } } };
  data.sections['12851'] = { '1': ['12850'], '2': [] }; state.members[1].sectionOverrides = { '12851-1': true };
  data.challenges.Nonskill = { Bridge: { ConnectsSections: true, Sections: ['12851-1','12851-2'] } };
  const result = createTaskEngine(data).evaluate(state, 'player1');
  assert.ok(result.access.sections.includes('12851-2')); assert.equal(get(result, 'Extra', 'Own').status, 'available');
  assert.equal(result.obligationAccess.sections.length, 0); assert.ok(!result.obligationAccess.objects.includes('Ore'));
  data.challenges.Nonskill.Bridge.Tasks = { Missing: 'Quest' };
  const blocked = createTaskEngine(data).evaluate(state, 'player1');
  assert.ok(!blocked.access.sections.includes('12851-2')); assert.equal(get(blocked, 'Extra', 'Own').status, 'blocked');
});

test('own ranged gear can use connected partner ammunition without an ammunition obligation', () => {
  const { data, state } = duoFixture();
  data.chunks['12850'].Spawn.Bow = 1; data.shopItems.Wares.Arrow = true;
  data.equipment.Bow = { slot: '2h weapon', class: 'ranged', tier: 1, ability_damage: 10, accuracy: 20, speed: 4, requirements: {} };
  data.equipment.Arrow = { slot: 'ammo', class: 'ranged', tier: 1, ability_damage: 10, requirements: {} };
  data.codeItems.ammoTools = { Arrow: { Bow: true } };
  const result = createTaskEngine(data).evaluate(state, 'player1'), gear = evaluateEquipment(result, state, 'player1', data);
  assert.equal(gear.loadouts.find(row => row.style === 'Ranged').best.ammunition, 'Arrow');
  assert.ok(gear.tasks.some(row => row.equipmentName === 'Bow')); assert.ok(!gear.catalogue.some(row => row.equipmentName === 'Arrow'));
  assert.ok(!gear.recommendations.some(row => row.equipment.name === 'Arrow'));
});

test('generated own BiS goals explain personal equip levels supported by partner training', () => {
  const { data, state } = duoFixture(); data.equipment['Own sword'].requirements = { Smithing: 50 };
  const result = createTaskEngine(data).evaluate(state, 'player1'), gear = evaluateEquipment(result, state, 'player1', data);
  assert.match(gear.tasks.find(row => row.equipmentName === 'Own sword').explanation, /Smithing training available via Player 2's connected chunks/);
});

test('blocked own production preserves item-goal lineage without manufacturing capability', () => {
  const { data, state } = duoFixture(); data.chunks['12850'].Spawn['Synthetic seed'] = 1;
  data.challenges.Crafting = { Recipe: { Items: ['Synthetic seed'], Skills: { Crafting: 50 }, Output: 'Product' } };
  data.challenges.Extra.UseProduct = { Items: ['Product'], Source: 'task', AllowedSources: ['Recipe'] };
  data.challenges.Extra.WrongSource = { Items: ['Product'], Source: 'shop' };
  const result = createTaskEngine(data).evaluate(state, 'player1'), downstream = get(result, 'Extra', 'UseProduct');
  assert.equal(downstream.obligation, true); assert.equal(downstream.status, 'blocked'); assert.match(downstream.explanation, /Items: Product/);
  assert.ok(!downstream.hidden); assert.ok(!result.items.some(row => row.name === 'Product'));
  assert.equal(get(result, 'Extra', 'WrongSource').obligation, false);
});

test('voluntary partner activities may supply potential personal rewards without becoming obligations', () => {
  const { data, state } = duoFixture();
  data.challenges.Quest = { Optional: { Chunks: ['12851'], QuestPoints: 1 } }; data.challenges.Extra.RewardGate = { Chunks: ['12850'], QuestPointsNeeded: 1 };
  const result = createTaskEngine(data).evaluate(state, 'player1');
  assert.equal(get(result, 'Quest', 'Optional').obligation, false); assert.equal(get(result, 'Extra', 'RewardGate').status, 'available');
  assert.deepEqual(state.members[0].completedTasks, []); assert.equal(get(result, 'Quest', 'Optional').personalCompleted, false);
});
