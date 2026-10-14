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
  const current = createGroupState([{ id: 'actor1', name: 'Player', sourceMapId: 'one' }, { id: 'reed', name: 'Reed', sourceMapId: 'two' }]);
  current.rules['content.f2p'] = false; current.members[0].unlocked = ['100'];
  current.members[0].taskRules = rules;
  return current;
}
function evaluate(current, defs = definitions(), memberId = 'actor1') {
  const collection = createCollectionEngine(defs), result = createTaskEngine(defs).evaluate(current, memberId);
  return { collection, result, generated: collection.evaluate(current, memberId, result) };
}
function labels(output, rule) { return output.tasks.filter(row => row.record.Label === rule).map(row => row.rawLabel); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('all four generators are opt-in and potential catalogue registers stable Extra identities', () => {
  const { collection, generated } = evaluate(state());
  assert.deepEqual(generated.tasks, []);
  for (const raw of ['Kill X ~|Goblin|~', 'Goblin: ~|Bones|~ (Always)', 'Goblin: ~|Bones|~ (1) (Always)', 'Store: ~|Hammer|~']) {
    const entry = collection.catalogue.find(row => row.id === extraId(raw));
    assert.ok(entry, raw); assert.equal(entry.category, 'Extra'); assert.equal(entry.kind, 'collection');
    assert.ok(entry.aliases.includes(legacyTaskId('Extra', raw)));
  }
});


test('Every Drop groups source alternatives by exact item, retaining only one rate per source/item', () => {
  const { generated } = evaluate(state({ 'Every Drop': true }));
  const bones = generated.tasks.filter(row => row.item === 'Bones');
  assert.equal(bones.length, 2);
  assert.ok(bones.some(row => row.rawLabel === 'Goblin: ~|Bones|~ (1/2)'));
  assert.deepEqual(generated.alternatives[bones[0].id], [bones[1].id]);
  assert.equal(generated.alternatives[bones[1].id], undefined, 'alternative peers are transported once for the representative');
  assert.ok(!generated.tasks.some(row => row.item.includes('^') || row.item === 'Apple' || row.item === 'Rope' || row.item === 'Meat'));
  assert.ok(!generated.tasks.some(row => row.rawLabel.startsWith('Unreachable:')));
});

test('All Droptables keeps sources distinct and retains quantity variants as metadata', () => {
  const { generated } = evaluate(state({ 'All Droptables': true }));
  const bones = generated.tasks.filter(row => row.item === 'Bones');
  assert.equal(bones.length, 2);
  const goblin = bones.find(row => row.collectionSource === 'Goblin');
  assert.deepEqual(goblin.variants.map(row => row.rawLabel), ['Goblin: ~|Bones|~ (1) (Always)', 'Goblin: ~|Bones|~ (2) (1/2)']);
  assert.ok(labels(generated, 'All Droptables').includes('Goblin: ~|Bones|~ (2) (1/2)'));
  assert.ok(labels(generated, 'All Droptables').includes('Goblin: ~|Gem|~ (2 (noted)) (1/20)'));
  assert.ok(generated.tasks.some(row => row.item === 'Apple'));
  assert.ok(generated.tasks.some(row => row.item === 'Rope'));
  assert.ok(!generated.tasks.some(row => row.item === 'Meat'), 'reference All Droptables does not add Big Game Hunter');
});

test('All Shops requires the specific reachable shop or explicit authored shop-output task', () => {
  const { generated } = evaluate(state({ 'All Shops': true }));
  assert.deepEqual(labels(generated, 'All Shops'), ['Exchange: ~|Saw|~', 'Other: ~|Hammer|~', 'Store: ~|Hammer|~', 'Store: ~|Tonic|~']);
  assert.ok(generated.tasks.find(row => row.item === 'Saw').sources.every(source => source.taskId === stableTaskId('Nonskill', '~|Exchange|~')));
  assert.ok(!generated.tasks.some(row => row.item === 'False stock' || row.item === 'Remote item'));
});

test('collection tasks use source provenance and do not infer a purchase/drop from another source or possession', () => {
  const defs = definitions(), current = state({ 'Every Drop': true, 'All Droptables': true, 'All Shops': true });
  const collection = createCollectionEngine(defs), result = createTaskEngine(defs).evaluate(current, 'actor1');
  result.items = result.items.map(item => ({ ...item, sources: [{ kind: 'manual', source: 'Declared inventory' }] }));
  assert.deepEqual(collection.evaluate(current, 'actor1', result).tasks, []);
  assert.deepEqual(collection.evaluate(current, 'actor1', { ...result, access: { ...result.access, monsters: [] } }).tasks, []);
});

test('rare-drop threshold is strict, nested probabilities multiply, opaque rates remain authored', () => {
  const defs = definitions(); defs.drops.Goblin.Mystery = { '1': 'Unknown' };
  const current = state({ 'Every Drop': true, 'All Droptables': true, 'Rare Drop': false, 'Rare Drop Amount': '10' });
  const output = evaluate(current, defs).generated;
  assert.ok(!output.tasks.some(row => row.item === 'Coins' || row.item === 'Gem'), 'rate equal to cutoff and rarer combined rate are excluded');
  assert.ok(output.tasks.some(row => row.item === 'Mystery' && row.rate === 'Unknown'));
  current.members[0].taskRules['Rare Drop Amount'] = '0';
  assert.ok(evaluate(current, defs).generated.tasks.some(row => row.item === 'Gem'));
  assert.equal(collectionRateLabel(1 / 1250, '1/1250'), '1/1,250');
  assert.equal(collectionRateLabel(1 / 12.345, '1/12.345'), '1/12.35');
});

test('Every Drop Thieving/Implings/BGH subrules gate their own available authored source tasks', () => {
  const current = state({ 'Every Drop': true, 'Every Drop Thieving': true, 'Every Drop Implings': true, 'Every Drop BGH': true });
  const output = evaluate(current).generated;
  for (const name of ['Apple', 'Rope', 'Meat']) assert.ok(output.tasks.some(row => row.item === name), name);
  const defs = definitions(); defs.challenges.Thieving['Pickpocket ~|Farmer|~']['Hide drops'] = true;
  defs.challenges.Hunter['Catch a ~|baby impling|~']['Not F2P'] = true;
  current.rules['content.f2p'] = true;
  const restricted = evaluate(current, defs).generated;
  assert.ok(!restricted.tasks.some(row => row.item === 'Apple' || row.item === 'Rope'));
});

test('task rules are personal and migrated legacy overrides never reappear after explicit false', () => {
  const current = state();
  delete current.members[0].taskRules;
  current.legacy = { maps: { one: { rules: { 'Kill X': true, 'All Shops': true } }, two: { rules: { 'Kill X': false } } } };
  assert.ok(evaluate(current).generated.tasks.length);
  assert.deepEqual(evaluate(current, definitions(), 'reed').generated.tasks, []);
  current.members[0].taskRules = { 'Kill X': false, 'All Shops': false };
  assert.deepEqual(evaluate(current).generated.tasks, []);
  current.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'actor1', sourceMapId: 'one' }] };
  delete current.members[0].taskRules;
  assert.deepEqual(collectionRules(current, 'actor1'), { F2P: false });
  assert.deepEqual(evaluate(current).generated.tasks, []);
});

