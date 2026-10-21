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

test('invalid assignments fail before history, trusted catalogue or membership changes', () => {
  const state = fixture(), saved = structuredClone(state);
  for (const choices of [[], ['Mining'], ['Unknown', null], ['Invention', null], [1, null]]) assert.throws(() => applyCommand(state, command(choices), { ...options, now: () => { throw Error('timestamp'); } }), /XP|skill/);
  assert.throws(() => applyCommand(state, command(['Mining', null]), { taskCatalogue }), /Unknown choosable/);
  assert.deepEqual(state, saved);
  const members = structuredClone(state); members.rules['content.f2p'] = false;
  assert.deepEqual(applyCommand(members, command(['Invention', null]), options).members[0].xpChoices[task.id], ['Invention', null]);
});

test('source validity and F2P training caps still gate allocation without personal completion', () => {
  const blockedDefs = structuredClone(definitions); blockedDefs.challenges.Quest.Reward.Chunks = ['200'];
  const blocked = createTaskEngine(blockedDefs, { metadataCorrections: false, retainedTaskCorrections: false, divinationTraining: false });
  const state = applyCommand(fixture(), command(['Mining', 'Herblore']), options);
  assert.equal(blocked.evaluate(state, 'm').training.Mining.level, 1);
  assert.equal(engine.evaluate(state, 'm').training.Herblore.level, 5);
  state.rules['content.f2p'] = false;
  assert.equal(engine.evaluate(state, 'm').training.Herblore.level > 5, true);
});

