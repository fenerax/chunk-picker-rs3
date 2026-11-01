import { selectedDataset } from '../app/dataset-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId, f2pCap, plainLabel } from '../app/tasks/engine.mjs';
import { buildHouseStorageCatalogue } from '../app/tasks/house-storage.mjs';

const member = (id = 'a', unlocked = ['1']) => ({ id, name: id, unlocked, selected: [], completedTasks: [] });
const state = (members = [member()], rules = {}) => ({ members, rules });
function defs(challenges, additions = {}) {
  return { chunks: { '1': { Object: { Tree: true, Furnace: true, Anvil: true }, NPC: { Tutor: true }, Spawn: { 'Synthetic seed': 1, 'Bronze hatchet': 1 } }, '2': { Object: { Oak: true }, Spawn: { Coal: 1 } } }, challenges, codeItems: {}, sections: {}, walkableChunksF2P: ['1','2'], ...additions };
}
const row = (result, category, name) => result.tasks.find(task => task.id === taskId(category, name));

test('typed IDs retain category and exact raw label while display strips markup', () => {
  const engine = createTaskEngine(defs({ Mining: { 'Use ~|ore|~': {} }, Smithing: { 'Use ~|ore|~': {} } }));
  assert.equal(new Set(engine.catalogue.filter(task => task.kind !== 'house-storage').map(task => task.id)).size, 2);
  assert.equal(plainLabel('Cut ~|Logs#Hard|~*'), 'Cut Logs');
});

test('array requirements are AND; each alias is OR; counted aliases need distinct alternatives', () => {
  const engine = createTaskEngine(defs({ Extra: {
    And: { Items: ['Synthetic seed', 'Coal'] }, Or: { Items: ['Fuel[+]'] }, Count: { Items: ['Fuel[+]x2'] }, Location: { Chunks: ['1','2'] },
  } }, { codeItems: { itemsPlus: { 'Fuel[+]': ['Synthetic seed', 'Coal'] } } }));
  const local = engine.evaluate(state(), 'a');
  assert.equal(row(local, 'Extra', 'And').status, 'blocked');
  assert.equal(row(local, 'Extra', 'Or').status, 'available');
  assert.equal(row(local, 'Extra', 'Count').status, 'blocked');
  assert.equal(row(local, 'Extra', 'Location').status, 'blocked');
  const a = member('a'); a.teleports = [{ id: 'out', destination: '2', available: true }, { id: 'home', destination: '1', available: true }];
  const shared = engine.evaluate(state([a, member('b', ['2'])]), 'a');
  assert.equal(row(shared, 'Extra', 'And').status, 'available');
  assert.equal(row(shared, 'Extra', 'Count').status, 'available');
});

test('primary level-one method unlocks trainability and multi-step outputs without account mutation', () => {
  const data = defs({ Woodcutting: { Logs: { Level: 1, Objects: ['Tree'], Primary: true, Output: 'Logs' }, Oak: { Level: 15, Objects: ['Oak'], Primary: true, Output: 'Oak logs' } }, Firemaking: { Burn: { Level: 1, Items: ['Logs'], Primary: true }, BurnOak: { Level: 15, Items: ['Oak logs'], Primary: true } } });
  const before = state([member('a', ['1','2'])]); const saved = JSON.stringify(before);
  const result = createTaskEngine(data).evaluate(before, 'a');
  assert.equal(row(result, 'Firemaking', 'BurnOak').status, 'available');
  assert.equal(result.training.Woodcutting.primary, true);
  assert.equal(JSON.stringify(before), saved);
  assert.equal(result.items.find(item => item.name === 'Oak logs').sources[0].kind, 'task');
});

test('unseeded task/output and task-dependency cycles remain blocked', () => {
  const result = createTaskEngine(defs({ Crafting: { A: { Items: ['B'], Output: 'A' }, B: { Items: ['A'], Output: 'B' } }, Quest: { A: { Tasks: { B: 'Quest' } }, B: { Tasks: { A: 'Quest' } } } })).evaluate(state(), 'a');
  assert.ok(result.tasks.every(task => task.status === 'blocked'));
  assert.ok(result.tasks.every(task => task.blockers.length));
  assert.ok(result.metrics.passes <= 2);
});

