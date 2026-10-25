// Compact public synthetic cases shared by the regression and browser oracle.
import { groupFilterFixture } from './group-filter-fixture.mjs';
export function groupFilterCases() {
  const definitions = { challenges: Object.fromEntries(['Mining', 'Quest', 'Extra'].map(category => [category,
    Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`${category} ${i}`, { Level: i % 20, Description: `Synthetic ${category} task ${i}` }]))])) };
  const fixture = groupFilterFixture(definitions, { historyLength: 300 });
  const custom = { id: 'custom:synthetic', label: 'Custom', category: 'Extra', memberIds: ['one'], status: 'available' };
  fixture.state.tasks.push(custom);
  // Canonical false overrides the alias check; ambiguous references stay unresolved.
  fixture.state.members[0].taskStatus['rs3:task:synthetic:6'] = { challengeCompleted: false, favorite: true };
  fixture.state.members[0].taskStatus['historical:6'] = { challengeCompleted: true };
  fixture.results[0].tasks[3].aliases.push('ambiguous');
  fixture.state.members[1].taskStatus.ambiguous = { challengeCompleted: true };
  const scenarios = [];
  for (const completion of ['any', 'all', 'personal']) for (const unlocked of [false, true]) {
    const input = structuredClone(fixture);
    input.state.rules['tasks.completion'] = completion;
    if (unlocked) for (const result of input.results) for (const task of result.tasks) { task.status = 'available'; task.blockers = []; }
    for (const selectedMemberId of ['one', 'two']) for (const personalFilter of ['group', 'not-done', 'only-player'])
      for (const ownerFilter of ['all', 'both', 'one', 'two']) for (const showBlocked of [false, true]) for (const showCompleted of [false, true]) {
        scenarios.push({ ...input, options: { selectedMemberId, personalFilter, ownerFilter, showBlocked, showCompleted }, label: `${completion}:${unlocked}:${selectedMemberId}:${personalFilter}:${ownerFilter}:${showBlocked}:${showCompleted}` });
      }
  }
  return scenarios;
}
