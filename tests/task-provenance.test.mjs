import test from 'node:test';
import assert from 'node:assert/strict';
import { explainTask, neededForChains, setStanding, categoryRuleIds } from '../app/tasks/task-provenance.mjs';

const rules = {
  'Gear Goals': { label: 'Gear Goals', section: 'Visible Tasks', on: true, source: 'Automatic' },
  'Show Quest Tasks': { label: 'Show Quest Tasks', section: 'Visible Tasks', on: true, source: 'Personal override' },
  'Rare Drop': { label: 'Rare Drop', section: 'Item Sources', on: true, source: 'Automatic' },
  'Rare Drop Amount': { value: '1000', on: true, source: 'Automatic' },
};
const describeRule = id => rules[id];
const lantern = { id: 'x:lantern', label: 'Obtain an ~|attuned lantern|~', rawLabel: 'Obtain an ~|attuned lantern|~', category: 'Extra', status: 'available', blockers: [],
  record: { Category: ['Gear Goals'], Label: 'Gear Goals', Set: 'Lantern set', Priority: 1 },
  sources: [{ kind: 'drop', source: 'Fixture ghost', location: 'Fixture cellar', rate: '1/2000', probability: 0.0005, item: 'Lantern' }] };
const plainLantern = { id: 'x:plain', label: 'Obtain a lantern', rawLabel: 'Obtain a lantern', category: 'Extra', status: 'blocked',
  blockers: [{ kind: 'outclassed', detail: 'Obtain an attuned lantern is the preferred reachable task in Lantern set.' }],
  record: { Category: ['Gear Goals'], Label: 'Gear Goals', Set: 'Lantern set', Priority: 2 } };
const step1 = { id: 'q:1', label: 'Fixture quest 1', rawLabel: 'Fixture quest 1', category: 'Quest', status: 'available', record: {} };
const step2 = { id: 'q:2', label: 'Fixture quest 2', rawLabel: 'Fixture quest 2', category: 'Quest', status: 'blocked', record: { Tasks: { 'Fixture quest 1': 'Quest' } } };
const finale = { id: 'q:3', label: 'Fixture finale', rawLabel: 'Fixture finale', category: 'Quest', status: 'blocked', record: { Tasks: { 'Fixture quest 2': 'Quest' } } };
const result = { tasks: [lantern, plainLantern, step1, step2, finale], presentation: { suppressed: { 'x:plain': ['Task is not available.'] } } };

test('an Extra gear goal names its rule, set and the rare drop that lets it count', () => {
  const why = explainTask(lantern, { result, describeRule });
  assert.deepEqual(why.rules.map(rule => [rule.label, rule.on, rule.source, rule.section]), [['Gear Goals', true, 'Automatic', 'Visible Tasks']]);
  assert.equal(why.label, 'Obtain an attuned lantern');
  assert.match(why.categoryNote, /outside skills, quests and diaries/);
  assert.deepEqual(why.set, { name: 'Lantern set', preferred: true, over: ['Obtain a lantern'] });
  assert.deepEqual(why.rareDrop, { label: 'Rare Drop', amount: 1000 });
  assert.equal(why.sources[0].text, 'Fixture ghost, Fixture cellar');
  const named = explainTask({ ...lantern, sources: [{ ...lantern.sources[0], location: ['1-2', '3-4'] }] }, { result, describeRule, locationName: id => id === '1-2' ? 'Fixture vault' : id });
  assert.equal(named.sources[0].text, 'Fixture ghost, Fixture vault');
  assert.equal(why.summary, 'Gear Goals');
});

test('the losing set member points at the preferred task', () => {
  assert.deepEqual(setStanding(plainLantern, result), { name: 'Lantern set', preferred: false, by: 'Obtain an attuned lantern' });
  assert.deepEqual(explainTask(plainLantern, { result, describeRule }).hidden, []);
});

test('needed-for chains follow dependents up to three steps and skip cycles', () => {
  assert.deepEqual(neededForChains(step1, result), [['Fixture quest 2', 'Fixture finale']]);
  assert.deepEqual(neededForChains(finale, result), []);
  const loop = { tasks: [{ ...step1, record: { Tasks: { 'Fixture quest 2': 'Quest' } } }, step2] };
  assert.deepEqual(neededForChains(loop.tasks[0], loop), [['Fixture quest 2']]);
});

test('category rules come first only when the record has no rule tags', () => {
  const why = explainTask(step1, { result, describeRule });
  assert.deepEqual(why.rules.map(rule => [rule.id, rule.reason]), [['Show Quest Tasks', 'category']]);
  assert.equal(why.summary, 'Show Quest Tasks');
  assert.deepEqual(categoryRuleIds('Woodcutting'), ['Skills', 'Show Skill Tasks', 'Woodcutting']);
  assert.deepEqual(categoryRuleIds('Extra'), []);
});

test('unknown tags stay internal and common drops need no Rare Drop note', () => {
  const common = { ...lantern, record: { Category: ['Internal tag'] }, sources: [{ kind: 'drop', source: 'Fixture rat', probability: 0.5, rate: '1/2' }] };
  const why = explainTask(common, { result, describeRule });
  assert.deepEqual(why.rules, []);
  assert.equal(why.rareDrop, undefined);
  assert.equal(why.summary, undefined);
});

test('presentation reasons other than unavailability are passed through', () => {
  const backlogged = { tasks: [step1], presentation: { suppressed: { 'q:1': ['Task is not available.', 'Task is backlogged.'] } } };
  assert.deepEqual(explainTask(step1, { result: backlogged, describeRule }).hidden, ['Task is backlogged.']);
});