test('source and task backlogs are personal exclusions, with explicit false overrides durable', () => {
  const current = state({ 'Kill X': true, 'Every Drop': true, 'All Shops': true });
  current.members[0].sourceBacklogs = { monsters: { Goblin: true }, shops: { Store: true }, items: { Bones: true } };
  const blocked = evaluate(current).generated;
  assert.ok(!blocked.tasks.some(row => row.monster === 'Goblin' || row.collectionSource === 'Goblin' || row.collectionSource === 'Store' || row.item === 'Bones'));
  current.members[0].sourceBacklogs.monsters.Goblin = false;
  assert.ok(evaluate(current).generated.tasks.some(row => row.monster === 'Goblin'));
  const raw = 'Other: ~|Hammer|~'; current.members[0].taskStatus = { [extraId(raw)]: { backlogged: true } };
  assert.equal(evaluate(current).generated.tasks.find(row => row.id === extraId(raw)).status, 'blocked');
});

test('completion scopes derive group collection satisfaction without rewriting personal evidence', () => {
  const current = state({ 'Every Drop': true, 'All Droptables': true, 'All Shops': true });
  const goblin = extraId('Goblin: ~|Bones|~ (1/2)'), rat = extraId('Rat: ~|Bones|~ (Always)');
  current.members[1].taskStatus = { [rat]: { challengeCompleted: true } };
  const before = structuredClone(current);
  const any = evaluate(current).generated;
  assert.equal(any.tasks.find(row => row.id === goblin).challengeSatisfied, true);
  assert.equal(any.tasks.find(row => row.id === goblin).personalCompleted, false);
  assert.ok(any.completionGroups[any.tasks.find(row => row.id === goblin).completionGroup].includes(goblin));
  assert.ok(any.completionGroups[any.tasks.find(row => row.id === goblin).completionGroup].includes(rat));
  assert.deepEqual(any.tasks.find(row => row.id === goblin).satisfiedBy, ['reed']);
  assert.ok(any.tasks.filter(row => row.record.Label === 'All Droptables' && row.item === 'Bones').every(row => !row.challengeSatisfied));
  current.rules['tasks.completion'] = 'all';
  assert.equal(evaluate(current).generated.tasks.find(row => row.id === goblin).challengeSatisfied, false);
  current.members[0].completedTasks = [goblin];
  assert.equal(evaluate(current).generated.tasks.find(row => row.id === rat).challengeSatisfied, true);
  current.rules['tasks.completion'] = 'personal'; current.members[0].completedTasks = [];
  assert.equal(evaluate(current).generated.tasks.find(row => row.id === goblin).challengeSatisfied, false);
  assert.deepEqual(before.members[0].completedTasks, []);
});

