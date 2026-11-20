// @test quick dataset=default
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState, applyCommand, exportBackup, importBackup, previewRestore, validateState } from '../app/core/state.mjs';
import { createRuleRegistry, evaluateRollPool, partnerConnections } from '../app/core/rules.mjs';
import { computeRollStats } from '../app/core/roll-stats.mjs';
import { createTaskFactsIndex } from '../app/core/progress-index.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { createTaskEngine, taskId } from '../app/tasks/engine.mjs';
import { evaluateEquipment, buildCurrentBiS } from '../app/tasks/equipment.mjs';
import { analyzeAreaCheck } from '../app/tasks/area-check.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { buildPartnerSupplyModel } from '../app/web/partner-supply-model.mjs';
import { selectDuoTasks } from '../app/web/duo-tasks.mjs';
import { selectDuoTaskLists } from '../app/web/duo-task-lists.mjs';
import { describeHistoryEvent } from '../app/web/history-text.mjs';
import { createScreenDialogs } from '../app/web/screen-dialogs.mjs';

const now = () => '2026-11-18T12:00:00.000Z';
const registry = createRuleRegistry();
const chunks = Array.from({ length: 7 }, (_, i) => String(12341 + i));
const bankRows = chunks.slice(0, 5).map(chunkId => ({ chunkId, place: `Bank ${chunkId}` }));
const banks = { version: 'synthetic-v1', optionA: bankRows, optionAF2PExtension: bankRows,
  optionAConditional: [], optionB: bankRows, optionBConditional: [] };
function fixture(size, started = false) {
  const members = Array.from({ length: size }, (_, i) => ({ id: `explorer${i + 1}`, name: `Explorer ${i + 1}`,
    ...(started ? { unlocked: [chunks[i]] } : {}) }));
  const data = { chunks: Object.fromEntries(chunks.map((id, i) => [id, { Object: { 'Shared bench': true }, Spawn: { [`Token ${i + 1}`]: 1 } }])),
    sections: Object.fromEntries(chunks.map((id, i) => [id, { '0': [chunks[i - 1], chunks[i + 1]].filter(Boolean) }])),
    walkableChunks: chunks, walkableChunksF2P: chunks, codeItems: {},
    challenges: { Extra: { Shared: { Objects: ['Shared bench'] }, ...Object.fromEntries(members.map((_, i) =>
      [`Personal ${i + 1}`, { Chunks: [chunks[i]], Items: [`Token ${size}`] }])) } } };
  const state = createGroupState(members), world = buildWorld(data), engine = createTaskEngine(data);
  state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  state.rules = { 'content.f2p': true, 'access.shared': true };
  const options = { now, random: () => 0, world, registry, membersStartBanks: banks };
  return { state, world, engine, options, data };
}

