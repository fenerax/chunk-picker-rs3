import test from 'node:test';
import assert from 'node:assert/strict';
import { taskRuleParents, independentTaskRuleControls } from '../app/data/settings.mjs';
import { taskRuleEnabled } from '../app/tasks/rule-defaults.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { withPortsScrollRule } from '../app/data/ports-scroll-rules.mjs';
import { buildRulesSections, rulesCatalogue, ruleEnabled, taskRuleValue, planTaskRuleChange } from '../app/web/rules-model.mjs';

const state = taskRules => ({ rules: { 'content.f2p': false }, members: [{ id: 'one', name: 'Player', unlocked: ['100'], completedTasks: [], taskRules }] });
const definitionsFor = doc => buildRulesSections(rulesCatalogue, doc).flatMap(section => section.rules);

test('every effective parent suppresses its child while saved On preferences survive', () => {
  const doc = state({}), definitions = definitionsFor(doc);
  for (const [child, parent] of Object.entries(taskRuleParents)) {
    const rules = { [child]: true, [parent]: false }, before = structuredClone(rules);
    assert.equal(taskRuleEnabled(rules, child), false, `${parent} Off -> ${child}`);
    const definition = definitions.find(row => row.id === child);
    assert.ok(definition, child);
    assert.equal(ruleEnabled(definition, new Map(Object.entries(rules)), definitions), false, child);
    rules[parent] = true;
    assert.equal(taskRuleEnabled(rules, child), true, `${parent} On -> ${child}`);
    assert.equal(rules[child], before[child], `${child} preference retained`);
  }
});

for (const [parent, children] of [
  ['Collection Log', ['Arc Log', 'Menaphos Log', 'Slayer Souls']],
  ['Skillcape', ['Master skillcape']],
  ['Unlock Abilities', ['Abilities', 'Sigil Abilities']],
  ['Unlock Prayers', ['Prayers']],
  ['Puro-Puro', ['Extra implings']],
]) test(`${parent} Off blocks child-tag-only goals, including unset children`, () => {
  const data = { chunks: { 100: {} }, challenges: { Extra: Object.fromEntries(children.map(child => [child + ' goal', { Category: [child], Primary: true }])) } };
  const engine = createTaskEngine(data);
  for (const explicit of [false, true]) {
    const rules = { [parent]: false, ...(explicit ? Object.fromEntries(children.map(child => [child, true])) : {}) };
    const doc = state(rules), before = structuredClone(doc);
    const off = engine.evaluate(doc, 'one');
    for (const child of children) assert.notEqual(off.tasks.find(task => task.rawLabel === child + ' goal').status, 'available', child);
    assert.deepEqual(doc, before);
    doc.members[0].taskRules[parent] = true;
    const on = engine.evaluate(doc, 'one');
    for (const child of children) assert.equal(on.tasks.find(task => task.rawLabel === child + ' goal').status, 'available', child);
  }
});

test('clearing a master-cape override under an Off parent remains ineffective', () => {
  const doc = state({ Skillcape: false }), definition = definitionsFor(doc).find(row => row.id === 'Master skillcape');
  assert.equal(taskRuleValue(doc, 'one', definition).value, true, 'automatic child value is retained');
  assert.equal(taskRuleEnabled(doc.members[0].taskRules, definition.id), false);
  const before = structuredClone(doc);
  assert.deepEqual(planTaskRuleChange(doc, ['one'], { id: 'Skillcape' }, true).commands,
    [{ type: 'set-task-rule', memberId: 'one', ruleId: 'Skillcape', value: true }]);
  assert.deepEqual(doc, before);
});

test('Hide Partial Products has no effect with Multi Step Processing Off', () => {
  const data = { chunks: { 100: {} }, challenges: { Herblore: { 'Train Herblore': { Level: 1, Primary: true }, 'Unfinished fixture': { Level: 10, Primary: true, Partial: true } } } };
  const engine = createTaskEngine(data), doc = state({ 'Multi Step Processing': false, 'Hide Partial Products': true });
  const evaluate = () => {
    const result = engine.evaluate(doc, 'one');
    assert.equal(result.tasks.find(row => row.rawLabel === 'Unfinished fixture').status, 'available');
    return selectPresentedTasks(result, doc, 'one', data).tasks.filter(row => row.rawLabel === 'Unfinished fixture').map(row => row.rawLabel);
  };
  assert.deepEqual(evaluate(), ['Unfinished fixture']);
  doc.members[0].taskRules['Hide Partial Products'] = false;
  assert.deepEqual(evaluate(), ['Unfinished fixture']);
  doc.members[0].taskRules['Multi Step Processing'] = true;
  doc.members[0].taskRules['Hide Partial Products'] = true;
  assert.deepEqual(evaluate(), []);
});

test('cutoffs and the deliberately independent key option retain their exceptions', () => {
  const rules = { 'Rare Drop': false, 'Secondary Primary': false, 'Kill X': false };
  const doc = state(rules), definitions = definitionsFor(doc);
  for (const id of independentTaskRuleControls) {
    assert.equal(ruleEnabled(definitions.find(row => row.id === id), new Map(Object.entries(rules)), definitions), true, id);
    assert.equal(taskRuleEnabled({ ...rules, [id]: true }, id), true, id);
  }
  for (const value of [false, 'false', 0]) assert.equal(taskRuleEnabled({ 'Collection Log': value, 'Arc Log': true }, 'Arc Log'), false);
});

test('all four Ports scroll acquisition goals honor Ports Scrolls without changing identity or recipe goals', () => {
  for (const [category, subject] of [['Crafting', 'Death Lotus'], ['Divination', 'scrimshaw'], ['Runecrafting', 'seasinger'], ['Smithing', 'tetsu']]) {
    const label = `Unlock the ~|${subject}|~ scrolls in the Ports Reward Shop`;
    const record = { Category: ['Timegated'], Primary: true };
    const patched = withPortsScrollRule(category, record, label);
    assert.deepEqual(record.Category, ['Timegated']);
    assert.deepEqual(patched.Category, ['Timegated', 'Ports Scrolls']);
    assert.equal(withPortsScrollRule(category, patched, label), patched);
    assert.equal(taskId(category, label, patched), taskId(category, label, record));
    assert.equal(withPortsScrollRule(category, record, 'Craft a fixture item'), record);
    const data = { chunks: { 100: {} }, challenges: { [category]: { [label]: record, 'Craft a fixture item': { Primary: true } } } };
    const engine = createTaskEngine(data), doc = state({ Timegated: true, 'Ports Scrolls': false, Minigame: false });
    assert.notEqual(engine.evaluate(doc, 'one').tasks.find(row => row.rawLabel === label).status, 'available', category);
    assert.equal(engine.evaluate(doc, 'one').tasks.find(row => row.rawLabel === 'Craft a fixture item').status, 'available', category);
    doc.members[0].taskRules['Ports Scrolls'] = true;
    assert.equal(engine.evaluate(doc, 'one').tasks.find(row => row.rawLabel === label).status, 'available', category);
    doc.members[0].taskRules.Timegated = false;
    assert.notEqual(engine.evaluate(doc, 'one').tasks.find(row => row.rawLabel === label).status, 'available', category);
  }
});
