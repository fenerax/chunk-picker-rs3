import { migrateOwnedGameplay, hasCurrentProgressAliasMigration, hasCurrentJournalMigration, hasGameplayMigration, resolveSavedTaskId } from '../../../app/tasks/migration.mjs';
import { preserveGameIdentity } from '../../../app/game-profile.mjs';

// Use the real migration/validation hook boundary, never hand-author migration
// versions. Catalogue inputs come from the same calculator handshake as serving.
export function fixtureMigration(inputs, dataset) {
  const catalogueIds = inputs.catalogue.map(row => row.id);
  const current = state => {
    const ids = new Set(state.tasks.map(row => row.id)), previous = state.legacy?.gameplayMigration;
    return catalogueIds.every(id => ids.has(id)) && state.identityRegistry?.schemaVersion === 1
      && (!previous || previous.schemaVersion >= 2) && hasCurrentProgressAliasMigration(state) && hasCurrentJournalMigration(state)
      && state.members.every(member => (member.sourceMapId == null || previous?.schemaVersion >= 2 && hasGameplayMigration(state, member))
        && [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
        && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)));
  };
  const migrateState = (state, context) => {
    if (current(state)) return state;
    const migration = migrateOwnedGameplay(state, inputs);
    if (migration.state.legacy?.gameplayMigration) {
      migration.state.legacy.gameplayMigration.warnings = migration.warnings;
      migration.state.legacy.gameplayMigration.report = migration.report;
    }
    context.migration = migration;
    context.catalogue = inputs.catalogue;
    return migration.state;
  };
  migrateState.isCurrent = current;
  return { migrateState,
    prepareState: preserveGameIdentity(dataset),
  };
}

// Calibrate immutable identity data rather than inflating the executable task
// graph. Long synthetic historical labels approximate serialized input volume;
// they are not evidence of equivalent dependency or alias distributions.
export function calibrateIdentities(state, shape) {
  if (!shape.aliases) return state;
  const registry = state.identityRegistry;
  const ids = state.tasks.map(row => row.id), existing = Object.keys(registry.aliases).length;
  if (existing > shape.aliases) throw new Error('Synthetic migration exceeds alias target.');
  const missing = shape.aliases - existing;
  for (let i = 0; i < missing; i++) registry.aliases[`Synthetic historical label ${i}`] = ids[i % ids.length];
  const extra = Math.max(0, (shape.stateBytes ?? 0) - Buffer.byteLength(JSON.stringify(state)));
  for (let i = 0; i < missing; i++) {
    const key = `Synthetic historical label ${i}`, target = registry.aliases[key];
    delete registry.aliases[key];
    registry.aliases[key + 'x'.repeat(Math.floor(extra / missing) + Number(i < extra % missing))] = target;
  }
  return state;
}
