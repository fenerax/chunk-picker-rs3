import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeHistoryEvent, historyChangeType, historyChangeTypes } from '../app/web/history-text.mjs';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { groupGoalCommandTypes } from '../app/core/group-goals.mjs';

const lookups = { memberName: id => ({ actor1: 'Player', reed: 'Reed' })[id] ?? id, chunkName: id => ({ 12850: 'Lumbridge' })[id] ?? id, taskLabel: id => ({ 't:cape': 'Obtain a Team-1 cape' })[id] ?? id };

test('clearing legacy stickers and starting chunks and forfeiting use the saved outcome', () => {
  assert.equal(describeHistoryEvent({ type: 'set-sticker', command: { chunkId: '12850', sticker: null, memberId: 'actor1' } }, lookups), 'Removed all stickers from Lumbridge for Player');
  assert.equal(describeHistoryEvent({ type: 'set-starting-chunk', command: { chunkId: null, memberId: 'reed' } }, lookups), 'Cleared the starting chunk for Reed');
  assert.equal(describeHistoryEvent({ type: 'unpick', command: { unpicked: '12850', memberId: 'actor1' } }, lookups), 'Forfeited Lumbridge at random for Player');
});

test('claim History quotes task names and distinguishes starts, takeovers and clearing', () => {
  assert.equal(describeHistoryEvent({ type: 'claim-task', command: { memberId: 'actor1', taskId: 't:cape' } }, lookups), 'Player started “Obtain a Team-1 cape”');
  assert.equal(describeHistoryEvent({ type: 'clear-task-claim', command: { memberId: 'reed', taskId: 't:cape' } }, lookups), 'Reed is no longer doing “Obtain a Team-1 cape”');
  assert.equal(describeHistoryEvent({ type: 'claim-task', command: { memberId: 'reed', taskId: 't:cape', previousMemberId: 'actor1' } }, lookups), 'Reed took over “Obtain a Team-1 cape” from Player');
  assert.equal(describeHistoryEvent({ type: 'claim-task', command: { memberId: 'unknown', taskId: 'unknown-task', takeover: true } }, lookups), 'a player started a task');
  assert.equal(describeHistoryEvent({ type: 'claim-task', command: { memberId: 'reed', taskId: 't:cape', previousMemberId: 'unknown', taskLabel: 'Saved task name' } }, lookups), 'Reed took over “Saved task name” from a player');
  assert.equal(describeHistoryEvent({ type: 'clear-task-claim', actor: { label: 'Reed' }, command: { taskId: 't:cape', taskLabel: 'Saved task name' } }, lookups), 'Reed is no longer doing “Saved task name”');
});



