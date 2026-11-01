import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { createCollectionEngine } from '../app/tasks/collection.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool } from '../app/core/rules.mjs';
import { createScreenRoll } from '../app/web/screen-roll.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { withActivityTimingTags } from '../app/data/activity-timing.mjs';

const skills = ['Agility', 'Construction', 'Cooking', 'Divination', 'Dungeoneering', 'Fishing',
  'Herblore', 'Hunter', 'Prayer', 'Runecrafting', 'Slayer', 'Thieving'];
const options = { cacheWalking: false, cacheResources: false, cacheArchaeology: false, cacheShops: false,
  metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false,
  skillGuideTasks: false, skillGuideMilestones: false, skillGuideCorrections: false };
const saved = rules => {
  const state = createGroupState([{ id: 'player', name: 'Player', unlocked: ['100'] }]);
  state.rules['content.f2p'] = false;
  state.members[0].taskRules = rules;
  return state;
};
const portDefinitions = () => ({ chunks: { '100': {} }, challenges: Object.fromEntries(skills.map(skill => [skill, {
  [`Train ${skill}`]: { Level: 1, Primary: true },
  [`Port ${skill}`]: { Level: 90, Category: ['PortSkills'], NoBoost: true, Primary: false },
}])) });
const portRows = result => result.tasks.filter(row => row.record.Category?.includes('PortSkills'));

for (const count of [1, 11, 12]) test(`port skills require all twelve trainable skills: ${count} reachable`, () => {
  const definitions = portDefinitions(), state = saved({ PortSkills: true });
  for (const skill of skills.slice(count)) delete definitions.challenges[skill][`Train ${skill}`];
  const result = createTaskEngine(definitions, options).evaluate(state, 'player');
  assert.equal(portRows(result).filter(row => row.status === 'available').length, count === 12 ? 12 : 0);
  const shown = selectPresentedTasks(result, state, 'player', definitions);
  assert.equal(portRows(shown).length, count === 12 ? 12 : 0);
});

test('port skills respect caps, rule off, and personal level evidence without boosts', () => {
  const definitions = portDefinitions(), state = saved({ PortSkills: true, Boosting: true });
  for (const skill of skills) delete definitions.challenges[skill][`Train ${skill}`];
  const engine = createTaskEngine(definitions, options);
  state.members[0].passiveLevels = Object.fromEntries(skills.map(skill => [skill, 90]));
  assert.equal(portRows(engine.evaluate(state, 'player')).filter(row => row.status === 'available').length, 12);
  state.members[0].maxLevels = { Thieving: 89 };
  assert.equal(portRows(engine.evaluate(state, 'player')).filter(row => row.status === 'available').length, 0);
  delete state.members[0].maxLevels;
  state.members[0].passiveLevels.Thieving = 89;
  assert.equal(portRows(engine.evaluate(state, 'player')).filter(row => row.status === 'available').length, 0);
  state.members[0].passiveLevels.Thieving = 90;
  state.members[0].taskRules.PortSkills = false;
  assert.equal(portRows(engine.evaluate(state, 'player')).filter(row => row.status === 'available').length, 0);
  delete state.members[0].taskRules.PortSkills;
  assert.equal(portRows(engine.evaluate(state, 'player')).filter(row => row.status === 'available').length, 12, 'the existing automatic PortSkills value is preserved');
});

const timingDefinitions = () => ({
  chunks: { '100': { Shop: { 'Ports Reward Shop': true, Store: true } } },
  shopItems: { 'Ports Reward Shop': { 'Timed stock': true }, Store: { 'Ordinary stock': true } },
  challenges: { Nonskill: {
    'Timed work': { Category: ['Timegated'], Chunks: ['100'], Output: 'Timed output' },
    'Ordinary work': { Chunks: ['100'], Output: 'Ordinary output' },
    'Needs timed work': { Tasks: { 'Timed work': 'Nonskill' } },
    'Needs timed output': { Items: ['Timed output'] },
    'Needs timed stock': { Items: ['Timed stock'] },
    'Open timed source': { Category: ['Timegated'], Chunks: ['100'] },
  } },
  taskUnlocks: { Monsters: { 'Timed beast': { '100': [{ 'Open timed source': 'Nonskill' }] } } },
  drops: { 'Timed beast': { 'Timed drop': { '1': 'Always' } } },
  equipment: { 'Timed stock': { slot: '2h weapon', class: 'melee', tier: 1, style: 'slash',
    ability_damage: 10, accuracy: 20, speed: 3, requirements: {} } },
});

