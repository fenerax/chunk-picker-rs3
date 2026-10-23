import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createQuestMapping } from '../app/integrations/runemetrics.mjs';
import { validatePluginReport, pluginProposal, matchPluginAchievements } from '../app/integrations/game-plugin.mjs';

const sentAt = '2026-10-19T12:00:00Z';
const report = extra => ({ v: 1, seq: 0, sentAt, position: { x: 46, z: 49, floor: 0 }, ...extra });

test('public authored Finish rows map only exact whole quests and retain their explicit identity', () => {
  const id = 'rs3:open-f2p:activity:quest:synthetic-quest';
  const mapping = createQuestMapping({ challenges: { Quest: {
    'Finish Synthetic Quest': { PickerId: id, BaseQuest: 'Synthetic Quest', QuestPoints: 1 },
    'Start Synthetic Quest': { PickerId: 'rs3:open-f2p:activity:quest:step', BaseQuest: 'Synthetic Quest', QuestPoints: 1 },
  } } });
  assert.equal(mapping.get('synthetic quest').length, 1);
  assert.equal(mapping.get('synthetic quest')[0].taskId, id);
});

test('plugin skill names normalize aliases and preserve actual XP without RuneMetrics scaling', () => {
  assert.equal(validatePluginReport(report({ skills: { Runecraft: { level: 3, xp: 174 } } })).skills[0].skill, 'Runecrafting');
  const validated = validatePluginReport(report({ skills: { ATTACK: { level: 17, xp: 3210.5 }, RUNECRAFT: { level: 5, xp: 400 }, HITPOINTS: { level: 10, xp: 1154 }, Archaeology: { level: 120, xp: 200000000 } } }));
  assert.deepEqual(validated.skills, [
    { skill: 'Attack', level: 17, xp: 3210.5 }, { skill: 'Runecrafting', level: 5, xp: 400 },
    { skill: 'Constitution', level: 10, xp: 1154 }, { skill: 'Archaeology', level: 120, xp: 200000000 },
  ]);
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  const proposal = pluginProposal(state, 'actor1', validated, new Map());
  assert.equal(proposal.preview.skills[0].after.xp, 3210.5);
  assert.equal(proposal.command.skills[0].xp, 3210.5);
  assert.equal(proposal.command.type, 'apply-game-progress');
  assert.equal(proposal.command.memberId, 'actor1');
  assert.equal(Object.hasOwn(proposal.command, 'runescapeName'), false);
});

test('plugin reports enforce the small versioned schema and reject ambiguous or malformed observations', () => {
  for (const extra of [
    { v: 2 }, { seq: -1 }, { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 1 },
    { sentAt: '2026-02-30T12:00:00Z' }, { sentAt: '2026-10-19T12:00:00+00:00' },
    { position: { x: 200, z: 0, floor: 0 } }, { position: { x: 0, z: -1, floor: 0 } },
    { position: { x: 1.5, z: 0, floor: 0 } }, { position: { x: 0, z: 0, floor: 4 } },
    { position: { x: 0, z: 0, floor: 0, chunkId: '1' } },
    { world: { id: 0, beta: false } }, { world: { id: 10001, beta: false } }, { world: { id: 1, beta: 'false' } },
    { skills: { ATTACK: { level: 0, xp: 0 } } }, { skills: { ATTACK: { level: 121, xp: 0 } } },
    { skills: { ATTACK: { level: 1, xp: -1 } } }, { skills: { ATTACK: { level: 1, xp: 200000001 } } },
    { skills: { ATTACK: { level: 1, xp: Infinity } } }, { skills: { ATTACK: { level: 1, xp: 0, boosted: 2 } } },
    { skills: { SAILING: { level: 1, xp: 0 } } },
    { skills: { RUNECRAFT: { level: 1, xp: 0 }, Runecrafting: { level: 2, xp: 100 } } },
    { quests: { finished: [], started: [], guessed: [] } }, { quests: { finished: [] } },
    { quests: { finished: [' Quest'], started: [] } }, { quests: { finished: ['Quest\n'], started: [] } },
    { quests: { finished: ['Vampire Slayer'], started: ['Vampyre_Slayer'] } },
    { quests: { finished: Array.from({ length: 501 }, (_, i) => `Quest ${i}`), started: [] } },
    { player: 'another-player' }, { completedTasks: ['anything'] },
    { diagnostics: 'Skills: 29/29' }, { diagnostics: ['two\nlines'] }, { diagnostics: [7] },
    { diagnostics: ['x'.repeat(161)] }, { diagnostics: Array.from({ length: 81 }, () => 'line') },
  ]) assert.throws(() => validatePluginReport(report(extra)), undefined, JSON.stringify(extra));
  assert.deepEqual(validatePluginReport(report({ diagnostics: ['Skills: 29/29', 'x'.repeat(160)] })).diagnostics, ['Skills: 29/29', 'x'.repeat(160)]);
  assert.doesNotThrow(() => validatePluginReport(report({ seq: Number.MAX_SAFE_INTEGER, world: { id: 10000, beta: true }, position: { x: 199, z: 199, floor: 3 } })));
});

