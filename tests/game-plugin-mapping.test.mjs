import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupState } from '../app/core/state.mjs';
import { createQuestMapping } from '../app/integrations/runemetrics.mjs';
import { validatePluginReport, pluginProposal } from '../app/integrations/game-plugin.mjs';

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
  ]) assert.throws(() => validatePluginReport(report(extra)), undefined, JSON.stringify(extra));
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
  const validated = validatePluginReport(report({ quests: { finished: ['VAMPIRE_SLAYER', 'Ambiguous Quest', 'Missing Quest', 'Step-only quest', 'Vampire Slayer reward', 'Never heard of this'], started: ["Cook’s_Assistant"] } }));
  const { preview, command } = pluginProposal(state, 'actor1', validated, mapping);
  assert.deepEqual(command.quests.map(row => row.title), ['Vampyre Slayer']);
  assert.equal(preview.quests.length, 1);
  assert.deepEqual(preview.startedQuests, ["Cook’s_Assistant"]);
  assert.deepEqual(preview.unmatched.quests.map(row => row.title), ['Ambiguous Quest', 'Missing Quest', 'Step-only quest', 'Vampire Slayer reward', 'Never heard of this']);
  assert.match(preview.unmatched.quests[0].reason, /Several/);
  assert.equal(preview.world, null);
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
