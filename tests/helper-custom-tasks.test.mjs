import test from 'node:test';
import assert from 'node:assert/strict';
import { skillGoals } from '../app/web/helper-model.mjs';
import { renderGoals } from '../app/web/helper-goals.mjs';

const member = id => ({ id, completedTasks: [], taskStatus: {} });
const custom = (id, level, extra = {}) => ({ id: `custom:${id}`, label: id, skill: 'Mining', category: 'Mining', level, ...extra });
const result = tasks => ({ memberId: 'actor1', format: 'play-v1', tasks, presentation: { tasks } });
const mining = rows => rows.find(row => row.skill === 'Mining');
const state = tasks => ({ tasks, members: [member('actor1'), member('reed')], rules: {} });

test('saved custom skill targets merge with loaded tasks before their level is reached', () => {
  const saved = state([custom('high', 80), custom('low', 20), custom('note', undefined), custom('partner', 99, { memberIds: ['reed'] })]);
  const ordinary = { id: 'mine', label: 'Mine ore', category: 'Mining', level: 30, status: 'available' };
  const before = structuredClone(saved);
  const row = mining(skillGoals(saved.members[0], result([ordinary]), saved));
  assert.equal(row.targetLevel, 80);
  assert.equal(row.currentLevel, null);
  assert.equal(row.xpRemaining, null);
  assert.deepEqual(row.goals.map(goal => goal.id), ['custom:low', 'mine', 'custom:high']);
  assert.deepEqual(saved, before);
});

test('custom goals use saved edits and assignment without duplicating engine rows', () => {
  const saved = state([custom('edit', 55, { label: 'Saved label' })]);
  const stale = { ...custom('edit', 25, { label: 'Stale label' }), status: 'available' };
  const row = mining(skillGoals(saved.members[0], result([stale, stale]), saved));
  assert.equal(row.goalCount, 1);
  assert.equal(row.targetLevel, 55);
  assert.equal(row.goals[0].label, 'Saved label');
  saved.tasks[0].memberIds = ['reed'];
  assert.equal(mining(skillGoals(saved.members[0], result([stale]), saved)).goalCount, 0);
  saved.tasks = [];
  assert.equal(mining(skillGoals(saved.members[0], result([stale]), saved)).goalCount, 0);
});

test('reassignment ignores old custom completion flags from a cached presentation', () => {
  const task = custom('reassigned', 80, { memberIds: ['reed'] }), saved = state([task]);
  saved.members[0].taskStatus[task.id] = { challengeCompleted: true };
  const old = { ...task, status: 'available', challengeSatisfied: true };
  const loaded = { memberId: 'reed', tasks: [old], presentation: { tasks: [], completedTasks: [old] } };
  assert.equal(mining(skillGoals(saved.members[1], loaded, saved)).targetLevel, 80);
});

test('custom goals exclude backlog, personal checks, completion families and group completion', () => {
  const tasks = [custom('backlog', 20), custom('actual', 30), custom('check', 40), custom('family', 50, { aliases: ['custom:old'] }), custom('group', 60)];
  const saved = state(tasks), owner = saved.members[0];
  owner.taskStatus = { 'custom:backlog': { backlogged: true }, 'custom:check': { challengeCompleted: true } };
  owner.completedTasks = ['custom:actual', 'custom:old'];
  saved.members[1].taskStatus = { 'custom:group': { challengeCompleted: true } };
  assert.equal(mining(skillGoals(owner, result([]), saved)).goalCount, 0);
  saved.rules['tasks.completion'] = 'personal';
  assert.deepEqual(mining(skillGoals(owner, result([]), saved)).goals.map(goal => goal.id), ['custom:group']);
  saved.rules['tasks.completion'] = 'all';
  assert.equal(mining(skillGoals(owner, result([]), saved)).goalCount, 1);
  saved.tasks.find(task => task.id === 'custom:group').memberIds = ['reed'];
  assert.equal(mining(skillGoals(owner, result([]), saved)).goalCount, 0);
});


test('legacy category targets and Invention targets retain levels without standard-curve XP', () => {
  const saved = state([custom('legacy', 35, { skill: undefined }), custom('invent', 80, { skill: 'Invention', category: 'Invention' })]);
  const rows = skillGoals(saved.members[0], result([]), saved);
  assert.equal(mining(rows).targetLevel, 35);
  const invention = rows.find(row => row.skill === 'Invention');
  assert.equal(invention.targetLevel, 80);
  assert.equal(invention.targetXp, null);
  assert.equal(invention.xpRemaining, null);
  assert.equal(invention.payoff[0].xp, null);
  saved.members[0].runescapeName = 'actor1';
  saved.members[0].skillProgress = { Invention: { source: 'runemetrics', runescapeName: 'actor1', level: 45, xp: 1_000_000 } };
  const observed = skillGoals(saved.members[0], result([]), saved).find(row => row.skill === 'Invention');
  assert.equal(observed.currentLevel, 45);
  assert.equal(observed.currentXp, 1_000_000);
  assert.equal(observed.xpRemaining, null);
  saved.members[0].runescapeName = 'renamed';
  assert.equal(skillGoals(saved.members[0], result([]), saved).find(row => row.skill === 'Invention').currentLevel, null);
});

test('goals view passes saved custom targets to the visible task table and grind action', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, action) { this.events[key] = action; }
  }
  const document = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  const saved = state([custom('Gather goal', 50)]), host = new Node('main'), plans = [];
  renderGoals(host, { document, member: saved.members[0], getResult: () => result([]), getState: () => saved,
    onPlan: (...args) => plans.push(args) });
  const walk = node => [node, ...node.children.flatMap(walk)];
  assert.ok(walk(host).some(node => node.textContent === 'Gather goal — level 50'));
  const button = walk(host).find(node => node.tag === 'button' && node.textContent === 'Plan Mining to 50');
  button.events.click();
  assert.deepEqual(plans, [['Mining', 50]]);
});