for (const size of [1, 2, 3, 4, 5]) {
  test(`${size} players: start, personal roll, members start, Undo and schema-1 backup round trip`, () => {
    const f = fixture(size), original = structuredClone(f.state);
    let state = applyCommand(f.state, { type: 'setup-start' }, f.options);
    assert.deepEqual(f.state, original);
    assert.equal(state.history.at(-1).command.starts.length, size);
    assert.equal(new Set(state.members.flatMap(member => member.unlocked)).size, size);
    for (const member of state.members) {
      assert.equal(member.unlocked.length, 1);
      assert.equal(member.preferences.startingChunk, member.unlocked[0]);
      const before = structuredClone(state.members);
      // Hand selections are a normal roll source, and remain per-character.
      state = applyCommand(state, { type: 'set-chunk', memberId: member.id, chunkId: chunks.at(-1), status: 'selected' }, f.options);
      state = applyCommand(state, { type: 'roll', memberId: member.id, count: 1 }, f.options);
      assert.ok(state.members.find(owner => owner.id === member.id).unlocked.length > 1);
      assert.deepEqual(state.members.filter(owner => owner.id !== member.id), before.filter(owner => owner.id !== member.id));
      state = applyCommand(state, { type: 'undo' }, f.options);
      assert.deepEqual(state.members.find(owner => owner.id === member.id).unlocked, member.unlocked);
    }
    const beforeMembers = structuredClone(state);
    state = applyCommand(state, { type: 'go-members', options: { pairing: 'different' } }, f.options);
    assert.equal(state.rules['content.f2p'], false);
    assert.equal(state.history.at(-1).command.starts.length, size);
    assert.equal(new Set(state.members.flatMap(member => member.unlocked)).size, size);
    const text = describeHistoryEvent(state.history.at(-1), { memberName: id => state.members.find(member => member.id === id).name });
    assert.match(text, size === 1 ? /Restarted the map/ : size === 2 ? /Restarted both maps/ : /Restarted group maps/);
    for (const member of state.members) {
      assert.deepEqual(member.f2pMap.unlocked, beforeMembers.members.find(owner => owner.id === member.id).unlocked);
      assert.ok(text.includes(member.name));
    }
    const backup = exportBackup(state, registry), restored = importBackup(JSON.parse(JSON.stringify(backup)), registry);
    assert.equal(restored.schemaVersion, 1);
    assert.deepEqual(restored, state);
    assert.equal(previewRestore(beforeMembers, backup, registry).members.length, size);
    const undone = applyCommand(restored, { type: 'undo' }, f.options);
    assert.deepEqual(undone.members, beforeMembers.members);
    assert.deepEqual(undone.rules, beforeMembers.rules);
    validateState(undone, registry);
  });

  test(`${size} players: all sources, personal obligations, task policies, goals and independent Undo`, () => {
    const f = fixture(size, true), last = f.state.members.at(-1), shared = taskId('Extra', 'Shared');
    let state = f.state;
    const results = new Map(state.members.map(member => {
      const result = f.engine.evaluate(state, member.id);
      return [member.id, { ...result, presentation: selectPresentedTasks(result, state, member.id, f.data), memberId: member.id, stateRevision: state.revision }];
    }));
    for (const [i, member] of state.members.entries()) {
      const result = results.get(member.id);
      assert.equal(result.tasks.find(task => task.id === taskId('Extra', `Personal ${i + 1}`)).obligation, true);
      const expectedOutside = size === 1 ? 'Outside your unlocked chunks.'
        : size === 2 ? "Outside your own chunks — only reachable through your partner's map, so it isn't required."
          : "Outside your own chunks — only reachable through another group member's map, so it isn't required.";
      const expectedOwner = size === 2 ? "your partner's" : "another group member's";
      for (let j = 0; j < size; j++) if (j !== i) {
        const otherTask = result.tasks.find(task => task.id === taskId('Extra', `Personal ${j + 1}`));
        assert.equal(otherTask.obligation, false);
        assert.ok(otherTask.hiddenReasons.includes(expectedOutside));
      }
      if (i !== size - 1) {
        const ownTask = result.tasks.find(task => task.id === taskId('Extra', `Personal ${i + 1}`));
        assert.ok(ownTask.explanation.includes(`Token ${size} comes from ${expectedOwner} connected chunks.`));
        const proof = f.engine.how(state, member.id, ownTask.id);
        assert.ok(proof.gaps.some(gap => gap.detail === `This item comes from ${expectedOwner} map.`));
      }
      assert.ok(result.items.some(item => item.name === `Token ${size}`));
      const connections = partnerConnections(f.world, state, member.id, registry);
      assert.equal(connections.regions.length, size - 1);
      assert.ok(connections.regions.every(region => region.connected));
      const roll = evaluateRollPool(f.world, state, member.id, registry);
      const selectedState = { ...state, members: state.members.map(m => m.id === member.id ? { ...m, selected: [chunks[i]] } : m) };
      const selectedRoll = evaluateRollPool(f.world, selectedState, member.id, registry);
      const expectedUnlockedBlocker = size === 1 ? 'Already unlocked on your map.'
        : size === 2 ? 'Already unlocked on your map. Chunks only your partner unlocked can still be rolled.'
          : 'Already unlocked on your map. Chunks only other group members unlocked can still be rolled.';
      assert.ok(selectedRoll.excluded.find(row => row.id === chunks[i])?.reasons.some(r => r.ruleId === 'state.unlocked' && r.detail === expectedUnlockedBlocker));
      if (i === 0 && size > 1) assert.ok(!roll.eligible.some(row => row.id === chunks[size]), 'the far edge of another map cannot widen a personal roll');
    }
    const rollStats = computeRollStats(state, { now: now() });
    assert.equal(rollStats.duo.name, size === 1 ? 'Solo' : size === 2 ? 'Duo' : 'Group');
    const firstResult = results.get(state.members[0].id);
    const bis = buildCurrentBiS(firstResult, evaluateEquipment(firstResult, state, state.members[0].id, f.data), state, state.members[0].id, f.data);
    const expectedBisNote = size === 1 ? 'Uses only items you marked as obtained and can currently get and equip. Ammo must be marked separately. Ticking a task does not add its gear to your account.'
      : size === 2 ? "Uses only items you marked as obtained and can currently get and equip. Ammo must be marked separately. Ticking tasks and your partner's gear don't count for you."
        : "Uses only items you marked as obtained and can currently get and equip. Ammo must be marked separately. Ticking tasks and other group members' gear don't count for you.";
    assert.ok(bis.owned.recordedBest.coverage.limitations.includes(expectedBisNote));
    const areaCheck = analyzeAreaCheck(state, state.members[0].id, { chunkIds: [chunks[0]], asMembers: false }, { engine: f.engine, definitions: f.data, world: f.world });
    const expectedAreaNote = size === 1 ? 'Alone checks only the chunks you selected. Combined adds the selected chunks to your current map.'
      : size === 2 ? "Alone checks only the chunks you selected (without your partner's map). Combined adds them to your current map and keeps your partner's connected chunks."
        : "Alone checks only the chunks you selected (without your group's chunks). Combined adds them to your current map and keeps your group's connected chunks.";
    assert.ok(areaCheck.limitations.includes(expectedAreaNote));
    const supplies = buildPartnerSupplyModel(state, results, registry);
    if (size > 1) assert.ok(supplies.members[0].requests.some(request => request.items.some(item => item.sources.some(source => source.memberId === last.id))));
    else assert.deepEqual(supplies.members[0].requests, []);
    const view = selectDuoTasks({ state, results, registry, selectedMemberId: state.members[0].id });
    const common = view.rows.find(row => row.id === shared);
    assert.ok(common, JSON.stringify(results.get(state.members[0].id).tasks.find(task => task.id === shared)));
    assert.deepEqual(common.memberIds, state.members.map(member => member.id));
    assert.equal(common.label, size === 2 ? 'Both' : state.members.map(member => member.name).join(', '));
    state = applyCommand(state, { type: 'set-task-status', memberId: last.id, taskId: shared, challengeCompleted: true }, f.options);
    for (const mode of ['any', 'all', 'personal']) for (const member of state.members) {
      const snapshot = { ...state, rules: { ...state.rules, 'tasks.completion': mode } };
      const facts = createTaskFactsIndex(snapshot, member.id, registry).get(shared);
      assert.equal(facts.group, mode === 'any' || (mode === 'all' ? size === 1 : member.id === last.id));
      assert.equal(facts.actual, false, 'shared checks never grant personal game progress');
    }
    const current = new Map([...results].map(([id, result]) => [id, { ...result, stateRevision: state.revision }]));
    const completed = selectDuoTaskLists({ state, results: current, registry, selectedMemberId: last.id }).completed.rows.find(row => row.id === shared);
    assert.equal(completed.label, common.label);
    state = applyCommand(state, { type: 'add-group-goal', goalId: 'group-goal:journey', text: 'Reach the banks', completion: 'players' }, f.options);
    for (const [i, member] of state.members.entries()) {
      state = applyCommand(state, { type: 'set-group-goal-done', goalId: 'group-goal:journey', memberId: member.id, done: true }, f.options);
      assert.equal(state.groupGoals[0].done, i === size - 1);
    }
    const beforeNote = structuredClone(state);
    state = applyCommand(state, { type: 'set-note', memberId: last.id, chunkId: chunks[size - 1], note: 'Synthetic note' }, f.options);
    const noteRevision = state.revision;
    state = applyCommand(state, { type: 'set-journal', memberId: state.members[0].id, note: 'Keep this later journal' }, f.options);
    const roundTrip = importBackup(exportBackup(state, registry), registry);
    state = applyCommand(roundTrip, { type: 'undo', undoRevision: noteRevision }, f.options);
    assert.deepEqual(state.members.at(-1).notes, beforeNote.members.at(-1).notes);
    assert.equal(state.members[0].journal, 'Keep this later journal');
    assert.deepEqual(state.groupGoals, beforeNote.groupGoals);
  });
}

