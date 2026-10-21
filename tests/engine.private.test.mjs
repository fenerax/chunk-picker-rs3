import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { retainedTaskCorrections } from '../app/data/retained-task-corrections.mjs';

const state = taskRules => ({ rules: {}, taskRules, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const row = (result, category, name) => result.tasks.find(task => task.id === taskId(category, name));

test('generic constructors keep retained corrections and inferred walking disabled', () => {
  const raw = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const correction = retainedTaskCorrections.corrections[0];
  const record = raw.challenges[correction.category][correction.label];
  const definitions = { chunks: { '100': {} }, challenges: { [correction.category]: { [correction.label]: record } } };
  const before = JSON.stringify(definitions), generic = createTaskEngine(definitions);
  assert.equal(generic.catalogue[0].level, record.Level);
  const corrected = createTaskEngine(definitions, { retainedTaskCorrections: true });
  assert.notEqual(corrected.catalogue[0].level, generic.catalogue[0].level);
  assert.equal(JSON.stringify(definitions), before);
  const chunks = Object.fromEntries(Array.from({ length: 2001 }, (_, index) => [String(index + 1), {}]));
  const world = buildWorld({ chunks, walkableChunks: [], walkableChunksF2P: [] });
  assert.equal(world.cacheWalking, undefined);
  assert.deepEqual(world.mapCorrections, []);
});

test('Secondary Primary permits tagged recipes only after primary supplies and method gates pass', () => {
  const definitions = {
    chunks: { 100: { Monster: { Rat: 1 } } }, drops: { Rat: { Gem: { 1: '1/10000' } } },
    challenges: { Crafting: { Polish: { Level: 1, Primary: true, Category: ['Secondary Primary'], Items: ['Gem*'], Output: 'Polished gem' }, Higher: { Level: 2 } },
      Fletching: { Shape: { Level: 1, Primary: true, Items: ['Polished gem*'] }, Higher: { Level: 2 } } },
  };
  const evaluate = (drop, enabled, tags = ['Secondary Primary'], method = {}) => {
    const fixture = structuredClone(definitions);
    fixture.drops.Rat.Gem[1] = drop; fixture.challenges.Crafting.Polish.Category = tags;
    // This regression exercises secondary training across two processing skills.
    const doc = state({ 'Secondary Primary': enabled, 'Secondary Primary Amount': '16', 'Multi Step Processing': true, ...method }), saved = JSON.stringify(doc);
    const result = createTaskEngine(fixture).evaluate(doc, 'm');
    assert.equal(JSON.stringify(doc), saved);
    return result;
  };
  assert.equal(row(evaluate('1/10000', true), 'Crafting', 'Polish').status, 'available');
  for (const result of [evaluate('1/10000', true), evaluate('1/16', false)]) {
    for (const skill of ['Crafting', 'Fletching']) {
      assert.equal(result.training[skill].primary, false, skill);
      assert.equal(row(result, skill, 'Higher').status, 'blocked', skill);
    }
    assert.equal(row(result, 'Crafting', 'Polish').primaryMethod, false);
    assert(!result.items.some(item => item.name === 'Polished gem' && item.sources.some(source => source.primary)));
  }
  const primary = evaluate('1/16', true);
  assert.equal(row(primary, 'Crafting', 'Polish').primaryMethod, true);
  for (const skill of ['Crafting', 'Fletching']) {
    assert.equal(primary.training[skill].primary, true, skill);
    assert.equal(row(primary, skill, 'Higher').status, 'available', skill);
  }
  for (const tags of [['Secondary Primary', 'Cleaning Herbs Primary'], ['Cleaning Herbs Primary']]) {
    assert.equal(row(evaluate('1/16', true, tags, { 'Cleaning Herbs Primary': false }), 'Crafting', 'Polish').primaryMethod, false);
  }
  assert.equal(row(evaluate('1/10000', true, []), 'Crafting', 'Polish').primaryMethod, false);
});

test('malformed stored rare-drop cutoffs use the default for monster and skill outputs with diagnostics', () => {
  const engine = createTaskEngine({
    chunks: { 100: { Monster: { Rat: 1 } } }, drops: { Rat: { Gem: { 1: '1/100000' }, Common: { 1: '1/999' }, Boundary: { 1: '1/1000' } } },
    challenges: { Crafting: { Search: { Output: 'Cache' } } }, skillItems: { Crafting: { Cache: { Shard: { 1: '1/100000' }, Frequent: { 1: '1/999' } } } },
  });
  for (const ruleId of ['Rare Drop Amount', 'rareDropNum', 'rareDropThreshold']) {
    for (const value of ['banana', null, false, '-16', '2/1', '1/-16', '1/', 'Infinity']) {
      const doc = state({ 'Rare Drop': false, [ruleId]: value }), saved = JSON.stringify(doc);
      const result = engine.evaluate(doc, 'm');
      for (const name of ['Gem', 'Shard', 'Boundary']) assert(!result.items.some(item => item.name === name), `${ruleId}: ${String(value)}: ${name}`);
      for (const name of ['Common', 'Frequent']) assert(result.items.some(item => item.name === name), name);
      assert(result.diagnostics.some(item => item.code === 'invalid-task-rule' && item.ruleId === ruleId));
      assert.equal(JSON.stringify(doc), saved);
    }
  }
});

test('malformed stored primary cutoffs use guaranteed-drop defaults and keep training chains closed', () => {
  const engine = createTaskEngine({ chunks: { 100: { Monster: { Rat: 1 } } }, drops: { Rat: { Gem: { 1: '1/16' } } },
    challenges: { Crafting: { Polish: { Level: 1, Primary: true, Items: ['Gem*'] }, Higher: { Level: 2 } } } });
  for (const ruleId of ['Secondary Primary Amount', 'secondaryPrimaryNum']) {
    const result = engine.evaluate(state({ [ruleId]: 'banana' }), 'm');
    assert.equal(result.training.Crafting.primary, false);
    assert.equal(row(result, 'Crafting', 'Higher').status, 'blocked');
    assert(result.diagnostics.some(item => item.code === 'invalid-task-rule' && item.ruleId === ruleId));
  }
  assert.equal(engine.evaluate(state({ secondaryPrimaryNum: 1 / 16 }), 'm').training.Crafting.primary, false);
  assert.equal(engine.evaluate(state({ secondaryPrimaryNum: '1/16' }), 'm').training.Crafting.primary, true);
});

test('retained Edgeville data excludes member dungeon sources and their false F2P goals without changing reference or player state', () => {
  const definitions = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url), 'utf8'));
  const savedDefinitions = JSON.stringify(definitions);
  const engine = createTaskEngine(definitions, { dataset: selectedDataset });
  const doc = { rules: { 'content.f2p': true, 'access.shared': false }, members: [{ id: 'm', unlocked: ['12342'], sectionOverrides: { '12342-1': true }, completedTasks: [] }] };
  const savedState = JSON.stringify(doc);
  const free = engine.evaluate(doc, 'm');
  assert(free.access.areas.includes('Edgeville Dungeon'));
  assert(free.access.monsters.includes('Hill giant'));
  assert(free.access.monsters.includes('Rat'));
  assert(free.items.some(item => item.name === 'Iron ore'));
  for (const monster of ['Thug', 'Chaos druid', 'Earth warrior', 'Black demon']) {
    assert(!free.access.monsters.includes(monster), monster);
    assert(!free.items.some(item => item.sources.some(source => source.kind === 'drop' && source.source === monster)), `${monster} drops`);
  }
  assert(!free.items.some(item => item.name === 'Steel hatchet'));
  const hatchetGoal = free.tasks.find(task => task.category === 'Extra' && task.label === 'Obtain a steel hatchet');
  assert.equal(hatchetGoal.status, 'blocked');
  assert(free.diagnostics.some(value => value.code === 'members-only-source' && value.source === 'Thug' && value.location === 'Edgeville Dungeon' && value.evidence === 'https://runescape.wiki/w/Thug'));
  assert.equal(JSON.stringify(doc), savedState);
  const memberDoc = structuredClone(doc);
  memberDoc.rules['content.f2p'] = false;
  const paid = engine.evaluate(memberDoc, 'm');
  assert(paid.access.monsters.includes('Thug'));
  assert(paid.items.find(item => item.name === 'Steel hatchet').sources.some(source => source.source === 'Thug' && source.location === 'Edgeville Dungeon'));
  assert.equal(paid.tasks.find(task => task.id === hatchetGoal.id).status, 'available');
  assert.equal(JSON.stringify(doc), savedState);
  assert.equal(JSON.stringify(definitions), savedDefinitions);
});

