import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionEngine, collectionRules, collectionRateLabel, selectCollectionGoals } from '../app/tasks/collection.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { stableTaskId, migrateTaskIdentities } from '../app/tasks/migration.mjs';
import { entityId, generatedGoalId, legacyTaskId } from '../app/tasks/identity.mjs';

const extraId = raw => {
  const kill = /^Kill X ~\|(.+)\|~$/.exec(raw);
  if (kill) return generatedGoalId('kill-x', entityId('monster', kill[1]));
  const match = /^(.+): ~\|(.+)\|~(.*)$/.exec(raw), [, source, item, metadata] = match;
  const kind = !metadata ? 'all-shops' : /\) \(/.test(metadata) ? 'all-droptables' : 'every-drop';
  return generatedGoalId(kind, entityId(kind === 'all-shops' ? 'shop' : 'monster', source), entityId('item', item));
};
function definitions() {
  return {
    chunks: {
      '100': { Monster: { Goblin: true, Rat: true, Boss: true, 'Slayer beast': true }, Shop: { Store: true, Other: true }, NPC: { Farmer: true, 'Baby impling': true, Dinosaur: true, Trader: true } },
      '200': { Monster: { Unreachable: true }, Shop: { Remote: true } },
    }, sections: {},
    drops: {
      Goblin: { Bones: { '1': 'Always', '2': '1/2' }, Coins: { '5': '1/10' }, RareDropTable: { '1': '1/10' }, 'Ignored^': { '1': 'Always' } },
      Rat: { Bones: { '1': 'Always' } }, Boss: { Tooth: { '1': 'Always' } },
      'Slayer beast': { Token: { '1': 'Always' } }, Unreachable: { 'Remote drop': { '1': 'Always' } },
    },
    slayerMonsters: { 'Slayer beast': 10 },
    shopItems: { Store: { Hammer: true, Tonic: true, 'False stock': false }, Other: { Hammer: true }, Remote: { 'Remote item': true } },
    objectItems: {}, taskUnlocks: {},
    challenges: {
      Thieving: { 'Pickpocket ~|Farmer|~': { Level: 1, NPCs: ['Farmer'], Output: 'Farmer loot', Primary: true } },
      Hunter: {
        'Catch a ~|baby impling|~': { Level: 1, NPCs: ['Baby impling'], Output: 'Baby impling', Primary: true },
        'Hunt a ~|Dinosaur|~ during Big Game Hunter': { Level: 1, NPCs: ['Dinosaur'], Output: 'Dinosaur loot', Primary: true },
      },
      Nonskill: { '~|Exchange|~': { NPCs: ['Trader'], Source: 'shop', Output: 'Exchange loot' } }, Slayer: {},
    },
    skillItems: {
      Thieving: { 'Farmer loot': { Apple: { '1': 'Always' } } },
      Hunter: { 'Baby impling': { Rope: { '1': 'Always' } }, 'Dinosaur loot': { Meat: { '3': '1/2' } } },
      Nonskill: { 'Exchange loot': { Saw: { '1': 'Always' } } }, Slayer: {},
    },
    codeItems: { dropTables: { RareDropTable: { Gem: '1/2@2 (noted)' } }, bossMonsters: { Boss: true }, boostItems: { Slayer: { Tonic: 3 } } },
  };
}
function state(rules = {}) {
  const current = createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'one' }, { id: 'player2', name: 'Player 2', sourceMapId: 'two' }]);
  current.rules['content.f2p'] = false; current.members[0].unlocked = ['100'];
  current.members[0].taskRules = rules;
  return current;
}
function evaluate(current, defs = definitions(), memberId = 'player1') {
  const collection = createCollectionEngine(defs), result = createTaskEngine(defs).evaluate(current, memberId);
  return { collection, result, generated: collection.evaluate(current, memberId, result) };
}
function labels(output, rule) { return output.tasks.filter(row => row.record.Label === rule).map(row => row.rawLabel); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('Kill X preserves X identity, displays configured count, respects boss, skiller and Slayer gates', () => {
  const current = state({ 'Kill X': true, 'Kill X Amount': '25' });
  const first = evaluate(current).generated;
  assert.deepEqual(labels(first, 'Kill X'), ['Kill X ~|Goblin|~', 'Kill X ~|Rat|~']);
  assert.equal(first.tasks[0].label, 'Kill 25 Goblin'); assert.equal(first.tasks[0].amount, 25);
  current.members[0].taskRules['Kill X Boss'] = true;
  current.legacy = { maps: { one: { chunkinfo: { passiveSkill: { Slayer: 7 } } } } };
  current.members[0].taskRules.Boosting = true;
  const boosted = evaluate(current).generated;
  assert.ok(labels(boosted, 'Kill X').includes('Kill X ~|Boss|~'));
  assert.ok(labels(boosted, 'Kill X').includes('Kill X ~|Slayer beast|~'));
  current.members[0].taskRules.Skiller = true;
  assert.deepEqual(evaluate(current).generated.tasks, []);
  current.members[0].taskRules.Skiller = false; current.members[0].taskRules['Kill X Amount'] = 0;
  assert.deepEqual(evaluate(current).generated.tasks, []);
  assert.ok(evaluate(current).generated.diagnostics.some(row => row.rule === 'Kill X Amount'));
});

test('Kill X percentage boosts agree with final source eligibility and obey exact per-task bans', () => {
  const defs = definitions(); defs.slayerMonsters['Slayer beast'] = 23; defs.codeItems.boostItems.Slayer.Tonic = '10%+1';
  const current = state({ 'Kill X': true, Boosting: true });
  current.legacy = { maps: { one: { chunkinfo: { passiveSkill: { Slayer: 20 } } } } };
  assert.ok(labels(evaluate(current, defs).generated, 'Kill X').includes('Kill X ~|Slayer beast|~'));
  defs.codeItems.boostTaskBans = { Slayer: { 'Kill X ~|Slayer beast|~': ['Tonic'] } };
  assert.ok(!labels(evaluate(current, defs).generated, 'Kill X').includes('Kill X ~|Slayer beast|~'));
});

test('legacy raw Every Drop source preference survives a corrected display rate', () => {
  const defs = definitions(), current = state({ 'Every Drop': true });
  const oldRaw = 'Rat: ~|Bones|~ (Always)';
  current.legacy = { maps: { one: { chunkinfo: { altChallenges: { Extra: { 'Every Drop Bones': oldRaw } } } } } };
  defs.drops.Rat.Bones = { '1': '1/3' };
  const generated = evaluate(current, defs).generated;
  const selected = selectCollectionGoals(generated, current, 'player1');
  const bones = selected.tasks.find(row => row.item === 'Bones');
  assert.equal(bones.collectionSource, 'Rat'); assert.equal(bones.rate, '1/3');
  assert.ok(!selected.diagnostics.some(row => row.kind === 'unavailable-collection-alternative'));
  assert.equal(current.legacy.maps.one.chunkinfo.altChallenges.Extra['Every Drop Bones'], oldRaw);
});

test('Every Drop historical group labels follow canonical items and retain conflicting preferences for review', () => {
  const current = state({ 'Every Drop': true }), generated = evaluate(current).generated;
  const rat = extraId('Rat: ~|Bones|~ (Always)'), goblin = extraId('Goblin: ~|Bones|~ (1/2)');
  current.members[0].taskAlternatives = { Extra: { 'Every Drop Bones*': rat } };
  assert.equal(selectCollectionGoals(generated, current, 'player1').tasks.find(row => row.item === 'Bones').id, rat);
  current.members[0].taskAlternatives.Extra['Every Drop Bones**'] = goblin;
  const original = structuredClone(current);
  const conflict = selectCollectionGoals(generated, current, 'player1');
  assert.equal(conflict.tasks.find(row => row.item === 'Bones').id, goblin);
  assert.ok(conflict.diagnostics.some(row => row.kind === 'conflicting-collection-alternatives' && row.preferences.length === 2));
  assert.deepEqual(current, original);
  current.members[0].taskAlternatives.Extra['Every Drop Bones'] = null;
  const automatic = selectCollectionGoals(generated, current, 'player1');
  assert.equal(automatic.tasks.find(row => row.item === 'Bones').id, goblin);
  assert.ok(!automatic.diagnostics.some(row => row.kind === 'conflicting-collection-alternatives'));
});
