import test from 'node:test';
import { masterGateFixture } from './fixtures/slayer-master-gates.mjs';
import assert from 'node:assert/strict';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { currentSlayerLevels } from '../app/tasks/slayer-assignments.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';

const state = { members: [{ id: 'a', completedTasks: [], unlocked: ['10001'] }], rules: { 'content.f2p': true } };
const row = (category, rawLabel, record = {}) => ({ id: taskId(category, rawLabel, record), category, rawLabel, label: rawLabel, record, status: 'available', personalCompleted: false, level: 1 });
const observation = level => ({ level: 120, observedLevel: level, observedSource: 'game-plugin' });
function fixture() {
  const quest = row('Quest', '~|The Blood Pact|~ Complete the quest', { QuestPoints: 1, BaseQuest: 'The Blood Pact' });
  const master = row('Slayer', 'Receive an assignment from ~|Jacquelyn|~', { NPCs: ['Jacquelyn'] });
  const assignments = {
    Bats: { Weight: 10, CombatLevel: 15, Tasks: { [quest.rawLabel]: 'Quest' } },
    Birds: { Weight: 10 }, 'Cave bugs': { Weight: 10, Level: 7, CombatLevel: 15 }, 'Cave slimes': { Weight: 10, Level: 17, CombatLevel: 25 },
    Cows: { Weight: 15 }, Frogs: { Weight: 10 }, Ghosts: { Weight: 10, CombatLevel: 20 }, Goblins: { Weight: 15 }, Rats: { Weight: 10 },
    Skeletons: { Weight: 15, CombatLevel: 15, Tasks: { [quest.rawLabel]: 'Quest' } }, Spiders: { Weight: 10 }, Zombies: { Weight: 15, CombatLevel: 9, Tasks: { [quest.rawLabel]: 'Quest' } },
  };
  const targets = { Bats: 'Warped bat', Birds: 'Duck', Frogs: 'Frog', Ghosts: 'Ghost', Goblins: 'Skoblin', Rats: 'Rat', Skeletons: 'Skeleton', Spiders: 'Spider', Zombies: 'Corpse archer' };
  const indoor = new Set(['Warped bat', 'Skoblin', 'Skeleton', 'Corpse archer']);
  const definitions = { chunks: { '10001': { Monster: {}, Connect: { 'Lumbridge Catacombs': true } }, 'Lumbridge Catacombs': { Monster: {}, Connect: { '10001': true } } },
    challenges: { Quest: { [quest.rawLabel]: quest.record } }, slayerMasterTasks: { Jacquelyn: assignments }, codeItems: { slayerTasks: { ...Object.fromEntries(Object.entries(targets).map(([name, target]) => [name, { [target]: true }])), Cows: { Cow: true }, 'Cave bugs': { 'Cave bug': true }, 'Cave slimes': { 'Cave slime': true } } } };
  const result = { tasks: [master, quest], training: { Slayer: { level: 120 }, Combat: { level: 152 } }, access: {
    bases: ['10001'], areas: ['Lumbridge Catacombs'], monsters: Object.values(targets), entranceSources: { 'Lumbridge Catacombs': ['10001'] },
    locations: { 'NPC:Jacquelyn': ['10001'], ...Object.fromEntries(Object.values(targets).map(name => [`Monster:${name}`, [indoor.has(name) ? 'Lumbridge Catacombs' : '10001']])) } } };
  const view = () => buildActivityInfo(result, state, 'a', definitions).slayer.masters[0];
  return { result, definitions, quest, master, view };
}

test('planning pool includes available quests and weights only unlocked assignments', () => {
  const f = fixture(), before = structuredClone(f.result), master = f.view();
  for (const name of ['Bats', 'Skeletons', 'Zombies']) {
    const task = master.tasks.find(task => task.name === name);
    assert.equal(task.planningEligible, true);
    assert.deepEqual(task.afterQuests, ['The Blood Pact']);
  }
  assert.deepEqual(master.warnings.planning.stuckAssignments, ['Cave bugs', 'Cave slimes', 'Cows']);
  assert.equal(master.warnings.planning.poolWeight, 140);
  assert.equal(master.warnings.planning.stuckWeight, 35);
  assert.match(master.warnings.planning.line, /About 1 in 4.*Cave bugs, Cave slimes, Cows/);
  assert.equal(master.warnings.current.line, 'Sync your levels to see your chances right now.');
  assert.deepEqual(f.result, before, 'The display must not mutate engine results');
  f.quest.status = 'blocked';
  assert.equal(f.view().warnings.planning.poolWeight, 100);
  assert.equal(f.view().tasks.find(task => task.name === 'Bats').planningEligible, false);
  f.quest.personalCompleted = true;
  assert.equal(f.view().tasks.find(task => task.name === 'Bats').planningEligible, true);
});

