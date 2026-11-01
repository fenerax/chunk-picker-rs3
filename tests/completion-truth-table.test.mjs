import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCompletionOverlay } from '../app/tasks/eligibility-cache.mjs';

// Independent expected values: each owner may satisfy a duty through either
// personal completion or a challenge tick. Scope chooses which owners count.
const cases = [
  { name: 'personal completion alone', completed: [true, false], ticked: [false, false],
    expected: { any: [true, true], all: [false, false], personal: [true, false] } },
  { name: 'challenge tick alone', completed: [false, false], ticked: [true, false],
    expected: { any: [true, true], all: [false, false], personal: [true, false] } },
  { name: 'different evidence for each owner', completed: [true, false], ticked: [false, true],
    expected: { any: [true, true], all: [true, true], personal: [true, true] } },
];

for (const row of cases) for (const scope of ['any', 'all', 'personal']) for (const index of [0, 1]) {
  test(`${row.name}: ${scope}, Player ${index === 0 ? 'A' : 'B'}`, () => {
    const state = { rules: { 'tasks.completion': scope }, members: ['a', 'b'].map((id, owner) => ({
      id, name: `Player ${owner === 0 ? 'A' : 'B'}`,
      completedTasks: row.completed[owner] ? ['fixture-goal'] : [],
      taskStatus: row.ticked[owner] ? { 'fixture-goal': { challengeCompleted: true } } : {},
    })) };
    const before = structuredClone(state);
    const result = applyCompletionOverlay({ tasks: [{ id: 'fixture-goal' }] }, state, state.members[index].id);
    assert.equal(result.tasks[0].challengeSatisfied, row.expected[scope][index]);
    assert.deepEqual(state, before);
  });
}
