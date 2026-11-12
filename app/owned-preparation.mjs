import { isDeepStrictEqual } from 'node:util';
import { hasGameplayMigration, hasCurrentProgressAliasMigration, hasCurrentJournalMigration,
  migrateOwnedGameplay, resolveSavedTaskId, hasCompleteMigrationCatalogue } from './tasks/migration.mjs';
import { legacyTaskId } from './tasks/identity.mjs';

const preparationInputs = new WeakMap();
export function pinnedOwnedMigrationInputs(runtime, base) {
  let runtimes = preparationInputs.get(base);
  if (!runtimes) preparationInputs.set(base, runtimes = new WeakMap());
  if (runtimes.has(runtime.taskWorker)) return runtimes.get(runtime.taskWorker);
  const ids = new Set(base.tasks.map(row => row.id)), aliases = base.identityRegistry.aliases;
  // Retain the existing migration's label enumeration and History boundary,
  // but only for identities present in this pin. Share this projection across
  // all groups using the same base/runtime, never one definition tree per group.
  const challenges = Object.fromEntries(Object.entries(runtime.parsedDefinitions.challenges ?? {})
    .filter(([, rows]) => rows && typeof rows === 'object' && !Array.isArray(rows)).map(([category, rows]) =>
    [category, Object.fromEntries(Object.entries(rows).filter(([label]) => {
      const alias = legacyTaskId(category, label), targets = aliases[alias];
      return ids.has(alias) || (typeof targets === 'string' ? [targets] : targets ?? []).some(id => ids.has(id));
    }))]));
  const inputs = { definitions: { challenges }, catalogue: base.tasks, identityBase: base.identityRegistry,
    taskMap: runtime.parsedTaskMap, taskMapHistory: runtime.identityHistory,
    dynamicCatalogue: runtime.taskWorker.dynamicCatalogue };
  runtimes.set(runtime.taskWorker, inputs); return inputs;
}

/** A serving context is bound to one verified save pin for its entire lifetime.
 * The runtime supplies definitions/world; the pin supplies catalogue identities.
 * No automatic dataset upgrade or release-catalogue substitution occurs here. */
export function createPinnedOwnedMigration(runtime, base) {
  const dataset = base.dataset;
  const assertPin = state => {
    if (!isDeepStrictEqual(state.provenance?.dataset, dataset)) throw Object.assign(new Error('Choose a backup from this picker’s pinned dataset.'), { status: 422 });
  };
  const catalogueIds = new Set(base.tasks.map(row => row.id));
  const current = state => {
    assertPin(state);
    const previous = state.legacy?.gameplayMigration;
    return hasCompleteMigrationCatalogue(state, catalogueIds)
      && state.members.every(member => member.sourceMapId == null || previous?.schemaVersion >= 2 && hasGameplayMigration(state, member))
      && state.members.every(member => [...member.completedTasks, ...Object.keys(member.taskStatus ?? {})].every(id => resolveSavedTaskId(state.identityRegistry, id) === id)
        && Object.entries(member.taskAlternatives ?? {}).every(([category, groups]) => Object.values(groups).every(id => id === null || resolveSavedTaskId(state.identityRegistry, id, category) === id)))
      && hasCurrentProgressAliasMigration(state) && hasCurrentJournalMigration(state)
      && state.identityRegistry?.schemaVersion === 1 && (!previous || previous.schemaVersion >= 2);
  };
  const migrate = (state, context) => {
    assertPin(state);
    const previous = state.legacy?.gameplayMigration, reusable = current(state);
    // Fresh groups begin with the pinned identities, including retained alias
    // candidate order. Imports retain their own explicit overrides as before.
    state.identityRegistry ??= structuredClone(base.identityRegistry);
    const migration = reusable ? { state, reused: true, warnings: previous?.warnings ?? [], report: {
      ...(previous?.report ?? { imported: previous?.imported ?? {}, unresolved: previous?.unresolved ?? [], taskStatusProvenance: previous?.taskStatusProvenance ?? [] }),
      catalogueTasks: state.tasks.length,
    } } : { ...migrateOwnedGameplay(state, pinnedOwnedMigrationInputs(runtime, base)), reused: false };
    if (migration.state.legacy?.gameplayMigration) {
      migration.state.legacy.gameplayMigration.warnings = migration.warnings;
      migration.state.legacy.gameplayMigration.report = migration.report;
    }
    context.migration = migration; context.catalogue = base.tasks;
    return migration.state;
  };
  migrate.isCurrent = current;
  return migrate;
}
