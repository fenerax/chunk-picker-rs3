// Public synthetic geography based on chunk-planning.test.mjs and the focused
// worker fixture: sections, named interiors, numeric aliases and source gates.
import { createGroupState } from '../../app/core/state.mjs';
export const definitions = {
  chunks: { '12341': { Object: { Anvil: 1 }, Monster: { Goblin: 1 }, Connect: { 'Puro-Puro': true }, Sections: { '1': { NPC: { Banker: 1 } } } },
    '12342': { Name: 'Dorgesh-Kaan', Object: { Anvil: 1 } }, 'Puro-Puro': { Object: { Portal: 1 } }, 'Dorgesh-Kaan': { Shop: { 'Cave shop': 1 } } },
  walkableChunks: ['12341', '12342'], walkableChunksF2P: ['12341', '12342'],
  clues: { Easy: { '12341-1': true, 'Puro-Puro': false, 'Dorgesh-Kaan': true } },
  codeItems: { chunksPlus: { 'Village[+]': ['12341-1', 'Puro-Puro'] } },
  taskUnlocks: { Objects: { Anvil: { '12341': 'Off-chunk quest', '12342': false } } },
  challenges: { Quest: { 'Off-chunk quest': { Chunks: ['12342'] }, 'Visit the cave': { Chunks: ['Dorgesh-Kaan'], Description: 'A named interior.' },
    'Hidden clue': { Chunks: ['Puro-Puro'], ClueTier: 'Easy' }, 'Goblin task': { Monsters: ['Goblin'] }, 'Village task': { Chunks: ['Village[+]'] } },
    Smithing: { 'Use an anvil': { Objects: ['Anvil'], Level: 10, Description: 'Keep source gates and descriptions.' } },
    Extra: { 'Talk to banker': { NPCs: ['Banker'] }, 'Use portal': { Objects: ['Portal'] } } },
};
export function initialState() {
  const state = createGroupState([{ id: 'explorer-1', name: 'Explorer 1', unlocked: ['12341'] }, { id: 'explorer-2', name: 'Explorer 2', unlocked: ['12342'] }]);
  state.members[1].taskRules = { Quests: false };
  return state;
}
export const locations = ['12341', '12342', 'Puro-Puro', 'Dorgesh-Kaan'];
