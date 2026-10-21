import test from 'node:test';
import assert from 'node:assert/strict';
import { bankingSettingDefinitions } from '../app/core/banking-settings.mjs';
import { gatheringSettingDefinitions } from '../app/core/gathering-settings.mjs';
import { validatePreference } from '../app/core/preferences.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const state = () => createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
const now = () => '2026-10-13T12:00:00.000Z';

test('gathering choices default to drop and no owned boxes, and validate only supported values', () => {
  assert.deepEqual(bankingSettingDefinitions.map(row => [row.id, row.default]), [['gatheringMode', 'drop'], ['gatheringOreBox', 'none'], ['gatheringWoodBox', 'none']]);
  assert.equal(state().members[0].preferences, undefined);
  for (const definition of bankingSettingDefinitions) {
    for (const value of definition.options) assert.equal(validatePreference(definition.id, value), value);
    for (const value of [null, undefined, true, 1, '', {}, [], 'elder', 'dragon', 'Bank']) {
      assert.throws(() => validatePreference(definition.id, value), TypeError);
      const invalid = state(); invalid.members[0].preferences = { [definition.id]: value };
      assert.throws(() => validateState(invalid), TypeError);
    }
  }
});

test('gathering preferences remain personal through revisions, History, backup and Undo', () => {
  const original = state();
  let saved = applyCommand(original, { type: 'set-preference', memberId: 'player1', preferenceId: 'gatheringOreBox', value: 'rune' }, { expectedRevision: 0, now });
  assert.equal(saved.members[0].preferences.gatheringOreBox, 'rune'); assert.equal(saved.members[1].preferences, undefined);
  assert.match(describeHistoryEvent(saved.history.at(-1), { memberName: () => 'Player 1' }), /Ore box owned for Player 1/);
  assert.throws(() => applyCommand(saved, { type: 'set-preference', memberId: 'player2', preferenceId: 'gatheringMode', value: 'bank' }, { expectedRevision: 0, now }), /revision/i);
  saved = applyCommand(saved, { type: 'set-preference', memberId: 'player2', preferenceId: 'gatheringWoodBox', value: 'acadia' }, { expectedRevision: 1, now });
  saved = applyCommand(saved, { type: 'set-preference', memberId: 'player1', preferenceId: 'gatheringMode', value: 'bank' }, { expectedRevision: 2, now });
  const restored = importBackup(exportBackup(saved));
  assert.deepEqual(restored.members[0].preferences, { gatheringOreBox: 'rune', gatheringMode: 'bank' });
  assert.deepEqual(restored.members[1].preferences, { gatheringWoodBox: 'acadia' });
  const undoMode = applyCommand(restored, { type: 'undo' }, { expectedRevision: 3, now });
  assert.deepEqual(undoMode.members[0].preferences, { gatheringOreBox: 'rune' });
  const undoWood = applyCommand(undoMode, { type: 'undo' }, { expectedRevision: 4, now });
  assert.equal(undoWood.members[1].preferences, undefined);
  assert.deepEqual(applyCommand(undoWood, { type: 'undo' }, { expectedRevision: 5, now }).members, original.members);
});

test('processing and travel choices use the personal revision, backup, History and Undo path', () => {
  let saved = state();
  for (const definition of gatheringSettingDefinitions) {
    for (const value of definition.options) assert.equal(validatePreference(definition.id, value), value);
    assert.throws(() => validatePreference(definition.id, 'invented'), TypeError);
    saved = applyCommand(saved, { type: 'set-preference', memberId: 'player1', preferenceId: definition.id, value: definition.options.at(-1) }, { expectedRevision: saved.revision, now });
    assert.match(describeHistoryEvent(saved.history.at(-1), { memberName: () => 'Player 1' }), new RegExp(definition.label));
  }
  assert.equal(saved.members[1].preferences, undefined);
  let restored = importBackup(exportBackup(saved));
  assert.deepEqual(restored.members[0].preferences, saved.members[0].preferences);
  for (const ignored of gatheringSettingDefinitions) restored = applyCommand(restored, { type: 'undo' }, { expectedRevision: restored.revision, now });
  assert.equal(restored.members[0].preferences, undefined);
});
