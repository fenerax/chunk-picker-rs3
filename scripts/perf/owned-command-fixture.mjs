// Synthetic only: generate persisted identities through the gameplay migration.
import { createGroupState } from '../../app/core/state.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { migrateOwnedGameplay, hasGameplayMigration, hasCurrentProgressAliasMigration,
  hasCurrentJournalMigration, resolveSavedTaskId } from '../../app/tasks/migration.mjs';

export const ownedDataset = { capabilities: { independent: true }, datasetId: 'synthetic-owned',
  datasetContractVersion: 1, digest: 'synthetic-owned-digest' };
export const ownedNow = '2026-01-01T00:00:00.000Z';
export const ownedPickerId = 'synthetic-picker';
export const ownedWorld = buildWorld({ chunks: { '12341': {}, '12342': {} },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'] });
export const ownedRegistry = () => ({
  memberIds: ['synthetic-a', 'synthetic-b'],
  memberships: [{ pickerId: ownedPickerId, memberId: 'synthetic-a', role: 'owner' }],
  getPicker() { return { memberIds: this.memberIds }; },
  listAccounts() { return [{ memberships: this.memberships }]; },
});

export function ownedCatalogue({ taskCount = 24000, extraAliases = 19000 } = {}) {
  return Array.from({ length: taskCount }, (_, i) => {
    const suffix = String(i).padStart(5, '0'), label = `Synthetic objective ${suffix}`;
    return { id: `rs3:task:owned:${suffix}`, category: 'Synthetic', label, rawLabel: label,
      ...(i < extraAliases ? { aliases: [`t_synthetic_${suffix}`] } : {}) };
  });
}

export function ownedMigration(catalogue) {
  const definitions = { challenges: {} }, taskMap = {};
  const migrateState = (state, context) => {
    const previous = state.legacy?.gameplayMigration;
    const migration = migrateState.isCurrent(state) ? { state, reused: true, warnings: previous?.warnings ?? [],
      report: { ...previous?.report, catalogueTasks: state.tasks.length } }
      : { ...migrateOwnedGameplay(state, { definitions, taskMap, catalogue }), reused: false };
    if (migration.state.legacy?.gameplayMigration) {
      migration.state.legacy.gameplayMigration.warnings = migration.warnings;
      migration.state.legacy.gameplayMigration.report = migration.report;
    }
    context.migration = migration;
    context.catalogue = catalogue;
    return migration.state;
  };
  const catalogueIds = new Set(catalogue.map(task => task.id));
  // Mirror the server's migration currency conditions, including personal IDs.
  migrateState.isCurrent = state => {
    const previous = state.legacy?.gameplayMigration, registeredIds = new Set(state.tasks.map(task => task.id));
    return [...catalogueIds].every(id => registeredIds.has(id))
      && state.members.every(member => member.sourceMapId == null || previous?.schemaVersion >= 2 && hasGameplayMigration(state, member))
      && state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
        && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)))
      && hasCurrentProgressAliasMigration(state) && hasCurrentJournalMigration(state)
      && state.identityRegistry?.schemaVersion === 1 && (!previous || previous.schemaVersion >= 2);
  };
  return migrateState;
}

export function ownedCommandFixture({ taskCount = 24000, extraAliases = 19000, evidenceCopies = 16000 } = {}) {
  const catalogue = ownedCatalogue({ taskCount, extraAliases }), migrateState = ownedMigration(catalogue);
  const initial = createGroupState([
    { id: 'synthetic-a', name: 'Synthetic A', sourceMapId: 'synthetic-map-a', unlocked: ['12341'] },
    { id: 'synthetic-b', name: 'Synthetic B', sourceMapId: 'synthetic-map-b', unlocked: ['12342'] },
  ]);
  initial.legacy = { evidence: 'Synthetic retained migration evidence. '.repeat(evidenceCopies),
    maps: Object.fromEntries(initial.members.map(member => [member.sourceMapId,
      { rules: {}, chunkNotes: `Synthetic journal for ${member.id}`, chunks: {}, chunkinfo: {} }])) };
  initial.provenance = { dataset: { id: ownedDataset.datasetId,
    contractVersion: ownedDataset.datasetContractVersion, digest: ownedDataset.digest } };
  const state = migrateState(initial, {});
  return { state, catalogue, migrateState };
}

export const ownedCommandSequence = [
  { type: 'set-note', memberId: 'synthetic-a', chunkId: '12341', note: 'Synthetic note' },
  { type: 'complete-task', memberId: 'synthetic-a', taskId: 'rs3:task:owned:00000', completed: true },
  { type: 'set-rule', ruleId: 'access.shared', value: false },
  { type: 'undo' },
  { type: 'undo' },
  { type: 'set-note', memberId: 'synthetic-b', chunkId: '12342', note: 'Synthetic partner note' },
];