const coverage = [
  ['tasks', 'add-group-goal', { text: 'Both get a rune pickaxe' }, 'Added group goal “Both get a rune pickaxe”'],
  ['tasks', 'update-group-goal', { goalText: 'Both get a rune pickaxe' }, 'Edited group goal “Both get a rune pickaxe”'],
  ['tasks', 'move-group-goal', { goalText: 'Both get a rune pickaxe', index: 1 }, 'Moved group goal “Both get a rune pickaxe” to position 2'],
  ['tasks', 'set-group-goal-done', { goalText: 'Both get a rune pickaxe', memberId: 'actor1', done: true }, 'Completed group goal “Both get a rune pickaxe” for Player'],
  ['tasks', 'remove-group-goal', { goalText: 'Both get a rune pickaxe' }, 'Removed group goal “Both get a rune pickaxe”'],
  ['settings', 'set-finish-line-item', { itemId: 'skill:Mining', target: 60 }, 'Changed shared F2P finish line “Mining” to level 60'],
  ['tasks', 'add-finish-line-custom', { itemId: 'finish:bank', text: 'Fill the bank' }, 'Added F2P finish line item “Fill the bank”'],
  ['tasks', 'set-finish-line-custom', { itemId: 'finish:bank', itemText: 'Fill the bank', memberId: 'actor1', completed: true }, 'Ticked F2P finish line item “Fill the bank” for Player'],
  ['tasks', 'delete-finish-line-custom', { itemId: 'finish:bank', itemText: 'Fill the bank' }, 'Deleted F2P finish line item “Fill the bank”'],
  ['map', 'set-chunk', { chunkId: '12850', status: 'selected' }, 'Added Lumbridge to the roll pool by hand'],
  ['map', 'set-chunk', { chunkId: '12850', status: 'blacklisted' }, 'Set Lumbridge to never roll'],
  ['map', 'set-chunk', { chunkId: '12850', status: 'locked' }, 'Reset Lumbridge to locked'],
  ['map', 'roll', { count: 2 }, 'Rolled two chunks'],
  ['map', 'unlock-selection', { chunkId: '12850' }, 'Unlocked Lumbridge from the roll'],
  ['map', 'pick-for-me', {}, 'Picked a rolled chunk at random'],
  ['map', 'unlock-both', {}, 'Unlocked both rolled chunks'],
  ['map', 'cancel-roll', {}, 'Cancelled the roll'],
  ['map', 'random-start', { count: 2 }, 'Chose two random starting chunks'],
  ['saves', 'go-members', { starts: [{ memberId: 'actor1', chunkId: '16692', place: 'Wendlewick' }] }, 'Restarted both maps for members: Player at Wendlewick'],
  ['map', 'unpick', {}, 'Forfeited an unlocked chunk at random'],
  ['map', 'set-starting-chunk', { chunkId: '12850' }, 'Set the starting chunk to Lumbridge'],
  ['tasks', 'claim-task', { taskId: 't:cape' }, 'A player started “Obtain a Team-1 cape”'],
  ['tasks', 'clear-task-claim', { taskId: 't:cape' }, 'A player is no longer doing “Obtain a Team-1 cape”'],
  ['tasks', 'prune-task-claims', { taskIds: ['opaque:task'] }, 'Released inactive task claims'],
  ['tasks', 'set-task-status', { taskId: 't:cape', challengeCompleted: true }, 'Ticked off “Obtain a Team-1 cape”'],
  ['tasks', 'clear-challenge-ticks', { cleared: 4 }, 'Unticked 4 tasks'],
  ['tasks', 'clear-backlog', { restored: 4 }, 'Restored all 4 backlogged tasks'],
  ['tasks', 'add-task', { task: { id: 'opaque:task', label: 'Bake a cake' } }, 'Added custom task “Bake a cake”'],
  ['tasks', 'update-task', { taskId: 'custom:cake', taskLabel: 'Bake a cake', task: { label: 'Bake two cakes' } }, 'Edited custom task “Bake a cake”'],
  ['tasks', 'delete-task', { taskId: 'custom:cake', taskLabel: 'Bake a cake' }, 'Deleted custom task “Bake a cake”'],
  ['tasks', 'set-task-alternative', { taskId: 't:cape', category: 'opaque:category', group: 'opaque:group' }, 'Chose “Obtain a Team-1 cape” as the preferred method'],
  ['tasks', 'set-source-backlog', { kind: 'shops', name: 'General Store', backlogged: true }, 'Backlogged the source “General Store”'],
  ['settings', 'set-task-rule', { ruleId: 'Kill X Amount', value: 100 }, 'Changed Kill X Amount to a new value'],
  ['settings', 'reset-task-rule', { ruleId: 'Combat Mastery achievements' }, 'Reset Combat Mastery achievements to automatic'],
  ['settings', 'set-rule', { ruleId: 'opaque:rule', value: false }, 'Turned a shared rule off'],
  ['settings', 'set-profile', {}, 'Applied a rule preset'],
  ['settings', 'set-preference', { preferenceId: 'miningPickaxe', value: 'auto' }, 'Changed setting Mining pickaxe'],
  ['settings', 'set-primary-override', { skill: 'Mining', enabled: true }, 'Allowed primary training for Mining'],
  ['settings', 'set-skill-levels', { skill: 'Mining' }, 'Set Mining levels'],
  ['settings', 'set-slayer-lock', { lock: {} }, 'Set the Slayer lock'],
  ['travel', 'set-section', { sectionId: '12850-opaque:section', accessible: false }, 'Set a section of Lumbridge to blocked'],
  ['travel', 'set-area', { areaId: 'opaque:area', accessible: null }, 'Set an area to automatic'],
  ['travel', 'set-teleport', { teleport: { id: 'opaque:route', label: 'Home teleport' } }, 'Saved teleport “Home teleport”'],
  ['travel', 'set-teleport-override', { routeId: 'opaque:route', value: null }, 'Reset automatic availability for a travel route'],
  ['travel', 'delete-teleport', {}, 'Deleted a teleport'],
  ['travel', 'set-transport-facts', {}, 'Updated travel unlocks'],
  ['progress', 'complete-task', { taskId: 't:cape', completed: true }, 'Marked “Obtain a Team-1 cape” as done in-game'],
  ['progress', 'set-obtained-equipment', { equipmentName: 'Rune pickaxe', obtained: true }, 'Recorded Rune pickaxe as obtained'],
  ['progress', 'set-runescape-name', {}, 'Set the RuneScape name'],
  ['progress', 'apply-runemetrics', {}, 'Synced skills and quests from RuneMetrics'],
  ['progress', 'apply-game-progress', {}, 'Applied skills and quests from the game plugin'],
  ['progress', 'apply-game-progress', { skills: [], quests: [], achievements: [], items: [{}, {}] }, 'Ticked 2 tasks from items the game plugin saw'],
  ['progress', 'apply-game-progress', { skills: [{}], items: [{}] }, 'Applied skills and quests and item tasks from the game plugin'],
  ['progress', 'set-xp-choices', { taskId: 'quest:lamp', taskLabel: 'A lamp' }, 'Changed XP choices for “A lamp”'],
  ['notes', 'set-note', { chunkId: '12850', note: 'Later' }, 'Edited the note on Lumbridge'],
  ['notes', 'set-journal', { memberId: 'actor1', note: 'Later' }, 'Edited the journal for Player'],
  ['notes', 'add-sticker', { chunkId: '12850' }, 'Added a sticker to Lumbridge'],
  ['notes', 'set-sticker', { chunkId: '12850' }, 'Added a sticker to Lumbridge'],
  ['notes', 'update-sticker', { chunkId: '12850' }, 'Changed a sticker on Lumbridge'],
  ['notes', 'remove-sticker', { chunkId: '12850' }, 'Removed a sticker from Lumbridge'],
  ['notes', 'clear-stickers', { chunkId: '12850' }, 'Removed all stickers from Lumbridge'],
  ['notes', 'set-chunk-colour', { chunkId: '12850', colour: 'red' }, 'Coloured Lumbridge'],
  ['notes', 'rename-chunk-colour', { name: 'Next' }, 'Named a chunk colour “Next”'],
  ['saves', 'sync-original', { members: [{ memberId: 'actor1', groups: ['pendingRoll'] }, { memberId: 'reed', groups: ['taskRules'] }] }, 'Synced from the original picker for Player and Reed'],
  ['saves', 'replace-member', { memberId: 'actor1', source: 'opaque:source' }, 'Restored Player’s map from a backup'],
  ['saves', 'undo', { undoRevision: 42 }, 'Undid a change'],
  ['saves', 'restore', {}, 'Restored the whole save from a backup'],
  ['other', 'catalogue-refresh', {}, 'Updated game data'],
];



