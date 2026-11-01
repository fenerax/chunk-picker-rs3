// Hand-authored model of the acceptance case, not a reference-data excerpt.
export function caveDefinitions({ circular = false } = {}) {
  return {
    walkableChunks: ['12593', '12850'], walkableChunksF2P: ['12593', '12850'],
    chunks: {
      '12593': { Spawn: { Rope: 1, Candle: 1 } },
      '12850': { Spawn: { Candle: 1 }, Object: { 'Training log': 1, Rock: 1, Stall: 1 } },
      'Lumbridge cellar': { Connect: { '12850': true } },
      'Swamp cave': { Connect: { '12593': true, 'Lumbridge cellar': true }, Monster: { 'Cave bug': 1 } },
    },
    challenges: {
      Nonskill: {
        'Swamp entrance': { Chunks: ['12593'], Items: ['Rope'] },
        'Cellar entrance': { Chunks: ['Lumbridge cellar'], Tasks: { 'The Lost Tribe step 2': 'Quest' } },
        'Swamp cave': { UnlocksArea: true, Tasks: { 'Cave access[+]': 'Nonskill' } },
        'Obtain a light source': { Items: ['Light source[+]'] },
      },
      Agility: { 'Balance on the training log': { Level: 1, Primary: true, Objects: ['Training log'], ...(circular ? { Tasks: { 'The Lost Tribe step 2': 'Quest' } } : {}) } },
      Mining: { 'Mine the training rock': { Level: 1, Primary: true, Objects: ['Rock'] } },
      Thieving: { 'Steal from the training stall': { Level: 1, Primary: true, Objects: ['Stall'] } },
      Quest: {
        'The Lost Tribe step 1': { Skills: { Agility: 13, Mining: 17, Thieving: 13 } },
        'The Lost Tribe step 2': { Tasks: { 'The Lost Tribe step 1': 'Quest' } },
      },
      Extra: { 'Defeat a cave bug': { Monsters: ['Cave bug'], Tasks: { 'Obtain a light source': 'Nonskill' } } },
    },
    taskUnlocks: { Monsters: { 'Cave bug': { 'Swamp cave': { 'Obtain a light source': 'Nonskill' } } } },
    codeItems: { tasksPlus: { 'Cave access[+]': ['Cellar entrance', 'Swamp entrance'] }, itemsPlus: { 'Light source[+]': ['Candle', 'Lantern'] } },
  };
}
export function caveState(unlocked = ['12593']) { return { revision: 7, rules: { 'content.f2p': false, 'access.shared': false }, taskRules: {}, members: [{ id: 'one', unlocked, completedTasks: [] }] }; }