test('Every Drop completion family retains source IDs outside current access without granting their sources', () => {
  const defs = definitions(); defs.drops.Unreachable.Bones = { '1': 'Always' };
  const current = state({ 'Every Drop': true });
  const remoteId = extraId('Unreachable: ~|Bones|~ (Always)');
  current.members[1].taskStatus = { [remoteId]: { challengeCompleted: true } };
  const output = evaluate(current, defs).generated;
  const bones = output.tasks.find(row => row.item === 'Bones');
  assert.ok(output.completionGroups[bones.completionGroup].includes(remoteId)); assert.ok(output.completionGroups[bones.completionGroup].includes(bones.id));
  assert.equal(bones.challengeSatisfied, true); assert.equal(bones.personalCompleted, false);
  assert.deepEqual(bones.satisfiedBy, ['reed']);
  assert.ok(!output.tasks.some(row => row.id === remoteId));
});

test('cycles/missing tables fail closed, results deduplicate shared locations and leave frozen input unchanged', () => {
  const defs = definitions(); defs.codeItems.dropTables.RareDropTable.LoopDropTable = '1/1@1'; defs.codeItems.dropTables.LoopDropTable = { RareDropTable: '1/1@1' };
  defs.drops.Goblin.MissingDropTable = { '1': 'Always' };
  defs.chunks['101'] = { Monster: { Goblin: true }, Shop: { Store: true } };
  const current = state({ 'Kill X': true, 'Every Drop': true, 'All Droptables': true, 'All Shops': true }); current.members[1].unlocked = ['101'];
  const original = structuredClone(current), originalDefs = structuredClone(defs);
  const collection = createCollectionEngine(freeze(defs)), result = createTaskEngine(defs).evaluate(freeze(current), 'actor1');
  const output = collection.evaluate(current, 'actor1', freeze(result));
  assert.equal(new Set(output.tasks.map(row => row.id)).size, output.tasks.length);
  assert.ok(output.tasks.every(row => row.generated));
  assert.ok(output.diagnostics.some(row => row.kind === 'collection-drop-table-cycle'));
  assert.ok(output.diagnostics.some(row => row.kind === 'missing-collection-drop-table'));
  assert.deepEqual(current, original); assert.deepEqual(defs, originalDefs);
  assert.deepEqual(collection.evaluate(current, 'actor1', result), output);
  assert.throws(() => collection.evaluate(current, 'missing', result), /Unknown member/);
});

test('locked sections and teleport-only destinations never create collection source eligibility', () => {
  const defs = definitions(); defs.chunks['100'] = { Sections: { '1': { Monster: { Goblin: true }, Shop: { Store: true } }, '2': { Monster: { Rat: true } } } };
  defs.sections = { '100': { '1': [], '2': ['100-1'] } };
  const current = state({ 'Kill X': true, 'Every Drop': true, 'All Shops': true });
  current.members[0].teleports = [{ id: 'remote', label: 'Remote', destination: '200', available: true, consumable: false }];
  assert.deepEqual(evaluate(current, defs).generated.tasks, []);
  current.members[0].sectionOverrides = { '100-1': true, '100-2': false };
  const accessible = evaluate(current, defs).generated;
  assert.ok(accessible.tasks.some(row => row.monster === 'Goblin'));
  assert.ok(!accessible.tasks.some(row => row.monster === 'Rat' || row.monster === 'Unreachable' || row.item === 'Remote item'));
});