test('zero secondary-primary amount admits rare ingredients as primary training sources', () => {
  const engine = createTaskEngine({
    chunks: { 100: { Monster: { Rat: 1 } } },
    drops: { Rat: { Gem: { 1: '1/100000' } } },
    challenges: { Crafting: { Polish: { Level: 1, Primary: true, Items: ['Gem*'] }, Higher: { Level: 2 } } },
  });
  for (const rules of [{ 'Secondary Primary Amount': '0' }, { 'Secondary Primary Amount': 0 }, { secondaryPrimaryNum: '1/0' }]) {
    const result = engine.evaluate(state(rules), 'm');
    assert.equal(result.training.Crafting.primary, true);
    assert.equal(row(result, 'Crafting', 'Higher').status, 'available');
  }
  const limited = engine.evaluate(state({ 'Secondary Primary Amount': '1000' }), 'm');
  assert.equal(limited.training.Crafting.primary, false);
  assert.equal(row(limited, 'Crafting', 'Higher').status, 'blocked');
});

test('clearing migrated member flags restores automatic rules without reviving legacy flags or discarding saved levels', () => {
  const engine = createTaskEngine({
    chunks: { 100: { Monster: { Boss: 1 } } },
    codeItems: { bossMonsters: { Boss: true } },
    drops: { Boss: { Gem: { 1: 'Always' } } },
    challenges: { Extra: { Use: { Items: ['Gem'] } }, Crafting: { Saved: { Level: 5 }, AboveCap: { Level: 11 } } },
  });
  const doc = state({});
  doc.members[0].sourceMapId = 'old';
  doc.members[0].taskRules = { Boss: false };
  doc.legacy = { maps: { old: { rules: { Boss: false }, chunkinfo: { passiveSkill: { Crafting: 5 }, maxSkill: { Crafting: 10 } } } } };
  assert.equal(row(engine.evaluate(doc, 'm'), 'Extra', 'Use').status, 'blocked');
  delete doc.members[0].taskRules.Boss;
  assert.equal(row(engine.evaluate(doc, 'm'), 'Extra', 'Use').status, 'blocked'); // unconverted legacy retains authority.
  doc.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'other', sourceMapId: 'old' }] };
  assert.equal(row(engine.evaluate(doc, 'm'), 'Extra', 'Use').status, 'blocked'); // migration is scoped to this owner.
  doc.legacy.gameplayMigration.migratedMembers.push({ memberId: 'm', sourceMapId: 'old' });
  const saved = JSON.stringify(doc);
  const automatic = engine.evaluate(doc, 'm');
  assert.equal(row(automatic, 'Extra', 'Use').status, 'available');
  assert.equal(row(automatic, 'Crafting', 'Saved').status, 'available');
  assert.equal(row(automatic, 'Crafting', 'AboveCap').status, 'blocked');
  assert.equal(automatic.training.Crafting.passiveLevel, 5);
  assert.equal(automatic.training.Crafting.cap, 10);
  assert.equal(JSON.stringify(doc), saved);
  doc.members[0].taskRules.Boss = false;
  assert.equal(row(engine.evaluate(doc, 'm'), 'Extra', 'Use').status, 'blocked'); // explicit authored flag still wins.
});