test('current pool uses observed levels, personal quests and target access, not ceilings', () => {
  const f = fixture();
  Object.assign(f.result.training, { Slayer: observation(1), Combat: observation(20) });
  let master = f.view();
  assert.equal(master.warnings.current.poolWeight, 80);
  assert.equal(master.warnings.current.stuckWeight, 30);
  assert.equal(master.warnings.current.unknownWeight, 0);
  assert.equal(master.warnings.current.line, 'Right now: about 1 in 3 (Cows, Goblins: needs The Blood Pact finished).');
  assert.equal(master.tasks.find(task => task.name === 'Goblins').currentStatus, 'stuck');
  f.quest.personalCompleted = true;
  master = f.view();
  assert.equal(master.warnings.current.poolWeight, 120);
  assert.equal(master.tasks.find(task => task.name === 'Goblins').currentStatus, 'doable');
  assert.equal(master.tasks.find(task => task.name === 'Bats').currentUnlocked, true);
  assert.equal(master.warnings.current.stuckWeight, 15);
  f.result.training.Slayer = observation(7);
  assert.equal(f.view().warnings.current.stuckWeight, 25);
});

test('current level provenance and manual Slayer lock never invent Combat or other stats', () => {
  const f = fixture();
  f.result.training.Slayer = { ...observation(7), observedSource: null };
  f.result.playerControls = { slayerLock: { level: 12 } };
  assert.deepEqual(currentSlayerLevels(f.result), { Slayer: 12 });
  assert.match(f.view().warnings.current.line, /Sync your levels/);
  for (const skill of ['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Prayer', 'Magic', 'Necromancy']) f.result.training[skill] = observation(20);
  assert.ok(currentSlayerLevels(f.result).Combat > 1);
  delete f.result.training.Necromancy;
  assert.equal(currentSlayerLevels(f.result).Combat, undefined);
  f.result.training.Slayer = observation(8);
  assert.equal(currentSlayerLevels(f.result).Slayer, 8, 'An observed level takes precedence over an old lock');
});

test('area tasks, source gates, quest-gated sections and transitive entrances need personal completion', () => {
  for (const kind of ['area', 'source', 'section', 'entrance']) {
    const f = fixture();
    Object.assign(f.result.training, { Slayer: observation(1), Combat: observation(20) });
    const quest = row('Quest', '~|Gate quest|~ Complete the quest', { QuestPoints: 1, BaseQuest: 'Gate quest' });
    f.result.tasks.push(quest);
    f.definitions.challenges.Quest[quest.rawLabel] = quest.record;
    const needs = { [quest.rawLabel]: 'Quest' };
    if (kind === 'source') f.definitions.taskUnlocks = { Monsters: { Duck: { '10001': needs } } };
    else if (kind === 'section') {
      f.definitions.questSections = { '10001': [quest.rawLabel] };
      // Keep the master outside the gated chunk: this case checks the target.
      f.result.access.bases.push('10002'); f.definitions.chunks['10002'] = {};
      f.result.access.locations['NPC:Jacquelyn'] = ['10002'];
    }
    else {
      f.result.access.areas.push('Cave');
      f.definitions.chunks.Cave = { Connect: { '10001': kind === 'entrance' ? { Tasks: needs } : true } };
      f.result.access.entranceSources.Cave = ['10001'];
      f.result.access.locations['Monster:Duck'] = ['Cave'];
      if (kind === 'area') f.definitions.challenges.Nonskill = { Cave: { UnlocksArea: true, Tasks: needs } };
      if (kind === 'entrance') f.definitions.chunks['10001'].Connect.Cave = true;
    }
    const duck = () => f.view().tasks.find(task => task.name === 'Birds');
    assert.equal(duck().currentStatus, 'stuck', kind);
    assert.deepEqual(duck().currentQuests, ['Gate quest'], kind);
    quest.personalCompleted = true;
    assert.equal(duck().currentStatus, 'doable', kind);
  }
});

