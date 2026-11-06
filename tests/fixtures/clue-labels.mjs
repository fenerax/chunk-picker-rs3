export const clueLabelCases = [
  ['elite', 'Scan', 'Just east of the rocks north-east of Nardah.', 'Elite scan clue spot: Just east of the rocks north-east of Nardah.'],
  ['elite', 'Compass', 'East across the river Elid.', 'Elite compass clue spot: East across the river Elid.'],
  ['hard', 'Coordinates', '01 degrees 02 minutes north', 'Hard coordinates clue step: 01 degrees 02 minutes north'],
  ['hard', 'Emote', 'Bow by the ~|gate|~*', 'Hard emote clue step: Bow by the gate'],
  ['easy', 'Map', 'images/clues/map-easy.png', 'Easy map clue step'],
  ['medium', 'Anagram', 'A synthetic anagram', 'Medium anagram clue step: A synthetic anagram'],
  ['hard', 'Cryptic', 'A synthetic riddle', 'Hard cryptic clue step: A synthetic riddle'],
  ['master', 'Skill riddle', 'Make a synthetic item', 'Master skill riddle clue step: Make a synthetic item'],
  ['easy', 'Simple', 'Search the synthetic crate', 'Easy simple clue step: Search the synthetic crate'],
];

export function clueLabelDefinitions() {
  return {
    chunks: { '1': {}, '2': { Clue: Object.fromEntries(clueLabelCases.map(([tier]) => [tier, 1])) } },
    sections: {}, codeItems: {}, walkableChunksF2P: ['1', '2'],
    challenges: { Nonskill: Object.fromEntries(clueLabelCases.map(([ClueTier, ClueType, rawLabel]) =>
      [rawLabel, { ClueTier, ClueType, Chunks: ['2'] }])) },
  };
}
