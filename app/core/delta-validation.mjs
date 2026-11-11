import { applyCommand, applyResidentCommand, applyValidatedCommand, validateState, validateResidentState } from './state.mjs';
import { isResidentState, reconcileResidentIdentities } from './resident-copy.mjs';
import { freezeIdentityTree } from '../tasks/identity-dictionary.mjs';
import { resolveSavedTaskId } from '../tasks/migration.mjs';
import { createRuleRegistry } from './rules.mjs';

/** Private command-validation session. A proof belongs to an exact, deeply
 * immutable snapshot, never a revision number or caller-supplied cache key.
 * Unrecognized roots (including hook output, hydration and roster changes)
 * cross the full validator before they can acquire a proof. */
export function createDeltaCommandValidator(registry = createRuleRegistry()) {
  const proofs = new WeakSet(), taskIds = new WeakMap();
  function remember(state) {
    freezeIdentityTree(state);
    proofs.add(state);
    return state;
  }
  function validate(state) {
    if (proofs.has(state)) return state;
    return remember(isResidentState(state) ? validateResidentState(state, registry) : validateState(state, registry));
  }
  function everyday(state, command) {
    // Claim cleanup can rewrite older inverses. Catalogue registration can
    // change historical reference interpretation. Both retain full validation.
    if (!Object.isFrozen(registry) || Object.keys(state.taskClaims ?? {}).length) return false;
    if (command?.type === 'set-note') return true;
    if (command?.type === 'tick-active-tasks') {
      let ids = taskIds.get(state.tasks);
      if (!ids) { ids = new Set(state.tasks.map(row => row.id)); taskIds.set(state.tasks, ids); }
      return Array.isArray(command.taskIds) && command.taskIds.every(id => ids.has(resolveSavedTaskId(state.identityRegistry, id)));
    }
    if (command?.type !== 'undo') return false;
    const target = state.history.findLast(event => event.undo && event.undoneRevision === undefined && event.type !== 'undo');
    return target && (command.undoRevision === undefined || command.undoRevision === target.revision)
      && ['set-note', 'tick-active-tasks'].includes(target.type)
      && Object.keys(target.undo).every(key => key === 'memberChanges')
      && target.undo.memberChanges?.every(change => change.changes.every(patch =>
        patch.path[0] === (target.type === 'set-note' ? 'notes' : 'taskStatus')));
  }
  function apply(state, command, options = {}) {
    const baseline = validate(state), resident = isResidentState(baseline);
    // The ordinary full command path remains the oracle/fallback. In particular
    // it validates all historical task assignments against the current roster.
    let next = everyday(baseline, command)
      ? applyValidatedCommand(baseline, command, { ...options, registry })
      : resident ? validateResidentState(applyResidentCommand(baseline, command, { ...options, registry }), registry)
        : applyCommand(baseline, command, { ...options, registry });
    if (resident) next = reconcileResidentIdentities(next, baseline);
    return remember(next);
  }
  return Object.freeze({ validate, apply });
}