test('personal primary, passive and maximum declarations change planning without borrowing another player controls', () => {
  const engine = createTaskEngine({ chunks: { 100: {} }, challenges: { Crafting: { Five: { Level: 5 }, Ten: { Level: 10 }, Above: { Level: 16 } } } });
  const doc = state({});
  doc.rules['content.f2p'] = false;
  Object.assign(doc.members[0], { sourceMapId: 'old', primaryOverrides: { Crafting: false }, passiveLevels: { Crafting: 5 }, maxLevels: { Crafting: 12 } });
  doc.members.push({ id: 'other', sourceMapId: 'old', unlocked: ['100'], completedTasks: [] });
  doc.legacy = { maps: { old: { manualPrimary: { Crafting: true }, chunkinfo: { passiveSkill: { Crafting: 15 }, maxSkill: { Crafting: 30 } } } } };
  const saved = JSON.stringify(doc);
  let result = engine.evaluate(doc, 'm');
  assert.equal(result.training.Crafting.level, 5);
  assert.equal(result.training.Crafting.primary, false);
  assert.equal(row(result, 'Crafting', 'Ten').status, 'blocked');
  assert.equal(engine.evaluate(doc, 'other').training.Crafting.level, 30);
  assert.equal(JSON.stringify(doc), saved);
  doc.members[0].primaryOverrides.Crafting = true;
  result = engine.evaluate(doc, 'm');
  assert.equal(result.training.Crafting.level, 12);
  assert.equal(row(result, 'Crafting', 'Ten').status, 'available');
  assert.equal(row(result, 'Crafting', 'Above').status, 'blocked');
  const skill = buildActivityInfo(result, doc, 'm').skills.find(skill => skill.skill === 'Crafting');
  assert.equal(skill.manualPrimary, true);
  assert.equal(skill.passiveOverride, 5);
  assert.equal(skill.maxOverride, 12);
  assert.equal(skill.nonPrimaryMethods.length, 2);
});

