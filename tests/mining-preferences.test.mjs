import test from 'node:test';
import assert from 'node:assert/strict';
import { miningSettingDefinitions } from '../app/core/mining-settings.mjs';
import { validatePreference } from '../app/core/preferences.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const state = () => createGroupState([{ id: 'player1', name: 'Player 1' }, { id: 'player2', name: 'Player 2' }]);
const now = () => '2026-10-12T12:00:00.000Z';

test('Mining defaults stay assumed and accept only F2P tools and attention choices', () => {
  assert.deepEqual(miningSettingDefinitions.map(row => [row.id, row.default]), [['miningPickaxe', 'auto'], ['miningAttention', 'active']]);
  assert.equal(state().members[0].preferences, undefined);
  for (const definition of miningSettingDefinitions) {
    for (const value of definition.options) assert.equal(validatePreference(definition.id, value), value);
    for (const value of [null, undefined, true, 1, '', {}, [], 'orikalkum', 'dragon', 'Active']) {
      assert.throws(() => validatePreference(definition.id, value), TypeError);
      const invalid = state(); invalid.members[0].preferences = { [definition.id]: value };
      assert.throws(() => validateState(invalid), TypeError);
    }
  }
});

test('Mining preferences keep personal ownership, revision checks, History, backup and Undo', () => {
  const original = state();
  let saved = applyCommand(original, { type: 'set-preference', memberId: 'player1', preferenceId: 'miningPickaxe', value: 'rune+3' }, { expectedRevision: 0, now });
  assert.equal(saved.members[0].preferences.miningPickaxe, 'rune+3');
  assert.equal(saved.members[1].preferences, undefined);
  assert.match(describeHistoryEvent(saved.history.at(-1), { memberName: () => 'Player 1' }), /Mining pickaxe for Player 1/);
  assert.throws(() => applyCommand(saved, { type: 'set-preference', memberId: 'player1', preferenceId: 'miningAttention', value: 'afk' }, { expectedRevision: 0, now }), /revision/i);
  saved = applyCommand(saved, { type: 'set-preference', memberId: 'player1', preferenceId: 'miningAttention', value: 'afk' }, { expectedRevision: 1, now });
  const restored = importBackup(exportBackup(saved));
  assert.deepEqual(restored.members[0].preferences, { miningPickaxe: 'rune+3', miningAttention: 'afk' });
  const undoneAttention = applyCommand(restored, { type: 'undo' }, { expectedRevision: 2, now });
  assert.deepEqual(undoneAttention.members[0].preferences, { miningPickaxe: 'rune+3' });
  assert.deepEqual(applyCommand(undoneAttention, { type: 'undo' }, { expectedRevision: 3, now }).members, original.members);
});
