import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { explainTask, taskExplanation } from '../app/tasks/task-provenance.mjs';
import { ruleExplanationFixture } from './fixtures/rule-explanations.mjs';

function evaluate(fixture = ruleExplanationFixture()) {
  const { definitions, state } = fixture, before = structuredClone(fixture);
  const result = createTaskEngine(definitions).evaluate(state, 'fixture');
  result.presentation = selectPresentedTasks(result, state, 'fixture', definitions);
  assert.deepEqual(fixture, before, 'evaluation does not mutate the authored inputs');
  return result;
}
const row = (result, label) => result.tasks.find(task => task.rawLabel === label);
const published = (result, name, producer) => result.items.find(item => item.name === name)?.sources.some(source => source.taskId === taskId('Crafting', producer)) ?? false;
const reasons = (result, task) => {
  const why = explainTask(task, { result });
  return [...why.hidden, ...(why.conditions ?? []).map(reason => reason.detail), ...(why.warnings ?? []).map(reason => reason.detail)].join(' ');
};
function surfaces(result, task, expected, absent) {
  for (const text of [taskExplanation(task, result), reasons(result, task)]) {
    assert.match(text, expected);
    if (absent) assert.doesNotMatch(text, absent);
  }
}

test('S01 local supply rejected by AllowedSources is explained as a source condition, with admission unchanged', () => {
  const fixture = ruleExplanationFixture(), rejected = evaluate(fixture), task = row(rejected, 'Fixture source consumer');
  assert.equal(task.status, 'blocked'); assert.equal(task.obligation, false);
  assert(rejected.items.some(item => item.name === 'Fixture supply'));
  assert(!rejected.presentation.tasks.some(item => item.id === task.id));
  surfaces(rejected, task, /Fixture supply.*allowed sources.*Fixture other producer/, /outside.*map|lower-level processing/i);
  fixture.definitions.challenges.Extra['Fixture source consumer'].AllowedSources = ['Fixture producer'];
  const admitted = evaluate(fixture), active = row(admitted, task.rawLabel);
  assert.equal(active.status, 'available'); assert.equal(active.obligation, true);
  assert(admitted.presentation.tasks.some(item => item.id === active.id));
  assert.equal(active.sourcePolicyRejections, undefined);
});

for (const [label, constraint, expected] of [
  ['S02', { NonShop: true }, /non-shop source/],
  ['S03', { Source: 'drop' }, /source channel.*drop/],
]) test(`${label} distinguishes rejected shop supply from physical absence`, () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Extra = { Consumer: { Items: ['Fixture stock'], ...constraint } };
  const result = evaluate(fixture), task = row(result, 'Consumer');
  assert.equal(task.status, 'blocked'); surfaces(result, task, expected, /outside.*map/i);
  delete fixture.definitions.challenges.Extra.Consumer[Object.keys(constraint)[0]];
  assert.equal(row(evaluate(fixture), 'Consumer').status, 'available');
});

test('S04 Source on an output record describes output and does not restrict input channels', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Extra = { Consumer: { Items: ['Fixture stock'], Source: 'drop', Output: 'Fixture loot' } };
  const task = row(evaluate(fixture), 'Consumer');
  assert.equal(task.status, 'available'); assert.equal(task.sourcePolicyRejections, undefined);
});

test('S05 AllowedSources and NonShop may use different admitted sources', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.chunks['12850'].Spawn['Fixture stock'] = 1;
  fixture.definitions.challenges.Extra = { Consumer: { Items: ['Fixture stock'], NonShop: true, AllowedSources: ['Fixture shop'] } };
  const task = row(evaluate(fixture), 'Consumer');
  assert.equal(task.status, 'available'); assert.equal(task.sourcePolicyRejections, undefined);
});

test('S06 crafted wielding restriction has its own reason and retains the enabling control', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Crafting = { Maker: { Level: 1, Primary: true, Items: ['Fixture input'], Output: 'Fixture gear' } };
  fixture.definitions.challenges.Attack = { Wield: { Level: 1, Primary: true, Items: ['Fixture gear'] } };
  const result = evaluate(fixture), task = row(result, 'Wield');
  assert.equal(task.status, 'blocked'); surfaces(result, task, /Wield Crafted Items/);
  fixture.state.taskRules['Wield Crafted Items'] = true;
  assert.equal(row(evaluate(fixture), 'Wield').status, 'available');
});

test('S07-S08 primary and frontier supplies are not reclassified as source-policy rejection', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Crafting = {
    Low: { Level: 1, Primary: true, Items: ['Fixture input'], Output: 'Fixture low' },
    High: { Level: 10, Primary: true, Items: ['Fixture input'], Output: 'Fixture high' },
  };
  const result = evaluate(fixture);
  assert.equal(row(result, 'Low').sourceEligible, undefined);
  assert.equal(row(result, 'High').sourceEligible, false);
  assert.equal(row(result, 'High').sourcePolicyRejections, undefined);
  assert.match(reasons(result, row(result, 'High')), /lower-level processing/);
  assert(published(result, 'Fixture low', 'Low')); assert(!published(result, 'Fixture high', 'High'));
});

