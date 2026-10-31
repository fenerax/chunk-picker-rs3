import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { selectPresentedTasks, selectEquipmentRecommendations, buildEquipmentCatalogue } from '../app/tasks/presentation.mjs';
import { migrateGameplay } from '../app/tasks/migration.mjs';

const task = (category, name, level = 1, record = {}, extras = {}) => ({ id: taskId(category, name), category, rawLabel: name, label: name, level, status: 'available', record: { Level: level, ...record }, ...extras });
const state = rules => ({ members: [{ id: 'a', sourceMapId: 'demo', unlocked: ['1'], completedTasks: [], taskRules: rules ?? {} }] });
const result = tasks => ({ tasks, items: [], access: {}, training: {} });
const names = presentation => presentation.tasks.map(row => row.rawLabel);
const select = (tasks, rules, definitions) => selectPresentedTasks(result(tasks), state(rules), 'a', definitions);

test('Highest Level governs competing processing recipes rather than skill row count', () => {
  const tasks = [task('Cooking', 'Simple use', 10, { Items: ['Fish'], Primary: true }), task('Cooking', 'Elaborate use', 30, { Items: ['Fish'], Primary: true }), task('Cooking', 'Different ingredient', 20, { Items: ['Egg'], Primary: true })];
  const input = { ...result(tasks), items: [{ name: 'Fish', sources: [{ kind: 'spawn' }] }, { name: 'Egg', sources: [{ kind: 'shop' }] }] };
  assert.deepEqual(names(selectPresentedTasks(input, state({ 'Highest Level': false }), 'a')), ['Different ingredient']);
  const highest = selectPresentedTasks(input, state({ 'Highest Level': true }), 'a');
  assert.deepEqual(names(highest), ['Elaborate use']);
  assert.equal(highest.tasks.length, 1);
});

test('processing aliases group only actually available inputs, preserving unrelated methods', () => {
  const tasks = [task('Crafting', 'Low', 10, { Items: ['Materials[+]'], Primary: true }), task('Crafting', 'High', 20, { Items: ['Clay'], Primary: true }), task('Crafting', 'Unique', 30, { Items: ['Gem'], Primary: true })];
  const data = { ...result(tasks), items: ['Clay', 'Gem'].map(name => ({ name, sources: [{ kind: 'spawn' }] })) };
  const selected = selectPresentedTasks(data, state(), 'a', { codeItems: { itemsPlus: { 'Materials[+]': ['Clay', 'Missing'] } } });
  assert.deepEqual(names(selected), ['Unique']);
  // Gem independently establishes a level-30 frontier, so High remains a usable
  // source recipe; only the highest active Crafting goal replaces its display.
  assert.match(selected.suppressed[tasks[1].id][0], /higher.*skill|higher.*level/i);
});

test('BIS Skilling hides active equipment and relic goals while preserving their source catalogue', () => {
  const definitions = { chunks: { '1': { Shop: { 'Tool shop': true } } }, shopItems: { 'Tool shop': { 'Synthetic pickaxe': true, 'Synthetic relic': true } }, codeItems: {}, sections: {}, challenges: {
    Extra: {
      'Obtain pickaxe': { Category: ['BIS Skilling'], Items: ['Synthetic pickaxe'], Output: 'Tool token' },
      'Unlock relic': { Category: ['BIS Skilling', 'BIS Skilling Relics'], Items: ['Synthetic relic'] },
      'Unrelated goal': {},
    },
  } };
  const saved = state({ 'BIS Skilling': false }), evaluated = createTaskEngine(definitions).evaluate(saved, 'a');
  const before = structuredClone(evaluated);
  const selected = selectPresentedTasks(evaluated, saved, 'a', definitions);
  assert.deepEqual(names(selected), ['Unrelated goal']);
  // BIS Skilling Relics inherits Off from BIS Skilling in the engine; the plain BIS goal is only hidden.
  assert.deepEqual(evaluated.tasks.filter(row => row.category === 'Extra').map(row => row.status), ['available', 'blocked', 'available']);
  assert.ok(evaluated.items.some(row => row.name === 'Tool token'));
  assert.match(selected.suppressed[taskId('Extra', 'Obtain pickaxe')][0], /BIS Skilling rule/);
  assert.deepEqual(evaluated, before);
  saved.members[0].taskRules['BIS Skilling'] = true;
  assert.deepEqual(names(selectPresentedTasks(createTaskEngine(definitions).evaluate(saved, 'a'), saved, 'a', definitions)), ['Obtain pickaxe', 'Unlock relic', 'Unrelated goal']);
});

test('partial products, herb cleaning, shortcuts, and never-show metadata affect presentation only', () => {
  const tasks = [task('Cooking', 'Component', 10, { Partial: true, Primary: true }), task('Herblore', 'Clean a herb', 10, { Primary: true }), task('Agility', 'Shortcut', 10, { Category: ['Shortcut'], Primary: true }), task('Mining', 'Internal', 20, { NeverShow: true }), task('Extra', 'Keep')];
  assert.deepEqual(names(select(tasks, { 'Multi Step Processing': true, 'Hide Partial Products': true, 'Cleaning Herbs': false, 'Shortcut Task': false })), ['Keep']);
  assert.ok(tasks.every(row => row.status === 'available'));
});

test('percent boosts use the target level, including the reduced-level recalculation', () => {
  const target = task('Cooking', 'Target', 60);
  const input = { ...result([target]), items: [{ name: 'Potion', sources: [] }] };
  const selected = selectPresentedTasks(input, state({ Boosting: true }), 'a', { codeItems: { boostItems: { Cooking: { Potion: '10%+3' } } } });
  assert.equal(selected.effectiveLevels[target.id], 52);
});

test('opaque processing recipes are diagnosed and retained rather than arbitrarily discarded', () => {
  const tasks = [task('Cooking', 'Complex', 50, { Items: ['Food'], Primary: true })];
  const input = { ...result(tasks), items: [{ name: 'Food', sources: [{ kind: 'task', category: 'Nonskill' }] }] };
  const selected = selectPresentedTasks(input, state(), 'a');
  assert.deepEqual(names(selected), ['Complex']);
  assert.ok(selected.diagnostics.some(row => row.kind === 'unsupported-processing-presentation'));
});

