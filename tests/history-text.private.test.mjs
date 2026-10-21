import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeHistoryEvent, historyChangeType, historyChangeTypes } from '../app/web/history-text.mjs';
import { groupGoalCommandTypes } from '../app/core/group-goals.mjs';

const lookups = { memberName: id => ({ player1: 'Player 1', player2: 'Player 2' })[id] ?? id, chunkName: id => ({ 12850: 'Lumbridge' })[id] ?? id, taskLabel: id => ({ 't:cape': 'Obtain a Team-1 cape' })[id] ?? id, ruleLabel: id => id === 'content.f2p' ? 'Free-to-play only' : id };

test('History lines retain names and chunk numbers, with a plain fallback for unknown events', () => {
  assert.equal(describeHistoryEvent({ type: 'set-chunk', command: { memberId: 'player1', chunkId: '12850', status: 'unlocked' } }, lookups), 'Unlocked Lumbridge for Player 1');
  assert.equal(describeHistoryEvent({ type: 'set-task-status', command: { memberId: 'player2', taskId: 't:cape', backlogged: true, backlogReason: 'Later' } }, lookups), 'Backlogged “Obtain a Team-1 cape” (Later) for Player 2');
  assert.equal(describeHistoryEvent({ type: 'set-task-rule', command: { memberId: 'player2', ruleId: 'Combat Mastery achievements', value: false } }, lookups), 'Turned Combat Mastery achievements off for Player 2');
  assert.equal(describeHistoryEvent({ type: 'clear-backlog', command: { memberId: 'player1', restored: 27 } }, lookups), 'Restored all 27 backlogged tasks for Player 1');
  assert.equal(describeHistoryEvent({ type: 'clear-backlog', command: { memberId: 'player2', taskIds: ['t:cape', 't:boots'], restored: 2 } }, lookups), 'Restored 2 backlogged tasks for Player 2');
  assert.equal(describeHistoryEvent({ type: 'remove-sticker', command: { memberId: 'player1', chunkId: '99999', stickerId: 's' } }, lookups), 'Removed a sticker from 99999 for Player 1');
  assert.equal(describeHistoryEvent({ type: 'catalogue-refresh' }, lookups), 'Updated game data');
  assert.equal(describeHistoryEvent({ type: 'something-new' }, lookups), 'Changed the save');
});

test('History uses readable preference and travel names without changing stored commands', () => {
  const event = { type: 'set-preference', command: { memberId: 'player1', preferenceId: 'advanced', value: true } };
  assert.equal(describeHistoryEvent(event, lookups), 'Changed setting Advanced mode for Player 1');
  assert.equal(event.command.preferenceId, 'advanced');
  assert.equal(describeHistoryEvent({ type: 'set-preference', command: { preferenceId: 'hideChecked' } }), 'Changed setting Hide completed tasks');
  assert.equal(describeHistoryEvent({ type: 'set-preference', command: { preferenceId: 'future-setting' } }), 'Changed a setting');
  assert.equal(describeHistoryEvent({ type: 'set-teleport-override', command: { memberId: 'player2', routeId: 'route:varrock', value: false } },
    { ...lookups, routeLabel: () => 'Varrock lodestone' }), 'Marked unusable Varrock lodestone for Player 2');
});

