import { createTaskEngine } from '../../app/tasks/engine.mjs';
import { buildActivityInfo } from '../../app/tasks/activity.mjs';

// Public synthetic accounts: both masters offer the same reachable assignment.
export function masterGateFixture({ combat = 29, slayer = 10, quest = false } = {}) {
  const questLabel = '~|Example gate|~ Complete the quest';
  const higher = 'Receive an assignment from ~|Higher|~';
  const definitions = {
    chunks: { '10001': { NPC: { Lower: 1, Higher: 1 }, Monster: { Rat: 1 } } },
    challenges: { Slayer: {
      'Receive an assignment from ~|Lower|~': { NPCs: ['Lower'], Level: 1, Skills: { Combat: 3 }, Primary: true },
      [higher]: { NPCs: ['Higher'], Level: 10, Skills: { Combat: 30 }, Primary: true, ...(quest ? { Tasks: { [questLabel]: 'Quest' } } : {}) },
    }, Quest: { [questLabel]: { QuestPoints: 1 } } },
    slayerMasterTasks: { Lower: { Rats: { Weight: 10 } }, Higher: { Rats: { Weight: 10 } } },
    codeItems: { slayerTasks: { Rats: { Rat: true } } },
  };
  const levels = { Attack: 20, Strength: 20, Defence: 20, Constitution: 24 + (combat - 29) * 4, Prayer: 20, Ranged: 20, Magic: 20, Necromancy: 20, Summoning: 20, Slayer: slayer };
  const state = { revision: 7, rules: { 'content.f2p': false }, members: [{ id: 'a', name: 'Player', unlocked: ['10001'], completedTasks: [],
    passiveLevels: { Slayer: 120, Combat: 152 }, skillProgress: Object.fromEntries(Object.entries(levels).map(([skill, level]) => [skill, { level, xp: 0, source: 'game-plugin', memberId: 'a', fetchedAt: '2026-11-01T00:00:00Z' }])) }] };
  const result = createTaskEngine(definitions).evaluate(state, 'a');
  const view = () => buildActivityInfo(result, state, 'a', definitions);
  return { state, definitions, result, view, higher, questLabel };
}
