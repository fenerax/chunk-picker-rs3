import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { exportRuleProfile, previewRuleProfile, applyRuleProfile, predictChunk } from '../app/core/planning.mjs';

const now = () => '2026-10-07T12:00:00.000Z';
function fixture() {
  const definitions = {
    chunks: { '1': { Spawn: { Seed: 1 } }, '2': { Object: { Tree: true }, Spawn: { Coal: 1 }, Connect: { Cave: true } }, '3': {}, Cave: { Spawn: { Gem: 1 } } },
    sections: {}, codeItems: {}, walkableChunksF2P: ['1', '2', '3'],
    challenges: { Woodcutting: { Logs: { Level: 1, Primary: true, Objects: ['Tree'], Output: 'Logs' } }, Extra: { Coal: { Items: ['Coal'] }, Unknown: { Bespoke: true } } },
  };
  const engine = createTaskEngine(definitions);
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['1'] }, { id: 'player2', name: 'Player 2', unlocked: ['3'] }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const ids = ['1', '2', '3'];
  const world = { chunks: new Map(ids.map(id => [id, { id }])), neighbors: new Map([['1', ['2']]]), walkable: new Set(ids), f2p: new Set(ids), surface: new Set(ids) };
  return { state, engine, world };
}

test('profile preview exposes default resets and omitted personal overrides before atomic apply', () => {
  const { state } = fixture();
  state.rules = { 'access.shared': false, 'roll.teleportScope': 'group' };
  state.members[0].taskRules = { Boosting: true, obsolete: 'remove' };
  state.members[1].taskRules = { Skills: false };
  const profile = exportRuleProfile(state, 'player1');
  profile.rules = { 'tasks.completion': 'all' }; profile.taskRules = { Boosting: false };
  const preview = previewRuleProfile(state, profile, 'player1');
  assert.deepEqual(preview.changes.rules.map(change => change.id), ['access.shared', 'roll.teleportScope', 'tasks.completion']);
  assert.deepEqual(preview.changes.taskRules.map(change => [change.id, change.kind]), [['Boosting', 'changed'], ['obsolete', 'removed']]);
  assert.ok(preview.warnings.some(warning => warning.includes('every member')));
  const before = structuredClone(state);
  const changed = applyRuleProfile(state, profile, 'player1', { expectedRevision: 0, now });
  assert.deepEqual(changed.rules, profile.rules);
  assert.deepEqual(changed.members[0].taskRules, { Boosting: false });
  assert.deepEqual(changed.members[1], state.members[1]);
  assert.equal(changed.revision, 1); assert.equal(changed.history.length, 1); assert.equal(changed.history[0].type, 'set-profile');
  const undone = applyCommand(changed, { type: 'undo' }, { now });
  assert.deepEqual(undone.rules, state.rules); assert.deepEqual(undone.members, state.members);
  assert.deepEqual(state, before);
});

