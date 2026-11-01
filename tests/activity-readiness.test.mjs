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


function mandatoryFixture() {
  const stage = task('mandatory', 'Earlier');
  const whole = task('whole', 'Earlier', { QuestPoints: 1, Tasks: { [stage.rawLabel]: 'Quest' } },
    { rawLabel: '~|Earlier|~ Complete the quest', label: 'Earlier Complete the quest' });
  const gate = task('gate', 'Quest', { Tasks: { [stage.rawLabel]: 'Quest' } });
  const finish = task('finish', 'Quest', { QuestPoints: 0, Tasks: { [gate.rawLabel]: 'Quest' } });
  return { ...fixture([stage, whole, gate, finish]), stage, whole, gate, finish };
}

test('personal whole completion proves a mandatory external stage without completing or rewarding it', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  f.stage.record.Output = 'Stage-only reward';
  f.stage.obligation = false;
  const before = structuredClone({ result: f.result, state: f.state });
  const ready = buildQuestReadiness(f.result, f.state, 'a');
  assert.equal(ready.get(f.gate.id).canDoNow, true);
  assert.equal(ready.get(f.stage.id).personalCompleted, false);
  const view = f.read();
  assert.equal(view.canDoNow, true);
  assert.equal(view.questStatus, 'not-started');
  assert.deepEqual({ result: f.result, state: f.state }, before);
});

test('mandatory-stage evidence needs current personal completion; exact manual completion still works', () => {
  const f = mandatoryFixture();
  const can = () => f.read().canDoNow;
  assert.equal(can(), false);
  f.whole.challengeSatisfied = true;
  f.state.members[1].completedTasks = [f.whole.id];
  assert.equal(can(), false);
  f.stage.personalCompleted = true;
  assert.equal(can(), true);
  f.stage.personalCompleted = false; f.whole.personalCompleted = true;
  for (const observation of [
    { source: 'runemetrics', runescapeName: 'Previous account' },
    { source: 'game-plugin', memberId: 'b' },
    { source: 'unknown', runescapeName: 'Alice' },
  ]) {
    f.member.questProgress[f.whole.id] = observation;
    assert.equal(can(), false);
  }
  for (const observation of [
    { source: 'runemetrics', runescapeName: 'Alice' },
    { source: 'official-api', runescapeName: 'Alice' },
    { source: 'game-plugin', memberId: 'a' },
  ]) {
    f.member.questProgress[f.whole.id] = { ...observation, fetchedAt: '2026-10-12T12:00:00Z' };
    assert.equal(can(), true);
  }
  f.whole.personalCompleted = false;
  assert.equal(can(), false, 'an observation alone cannot replace personal completion');
});

test('whole completion excludes optional restoration and alternative stages, retaining counted groups', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  const other = task('other-route', 'Earlier'), restoration = task('restoration', 'Earlier');
  f.result.tasks.push(other, restoration);
  const definitions = { codeItems: { tasksPlus: { 'Routes[+]': [f.stage.rawLabel, other.rawLabel] } } };
  f.whole.record.Tasks = { 'routes[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false, 'either route may have been used');
  f.whole.record.Tasks = { 'Routes[+]x2': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true, 'both routes are mandatory');
  f.gate.record.Tasks = { [restoration.rawLabel]: 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false, 'unreferenced restoration is optional');
  f.gate.record.Tasks = { [f.stage.rawLabel]: 'Quest' };
  definitions.codeItems.tasksPlus['Routes[+]'] = [f.stage.rawLabel, other.rawLabel, restoration.rawLabel];
  assert.equal(f.read(definitions).canDoNow, false, 'two of three does not prove any particular stage');
  f.whole.record.Tasks = { 'Routes[+]x3': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true);
  definitions.codeItems.tasksPlus['Routes[+]'] = [f.stage.rawLabel, f.stage.rawLabel];
  f.whole.record.Tasks = { 'Routes[+]x2': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false, 'duplicate labels cannot meet a count twice');
});

