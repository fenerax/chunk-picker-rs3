import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { legacyTaskId } from '../app/tasks/identity.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { retainedTaskCorrections } from '../app/data/retained-task-corrections.mjs';

const state = taskRules => ({ rules: {}, taskRules, members: [{ id: 'm', unlocked: ['100'], completedTasks: [] }] });
const row = (result, category, name) => result.tasks.find(task => task.id === taskId(category, name));


test('renaming an explicitly identified task keeps old saved completion and status', () => {
  const id = 'rs3:task:rename-fixture', original = 'Make a bar', renamed = 'Make a bronze bar';
  const definitions = { chunks: { '100': {} }, challenges: { Smithing: { [renamed]: { PickerId: id } } } };
  const saved = state({});
  saved.members[0].completedTasks = [legacyTaskId('Smithing', original)];
  saved.members[0].taskStatus = { [legacyTaskId('Smithing', original)]: { challengeCompleted: true, favorite: true, note: 'Keep this note' } };
  saved.identityRegistry = { schemaVersion: 1, entries: { [id]: { id, category: 'Smithing', label: renamed, kind: 'task', aliases: [legacyTaskId('Smithing', original)] } },
    aliases: { [legacyTaskId('Smithing', original)]: id }, unresolved: [] };
  const before = structuredClone(saved), result = createTaskEngine(definitions).evaluate(saved, 'm');
  const task = result.tasks.find(value => value.id === id);
  assert.equal(task.label, renamed); assert.equal(task.personalCompleted, true); assert.equal(task.challengeSatisfied, true);
  assert.deepEqual(saved, before);
  assert.ok(!result.diagnostics.some(value => value.fields?.includes('PickerId')));
});





test('zero rare-drop amount includes all known monster and skill rates', () => {
  const engine = createTaskEngine({
    chunks: { 100: { Monster: { Rat: 1 } } },
    drops: { Rat: { Gem: { 1: '1/100000' } } },
    challenges: { Crafting: { Search: { Output: 'Cache' } }, Extra: { Use: { Items: ['Gem', 'Shard'] } } },
    skillItems: { Crafting: { Cache: { Shard: { 1: '1/100000' }, Boundary: { 1: '1/999999999999999' }, Beyond: { 1: '1/10000000000000000' } } } },
  });
  for (const rules of [{ 'Rare Drop Amount': '0' }, { 'Rare Drop Amount': 0 }, { rareDropNum: '1/0' }]) {
    const doc = state({ 'Rare Drop': false, ...rules });
    const saved = JSON.stringify(doc);
    const result = engine.evaluate(doc, 'm');
    assert.equal(row(result, 'Extra', 'Use').status, 'available');
    assert(result.items.some(item => item.name === 'Boundary'));
    assert(result.items.some(item => item.name === 'Beyond'));
    assert.equal(JSON.stringify(doc), saved);
  }
  const limited = engine.evaluate(state({ 'Rare Drop': false, 'Rare Drop Amount': '1000' }), 'm');
  assert.equal(row(limited, 'Extra', 'Use').status, 'blocked');
});










test('cancelling speculative scans leaves normal task calculation identical and unpoisoned', () => {
  const definitions = { chunks: { '100': {}, '101': {} }, challenges: { Quest: Object.fromEntries(
    Array.from({ length: 1200 }, (_, i) => [`Cancellation fixture ${i}`, { Chunks: [i % 2 ? '100' : '101'] }])) } };
  const saved = state({}), before = structuredClone(saved), engine = createTaskEngine(definitions);
  const cancelled = new Error('cancelled at a task checkpoint'); let checks = 0;
  assert.throws(() => engine.evaluate(saved, 'm', { reuseEligibility: false, checkpoint() { if (++checks === 3) throw cancelled; } }), e => e === cancelled);
  assert.equal(checks, 3); assert.deepEqual(saved, before);
  const normalize = result => JSON.parse(JSON.stringify(result, (key, value) => key === 'elapsedMs' ? undefined : value));
  assert.deepEqual(normalize(engine.evaluate(saved, 'm')), normalize(createTaskEngine(definitions).evaluate(saved, 'm')));
});