test('quest mapping accepts explicit aliases and whole completions while retaining unknown, ambiguous, and step titles for review', () => {
  const mapping = createQuestMapping({ challenges: { Quest: {
    'Vampyre Slayer Complete the quest': { QuestPoints: 3, BaseQuest: 'Vampyre Slayer' },
    'Cook\'s Assistant Complete the quest': { QuestPoints: 1, BaseQuest: "Cook's Assistant" },
    'Quest step': { QuestPoints: 1, BaseQuest: 'Step-only quest' },
  } } });
  mapping.set('ambiguous quest', [{ taskId: 'one', title: 'Ambiguous Quest' }, { taskId: 'two', title: 'Ambiguous Quest' }]);
  mapping.set('missing quest', [{ taskId: 'absent', title: 'Missing Quest' }]);
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  state.tasks = [...mapping.values()].flat().filter(row => row.taskId !== 'absent').map(row => ({ id: row.taskId, label: row.title, category: 'Quest' }));
  const validated = validatePluginReport(report({ quests: { finished: ['VAMPIRE_SLAYER', 'Ambiguous Quest', 'Missing Quest', 'Step-only quest', 'Vampire Slayer reward', 'Never heard of this', "Doric's Task I (miniquest)"], started: ["Cook’s_Assistant"] } }));
  const { preview, command } = pluginProposal(state, 'actor1', validated, mapping);
  assert.deepEqual(command.quests.map(row => row.title), ['Vampyre Slayer']);
  assert.equal(preview.quests.length, 1);
  assert.deepEqual(preview.startedQuests, ["Cook’s_Assistant"]);
  assert.deepEqual(preview.unmatched.quests.map(row => row.title), ['Ambiguous Quest', 'Missing Quest', 'Step-only quest', 'Vampire Slayer reward', 'Never heard of this', "Doric's Task I (miniquest)"]);
  assert.match(preview.unmatched.quests[0].reason, /Several/);
  assert.match(preview.unmatched.quests[5].reason, /^Miniquest/);
  assert.equal(preview.world, null);
});

test('the tutorial quest stays out with a reason and renamed quests match the picker title', () => {
  const mapping = createQuestMapping({ challenges: { Quest: {
    '~|Garden of Tranquility|~ Complete the quest': { QuestPoints: 2, BaseQuest: 'Garden of Tranquility' },
    '~|Once Upon a Time in Gielinor: Finale|~ Complete the subquest': { QuestPoints: 0, BaseQuest: 'Once Upon a Time in Gielinor: Finale' },
  } } });
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  state.tasks = [...mapping.values()].flat().map(row => ({ id: row.taskId, label: row.label, category: 'Quest' }));
  const validated = validatePluginReport(report({ quests: { finished: ['Learning the Ropes', 'Garden of Tranquillity', 'Finale'], started: [] } }));
  const { preview, command } = pluginProposal(state, 'actor1', validated, mapping);
  assert.deepEqual(command.quests.map(row => row.title), ['Garden of Tranquility', 'Once Upon a Time in Gielinor: Finale']);
  assert.deepEqual(preview.unmatched.quests.map(row => row.title), ['Learning the Ropes']);
  assert.match(preview.unmatched.quests[0].reason, /^Tutorial quest\. It runs off the chunk map/);
});

test('position-only and partial progress reports never manufacture missing skill or quest changes', () => {
  const state = createGroupState([{ id: 'actor1', name: 'Player' }]);
  state.members[0].skillProgress = { Attack: { level: 10, xp: 1154, source: 'game-plugin', memberId: 'actor1', fetchedAt: sentAt } };
  const before = structuredClone(state);
  const position = validatePluginReport(report());
  assert.equal(position.skills, undefined);
  assert.equal(position.quests, undefined);
  const noChange = pluginProposal(state, 'actor1', position, new Map());
  assert.deepEqual(noChange.command.skills, []);
  assert.deepEqual(noChange.command.quests, []);
  const same = pluginProposal(state, 'actor1', validatePluginReport(report({ skills: { ATTACK: { level: 10, xp: 1154 } } })), new Map());
  assert.deepEqual(same.preview.skills, []);
  assert.deepEqual(same.command.skills, [{ skill: 'Attack', level: 10, xp: 1154 }]);
  assert.deepEqual(state, before);
});

