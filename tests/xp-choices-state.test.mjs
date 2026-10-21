import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, applyValidatedCommand, exportBackup, importBackup, previewRestore, validateState } from '../app/core/state.mjs';
import { buildXpChoiceCatalogue } from '../app/core/xp-choices.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { createGameplayFingerprint } from '../app/storage/gameplay-fingerprint.mjs';

const definitions = { chunks: { '100': {} }, challenges: {
  Quest: { Reward: { XpReward: { Anyx2: 1000, Fishing: 100 } } },
  Mining: { Unlock: { Level: 10 }, Higher: { Level: 20 } },
  Fishing: { Unlock: { Level: 2 } },
} };
const engine = createTaskEngine(definitions, { metadataCorrections: false, retainedTaskCorrections: false, divinationTraining: false });
const task = engine.catalogue.find(row => row.category === 'Quest');
const taskCatalogue = engine.catalogue.map(({ level, ...row }) => row);
const xpChoiceCatalogue = buildXpChoiceCatalogue(definitions, taskCatalogue);
const now = () => '2026-10-13T12:00:00.000Z';
const options = { now, taskCatalogue, xpChoiceCatalogue };
const command = choices => ({ type: 'set-xp-choices', memberId: 'm', taskId: task.id, choices });
function fixture() {
  const state = createGroupState([{ id: 'm', name: 'Owner' }, { id: 'other', name: 'Other' }]);
  state.members[0].unlocked = ['100']; state.members[0].sourceMapId = 'old';
  state.legacy = { maps: { old: { chunkinfo: { assignedXpRewards: { Quest: { Reward: { Mining: 2000 } } } } } } };
  return state;
}

test('XP commands are revision-checked, immutable, portable and sparse undo restores legacy fallback', () => {
  for (const apply of [applyCommand, applyValidatedCommand]) {
    const state = fixture(), saved = structuredClone(state);
    const changed = apply(state, command(['Fishing', null]), { ...options, expectedRevision: 0 });
    assert.deepEqual(state, saved); assert.deepEqual(changed.members[1], state.members[1]);
    assert.equal(changed.revision, 1); assert.deepEqual(changed.members[0].xpChoices[task.id], ['Fishing', null]);
    assert.deepEqual(changed.members[0].completedTasks, []); assert.equal(changed.members[0].skillProgress, undefined);
    assert.deepEqual(importBackup(exportBackup(changed)), changed);
    assert.equal(changed.history[0].command.taskId, task.id);
    assert(changed.history[0].undo.memberChanges[0].changes.some(patch => patch.path[0] === 'xpChoices'));
    assert.throws(() => apply(changed, command([null, null]), { ...options, expectedRevision: 0 }), /Revision conflict/);
    const undone = apply(changed, { type: 'undo' }, options);
    assert.equal(undone.members[0].xpChoices, undefined); assert.deepEqual(undone.legacy, state.legacy);
    assert.equal(undone.tasks.length, 0);
    assert(previewRestore(changed, state).warnings.some(warning => warning.includes('XP reward choices')));
  }
});


test('chosen XP replaces imported allocation exactly once; null clears contribution, fixed XP remains', () => {
  const state = fixture(), imported = engine.evaluate(state, 'm');
  const assigned = applyCommand(state, command(['Fishing', null]), options), result = engine.evaluate(assigned, 'm');
  assert.equal(imported.training.Mining.level > 1, true);
  assert.equal(imported.tasks.find(row => row.category === 'Mining' && row.rawLabel === 'Unlock').status, 'available');
  assert.equal(result.training.Mining.level, 1);
  assert.equal(result.tasks.find(row => row.category === 'Mining' && row.rawLabel === 'Unlock').status, 'blocked');
  assert.equal(result.training.Fishing.level > imported.training.Fishing.level, true);
  assert.equal(result.training.Fishing.primary, false);
  assert.equal(engine.evaluate(assigned, 'other').training.Fishing.level, imported.training.Fishing.level);
  const cleared = applyCommand(assigned, command([null, null]), options), after = engine.evaluate(cleared, 'm');
  assert.equal(after.training.Mining.level, 1); assert.equal(after.training.Fishing.level, 2);
  const undone = applyCommand(assigned, { type: 'undo' }, options);
  assert.equal(engine.evaluate(undone, 'm').training.Mining.level, imported.training.Mining.level);
  assert.equal(engine.evaluate(undone, 'm').tasks.find(row => row.category === 'Mining' && row.rawLabel === 'Unlock').status, 'available');
});


test('changing personal XP choices invalidates gameplay calculations even with the same catalogue', () => {
  const fingerprint = createGameplayFingerprint();
  const assigned = applyCommand(fixture(), command(['Mining', null]), options);
  const changed = applyCommand(assigned, command(['Fishing', null]), options);
  assert.notEqual(fingerprint(assigned), fingerprint(changed));
});

test('restored XP choices and sparse inverse values reject malformed or dangling data', () => {
  const state = applyCommand(fixture(), command(['Mining', null]), options);
  for (const choices of [[], ['Unknown'], { Mining: 1000 }, ['Mining', false]]) {
    const invalid = structuredClone(state); invalid.members[0].xpChoices[task.id] = choices;
    assert.throws(() => validateState(invalid), /XP choices/);
  }
  const missing = structuredClone(state); missing.members[0].xpChoices.absent = ['Mining'];
  assert.throws(() => validateState(missing), /absent task/);
  const inverse = structuredClone(state);
  const patch = inverse.history[0].undo.memberChanges[0].changes.find(row => row.path.length === 2 && row.path[0] === 'xpChoices');
  patch.after.value = ['Unknown', null];
  assert.throws(() => validateState(inverse), /XP choices/);
});
