import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { classifyTest, selectTests } from '../scripts/test-selection.mjs';
import { run, generate, oracle, engineOptions, stableResult, semanticResult,
  defaultCases, defaultSeed, oracleExceptions, shrinkFixture } from './helpers/picker-properties.mjs';
import { state, pair, preferred, skillGoals, processing, completedRoot, diary, restrictedSource, row } from './helpers/picker-property-cases.mjs';

test('1,000 fixed-seed synthetic saves satisfy the scoped picker invariants', () => {
  const result = run();
  console.log(JSON.stringify(result));
  assert.equal(result.failureCount, 0, JSON.stringify(result));
  assert.equal(result.cases, defaultCases);
  assert.equal(result.seed, defaultSeed);
  assert.equal(defaultCases, 1000);
  assert.equal(defaultSeed, 163643374);
  assert.ok(result.coverage.solo > 400 && result.coverage.duo > 400);
  assert.ok(result.checks['unlock-order-semantics'] > 900);
  assert.ok(result.checks['completion-stays-absent'] > 500);
  assert.ok(result.checks['grounded-pool'] > 1000);
  assert.ok(result.checks['grounded-eligibility'] > 10000);
  assert.equal(result.checks['task-row-present'], result.checks['grounded-eligibility']);
  assert.equal(result.checks['input-immutable'], defaultCases);
});

test('property checker is retained by full and excluded from quick', () => {
  const file = 'picker-properties.test.mjs';
  assert.equal(classifyTest(file), 'full-only');
  assert.deepEqual(selectTests(['state.test.mjs', file], 'quick'), ['state.test.mjs']);
  assert.deepEqual(selectTests(['state.test.mjs', file], 'full'), [file, 'state.test.mjs']);
});

test('generator and independent oracle reproduce each seed', () => {
  assert.deepEqual(generate(42), generate(42));
  const fixture = generate(42), member = fixture.state.members[0];
  assert.deepEqual([...oracle(fixture.definitions, member)], [...oracle(fixture.definitions, member)]);
  assert.notDeepEqual(generate(42), generate(43));
  for (const options of [{ cases: 0 }, { cases: 1.5 }, { seed: -1 }, { seed: 2 ** 32 }]) {
    assert.throws(() => run(options), /Invalid cases or seed/);
  }
});

test('oracle rejects unmodelled rules and named exception families instead of waiving failures', () => {
  for (const [definitions, reason] of [
    [processing(), oracleExceptions.processing], [restrictedSource(), oracleExceptions.sources],
    [preferred(), oracleExceptions.preferred], [diary(), oracleExceptions.diary], [skillGoals(), oracleExceptions.goals],
  ]) {
    assert.throws(() => oracle(definitions, state().members[0]), error => error.message === `Outside positive oracle: ${reason}`);
  }
  const fixture = generate(42), member = fixture.state.members[0];
  const record = Object.values(fixture.definitions.challenges).flatMap(Object.values)[0];
  record.NewSelectionRule = true;
  assert.throws(() => oracle(fixture.definitions, member), /task.NewSelectionRule/);
  delete record.NewSelectionRule;
  record.RequirementAlternatives = [{ Items: ['unmodelled'] }];
  assert.throws(() => oracle(fixture.definitions, member), /alternative.Items/);
  delete record.RequirementAlternatives;
  member.primaryOverrides = { Crafting: true };
  assert.throws(() => oracle(fixture.definitions, member), /member.primaryOverrides/);
});

