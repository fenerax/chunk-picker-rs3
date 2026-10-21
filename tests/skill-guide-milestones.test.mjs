import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { skillGuideCatalogue, applySkillGuideTasks, isInformationalSkillGuideMilestone,
  SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE } from '../app/data/skill-guides.mjs';

test('every reviewed generated unlock is informational and requires a distinct default-off goal rule', () => {
  const tasks = skillGuideCatalogue.generatedTasks;
  assert.equal(tasks.length, 4);
  assert.ok(tasks.every(isInformationalSkillGuideMilestone));
  assert.deepEqual(tasks.map(task => task.record.Level), [34, 34, 49, 74]);
  assert.ok(tasks.every(task => task.selectorEvidence.wiki.revisionId && task.entryIds.length));
  const empty = { challenges: {} };
  assert.equal(applySkillGuideTasks(empty, { includeInformationalMilestones: false }), empty);
  assert.equal(Object.keys(applySkillGuideTasks(empty).challenges.Cooking).length, 4);
  assert.equal(createRuleRegistry().resolve({})[SKILL_GUIDE_MILESTONES_RULE], false);
});

test('a saved cache-guide opt-in cannot create no-burn obligations; explicit milestones can and toggle reverses', () => {
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }]);
  saved.rules[SKILL_GUIDE_TASKS_RULE] = true;
  const definitions = { chunks: { '12341': { Object: { Range: 1 }, Spawn: {
    'Raw shrimps': 1, 'Raw crayfish': 1, 'Raw trout': 1, 'Raw lobster': 1 } } },
    codeItems: { objectsPlus: { 'Cooking object[+]': ['Range'] } },
    challenges: { Cooking: { 'Cook practice food': { Level: 1, Primary: true, Objects: ['Range'] } } } };
  const engine = createTaskEngine(definitions);
  const off = engine.evaluate(saved, 'a');
  assert.ok(!off.tasks.some(task => task.tags?.includes('Skill guide unlock')));
  const optedIn = applyCommand(saved, { type: 'set-rule', ruleId: SKILL_GUIDE_MILESTONES_RULE, value: true }, { registry: createRuleRegistry() });
  const on = engine.evaluate(optedIn, 'a');
  const rows = on.tasks.filter(task => task.id.startsWith('rs3:task:skill-guide:'));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(task => task.obligation));
  assert.ok(rows.every(task => task.record.Output === undefined));
  assert.deepEqual(on.items, off.items);
  optedIn.rules[SKILL_GUIDE_MILESTONES_RULE] = false;
  assert.deepEqual(engine.evaluate(optedIn, 'a').tasks, off.tasks);
  saved.rules[SKILL_GUIDE_MILESTONES_RULE] = true;
  saved.rules[SKILL_GUIDE_TASKS_RULE] = false;
  assert.ok(!engine.evaluate(saved, 'a').tasks.some(task => task.id.startsWith('rs3:task:skill-guide:')));
});

test('productive reviewed guide actions retain the existing task-switch behavior', () => {
  const generated = { category: 'Crafting', label: 'Make token', entryIds: ['entry'], selectorEvidence: { object: 'Workbench' },
    record: { PickerId: 'rs3:task:skill-guide:productive', Level: 1, Objects: ['Workbench'], Output: 'Token', Category: ['Skill guide unlock'] } };
  const catalogue = { entries: [{ id: 'entry', skill: 'Crafting', level: 1, members: false }], generatedTasks: [generated] };
  assert.equal(isInformationalSkillGuideMilestone(generated), false);
  const definitions = { chunks: { '12341': { Object: { Workbench: 1 } } }, challenges: {} };
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }]);
  saved.rules[SKILL_GUIDE_TASKS_RULE] = true;
  assert.ok(createTaskEngine(definitions, { skillGuideCatalogue: catalogue }).evaluate(saved, 'a').items.some(item => item.name === 'Token'));
});