test('a shared transitive stage is mandatory across alternative routes, independent of row order', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  const left = task('left', 'Earlier', { Tasks: { [f.stage.rawLabel]: 'Quest' } });
  const right = task('right', 'Earlier', { Tasks: { [f.stage.rawLabel]: 'Quest' } });
  f.result.tasks.push(left, right);
  const definitions = { codeItems: { tasksPlus: { 'Routes[+]': [left.rawLabel, right.rawLabel] } } };
  f.whole.record.Tasks = { 'Routes[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true);
  f.result.tasks.reverse();
  assert.equal(f.read(definitions).canDoNow, true);
  right.record.Tasks = {};
  assert.equal(f.read(definitions).canDoNow, false, 'the second route bypasses the stage');
});

test('subquest completion only proves stages required by that subquest, not sibling subquests', () => {
  const f = mandatoryFixture();
  f.whole.label = 'Earlier Complete the subquest';
  f.whole.rawLabel = '~|Earlier|~ Complete the subquest';
  f.whole.personalCompleted = true;
  assert.equal(f.read().canDoNow, true);
  const sibling = task('sibling', 'Sibling');
  f.result.tasks.push(sibling);
  f.gate.record.Tasks = { [sibling.rawLabel]: 'Quest' };
  assert.equal(f.read().canDoNow, false);
  // A counted parent route through other quests is not permission to invent
  // personal completion of a sibling or traverse that sibling's stages.
  f.whole.record.Tasks = { [sibling.rawLabel]: 'Quest' };
  assert.equal(f.read().canDoNow, false);
});

test('mandatory-stage proofs reject unsatisfiable cycles but accept finite alternative routes', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  const loop = task('loop', 'Earlier', { Tasks: { [f.stage.rawLabel]: 'Quest' } });
  f.result.tasks.push(loop);
  f.stage.record.Tasks = { [loop.rawLabel]: 'Quest' };
  assert.equal(f.read().canDoNow, false, 'cyclic declarations do not prove every stage vacuously');
  const entry = task('entry', 'Earlier'); f.result.tasks.push(entry);
  const definitions = { codeItems: { tasksPlus: { 'Entry[+]': [loop.rawLabel, entry.rawLabel] } } };
  f.stage.record.Tasks = { 'Entry[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true);
  f.whole.record.Tasks = { [f.stage.rawLabel]: 'Quest', [f.whole.rawLabel]: 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true, 'reference self-links retain their existing meaning');
});

test('missing or ambiguous routes and non-whole lore records cannot prove stages', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  f.whole.record.Tasks = { [f.stage.rawLabel]: 'Quest', 'Unknown[+]': 'Quest' };
  assert.equal(f.read().canDoNow, false);
  const definitions = { codeItems: { tasksPlus: { 'Routes[+]': [f.stage.rawLabel, 'Missing row'] } } };
  f.whole.record.Tasks = { 'Routes[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false);
  definitions.codeItems.tasksPlus = { 'ROUTES[+]': [f.stage.rawLabel], 'Routes[+]': [f.stage.rawLabel] };
  f.whole.record.Tasks = { 'routes[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false);
  f.whole.record.Tasks = { [f.stage.rawLabel]: 'Quest' };
  f.whole.label = 'Earlier lore reward';
  assert.equal(f.read().canDoNow, false);
  f.whole.label = 'Archaeology Mystery: Earlier';
  assert.equal(f.read().canDoNow, false);
});

test('mandatory evidence preserves downstream access, membership and unsupported blockers', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  assert.equal(f.read().canDoNow, true);
  for (const kind of ['access', 'membership', 'unsupported', 'manual']) {
    f.gate.status = 'blocked'; f.gate.blockers = [{ kind, detail: 'Separate requirement' }];
    assert.equal(f.read().canDoNow, false, kind);
  }
  f.gate.status = 'available'; f.gate.blockers = [];
  f.gate.record['Not F2P'] = true; f.state.rules['content.f2p'] = true;
  assert.equal(f.read().canDoNow, false);
  f.state.rules['content.f2p'] = false;
  assert.equal(f.read().canDoNow, true);
});