test('oracle independently distinguishes AND, counted alternatives, skill OR and personal completion gates', () => {
  const definitions = { chunks: { 100: { Spawn: { A: 1, B: 1 } } },
    codeItems: { itemsPlus: { 'Parts[+]': ['A', 'B'] } }, challenges: {
      Nonskill: { Self: { PickerId: 'rs3:task:self', Tasks: { Self: 'Nonskill' }, Output: 'Seed' } },
      Extra: {
        Counted: { PickerId: 'rs3:task:counted', Items: ['Parts[+]x2'], Requirements: { Mining: 10 },
          RequirementAlternatives: [{ Skills: { Crafting: 5 } }, { Skills: { Mining: 20 } }] },
        TooMany: { PickerId: 'rs3:task:too-many', Items: ['Parts[+]x3'] },
        Personal: { PickerId: 'rs3:task:personal', CompletedTasks: ['rs3:task:self'] },
        Chain: { PickerId: 'rs3:task:chain', Tasks: { Self: 'Nonskill' }, Items: ['Seed'] },
        And: { PickerId: 'rs3:task:and', Items: ['A'], NPCs: ['Missing'] },
      },
    } };
  const saved = state(), member = saved.members[0];
  member.passiveLevels = { Mining: 10, Crafting: 5 };
  const engine = createTaskEngine(definitions, engineOptions);
  const expect = ids => {
    assert.deepEqual([...oracle(definitions, member)].sort(), ids.toSorted());
    assert.deepEqual(engine.evaluate(saved, 'a').tasks.filter(row => row.status === 'available').map(row => row.id).sort(), ids.toSorted());
  };
  expect(['rs3:task:self', 'rs3:task:counted', 'rs3:task:chain']);
  member.passiveLevels.Crafting = 1;
  expect(['rs3:task:self', 'rs3:task:chain']);
  member.passiveLevels.Mining = 20;
  member.completedTasks.push('rs3:task:self');
  expect(['rs3:task:self', 'rs3:task:counted', 'rs3:task:chain', 'rs3:task:personal']);
});

test('shrinker removes unrelated synthetic data while preserving a failure and valid dependencies', () => {
  const fixture = { definitions: { chunks: { 100: {}, 101: { Spawn: { Noise: 1 } } }, challenges: { Extra: {
    Root: { PickerId: 'root' }, Target: { PickerId: 'target', Tasks: { Root: 'Extra' } }, Noise: { PickerId: 'noise' },
  } } }, state: { rules: { 'content.f2p': false, 'access.shared': false }, taskRules: { 'Show Nonskill Tasks': true },
    members: [{ id: 'a', unlocked: ['100'], completedTasks: [], passiveLevels: { Mining: 2 } }] } };
  const original = structuredClone(fixture);
  const fails = candidate => candidate.definitions.challenges.Extra?.Target?.Tasks?.Root === 'Extra';
  const shrunk = shrinkFixture(fixture, fails, 1000);
  assert.deepEqual(fixture, original);
  assert.equal(fails(shrunk.fixture), true);
  assert.deepEqual(Object.keys(shrunk.fixture.definitions.challenges.Extra), ['Root', 'Target']);
  assert.ok(!Object.hasOwn(shrunk.fixture.definitions.chunks, '101'));
  assert.ok(shrunk.reductions > 0);
  assert.equal(shrunk.exhausted, false);
  assert.ok(oracle(shrunk.fixture.definitions, shrunk.fixture.state.members[0]).has('target'));
  const bounded = shrinkFixture(fixture, fails, 1);
  assert.equal(bounded.attempts, 1);
  assert.equal(bounded.exhausted, true);
});

test('a resource cycle requires an independent root; completion is historical proof', () => {
  const definitions = { chunks: { 100: {}, 101: { Spawn: { 'X09 A': 1 } } }, challenges: { Nonskill: {
    A: { PickerId: 'rs3:task:x09-a', Items: ['X09 B'], Output: 'X09 A' },
    B: { PickerId: 'rs3:task:x09-b', Items: ['X09 A'], Output: 'X09 B' },
  } } };
  const saved = state(), engine = createTaskEngine(definitions, engineOptions);
  assert.ok(engine.evaluate(saved, 'a').tasks.every(task => task.status === 'blocked'));
  assert.equal(oracle(definitions, saved.members[0]).size, 0);
  saved.members[0].unlocked.push('101');
  assert.ok(engine.evaluate(saved, 'a').tasks.every(task => task.status === 'available'));
  assert.equal(oracle(definitions, saved.members[0]).size, 2);
  saved.members[0].unlocked = ['100']; saved.members[0].completedTasks = ['rs3:task:x09-a'];
  assert.ok(engine.evaluate(saved, 'a').tasks.every(task => task.status === 'available'));
  assert.equal(oracle(definitions, saved.members[0]).size, 2);
});

