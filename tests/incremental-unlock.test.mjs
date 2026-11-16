// @test solo dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { createEligibilityBudget } from '../app/tasks/eligibility-cache.mjs';

const definitions = {
  chunks: { 100: { Connect: { 101: true }, Spawn: { Ore: 1 } },
    101: { Connect: { 100: true, 102: true }, Object: { Furnace: 1 } },
    102: { Connect: { 101: true, 103: true }, Spawn: { Bar: 1 } },
    103: { Connect: { 102: true }, Monster: { Rat: 1 } } },
  drops: { Rat: { Gem: { 1: 'Always' } } },
  challenges: {
    Smithing: { 'Smelt fixture bar': { Level: 1, Items: ['Ore'], Objects: ['Furnace'], Output: 'Bar', NoXp: true },
      'Forge fixture token': { Level: 1, Items: ['Bar'], Output: 'Token' } },
    Extra: { 'Use fixture token': { Items: ['Token'] }, 'Use fixture gem': { Items: ['Gem'] },
      'Training fixture': { Skills: { Smithing: 10 }, Items: ['Ore'] } },
  },
};
const input = () => ({ rules: { 'content.f2p': false }, taskRules: {}, members: [
  { id: 'fixture-a', name: 'Fixture A', unlocked: ['100'], completedTasks: [] },
  { id: 'fixture-b', name: 'Fixture B', unlocked: [], completedTasks: [] },
] });
const normalized = result => JSON.parse(JSON.stringify({ ...result, processing: result.processing }, (key, value) => key === 'elapsedMs' ? undefined : value));
function equivalent(engine, state, member) {
  const actual = engine.evaluate(state, member);
  const reference = createTaskEngine(definitions, { incrementalUnlocks: false }).evaluate(state, member);
  assert.deepEqual(normalized(actual), normalized(reference));
  return actual;
}

test('unlock predicates preserve cold results through partner access and negative processing prerequisites', () => {
  const engine = createTaskEngine(definitions, { incrementalUnlocks: true }), state = input();
  for (const member of state.members) equivalent(engine, state, member.id);
  let reused = 0;
  for (const [owner, chunk] of [[1, '103'], [0, '101'], [1, '102'], [0, '102'], [0, '103']]) {
    state.members[owner].unlocked.push(chunk);
    for (const member of state.members) {
      const result = equivalent(engine, state, member.id);
      assert.equal(result.metrics.unlockCalculation.path, 'incremental');
      reused += result.metrics.unlockCalculation.reusedChecks;
    }
  }
  assert(reused > 0);
  const final = engine.evaluate(state, state.members[0].id);
  const recipe = taskId('Smithing', 'Smelt fixture bar');
  assert.equal(final.processing.sourceExclusions[recipe]?.kind, 'no-xp-duplicate-output');
});

test('changed progress, rules, ownership removal and evicted bases use full fallback', () => {
  const budget = createEligibilityBudget();
  const engine = createTaskEngine(definitions, { eligibilityBudget: budget, incrementalUnlocks: true }), state = input(), id = state.members[0].id;
  equivalent(engine, state, id);
  state.members[0].unlocked.push('101');
  assert.equal(equivalent(engine, state, id).metrics.unlockCalculation.path, 'incremental');
  state.taskRules['Multi Step Processing'] = true;
  assert.equal(equivalent(engine, state, id).metrics.unlockCalculation.path, 'full');
  state.members[0].completedTasks.push(taskId('Extra', 'Use fixture gem'));
  assert.equal(equivalent(engine, state, id).metrics.unlockCalculation.path, 'full');
  state.members[0].unlocked = ['100'];
  assert.equal(equivalent(engine, state, id).metrics.unlockCalculation.reason, 'not-an-unlock');
  // Evict every existing byte owner through the ordinary shared ledger.
  const pressure = {};
  assert(budget.admit(pressure, () => {}, { cost: budget.byteLimit }));
  budget.forget(pressure);
  state.members[0].unlocked.push('101');
  assert.equal(equivalent(engine, state, id).metrics.unlockCalculation.reason, 'missing-base');
  assert(budget.retentionLedger().dimensions.every(row => row.used <= row.cap));
});