test('mandatory-stage evidence agrees with exhaustive finite-route footprints on counted cyclic graphs', () => {
  let seed = 173;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 80; sample++) {
    const stages = Array.from({ length: 4 }, (_, n) => task(`s${n}`, 'Earlier'));
    const whole = task('whole', 'Earlier', { QuestPoints: 1 },
      { rawLabel: '~|Earlier|~ Complete the quest', label: 'Earlier Complete the quest', personalCompleted: true });
    const rows = [...stages, whole], groups = rows.map((_, index) => {
      const choices = stages.map((_, n) => n).filter(n => n !== index && random(3) !== 0);
      return choices.length && (index === 4 || random(3)) ? [{ choices, count: 1 + random(choices.length) }] : [];
    });
    const definitions = { codeItems: { tasksPlus: {} } };
    rows.forEach((row, n) => {
      row.record.Tasks = {};
      for (const group of groups[n]) {
        const alias = `Route${n}[+]`;
        definitions.codeItems.tasksPlus[alias] = group.choices.map(i => stages[i].rawLabel);
        row.record.Tasks[`${alias}x${group.count}`] = 'Quest';
      }
    });
    // Enumerate all legal execution footprints (at most 32), then intersect
    // those containing completion. No production graph resolver is reused.
    const traces = new Set([0]), queue = [0];
    for (const mask of queue) for (let n = 0; n < rows.length; n++) {
      if (mask & 1 << n || !groups[n].every(g => g.choices.filter(i => mask & 1 << i).length >= g.count)) continue;
      const next = mask | 1 << n;
      if (!traces.has(next)) { traces.add(next); queue.push(next); }
    }
    const complete = [...traces].filter(mask => mask & 16);
    const probes = stages.map((stage, n) => task(`probe${n}`, 'Probe', { Tasks: { [stage.rawLabel]: 'Quest' } }));
    const f = fixture([...rows, ...probes]);
    const readiness = buildQuestReadiness(f.result, f.state, 'a', definitions);
    stages.forEach((_, n) => assert.equal(readiness.get(probes[n].id).canDoNow,
      !!complete.length && complete.every(mask => mask & 1 << n), `sample ${sample}, stage ${n}`));
  }
});


test('counted subquest routes prove shared stages while preserving optional branch stages', () => {
  const f = mandatoryFixture(); f.whole.personalCompleted = true;
  const branch = task('branch', 'Earlier');
  const left = task('left', 'Earlier', { QuestPoints: 0, Tasks: { [f.stage.rawLabel]: 'Quest', [branch.rawLabel]: 'Quest' } },
    { label: 'Earlier left Complete the subquest', rawLabel: '~|Earlier|~ left Complete the subquest' });
  const right = task('right', 'Earlier', { QuestPoints: 0, Tasks: { [f.stage.rawLabel]: 'Quest' } },
    { label: 'Earlier right Complete the subquest', rawLabel: '~|Earlier|~ right Complete the subquest' });
  f.result.tasks.push(branch, left, right);
  const definitions = { codeItems: { tasksPlus: { 'Subquests[+]': [left.rawLabel, right.rawLabel] } } };
  f.whole.record.Tasks = { 'Subquests[+]': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true, 'shared stage is mandatory through either subquest');
  f.gate.record.Tasks = { [branch.rawLabel]: 'Quest' };
  assert.equal(f.read(definitions).canDoNow, false);
  f.whole.record.Tasks = { 'Subquests[+]x2': 'Quest' };
  assert.equal(f.read(definitions).canDoNow, true, 'both subquests and their stages are required');
});
