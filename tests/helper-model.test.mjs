import test from 'node:test';
import assert from 'node:assert/strict';
import { helperSkills, helperTrialCaps, personalSkillProgress, skillGoals, xpLookup, xpGap, dropChance, combatProjection } from '../app/web/helper-model.mjs';
import { xpForLevel } from '../app/core/experience.mjs';
import { combatLevelFromSkills } from '../app/core/combat-level.mjs';
import { projectPlayResult } from '../app/play-view.mjs';

const observation = (level, xp = xpForLevel(level), runescapeName = 'Example_GIM') => ({
  level, xp, runescapeName, source: 'runemetrics', fetchedAt: '2026-10-11T12:00:00Z',
});
const member = () => ({ id: 'actor1', runescapeName: 'example gim', skillProgress: { Mining: observation(10) }, completedTasks: [] });
const task = (id, level, extra = {}) => ({ id, label: id, category: 'Mining', level, record: { Level: level },
  status: 'available', obligation: true, ...extra });
const row = (rows, skill) => rows.find(row => row.skill === skill);

test('standard XP boundaries, remaining XP, and level 120 are explicit', () => {
  assert.equal(xpLookup(0).level, 1);
  assert.equal(xpLookup(82).level, 1);
  assert.equal(xpLookup(83).level, 2);
  assert.equal(xpLookup(xpForLevel(99) - 0.1).level, 98);
  assert.equal(xpLookup(xpForLevel(99)).level, 99);
  assert.equal(xpLookup(xpForLevel(120)).nextLevel, null);
  assert.equal(xpLookup(200_000_000).xpToNext, null);
  assert.equal(xpGap(84.5, 2).xpRemaining, 0);
  assert.equal(xpGap(0, 99).xpRemaining, 13_034_431);
  for (const invalid of [null, undefined, -1, NaN, Infinity, '83']) assert.throws(() => xpLookup(invalid), RangeError);
  assert.throws(() => xpGap(null, 20), RangeError);
  assert.throws(() => xpGap(0, 121), RangeError);
});

test('drop odds pool independent eligible duo kills and thresholds are minimal', () => {
  const odds = dropChance(128, 20, 30);
  assert.equal(odds.kills, 50);
  assert.ok(Math.abs(odds.probability - (1 - (127 / 128) ** 50)) < 1e-14);
  for (const threshold of odds.thresholds) {
    assert.ok(dropChance(128, threshold.kills).probability >= threshold.probability);
    assert.ok(dropChance(128, threshold.kills - 1).probability < threshold.probability);
    assert.equal(threshold.remainingKills, threshold.kills - 50);
  }
  assert.equal(dropChance(1, 0).probability, 0);
  assert.equal(dropChance(1, 0, 1).probability, 1);
  assert.deepEqual(dropChance(1, 1).thresholds.map(row => row.remainingKills), [0, 0, 0]);
  assert.ok(dropChance(1e20, 1).probability > 0);
  assert.equal(dropChance(1e20, 1).thresholds[0].kills, null);
  for (const invalid of [0, -1, NaN, Infinity, '128']) assert.throws(() => dropChance(invalid, 1), RangeError);
  assert.throws(() => dropChance(128, 0.5), RangeError);
  assert.throws(() => dropChance(128, 1, -1), RangeError);
  assert.throws(() => dropChance(128, Number.MAX_SAFE_INTEGER, 1), RangeError);
});

test('personal progress requires current account observations and ignores capabilities', () => {
  const input = member();
  input.skillProgress.Smithing = observation(50, xpForLevel(50), 'another');
  input.skillProgress.Fishing = { ...observation(40), source: 'manual' };
  input.skillProgress.Cooking = observation(40, Infinity);
  input.skillProgress.Slayer = observation(5);
  input.skillProgress.Invention = observation(99);
  input.passiveLevels = { Woodcutting: 99 };
  const progress = personalSkillProgress(input);
  assert.deepEqual(Object.keys(progress), ['Mining', 'Slayer']);
  assert.equal(progress.Mining.level, 10);
  progress.Mining.level = 90;
  assert.equal(input.skillProgress.Mining.level, 10);
  input.runescapeName = 'renamed';
  assert.deepEqual(personalSkillProgress(input), {});
});

test('goals follow active own obligations and completion families, never shared training ceilings', () => {
  const owner = member(); owner.taskStatus = { 'saved-family': { challengeCompleted: true } };
  const tasks = [task('low', 15), task('high', 30), task('partner', 80, { obligation: false }),
    task('hidden', 80, { hidden: true }), task('blocked', 80, { status: 'blocked' }),
    task('unsupported', 80, { status: 'unsupported' }), task('checked', 80, { challengeSatisfied: true }),
    task('personal', 80, { personalCompleted: true }), task('family', 80, { completionIds: ['saved-family'] }), task('suppressed', 99)];
  const result = { memberId: owner.id, tasks, training: { Mining: { level: 110 } },
    presentation: { tasks: tasks.filter(task => task.id !== 'suppressed') } };
  const before = structuredClone({ owner, result });
  const mining = row(skillGoals(owner, result), 'Mining');
  assert.equal(mining.currentLevel, 10);
  assert.equal(mining.targetLevel, 30);
  assert.equal(mining.xpRemaining, xpForLevel(30) - xpForLevel(10));
  assert.deepEqual(mining.goals.map(goal => goal.id), ['low', 'high']);
  assert.deepEqual(mining.payoff.map(point => [point.level, point.levelGoalsMet]), [[15, 1], [30, 2]]);
  assert.deepEqual({ owner, result }, before);
  assert.equal(row(skillGoals(owner, { ...result, memberId: 'reed' }), 'Mining').goalCount, 0);
  assert.equal(row(skillGoals({ ...owner, skillProgress: {} }, result), 'Mining').xpRemaining, null);
});




test('compact completed ledger and saved aliases exclude goals without treating checks as XP', () => {
  const owner = member(); owner.completedTasks = ['old'];
  const completed = task('complete', 90), aliased = task('new', 80, { aliases: ['old'] }), ordinary = task('mine', 15);
  const result = { format: 'play-v1', tasks: [completed, aliased, ordinary],
    presentation: { tasks: [completed, aliased, ordinary], completedTasks: [{ id: completed.id }] } };
  assert.deepEqual(row(skillGoals(owner, result), 'Mining').goals.map(goal => goal.id), ['mine']);
  assert.equal(row(skillGoals(owner, result), 'Mining').currentLevel, 10);
});

test('combat projection delegates the existing formula and F2P caps', () => {
  const levels = { Attack: 50, Strength: 45, Defence: 40, Constitution: 45, Prayer: 30, Ranged: 20, Magic: 40, Necromancy: 99, Summoning: 99 };
  assert.equal(combatProjection(levels), combatLevelFromSkills(levels, { f2p: true }));
  assert.equal(combatProjection(levels, { f2p: false }), combatLevelFromSkills(levels));
  assert.ok(combatProjection(levels) < combatProjection(levels, { f2p: false }));
  assert.equal(combatProjection({}), combatLevelFromSkills({}, { f2p: true }));
});