test('achievement parts accept the exact optional schema and reject malformed or mixed reports', () => {
  const achievements = { snapshot: '0123456789abcdef', part: 1, parts: 2, complete: [[0, 'Explorer’s_Task', -1, -1], [354, 'Second Shrubbery', 3, 0]] };
  assert.deepEqual(validatePluginReport(report({ achievements })).achievements, achievements);
  assert.doesNotThrow(() => validatePluginReport(report({ achievements: { ...achievements, parts: 1, complete: [] } })));
  for (const value of [null, [], {}, { ...achievements, extra: true }, { ...achievements, snapshot: '0123456789ABCDEF' },
    { ...achievements, snapshot: 'abc' }, { ...achievements, part: 0 }, { ...achievements, part: 3 },
    { ...achievements, part: 1.5 }, { ...achievements, parts: 9 }, { ...achievements, parts: 0 },
    { ...achievements, complete: null }, ...[
      [[-1, 'Task', 0, 0]], [[0.5, 'Task', 0, 0]], [[Number.MAX_SAFE_INTEGER + 1, 'Task', 0, 0]],
      [[1, '', 0, 0]], [[1, 'x'.repeat(121), 0, 0]], [[1, 'Task\n', 0, 0]], [[1, 'Task\u0085', 0, 0]],
      [[1, 'Task', -2, 0]], [[1, 'Task', 0, 1.2]], [[1, 'Task', 0]], [[1, 'Task', 0, 0, 0]],
      [[2, 'Task', 0, 0], [1, 'Another', 0, 0]], [[1, 'Task', 0, 0], [1, 'Another', 0, 0]],
    ].map(complete => ({ ...achievements, complete }))]) {
    assert.throws(() => validatePluginReport(report({ achievements: value })), { status: 400 }, JSON.stringify(value));
  }
  for (const extra of [{ skills: {} }, { quests: { finished: [], started: [] } }, { diagnostics: [] }]) {
    assert.throws(() => validatePluginReport(report({ achievements, ...extra })), { status: 400 });
  }
});

test('achievement names use quest normalization and only exact Diary raw-label patterns', () => {
  const state = createGroupState([{ id: 'actor1', name: 'Explorer 1' }]);
  state.tasks = [
    { id: 'unique', category: 'Diary', label: 'Synthetic Achievements Explorer’s Task' },
    { id: 'unclear1', category: 'Diary', label: '~|Synthetic Achievements#Easy|~ Shared Task' },
    { id: 'unclear2', category: 'Diary', label: '~|Other Achievements#Hard|~ Shared Task' },
    { id: 'done', category: 'Diary', label: '~|Synthetic Achievements#Easy|~ Finished Task' },
    { id: 'malformed', category: 'Diary', label: 'Bare Task' },
    { id: 'wrong-category', category: 'Quest', label: '~|Synthetic Achievements#Easy|~ Other Task' },
  ];
  state.identityRegistry = { entries: { unique: { rawLabel: '~|Synthetic Achievements#Easy|~ Explorer’s Task' } } };
  state.members[0].completedTasks = ['done', 'unclear1'];
  const matches = matchPluginAchievements(state, 'actor1', [[1, 'ＥＸＰＬＯＲＥＲＳ_task', 0, 0], [2, 'Shared Task', 0, 0],
    [3, 'Finished Task', 0, 0], [4, 'Unknown Task', 0, 0], [5, 'Bare Task', 0, 0], [6, 'Other Task', 0, 0]]);
  // Punctuation becomes a space, including the possessive apostrophe.
  assert.equal(matches.candidates.length, 0);
  const normalized = matchPluginAchievements(state, 'actor1', [[1, 'ＥＸＰＬＯＲＥＲ_Ｓ—task', 0, 0]]);
  assert.equal(normalized.candidates[0].candidates[0].taskId, 'unique');
  assert.equal(matches.unclear.length, 1);
  assert.deepEqual(matches.unclear[0].candidates.map(row => row.taskId), ['unclear1', 'unclear2']);
  assert.equal(matches.matchedTaskCount, 3);
  assert.equal(matches.unmatchedCount, 4);
  assert.equal(matches.completeCount, 6);
});