test('missing, cyclic and unsupported route proofs have separate unknown weight; outdoor alternatives still work', () => {
  const f = fixture();
  Object.assign(f.result.training, { Slayer: observation(1), Combat: observation(20) });
  delete f.result.access.locations['Monster:Duck'];
  let warning = f.view().warnings.current;
  assert.equal(warning.unknownWeight, 10);
  assert.deepEqual(warning.unknownAssignments, ['Birds']);
  assert.equal(warning.stuckWeight, 30);
  assert.match(warning.line, /Can't tell for Birds/);
  f.definitions.chunks.Loop = { Connect: { Loop: true } };
  f.result.access.areas.push('Loop'); f.result.access.entranceSources.Loop = ['Loop'];
  f.result.access.locations['Monster:Duck'] = ['Loop'];
  assert.equal(f.view().tasks.find(task => task.name === 'Birds').currentStatus, 'unknown');
  f.definitions.chunks.Loop.Connect = { '10001': { Items: ['Rope'] } };
  f.result.access.entranceSources.Loop = ['10001'];
  assert.equal(f.view().tasks.find(task => task.name === 'Birds').currentStatus, 'unknown');
  f.result.access.locations['Monster:Duck'].push('10001');
  assert.equal(f.view().tasks.find(task => task.name === 'Birds').currentStatus, 'doable');
});

test('whole personal quest completion satisfies an earlier step in an area gate', () => {
  const f = fixture();
  Object.assign(f.result.training, { Slayer: observation(1), Combat: observation(20) });
  const step = row('Quest', '~|The Blood Pact|~ 1', { BaseQuest: 'The Blood Pact' });
  f.result.tasks.push(step);
  f.definitions.challenges.Quest[step.rawLabel] = step.record;
  f.definitions.challenges.Nonskill = { 'Lumbridge Catacombs': { UnlocksArea: true, Tasks: { [step.rawLabel]: 'Quest' } } };
  assert.equal(f.view().tasks.find(task => task.name === 'Goblins').currentStatus, 'stuck');
  f.quest.personalCompleted = true;
  assert.equal(f.view().tasks.find(task => task.name === 'Goblins').currentStatus, 'doable');
});

test('weights fail closed when missing or all zero; zero risk and unreachable/Reaper masters have no stuck line', () => {
  const f = fixture();
  delete f.definitions.slayerMasterTasks.Jacquelyn.Cows.Weight;
  assert.equal(f.view().warnings.planning.poolWeight, null);
  assert.match(f.view().warnings.planning.line, /weights are unknown.*Cows/);
  assert.doesNotMatch(f.view().warnings.planning.line, /1 in/);
  for (const data of Object.values(f.definitions.slayerMasterTasks.Jacquelyn)) data.Weight = 0;
  assert.match(f.view().warnings.planning.line, /weights are unknown/);
  f.definitions.slayerMasterTasks.Jacquelyn = { Birds: { Weight: 10 } };
  assert.equal(f.view().warnings.planning.line, null);
  Object.assign(f.result.training, { Slayer: observation(1), Combat: observation(20) });
  assert.equal(f.view().warnings.current.line, null);
  f.master.status = 'blocked';
  assert.equal(f.view().warnings, null);
  f.master.status = 'available'; f.master.rawLabel = 'Receive a Reaper assignment';
  f.definitions.slayerMasterTasks = { Death: { Birds: { Weight: 10 } } };
  assert.equal(buildActivityInfo(f.result, state, 'a', f.definitions).slayer.masters[0].warnings, null);
});

test('changing assignment display tables leaves engine planning task results unchanged', () => {
  const definitions = { chunks: { '10001': { NPC: { Jacquelyn: 1 }, Monster: { Duck: 1 } } }, challenges: { Slayer: { 'Receive an assignment from ~|Jacquelyn|~': { Primary: true, NPCs: ['Jacquelyn'] } } } };
  const before = createTaskEngine(definitions).evaluate(state, 'a');
  definitions.slayerMasterTasks = fixture().definitions.slayerMasterTasks;
  const after = createTaskEngine(definitions).evaluate(state, 'a');
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.training, before.training);
  assert.deepEqual(after.presentation?.tasks, before.presentation?.tasks);
});


test('current master Combat 29/30/31 gates intersect shared assignments without changing planning', () => {
  for (const combat of [29, 30, 31]) {
    const f = masterGateFixture({ combat });
    assert.equal(currentSlayerLevels(f.result, { f2p: false }).Combat, combat);
    const before = structuredClone(f.result), masters = f.view().slayer.masters;
    const higher = masters.find(master => master.name === 'Higher');
    assert.equal(higher.reachable, true);
    assert.equal(higher.warnings.planning.poolWeight, 10);
    assert.equal(higher.currentAccess.status, combat < 30 ? 'unavailable' : 'available');
    assert.equal(higher.tasks[0].currentUnlocked, combat >= 30);
    assert.equal(higher.warnings.current.poolWeight ?? null, combat < 30 ? null : 10);
    assert.equal(masters.filter(master => master.tasks[0].currentUnlocked && master.tasks[0].currentStatus === 'doable').length, combat < 30 ? 1 : 2);
    if (combat < 30) assert.match(higher.warnings.current.line, /unavailable.*Combat 30/);
    assert.deepEqual(f.result, before);
  }
});