test('All Droptables Nest uses an admitted nest-loot task and obtainable nest, independently of the base toggle', () => {
  const defs = definitions(), nest = 'Bird nest (seeds)';
  defs.drops.Goblin[nest] = { '1': 'Always' };
  defs.challenges.Nonskill[`${nest} loot`] = { Items: [nest] };
  defs.skillItems.Nonskill[`${nest} loot`] = { 'Rare seed': { '1': '1/5000' } };
  const current = state({ 'All Droptables Nest': true, 'All Droptables': false, 'Rare Drop': false });
  const output = evaluate(current, defs).generated;
  assert.deepEqual(labels(output, 'All Droptables'), [`${nest}: ~|Rare seed|~ (1) (1/5,000)`]);
  const blocked = structuredClone(defs); blocked.challenges.Nonskill[`${nest} loot`]['Not F2P'] = true;
  current.rules['content.f2p'] = true;
  assert.deepEqual(evaluate(current, blocked).generated.tasks, []);
});


test('Every Drop active goals select one lexical source per item and retain exact personal alternatives', () => {
  const current = state({ 'Every Drop': true, 'All Droptables': true, 'All Shops': true, 'Kill X': true });
  const output = evaluate(current).generated;
  const presentation = { tasks: output.tasks.slice().reverse(), alternatives: output.alternatives, suppressed: {}, diagnostics: [], metrics: { catalogueCount: output.tasks.length } };
  const original = structuredClone(presentation);
  const selected = selectCollectionGoals(freeze(presentation), current, 'actor1');
  assert.equal(selected.tasks.filter(row => row.record.Label === 'Every Drop' && row.item === 'Bones').length, 1);
  assert.equal(selected.tasks.find(row => row.record.Label === 'Every Drop' && row.item === 'Bones').collectionSource, 'Goblin', 'raw label lexical order wins over the easier Rat rate');
  for (const rule of ['Kill X', 'All Droptables', 'All Shops']) assert.equal(labels(selected, rule).length, labels(output, rule).length);
  const rat = extraId('Rat: ~|Bones|~ (Always)');
  current.members[0].taskAlternatives = { Extra: { 'Every Drop Bones': rat } };
  const preferred = selectCollectionGoals(presentation, current, 'actor1');
  assert.equal(preferred.tasks.find(row => row.record.Label === 'Every Drop' && row.item === 'Bones').id, rat);
  assert.equal(preferred.alternatives[rat].length, 1);
  assert.equal(preferred.metrics.presentedCount, preferred.tasks.length);
  assert.deepEqual(presentation, original);
  current.members[0].taskAlternatives.Extra['Every Drop Bones'] = 'Absent source';
  assert.ok(selectCollectionGoals(presentation, current, 'actor1').diagnostics.some(row => row.kind === 'unavailable-collection-alternative'));
});

test('Every Drop saved source choices survive conversion and explicit Automatic masks legacy per owner', () => {
  const current = state({ 'Every Drop': true });
  const key = encodeURIComponent('Every Drop Bones').replaceAll('%', '-_-');
  const choice = encodeURIComponent('Rat: ~|Bones|~ (Always)').replaceAll('%', '-_-');
  current.legacy = { maps: { one: { chunkinfo: { altChallenges: { Extra: { [key]: choice } } } }, two: { chunkinfo: { altChallenges: { Extra: { [key]: choice } } } } } };
  const output = evaluate(current).generated;
  assert.equal(selectCollectionGoals(output, current, 'actor1').tasks.find(row => row.item === 'Bones').collectionSource, 'Rat');
  current.legacy.gameplayMigration = { schemaVersion: 2, migratedMembers: [{ memberId: 'actor1', sourceMapId: 'one' }] };
  assert.equal(selectCollectionGoals(output, current, 'actor1').tasks.find(row => row.item === 'Bones').collectionSource, 'Rat', 'choice metadata remains available after gameplay conversion');
  current.members[0].taskAlternatives = { Extra: { 'Every Drop Bones': null } };
  assert.equal(selectCollectionGoals(output, current, 'actor1').tasks.find(row => row.item === 'Bones').collectionSource, 'Goblin');
  assert.equal(selectCollectionGoals(output, current, 'reed').tasks.find(row => row.item === 'Bones').collectionSource, 'Rat', 'reset applies only to its owner');
  current.members[0].taskAlternatives.Extra['Every Drop Bones'] = extraId('Rat: ~|Bones|~ (Always)');
  assert.equal(selectCollectionGoals(output, current, 'actor1').tasks.find(row => row.item === 'Bones').collectionSource, 'Rat');
  assert.throws(() => selectCollectionGoals(output, current, 'unknown'), /Unknown member/);
});