test('five-player travel refuses unclaimed gaps and one-way routes without copying personal teleports', () => {
  const { state, world } = fixture(5, true);
  state.members[1].unlocked = [];
  const disconnected = partnerConnections(world, state, state.members[0].id, registry);
  assert.ok(disconnected.regions.some(region => region.ownerId === state.members[4].id && !region.connected));
  state.members[0].teleports = [{ id: 'synthetic-way-in', label: 'One way in', destination: chunks[4], available: true }];
  const oneWay = partnerConnections(world, state, state.members[0].id, registry);
  assert.ok(oneWay.regions.some(region => region.ownerId === state.members[4].id && region.reason === 'no route back'));
  assert.deepEqual(state.members[4].teleports, []);
});

test('unclaimed blocked tasks and personal-access mode use neutral outside-your-map hidden reason', () => {
  const f = fixture(2, true);
  f.state.members[1].unlocked = [];
  const unclaimed = f.engine.evaluate(f.state, f.state.members[0].id);
  const blockedTask = unclaimed.tasks.find(task => task.id === taskId('Extra', 'Personal 2'));
  assert.equal(blockedTask.status, 'blocked');
  assert.ok(blockedTask.hiddenReasons.includes('Outside your unlocked chunks.'));
  assert.equal(blockedTask.hiddenReasons.some(reason => /partner's map/.test(reason)), false);
  const personal = fixture(2, true);
  personal.state.rules['access.shared'] = false;
  const personalResult = personal.engine.evaluate(personal.state, personal.state.members[0].id);
  const personalOther = personalResult.tasks.find(task => task.id === taskId('Extra', 'Personal 2'));
  assert.ok(personalOther.hiddenReasons.includes('Outside your unlocked chunks.'));
});

test('replacement summaries use the preview roster without requiring current screen state', () => {
  const el = (tag, text = '') => ({ tag, text, children: [], append(...children) { this.children.push(...children); } });
  for (const size of [1, 2, 3, 5, 32]) for (const currentSize of [undefined, 2, 5]) {
    const members = Array.from({ length: size }, (_, i) => ({ id: `preview${i}`, name: `Preview ${i}` }));
    const preview = { members }, incoming = { members }, before = JSON.stringify({ preview, incoming });
    const c = { el, advanced: () => false, ...(currentSize ? { state: { members: Array(currentSize).fill({}) } } : {}) };
    createScreenDialogs(c);
    const summary = c.replacementSummary(preview, incoming);
    assert.equal(summary.children.at(-1).text, `After replacing ${size === 1 ? 'the map' : size === 2 ? 'both maps' : 'all maps'}, Undo only goes back as far as this replacement. Earlier changes remain in History and the full backup.`);
    assert.equal(c.replacementSummary(preview, incoming, { memberReplacement: true }).children.at(-1).text,
      'Undo can reverse this player replacement. The previous save is retained under Browse previous saves.');
    assert.equal(JSON.stringify({ preview, incoming }), before);
  }
});
