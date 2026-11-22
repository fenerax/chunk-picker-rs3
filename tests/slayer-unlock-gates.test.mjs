import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slayerUnlockGates, slayerUnlockGate, slayerHelmetComponents, quickKillMonsters, isSlayerLockShortcutTask, FUTURE_SLAYER_UNLOCKS_RULE as futureRule } from '../app/data/slayer-unlock-gates.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { explainTask } from '../app/tasks/task-provenance.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup } from '../app/core/state.mjs';
import { rulesCatalogue, buildRulesSections, taskRuleValue, ruleEnabled, planTaskRuleChange } from '../app/web/rules-model.mjs';
import { isKeptTaskRule } from '../app/web/kept-rules.mjs';
import { createRuleDescriber, catalogued } from '../app/web/task-why.mjs';
import { taskBlockerGuidance } from '../app/web/screen-task-guidance.mjs';

const names = Object.keys(slayerUnlockGates), helmetNames = names.slice(0, 2), quickName = names[2];
const unchanged = ['Learn how to craft rings of slaying', 'Learn how to fletch broad bolts and arrows'];
const record = extra => ({ Shops: ['Slayer Rewards'], Category: ['Permanent Unlockables'], ...extra });
const fixture = ({ items = [], monsters = [], areas = [], npcs = [], quests = {} } = {}) => ({
  chunks: { 100: { Shop: { 'Slayer Rewards': 1 } }, 200: { Spawn: Object.fromEntries(items.map(name => [name, 1])),
    Monster: Object.fromEntries(monsters.map(name => [name, 1])), NPC: Object.fromEntries(npcs.map(name => [name, 1])),
    Connect: Object.fromEntries(areas.map(name => [name, true])) }, ...Object.fromEntries(areas.map(name => [name, {}])) },
  challenges: { Extra: Object.fromEntries([...names, ...unchanged].map(name => [name, record(helmetNames.includes(name)
    ? { Tasks: { 'Smoking Kills Complete the quest': 'Quest' } } : {})])),
  Quest: { 'Smoking Kills Complete the quest': {}, ...quests } },
});
const state = (unlocked = ['100'], taskRules = {}, other = {}) => ({ rules: { 'content.f2p': false, 'access.shared': false }, taskRules: {},
  members: [{ id: 'a', unlocked, completedTasks: [], taskRules, ...other }] });
const row = (result, name) => result.tasks.find(task => task.id === taskId('Extra', name));
const engineFor = definitions => createTaskEngine(definitions, { cacheWalking: false, retainedTaskCorrections: false });

test('all eleven gates match the shipped task names without altering the records', () => {
  const data = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));
  const entries = Object.entries(data.challenges.Extra).filter(([, r]) => r.Shops?.includes('Slayer Rewards') && r.Category?.includes('Permanent Unlockables'));
  assert.equal(entries.length, 13);
  assert.equal(entries.filter(([name, r]) => slayerUnlockGate('Extra', name, r)).length, 11);
  assert.equal(slayerUnlockGate('Quest', names[0], record()), undefined);
  assert.equal(slayerUnlockGate('Extra', names[0], {}), undefined);
  const monsters = new Set();
  const visit = value => { if (!value || typeof value !== 'object') return; Object.keys(value.Monster ?? {}).forEach(name => monsters.add(name)); Object.values(value).forEach(visit); };
  visit(data.chunks);
  assert.deepEqual(quickKillMonsters.filter(name => !monsters.has(name)), []);
});

test('shop-only rewards stay available while all eleven gated rewards wait', () => {
  const result = engineFor(fixture()).evaluate(state(), 'a');
  for (const name of unchanged) assert.equal(row(result, name).status, 'available', name);
  for (const name of names) assert.equal(row(result, name).status, 'blocked', name);
});

for (const [name, gate] of Object.entries(slayerUnlockGates)) test(`${name} opens only with its own condition`, () => {
  const engine = engineFor(fixture({ [gate.kind]: gate.targets }));
  const closed = engine.evaluate(state(), 'a'), open = engine.evaluate(state(['100', '200']), 'a');
  assert.equal(row(closed, name).status, 'blocked');
  assert.equal(row(open, name).status, 'available');
  assert.equal(row(open, name).slayerUnlockGate.open, true);
  assert.equal(explainTask(row(open, name), { result: open }).slayerUnlockGate.reason, gate.condition);
});

