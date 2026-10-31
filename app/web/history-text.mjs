// Plain-English History lines from saved command records.
// Lookups supply names; unresolved technical identifiers stay in the advanced event details.
import { settingDefinitions, authoredSettingDefinitions, taskRuleDefinitions } from '../data/settings.mjs';
import { deathSettingDefinitions } from '../core/death-settings.mjs';
import { miningSettingDefinitions } from '../core/mining-settings.mjs';
import { woodcuttingSettingDefinitions } from '../core/woodcutting-settings.mjs';
import { gatheringSettingDefinitions, calculatorBankingSettingDefinitions as bankingSettingDefinitions } from '../core/gathering-settings.mjs';
import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';
import { topBarSettingDefinitions } from '../core/top-bar-settings.mjs';
import { setupGuideSettingDefinitions } from '../core/setup-guide.mjs';
import { bossGates } from '../data/boss-gates.mjs';
const settingNames = new Map([...settingDefinitions, ...authoredSettingDefinitions, ...deathSettingDefinitions, ...miningSettingDefinitions, ...woodcuttingSettingDefinitions, ...bankingSettingDefinitions, ...gatheringSettingDefinitions, ...topBarSettingDefinitions, ...setupGuideSettingDefinitions].map(row => [row.id, row.label]));
const ruleNames = new Map(taskRuleDefinitions.map(row => [row.id, row.label]));
export const historyChangeTypes = Object.freeze([
  { id: 'map', label: 'Map' }, { id: 'tasks', label: 'Tasks' }, { id: 'settings', label: 'Settings and rules' },
  { id: 'travel', label: 'Travel' }, { id: 'progress', label: 'Game progress' }, { id: 'notes', label: 'Notes and stickers' },
  { id: 'saves', label: 'Saves and syncs' }, { id: 'other', label: 'Other changes' },
].map(Object.freeze));
const changeTypes = new Map([
  ['tasks', groupGoalCommandTypes],
  ['map', ['set-chunk', 'roll', 'unlock-selection', 'pick-for-me', 'unlock-both', 'cancel-roll', 'random-start', 'unpick', 'set-starting-chunk', 'setup-start']],
  ['tasks', ['claim-task', 'clear-task-claim', 'prune-task-claims', 'set-task-status', 'clear-challenge-ticks', 'tick-active-tasks', 'clear-backlog', 'add-task', 'update-task', 'delete-task', 'set-task-alternative', 'set-source-backlog', 'set-boss-unlock', 'add-finish-line-custom', 'set-finish-line-custom', 'delete-finish-line-custom']],
  ['settings', ['set-task-rule', 'reset-task-rule', 'set-rule', 'set-rule-review', 'set-profile', 'set-preference', 'set-primary-override', 'set-skill-levels', 'set-slayer-lock', 'set-finish-line-item']],
  ['travel', ['set-section', 'set-area', 'set-teleport', 'set-teleport-override', 'delete-teleport', 'set-transport-facts']],
  ['progress', ['complete-task', 'set-obtained-equipment', 'set-runescape-name', 'apply-runemetrics', 'apply-game-progress', 'set-xp-choices']],
  ['notes', ['set-note', 'set-journal', 'add-sticker', 'set-sticker', 'update-sticker', 'remove-sticker', 'clear-stickers', 'set-chunk-colour', 'rename-chunk-colour']],
  ['saves', ['sync-original', 'replace-member', 'go-members', 'undo', 'restore']],
].flatMap(([category, types]) => types.map(type => [type, category])));
export function historyChangeType(event) {
  return changeTypes.get(event?.type) ?? 'other';
}
function named(id, lookup, fallback, known = new Map()) {
  if (id === undefined || id === null || id === '') return fallback;
  const label = lookup(id);
  return typeof label === 'string' && label.trim() && label !== String(id) ? label : known.get(id) ?? fallback;
}
export function describeHistoryEvent(event = {}, { memberName = id => id, chunkName = id => id, taskLabel = id => id, ruleLabel = id => id,
  preferenceLabel = id => settingNames.get(id), routeLabel = id => id } = {}) {
  const c = event.command ?? {};
  const player = id => named(id, memberName, 'a player');
  const who = c.memberId ? player(c.memberId) : '';
  const forWho = who ? ` for ${who}` : '';
  const chunk = id => named(id, chunkName, /^\d+$/.test(String(id)) ? String(id) : 'a chunk');
  // Older records sometimes used the readable task name as the identifier.
  const legacyTaskName = id => typeof id === 'string' && /^\p{Lu}[\p{L}\p{N}'’]*(?: [\p{L}\p{N}'’]+)+$/u.test(id) ? id : '';
  // Commands on custom tasks keep the label, so History still reads after the task is deleted.
  const task = id => { const label = id === c.taskId && c.taskLabel && c.taskLabel !== c.taskId ? c.taskLabel : named(id, taskLabel, legacyTaskName(id)); return label ? `“${label}”` : 'a task'; };
  const savedTask = () => c.taskLabel && c.taskLabel !== c.taskId ? `“${c.taskLabel}”` : task(c.taskId);
  const rule = () => named(c.ruleId, ruleLabel, 'a rule', ruleNames);
  const setting = named(c.preferenceId, preferenceLabel, '', settingNames);
  const onOff = value => value === true ? 'on' : value === false ? 'off' : 'to a new value';
  const finishItem = () => {
    if (c.itemLabel) return `“${c.itemLabel}”`;
    if (c.itemText) return `“${c.itemText}”`;
    if (/^skill:[A-Za-z]+$/.test(c.itemId ?? '')) return `“${c.itemId.slice(6)}”`;
    if (/^gear:[a-z]+$/.test(c.itemId ?? '')) return `“${c.itemId.slice(5)} gear”`;
    if (/^(quest|achievement):/.test(c.itemId ?? '')) return task(c.itemId.slice(c.itemId.indexOf(':') + 1));
    return 'an item';
  };
  const customFinishItem = () => c.itemLabel || c.itemText || c.text ? `“${c.itemLabel || c.itemText || c.text}”` : 'an item';
  const groupGoal = c.goalText || c.text ? `“${c.goalText || c.text}”` : 'a group goal';
  switch (event.type) {
    case 'add-group-goal': return `Added group goal ${groupGoal}`;
    case 'update-group-goal': return `Edited group goal ${groupGoal}`;
    case 'move-group-goal': return `Moved group goal ${groupGoal} to position ${c.index + 1}`;
    case 'set-group-goal-done': return `${c.done ? 'Completed' : 'Reopened'} group goal ${groupGoal}${forWho}`;
    case 'remove-group-goal': return `Removed group goal ${groupGoal}`;
    case 'set-finish-line-item': return `Changed shared F2P finish line ${finishItem()}${c.target !== undefined ? ` to level ${c.target}` : c.enabled ? ' (included)' : ' (excluded)'}`;
    case 'add-finish-line-custom': return `Added F2P finish line item ${customFinishItem()}`;
    case 'set-finish-line-custom': return `${c.completed ? 'Ticked' : 'Unticked'} F2P finish line item ${customFinishItem()}${forWho}`;
    case 'delete-finish-line-custom': return `Deleted F2P finish line item ${customFinishItem()}`;
    case 'claim-task': return c.previousMemberId
      ? `${who || event.actor?.label || 'A player'} took over ${savedTask()} from ${player(c.previousMemberId)}`
      : `${who || event.actor?.label || 'A player'} started ${savedTask()}`;
    case 'clear-task-claim': return `${who || event.actor?.label || 'A player'} is no longer doing ${savedTask()}`;
    case 'prune-task-claims': return 'Released inactive task claims';
    case 'set-chunk': {
      if (c.status === 'selected') return `Added ${chunk(c.chunkId)} to the roll pool by hand${forWho}`;
      if (c.status === 'blacklisted') return `Set ${chunk(c.chunkId)} to never roll${forWho}`;
      if (c.status === 'locked') {
        const previous = event.undo?.members?.find(member => member.id === c.memberId);
        const changes = event.undo?.memberChanges?.find(member => member.id === c.memberId)?.changes ?? [];
        const had = field => previous?.[field]?.includes(c.chunkId) || changes.some(patch => patch.path.length === 1 && patch.path[0] === field && patch.before?.value?.includes(c.chunkId));
        if (had('selected')) return `Removed ${chunk(c.chunkId)} from the roll pool${forWho}`;
        if (had('blacklisted')) return `Allowed ${chunk(c.chunkId)} in the roll pool${forWho}`;
        // Older records without a snapshot cannot identify which status was cleared.
        return `Reset ${chunk(c.chunkId)} to locked${forWho}`;
      }
      return `${c.status === 'unlocked' ? 'Unlocked' : 'Changed'} ${chunk(c.chunkId)}${forWho}`;
    }
    case 'roll': return `Rolled ${c.count === 2 ? 'two chunks' : 'a chunk'}${forWho}`;
    case 'unlock-selection': return `Unlocked ${chunk(c.chunkId)} from the roll${forWho}`;
    case 'pick-for-me': return `Picked a rolled chunk at random${forWho}`;
    case 'unlock-both': return `Unlocked both rolled chunks${forWho}`;
    case 'cancel-roll': return `Cancelled the roll${forWho}`;
    case 'random-start': return `Chose ${c.count === 2 ? 'two random starting chunks' : 'a random start'}${forWho}`;
    case 'setup-start': return `Rolled starting banks${c.starts?.length ? `: ${c.starts.map(start => `${player(start.memberId)} at ${start.place || chunk(start.chunkId)}`).join(', ')}` : ''}`;
    case 'go-members': return `Restarted both maps for members${c.starts?.length ? `: ${c.starts.map(start => `${player(start.memberId)} at ${start.place || chunk(start.chunkId)}`).join('; ')}` : ''}`;
    case 'unpick': return `Forfeited ${c.unpicked ? chunk(c.unpicked) : 'an unlocked chunk'} at random${forWho}`;
    case 'set-starting-chunk': return c.chunkId === null ? `Cleared the starting chunk${forWho}` : `Set the starting chunk to ${chunk(c.chunkId)}${forWho}`;
    case 'set-note': return `${c.note ? 'Edited' : 'Cleared'} the note on ${chunk(c.chunkId)}${forWho}`;
    case 'set-journal': return `${c.note ? 'Edited' : 'Cleared'} the journal${forWho}`;
    case 'add-sticker': return `Added a sticker to ${chunk(c.chunkId)}${forWho}`;
    case 'set-sticker': return `${c.sticker === null ? 'Removed all stickers from' : 'Added a sticker to'} ${chunk(c.chunkId)}${forWho}`;
    case 'update-sticker': return `Changed a sticker on ${chunk(c.chunkId)}${forWho}`;
    case 'remove-sticker': return `Removed a sticker from ${chunk(c.chunkId)}${forWho}`;
    case 'clear-stickers': return `Removed all stickers from ${chunk(c.chunkId)}${forWho}`;
    case 'set-chunk-colour': return `${c.colour === null ? 'Cleared the colour on' : 'Coloured'} ${chunk(c.chunkId)}${forWho}`;
    case 'rename-chunk-colour': return `Named a chunk colour “${c.name}”${forWho}`;
    case 'set-task-status': {
      const parts = [];
      if (c.challengeCompleted !== undefined) parts.push(c.challengeCompleted ? `Ticked off ${task(c.taskId)}` : `Unticked ${task(c.taskId)}`);
      if (c.backlogged !== undefined) parts.push(c.backlogged ? `Backlogged ${task(c.taskId)}${c.backlogReason ? ` (${c.backlogReason})` : ''}` : `Restored ${task(c.taskId)} from the backlog`);
      if (c.favorite !== undefined) parts.push(c.favorite ? `Pinned ${task(c.taskId)}` : `Unpinned ${task(c.taskId)}`);
      if (c.note !== undefined) parts.push(`${c.note ? 'Edited' : 'Cleared'} the note on ${task(c.taskId)}`);
      return `${parts.join('; ') || `Changed ${task(c.taskId)}`}${forWho}`;
    }
    case 'clear-challenge-ticks': return `Unticked ${c.cleared ?? c.taskIds?.length ?? 'all checked'} tasks${c.reason ? ` (${c.reason})` : ''}${forWho}`;
    case 'tick-active-tasks': return `Ticked ${c.ticked ?? c.taskIds?.length ?? 'all'} active tasks${c.skipped ? ` (${c.skipped} left for a choice)` : ''}${forWho}`;
    case 'clear-backlog': return `Restored ${c.taskIds ? '' : 'all '}${c.restored ?? ''} backlogged tasks`.replace('  ', ' ') + forWho;
    case 'complete-task': return `${c.completed ? 'Marked' : 'Unmarked'} ${task(c.taskId)} as done in-game${forWho}`;
    case 'set-obtained-equipment': return c.obtained ? `Recorded ${c.equipmentName || 'equipment'} as obtained${forWho}` : `Removed the hand-added obtain record for ${c.equipmentName || 'equipment'}${forWho}`;
    case 'add-task': return c.task?.label ? `Added custom task “${c.task.label}”` : 'Added a custom task';
    case 'update-task': return `Edited custom task ${savedTask()}`;
    case 'delete-task': return `Deleted custom task ${savedTask()}`;
    case 'set-task-alternative': return `${c.taskId ? `Chose ${task(c.taskId)} as the preferred method` : 'Reset the preferred task method to automatic'}${forWho}`;
    case 'set-task-rule': return `${typeof c.value === 'boolean' ? 'Turned' : 'Changed'} ${rule()} ${onOff(c.value)}${forWho}`;
    case 'reset-task-rule': return `Reset ${rule()} to automatic${forWho}`;
    case 'set-rule-review': return `${c.reviewed ? 'Reviewed' : 'Reopened review of'} ${rule()}`;
    case 'set-rule': return `${typeof c.value === 'boolean' ? 'Turned' : 'Changed'} ${rule() === 'a rule' ? 'a shared rule' : `shared rule ${rule()}`} ${onOff(c.value)}`;
    case 'set-profile': return `Applied a rule preset${forWho}`;
    case 'set-preference': return `Changed ${setting ? `setting ${setting}` : 'a setting'}${forWho}`;
    case 'set-primary-override': return `${c.enabled === null || c.enabled === undefined ? 'Reset' : c.enabled ? 'Allowed' : 'Disallowed'} primary training${c.skill ? ` for ${c.skill}` : ''}${forWho}`;
    case 'set-skill-levels': return `Set ${c.skill ? `${c.skill} ` : ''}levels${forWho}`;
    case 'set-runescape-name': return `Set the RuneScape name${forWho}`;
    case 'apply-runemetrics': return `Synced skills and quests from ${c.source === 'official-api' ? 'RuneScape API' : c.source === 'hiscores' ? 'RS3 hiscores' : 'RuneMetrics'}${c.plugin ? ' + Game plugin' : ''}${forWho}`;
    case 'apply-game-progress': return c.items?.length && !c.skills?.length && !c.quests?.length && !c.achievements?.length
      ? `Ticked ${c.items.length === 1 ? 'a task' : `${c.items.length} tasks`} from items the game plugin saw${forWho}`
      : `Applied ${c.achievements?.length ? 'skills, quests and achievements' : 'skills and quests'}${c.items?.length ? ' and item tasks' : ''} from the game plugin${forWho}`;
    case 'set-xp-choices': return `Changed XP choices for ${savedTask()}${forWho}`;
    case 'sync-original': return `Synced from the original picker${(c.members ?? []).length ? ` for ${c.members.map(m => player(m.memberId)).join(' and ')}` : ''}`;
    case 'replace-member': return `Restored ${who || 'a player'}’s map from a backup`;
    case 'set-slayer-lock': return `${c.lock ? 'Set' : 'Cleared'} the Slayer lock${forWho}`;
    case 'set-section': return `Set a section of ${chunk(String(c.sectionId).split('-')[0])} to ${c.accessible === null ? 'automatic' : c.accessible ? 'accessible' : 'blocked'}${forWho}`;
    case 'set-area': return `Set ${named(c.areaId, chunkName, 'an area')} to ${c.accessible === null ? 'automatic' : c.accessible ? 'accessible' : 'blocked'}${forWho}`;
    case 'set-boss-unlock': return `${c.unlocked ? 'Unlocked' : 'Relocked'} ${bossGates.find(gate => gate.id === c.gate)?.boss ?? 'a boss'}${forWho}`;
    case 'set-source-backlog': return `${c.backlogged ? 'Backlogged' : 'Restored'} ${c.name ? `the source “${c.name}”` : 'an item source'}${forWho}`;
    case 'set-teleport': return `Saved ${c.teleport?.label ? `teleport “${c.teleport.label}”` : 'a teleport'}${forWho}`;
    case 'set-teleport-override': return `${c.value === null ? 'Reset automatic availability for' : c.value ? 'Marked usable' : 'Marked unusable'} ${named(c.routeId, routeLabel, 'a travel route')}${forWho}`;
    case 'delete-teleport': return `Deleted a teleport${forWho}`;
    case 'set-transport-facts': {
      const change = event.undo?.memberChanges?.find(member => member.id === c.memberId)?.changes
        ?.find(patch => patch.path.length === 1 && patch.path[0] === 'transportFacts');
      const previous = change ? change.before.value ?? {} : event.undo?.members?.find(member => member.id === c.memberId)?.transportFacts;
      const withoutCoins = facts => Object.fromEntries(Object.entries(facts ?? {}).flatMap(([key, value]) => {
        if (key !== 'currencies') return [[key, value]];
        const currencies = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'coins'));
        return Object.keys(currencies).length ? [[key, currencies]] : [];
      }));
      const stable = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
      if (previous !== undefined && stable(withoutCoins(previous)) === stable(withoutCoins(c.facts))
        && previous.currencies?.coins !== c.facts?.currencies?.coins) {
        return c.facts?.currencies?.coins === undefined ? `Cleared coins on hand${forWho}`
          : `Set coins on hand to ${c.facts.currencies.coins.toLocaleString('en-GB')}${forWho}`;
      }
      return `Updated travel unlocks${forWho}`;
    }
    case 'undo': return 'Undid a change';
    case 'restore': return 'Restored the whole save from a backup';
    case 'catalogue-refresh': return 'Updated game data';
    default: return 'Changed the save';
  }
}
