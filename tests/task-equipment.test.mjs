import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentTaskItems, equipmentStats, equipmentTaskModel, renderTaskEquipment } from '../app/web/task-equipment.mjs';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';

const definitions = {
  'Team-1 cape': { class: 'all', slot: 'back', tier: 21, armour: 3.3, lp: 0, prayer: 0, melee_damage: 1.8, ranged_damage: 1.8, magic_damage: 1.8, necromancy_damage: 1.8 },
  'Skull lantern (tier 10)': { class: 'necromancy', slot: 'off-hand weapon', tier: 10, ability_damage: 48, accuracy: 202, armour: 0, lp: 0, prayer: 0 },
};
function dom() {
  class Node {
    constructor(tag) { this.tag = tag; this.textContent = ''; this.children = []; this.attributes = {}; this.events = {}; }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
  }
  return { createElement: tag => new Node(tag) };
}
const walk = node => [node, ...node.children.flatMap(walk)];
const contents = node => walk(node).map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();

test('equipment goals resolve explicit metadata, independent of articles, markup and labels', () => {
  for (const [name, task] of [
    ['Team-1 cape', { equipmentName: 'Team-1 cape', label: 'An arbitrary renamed goal' }],
    ['Skull lantern (tier 10)', { goal: { item: 'Skull lantern (tier 10)' }, label: 'Obtain a Skull lantern (tier 10)' }],
    ['Team-1 cape', { category: 'BiS', record: { ItemsDetails: ['Team-1 cape'] } }],
    ['Team-1 cape', { record: { Category: ['BIS Skilling'], Items: ['Team-1 cape'] } }],
  ]) assert.deepEqual(equipmentTaskItems(task, {}, definitions).map(item => item.name), [name]);
  assert.deepEqual(equipmentTaskItems({ label: 'Obtain a Team-1 cape' }, {}, definitions), []);
  assert.deepEqual(equipmentTaskItems({ record: { Items: ['Coins'] } }, {}, definitions), []);
  assert.deepEqual(equipmentTaskItems({ category: 'Crafting', record: { Items: ['Team-1 cape'], ItemsDetails: ['Team-1 cape'] } }, {}, definitions), []);
});

test('play rows resolve full task metadata by identity and deduplicate item metadata', () => {
  const full = { tasks: [{ id: 'goal', equipmentName: 'Team-1 cape', record: { Items: ['Team-1 cape'], ItemsDetails: ['Team-1 cape'] } }] };
  const before = structuredClone(full);
  assert.equal(equipmentTaskItems({ id: 'goal', label: 'Projection' }, full, definitions).length, 1);
  assert.deepEqual(full, before);
});

test('stats preserve zero, negative bonuses and declared units while rejecting missing or invalid data', () => {
  const stats = equipmentStats({ armour: 0, lp: '0', prayer: -2, weight: -4, attack_speed_ticks: 3, accuracy: '', ability_damage: null, ranged_damage: NaN, magic_damage: Infinity });
  assert.deepEqual(stats.map(stat => [stat.key, stat.value]), [['armour', 0], ['lp', 0], ['prayer', -2], ['weight', -4], ['attack_speed_ticks', 3]]);
  assert.equal(stats.find(stat => stat.key === 'weight').unit, 'kg');
  assert.deepEqual(equipmentStats(), []);
  assert.deepEqual(equipmentStats(null), []);
});

test('missing definitions do not borrow engine default zeros as declared stats', () => {
  const model = equipmentTaskModel({ equipmentName: 'Unknown' }, { equipment: [{ name: 'Unknown', slot: 'ring', armour: 0, accuracy: 0 }] });
  assert.equal(model.items[0].slot, 'ring');
  assert.deepEqual(model.items[0].stats, []);
  assert.ok(model.limitations.some(value => /stats are unavailable/.test(value)));
  assert.deepEqual(model.explanations, []);
});