test('preferred Extra sets deliberately violate unconditional unlock monotonicity', () => {
  const result = pair(preferred(), state(), saved => saved.members[0].unlocked.push('101'));
  assert.equal(row(result.before, 'Low').status, 'available');
  assert.equal(row(result.after, 'Low').status, 'blocked');
  assert.equal(row(result.after, 'Low').blockers[0].kind, 'outclassed');
  assert.deepEqual(result.before.pool.map(task => task.label), ['Low']);
  assert.deepEqual(result.after.pool.map(task => task.label), ['High']);
});

test('higher skill goals replace lower displayed goals while eligibility grows', () => {
  const result = pair(skillGoals(), state(), saved => { saved.members[0].passiveLevels.Mining = 10; });
  assert.equal(row(result.before, 'Low').status, 'available');
  assert.equal(row(result.after, 'Low').status, 'available');
  assert.deepEqual(result.before.pool.map(task => task.label), ['Low']);
  assert.deepEqual(result.after.pool.map(task => task.label), ['High']);
});

for (const bySkill of [false, true]) test(`processing frontier retracts supplies after ${bySkill ? 'skill growth' : 'unlock'}`, () => {
  const saved = state(); saved.members[0].primaryOverrides = { Crafting: true };
  const result = pair(processing(bySkill), saved, after => {
    if (bySkill) after.members[0].passiveLevels.Mining = 10;
    else after.members[0].unlocked.push('101');
  });
  assert.equal(row(result.before, 'Consumer').status, 'available');
  assert.equal(row(result.after, 'Consumer').status, 'blocked');
  assert.equal(row(result.after, 'High').sourceEligible, false);
  assert.ok(!result.after.result.items.some(item => item.name === 'X09 high output'));
});

test('a completed objective can lack a current unlocked-chunk path and stays out of the pool', () => {
  const result = pair(completedRoot(), state(), saved => saved.members[0].completedTasks.push('rs3:task:x09-historic'));
  assert.equal(row(result.before, 'Historic').status, 'blocked');
  assert.equal(row(result.after, 'Historic').status, 'available');
  assert.equal(result.after.pool.length, 0);
});

test('two empty chunks change raw access ordering while preserving picker semantics', () => {
  const definitions = { chunks: { 100: {}, 101: {} }, challenges: {} }, saved = state();
  saved.members[0].unlocked.push('101');
  const engine = createTaskEngine(definitions, engineOptions), before = engine.evaluate(saved, 'a');
  const afterState = structuredClone(saved); afterState.members[0].unlocked.reverse();
  const after = engine.evaluate(afterState, 'a');
  assert.notEqual(stableResult(before), stableResult(after));
  assert.deepEqual(before.access.bases, ['100', '101']);
  assert.deepEqual(after.access.bases, ['101', '100']);
  assert.equal(semanticResult(before, saved, 'a', definitions), semanticResult(after, afterState, 'a', definitions));
});

test('an available diary parent replaces its same-family child in the active pool', () => {
  const result = pair(diary(), state(), saved => saved.members[0].unlocked.push('101'));
  assert.deepEqual(result.before.pool.map(task => task.label), ['Child']);
  assert.deepEqual(result.after.pool.map(task => task.label), ['Parent']);
  assert.equal(row(result.after, 'Child').status, 'available');
});

test('redundant NoXp source suppression can block a source-restricted consumer', () => {
  const result = pair(restrictedSource(), state(), saved => saved.members[0].unlocked.push('101'));
  assert.equal(row(result.before, 'Consumer').status, 'available');
  assert.equal(row(result.after, 'Consumer').status, 'blocked');
  assert.equal(row(result.after, 'Producer').sourceEligible, false);
  assert.ok(result.after.result.items.some(item => item.name === 'X09 output'));
});