test('F2P has 20-level trial skills, 5-level other members skills, and activity gates remain separate', () => {
  assert.equal(f2pCap('Necromancy'), 20); assert.equal(f2pCap('Construction'), 20); assert.equal(f2pCap('Archaeology'), 20); assert.equal(f2pCap('Herblore'), 5); assert.equal(f2pCap('Fletching'), 110); assert.equal(f2pCap('Combat'), 152);
  const result = createTaskEngine(defs({ Necromancy: { Tutorial: { Level: 1, Primary: true }, Twenty: { Level: 20 }, TwentyOne: { Level: 21 }, Members: { Level: 1, 'Not F2P': true } }, Archaeology: { Seed: { Level: 1, Primary: true }, Twenty: { Level: 20 } }, Extra: { Trial: { Skills: { Construction: 20 } }, Higher: { Skills: { Construction: 21 } } } })).evaluate(state(), 'a');
  assert.equal(row(result, 'Necromancy', 'Twenty').status, 'available');
  assert.equal(row(result, 'Necromancy', 'TwentyOne').status, 'blocked');
  assert.equal(row(result, 'Necromancy', 'Members').status, 'blocked');
  assert.equal(row(result, 'Archaeology', 'Twenty').status, 'available');
  assert.ok(row(result, 'Extra', 'Higher').blockers.some(blocker => blocker.kind === 'membership'));
});

test('authored source unblocking survives legacy backlogs for produced items and objects', () => {
  const data = defs({ Construction: { Build: { Output: 'Plank', 'Output Object': 'Workbench' } }, Extra: { Use: { Items: ['Plank'], Objects: ['Workbench'] } } });
  const doc = state([{ ...member(), sourceMapId: 'old', sourceBacklogs: { items: { Plank: false }, objects: { Workbench: false } } }]);
  doc.legacy = { maps: { old: { chunkinfo: { backloggedSources: { items: { Plank: true }, objects: { Workbench: true } } } } }, gameplayMigration: { schemaVersion: 2, migratedMembers: [{ memberId: 'a', sourceMapId: 'old' }] } };
  const engine = createTaskEngine(data);
  assert.equal(row(engine.evaluate(doc, 'a'), 'Extra', 'Use').status, 'available');
  doc.members[0].sourceBacklogs.items.Plank = true;
  doc.members[0].sourceBacklogs.objects.Workbench = true;
  const masked = engine.evaluate(doc, 'a');
  assert.equal(row(masked, 'Extra', 'Use').status, 'blocked');
  assert.equal(masked.items.some(item => item.name === 'Plank'), false);
  assert.equal(masked.access.objects.includes('Workbench'), false);
});

test('combat is a progression aggregate rather than a members trial skill', () => {
  const data = defs({ Combat: { Enter: { Level: 60 } }, Nonskill: { Retreat: { Tasks: { Enter: 'Combat' }, UnlocksArea: true } }, Extra: { Plans: { Items: ['Plans'] } } }, {
    chunks: { '1': { Monster: { Goblin: true }, Connect: { Retreat: true } }, Retreat: { Connect: { '1': true }, Shop: { Wares: true } } },
    shopItems: { Wares: { Plans: true } },
  });
  const result = createTaskEngine(data).evaluate(state(), 'a');
  assert.equal(row(result, 'Combat', 'Enter').status, 'available');
  assert.equal(row(result, 'Extra', 'Plans').status, 'available');
  assert.equal(result.training.Combat.cap, 152);
  assert.equal(result.access.areas.includes('Retreat'), true);
});

test('a manually blocked interior cannot become an available area-unlock task', () => {
  const data = defs({ Nonskill: { Cave: { UnlocksArea: true } } }, { chunks: { '1': { Connect: { Cave: true } }, Cave: { Connect: { '1': true } } } });
  const a = member(); a.areaOverrides = { Cave: false };
  const engine = createTaskEngine(data), blocked = row(engine.evaluate(state([a]), 'a'), 'Nonskill', 'Cave');
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.explanation, /manually blocked/);
  a.areaOverrides.Cave = true;
  assert.equal(row(engine.evaluate(state([a]), 'a'), 'Nonskill', 'Cave').status, 'available');
});

test('unknown metadata and unknown aliases fail closed', () => {
  const result = createTaskEngine(defs({ Extra: { Unknown: { BespokeGate: true }, Missing: { Items: ['Unlisted[+]'] } } })).evaluate(state(), 'a');
  assert.ok(result.tasks.every(task => task.status === 'unsupported'));
  assert.match(row(result, 'Extra', 'Unknown').explanation, /BespokeGate/);
});