test('completion families survive JSON transport once per family rather than repeating on each row', () => {
  const defs = definitions();
  for (let i = 0; i < 120; i++) { const name = `Monster ${i}`; defs.chunks['100'].Monster[name] = true; defs.drops[name] = { Bones: { '1': 'Always' } }; }
  const current = state({ 'Every Drop': true });
  const output = evaluate(current, defs).generated, transported = JSON.parse(JSON.stringify(output));
  const bones = transported.tasks.filter(row => row.item === 'Bones');
  assert.ok(bones.length > 120);
  assert.ok(bones.every(row => !Object.hasOwn(row, 'completionIds')));
  assert.equal(new Set(bones.map(row => row.completionGroup)).size, 1);
  const ids = transported.completionGroups[bones[0].completionGroup];
  assert.ok(bones.every(row => ids.includes(row.id)));
  const expanded = { ...output, tasks: output.tasks.map(row => ({ ...row, completionIds: output.completionGroups[row.completionGroup] })) };
  assert.ok(JSON.stringify(output).length < JSON.stringify(expanded).length / 2, 'shared families keep payload growth linear in rows plus aliases');
  assert.deepEqual(transported.completionGroups, output.completionGroups);
});

test('collection rate and quantity corrections retain personal completion and both old goal aliases', () => {
  const defs = definitions(), current = state({ 'Every Drop': true, 'All Droptables': true });
  const before = evaluate(current, defs), oldEvery = before.generated.tasks.find(row => row.item === 'Coins' && row.record.Label === 'Every Drop');
  const oldAll = before.generated.tasks.find(row => row.item === 'Coins' && row.record.Label === 'All Droptables');
  current.members[0].completedTasks = [legacyTaskId('Extra', oldEvery.rawLabel), legacyTaskId('Extra', oldAll.rawLabel)];
  current.members[0].taskStatus = { [legacyTaskId('Extra', oldAll.rawLabel)]: { favorite: true, note: 'Keep this drop check' } };
  const migrated = migrateTaskIdentities(current, { catalogue: before.collection.catalogue }).state;
  defs.drops.Goblin.Coins = { '7': '1/20' };
  const after = evaluate(migrated, defs).generated;
  for (const old of [oldEvery, oldAll]) {
    const goal = after.tasks.find(row => row.id === old.id);
    assert.ok(goal); assert.equal(goal.personalCompleted, true); assert.equal(goal.challengeSatisfied, true);
    assert.equal(goal.rate, '1/20');
  }
  assert.equal(after.tasks.find(row => row.id === oldAll.id).quantity, '7');
  assert.notEqual(oldEvery.id, oldAll.id, 'Every Drop and All Droptables retain distinct objective semantics');
  assert.deepEqual(migrated.members[0].taskStatus[oldAll.id], { favorite: true, note: 'Keep this drop check' });
  assert.equal(migrated.identityRegistry.aliases[legacyTaskId('Extra', oldAll.rawLabel)], oldAll.id);
});

test('collection output admission follows an explicitly registered task through a label rename', () => {
  const defs = definitions(), old = 'Pickpocket ~|Farmer|~', renamed = 'Pickpocket the ~|Farmer|~';
  const record = { ...defs.challenges.Thieving[old], PickerId: 'rs3:task:fixture-farmer' };
  delete defs.challenges.Thieving[old]; defs.challenges.Thieving[renamed] = record;
  const output = evaluate(state({ 'Every Drop': true, 'Every Drop Thieving': true }), defs).generated;
  const apple = output.tasks.find(row => row.item === 'Apple');
  assert.ok(apple); assert.ok(apple.sources.every(source => source.taskId === record.PickerId));
});


