import test from 'node:test';
import assert from 'node:assert/strict';

// Select before app imports. Synthetic definitions only; no server or save files.
process.env.RS3_DATASET = 'open-f2p';
const { createTaskEngine } = await import('../app/tasks/engine.mjs');
const { createGroupState, applyCommand } = await import('../app/core/state.mjs');

const state = () => createGroupState([{ id: 'a', name: 'A', unlocked: ['12850'] }]);
const definitions = record => ({ chunks: { '12850': {} }, challenges: {
  Quest: { 'Fixture quest': { PickerId: 'rs3:task:manual-check-fixture', Chunks: ['12850'], ...record } },
  Extra: { 'After fixture': { Tasks: { 'Fixture quest': 'Quest' } } },
} });
const quest = result => result.tasks.find(row => row.category === 'Quest');
const followup = result => result.tasks.find(row => row.label === 'After fixture');

test('manual checks explain unreviewed locations without granting reachable rewards or prerequisites', () => {
  const reasons = ['Check the unreviewed interior in-game.', 'Confirm the remaining quest stage.'];
  const engine = createTaskEngine(definitions({ ManualChecks: reasons, Output: ['Fixture output'], Reward: ['Fixture reward'],
    QuestPoints: 2, XpReward: { Mining: 10000 } }));
  const result = engine.evaluate(state(), 'a');
  assert.equal(quest(result).status, 'blocked');
  assert.deepEqual(quest(result).blockers, reasons.map(detail => ({ kind: 'manual-check', detail })));
  assert.equal(followup(result).status, 'blocked');
  assert.ok(!result.items.some(row => row.name.startsWith('Fixture ')));
  assert.equal(result.points.QuestPointsNeeded, 0);
  assert.equal(result.training.Mining.passiveLevel, 1);
  assert.equal(result.metrics.unsupportedCount, 0);
  assert.ok(result.coverage.supportedFields.includes('ManualChecks'));
  assert.deepEqual(reasons, ['Check the unreviewed interior in-game.', 'Confirm the remaining quest stage.']);
  const gated = createTaskEngine(definitions({ ManualChecks: reasons, Items: ['Fixture supply'], Skills: { Mining: 10 } })).evaluate(state(), 'a');
  assert.deepEqual(quest(gated).blockers.map(row => row.kind), ['manual-check', 'manual-check', 'items', 'training'],
    'Manual checks retain explanations of real item and skill requirements');
});

test('personal completion and Undo retain the existing evidence path for manual checks', () => {
  const engine = createTaskEngine(definitions({ ManualChecks: ['Confirm the interior in-game.'], Reward: ['Fixture reward'] }));
  const before = state();
  const task = quest(engine.evaluate(before, 'a'));
  const options = { now: () => '2026-10-14T12:00:00.000Z', taskCatalogue: [{ id: task.id, category: task.category, label: task.label }] };
  const completed = applyCommand(before, { type: 'complete-task', memberId: 'a', taskId: task.id, completed: true }, options);
  const result = engine.evaluate(completed, 'a');
  assert.equal(quest(result).personalCompleted, true);
  assert.equal(quest(result).status, 'available');
  assert.equal(followup(result).status, 'available');
  assert.ok(result.items.some(row => row.name === 'Fixture reward'));
  assert.deepEqual(before.members[0].completedTasks, []);
  const undone = applyCommand(completed, { type: 'undo' }, options);
  const restored = engine.evaluate(undone, 'a');
  assert.equal(quest(restored).personalCompleted, false);
  assert.equal(quest(restored).status, 'blocked');
  assert.equal(followup(restored).status, 'blocked');
  assert.ok(!restored.items.some(row => row.name === 'Fixture reward'));
});

test('malformed manual checks fail closed even with a recorded completion', () => {
  for (const ManualChecks of [null, false, '', 'Check the interior.', {}, [null], [''], ['   '], ['Check', 1]]) {
    const engine = createTaskEngine(definitions({ ManualChecks, Reward: ['Fixture reward'] }));
    const saved = state();
    const id = quest(engine.evaluate(saved, 'a')).id;
    saved.members[0].completedTasks.push(id);
    const result = engine.evaluate(saved, 'a');
    assert.equal(quest(result).status, 'unsupported', JSON.stringify(ManualChecks));
    assert.equal(quest(result).personalCompleted, true);
    assert.ok(quest(result).blockers.some(row => row.kind === 'unsupported' && row.detail.includes('Invalid ManualChecks')));
    assert.equal(followup(result).status, 'blocked');
    assert.ok(!result.items.some(row => row.name === 'Fixture reward'));
  }
});

test('omitted and empty manual checks preserve ordinary reachable dependency semantics', () => {
  for (const record of [{}, { ManualChecks: [] }]) {
    const result = createTaskEngine(definitions(record)).evaluate(state(), 'a');
    assert.equal(quest(result).status, 'available');
    assert.equal(quest(result).personalCompleted, false);
    assert.equal(followup(result).status, 'available');
  }
});