test('personal completion can seed personal skill levels; duo checkmarks cannot', () => {
  const engine = createTaskEngine(defs({ Crafting: { Past: { Level: 15, Items: ['Missing'] }, Method: { Level: 15, Primary: true }, Task: { Level: 20 } } }));
  const a = member(), b = member('b', []); b.completedTasks = [taskId('Crafting', 'Past')];
  const shared = engine.evaluate(state([a,b]), 'a');
  assert.equal(row(shared, 'Crafting', 'Past').challengeSatisfied, true);
  assert.equal(row(shared, 'Crafting', 'Past').personalCompleted, false);
  assert.equal(row(shared, 'Crafting', 'Task').status, 'blocked');
  a.taskStatus = { [taskId('Crafting', 'Past')]: { challengeCompleted: true } };
  assert.equal(row(engine.evaluate(state([a,b]), 'a'), 'Crafting', 'Task').status, 'blocked');
  a.completedTasks = [taskId('Crafting', 'Past')];
  assert.equal(row(engine.evaluate(state([a,b]), 'a'), 'Crafting', 'Task').status, 'available');
});

test('quest chain completion supplies possible XP without becoming personal quest completion', () => {
  const engine = createTaskEngine(defs({ Quest: { Start: { Chunks: ['1'] }, End: { Tasks: { Start: 'Quest' }, QuestPoints: 1, XpReward: { Crafting: 1000 }, BaseQuest: 'Test' } }, Crafting: { Method: { Level: 5, Primary: true }, Higher: { Level: 25 } } }));
  const result = engine.evaluate(state(), 'a');
  assert.equal(result.points.QuestPointsNeeded, 1);
  assert.equal(row(result, 'Crafting', 'Higher').status, 'available');
  assert.equal(row(result, 'Quest', 'End').personalCompleted, false);
});

test('skill output tables produce actual loot and not aggregate pseudo-items', () => {
  const result = createTaskEngine(defs({ Thieving: { Pickpocket: { Level: 1, Primary: true, NPCs: ['Tutor'], Output: 'CitizenLoot' } }, Extra: { CoinTask: { Items: ['Coins'] } } }, { skillItems: { Thieving: { CitizenLoot: { Coins: { '3': 'Always' } } } } })).evaluate(state(), 'a');
  assert.equal(row(result, 'Extra', 'CoinTask').status, 'available');
  assert.ok(!result.items.some(item => item.name === 'CitizenLoot'));
});

test('disabled presentation categories hide rows without erasing their source eligibility', () => {
  const a = member(); a.taskRules = { Skills: false };
  const result = createTaskEngine(defs({ Woodcutting: { Cut: { Level: 1, Primary: true, Objects: ['Tree'], Output: 'Logs' } }, Extra: { Use: { Items: ['Logs'] } } })).evaluate(state([a]), 'a');
  assert.equal(row(result, 'Woodcutting', 'Cut').hidden, true);
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
});

test('alternative item sources retain valid paths when a quest-gated drop source is blocked', () => {
  const data = defs({ Extra: { Use: { Items: ['Coal'] }, DropOnly: { Items: ['Coal'], Source: 'drop' } } }, { chunks: { '1': { Shop: { General: true }, Monster: { Goblin: true } } }, shopItems: { General: { Coal: true } }, drops: { Goblin: { Coal: { '1': 'Always' } } }, taskUnlocks: { Items: { 'Coal^Goblin': [{ Missing: 'Quest' }] } } });
  const result = createTaskEngine(data).evaluate(state(), 'a');
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
  assert.equal(row(result, 'Extra', 'DropOnly').status, 'blocked');
});

test('literal starred task labels remain exact dependency identities', () => {
  const result = createTaskEngine(defs({ Nonskill: { 'Access*': {} }, Extra: { Use: { Tasks: { 'Access*': 'Nonskill' } } } })).evaluate(state(), 'a');
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
});

test('saved personal levels, maximum ceilings, manual items and assigned quest XP are honored', () => {
  const a = member(); a.sourceMapId = 'm';
  const before = state([a]);
  before.legacy = { maps: { m: { chunkinfo: { passiveSkill: { Crafting: 15 }, maxSkill: { Crafting: 30 }, manualMonsters: { Items: { 'Rune-_-20hatchet': true } }, assignedXpRewards: { Quest: { 'Test-_-20Quest': { Herblore: 1000, None: 9999999 } } } } } } };
  const result = createTaskEngine(defs({ Quest: { 'Test Quest': {} }, Crafting: { Method: { Level: 15, Primary: true }, Reachable: { Level: 30 }, AboveCap: { Level: 31 } }, Extra: { Tool: { Items: ['Rune hatchet'] } }, Herblore: { Task: { Level: 5 } } })).evaluate(before, 'a');
  assert.equal(row(result, 'Crafting', 'Reachable').status, 'available');
  assert.equal(row(result, 'Crafting', 'AboveCap').status, 'blocked');
  assert.equal(row(result, 'Herblore', 'Task').status, 'available');
  assert.equal(row(result, 'Extra', 'Tool').status, 'available');
  assert.equal(result.training.Herblore.level, 5);
});