test('both helmet rewards need every part, even with future unlocks on; Smoking Kills is retained', () => {
  for (const missing of slayerHelmetComponents) {
    const result = engineFor(fixture({ items: slayerHelmetComponents.filter(name => name !== missing) }))
      .evaluate(state(['100', '200'], { [futureRule]: true }), 'a');
    for (const name of helmetNames) assert.equal(row(result, name).status, 'blocked', `${name}: ${missing}`);
  }
  const definitions = fixture({ items: slayerHelmetComponents });
  definitions.challenges.Quest['Smoking Kills Complete the quest'] = { Chunks: ['300'] };
  definitions.chunks[300] = {};
  const result = engineFor(definitions).evaluate(state(['100', '200']), 'a');
  for (const name of helmetNames) {
    assert.equal(row(result, name).status, 'blocked');
    assert(row(result, name).blockers.some(blocker => blocker.kind === 'tasks'));
  }
});

test('newly crafted parts are counted inside the closure without depending on the helmet unlock', () => {
  const definitions = fixture({ items: ['Material', ...slayerHelmetComponents.slice(1)] });
  definitions.challenges.Crafting = { 'Make mask': { Items: ['Material'], Output: ['Black mask'] } };
  const result = engineFor(definitions).evaluate(state(['100', '200']), 'a');
  for (const name of helmetNames) assert.equal(row(result, name).status, 'available');
});

test('a charged black mask counts because its charges can be removed', () => {
  const result = engineFor(fixture({ items: ['Black mask (10)', ...slayerHelmetComponents.slice(1)] }))
    .evaluate(state(['100', '200']), 'a');
  for (const name of helmetNames) assert.equal(row(result, name).status, 'available');
});

test('a monster behind the player\'s Slayer gate does not open a reward', () => {
  const definitions = fixture({ monsters: ['Ice strykewyrm', 'Gargoyle'] });
  definitions.slayerMonsters = { 'Ice strykewyrm': 93, Gargoyle: 75 };
  const engine = engineFor(definitions);
  const low = engine.evaluate(state(['100', '200']), 'a');
  assert.equal(row(low, names[3]).status, 'blocked');
  assert.equal(row(low, quickName).status, 'blocked');
  const high = engine.evaluate(state(['100', '200'], {}, { passiveLevels: { Slayer: 93 } }), 'a');
  assert.equal(row(high, names[3]).status, 'available');
  assert.equal(row(high, quickName).status, 'available');
});

test('each finishing-blow monster opens quick kills; unrelated monsters and the toggle cannot', () => {
  for (const monster of quickKillMonsters) {
    const result = engineFor(fixture({ monsters: [monster] })).evaluate(state(['100', '200']), 'a');
    assert.equal(row(result, quickName).status, 'available', monster);
  }
  const result = engineFor(fixture({ monsters: ['Rat'] })).evaluate(state(['100', '200'], { [futureRule]: true }), 'a');
  assert.equal(row(result, quickName).status, 'blocked');
});

test('future unlocks restores shop-only behaviour for exactly eight rewards, for one player', () => {
  const engine = engineFor(fixture()), doc = state(['100'], { [futureRule]: true });
  doc.members.push({ id: 'b', unlocked: ['100'], completedTasks: [], taskRules: {} });
  const on = engine.evaluate(doc, 'a'), off = engine.evaluate(doc, 'b');
  for (const [name, gate] of Object.entries(slayerUnlockGates)) {
    assert.equal(row(on, name).status, gate.future ? 'available' : 'blocked', name);
    assert.equal(row(off, name).status, 'blocked', name);
  }
});

test('one player reaching a target does not open it for the other without shared access', () => {
  const definitions = fixture({ items: slayerHelmetComponents.concat(['Bonecrusher']), monsters: ['Rock slug', 'Ice strykewyrm'], areas: ["Morvran's dungeon", 'Sunken Pyramid'] });
  const engine = engineFor(definitions), doc = state(['100', '200']);
  doc.members.push({ id: 'b', unlocked: ['100'], completedTasks: [] });
  for (const id of ['a', 'b']) {
    const result = engine.evaluate(doc, id);
    for (const [name, gate] of Object.entries(slayerUnlockGates)) if (gate.kind !== 'items' || gate.targets.includes('Bonecrusher') || gate === slayerUnlockGates[names[0]])
      assert.equal(row(result, name).status, id === 'a' ? 'available' : 'blocked', `${id}: ${name}`);
  }
});

test('entrance NPCs need their quest access and the pyramid also needs 99 Slayer', () => {
  const definitions = fixture({ npcs: ['Morvran', 'Portmaster Kags'], quests: {
    "Plague's End Complete the quest": { Chunks: ['300'] }, 'The Jack of Spades 3': { Chunks: ['300'] },
  } });
  definitions.chunks[300] = {};
  const engine = engineFor(definitions), areaNames = names.filter(name => slayerUnlockGates[name].entrance);
  for (const [chunks, level, expected] of [[['100', '200'], 99, [false, false]], [['100', '200', '300'], 98, [true, false]], [['100', '200', '300'], 99, [true, true]]]) {
    const result = engine.evaluate(state(chunks, {}, { passiveLevels: { Slayer: level } }), 'a');
    areaNames.forEach((name, index) => assert.equal(row(result, name).status === 'available', expected[index], `${name}, Slayer ${level}`));
  }
});

