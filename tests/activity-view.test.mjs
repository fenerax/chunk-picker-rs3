import test from 'node:test';
import assert from 'node:assert/strict';
import { filterActivityView } from '../app/web/activity-view.mjs';

const done = { id: 'done', label: 'Done', personalCompleted: true, status: 'blocked', level: 30 };
const doable = { id: 'doable', label: 'Doable', status: 'available', blockers: [], level: 10 };
const blocked = { id: 'blocked', label: 'Blocked', status: 'blocked', blockers: [{ detail: 'Missing source.' }], level: 20 };
const filters = statuses => ({ statuses, questStatuses: [], sort: 'level' });
const ids = rows => rows.map(row => row.id);
function fixture() {
  const group = { name: 'Mixed', tasks: [done, blocked, doable], wholeCompletion: [done], availableCount: 1,
    personallyCompletedCount: 1, challengeSatisfiedCount: 0, questStatus: 'in-progress', canDoNow: true };
  return { skills: [{ skill: 'Mining', availableTasks: [doable], blockedTasks: [done, blocked] },
    { skill: 'Empty', availableTasks: [], blockedTasks: [] }], quests: [group], achievements: [{ ...group, required: true }],
    activities: [done, blocked, doable],
    slayer: { limitations: [], masters: [{ name: 'Master', method: doable, tasks: [
      { id: 'higher', planningEligible: true, requirements: { Level: 40 }, blockers: [] },
      { id: 'locked', planningEligible: false, requirements: { Level: 10 }, blockers: ['target'] },
      { id: 'lower', planningEligible: true, requirements: { Level: 20 }, blockers: [] },
    ] }] }, clues: { limitations: [], tiers: [{ tier: 'easy', totalCount: 3, availableCount: 1, tasks: [done, blocked, doable] }] } };
}

test('status choices reach nested rows on all six Activity Info tabs without mutating the calculation', () => {
  const view = fixture(), before = structuredClone(view);
  assert.deepEqual(ids(filterActivityView(view, filters(['blocked']), 'Activities').activities), ['blocked']);
  assert.deepEqual(ids(filterActivityView(view, filters(['blocked']), 'Skills').skills[0].filteredTasks), ['blocked']);
  assert.equal(filterActivityView(view, filters(['blocked']), 'Skills').skills.length, 1);
  for (const tab of ['Quests', 'Achievements']) {
    const group = filterActivityView(view, filters(['blocked']), tab)[tab.toLowerCase()][0];
    assert.deepEqual(ids(group.tasks), ['blocked']);
    assert.deepEqual(group.wholeCompletion, []);
    assert.equal(group.totalCount, 3);
    assert.equal(group.availableCount, 1, 'calculated counts keep their original scope');
  }
  assert.deepEqual(ids(filterActivityView(view, filters(['blocked']), 'Slayer').slayer.masters[0].tasks), ['locked']);
  assert.deepEqual(ids(filterActivityView(view, filters(['blocked']), 'Clues').clues.tiers[0].tasks), ['blocked']);
  assert.deepEqual(view, before);
});

test('Done retains checked steps without declaring a partially completed quest done', () => {
  const view = fixture();
  const shown = filterActivityView(view, filters(['done']), 'Quests').quests[0];
  assert.deepEqual(ids(shown.tasks), ['done']);
  assert.deepEqual(ids(shown.wholeCompletion), ['done']);
  assert.equal(filterActivityView(view, { ...filters([]), questStatuses: ['done'] }, 'Quests').quests.length, 0);
  assert.equal(filterActivityView(view, { ...filters(['done']), questStatuses: ['in-progress', 'can-do-now'] }, 'Quests').quests.length, 1);
});

test('level order reaches child methods, assignments and clue steps before pagination', () => {
  const view = fixture();
  assert.deepEqual(ids(filterActivityView(view, filters([]), 'Skills').skills[0].filteredTasks), ['doable', 'blocked', 'done']);
  assert.deepEqual(ids(filterActivityView(view, filters([]), 'Slayer').slayer.masters[0].tasks), ['locked', 'lower', 'higher']);
  assert.deepEqual(ids(filterActivityView(view, filters([]), 'Clues').clues.tiers[0].tasks), ['doable', 'blocked', 'done']);
  assert.deepEqual(ids(filterActivityView(view, filters(['done', 'doable']), 'Activities').activities), ['doable', 'done']);
});

test('empty selections remove containers while All preserves empty catalogue skills and tiers', () => {
  const view = fixture();
  assert.equal(filterActivityView(view, filters(['done']), 'Slayer').slayer.masters.length, 0);
  assert.equal(filterActivityView(view, filters([]), 'Skills').skills.length, 2);
  view.clues.tiers[0].tasks = [];
  assert.equal(filterActivityView(view, filters(['done']), 'Clues').clues.tiers.length, 0);
  assert.equal(filterActivityView(view, filters([]), 'Clues').clues.tiers.length, 1);
});
