import test from 'node:test';
import assert from 'node:assert/strict';
import { helperSkills, helperTrialCaps, personalSkillProgress, skillGoals, xpLookup, xpGap, dropChance, combatProjection } from '../app/web/helper-model.mjs';
import { xpForLevel } from '../app/core/experience.mjs';
import { combatLevelFromSkills } from '../app/core/combat-level.mjs';
import { projectPlayResult } from '../app/play-view.mjs';

const observation = (level, xp = xpForLevel(level), runescapeName = 'Example_GIM') => ({
  level, xp, runescapeName, source: 'runemetrics', fetchedAt: '2026-10-11T12:00:00Z',
});
const member = () => ({ id: 'player1', runescapeName: 'example gim', skillProgress: { Mining: observation(10) }, completedTasks: [] });
const task = (id, level, extra = {}) => ({ id, label: id, category: 'Mining', level, record: { Level: level },
  status: 'available', obligation: true, ...extra });
const row = (rows, skill) => rows.find(row => row.skill === skill);

test('full and projected cross-skill gates are level goals, never task completions', () => {
  const owner = member();
  const quest = task('quest', 1, { category: 'Quest', record: { Skills: { Mining: 20, Smithing: 15 }, Items: ['Ore'], Tasks: { Earlier: 'Quest' } } });
  const extra = task('extra', 1, { category: 'Extra', record: { Requirements: { Mining: 25 }, SkillReqs: { Crafting: 10 } } });
  const alternatives = task('alternative', 1, { category: 'Smithing', record: { RequirementAlternatives: [{ Skills: { Mining: 30 } }, { Skills: { Smithing: 30 } }] } });
  const membersOnly = task('members', 70, { category: 'Slayer' });
  const highTrial = task('trial', 21, { category: 'Archaeology' });
  const result = { tasks: [quest, extra, alternatives, membersOnly, highTrial], presentation: { tasks: [quest, extra, alternatives, membersOnly, highTrial] } };
  const full = skillGoals(owner, result);
  assert.equal(row(full, 'Mining').targetLevel, 25);
  assert.equal(row(full, 'Smithing').targetLevel, 15);
  assert.equal(row(full, 'Crafting').targetLevel, 10);
  assert.equal(row(full, 'Archaeology').targetLevel, null);
  assert.equal(row(full, 'Slayer').targetLevel, null);
  assert.equal(row(full, 'Mining').payoff[0].levelGoalsMet, 1);
  assert.equal(Object.hasOwn(row(full, 'Mining').payoff[0], 'completedTasks'), false);
  const projectedResult = projectPlayResult(result), compact = skillGoals(owner, projectedResult);
  assert.equal(row(compact, 'Mining').targetLevel, 25);
  assert.equal(row(compact, 'Smithing').targetLevel, 15);
  assert.equal(row(compact, 'Crafting').targetLevel, 10);
  assert.equal(row(compact, 'Mining').goals[0].requirementsComplete, false);
  const legacyResult = structuredClone(projectedResult);
  for (const task of legacyResult.tasks) delete task.skillRequirements;
  assert.equal(row(skillGoals(owner, legacyResult), 'Mining').targetLevel, null);
  assert.equal(row(skillGoals(owner, legacyResult), 'Smithing').targetLevel, null);
  const ordinary = task('mine', 40);
  const projected = projectPlayResult({ tasks: [ordinary], presentation: { tasks: [ordinary] } });
  assert.equal(row(skillGoals(owner, projected), 'Mining').targetLevel, 40);
  assert.equal(row(skillGoals(owner, projected), 'Mining').goals[0].requirementsComplete, false);
});

test('compact skillRequirements expose cross-skill goals while retaining personal scope and unknown remaining gates', () => {
  const owner = member(), quest = { id: 'quest', label: 'Quest level gates', category: 'Quest', status: 'available', obligation: true,
    skillRequirements: { Mining: 30, Smithing: 20, Slayer: 10, Archaeology: 21, Cooking: '40', Magic: NaN, Fishing: 0 } };
  const partner = { ...quest, id: 'partner', obligation: false, skillRequirements: { Mining: 90 } };
  const completed = { ...quest, id: 'complete', skillRequirements: { Mining: 99 } };
  const result = { format: 'play-v1', memberId: owner.id, tasks: [quest, partner, completed],
    presentation: { tasks: [quest, partner, completed], completedTasks: [{ id: 'complete' }] } };
  const before = structuredClone(result), rows = skillGoals(owner, result);
  const mining = row(rows, 'Mining'), smithing = row(rows, 'Smithing');
  assert.equal(mining.targetLevel, 30);
  assert.equal(smithing.targetLevel, 20);
  assert.equal(mining.xpRemaining, xpForLevel(30) - xpForLevel(10));
  assert.equal(smithing.currentLevel, null);
  assert.equal(smithing.xpRemaining, null);
  assert.deepEqual(mining.goals[0].requirements, { Mining: 30, Smithing: 20 });
  assert.equal(mining.goals[0].requirementsComplete, false);
  assert.deepEqual(mining.payoff.map(point => point.levelGoalsMet), [1]);
  assert.equal(row(rows, 'Archaeology').targetLevel, null);
  assert.equal(row(rows, 'Cooking').targetLevel, null);
  assert.equal(row(rows, 'Magic').targetLevel, null);
  assert.deepEqual(result, before);
});

test('all 28 trainable F2P skills retain personal progress and trial targets stop at their level caps', () => {
  assert.equal(helperSkills.length, 28);
  assert.equal(new Set(helperSkills).size, 28);
  assert.equal(helperSkills.includes('Invention'), false);
  assert.deepEqual(Object.values(helperTrialCaps).sort((a, b) => a - b), [5, 5, 5, 5, 5, 5, 5, 5, 20, 20, 20]);
  const owner = member(), tasks = [];
  for (const [skill, cap] of Object.entries(helperTrialCaps)) {
    owner.skillProgress[skill] = observation(cap);
    tasks.push(task(`${skill}:cap`, cap, { category: skill }), task(`${skill}:above`, cap + 1, { category: skill }));
  }
  const result = { tasks, presentation: { tasks } };
  for (const projected of [result, projectPlayResult(result)]) {
    const rows = skillGoals(owner, projected);
    for (const [skill, cap] of Object.entries(helperTrialCaps)) {
      const goal = row(rows, skill);
      assert.equal(goal.currentLevel, cap, skill);
      assert.equal(goal.targetLevel, cap, skill);
      assert.equal(goal.xpRemaining, 0, skill);
      assert.deepEqual(goal.goals.map(task => task.id), [`${skill}:cap`], skill);
    }
  }
  const compactQuest = { format: 'play-v1', tasks: [{ id: 'trial-quest', category: 'Quest', label: 'Trial gates', status: 'available',
    skillRequirements: { Agility: 5, Herblore: 6, Construction: 20, Archaeology: 21 } }] };
  const rows = skillGoals(owner, compactQuest);
  assert.equal(row(rows, 'Agility').targetLevel, 5);
  assert.equal(row(rows, 'Herblore').targetLevel, null);
  assert.equal(row(rows, 'Construction').targetLevel, 20);
  assert.equal(row(rows, 'Archaeology').targetLevel, null);
});