test('recommendation data can supply declared stats before the definitions request completes', () => {
  const result = { equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', score: [1.8, 3.3, 0], equipment: { name: 'Team-1 cape', data: definitions['Team-1 cape'] } }] } };
  const model = equipmentTaskModel({ equipmentName: 'Team-1 cape' }, result);
  assert.equal(model.items[0].stats.find(stat => stat.key === 'armour').value, 3.3);
  assert.equal(model.explanations[0], 'Best back item for Melee.');
  assert.equal(model.comparisons.length, 0);
});

test('real equipment planner evidence explains a coupled skull lantern loadout without claiming inventory', () => {
  const equipment = { ...definitions, 'Death guard': { class: 'necromancy', slot: 'main hand weapon', tier: 10, ability_damage: 96, accuracy: 202 } };
  const state = { members: [{ id: 'a', completedTasks: [] }], rules: { 'content.f2p': true }, taskRules: {} };
  const planning = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) }, state, 'a', { equipment });
  const task = planning.tasks.find(task => task.equipmentName === 'Skull lantern (tier 10)');
  assert.ok(task);
  const result = { tasks: planning.tasks, equipmentPlanning: planning };
  const before = structuredClone(result);
  const model = equipmentTaskModel(task, result, equipment);
  assert.ok(model.explanations.some(value => /Death guard \+ Skull lantern/.test(value)));
  assert.ok(model.explanations.some(value => /Part of the best dual-wield Necromancy loadout: Death guard \+ Skull lantern/.test(value)));
  assert.ok(model.ranking.some(value => /Loadout ranking components/.test(value)));
  assert.deepEqual(result, before);
});

test('real Team-1 cape planner evidence supplies ordinary stat ranking and a lower-ranked comparison', () => {
  const equipment = { ...definitions, 'Plain cape': { class: 'all', slot: 'back', tier: 1, armour: 1, lp: 0, prayer: 0 } };
  const state = { members: [{ id: 'a', completedTasks: [] }], rules: { 'content.f2p': true }, taskRules: {} };
  const planning = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) }, state, 'a', { equipment });
  const task = planning.tasks.find(task => task.equipmentName === 'Team-1 cape');
  const model = equipmentTaskModel(task, { equipmentPlanning: planning }, equipment);
  assert.equal(model.items[0].stats.find(stat => stat.key === 'melee_damage').value, 1.8);
  assert.ok(model.ranking.includes('Damage plus 0.15 × accuracy, then armour, then life points.'));
  assert.deepEqual(model.explanations, ['Best back item for Melee, Ranged, Magic and Necromancy.']);
  assert.ok(model.comparisons.some(value => value.style === 'Melee' && value.items.includes('Plain cape')));
  const node = renderTaskEquipment(task, { equipmentPlanning: planning }, equipment, { document: dom(), iconLookup: () => null, advanced: true });
  const how = walk(node).find(row => row.tag === 'details' && row.children[0]?.textContent === 'How it’s ranked');
  assert.ok(how); assert.ok(!how.open);
  assert.match(contents(how), /Damage plus 0\.15 × accuracy, then armour, then life points/);
  assert.ok(!walk(node).find(row => row.className === 'task-equipment-evidence').children.filter(row => row.tag === 'p').some(row => /0\.15/.test(row.textContent)));
  assert.match(contents(node), /Next best for Melee: Plain cape/);
});

test('ranked upgrade and personal obtain comparisons use supplied scores and common declared stats only', () => {
  const equipment = { Best: { class: 'melee', slot: 'back', melee_damage: 5, armour: 10, prayer: 0 }, Lower: { class: 'melee', slot: 'back', melee_damage: 3, armour: 0 }, Known: { class: 'melee', slot: 'back', melee_damage: 1 } };
  const rec = { style: 'Melee', slot: 'back', equipment: { name: 'Best' }, score: [5, 10, 0] };
  const result = { equipmentPlanning: { recommendations: [rec], specialist: { upgradePaths: [{ kind: 'slot', style: 'Melee', slot: 'back', comparison: 'Declared combat bonuses.', steps: [
    { items: ['Known'], score: [1, 0, 0] }, { items: ['Lower'], score: [3, 0, 0] }, { items: ['Best'], score: [5, 10, 0] },
  ] }] } }, currentBiS: { owned: { known: false, recordedBest: { recommendations: [{ ...rec, equipment: { name: 'Known' }, score: [1, 0, 0] }] } } } };
  const model = equipmentTaskModel({ equipmentName: 'Best' }, result, equipment);
  assert.deepEqual(model.comparisons.map(value => [value.kind, value.items]), [['next', ['Lower']], ['recorded', ['Known']]]);
  assert.deepEqual(model.comparisons[0].stats[0].deltas.map(stat => [stat.key, stat.value]), [['armour', 10], ['melee_damage', 2]]);
  assert.ok(model.limitations.some(value => /does not confirm you still own/.test(value)));
});

