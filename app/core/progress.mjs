import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/migration.mjs';
import { createTaskFactsIndex as createIndex } from './progress-index.mjs';
export { goalProgress } from './progress-index.mjs';

/** Full authored identity resolution for server and direct calculations. */
export function createTaskFactsIndex(snapshot, activeMemberId, registry, options = {}) {
  return createIndex(snapshot, activeMemberId, registry, options, { projectMemberTaskFacts, resolveSavedTaskId });
}
