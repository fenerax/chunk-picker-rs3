import test from 'node:test';
import assert from 'node:assert/strict';
import { gatheringSettingDefinitions, calculatorBankingSettingDefinitions } from '../app/core/gathering-settings.mjs';
import { bankingSettingDefinitions } from '../app/core/banking-settings.mjs';
import { ORE_BOX_TIERS, WOOD_BOX_TIERS } from '../app/training/banking-rates.mjs';
import { validatePreference } from '../app/core/preferences.mjs';
import { createGroupState, applyCommand, exportBackup, importBackup, validateState } from '../app/core/state.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';

const original = () => createGroupState([{ id: 'gatherer', name: 'Gatherer' }, { id: 'partner', name: 'Partner' }]);
const now = () => '2026-10-16T12:00:00.000Z';

test('processing choices validate supported values without seeding personal defaults', () => {
  assert.equal(original().members[0].preferences, undefined);
  for (const definition of gatheringSettingDefinitions) {
    for (const value of definition.options) assert.equal(validatePreference(definition.id, value), value);
    for (const value of ['unsupported', null, true, 100, []]) {
      assert.throws(() => validatePreference(definition.id, value), TypeError);
      const invalid = original(); invalid.members[0].preferences = { [definition.id]: value };
      assert.throws(() => validateState(invalid), TypeError);
    }
  }
});

test('calculator fallback preserves supplied definitions and supports the model storage choices', () => {
  if (bankingSettingDefinitions.length) assert.equal(calculatorBankingSettingDefinitions, bankingSettingDefinitions);
  else {
    assert.deepEqual(calculatorBankingSettingDefinitions.find(row => row.id === 'gatheringOreBox').options, ORE_BOX_TIERS);
    assert.deepEqual(calculatorBankingSettingDefinitions.find(row => row.id === 'gatheringWoodBox').options, WOOD_BOX_TIERS);
    for (const definition of calculatorBankingSettingDefinitions) {
      for (const value of definition.options) assert.equal(validatePreference(definition.id, value), value);
    }
  }
});

test('processing and travel persist personally through History, backup and Undo', () => {
  let saved = original();
  for (const definition of gatheringSettingDefinitions) {
    saved = applyCommand(saved, { type: 'set-preference', memberId: 'gatherer', preferenceId: definition.id,
      value: definition.options.at(-1) }, { expectedRevision: saved.revision, now });
    assert.match(describeHistoryEvent(saved.history.at(-1), { memberName: () => 'Gatherer' }), new RegExp(definition.label));
  }
  assert.equal(saved.members[1].preferences, undefined);
  assert.throws(() => applyCommand(saved, { type: 'set-preference', memberId: 'partner', preferenceId: 'gatheringSurge', value: 'on' },
    { expectedRevision: 0, now }), /revision/i);
  let restored = importBackup(exportBackup(saved));
  assert.deepEqual(restored.members[0].preferences, saved.members[0].preferences);
  for (const definition of gatheringSettingDefinitions) restored = applyCommand(restored, { type: 'undo' }, { expectedRevision: restored.revision, now });
  assert.deepEqual(restored.members, original().members);
});