test('false manual primary suppresses an inherited manual seed while retaining automatic primary methods', () => {
  const engine = createTaskEngine({ chunks: { 100: {} }, challenges: { Crafting: { Method: { Level: 1, Primary: true }, Higher: { Level: 5 } } } });
  const doc = state({});
  Object.assign(doc.members[0], { sourceMapId: 'old', primaryOverrides: { Crafting: false } });
  doc.legacy = { maps: { old: { manualPrimary: { Crafting: true } } } };
  const result = engine.evaluate(doc, 'm');
  assert.equal(result.training.Crafting.manualPrimary, false);
  assert.equal(result.training.Crafting.primary, true);
  assert.equal(row(result, 'Crafting', 'Higher').status, 'available');
  assert.equal(row(result, 'Crafting', 'Method').primaryMethod, true);
});

test('Slayer requires personal quest evidence and gates inaccessible Slayer-level monsters and their drops', () => {
  const quest = 'Complete Gate';
  const definitions = { chunks: { 100: { NPC: { Master: 1 }, Monster: { Beast: 1 } }, 200: { Monster: { Bat: 1 } } },
    slayerMonsters: { Beast: 10 }, drops: { Beast: { Fang: { 1: 'Always' } } }, codeItems: { slayerTasks: { Beasts: { Beast: true }, Bats: { Bat: true } } },
    challenges: { Quest: { [quest]: { QuestPoints: 1 } }, Slayer: { 'Receive a slayer assignment from Master': { Primary: true, Level: 1, NPCs: ['Master'], Tasks: { [quest]: 'Quest' } }, Higher: { Level: 10 } }, Extra: { Use: { Items: ['Fang'] } } } };
  const engine = createTaskEngine(definitions), doc = state({});
  doc.rules['content.f2p'] = false;
  doc.members.push({ id: 'other', unlocked: ['100'], completedTasks: [taskId('Quest', quest)], passiveLevels: { Slayer: 20 } });
  doc.members[0].slayerLock = { level: 5, monster: 'Beasts' };
  let result = engine.evaluate(doc, 'm');
  assert(row(result, 'Slayer', 'Receive a slayer assignment from Master').blockers.some(blocker => blocker.kind === 'personal-completion'));
  assert.equal(result.training.Slayer.primary, false);
  assert(!result.access.monsters.includes('Beast'));
  assert.equal(row(result, 'Extra', 'Use').status, 'blocked');
  assert.equal(engine.evaluate(doc, 'other').access.monsters.includes('Beast'), true);
  doc.members[0].completedTasks.push(taskId('Quest', quest));
  result = engine.evaluate(doc, 'm');
  assert.equal(result.training.Slayer.level, 5);
  assert.equal(row(result, 'Slayer', 'Higher').status, 'blocked');
  assert.deepEqual(result.effectiveSlayerLock, doc.members[0].slayerLock);
  doc.members[0].slayerLock = { level: 5, monster: 'Bats' };
  doc.members[0].unlocked.push('200');
  const saved = JSON.stringify(doc);
  result = engine.evaluate(doc, 'm');
  assert.equal(result.effectiveSlayerLock, null);
  assert.equal(result.slayerLockRelease.kind, 'target');
  assert.equal(row(result, 'Slayer', 'Higher').status, 'available');
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
  assert.equal(JSON.stringify(doc), saved);
  const activity = buildActivityInfo(result, doc, 'm', definitions);
  assert.deepEqual(activity.slayer.lockOptions.monsters, ['Beasts', 'Bats']);
  assert.deepEqual(activity.slayer.declaredLock, { level: 5, monster: 'Bats' });
  assert.equal(activity.slayer.effectiveLock, null);
});