test('achievement History names the batch and its player', () => {
  const event = { type: 'apply-game-progress', command: { memberId: 'synthetic', achievements: [{ taskId: 'diary:synthetic', title: 'Synthetic Task', achievementId: 1 }] } };
  assert.equal(describeHistoryEvent(event, { memberName: () => 'Explorer 1' }), 'Applied skills, quests and achievements from the game plugin for Explorer 1');
  assert.equal(historyChangeType(event), 'progress');
});

test('legacy task names remain readable while unresolved technical identifiers stay generic', () => {
  const describe = taskId => describeHistoryEvent({ type: 'claim-task', actor: { label: 'Reed' }, command: { taskId } });
  assert.equal(describe('Dragon Slayer'), 'Reed started “Dragon Slayer”');
  assert.equal(describe("Cook's Assistant"), 'Reed started “Cook\'s Assistant”');
  for (const id of ['unknown-task', 't:cape', 'opaque:task', 'rs3:task:quest:cooks-assistant', 't_raw_1']) assert.equal(describe(id), 'Reed started a task', id);
});

test('old member snapshots and sparse History changes name roll pool removals', () => {
  const command = { type: 'set-chunk', memberId: 'actor1', chunkId: '12850', status: 'locked' };
  for (const [field, expected] of [['selected', 'Removed Lumbridge from the roll pool for Player'], ['blacklisted', 'Allowed Lumbridge in the roll pool for Player']]) {
    for (const undo of [
      { members: [{ id: 'actor1', [field]: ['12850'] }] },
      { memberChanges: [{ id: 'actor1', changes: [{ path: [field], before: { exists: true, value: ['12850'] }, after: { exists: true, value: [] } }] }] },
    ]) assert.equal(describeHistoryEvent({ type: 'set-chunk', command, undo }, lookups), expected);
  }
});

test('History names coins-only set and clear commands using their actual undo facts', () => {
  let state = createGroupState([{ id: 'actor1', name: 'Player', unlocked: [] }, { id: 'reed', name: 'Reed', unlocked: [] }]);
  const run = facts => { state = applyCommand(state, { type: 'set-transport-facts', memberId: 'actor1', facts }); return describeHistoryEvent(state.history.at(-1), lookups); };
  assert.equal(run({ currencies: { coins: 2000 } }), 'Set coins on hand to 2,000 for Player');
  assert.equal(run({}), 'Cleared coins on hand for Player');
  assert.equal(run({ quests: { 'A quest': true }, currencies: { coins: 5000 } }), 'Updated travel unlocks for Player');
  assert.equal(run({ quests: { 'A quest': true }, currencies: { coins: 1000 } }), 'Set coins on hand to 1,000 for Player');
  assert.equal(run({ quests: { 'A quest': true } }), 'Cleared coins on hand for Player');
});