for (const Timegated of [false, true]) test(`timed tasks, prerequisites, stock and generated collections: ${Timegated}`, () => {
  const definitions = timingDefinitions(), state = saved({ Timegated, 'Show Nonskill Tasks': true, 'Kill X': true, 'Every Drop': true,
    'All Droptables': true, 'All Shops': true });
  const before = structuredClone({ definitions, state });
  const result = createTaskEngine(definitions, options).evaluate(state, 'player');
  const status = name => result.tasks.find(row => row.rawLabel === name).status;
  for (const name of ['Timed work', 'Needs timed work', 'Needs timed output', 'Needs timed stock'])
    assert.equal(status(name), Timegated ? 'available' : 'blocked', name);
  assert.equal(status('Ordinary work'), 'available');
  const active = selectPresentedTasks(result, state, 'player', definitions);
  assert.equal(active.tasks.some(row => row.rawLabel === 'Timed work'), Timegated);
  assert.ok(active.tasks.some(row => row.rawLabel === 'Ordinary work'));
  const generated = createCollectionEngine(definitions).evaluate(state, 'player', result);
  for (const predicate of [row => row.monster === 'Timed beast', row => row.item === 'Timed drop',
    row => row.item === 'Timed stock']) assert.equal(generated.tasks.some(predicate), Timegated);
  assert.ok(generated.tasks.some(row => row.item === 'Ordinary stock'));
  assert.equal(evaluateEquipment(result, state, 'player', definitions).tasks.some(row => row.equipmentName === 'Timed stock'), Timegated);
  assert.deepEqual({ definitions, state }, before, 'overlays and evaluation preserve declarations and save');
});

for (const Timegated of [false, true]) test(`unfinished tasks never lock roll commands or buttons: ${Timegated}`, () => {
  const definitions = timingDefinitions(), state = saved({ Timegated });
  const result = createTaskEngine(definitions, options).evaluate(state, 'player');
  state.tasks = result.tasks.map(({ id, label, category }) => ({ id, label, category }));
  const registry = createRuleRegistry();
  state.rules['roll.neighborMode'] = registry.get('roll.neighborMode').options.find(value => value === 'geometric' || value === 'frontier');
  const world = { chunks: new Map(['100', '101', '102'].map(id => [id, { id }])),
    neighbors: new Map([['100', ['101', '102']]]), walkable: new Set(['100', '101', '102']), f2p: new Set(['100', '101', '102']) };
  assert.equal(evaluateRollPool(world, state, 'player', registry).eligible.length, 2);
  const controls = new Map();
  const context = { member: () => state.members[0], memberId: 'player', statePools: { player: { eligible: [{ id: '101' }, { id: '102' }] } },
    preferences: () => ({}), canWrite: () => true,
    sandbox: { active: false }, rollBusy: false, $: id => {
      if (!controls.has(id)) controls.set(id, { setAttribute() {} });
      return controls.get(id);
    } };
  createScreenRoll(context);
  context.renderRollControls();
  assert.equal(controls.get('pick').disabled, false);
  assert.equal(controls.get('roll-two').disabled, false);
  const rolled = applyCommand(state, { type: 'roll', memberId: 'player', count: 2 }, { world, registry, random: () => 0 });
  assert.equal(rolled.members[0].pendingRoll.length, 2);
  assert.deepEqual(rolled.members[0].completedTasks, []);
});

test('timing overlays add only Timegated to reviewed farm and port progression', () => {
  const cases = [
    ['Extra', 'Unlock the ~|bank chest (player-owned farm)|~', { Category: ['Permanent Unlockables'] }],
    ['Extra', 'Unlock all farmhands at your ~|Player-Owned Farm|~', { Category: 'Permanent Unlockables' }],
    ...['small', 'medium', 'large'].map(size => ['Extra', `Unlock the ability for animals in your ~|Player-Owned Farm|~ to breed in ${size} pens`, {}]),
    ['Farming', 'Build a medium pen in your ~|player-owned farm|~', { Shops: ["Farmers' Market"] }],
    ['Nonskill', 'Obtain ports resources*', { Category: ['DnD'], Chunks: ['Player-Owned Port'] }],
    ['Extra', 'Fixture scroll', { Category: ['Ports Scrolls'], Chunks: ['Player-Owned Port'] }],
  ];
  for (const [category, label, record] of cases) {
    const before = structuredClone(record), tagged = withActivityTimingTags(category, record, label);
    assert.deepEqual(tagged.Category, [...[record.Category ?? []].flat(), 'Timegated']);
    assert.deepEqual(record, before);
    assert.equal(withActivityTimingTags(category, tagged, label), tagged, 'idempotent');
  }
  for (const [category, label, record] of [
    ['Farming', 'Grow a fixture crop', { Category: ['Normal Farming'] }],
    ['Farming', 'Breed a fixture animal', { Category: ['Normal Farming'] }],
    ['Extra', 'Start ~|Player-Owned Port|~ by getting a ports skill to level 90', {}],
    ['Nonskill', 'Player-Owned Port', { UnlocksArea: true }],
    ['Diary', 'Port tutorial', { Chunks: ['Player-Owned Port'], Description: 'Complete the Player Owned Port tutorial.' }],
    ['Agility', 'Port adventurer', { Chunks: ['Player-Owned Port'], Category: ['PortSkills'] }],
  ]) assert.equal(withActivityTimingTags(category, record, label), record, label);
});