test('a reachable non-assignment primary Slayer method releases an effective lock without editing its declaration', () => {
  const engine = createTaskEngine({ chunks: { 100: { NPC: { Contractor: 1 } } }, challenges: { Slayer: { Contract: { Level: 1, Primary: true, NPCs: ['Contractor'] }, Higher: { Level: 10 } } } });
  const doc = state({}); doc.rules['content.f2p'] = false;
  doc.members[0].slayerLock = { level: 5, monster: 'Manually Locked' };
  const saved = JSON.stringify(doc), result = engine.evaluate(doc, 'm');
  assert.equal(result.effectiveSlayerLock, null);
  assert.equal(result.slayerLockRelease.kind, 'primary-method');
  assert.equal(row(result, 'Slayer', 'Higher').status, 'available');
  assert.equal(JSON.stringify(doc), saved);
});

test('personal Slayer lock level supplies reached-level evidence and boss/manual release respects the maximum ceiling', () => {
  const engine = createTaskEngine({ chunks: { 100: {}, 200: { Monster: { Dragon: 1 } } },
    slayerMonsters: { Dragon: 5 }, codeItems: { reaperTasks: { Dragons: { Dragon: true } } },
    challenges: { Slayer: { AtLock: { Level: 5 }, Above: { Level: 9 } } } });
  const doc = state({}); doc.rules['content.f2p'] = false;
  Object.assign(doc.members[0], { slayerLock: { level: 5, boss: 'Dragons' }, maxLevels: { Slayer: 8 } });
  let result = engine.evaluate(doc, 'm');
  assert.equal(result.training.Slayer.passiveLevel, 5);
  assert.equal(result.training.Slayer.primary, false);
  assert.equal(row(result, 'Slayer', 'AtLock').status, 'available');
  assert.equal(result.training.Slayer.cap, 5);
  doc.members[0].unlocked.push('200');
  result = engine.evaluate(doc, 'm');
  assert.equal(result.effectiveSlayerLock, null);
  assert.equal(result.slayerLockRelease.assignment, 'Dragons');
  assert.equal(result.training.Slayer.passiveLevel, 5);
  assert.equal(result.training.Slayer.cap, 8);
  doc.members[0].unlocked = ['100'];
  doc.members[0].primaryOverrides = { Slayer: true };
  result = engine.evaluate(doc, 'm');
  assert.equal(result.slayerLockRelease.kind, 'manual-primary');
  assert.equal(result.training.Slayer.level, 8);
  assert.equal(row(result, 'Slayer', 'Above').status, 'blocked');
});

