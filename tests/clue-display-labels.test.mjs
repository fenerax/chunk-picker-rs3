// @test dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskEngine, taskId, plainLabel } from '../app/tasks/engine.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { predictChunk } from '../app/core/planning.mjs';
import { clueLabelCases, clueLabelDefinitions } from './fixtures/clue-labels.mjs';

test('clue display labels use tier/type context and keep raw identity inputs', () => {
  const definitions = clueLabelDefinitions(), before = structuredClone(definitions);
  const engine = createTaskEngine(definitions);
  for (const [, , rawLabel, expected] of clueLabelCases) {
    const record = definitions.challenges.Nonskill[rawLabel];
    const row = engine.catalogue.find(row => row.id === taskId('Nonskill', rawLabel, record));
    assert.equal(row.label, expected);
    assert.equal(row.rawLabel, rawLabel);
    assert.equal(row.category, 'Nonskill');
  }
  assert.deepEqual(definitions, before);
  assert.equal(plainLabel('Bow by the ~|gate|~*'), 'Bow by the gate');
});

test('ordinary rows and incomplete clue metadata keep their original plain labels', () => {
  const definitions = clueLabelDefinitions();
  definitions.challenges.Nonskill = { 'Use ~|gate|~*': {}, 'Tier only': { ClueTier: 'elite' }, 'Type only': { ClueType: 'Scan' } };
  assert.deepEqual(createTaskEngine(definitions).catalogue.filter(row => row.kind === 'task').map(row => row.label),
    ['Use gate', 'Tier only', 'Type only']);
});

test('synthetic chunk Preview delta carries prefixed clue labels without changing saved ticks', () => {
  const engine = createTaskEngine(clueLabelDefinitions());
  const state = createGroupState([{ id: 'synthetic', name: 'Explorer', unlocked: ['1'] }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const ticked = engine.catalogue.find(row => row.rawLabel === clueLabelCases[0][2]).id;
  state.members[0].completedTasks = [ticked];
  const before = structuredClone(state);
  const world = { chunks: new Map([['1', {}], ['2', {}]]), surface: new Set(['1', '2']) };
  const prediction = predictChunk(state, 'synthetic', '2', { world, engine });
  assert.deepEqual(prediction.delta.tasksAdded.map(row => row.label).sort(), clueLabelCases.map(row => row[3]).sort());
  assert.equal(prediction.result.tasks.find(row => row.id === ticked).personalCompleted, true);
  assert.deepEqual(state, before);
});
