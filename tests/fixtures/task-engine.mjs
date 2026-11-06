// Public invented duo: own/partner supplies, processing, cyclic obligations,
// named interiors, locked cells, personal completion and backlog evidence.
export function engineFixture() {
  const definitions = {
    chunks: { 12850: { Object: { Bench: true }, Spawn: { 'Copper ore': 1 }, Connect: { 'Fixture cave': true } },
      12851: { Object: { Furnace: true }, Spawn: { 'Tin ore': 1 }, Monster: { 'Fixture imp': true }, Shop: { Wares: true } },
      12852: { Object: { Anvil: true }, Connect: { 'Locked cave': true } },
      'Fixture cave': { Spawn: { Key: 1 } }, 'Locked cave': { Spawn: { Token: 1 } } },
    sections: { 12850: { 0: ['12851'] }, 12851: { 0: ['12850', '12852'] }, 12852: { 0: ['12851'] } },
    walkableChunks: ['12850', '12851', '12852'], walkableChunksF2P: ['12850', '12851', '12852'],
    shopItems: { Wares: { Hammer: true } }, drops: { 'Fixture imp': { Gem: { 1: '1/4' } } },
    codeItems: { tools: { Hammer: true }, itemsPlus: { 'Ore[+]': ['Copper ore', 'Tin ore'] } },
    challenges: {
      Mining: { Gather: { Chunks: ['12850'], Primary: true, Level: 1 } },
      Smithing: { Smelt: { Chunks: ['12851'], Objects: ['Furnace'], Items: ['Ore[+]x2'], Output: 'Bar', Primary: true, Level: 1 },
        Forge: { Chunks: ['12852'], Objects: ['Anvil'], Items: ['Bar', 'Hammer'], Output: 'Sword', Level: 2 } },
      Nonskill: { Refine: { Items: ['Gem'], Output: 'Dust', NoXp: true }, 'Fixture cave': { UnlocksArea: true, Chunks: ['12850'], Items: ['Hammer'] },
        'Locked cave': { UnlocksArea: true, Chunks: ['12852'], Items: ['Key'] } },
      Quest: { Collect: { Chunks: ['Fixture cave'], Items: ['Key'], BaseQuest: 'Fixture quest' },
        Finish: { Chunks: ['12850'], Tasks: { Collect: 'Quest' }, BaseQuest: 'Fixture quest', QuestPoints: 1, Reward: ['Medal'] } },
      Extra: { Own: { Chunks: ['12850'], Items: ['Bar'] }, Partner: { Chunks: ['12851'], Items: ['Gem'] },
        Locked: { Chunks: ['12852'], Items: ['Sword'] }, Cave: { Chunks: ['Locked cave'], Items: ['Token'] },
        CycleA: { Tasks: { CycleB: 'Extra' } }, CycleB: { Tasks: { CycleA: 'Extra' }, Items: ['Medal'] },
        Dust: { Chunks: ['12850'], Items: ['Dust'] }, Backlog: { Items: ['Hammer'] }, Unsupported: { Mystery: true }, Manual: { ManualChecks: ['Verify in game.'] } } },
    equipment: { Sword: { slot: 'main hand weapon', class: 'melee', tier: 2, requirements: {} } },
  };
  return definitions;
}
export function fixtureStates() {
  const cases = [];
  for (const shared of [false, true]) for (const withAreas of [false, true]) for (const stage of [0, 1, 2]) {
    const state = { revision: stage, rules: { 'content.f2p': false, 'access.shared': shared, 'tasks.completion': stage === 2 ? 'all' : 'any' },
      taskRules: { 'Multi Step Processing': true }, members: [
        { id: 'm0', name: 'First', unlocked: ['12850', ...(stage === 2 ? ['12852'] : [])], completedTasks: stage ? ['rs3:Quest:Collect'] : [],
          taskStatus: { 'rs3:Extra:Backlog': { backlogged: true }, 'rs3:Extra:Own': { challengeCompleted: true } } },
        { id: 'm1', name: 'Second', unlocked: stage ? ['12851'] : [], completedTasks: [], taskStatus: {} },
      ] };
    if (withAreas) for (const [index, member] of state.members.entries()) member.areaOverrides = { 'Fixture cave': index === 0, 'Locked cave': stage === 2 };
    cases.push({ name: `${shared}/${withAreas}/${stage}`, state });
  }
  return cases;
}