test('Slayer monster eligibility uses a reachable boost and retains disabled, absent, backlogged and self-dependent boost gates', () => {
  const definitions = { chunks: { 100: { Monster: { Beast: 1 } }, 200: { Spawn: { 'Wild pie': 1 } } },
    slayerMonsters: { Beast: 10 }, drops: { Beast: { Fang: { 1: 'Always' } } },
    codeItems: { boostItems: { Slayer: { 'Wild pie': 5 } } }, challenges: { Extra: { Use: { Items: ['Fang'] } } } };
  const engine = createTaskEngine(definitions), doc = state({ Boosting: true });
  doc.rules['content.f2p'] = false;
  doc.members[0].passiveLevels = { Slayer: 5 };
  assert(!engine.evaluate(doc, 'm').access.monsters.includes('Beast')); // metadata alone supplies no boost.
  doc.members[0].unlocked.push('200');
  const saved = JSON.stringify(doc);
  const boosted = engine.evaluate(doc, 'm');
  assert(boosted.access.monsters.includes('Beast'));
  assert.equal(row(boosted, 'Extra', 'Use').status, 'available');
  assert.equal(boosted.training.Slayer.level, 5); // temporary access never becomes a permanent level.
  assert.equal(JSON.stringify(doc), saved);
  doc.taskRules.Boosting = false;
  assert(!engine.evaluate(doc, 'm').access.monsters.includes('Beast'));
  doc.taskRules.Boosting = true;
  doc.members[0].sourceBacklogs = { items: { 'Wild pie': true } };
  assert(!engine.evaluate(doc, 'm').access.monsters.includes('Beast'));
  delete doc.members[0].sourceBacklogs;
  doc.members[0].maxLevels = { Slayer: 9 };
  assert(!engine.evaluate(doc, 'm').access.monsters.includes('Beast')); // declared maximum remains a hard ceiling.
  delete doc.members[0].maxLevels;
  const circular = createTaskEngine({ ...definitions, chunks: { 100: { Monster: { Beast: 1 } } }, drops: { Beast: { 'Wild pie': { 1: 'Always' }, Fang: { 1: 'Always' } } } });
  assert(!circular.evaluate(doc, 'm').access.monsters.includes('Beast')); // its own gated drop cannot unlock its kill.
});

test('a legitimately produced Slayer boost opens monster access on the next engine pass without releasing a lock', () => {
  const engine = createTaskEngine({ chunks: { 100: { Object: { Oven: 1 }, Monster: { Beast: 1 } } },
    slayerMonsters: { Beast: 10 }, drops: { Beast: { Fang: { 1: 'Always' } } }, codeItems: { boostItems: { Slayer: { 'Wild pie': 5 } } },
    challenges: { Cooking: { Bake: { Level: 1, Objects: ['Oven'], Output: 'Wild pie' } }, Extra: { Use: { Items: ['Fang'] } } } });
  const doc = state({ Boosting: true }); doc.rules['content.f2p'] = false;
  doc.members[0].slayerLock = { level: 5, monster: 'Manually Locked' };
  const result = engine.evaluate(doc, 'm');
  assert(result.access.monsters.includes('Beast'));
  assert.equal(row(result, 'Extra', 'Use').status, 'available');
  assert.deepEqual(result.effectiveSlayerLock, doc.members[0].slayerLock);
  assert.equal(result.training.Slayer.level, 5);
});
