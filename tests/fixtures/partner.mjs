import { createGroupState } from '../../app/core/state.mjs';
import { buildWorld } from '../../app/data/world.mjs';
import { createTaskEngine } from '../../app/tasks/engine.mjs';

export function duoFixture(connected = true, home = '12850') {
  const data = { chunks: { [home]: { Object: { Bench: true }, Spawn: { 'Own sword': 1 } }, '12851': { Object: { Anvil: true, Ore: true }, Monster: { Imp: true }, Shop: { Wares: true } }, '12852': {} },
    sections: { [home]: { '0': connected ? ['12851'] : [] }, '12851': { '0': connected ? [home] : [] }, '12852': { '0': [] } },
    walkableChunks: [home, '12851', '12852'], walkableChunksF2P: [home, '12851', '12852'],
    challenges: { Smithing: { Train: { Level: 1, Primary: true, Objects: ['Ore'], Output: 'Bar' } }, Extra: {
      Own: { Chunks: [home], Objects: ['Bench'], Skills: { Smithing: 50 }, Items: ['Bar'] }, Partner: { Chunks: ['12851'] },
      PartnerItem: { Items: ['Partner sword'] }, OwnItem: { Items: ['Own sword'] } } }, codeItems: {},
    shopItems: { Wares: { 'Partner sword': true } }, drops: { Imp: { Gem: { '1': 'Always' } } },
    equipment: { 'Own sword': { slot: 'main hand weapon', class: 'melee', tier: 1, ability_damage: 1, accuracy: 10, speed: 4, requirements: {} }, 'Partner sword': { slot: 'main hand weapon', class: 'melee', tier: 50, ability_damage: 50, accuracy: 100, speed: 4, requirements: {} } } };
  const state = createGroupState([{ id: 'player1', name: 'Player 1', unlocked: [home] }, { id: 'player2', name: 'Player 2', unlocked: ['12851'] }]);
  state.members[0].taskRules = { 'Kill X': true, 'Every Drop': true, 'All Shops': true, 'Wield Crafted Items': true };
  const engine = createTaskEngine(data); state.tasks = engine.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  return { data, state, engine, world: buildWorld(data) };
}
