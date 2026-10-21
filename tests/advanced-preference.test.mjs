import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { preferenceDefinitions, validatePreference } from '../app/core/preferences.mjs';

const state = () => createGroupState([{ id: 'actor1', name: 'Player' }, { id: 'reed', name: 'Reed' }]);
const now = () => '2026-10-12T12:00:00.000Z';

test('advanced mode defaults off without seeding personal settings and requires a boolean', () => {
  const original = state();
  assert.equal(preferenceDefinitions.find(row => row.id === 'advanced').default, false);
  assert.equal(original.members[0].preferences, undefined);
  for (const value of [true, false]) assert.equal(validatePreference('advanced', value), value);
  for (const value of ['true', 'false', 0, 1, null, undefined, {}, []]) {
    assert.throws(() => validatePreference('advanced', value), TypeError);
    assert.throws(() => applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'advanced', value }, { now }), TypeError);
    const invalid = structuredClone(original); invalid.members[0].preferences = { advanced: value };
    assert.throws(() => validateState(invalid), TypeError);
  }
  assert.deepEqual(original, state());
});

test('advanced mode uses personal preference commands, History, backup and undo', () => {
  const original = state(); original.legacy = { maps: { bbb: { settings: { ids: false } } } };
  const changed = applyCommand(original, { type: 'set-preference', memberId: 'actor1', preferenceId: 'advanced', value: true }, { now });
  assert.deepEqual(changed.members[0].preferences, { advanced: true });
  assert.equal(changed.members[1].preferences, undefined);
  assert.deepEqual(changed.legacy, original.legacy);
  assert.equal(changed.history.at(-1).type, 'set-preference');
  assert.equal(changed.history.at(-1).command.preferenceId, 'advanced');
  const restored = importBackup(exportBackup(changed));
  assert.equal(restored.members[0].preferences.advanced, true);
  const undone = applyCommand(restored, { type: 'undo' }, { now });
  assert.deepEqual(undone.members, original.members);
  assert.deepEqual(undone.legacy, original.legacy);
});
