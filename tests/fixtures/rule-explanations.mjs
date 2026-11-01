// Public synthetic definitions; no installed catalogue or saved gameplay input.
export function ruleExplanationFixture() {
  const definitions = { chunks: { '12850': { Spawn: { 'Fixture input': 1, 'Fixture product': 1 }, Shop: { 'Fixture shop': true } } },
    sections: {}, walkableChunks: ['12850'], walkableChunksF2P: ['12850'], codeItems: {}, shopItems: { 'Fixture shop': { 'Fixture stock': true } }, challenges: {
      Nonskill: { 'Fixture producer': { Items: ['Fixture input'], Output: 'Fixture supply' } },
      Extra: { 'Fixture source consumer': { Items: ['Fixture supply'], AllowedSources: ['Fixture other producer'] } },
      Crafting: { 'Fixture duplicate recipe': { Level: 1, Primary: true, NoXp: true, Items: ['Fixture input'], Output: 'Fixture product' } },
      Mining: { 'Fixture ranked goal': { Level: 5, Primary: true, Priority: 1 }, 'Fixture peer goal': { Level: 5, Primary: true, Priority: 2 } },
    } };
  const state = { rules: { 'content.f2p': false }, taskRules: { 'Multi Step Processing': false, 'Highest Level': false, 'Wield Crafted Items': false },
    members: [{ id: 'fixture', name: 'Explorer', unlocked: ['12850'], completedTasks: [],
      primaryOverrides: { Crafting: true, Mining: true }, taskAlternatives: { Mining: { '5': 'Fixture missing choice' } } }] };
  return { definitions, state };
}
