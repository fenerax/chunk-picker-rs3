import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { readFileSync } from 'node:fs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { projectPlayTask } from '../app/play-view.mjs';
const reference = JSON.parse(readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json', import.meta.url)));

const state = () => createGroupState([{ id: 'a', name: 'A', unlocked: ['12341'] }, { id: 'b', name: 'B', unlocked: [] }]);
const definitions = alternatives => ({ chunks: { '12341': {} }, challenges: { Extra: {
  Gate: { Chunks: ['12341'], RequirementAlternatives: alternatives } } } });
const row = (engine, saved, member = 'a') => engine.evaluate(saved, member).tasks.find(task => task.label === 'Gate');

test('alternatives are OR clauses with personal skill and total-level requirements', () => {
  const engine = createTaskEngine(definitions([{ Skills: { Mining: 60 } }, { TotalLevelNeeded: 1000 }]));
  const saved = state();
  assert.equal(row(engine, saved).status, 'blocked');
  assert.match(row(engine, saved).blockers.find(blocker => blocker.kind === 'requirements').detail, /Mining 60 or total level 1000/);
  saved.members[0].passiveLevels = { Mining: 60 };
  assert.equal(row(engine, saved).status, 'available');
  saved.members[0].passiveLevels = Object.fromEntries('Attack Strength Defence Constitution Ranged Prayer Magic Runecrafting Crafting Mining Smithing Fishing Cooking Firemaking Woodcutting Fletching Dungeoneering'.split(' ').map(skill => [skill, 80]));
  saved.members[0].passiveLevels.Mining = 1;
  assert.equal(row(engine, saved).status, 'available');
  assert.equal(row(engine, saved, 'b').status, 'blocked');
});

test('fields inside a clause remain AND requirements and malformed alternatives fail closed', () => {
  const saved = state(); saved.members[0].passiveLevels = { Mining: 60 };
  const engine = createTaskEngine(definitions([{ Skills: { Mining: 60 }, TotalLevelNeeded: 1000 }]));
  assert.equal(row(engine, saved).status, 'blocked');
  for (const invalid of [[], [{}], [{ Skills: {} }], [{ Skills: { Bogus: 60 } }], [{ TotalLevelNeeded: '1000' }], [{ Surprise: 1 }]]) {
    assert.ok(row(createTaskEngine(definitions(invalid)), saved).blockers.some(blocker => blocker.kind === 'unsupported'));
  }
});

test('War entry has a genuine Combat alternative without creating boss-kill evidence or changing its permanent ID', () => {
  const record = { Chunks: ['12339'], Level: 60 };
  const data = { chunks: { '12339': {} }, challenges: { Combat: { 'Get access to ~|War\'s retreat|~': record } } };
  // Minimal custom records do not match the reviewed immutable retained record.
  assert.equal(createTaskEngine(data).catalogue[0].level, 60);
  const gate = { Chunks: ['12341'], RequirementAlternatives: [{ Skills: { Combat: 60 } }, { TotalLevelNeeded: 1000 }] };
  const prior = { Level: 60 };
  const fixture = definitions(gate.RequirementAlternatives);
  fixture.challenges.Combat = { 'Previous reached level': prior };
  const saved = state(); saved.members[0].completedTasks.push(taskId('Combat', 'Previous reached level', prior));
  assert.equal(row(createTaskEngine(fixture), saved).status, 'available');
  assert.equal(saved.members[0].transportFacts, undefined);
});

test('observed base skills prove War entry without a reachable combat method or inventing teleport availability', () => {
  const label = "Get access to ~|War's retreat|~";
  const data = { chunks: { '12339': {} }, challenges: { Combat: { [label]: reference.challenges.Combat[label] } } };
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12339'] }]);
  const member = saved.members[0]; member.runescapeName = 'Fixture';
  member.skillProgress = Object.fromEntries(Object.entries({ Attack: 50, Strength: 50, Defence: 55, Constitution: 55 }).map(([skill, level]) =>
    [skill, { level, xp: 1, source: 'runemetrics', runescapeName: 'Fixture' }]));
  const engine = createTaskEngine(data, { retainedTaskCorrections: true }), war = () => engine.evaluate(saved, 'a').tasks.find(task => task.id === 'rs3:task:0003c5');
  assert.equal(war().status, 'available');
  assert.equal(war().level, 1);
  assert.match(war().record.Description, /10 total boss kills/);
  const result = engine.evaluate(saved, 'a');
  assert.ok(selectPresentedTasks(result, saved, 'a', data).tasks.some(task => task.id === 'rs3:task:0003c5'));
  member.taskRules = { 'Show Skill Tasks': false };
  assert.ok(!selectPresentedTasks(result, saved, 'a', data).tasks.some(task => task.id === 'rs3:task:0003c5'), 'The skill-category display setting still applies to entry tasks.');
  member.taskRules = {};
  assert.equal(projectPlayTask(war()).level, undefined, 'A neutral metadata level is not displayed as an entry requirement.');
  assert.deepEqual(member.teleports, []);
  assert.equal(member.transportFacts, undefined);
  member.skillProgress.Attack.runescapeName = 'Other account';
  member.skillProgress.Strength.runescapeName = 'Other account';
  assert.equal(war().status, 'blocked');
});

test('the retained War alternative admits total level 1000 and rejects 999 at low Combat', () => {
  const label = "Get access to ~|War's retreat|~";
  const data = { chunks: { '12339': {} }, challenges: { Combat: { [label]: reference.challenges.Combat[label] } } };
  const saved = createGroupState([{ id: 'a', name: 'A', unlocked: ['12339'] }]);
  // Eight free noncombat skills at99 plus Fletching/Runecrafting/Dungeoneering
  // provide the threshold while every combat base stat stays1.
  saved.members[0].passiveLevels = { Crafting: 99, Mining: 99, Smithing: 99, Fishing: 99, Cooking: 99,
    Firemaking: 99, Woodcutting: 99, Fletching: 99, Runecrafting: 99, Dungeoneering: 90 };
  // 9*99 +90 +19 missing skills =1000 total.
  const engine = createTaskEngine(data, { retainedTaskCorrections: true }), war = () => engine.evaluate(saved, 'a').tasks.find(task => task.id === 'rs3:task:0003c5');
  assert.equal(war().status, 'available');
  saved.members[0].passiveLevels.Dungeoneering = 89;
  assert.equal(war().status, 'blocked');
  assert.match(war().blockers.find(blocker => blocker.kind === 'requirements').detail, /Combat 60 or total level 1000/);
});

test('alternative requirements do not erase genuine skill levels or their presentation ranking', () => {
  const saved = state();
  const make = (id, level) => ({ id, category: 'Mining', label: id, rawLabel: id, level, status: 'available', primary: true,
    record: { Level: level, RequirementAlternatives: [{ TotalLevelNeeded: 1000 }] } });
  const low = make('low', 20), high = make('high', 30);
  assert.equal(projectPlayTask(low).level, 20);
  const selected = selectPresentedTasks({ tasks: [low, high], training: { Mining: { primary: true } }, metrics: { processingPasses: 1 } }, saved, 'a');
  assert.deepEqual(selected.tasks.map(task => task.id), ['high']);
  assert.match(selected.suppressed.low[0], /higher skill goal/);
});

test('mixed skill clauses have explicit grouping with unchanged truth and partial How gaps', () => {
  for (const [clauses, wording] of [
    [[{ Skills: { Mining: 2, Fishing: 2 } }, { Skills: { Cooking: 2 } }], '(Mining 2 and Fishing 2) or Cooking 2'],
    [[{ Skills: { Mining: 2 } }, { Skills: { Fishing: 2, Cooking: 2 } }], 'Mining 2 or (Fishing 2 and Cooking 2)'],
    [[{ Skills: { Mining: 2, Fishing: 2 } }, { Skills: { Fishing: 2, Cooking: 2 } }], '(Mining 2 and Fishing 2) or (Fishing 2 and Cooking 2)'],
  ]) {
    const engine = createTaskEngine(definitions(clauses), { reviewedOverlays: false });
    const saved = state();
    const blocker = row(engine, saved).blockers.find(blocker => blocker.kind === 'requirements');
    assert.equal(blocker.detail, `Requires one of: ${wording}.`);
    // Independent reading of the displayed parenthesized OR-of-AND sentence.
    for (const Mining of [1, 2, 3]) for (const Fishing of [1, 2, 3]) for (const Cooking of [1, 2, 3]) {
      const levels = { Mining, Fishing, Cooking };
      const expected = wording.split(' or ').some(clause => clause.replace(/[()]/g, '').split(' and ').every(atom => {
        const [skill, required] = atom.split(' '); return levels[skill] >= Number(required);
      }));
      saved.members[0].passiveLevels = levels;
      assert.equal(row(engine, saved).status === 'available', expected);
    }
    const proof = engine.how(saved, 'a', row(engine, saved).id);
    assert.equal(proof.proofStatus, 'partial');
    assert.ok(proof.gaps.some(gap => gap.kind === 'special-requirements'));
  }
});
test('alternative descriptions remain authored and single-clause conjunctions remain explicit', () => {
  const fixture = definitions([{ Skills: { Mining: 2, Fishing: 2 } }]);
  assert.equal(row(createTaskEngine(fixture), state()).blockers.find(blocker => blocker.kind === 'requirements').detail,
    'Requires one of: Mining 2 and Fishing 2.');
  fixture.challenges.Extra.Gate.RequirementAlternativesDescription = 'the authored entry condition.';
  assert.equal(row(createTaskEngine(fixture), state()).blockers.find(blocker => blocker.kind === 'requirements').detail,
    'Requires the authored entry condition.');
});
