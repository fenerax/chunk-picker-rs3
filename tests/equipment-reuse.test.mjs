import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEquipment } from '../app/tasks/equipment.mjs';
import { equipmentTaskIdentity } from '../app/tasks/presentation.mjs';

const row = (id, category, record = {}, extras = {}) => ({ id, label: id, rawLabel: id, category,
  obligation: true, status: 'available', record, ...extras });
const weapon = tier => ({ slot: '2h weapon', class: 'melee', tier, ability_damage: tier * 9.6,
  accuracy: tier * 20, speed: 3, members: false });
const fixture = () => {
  const definitions = { equipment: { 'Fixture best': weapon(50), 'Fixture second': weapon(40),
    'Fixture member tool': { slot: 'ring', class: 'all', members: true },
    'Fixture consumable': { ...weapon(60), is_consumable: true } },
  codeItems: { itemsPlus: { 'Choice[+]': ['Fixture member tool', 'Coins', 'Coins'] } },
  challenges: { Extra: { 'fallback record': { Category: ['BIS Skilling'] } } } };
  const specialists = [
    row('set first', 'Extra', { Category: ['BIS Skilling'], Set: 'Tools', Priority: 1, Items: ['Coins'] }),
    row('set tie', 'Extra', { Category: 'BIS Skilling', Set: 'Tools', Priority: 1 }, { status: 'blocked', blockers: [{ kind: 'outclassed' }] }),
    row('set unavailable', 'Extra', { Category: ['BIS Skilling'], Set: 'Tools', Priority: 0 }, { status: 'blocked', blockers: [{ kind: 'item' }] }),
    row('unranked', 'Quest', { Category: ['BIS Skilling'], Items: ['Choice[+]'] }),
    row('restricted group', 'Extra', { Category: ['BIS Skilling'], Items: ['Choice[+]x2'] }),
    row('skilling relic', 'Quest', { Category: ['BIS Skilling', 'BIS Skilling Relics'] }),
    row('pvm relic', 'Nonskill', { Category: 'PvM Relics' }),
    row('permanent', 'Extra', { Category: ['Permanent Unlockables'] }),
    row('ability', 'Extra', { Category: ['Unlock Abilities'] }),
    row('prayer', 'Extra', { Category: 'Unlock Prayers' }),
    row('wrong owning category', 'Quest', { Category: ['Unlock Abilities'] }),
    row('nonobligated', 'Extra', { Category: ['BIS Skilling'] }, { obligation: false }),
    row('member requirement', 'Extra', { Category: ['BIS Skilling'], Items: ['Fixture member tool'] }),
    row('member metadata', 'Extra', { Category: ['PvM Relics'], members: true }),
    row('not f2p metadata', 'Extra', { Category: ['Unlock Prayers'], 'Not F2P': true }),
    row('membership blocker', 'Extra', { Category: ['BIS Skilling'] }, { blockers: [{ kind: 'membership' }] }),
    row('scalar unrelated tag', 'Extra', { Category: 7 }),
    row('fallback record', 'Extra', undefined, { record: undefined }),
  ];
  const irrelevant = Array.from({ length: 128 }, (_, index) => row(`irrelevant ${index}`, 'Quest', {
    Category: index % 2 ? ['Ordinary Activity'] : undefined, Items: ['Coins', 'Choice[+]'], Output: ['Coins'],
  }));
  const result = { tasks: [...irrelevant.slice(0, 64), ...specialists, ...irrelevant.slice(64)],
    equipment: ['Fixture best', 'Fixture second', 'Fixture consumable'].map(name => ({ name,
      sources: [{ kind: 'shop', name: 'Fixture shop', location: '1' }] })),
    access: { areas: [] }, training: { Attack: { level: 99, primary: true } } };
  const state = { rules: {}, members: [{ id: 'one', completedTasks: [], taskRules: {} },
    { id: 'two', completedTasks: [], taskRules: {} }] };
  return { definitions, result, state };
};
const equalBytes = (actual, reference) => {
  assert.deepEqual(actual, reference);
  assert.equal(JSON.stringify(actual), JSON.stringify(reference));
};

test('specialist preselection preserves whole equipment JSON across rules, memberships, backlog and sources', () => {
  const { definitions, result, state } = fixture();
  const bestId = equipmentTaskIdentity('Fixture best', definitions.equipment['Fixture best']).id;
  for (const f2p of [false, true]) for (const policy of ['any', 'all', 'personal']) {
    for (const mode of ['normal', 'backlogged', 'secondary consumable']) {
      state.rules = { 'content.f2p': f2p, 'tasks.completion': policy };
      state.members[0].taskRules = { 'BIS Skilling': mode !== 'backlogged', 'BIS Skilling Relics': mode !== 'backlogged',
        'Consumable Primary BiS': mode === 'secondary consumable' };
      state.members[0].taskStatus = { [bestId]: { backlogged: mode === 'backlogged' } };
      state.members[1].completedTasks = [bestId];
      result.equipment[2].sources = mode === 'secondary consumable'
        ? [{ kind: 'fixture-secondary', probability: 0.1, primary: false }] : [{ kind: 'shop', name: 'Fixture shop' }];
      const before = structuredClone({ definitions, result, state });
      const reference = evaluateEquipment(result, state, 'one', definitions, { reuse: false });
      equalBytes(evaluateEquipment(result, state, 'one', definitions), reference);
      assert.deepEqual({ definitions, result, state }, before);
      assert.ok(reference.loadouts.length > 0);
      assert.ok(reference.specialist.skilling.sets.some(set => set.name === 'Tools'));
      assert.ok(!reference.specialist.misc.tasks.some(task => task.id === 'wrong owning category'));
      assert.ok(!reference.specialist.skilling.unranked.some(task => task.id === 'fallback record'));
    }
  }
});

test('preselection skips unrelated membership classification and refreshes later category changes', () => {
  const { definitions, result, state } = fixture();
  state.rules['content.f2p'] = true;
  let selectorReads = 0;
  definitions.codeItems.itemsPlus = new Proxy(definitions.codeItems.itemsPlus, {
    get(target, key) { selectorReads++; return Reflect.get(target, key); },
  });
  selectorReads = 0;
  const fast = evaluateEquipment(result, state, 'one', definitions), fastReads = selectorReads;
  selectorReads = 0;
  const reference = evaluateEquipment(result, state, 'one', definitions, { reuse: false }), referenceReads = selectorReads;
  equalBytes(fast, reference);
  assert.ok(fastReads < referenceReads, `${fastReads} selector reads should be fewer than ${referenceReads}`);
  result.tasks[0].category = 'Extra';
  result.tasks[0].record.Category = ['BIS Skilling'];
  definitions.equipment['Fixture member tool'].members = false;
  equalBytes(evaluateEquipment(result, state, 'one', definitions),
    evaluateEquipment(result, state, 'one', definitions, { reuse: false }));
  assert.ok(evaluateEquipment(result, state, 'one', definitions).specialist.skilling.unranked
    .some(task => task.id === 'irrelevant 0'));
});
