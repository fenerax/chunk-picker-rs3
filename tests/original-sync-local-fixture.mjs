import { readFile } from 'node:fs/promises';
import { applyCommand, createGroupState } from '../app/core/state.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { previewOriginalSync, originalSyncCommand } from '../app/integrations/original-sync.mjs';

export const unlockFixture = JSON.parse(await readFile(new URL('./fixtures/original-sync/local-unlocks.json', import.meta.url), 'utf8'));
export const cleanupFixture = JSON.parse(await readFile(new URL('./fixtures/original-sync/local-task-cleanup.json', import.meta.url), 'utf8'));
export const transferred = Array.from({ length: cleanupFixture.transferredTaskCount }, (_, i) => ({
  id: `rs3:task:fff2${i.toString(16).padStart(4, '0')}`, label: `Transferred task ${i + 1}`, category: cleanupFixture.transferredCategory,
}));
export const extraTasks = cleanupFixture.extraTasks;
export const rows = [...transferred, ...extraTasks].map(({ id, label, category }) => ({ id, label, category }));
export const definitions = { chunks: Object.fromEntries(['12850', '12851', '12852', '12853', '12854', '12855', '12856', '13106'].map(id => [id, { name: `Chunk ${id}` }])),
  walkableChunks: ['12850', '12851', '12852', '12853', '12854', '12855', '12856', '13106'],
  walkableChunksF2P: ['12850', '12851', '12852', '12853', '12854', '12855', '12856', '13106'] };
export const world = buildWorld(definitions);
const now = () => '2026-10-12T12:00:00.000Z';
export const apply = (state, command) => applyCommand(state, command, { expectedRevision: state.revision, now, world });
const map = (unlocked, selected = [], potential = [], tasks = []) => ({ chunks: { unlocked, selected, potential }, rules: {}, chunkinfo:
  Object.fromEntries(cleanupFixture.originalCheckFields.map(field => [field, Object.fromEntries([...new Set(tasks.map(task => task.category))]
    .map(category => [category, Object.fromEntries(tasks.filter(task => task.category === category).map(task => [task.id, true]))]))])) });
export const capture = (baseline = false) => ({ metadata: { capturedAt: '2026-10-12T11:00:00.000Z', hash: `sha256:${'b'.repeat(64)}` }, maps: {
  qxa: map(baseline ? unlockFixture.baselineUnlocked : unlockFixture.originalUnlocked,
    baseline ? [] : unlockFixture.originalSelected, baseline ? [] : unlockFixture.originalPending,
    baseline ? rows.filter(task => !extraTasks.some(extra => extra.id === task.id && !extra.initiallyChecked)) : rows),
  qxb: map(['13106'], [], [], transferred),
} });
export const review = (state, document = capture()) => previewOriginalSync(state, document);
export const syncCommand = (proposal, groups = ['chunks', 'selections', 'pendingRoll', 'tasks'], memberIds = ['player1']) =>
  originalSyncCommand(proposal, memberIds.map(memberId => ({ memberId, groups })));
export function baseline(taskStatus) {
  let state = createGroupState([{ id: 'player1', name: 'Player 1', sourceMapId: 'qxa' }, { id: 'player2', name: 'Player 2', sourceMapId: 'qxb' }]);
  state.tasks = rows;
  if (taskStatus) state.members[0].taskStatus = taskStatus;
  return apply(state, syncCommand(review(state, capture(true)), ['chunks', 'tasks'], ['player1', 'player2']));
}
export function locallyChanged() {
  let state = baseline();
  for (const command of unlockFixture.localCommands) state = apply(state, command);
  state = apply(state, { type: 'clear-challenge-ticks', memberId: 'player1', taskIds: transferred.map(task => task.id), reason: cleanupFixture.cleanupReason });
  for (const task of extraTasks.filter(task => task.localStatus)) state = apply(state, { type: 'set-task-status', memberId: 'player1', taskId: task.id, ...task.localStatus });
  return state;
}