test('old saves default off and revision-checked commands preserve a disabled child through backup and undo', async () => {
  let doc = createGroupState([{ id: 'a', name: 'Player A' }, { id: 'b', name: 'Player B' }]);
  doc = importBackup(exportBackup(doc));
  const sections = buildRulesSections(rulesCatalogue, doc), definitions = sections.flatMap(section => section.rules);
  const child = definitions.find(rule => rule.id === futureRule), parent = definitions.find(rule => rule.id === child.parent);
  assert.equal(sections.find(section => section.rules.includes(child)).name, 'Miscellaneous');
  assert.equal(child.difficultyMarker, parent.difficultyMarker);
  assert.equal(child.depth, parent.depth + 1);
  assert.equal(isKeptTaskRule(futureRule), false);
  assert.deepEqual(taskRuleValue(doc, 'a', child), { value: false, source: 'Automatic', explicit: false });
  const save = command => { doc = applyCommand(doc, command, { expectedRevision: doc.revision }); };
  save(planTaskRuleChange(doc, ['a'], child, true).commands[0]);
  save(planTaskRuleChange(doc, ['a'], parent, false).commands[0]);
  const values = () => new Map(definitions.map(rule => [rule.id, taskRuleValue(doc, 'a', rule).value]));
  assert.equal(ruleEnabled(child, values(), definitions), false);
  assert.equal(doc.members[0].taskRules[futureRule], true);
  doc = importBackup(exportBackup(doc));
  save(planTaskRuleChange(doc, ['a'], parent, true).commands[0]);
  assert.equal(ruleEnabled(child, values(), definitions), true);
  save({ type: 'undo' });
  assert.equal(ruleEnabled(child, values(), definitions), false);
  const describe = catalogued(await createRuleDescriber(doc, 'a'));
  assert.equal(describe(futureRule).section, 'Miscellaneous');
  const result = engineFor(fixture()).evaluate({ ...doc, rules: { 'content.f2p': false }, members: doc.members.map(m => ({ ...m, unlocked: ['100'] })) }, 'a');
  assert.equal(row(result, names[3]).slayerUnlockGate.bypassed, false);
});