test('backlogged sources remove primary methods and prevent output objects being restored', () => {
  const a = member(); a.sourceMapId = 'm';
  const before = state([a]); before.legacy = { maps: { m: { chunkinfo: { passiveSkill: { Construction: 3 }, backloggedSources: { objects: { Furnace: true } } } } } };
  const result = createTaskEngine(defs({ Construction: { Planks: { Level: 1, Objects: ['Furnace'], Primary: true, Output: 'Plank' }, OutputObject: { Level: 1, 'Output Object': 'Furnace' }, High: { Level: 20 } } })).evaluate(before, 'a');
  assert.equal(row(result, 'Construction', 'Planks').status, 'blocked');
  assert.equal(row(result, 'Construction', 'High').status, 'blocked');
  assert.equal(result.training.Construction.level, 3);
  assert.ok(!result.access.objects.includes('Furnace'));
});

test('starred secondary inputs and disabled optional primary methods do not unlock training', () => {
  const a = member(); a.taskRules = { 'Primary Spawns': false, 'InsidePOH Primary': false };
  const result = createTaskEngine(defs({ Crafting: { Use: { Level: 1, Items: ['Synthetic seed*'], Primary: true }, High: { Level: 10 } }, Construction: { Optional: { Level: 1, Primary: true, Category: ['InsidePOH Primary'] }, High: { Level: 10 } } })).evaluate(state([a]), 'a');
  assert.equal(row(result, 'Crafting', 'Use').status, 'available');
  assert.equal(row(result, 'Crafting', 'High').status, 'blocked');
  assert.equal(row(result, 'Construction', 'Optional').status, 'available');
  assert.equal(row(result, 'Construction', 'High').status, 'blocked');
});

test('wield crafted items rule preserves acquisition but requires an eligible equipment source', () => {
  const data = defs({ Smithing: { Make: { Level: 1, Items: ['Synthetic seed'], Primary: true, Output: 'Synthetic sword' } }, Attack: { Wield: { Level: 1, Items: ['Synthetic sword'] } } }, { equipment: { 'Synthetic sword': { slot: 'main hand weapon', tier: 1, requirements: {} } } });
  const a = member(); a.taskRules = { 'Wield Crafted Items': false };
  const engine = createTaskEngine(data), result = engine.evaluate(state([a]), 'a');
  assert.ok(result.items.some(item => item.name === 'Synthetic sword'));
  assert.equal(row(result, 'Attack', 'Wield').status, 'blocked');
  assert.ok(!result.equipment.some(item => item.name === 'Synthetic sword'));
  a.taskRules['Wield Crafted Items'] = true;
  assert.equal(row(engine.evaluate(state([a]), 'a'), 'Attack', 'Wield').status, 'available');
});

test('same-label task sources keep their category identity and alternate equipment paths', () => {
  const data = defs({ Crafting: { Obtain: { Output: 'Synthetic sword' } }, Nonskill: { Obtain: { Output: 'Synthetic sword' } }, Attack: { Wield: { Items: ['Synthetic sword'] } } });
  const a = member(); a.taskRules = { 'Wield Crafted Items': false };
  const result = createTaskEngine(data).evaluate(state([a]), 'a');
  const paths = result.items.find(item => item.name === 'Synthetic sword').sources;
  assert.deepEqual(new Set(paths.map(source => source.taskId)), new Set([taskId('Crafting', 'Obtain'), taskId('Nonskill', 'Obtain')]));
  assert.equal(row(result, 'Attack', 'Wield').status, 'available');
});

test('task outputs respect source gates and become usable when their gate later resolves', () => {
  const data = defs({ Nonskill: { Make: { Output: 'Product' }, Gate: { Tasks: { Make: 'Nonskill' } } }, Extra: { Use: { Items: ['Product'] } } }, { taskUnlocks: { Items: { Product: [{ Gate: 'Nonskill' }] } } });
  const result = createTaskEngine(data).evaluate(state(), 'a');
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
  const blocked = createTaskEngine({ ...data, challenges: { ...data.challenges, Nonskill: { ...data.challenges.Nonskill, Gate: { Items: ['Missing'] } } } }).evaluate(state(), 'a');
  assert.equal(row(blocked, 'Extra', 'Use').status, 'blocked');
});

