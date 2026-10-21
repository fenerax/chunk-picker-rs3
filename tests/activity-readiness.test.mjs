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

test('readiness needs saved personal levels, preserves access blockers and does not mutate inputs', () => {
  const finish = task('finish', 'Quest', { QuestPoints: 0, Skills: { Mining: 20 } });
  const f = fixture([finish]);
  assert.equal(f.read().canDoNow, false);
  observe(f.member, 'Mining', 19);
  assert.equal(f.read().canDoNow, false);
  observe(f.member, 'Mining', 20);
  const before = structuredClone({ state: f.state, result: f.result });
  assert.equal(f.read().canDoNow, true);
  assert.equal(f.read().level, 20);
  assert.deepEqual({ state: f.state, result: f.result }, before);
  finish.blockers = [{ kind: 'access', detail: 'Entrance blocked.' }]; finish.status = 'blocked';
  assert.equal(f.read().canDoNow, false);
  finish.blockers = []; finish.status = 'available';
  observe(f.member, 'Mining', 99, 'Previous account');
  assert.equal(f.read().canDoNow, false);
});

test('partial personal progress differs from whole completion and partner challenge checks', () => {
  const step = task('step', 'Quest'), finish = task('finish', 'Quest', { QuestPoints: 0 });
  const f = fixture([step, finish]);
  finish.challengeSatisfied = true;
  assert.equal(f.read().questStatus, 'not-started');
  step.personalCompleted = true;
  assert.equal(f.read().questStatus, 'in-progress');
  assert.equal(f.read().canDoNow, true);
  finish.personalCompleted = true;
  assert.equal(f.read().questStatus, 'done');
  assert.equal(f.read().canDoNow, false);
  f.member.questProgress.finish = { source: 'runemetrics', runescapeName: 'Previous account' };
  assert.equal(f.read().questStatus, 'in-progress');
});

test('quest progress and search facts retain whole completion outside personal task obligations', () => {
  const step = task('step', 'Quest'), finish = task('finish', 'Quest', { QuestPoints: 0 }, { personalCompleted: true, obligation: false,
    status: 'blocked', blockers: [{ kind: 'access', detail: 'No longer accessible.' }] });
  const elsewhere = task('elsewhere', 'Other quest', {}, { obligation: false });
  const f = fixture([step, finish, elsewhere]);
  const view = buildActivityInfo(f.result, f.state, 'a');
  assert.equal(view.quests[0].questStatus, 'done');
  assert.equal(view.quests[0].wholeCompletion[0].id, finish.id);
  assert.equal(view.questStates[step.id].questStatus, 'done');
  assert.equal(view.questStates[finish.id].canDoNow, false);
  assert.equal(view.questStates[elsewhere.id].questStatus, 'not-started');
  assert.equal(view.quests.length, 1, 'source-only steps do not become personal task groups');
});

test('whole readiness permits internal steps but requires personal external quest aliases', () => {
  const prerequisite = task('prerequisite', 'Earlier', { QuestPoints: 1 }, { challengeSatisfied: true });
  const step = task('step', 'Quest', { Chunks: ['Place[+]'], Objects: ['Anvil'] });
  const finish = task('finish', 'Quest', { QuestPoints: 1, Tasks: { [step.rawLabel]: 'Quest', 'Earlier[+]': 'Quest' } });
  const f = fixture([prerequisite, step, finish]);
  const definitions = { codeItems: { chunksPlus: { 'Place[+]': ['1', '2'] }, tasksPlus: { 'Earlier[+]': [prerequisite.rawLabel] } } };
  assert.equal(f.read(definitions).canDoNow, false);
  prerequisite.personalCompleted = true;
  assert.equal(f.read(definitions).canDoNow, true);
  f.result.access.bases = [];
  assert.equal(f.read(definitions).canDoNow, false);
});

test('unknown selectors and absent whole-completion evidence fail closed', () => {
  const step = task('step', 'Quest', { Chunks: ['Unknown[+]'] });
  const f = fixture([step]);
  assert.equal(f.read().tasks[0].canDoNow, false);
  assert.equal(f.read().canDoNow, false);
  step.record = {}; step.personalCompleted = true;
  assert.equal(f.read().questStatus, 'in-progress');
});


test('whole completion follows its required alternative route, ignoring unrelated auxiliary steps', () => {
  const ready = task('ready', 'Quest', { Chunks: ['1'] });
  const blocked = task('blocked', 'Quest', { Chunks: ['2'] });
  const optional = task('optional', 'Quest', { Skills: { Mining: 99 } });
  const finish = task('finish', 'Quest', { QuestPoints: 1, Tasks: { 'Route[+]': 'Quest' } });
  const f = fixture([ready, blocked, optional, finish]);
  const definitions = { codeItems: { tasksPlus: { 'Route[+]': [ready.rawLabel, blocked.rawLabel] } } };
  let readiness = buildQuestReadiness(f.result, f.state, 'a', definitions);
  assert.equal(readiness.get(finish.id).canDoNow, true);
  assert.equal(readiness.get(optional.id).canDoNow, false);
  finish.record.Tasks = { 'Route[+]x2': 'Quest' };
  readiness = buildQuestReadiness(f.result, f.state, 'a', definitions);
  assert.equal(readiness.get(finish.id).canDoNow, false);
});

