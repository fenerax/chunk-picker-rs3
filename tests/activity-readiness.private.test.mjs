import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { buildQuestReadiness } from '../app/tasks/activity-readiness.mjs';

const task = (id, name, record = {}, extra = {}) => ({ id, category: 'Quest', rawLabel: `~|${name}|~ ${id === 'finish' ? 'Complete the quest' : id}`, label: `${name} ${id === 'finish' ? 'Complete the quest' : id}`, baseQuest: name, record, status: 'available', blockers: [], ...extra });
function fixture(tasks) {
  const state = { rules: { 'content.f2p': false }, members: [{ id: 'a', runescapeName: 'Alice', completedTasks: [], skillProgress: {}, questProgress: {} }, { id: 'b', completedTasks: [] }] };
  const result = { tasks, training: { Mining: { level: 99 } }, access: { bases: ['1'], objects: ['Anvil'] } };
  return { state, result, member: state.members[0], read: definitions => buildActivityInfo(result, state, 'a', definitions).quests.find(group => group.name === 'Quest') };
}
function observe(member, skill, level, name = 'Alice') {
  member.skillProgress[skill] = { source: 'runemetrics', level, xp: 100, runescapeName: name, fetchedAt: '2026-10-12T12:00:00Z' };
}

test('Cooking Guild prerequisite uses reachable sources and saved Cooking, without completion checkboxes', () => {
  const guild = { id: 'guild', category: 'Cooking', rawLabel: "Enter the ~|Cooks' Guild|~", label: "Enter the Cooks' Guild", level: 32, record: { Level: 32, Chunks: ['1'] }, status: 'available', blockers: [] };
  const finish = task('finish', 'Quest', { QuestPoints: 1, Tasks: { [guild.rawLabel]: 'Cooking' } });
  const f = fixture([guild, finish]);
  f.result.training.Cooking = { level: 99 };
  observe(f.member, 'Cooking', 31);
  assert.equal(buildQuestReadiness(f.result, f.state, 'a').get(finish.id).canDoNow, false);
  observe(f.member, 'Cooking', 32);
  assert.equal(buildQuestReadiness(f.result, f.state, 'a').get(finish.id).canDoNow, true);
  assert.deepEqual(f.member.completedTasks, []);
  f.result.access.bases = [];
  assert.equal(buildQuestReadiness(f.result, f.state, 'a').get(finish.id).canDoNow, false);
});

test('nonquest aliases recurse through saved skills, point alternatives, self links and cycles', () => {
  const recipe = { id: 'recipe', category: 'Cooking', rawLabel: 'Make food', label: 'Make food', level: 1, record: { RequirementAlternatives: [{ Skills: { Cooking: 40 } }, { Skills: { Cooking: 30 }, QuestPointsNeeded: 1 }], Tasks: { 'Make food': 'Cooking' } }, status: 'available', blockers: [] };
  const earlier = task('earlier', 'Earlier', { QuestPoints: 1 }, { personalCompleted: true, rawLabel: '~|Earlier|~ Complete the quest', label: 'Earlier Complete the quest' });
  const finish = task('finish', 'Quest', { QuestPoints: 1, Tasks: { 'Recipes[+]': 'Cooking' } });
  const f = fixture([recipe, earlier, finish]);
  const definitions = { codeItems: { tasksPlus: { 'Recipes[+]': [recipe.rawLabel] } } };
  observe(f.member, 'Cooking', 30);
  assert.equal(buildQuestReadiness(f.result, f.state, 'a', definitions).get(finish.id).canDoNow, true);
  earlier.personalCompleted = false;
  assert.equal(buildQuestReadiness(f.result, f.state, 'a', definitions).get(finish.id).canDoNow, false);
  observe(f.member, 'Cooking', 40);
  assert.equal(buildQuestReadiness(f.result, f.state, 'a', definitions).get(finish.id).canDoNow, true);
  recipe.record.Tasks = { [finish.rawLabel]: 'Quest' };
  assert.equal(buildQuestReadiness(f.result, f.state, 'a', definitions).get(finish.id).canDoNow, false);
  recipe.record.Tasks = {};
  recipe.record.RequirementAlternatives = [{}];
  assert.equal(buildQuestReadiness(f.result, f.state, 'a', definitions).get(finish.id).canDoNow, false);
});
