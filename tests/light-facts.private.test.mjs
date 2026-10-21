import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, legacyTaskId, permanentTaskId } from '../app/tasks/identity.mjs';
import { projectIdentityRegistry, projectPlayState } from '../app/play-view.mjs';
import { projectMemberTaskFacts as fullProjection } from '../app/tasks/migration.mjs';
import { projectMemberTaskFacts, resolvePersistedIdentity } from '../app/tasks/fact-projection.mjs';
import { createTaskFactsIndex as fullIndex } from '../app/core/progress.mjs';
import { createTaskFactsIndex, goalProgress } from '../app/core/progress-index.mjs';
import { decodeLegacyText, hasGameplayMigration } from '../app/tasks/gameplay-compat.mjs';

// Exercise the server overlay for every queried identity, including derived rows.
function materialize(state, ids) {
  return { ...state, identityRegistry: projectIdentityRegistry({ ...state, tasks: [...(state.tasks ?? []), ...ids.map(id => ({ id }))] }) };
}

test('sparse rows preserve static and saved ambiguity without manufacturing a completion', () => {
  const raw = "~|Cook's Assistant|~ Complete the quest", old = legacyTaskId('Quest', raw), authored = permanentTaskId('Quest', raw);
  const competing = 'rs3:task:competing';
  const state = { rules: {}, tasks: [
    { id: 'unrelated', label: 'Unused', category: 'Quest' },
    { id: authored, label: 'Authored quest', category: 'Quest' },
    { id: old, label: 'Original ambiguous quest', category: 'Quest' },
    { id: competing, label: 'Saved competing identity', category: 'Quest' },
  ], identityRegistry: { entries: { [competing]: { id: competing, category: 'Quest', aliases: [] } }, aliases: { [old]: competing } },
  members: [{ id: 'a', completedTasks: [old], taskStatus: { [old]: { challengeCompleted: true }, [authored]: { challengeCompleted: false } } }] };
  const light = projectPlayState(state);
  assert.deepEqual(light.tasks, state.tasks.slice(1));
  assert.equal(resolvePersistedIdentity(old, light.identityRegistry).status, 'ambiguous');
  const full = fullIndex(state, 'a', { resolve: () => ({ 'tasks.completion': 'any' }) });
  const browser = createTaskFactsIndex(light, 'a', { resolve: () => ({ 'tasks.completion': 'any' }) });
  for (const task of light.tasks) assert.deepEqual(browser.get(task.id), full.get(task.id));
  assert.equal(browser.get(authored).group, false);
  assert.equal(browser.get(competing).group, false);
  assert.equal(browser.get(old).personal, true);
});