test('equal-ranked alternatives remain ties and different slots do not acquire guessed stat deltas', () => {
  const result = { equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', equipment: { name: 'Team-1 cape' }, score: [1.8], alternatives: ['Other'] }] } };
  const model = equipmentTaskModel({ equipmentName: 'Team-1 cape' }, result, { ...definitions, Other: { slot: 'ring', armour: 2 } });
  assert.equal(model.comparisons[0].kind, 'tie');
  assert.deepEqual(model.comparisons[0].score, [1.8]);
  assert.deepEqual(model.comparisons[0].stats[0].deltas, []);
});

test('current BiS alone compares changed loadout partners using the winning loadout', () => {
  const equipment = { ...definitions, 'Best guard': { slot: 'main hand weapon', ability_damage: 96, accuracy: 202 }, 'Lower guard': { slot: 'main hand weapon', ability_damage: 48, accuracy: 202 } };
  const rec = { style: 'Necromancy', slot: 'off-hand weapon', equipment: { name: 'Skull lantern (tier 10)' }, loadoutMode: 'dual-wield', score: [30] };
  const best = { mode: 'dual-wield', items: ['Best guard', 'Skull lantern (tier 10)'], score: 30 };
  const result = { currentBiS: { obtainable: { recommendations: [rec], loadouts: [{ style: 'Necromancy', best, selected: [best] }], specialist: { upgradePaths: [{
    kind: 'loadout', style: 'Necromancy', slot: 'dual-wield', mode: 'dual-wield', comparison: 'Both hands coupled.', steps: [
      { items: ['Lower guard', 'Skull lantern (tier 10)'], score: 20 }, { items: best.items, score: 30 },
    ],
  }] } } } };
  const model = equipmentTaskModel({ equipmentName: 'Skull lantern (tier 10)' }, result, equipment);
  assert.equal(model.comparisons.length, 1);
  assert.deepEqual(model.comparisons[0].items, ['Lower guard', 'Skull lantern (tier 10)']);
  assert.equal(model.comparisons[0].score, 20);
  assert.ok(model.ranking.includes('Both hands coupled.'));
  const node = renderTaskEquipment({ equipmentName: 'Skull lantern (tier 10)' }, result, equipment, { document: dom(), iconLookup: () => null });
  assert.match(contents(node), /Next best for Necromancy: Lower guard \+ Skull lantern \(tier 10\)/);
  assert.match(contents(node), /Best guard vs Lower guard: \+48 ability damage/);
  assert.match(contents(node), /Same stats as Skull lantern \(tier 10\)\./);
  assert.doesNotMatch(contents(node), /Same stats as Lower guard/);
});

test('blocked equipment without planning evidence displays stats without declaring it BiS', () => {
  const node = renderTaskEquipment({ equipmentName: 'Team-1 cape', status: 'blocked' }, {}, definitions, { document: dom(), iconLookup: () => null });
  assert.match(contents(node), /This item is not currently recommended as BiS/);
  assert.ok(!contents(node).includes('Why this is BiS'));
});

test('detail and compact DOM use the same stats, safe text and icon helper contract', () => {
  const document = dom(), calls = [];
  const iconLookup = name => { calls.push(name); return '/assets/map/icons-items.2026-10-08.v1/cape.png'; };
  const task = { equipmentName: 'Team-1 cape' };
  const detail = renderTaskEquipment(task, {}, definitions, { document, iconLookup });
  const compact = renderTaskEquipment(task, {}, definitions, { document, iconLookup, compact: true });
  assert.deepEqual(calls, ['Team-1 cape']);
  assert.equal(walk(detail).find(node => node.tag === 'img').alt, '');
  assert.equal(detail.attributes['aria-label'], 'Equipment details');
  assert.match(contents(compact), /Any style · Back slot · Tier 21/);
  const statPairs = node => walk(node).filter(row => row.tag === 'dl').flatMap(row => row.children.map(pair => pair.children.map(child => child.textContent)));
  assert.deepEqual(statPairs(detail), [['Armour', '3.3'], ['Melee damage bonus', '1.8'], ['Ranged damage bonus', '1.8'], ['Magic damage bonus', '1.8'], ['Necromancy damage bonus', '1.8']]);
  assert.deepEqual(statPairs(compact), statPairs(detail));
  assert.doesNotMatch(contents(detail), /Life points 0|Prayer bonus 0/);
  assert.ok(!contents(compact).includes('No other item is known for comparison'));
  assert.ok(contents(detail).includes('No other item is known for comparison'));
  const notes = walk(detail).find(row => row.tag === 'details' && row.children[0]?.textContent === 'Notes');
  assert.ok(notes); assert.ok(!notes.open); assert.match(contents(notes), /No other item is known for comparison/);
  assert.ok(walk(detail).find(node => node.tag === 'dl').children.every(pair => pair.children.map(node => node.tag).join(',') === 'dt,dd'));
  assert.equal(renderTaskEquipment({ label: '<script>not metadata</script>' }, {}, definitions, { document, iconLookup }), null);
});

test('compact equipment stats stay bounded and show nonzero primary values before optional bonuses', () => {
  const equipment = { Many: { class: 'all', slot: 'body', tier: 0, ability_damage: 1, auto_damage: 1, accuracy: 0, armour: 0, lp: 0, prayer: 0, damage_tier: 1, accuracy_tier: 0, melee_damage: 0, melee_accuracy: 5, ranged_damage: 2, ranged_accuracy: 6, magic_damage: 3, magic_accuracy: 7, necromancy_damage: 4, necromancy_accuracy: 8 } };
  const node = renderTaskEquipment({ equipmentName: 'Many' }, {}, equipment, { document: dom(), compact: true, iconLookup: () => { throw new Error('Compact icons belong to hover header'); } });
  assert.equal(walk(node).filter(node => node.tag === 'dt').length, 8);
  assert.deepEqual(walk(node).filter(row => row.tag === 'dt').map(row => row.textContent).slice(0, 3), ['Ability damage', 'Auto-attack damage', 'Damage tier']);
  assert.doesNotMatch(contents(node), /Accuracy 0|Armour 0|Life points 0|Prayer bonus 0|Melee damage bonus 0/);
  assert.match(contents(node), /Ranged damage bonus 2/);
  assert.doesNotMatch(contents(node), /Necromancy damage bonus/);
});

test('DOM gracefully renders unavailable icons and explicit equipment identities without definitions', () => {
  const node = renderTaskEquipment({ equipmentName: '<unavailable equipment>' }, {}, {}, { document: dom(), iconLookup: () => null });
  assert.ok(!walk(node).some(node => node.tag === 'img'));
  assert.match(contents(node), /<unavailable equipment>/);
  assert.match(contents(node), /No stats recorded for this item\./);
  assert.ok(!walk(node).some(row => row.innerHTML != null || row.tag === 'script'));
});

test('large sets of tied equipment comparisons stay collapsed and preserve detail on demand', () => {
  const names = Array.from({ length: 20 }, (_, index) => `Other cape ${index}`), data = { ...definitions, ...Object.fromEntries(names.map(name => [name, definitions['Team-1 cape']])) };
  const result = { equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', equipment: { name: 'Team-1 cape' }, score: [1.8], alternatives: names }] } };
  const node = renderTaskEquipment({ equipmentName: 'Team-1 cape' }, result, data, { document: dom(), iconLookup: () => null });
  assert.equal(walk(node).filter(row => row.className === 'task-equipment-comparison').length, 1);
  const more = walk(node).find(row => row.tag === 'details' && row.children[0]?.textContent === 'Other equipment comparisons (19)');
  assert.ok(more); assert.ok(!more.open); assert.equal(more.children.length, 1);
  more.open = true; more.events.toggle(); assert.equal(more.children.filter(row => row.tag === 'details').length, 19);
  const entry = more.children.find(row => row.tag === 'details'); entry.open = true; entry.events.toggle();
  assert.match(contents(entry), /Equally good for Melee: Other cape 1/);
  assert.match(contents(entry), /Same stats as Other cape 1\./);
  entry.events.toggle(); assert.equal(entry.children.length, 2);
});

test('declared equip levels and stat differences render without floating-point artifacts', () => {
  const data = { ...definitions, 'Team-1 cape': { ...definitions['Team-1 cape'], requirements: { Defence: 1 } }, Other: { ...definitions['Team-1 cape'], armour: 29.4, melee_damage: 0 } };
  const result = { equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', equipment: { name: 'Team-1 cape' }, score: [1.8], alternatives: ['Other'] }] } };
  const node = renderTaskEquipment({ equipmentName: 'Team-1 cape' }, result, data, { document: dom(), iconLookup: () => null });
  assert.match(contents(node), /Equip: Defence 1/);
  assert.match(contents(node), /This item vs Other: −26\.1 armour, \+1\.8 melee damage bonus/);
  assert.ok(!contents(node).includes('999999'));
});

test('loadout score identities remain exact when adjacent tiers round to the same display value', () => {
  const best = { mode: 'dual-wield', items: ['Best guard', 'Skull lantern (tier 10)'], score: 30.0004 };
  const result = { equipmentPlanning: { recommendations: [{ style: 'Necromancy', slot: 'off-hand weapon', equipment: { name: 'Skull lantern (tier 10)' }, score: [30.0004], loadoutMode: 'dual-wield' }], loadouts: [{ style: 'Necromancy', selected: [best] }], specialist: { upgradePaths: [{ kind: 'loadout', style: 'Necromancy', slot: 'dual-wield', mode: 'dual-wield', steps: [{ items: ['Lower guard', 'Skull lantern (tier 10)'], score: 30.0001 }, { items: best.items, score: 30.0004 }] }] } } };
  const model = equipmentTaskModel({ equipmentName: 'Skull lantern (tier 10)' }, result, definitions);
  assert.equal(model.comparisons.length, 1); assert.equal(model.comparisons[0].score, 30.0001); assert.equal(model.comparisons[0].targetScore, 30.0004);
});

test('detail and compact distinguish absent stats from zero bonuses and retain negative bonuses', () => {
  const equipment = { Zero: { slot: 'ring', armour: 0, lp: '0', prayer: 0, weight: 0 }, Missing: { slot: 'ring' }, Negative: { slot: 'ring', prayer: -2, weight: -4 } };
  for (const compact of [false, true]) {
    const render = name => renderTaskEquipment({ equipmentName: name }, {}, equipment, { document: dom(), compact, iconLookup: () => null });
    const zero = render('Zero'), missing = render('Missing'), negative = render('Negative');
    assert.match(contents(zero), /No bonuses\./); assert.doesNotMatch(contents(zero), /No stats recorded/);
    assert.match(contents(missing), /No stats recorded for this item\./); assert.doesNotMatch(contents(missing), /No bonuses/);
    assert.ok(!walk(zero).some(row => row.tag === 'dl'));
    assert.match(contents(negative), /Prayer bonus -2 Weight -4 kg/);
  }
});

test('same-stats comparisons require matching slots and complete declared field coverage', () => {
  const cases = [
    [{ slot: 'back', armour: 3 }, { slot: 'ring', armour: 3 }, false],
    [null, { slot: 'back', armour: 3 }, false],
    [{ slot: 'back' }, { slot: 'back', armour: 3 }, false],
    [{ slot: 'back', armour: 3 }, { slot: 'back', melee_damage: 5 }, false],
    [{ slot: 'back', armour: 3 }, { slot: 'back', armour: 3, melee_damage: 5 }, false],
    [{ slot: 'back', armour: 3, melee_damage: 5 }, { slot: 'back', armour: 3 }, false],
    [{ slot: 'back', armour: 3, lp: 0 }, { slot: 'back', armour: 3, lp: '0' }, true],
  ];
  const result = { equipmentPlanning: { recommendations: [{ style: 'Melee', slot: 'back', equipment: { name: 'Best' }, alternatives: ['Other'] }] } };
  for (const [target, other, identical] of cases) {
    const equipment = { ...(target ? { Best: target } : {}), Other: other };
    const model = equipmentTaskModel({ equipmentName: 'Best' }, result, equipment);
    assert.equal(model.comparisons[0].stats[0].sameStats, identical);
    const node = renderTaskEquipment({ equipmentName: 'Best' }, result, equipment, { document: dom(), iconLookup: () => null });
    assert.equal(contents(node).includes('Same stats as Other.'), identical);
    assert.equal(contents(node).includes('Full stat comparison unavailable for Other.'), !identical);
  }
});

test('multi-item goals retain which equipment is best for each combat style', () => {
  const equipment = { 'Cape A': { slot: 'back', armour: 3 }, 'Cape B': { slot: 'back', armour: 5 } };
  const result = { equipmentPlanning: { recommendations: [
    { style: 'Melee', slot: 'back', equipment: { name: 'Cape A' } },
    { style: 'Magic', slot: 'back', equipment: { name: 'Cape B' } },
  ] } };
  const task = { goal: { items: ['Cape A', 'Cape B'] } };
  const model = equipmentTaskModel(task, result, equipment);
  assert.deepEqual(model.explanations, ['Cape A: best back item for Melee.', 'Cape B: best back item for Magic.']);
  assert.doesNotMatch(contents(renderTaskEquipment(task, result, equipment, { document: dom(), iconLookup: () => null })), /Best back item for Melee and Magic/);
});

test('ranking details format fractional components without changing winning scores', () => {
  const best = { mode: 'dual-wield', items: ['Best guard', 'Skull lantern (tier 10)'], score: 30.0004, components: { damage: 0.1 + 0.2, bonus: 46.666666666666664 } };
  const result = { equipmentPlanning: { recommendations: [{ style: 'Necromancy', slot: 'off-hand weapon', equipment: { name: 'Skull lantern (tier 10)' }, score: [30.0004], loadoutMode: 'dual-wield' }], loadouts: [{ style: 'Necromancy', selected: [best] }] } };
  const before = structuredClone(result);
  const node = renderTaskEquipment({ equipmentName: 'Skull lantern (tier 10)' }, result, definitions, { document: dom(), iconLookup: () => null, advanced: true });
  const how = walk(node).find(row => row.tag === 'details' && row.children[0]?.textContent === 'How it’s ranked');
  assert.ok(how); assert.ok(!how.open);
  assert.match(contents(how), /damage: 0\.3; bonus: 46\.667/);
  assert.doesNotMatch(contents(how), /000000000|666666666/);
  assert.deepEqual(result, before);
});

test('Advanced reveals equipment calculation details while stats and next-best comparisons remain available', () => {
  const equipment = { ...definitions, 'Plain cape': { class: 'all', slot: 'back', tier: 1, armour: 1 } };
  const state = { members: [{ id: 'a', completedTasks: [] }], rules: { 'content.f2p': true }, taskRules: {} };
  const planning = evaluateEquipment({ equipment: Object.keys(equipment).map(name => ({ name, sources: [] })) }, state, 'a', { equipment });
  const task = planning.tasks.find(task => task.equipmentName === 'Team-1 cape'), before = structuredClone(planning);
  for (const advanced of [false, true]) {
    const node = renderTaskEquipment(task, { equipmentPlanning: planning }, equipment, { document: dom(), advanced, iconLookup: () => null });
    assert.equal(contents(node).includes('How it’s ranked'), advanced);
    assert.equal(contents(node).includes('Damage plus 0.15 × accuracy'), advanced);
    assert.match(contents(node), /Next best for Melee: Plain cape/);
    assert.match(contents(node), /Armour 3.3/);
    assert.match(contents(node), /Equipment comparisons do not predict damage per second against a monster/);
  }
  assert.deepEqual(planning, before);
});