test('master-only Slayer and personal quest gates do not borrow planning or another player completion', () => {
  const low = masterGateFixture({ combat: 30, slayer: 9 });
  const higher = f => f.view().slayer.masters.find(master => master.name === 'Higher');
  assert.equal(higher(low).currentAccess.status, 'unavailable');
  assert.equal(higher(low).tasks[0].currentUnlocked, false);
  assert.match(higher(low).warnings.current.line, /Slayer 10/);
  const f = masterGateFixture({ combat: 30, quest: true });
  const quest = f.result.tasks.find(task => task.category === 'Quest');
  assert.equal(quest.status, 'available');
  assert.equal(higher(f).reachable, false, 'The engine already blocks the pending master quest');
  assert.equal(higher(f).tasks[0].currentUnlocked, false);
  // Also exercise a projected planning-available method: current access must
  // independently require personal completion rather than trust that status.
  f.result.tasks.find(task => task.rawLabel === f.higher).status = 'available';
  quest.challengeSatisfied = true;
  assert.equal(higher(f).reachable, true);
  assert.equal(higher(f).tasks[0].planningEligible, true);
  assert.equal(higher(f).currentAccess.status, 'unavailable');
  assert.match(higher(f).warnings.current.line, /Complete Example gate yourself/);
  quest.personalCompleted = true;
  assert.equal(higher(f).currentAccess.status, 'available');
  assert.equal(higher(f).warnings.current.poolWeight, 10);
  assert.equal(higher(f).tasks[0].currentStatus, 'doable');
});

test('missing observations and unresolved master prerequisites supply no current denominator', () => {
  const f = masterGateFixture({ combat: 30 });
  const higher = () => f.view().slayer.masters.find(master => master.name === 'Higher');
  delete f.result.training.Constitution.observedLevel;
  assert.equal(higher().currentAccess.status, 'unknown');
  assert.equal(higher().tasks[0].currentUnlocked, false);
  assert.equal(higher().warnings.current.poolWeight, undefined);
  assert.match(higher().warnings.current.line, /Sync your levels/);
  f.result.training.Constitution = observation(28);
  delete f.result.training.Slayer.observedLevel;
  assert.equal(higher().currentAccess.status, 'unknown');
  assert.equal(higher().tasks[0].currentUnlocked, false);
  assert.match(higher().warnings.current.line, /Sync your levels/);
  f.result.training.Slayer = observation(10);
  const method = f.result.tasks.find(task => task.rawLabel === f.higher);
  method.record.Tasks = { 'Unresolved gate': 'Quest' };
  assert.equal(higher().currentAccess.status, 'unknown');
  assert.equal(higher().tasks[0].currentUnlocked, false);
  assert.match(higher().warnings.current.line, /availability is unknown/);
  assert.equal(higher().warnings.current.poolWeight, undefined);
});

test("a quest gate on the master's own location blocks current access until finished", () => {
  for (const kind of ['area', 'source']) {
    const f = masterGateFixture({ combat: 30 });
    const higher = () => f.view().slayer.masters.find(master => master.name === 'Higher');
    const quest = f.result.tasks.find(task => task.category === 'Quest');
    assert.equal(higher().currentAccess.status, 'available', `${kind}: the open location adds no gate`);
    if (kind === 'area') {
      // Chaeldar's pattern: the master stands in an area unlocked by a quest (Zanaris, Lost City).
      f.definitions.chunks['10001'].Connect = { 'Fixture hideout': true };
      f.definitions.chunks['Fixture hideout'] = { Connect: { '10001': true } };
      f.definitions.challenges.Nonskill = { 'Fixture hideout': { UnlocksArea: true, Tasks: { [f.questLabel]: 'Quest' } } };
      f.result.access.areas = [...(f.result.access.areas ?? []), 'Fixture hideout'];
      f.result.access.entranceSources['Fixture hideout'] = ['10001'];
      f.result.access.locations['NPC:Higher'] = ['Fixture hideout'];
    } else {
      // Duradel's pattern: a quest gate on the NPC source itself.
      f.definitions.taskUnlocks = { NPCs: { Higher: { '10001': [{ [f.questLabel]: 'Quest' }] } } };
    }
    assert.equal(higher().reachable, true, kind);
    assert.equal(higher().currentAccess.status, 'unavailable', kind);
    assert.equal(higher().tasks[0].currentUnlocked, false, kind);
    assert.match(higher().warnings.current.line, /unavailable\. Reaching Higher needs Example gate finished\./, kind);
    quest.personalCompleted = true;
    assert.equal(higher().currentAccess.status, 'available', kind);
    assert.equal(higher().warnings.current.poolWeight, 10, kind);
  }
});