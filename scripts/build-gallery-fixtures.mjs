// Small synthetic data only. Regenerate after changing a result schema.
import { writeFile } from 'node:fs/promises';
import { createGroupState } from '../app/core/state.mjs';
import { createRuleRegistry } from '../app/core/rules.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { projectDisplayWorld } from '../app/display-world.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { computeRollStats } from '../app/core/roll-stats.mjs';
import { buildActivityInfo } from '../app/tasks/activity.mjs';
import { evaluateEquipment, buildCurrentBiS } from '../app/tasks/equipment.mjs';
import { selectPresentedTasks } from '../app/tasks/presentation.mjs';
import { readFile } from 'node:fs/promises';

const definitions = {
  chunks: { 12341: { Name: 'Lumbridge', Object: { Tree: 3, Furnace: 1 }, Monster: { Goblin: 2 }, NPC: { Guide: 1 }, Connect: { 'Sample cellar': true } },
    12342: { Name: 'Draynor', Object: { Oak: 2 }, Spawn: { Knife: 1 } }, 12343: { Name: 'Varrock', Object: { Anvil: 1 } },
    'Sample cellar': { Name: 'Sample cellar', Object: { Chest: 1 }, Connect: { 12341: true } } },
  walkableChunks: ['12341', '12342', '12343'], walkableChunksF2P: ['12341', '12342', '12343'],
  challenges: { Woodcutting: { Tree: { Level: 1, Object: ['Tree'] }, Oak: { Level: 15, Object: ['Oak'] } },
    Quest: { 'Cook’s Assistant': { Chunks: ['12341'], Description: 'Help the cook prepare a cake.' } } },
  equipment: {}, sections: {}, shops: {}, drops: {}, spawns: {}, quests: {},
};
const registry = createRuleRegistry();
const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: ['12341'], selected: ['12342', '12343'], preferences: { hideChecked: false, advanced: true, unpick: true, rollWarning: true, newTasks: true }, notes: { 12341: 'Bring a hatchet and food.' }, journal: 'Next trip: visit the furnace.' },
  { id: 'player2', name: 'Player 2', unlocked: ['12342'], selected: ['12343'], journal: 'Gather ore for our next goal.' }], registry);
state.revision = 7;
const tasks = ['available', 'checked', 'blocked', 'claimed', 'pinned', 'backlog'].map((status, i) => ({ id: `custom:gallery-${status}`, label: ['Cut a tree', 'Help the cook', 'Smith an iron bar', 'Gather oak logs', 'Reach Woodcutting 15', 'Collect supplies for later'][i], category: i === 1 ? 'Quest' : i === 2 ? 'Smithing' : 'Woodcutting', level: i ? 15 : 1, status: status === 'blocked' ? 'blocked' : 'available', blockers: status === 'blocked' ? [{ detail: 'Needs a reachable iron ore source.' }] : [], record: { Description: 'A built-in gallery example.', Chunks: ['12341'] }, sources: [], explanation: 'This example uses fixture data.', wiki: 'https://runescape.wiki/w/Tree' }));
state.tasks = tasks.map(({ id, label, category, level }) => ({ id, label, category, level }));
state.members[0].taskStatus = { [tasks[1].id]: { challengeCompleted: true }, [tasks[4].id]: { favorite: true }, [tasks[5].id]: { backlogged: true, backlogReason: 'After the next trip' } };
state.members[0].completedTasks = [tasks[1].id];
state.taskClaims = { [tasks[3].id]: { memberId: 'player2', claimedAt: '2026-10-13T12:00:00.000Z', expiresAt: '2099-10-13T12:00:00.000Z' } };
state.history = [{ revision: 6, at: '2026-10-12T12:00:00.000Z', type: 'command', command: { type: 'unlock-selection', memberId: 'player1', chunkId: '12341' }, actor: { kind: 'master', label: 'Player 1' } },
  { revision: 7, at: '2026-10-13T12:00:00.000Z', type: 'command', command: { type: 'set-task-status', memberId: 'player1', taskId: tasks[1].id, challengeCompleted: true }, actor: { kind: 'master', label: 'Player 1' } }];
state.groupGoals = [{ id: 'gallery-goal', text: 'Prepare our next trip', completed: false, createdAt: '2026-10-13T12:00:00.000Z', steps: [] }];
const engine = createTaskEngine(definitions, { metadataCorrections: false, equipmentCorrections: false, retainedTaskCorrections: false, retainedUnsupportedCorrections: false, divinationTraining: false, skillGuideTasks: false, skillGuideCorrections: false, skillGuideMilestones: false });
const results = state.members.map(member => {
  const result = engine.evaluate(state, member.id);
  result.memberId = member.id; result.stateRevision = state.revision;
  result.tasks = tasks; result.presentation = selectPresentedTasks(result, state, member.id, definitions);
  result.presentation.tasks = tasks.filter(t => t.id !== tasks[5].id); result.presentation.completedTasks = [tasks[1]];
  const gear = evaluateEquipment(result, state, member.id, definitions);
  result.currentBiS = buildCurrentBiS(result, gear, state, member.id, definitions, result);
  result.activityInfo = buildActivityInfo(result, state, member.id, definitions);
  return result;
});
const data = { state, definitions, rules: registry.definitions.map(({ candidates, exclude, ...value }) => value),
  world: projectDisplayWorld(buildWorld(definitions)), results,
  rollStats: computeRollStats(state, { now: Date.parse('2026-10-13T12:00:00.000Z') }),
  membersBanks: JSON.parse(await readFile(new URL('../app/data/members-start-banks.2026-10-12.v1.json', import.meta.url))),
};
await writeFile(new URL('../app/web/gallery-fixture-data.json', import.meta.url), `${JSON.stringify(data)}\n`);