const coverage = [
  ['tasks', 'add-group-goal', { text: 'Both get a rune pickaxe' }, 'Added group goal “Both get a rune pickaxe”'],
  ['tasks', 'update-group-goal', { goalText: 'Both get a rune pickaxe' }, 'Edited group goal “Both get a rune pickaxe”'],
  ['tasks', 'move-group-goal', { goalText: 'Both get a rune pickaxe', index: 1 }, 'Moved group goal “Both get a rune pickaxe” to position 2'],
  ['tasks', 'set-group-goal-done', { goalText: 'Both get a rune pickaxe', memberId: 'player1', done: true }, 'Completed group goal “Both get a rune pickaxe” for Player 1'],
  ['tasks', 'remove-group-goal', { goalText: 'Both get a rune pickaxe' }, 'Removed group goal “Both get a rune pickaxe”'],
  ['settings', 'set-finish-line-item', { itemId: 'skill:Mining', target: 60 }, 'Changed shared F2P finish line “Mining” to level 60'],
  ['tasks', 'add-finish-line-custom', { itemId: 'finish:bank', text: 'Fill the bank' }, 'Added F2P finish line item “Fill the bank”'],
  ['tasks', 'set-finish-line-custom', { itemId: 'finish:bank', itemText: 'Fill the bank', memberId: 'player1', completed: true }, 'Ticked F2P finish line item “Fill the bank” for Player 1'],
  ['tasks', 'delete-finish-line-custom', { itemId: 'finish:bank', itemText: 'Fill the bank' }, 'Deleted F2P finish line item “Fill the bank”'],
  ['map', 'set-chunk', { chunkId: '12850', status: 'selected' }, 'Added Lumbridge to the roll pool by hand'],
  ['map', 'roll', { count: 2 }, 'Rolled two chunks'],
  ['map', 'unlock-selection', { chunkId: '12850' }, 'Unlocked Lumbridge from the roll'],
  ['map', 'pick-for-me', {}, 'Picked a rolled chunk at random'],
  ['map', 'unlock-both', {}, 'Unlocked both rolled chunks'],
  ['map', 'cancel-roll', {}, 'Cancelled the roll'],
  ['map', 'random-start', { count: 2 }, 'Chose two random starting chunks'],
  ['saves', 'go-members', { starts: [{ memberId: 'player1', chunkId: '16692', place: 'Wendlewick' }] }, 'Restarted both maps for members: Player 1 at Wendlewick'],
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
  ['progress', 'set-xp-choices', { taskId: 'quest:lamp', taskLabel: 'A lamp' }, 'Changed XP choices for “A lamp”'],
  ['notes', 'set-note', { chunkId: '12850', note: 'Later' }, 'Edited the note on Lumbridge'],
  ['notes', 'set-journal', { memberId: 'player1', note: 'Later' }, 'Edited the journal for Player 1'],
  ['notes', 'add-sticker', { chunkId: '12850' }, 'Added a sticker to Lumbridge'],
  ['notes', 'set-sticker', { chunkId: '12850' }, 'Added a sticker to Lumbridge'],
  ['notes', 'update-sticker', { chunkId: '12850' }, 'Changed a sticker on Lumbridge'],
  ['notes', 'remove-sticker', { chunkId: '12850' }, 'Removed a sticker from Lumbridge'],
  ['notes', 'clear-stickers', { chunkId: '12850' }, 'Removed all stickers from Lumbridge'],
  ['notes', 'set-chunk-colour', { chunkId: '12850', colour: 'red' }, 'Coloured Lumbridge'],
  ['notes', 'rename-chunk-colour', { name: 'Next' }, 'Named a chunk colour “Next”'],
  ['saves', 'sync-original', { members: [{ memberId: 'player1', groups: ['pendingRoll'] }, { memberId: 'player2', groups: ['taskRules'] }] }, 'Synced from the original picker for Player 1 and Player 2'],
  ['saves', 'replace-member', { memberId: 'player1', source: 'opaque:source' }, 'Restored Player 1’s map from a backup'],
  ['saves', 'undo', { undoRevision: 42 }, 'Undid a change'],
  ['saves', 'restore', {}, 'Restored the whole save from a backup'],
  ['settings', 'set-rule-review', { ruleId: 'content.f2p', reviewed: true, note: 'Agreed' }, 'Reviewed Free-to-play only'],
  ['other', 'catalogue-refresh', {}, 'Updated game data'],
];

test('every persisted command and storage event has a plain sentence and shared category without mutation', () => {
  const source = readFileSync(new URL('../app/core/state.mjs', import.meta.url), 'utf8');
  const commandTable = source.slice(source.indexOf('const COMMAND_KEYS'), source.indexOf('function fail'));
  const authored = [...commandTable.matchAll(/\['([^']+)', new Set/g)].map(match => match[1]);
  const storage = readFileSync(new URL('../app/storage/store.mjs', import.meta.url), 'utf8');
  const storageTypes = [...storage.matchAll(/type: '(restore|catalogue-refresh)'/g)].map(match => match[1]);
  assert.deepEqual(new Set(coverage.map(row => row[1])), new Set([...authored, ...groupGoalCommandTypes, ...storageTypes]));
  for (const [category, type, command, expected] of coverage) {
    const event = { type, command };
    const before = structuredClone(event);
    assert.equal(describeHistoryEvent(event, lookups), expected, type);
    assert.equal(historyChangeType(event), category, type);
    assert.deepEqual(event, before, type);
    assert.doesNotMatch(expected, /opaque:|undefined|pendingRoll|taskRules/);
  }
});

test('shared categories and unknown identifiers have safe readable fallbacks', () => {
  assert.deepEqual(historyChangeTypes.map(row => row.id), ['map', 'tasks', 'settings', 'travel', 'progress', 'notes', 'saves', 'other']);
  assert.equal(historyChangeType({ type: 'future:technical-type' }), 'other');
  assert.equal(historyChangeType(), 'other');
  assert.equal(describeHistoryEvent({ type: 'set-task-rule', command: { ruleId: 'opaque:rule', value: true } }), 'Turned a rule on');
  assert.equal(describeHistoryEvent({ type: 'set-preference', command: { preferenceId: 'deathThresholdHours' } }), 'Changed setting Death-chunk threshold (active person-hours)');
  assert.equal(describeHistoryEvent({ type: 'set-preference', command: { preferenceId: 'monsterSecondsPerKill' } }), 'Changed setting Per-monster effective seconds per kill');
  assert.equal(describeHistoryEvent({ type: 'set-task-alternative', command: { category: 'opaque:category', group: 'opaque:group' } }), 'Reset the preferred task method to automatic');
  assert.equal(describeHistoryEvent({ type: 'add-task', command: { task: { id: 'opaque:task' } } }), 'Added a custom task');
});