test('X01 single no-XP recipe names its duplicate-output gate, without inventing a competing method', () => {
  const fixture = ruleExplanationFixture(), result = evaluate(fixture), task = row(result, 'Fixture duplicate recipe');
  assert.equal(task.status, 'available'); assert.equal(task.sourceEligible, false);
  assert(!published(result, 'Fixture product', task.rawLabel));
  surfaces(result, task, /no-XP.*Fixture product.*independent.*all.*outputs/i, /lower-level|frontier/);
  delete fixture.definitions.chunks['12850'].Spawn['Fixture product'];
  const admitted = evaluate(fixture);
  assert(published(admitted, 'Fixture product', task.rawLabel));
  assert.equal(row(admitted, task.rawLabel).sourceExclusion, undefined);
});

test('X02 one duplicate suppresses every output, including the unique output', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Crafting['Fixture duplicate recipe'].Output = ['Fixture product', 'Fixture unique'];
  const result = evaluate(fixture), task = row(result, 'Fixture duplicate recipe');
  assert(!published(result, 'Fixture unique', task.rawLabel));
  surfaces(result, task, /all.*outputs/i);
  assert.deepEqual(task.sourceExclusion.items, ['Fixture product']);
});

test('X03 personal completion bypasses the duplicate gate while satisfied goals stay hidden', () => {
  const fixture = ruleExplanationFixture();
  fixture.state.members[0].completedTasks.push(taskId('Crafting', 'Fixture duplicate recipe'));
  const result = evaluate(fixture), task = row(result, 'Fixture duplicate recipe');
  assert(published(result, 'Fixture product', task.rawLabel));
  assert.equal(task.sourceExclusion, undefined);
  assert(!result.presentation.tasks.some(item => item.id === task.id));
  assert.match(reasons(result, task), /satisfied/);
});

test('X04 tools-only no-XP recipes retain the duplicate gate and truthful reason', () => {
  const fixture = ruleExplanationFixture(); fixture.definitions.codeItems.tools = { 'Fixture input': true };
  const result = evaluate(fixture), task = row(result, 'Fixture duplicate recipe');
  assert.equal(task.sourceEligible, false); assert(!published(result, 'Fixture product', task.rawLabel));
  surfaces(result, task, /no-XP.*independent/i, /lower-level|frontier/);
});

test('x09 current policy: independent spawn suppresses no-XP producer and blocks its AllowedSources consumer', () => {
  const fixture = ruleExplanationFixture();
  fixture.definitions.challenges.Extra = { Consumer: { Items: ['Fixture product'], AllowedSources: ['Fixture duplicate recipe'] } };
  const result = evaluate(fixture), task = row(result, 'Consumer');
  assert.equal(task.status, 'blocked'); assert(!published(result, 'Fixture product', 'Fixture duplicate recipe'));
  surfaces(result, task, /allowed sources.*Fixture duplicate recipe/);
  delete fixture.definitions.chunks['12850'].Spawn['Fixture product'];
  const admitted = evaluate(fixture);
  assert.equal(row(admitted, 'Consumer').status, 'available');
});

for (const choice of ['Fixture missing choice', 'Fixture peer goal', null]) test(`G05 fallback versus valid or automatic choice: ${choice}`, () => {
  const fixture = ruleExplanationFixture(); fixture.state.members[0].taskAlternatives.Mining['5'] = choice;
  const result = evaluate(fixture), chosen = row(result, choice === 'Fixture peer goal' ? choice : 'Fixture ranked goal');
  assert(result.presentation.tasks.some(task => task.id === chosen.id));
  const warnings = explainTask(chosen, { result }).warnings ?? [];
  if (choice === 'Fixture missing choice') {
    assert.equal(result.presentation.diagnostics.filter(reason => reason.kind === 'unavailable-task-alternative').length, 1);
    surfaces(result, chosen, /saved task choice.*Fixture missing choice.*unavailable.*Fixture ranked goal/i);
    assert.equal(warnings.length, 1);
    assert.equal((explainTask(row(result, 'Fixture peer goal'), { result }).warnings ?? []).length, 0);
  } else { assert.equal(warnings.length, 0); assert(!result.presentation.diagnostics.some(reason => reason.kind === 'unavailable-task-alternative')); }
});

test('physical absence keeps its map explanation and does not invent a rejected source', () => {
  const fixture = ruleExplanationFixture();
  delete fixture.definitions.challenges.Nonskill;
  const result = evaluate(fixture), task = row(result, 'Fixture source consumer');
  assert.equal(task.status, 'blocked'); assert.equal(task.sourcePolicyRejections, undefined);
  assert.match(reasons(result, task), /Outside.*map/);
});

test('a historical saved choice ID uses its saved player-facing label in both surfaces', () => {
  const fixture = ruleExplanationFixture(), id = taskId('Mining', 'Fixture retired goal');
  fixture.state.tasks = [{ id, category: 'Mining', label: 'Fixture retired goal' }];
  fixture.state.members[0].taskAlternatives.Mining['5'] = id;
  const result = evaluate(fixture), task = row(result, 'Fixture ranked goal');
  surfaces(result, task, /saved task choice.*Fixture retired goal.*unavailable.*Fixture ranked goal/i);
  assert(!taskExplanation(task, result).includes(id));
});
