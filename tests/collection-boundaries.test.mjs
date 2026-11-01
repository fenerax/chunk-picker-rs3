import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionEngine } from '../app/tasks/collection.mjs';

const monster = 'Fixture creature', item = 'Fixture prize';
const definitions = {
  chunks: { '100': { Monster: { [monster]: true } } },
  drops: { [monster]: { 'Fixture outer table': { '1': 'Always' } } },
  codeItems: { dropTables: {
    'Fixture outer table': { 'RareDropTable+': { '1': 'Always' } },
    'RareDropTable+': { [item]: { '1': '1/2' } },
  } },
};
const state = taskRules => ({ rules: { 'content.f2p': false }, members: [{
  id: 'a', name: 'Player A', unlocked: ['100'], completedTasks: [], taskRules,
}] });

// Give collection admission independent source evidence so an upstream filter
// cannot hide a broken collection rule. This is the public evaluate() boundary.
for (const [name, backlogged, rdt, expected] of [
  ['unrestricted', false, true, 1],
  ['item backlog alone', true, true, 0],
  ['disabled rare table alone', false, false, 0],
]) test(`nested rare-table collection: ${name}`, () => {
  const saved = state({ 'Every Drop': true, RDT: rdt });
  const input = { tasks: [], access: { monsters: [monster], backloggedSources: { items: { [item]: backlogged } } },
    items: [{ name: item, sources: [{ kind: 'drop', source: monster, probability: 0.5 }] }] };
  const before = structuredClone({ saved, input });
  const result = createCollectionEngine(definitions).evaluate(saved, 'a', input);
  assert.deepEqual(result.tasks.map(row => row.item), expected ? [item] : []);
  assert.deepEqual({ saved, input }, before);
});

for (const evidence of ['primary', 'passive']) for (const level of [9, 10]) {
  test(`Kill X Slayer threshold: ${evidence} level ${level}`, () => {
    const saved = state({ 'Kill X': true, 'Kill X Amount': 1, Boosting: false });
    const input = { tasks: [], items: [], access: { monsters: [monster] }, training: { Slayer: evidence === 'primary'
      ? { primary: true, level, passiveLevel: 1 } : { primary: false, level, passiveLevel: level } } };
    const result = createCollectionEngine({ ...definitions, slayerMonsters: { [monster]: 10 } }).evaluate(saved, 'a', input);
    assert.deepEqual(result.tasks.map(row => row.monster), level === 10 ? [monster] : []);
  });
}