test('a tagged task needs Timegated explicitly enabled, and an ordinary row does not', () => {
  const result = createTaskEngine(timingDefinitions(), options).evaluate(saved({}), 'player');
  assert.equal(result.tasks.find(row => row.rawLabel === 'Timed work').status, 'blocked');
  assert.equal(result.tasks.find(row => row.rawLabel === 'Ordinary work').status, 'available');
});


test('the grouped gate preserves each adventurer requirement and stronger individual requirements', () => {
  const definitions = portDefinitions(), state = saved({ PortSkills: true });
  definitions.challenges.Agility['Port Agility'].SkillsNeeded = { agility: 95 };
  state.members[0].primaryOverrides = Object.fromEntries(skills.map(skill => [skill, true]));
  state.members[0].maxLevels = { Agility: 90 };
  const before = structuredClone(definitions);
  const result = createTaskEngine(definitions, options).evaluate(state, 'player');
  assert.equal(portRows(result).filter(row => row.status === 'available').length, 11);
  const agility = portRows(result).find(row => row.category === 'Agility');
  assert.equal(agility.status, 'blocked');
  assert.deepEqual(agility.record.SkillsNeeded, { Agility: 95 });
  for (const row of portRows(result)) {
    assert.equal(row.record.Skills, undefined, 'group readiness must not add other skills to the in-game requirements or estimates');
    assert.equal(row.record.NoBoost, true);
  }
  assert.deepEqual(definitions, before);
});

test('timed reward stock stays obtainable through an ordinary alternative source', () => {
  const definitions = timingDefinitions(), state = saved({ Timegated: false, 'All Shops': true });
  definitions.shopItems.Store['Timed stock'] = true;
  const result = createTaskEngine(definitions, options).evaluate(state, 'player');
  assert.deepEqual(result.items.find(row => row.name === 'Timed stock').sources.map(row => row.source), ['Store']);
  const collections = createCollectionEngine(definitions).evaluate(state, 'player', result);
  assert.ok(collections.tasks.some(row => row.item === 'Timed stock' && row.collectionSource === 'Store'));
  assert.ok(!collections.tasks.some(row => row.item === 'Timed stock' && row.collectionSource === 'Ports Reward Shop'));
  assert.ok(evaluateEquipment(result, state, 'player', definitions).tasks.some(row => row.equipmentName === 'Timed stock'));
});


test('whole breeding-log achievements cannot bypass the timed completion goal', () => {
  const labels = ['~|Completionist achievements#Trimmed Completionist Cape|~ E-I-E-I-O',
    '~|Completionist achievements#Trimmed Completionist Cape|~ E-I-E-DI-NO'];
  const definitions = { chunks: { '100': {} }, challenges: { Diary: Object.fromEntries(labels.map(label =>
    [label, { Category: ['Comp achievements', 'Trim achievements', 'Breeding Log'] }])) } };
  for (const Timegated of [false, true]) {
    const state = saved({ Timegated });
    const result = createTaskEngine(definitions, options).evaluate(state, 'player');
    assert.equal(result.tasks.filter(row => row.status === 'available').length, Timegated ? 2 : 0);
    assert.equal(selectPresentedTasks(result, state, 'player', definitions).tasks.length, Timegated ? 2 : 0);
  }
  const oneBirth = { Category: ['Collection Log', 'Breeding Log'] };
  assert.equal(withActivityTimingTags('Extra', oneBirth, '(Rabbits) Breed a ~|common brown rabbit|~'), oneBirth);
});


test('royal-dragon collection cannot bypass its existing timed achievement', () => {
  const definitions = { chunks: { '100': {} }, challenges: {
    Diary: { 'Existing timed breeding achievement': { Category: ['Timegated'] } },
    Extra: { '(Dragons) Breed a ~|royal dragon|~': { Category: ['Collection Log', 'Breeding Log'] } },
  } };
  for (const Timegated of [false, true]) {
    const state = saved({ Timegated });
    const result = createTaskEngine(definitions, options).evaluate(state, 'player');
    assert.equal(result.tasks.filter(row => row.status === 'available').length, Timegated ? 2 : 0);
    assert.equal(selectPresentedTasks(result, state, 'player', definitions).tasks.length, Timegated ? 2 : 0);
  }
});
