// @test quick dataset=default
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, importBackup, exportBackup, validateState, getUndoEligibility } from '../app/core/state.mjs';
import { memberDeparture } from '../app/core/member-departure.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';
import { createRuleRegistry, partnerConnections } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
const registry = createRuleRegistry(), at = '2026-01-01T00:00:00.000Z';
for (const size of [2, 3, 4, 5]) test(`per-player goal history validates each departure roster at size ${size}`, () => {
  let state = createGroupState(Array.from({ length: size }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i })));
  const command = value => { state = applyCommand(state, value, { registry, now: () => at }); };
  command({ type: 'add-group-goal', goalId: 'group-goal:epoch', text: 'Every current player', completion: 'players' });
  command({ type: 'set-group-goal-done', goalId: 'group-goal:epoch', done: true });
  for (let n = size - 1; n > 0; n--) {
    state = validateState(memberDeparture(state, 'p' + n, 'depart-' + n, at), registry);
    command({ type: 'set-group-goal-done', goalId: 'group-goal:epoch', memberId: 'p0', done: false });
    command({ type: 'set-group-goal-done', goalId: 'group-goal:epoch', memberId: 'p0', done: true });
    assert.equal(state.groupGoals[0].done, true);
    assert.deepEqual(importBackup(exportBackup(state), registry), state);
    command({ type: 'undo' }); assert.equal(state.groupGoals[0].done, false);
    command({ type: 'undo' }); assert.equal(state.groupGoals[0].done, true);
  }
});
for (const name of ['  Restored player  ', 'x'.repeat(120), 'x'.repeat(79) + ' ' + 'tail', '\u0000', 'Old\u0000name']) test(`departure bounds a restored display name ${JSON.stringify(name)}`, () => {
  const state = createGroupState([{ id: 'a', name: 'Remaining' }, { id: 'b', name }]);
  assert.deepEqual(importBackup(exportBackup(state), registry), state);
  const next = validateState(memberDeparture(state, 'b', 'departure', at), registry), label = next.history.at(-1).actor.label;
  assert.equal(label, label.trim()); assert.ok(label.length > 0 && label.length <= 80); assert.doesNotMatch(label, /[\u0000-\u001f\u007f-\u009f]/);
  assert.equal(state.members[1].name, name);
});
for (const size of [2, 3, 4, 5]) test(`departure removes current access, supplies, obligations and completion for ${size} characters while preserving attribution`, () => {
  const ids = Array.from({ length: size }, (_, i) => 'player' + i), chunks = ids.map((_, i) => String(12341 + i));
  const data = { chunks: Object.fromEntries(chunks.map((id, i) => [id, { Object: { 'Shared bench': true }, Spawn: i === size - 1 ? { Token: 1 } : {} }])),
    sections: Object.fromEntries(chunks.map((id, i) => [id, { '0': [chunks[i - 1], chunks[i + 1]].filter(Boolean) }])),
    walkableChunks: chunks, walkableChunksF2P: chunks, codeItems: {}, challenges: { Extra: { Personal: { Chunks: [chunks[0]], Items: ['Token'] } } } };
  const world = buildWorld(data), engine = createTaskEngine(data), state = createGroupState(ids.map((id, i) => ({ id, name: id, unlocked: [chunks[i]] })));
  state.rules = { 'content.f2p': true, 'access.shared': true, 'tasks.completion': 'any' };
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const custom = { id: 'custom:departing', label: 'Former personal task', category: 'Custom', memberIds: [ids.at(-1)] };
  state.tasks.push(custom); state.members.at(-1).completedTasks.push(custom.id);
  state.groupGoals = [{ id: 'group-goal:kept', text: 'Shared goal', completion: 'players', completedBy: [ids.at(-1)], done: false }];
  const history = applyCommand(state, { type: 'set-journal', memberId: ids.at(-1), note: 'Historical note' }, { registry, now: () => at, actor: { kind: 'invite', inviteId: 'synthetic', memberId: ids.at(-1), label: 'Former player' } });
  const next = memberDeparture(history, ids.at(-1), 'departure', at);
  assert.equal(partnerConnections(world, history, ids[0], registry).regions.length, size - 1);
  assert.equal(partnerConnections(world, next, ids[0], registry).regions.length, size - 2);
  assert.equal(createTaskFactsIndex(history, ids[0], registry).get(custom.id).group, true);
  assert.deepEqual(createTaskFactsIndex(next, ids[0], registry).get(custom.id).completedBy, []);
  assert.deepEqual(createTaskFactsIndex(next, ids[0], registry).get(custom.id).requiredBy, []);
  const before = engine.evaluate(history, ids[0]), after = engine.evaluate(next, ids[0]);
  const beforeTask = before.tasks.find(t => t.id === taskId('Extra', 'Personal')), afterTask = after.tasks.find(t => t.id === taskId('Extra', 'Personal'));
  assert.equal(beforeTask.obligation, true); assert.equal(afterTask.obligation, true);
  assert.ok(beforeTask.explanation.includes('Token supplies available via connected partner chunks.'));
  assert.equal(afterTask.explanation.includes('Token supplies available via connected partner chunks.'), false);
  assert.equal(next.members.some(m => m.unlocked.includes(chunks.at(-1))), false);
  assert.deepEqual(next.groupGoals[0].completedBy, []); assert.deepEqual(next.history[0], history.history[0]);
  assert.doesNotThrow(() => validateState(next, registry)); assert.equal(getUndoEligibility(next, 1, { registry }).canUndo, false);
  assert.deepEqual(importBackup(exportBackup(next), registry), next);
});