test('active Slayer lock blocks assignment Slayer points and Slayer Rewards tasks until the lock releases', () => {
  const definitions = {
    chunks: {
      100: { NPC: { Jacquelyn: 1 }, Shop: { 'Slayer Rewards': 1 } },
      200: { Monster: { 'Abyssal demon': 1 } },
      300: { NPC: { 'City Citizen': 1 } },
    },
    codeItems: { slayerTasks: { 'Abyssal demons': { 'Abyssal demon': true } } },
    slayerMonsters: { 'Abyssal demon': 1 },
    taskUnlocks: { Shops: { 'Slayer Rewards': { 100: [{ 'Obtain slayer points': 'Nonskill' }] } } },
    challenges: {
      Slayer: {
        'Receive a slayer assignment from ~|Jacquelyn|~': { Level: 1, Primary: true, NPCs: ['Jacquelyn'], Output: 'Slayer points' },
        'Wear a nose peg': { Level: 60 },
        'Complete a monster-related ~|City Quest|~': { Level: 1, Primary: true, NPCs: ['City Citizen'], Output: 'Slayer points' },
      },
      Nonskill: { 'Obtain slayer points': { Items: ['Slayer points'] } },
      Crafting: { 'Craft a ~|slayer helmet|~': { Level: 55, Items: ['Slayer points'] } },
      Extra: {
        'Learn how to craft rings of slaying': record(),
        'Learn how to fletch broad bolts and arrows': record(),
      },
    },
  };
  const engine = engineFor(definitions);
  const by = (result, cat, label) => result.tasks.find(t => t.id === taskId(cat, label));

  // Without a Slayer lock, assignments supply Slayer points and unlock Slayer Rewards.
  const unlocked = engine.evaluate(state(['100']), 'a');
  assert.equal(by(unlocked, 'Slayer', 'Receive a slayer assignment from ~|Jacquelyn|~').status, 'available');
  assert.equal(by(unlocked, 'Nonskill', 'Obtain slayer points').status, 'available');
  assert.equal(by(unlocked, 'Extra', 'Learn how to craft rings of slaying').status, 'available');
  assert.equal(by(unlocked, 'Extra', 'Learn how to fletch broad bolts and arrows').status, 'available');

  // Active Slayer lock suppresses assignment Slayer points and blocks Slayer Rewards & Slayer-point tasks,
  // while keeping the master assignment row available for Activity Info.
  const locked = engine.evaluate(state(['100'], {}, { slayerLock: { level: 30, monster: 'Abyssal demons' } }), 'a');
  assert.equal(locked.effectiveSlayerLock.level, 30);
  assert.equal(by(locked, 'Slayer', 'Receive a slayer assignment from ~|Jacquelyn|~').status, 'available');
  assert.equal(by(locked, 'Slayer', 'Wear a nose peg').status, 'blocked');
  assert.equal(by(locked, 'Nonskill', 'Obtain slayer points').status, 'blocked');
  assert.equal(by(locked, 'Crafting', 'Craft a ~|slayer helmet|~').status, 'blocked');
  const rings = by(locked, 'Extra', 'Learn how to craft rings of slaying');
  assert.equal(rings.status, 'blocked');
  assert.equal(rings.blockers[0].kind, 'slayer-lock');
  assert.equal(taskBlockerGuidance(rings, locked).slayerLock, true);
  assert.equal(by(locked, 'Extra', 'Learn how to fletch broad bolts and arrows').status, 'blocked');

  // Even when a chunk exposes Slayer Rewards without taskUnlocks (or Obtain slayer points was checked),
  // an active Slayer lock still blocks Slayer Rewards shop tasks when Slayer points cannot be earned.
  // With incremental unlock reuse enabled, releasing a level-120 lock (where caps.Slayer does not change)
  // must still invalidate the memoized slayer-lock blocker when the locked monster becomes reachable.
  const directShopDefinitions = {
    ...fixture({ monsters: ['Abyssal demon'] }),
    codeItems: { slayerTasks: { 'Abyssal demons': { 'Abyssal demon': 1 } } },
  };
  const incrementalEngine = createTaskEngine(directShopDefinitions, { cacheWalking: false, retainedTaskCorrections: false, incrementalUnlocks: true });
  const directShopLocked = incrementalEngine.evaluate(state(['100'], {}, { slayerLock: { level: 120, monster: 'Abyssal demons' } }), 'a');
  assert.equal(row(directShopLocked, 'Learn how to craft rings of slaying').status, 'blocked');
  assert.equal(row(directShopLocked, 'Learn how to craft rings of slaying').blockers[0].kind, 'slayer-lock');
  const directShopReleased = incrementalEngine.evaluate(state(['100', '200'], {}, { slayerLock: { level: 120, monster: 'Abyssal demons' } }), 'a');
  assert.equal(directShopReleased.metrics.unlockCalculation.path, 'incremental');
  assert.equal(directShopReleased.effectiveSlayerLock, null);
  assert.equal(row(directShopReleased, 'Learn how to craft rings of slaying').status, 'available');
  const directShopCold = engineFor(directShopDefinitions).evaluate(state(['100', '200'], {}, { slayerLock: { level: 120, monster: 'Abyssal demons' } }), 'a');
  assert.equal(row(directShopCold, 'Learn how to craft rings of slaying').status, 'available');

  // Rolling a chunk with the locked monster releases the lock and restores Slayer points and Slayer Rewards.
  const releasedByTarget = engine.evaluate(state(['100', '200'], {}, { slayerLock: { level: 30, monster: 'Abyssal demons' } }), 'a');
  assert.equal(releasedByTarget.effectiveSlayerLock, null);
  assert.equal(by(releasedByTarget, 'Nonskill', 'Obtain slayer points').status, 'available');
  assert.equal(by(releasedByTarget, 'Extra', 'Learn how to craft rings of slaying').status, 'available');

  // Reaching a non-assignment primary Slayer method (City Quests) also releases the lock and restores Slayer points.
  const releasedByCityQuest = engine.evaluate(state(['100', '300'], {}, { slayerLock: { level: 30, monster: 'Abyssal demons' } }), 'a');
  assert.equal(releasedByCityQuest.effectiveSlayerLock, null);
  assert.equal(by(releasedByCityQuest, 'Nonskill', 'Obtain slayer points').status, 'available');
  assert.equal(by(releasedByCityQuest, 'Extra', 'Learn how to craft rings of slaying').status, 'available');
});

test('isSlayerLockShortcutTask matches Slayer, Slayer Rewards, and Slayer-level tasks without matching unrelated tasks', () => {
  assert.equal(isSlayerLockShortcutTask({ category: 'Slayer', label: 'Wear a nose peg' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Extra', label: 'Learn how to craft rings of slaying' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Extra', label: 'Learn how to fletch broad bolts and arrows' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Extra', rawLabel: 'Learn how to craft a ~|slayer helmet|~' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Nonskill', label: 'Obtain slayer points' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Crafting', label: 'Craft a slayer helmet' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Combat', label: 'Receive a slayer assignment from Jacquelyn' }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Quest', label: 'Some quest', skillRequirements: { Slayer: 30 } }), true);
  assert.equal(isSlayerLockShortcutTask({ category: 'Woodcutting', label: 'Cut logs' }), false);
  assert.equal(isSlayerLockShortcutTask({ category: 'Extra', label: 'Unlock a music track' }), false);
});
