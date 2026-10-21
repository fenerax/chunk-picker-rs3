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
  const state = createGroupState([{ id: 'actor1', name: 'Player', unlocked: ['1'] }, { id: 'reed', name: 'Reed', unlocked: ['3'] }]);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const ids = ['1', '2', '3'];
  const world = { chunks: new Map(ids.map(id => [id, { id }])), neighbors: new Map([['1', ['2']]]), walkable: new Set(ids), f2p: new Set(ids), surface: new Set(ids) };
  return { state, engine, world };
}

test('rule profiles export only group and personal rule data and round trip declaratively', () => {
  const { state } = fixture();
  state.rules = { 'access.shared': false };
  state.members[0].taskRules = { Skills: true, Boosting: false, rareDropNum: '1/1000', customThreshold: 5, optional: null };
  state.members[0].notes = { '1': 'Private note' };
  state.legacy = { maps: { map: { note: 'Raw record' } } };
  const before = structuredClone(state);
  const profile = exportRuleProfile(state, 'actor1');
  assert.deepEqual(Object.keys(profile), ['format', 'schemaVersion', 'rules', 'taskRules']);
  assert.ok(!JSON.stringify(profile).includes('Private note'));
  const preview = previewRuleProfile(state, JSON.stringify(profile), 'actor1');
  assert.deepEqual(preview.changes, { rules: [], taskRules: [] });
  assert.deepEqual(preview.warnings, []);
  profile.rules['access.shared'] = true;
  assert.deepEqual(state, before);
});


test('custom registered rule profiles need no planning engine modifications', () => {
  const { state } = fixture();
  const registry = createRuleRegistry([{ id: 'house.allow', type: 'boolean', default: false, candidates: () => [] }]);
  state.rules['house.allow'] = true;
  const profile = exportRuleProfile(state, 'actor1', registry);
  assert.deepEqual(previewRuleProfile(state, profile, 'actor1', registry).changes.rules, []);
  assert.equal(applyRuleProfile(state, profile, 'actor1', { registry, now }).rules['house.allow'], true);
  assert.throws(() => previewRuleProfile(fixture().state, profile, 'actor1'), /Unknown rule/);
});

test('invalid profiles and revision conflicts fail before timestamp and preserve state', () => {
  const { state } = fixture();
  const before = structuredClone(state), valid = exportRuleProfile(state, 'actor1');
  const invalid = [
    { ...valid, format: 'wrong' }, { ...valid, schemaVersion: 99 }, { ...valid, extra: true },
    { ...valid, rules: { unknown: true } }, { ...valid, rules: { 'access.shared': 'yes' } },
    { ...valid, taskRules: { complex: {} } }, { ...valid, taskRules: { invalid: NaN } },
    { ...valid, taskRules: { '': true } }, '{broken',
  ];
  const options = { expectedRevision: 0, now: () => { throw Error('Clock must not run'); } };
  for (const profile of invalid) assert.throws(() => applyRuleProfile(state, profile, 'actor1', options));
  assert.throws(() => applyRuleProfile(state, valid, 'actor1', { ...options, expectedRevision: 1 }), /Revision conflict/);
  const accessor = { ...valid }; Object.defineProperty(accessor, 'rules', { get() { throw Error('Getter must not run'); }, enumerable: true });
  assert.throws(() => previewRuleProfile(state, accessor, 'actor1'), /accessors/);
  assert.deepEqual(state, before);
});

test('prediction finds newly available tasks, source items, areas and training without game completion or synthetic events', () => {
  const { state, engine, world } = fixture();
  const current = applyCommand(state, { type: 'set-rule', ruleId: 'access.shared', value: true }, { now });
  const before = structuredClone(current);
  const prediction = predictChunk(current, 'actor1', '2', { engine, world });
  assert.deepEqual(prediction.delta.tasksAdded.map(task => task.id).sort(), [taskId('Extra', 'Coal'), taskId('Woodcutting', 'Logs')].sort());
  assert.deepEqual(prediction.delta.tasksRemoved, []);
  assert.deepEqual(prediction.delta.itemsAdded.map(item => item.name), ['Coal', 'Gem', 'Logs']);
  assert.deepEqual(prediction.delta.areasAdded, ['Cave']);
  assert.deepEqual(prediction.delta.basesAdded, ['2']);
  assert.ok(prediction.delta.trainingChanged.some(change => change.skill === 'Woodcutting' && change.after.primary));
  assert.equal(prediction.state.revision, current.revision);
  assert.deepEqual(prediction.state.history, current.history);
  assert.deepEqual(prediction.state.members[0].completedTasks, []);
  assert.deepEqual(prediction.state.members[1], current.members[1]);
  assert.ok(Object.isFrozen(prediction.state.members[0].unlocked));
  assert.deepEqual(current, before);
});

test('prediction can compare a pending offer or an already owned chunk without changing the saved roll', () => {
  const { state, engine, world } = fixture();
  state.members[0].pendingRoll = ['2', '3'];
  const before = structuredClone(state);
  const prediction = predictChunk(state, 'actor1', '2', { engine, world });
  assert.deepEqual(prediction.state.members[0].pendingRoll, []);
  assert.deepEqual(prediction.state.members[0].selected, ['3']);
  assert.deepEqual(state, before);
  const unchanged = predictChunk(state, 'actor1', '1', { engine, world });
  assert.deepEqual(unchanged.delta.tasksAdded, []); assert.deepEqual(unchanged.delta.itemsAdded, []);
});

test('predictions reject unknown/cropped chunks and engines cannot mutate saved state', () => {
  const { state, world } = fixture();
  const before = structuredClone(state);
  const badEngine = { evaluate(input) { input.members[0].unlocked.push('3'); } };
  assert.throws(() => predictChunk(state, 'actor1', '2', { world, engine: badEngine }), TypeError);
  assert.throws(() => predictChunk(state, 'actor1', '9', { world, engine: badEngine }), /surface/);
  world.surface.delete('2');
  assert.throws(() => predictChunk(state, 'actor1', '2', { world, engine: badEngine }), /surface/);
  assert.throws(() => predictChunk(state, 'actor1', '1-1', { world, engine: badEngine }), /base ID/);
  assert.deepEqual(state, before);
});
