import { buildOwnedBase } from '../../app/storage/owned-base.mjs';
import { createOwnedBaseManifest } from '../../app/storage/owned-base-schema.mjs';
import { createGroupState } from '../../app/core/state.mjs';
import { buildWorld } from '../../app/data/world.mjs';

export const first = 'rs3:task:synthetic-first', second = 'rs3:task:synthetic-second';
export const generated = 'rs3:goal:synthetic-generated', custom = 'custom:synthetic';
export const now = () => '2026-01-01T00:00:00.000Z';
export const world = buildWorld({ chunks: { '100': {}, '101': {} }, walkableChunks: ['100', '101'], walkableChunksF2P: ['100', '101'] });
export const taskCatalogue = new Map([[generated, { id: generated, label: 'Synthetic generated', category: 'Synthetic', aliases: ['collision'], kind: 'collection' }]]);
export function fixture() {
  const tasks = [{ label: 'Synthetic first', id: first, category: 'Synthetic' }, { id: second, label: 'Synthetic second', category: 'Synthetic' }];
  const identityRegistry = { schemaVersion: 1, entries: {
    [first]: { label: 'Synthetic first', kind: 'task', category: 'Synthetic', aliases: [] },
    [second]: { label: 'Synthetic second', kind: 'task', category: 'Synthetic', aliases: [] },
    [generated]: { label: 'Synthetic generated', kind: 'collection', category: 'Synthetic', aliases: [] } },
  aliases: { collision: [second, first], 'first-alias': first }, unresolved: [] };
  const built = buildOwnedBase({ dataset: { id: 'synthetic', contractVersion: 1, digest: 'b'.repeat(64) }, tasks, identityRegistry });
  const state = createGroupState([1, 2].map(index => ({ id: `member-${index}`, name: `Synthetic member ${index}` })));
  state.tasks = [tasks[0], { label: 'Synthetic custom', category: 'Custom', id: custom, memberIds: ['member-1', 'member-2'] }, tasks[1]];
  state.identityRegistry = structuredClone(identityRegistry);
  state.legacy = { synthetic: { retained: true } };
  return { ...built, state, manifest: createOwnedBaseManifest([built.pin]) };
}
export function options(catalogueRoot) {
  const built = fixture();
  return { pickerId: 'synthetic-picker', catalogueRoot, dataset: built.pin.dataset, manifest: built.manifest, releaseBytes: built.bytes };
}
export const commands = [
  { type: 'tick-active-tasks', memberId: 'member-1', taskIds: [first, generated] },
  { type: 'update-task', taskId: custom, task: { label: 'Synthetic edit one', memberIds: ['member-1', 'member-2'] } },
  { type: 'claim-task', memberId: 'member-1', taskId: custom },
  { type: 'update-task', taskId: custom, task: { label: 'Synthetic edit two', memberIds: ['member-2'] } },
  { type: 'set-task-status', memberId: 'member-2', taskId: custom, favorite: true, note: 'Synthetic coordination' },
  { type: 'delete-task', taskId: custom },
  { type: 'add-task', task: { id: 'custom:synthetic-added', label: 'Synthetic addition', category: 'Custom' } },
  { type: 'set-rule', ruleId: 'access.shared', value: false },
];