const firstId = 'rs3:task:completed-prerequisite-first';
const secondId = 'rs3:task:completed-prerequisite-second';
const completionDefinitions = (CompletedTasks = [firstId, secondId], first = {}) => ({ chunks: { '12850': {} }, challenges: {
  Quest: {
    'First prerequisite': { PickerId: firstId, Chunks: ['12850'], ...first },
    'Second prerequisite': { PickerId: secondId, Chunks: ['12850'] },
    'Dependent quest': { PickerId: 'rs3:task:completed-prerequisite-dependent', Chunks: ['12850'], CompletedTasks, Reward: ['Fixture quest reward'] },
  },
} });
const dependent = result => result.tasks.find(row => row.label === 'Dependent quest');

test('completed task prerequisites require every personal completion and support command Undo', () => {
  const engine = createTaskEngine(completionDefinitions());
  let saved = state();
  const catalogue = engine.catalogue.map(({ id, category, label }) => ({ id, category, label }));
  const options = { now: () => '2026-10-14T12:00:00.000Z', taskCatalogue: catalogue };
  let result = engine.evaluate(saved, 'a');
  assert.equal(result.tasks.find(row => row.id === firstId).status, 'available');
  assert.equal(dependent(result).status, 'blocked', 'Reachable prerequisites do not prove completion');
  assert.equal(dependent(result).blockers.filter(row => row.kind === 'personal-completion').length, 2);
  saved = applyCommand(saved, { type: 'complete-task', memberId: 'a', taskId: firstId, completed: true }, options);
  result = engine.evaluate(saved, 'a');
  assert.equal(dependent(result).status, 'blocked');
  assert.match(dependent(result).explanation, /Second prerequisite/);
  assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
  saved = applyCommand(saved, { type: 'complete-task', memberId: 'a', taskId: secondId, completed: true }, options);
  result = engine.evaluate(saved, 'a');
  assert.equal(dependent(result).status, 'available');
  assert.ok(result.items.some(row => row.name === 'Fixture quest reward'));
  result = engine.evaluate(applyCommand(saved, { type: 'undo' }, options), 'a');
  assert.equal(dependent(result).status, 'blocked');
  assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
});

test('partner and challenge completion never satisfy personal completed-task prerequisites', () => {
  const engine = createTaskEngine(completionDefinitions());
  for (const scope of ['any', 'all', 'personal']) {
    const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12850'] }, { id: 'b', name: 'B', unlocked: ['12850'] }]);
    saved.rules['tasks.completion'] = scope;
    saved.members[1].completedTasks = [firstId, secondId];
    saved.members[0].taskStatus = { [firstId]: { challengeCompleted: true }, [secondId]: { challengeCompleted: true } };
    assert.equal(dependent(engine.evaluate(saved, 'a')).status, 'blocked', scope);
    assert.equal(dependent(engine.evaluate(saved, 'b')).status, 'available', scope);
  }
});

test('invalid completion requirements cannot publish rewards even when manually checked', () => {
  for (const CompletedTasks of [null, false, '', firstId, {}, [null], [''], ['   '], ['Fixture quest'], ['rs3:task:missing'], [firstId, 1]]) {
    const engine = createTaskEngine(completionDefinitions(CompletedTasks));
    const saved = state();
    saved.members[0].completedTasks = [firstId, secondId, 'rs3:task:completed-prerequisite-dependent'];
    const result = engine.evaluate(saved, 'a');
    assert.equal(dependent(result).status, 'unsupported', JSON.stringify(CompletedTasks));
    assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
  }
  const engine = createTaskEngine(completionDefinitions([firstId], { ManualChecks: null }));
  const saved = state(); saved.members[0].completedTasks = [firstId];
  const result = engine.evaluate(saved, 'a');
  assert.equal(dependent(result).status, 'unsupported', 'An unsupported completed prerequisite is not evidence');
  assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
  assert.equal(dependent(createTaskEngine(completionDefinitions([])).evaluate(state(), 'a')).status, 'available');
});

test('unsupported completion targets fail closed transitively even when every dependent is checked', () => {
  const data = completionDefinitions([secondId], { ManualChecks: null });
  data.challenges.Quest['Second prerequisite'].CompletedTasks = [firstId];
  const engine = createTaskEngine(data), saved = state();
  saved.members[0].completedTasks = engine.catalogue.map(row => row.id);
  const result = engine.evaluate(saved, 'a');
  assert.ok(result.tasks.every(row => row.status === 'unsupported'));
  assert.match(dependent(result).explanation, /Second prerequisite.*unsupported requirements/);
  assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
});

test('supported completion cycles need personal evidence and do not infer completion', () => {
  const data = completionDefinitions([secondId]);
  data.challenges.Quest['First prerequisite'].CompletedTasks = [secondId];
  data.challenges.Quest['Second prerequisite'].CompletedTasks = [firstId];
  const engine = createTaskEngine(data), saved = state();
  let result = engine.evaluate(saved, 'a');
  assert.ok(result.tasks.every(row => row.status === 'blocked'));
  assert.ok(!result.items.some(row => row.name === 'Fixture quest reward'));
  saved.members[0].completedTasks = [firstId];
  result = engine.evaluate(saved, 'a');
  assert.equal(result.tasks.find(row => row.id === secondId).status, 'available');
  assert.equal(dependent(result).status, 'blocked', 'An available prerequisite still lacks completion evidence');
  saved.members[0].completedTasks.push(secondId);
  assert.equal(dependent(engine.evaluate(saved, 'a')).status, 'available');
});