test('a false legacy manual primary value leaves ordinary training methods active', () => {
  const a = member(); a.sourceMapId = 'm';
  const before = state([a]); before.legacy = { maps: { m: { manualPrimary: { Woodcutting: false } } } };
  const result = createTaskEngine(defs({ Woodcutting: { Cut: { Level: 1, Primary: true, Objects: ['Tree'] }, High: { Level: 99 } } })).evaluate(before, 'a');
  assert.equal(result.training.Woodcutting.primary, true);
  assert.equal(row(result, 'Woodcutting', 'High').status, 'available');
});

test('saved manual equipment is an eligible secondary item source even with crafting disabled', () => {
  const a = member(); a.sourceMapId = 'm'; a.taskRules = { 'Wield Crafted Items': false };
  const before = state([a]); before.legacy = { maps: { m: { chunkinfo: { manualEquipment: { 'Splitbark-_-20body': true } } } } };
  const result = createTaskEngine(defs({ Defence: { Wear: { Items: ['Splitbark body'] } } }, { equipment: { 'Splitbark body': { slot: 'torso', tier: 40, requirements: {} } } })).evaluate(before, 'a');
  assert.equal(row(result, 'Defence', 'Wear').status, 'available');
  assert.ok(result.equipment.some(item => item.name === 'Splitbark body'));
});

test('extra task sets select their best reachable priority and explain outclassed goals', () => {
  const result = createTaskEngine(defs({ Extra: { Low: { Items: ['Synthetic seed'], Set: 'Tool', Priority: 10 }, High: { Items: ['Synthetic seed'], Set: 'Tool', Priority: 2 }, Unavailable: { Items: ['Missing'], Set: 'Tool', Priority: 1 } } })).evaluate(state(), 'a');
  assert.equal(row(result, 'Extra', 'High').status, 'available');
  assert.equal(row(result, 'Extra', 'Low').status, 'blocked');
  assert.equal(row(result, 'Extra', 'Low').blockers[0].kind, 'outclassed');
  assert.equal(row(result, 'Extra', 'Unavailable').status, 'blocked');
});

test('full reference compiles uniquely and evaluates synthetic unlocked geography within bounded time', () => {
  const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const engine = createTaskEngine(definitions, { dataset: selectedDataset });
  const colossi = engine.catalogue.filter(task => task.id === 'rs3:task:divination:colossi');
  assert.equal(colossi.length, 1, 'The researched Divination supplement adds exactly one task.');
  assert.equal(colossi[0].level, 77);
  const reviewedTaskIds = ["rs3:task:wiki-malik-waterskin","rs3:task:wiki-karim-kebab","rs3:task:wiki-ned-rope","rs3:task:canifis-citizen-legal-entry","rs3:task:wiki-wild-onion","rs3:task:wiki-wild-potato","rs3:task:wendlewick-fish-deposit-access","rs3:task:canifis-ghoul-barrier-entry","rs3:task:wiki-nardah-banana","rs3:task:jadinko-lair-introduction","rs3:task:runespan-introduction","rs3:task:barbarian-assault-tutorial","rs3:task:prison-break-remaining-pages"];
  for (const id of reviewedTaskIds) assert.equal(engine.catalogue.filter(task => task.id === id).length, 1, id);
  const requirementTasks = engine.catalogue.filter(task => task.id.startsWith('rs3:task:requirements-'));
  assert.equal(requirementTasks.length, 36, 'The 2026-10-31 requirements corrections add 36 prerequisite tasks.');
  const questFixTasks = engine.catalogue.filter(task => task.id.startsWith('rs3:task:qfix1-'));
  assert.equal(questFixTasks.length, 11, 'The 2026-10-31 quest requirement corrections add 11 helper tasks.');
  assert.equal(engine.catalogue.length, 20375 + colossi.length + buildHouseStorageCatalogue().length + reviewedTaskIds.length + requirementTasks.length + questFixTasks.length);
  assert.equal(new Set(engine.catalogue.map(task => task.id)).size, engine.catalogue.length);
  const a = member('a', ['12850','12594','12338','12853','11575']);
  const result = engine.evaluate(state([a]), 'a');
  assert.equal(result.tasks.length, engine.catalogue.length - buildHouseStorageCatalogue().length);
  assert.ok(result.metrics.availableCount > 100);
  assert.ok(result.metrics.elapsedMs < 10000, `Evaluation took ${result.metrics.elapsedMs}ms`);
  assert.ok(result.tasks.filter(task => task.status !== 'available').every(task => task.blockers.length));
  assert.ok(result.tasks.every(task => task.explanation));
});
