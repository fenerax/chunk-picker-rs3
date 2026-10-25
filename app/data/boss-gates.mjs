// Boss unlock gates for the group's one-chunk run. A gated boss counts as
// unreachable for a player until that player's synced levels meet its
// condition and the group can get the tier gear, or the player unlocks it by
// hand from the chunk panel.
//
// First values come from the group's "Boss unlock Conditions" sheet
// (2026-10-25); the group expects to tune them. To change a threshold, edit the
// entry here and ship a release.
//
// Fields:
//   id       stable key; saved "unlock now" choices refer to it, so don't rename
//   boss     name shown to players
//   monsters exact picker monster names covered by the gate
//   tier     "Tier N equipment": Defence N and N in one of `styles`, and the
//            group can get a tier-N weapon, body and legs in one of those
//            styles from everyone's unlocked areas (crafted items count)
//   styles   combat skills that count for the tier (default: any combat style)
//   gear     optional gear tiers when they differ from `tier`, e.g.
//            { weapon: 70, armour: 60 }; false skips the gear check
//   levels   extra skill levels, e.g. { Prayer: 37 }
//   locked   'group' or 'hard-mode': never opens on levels, only by hand
//   notes    shown with the gate; not checked by the picker
export const DEFAULT_TIER_STYLES = Object.freeze(['Attack', 'Ranged', 'Magic', 'Necromancy']);

export const bossGates = [
  { id: 'giant-mole', boss: 'Giant Mole', monsters: ['Giant mole'], tier: 40 },
  { id: 'giant-mole-hm', boss: 'Giant Mole (Hard Mode)', monsters: ['Giant mole (Hard Mode)'], locked: 'hard-mode' },
  { id: 'king-black-dragon', boss: 'King Black Dragon', monsters: ['King Black Dragon'], tier: 40, levels: { Prayer: 37 } },
  { id: 'chaos-elemental', boss: 'Chaos Elemental', monsters: ['Chaos Elemental'], tier: 40 },
  { id: 'kalphite-queen', boss: 'Kalphite Queen', monsters: ['Kalphite Queen'], tier: 50, notes: ['The sheet says "in suitable styles"; any one combat style counts.'] },
  { id: 'flesh-hatcher-mhekarnahz', boss: 'Flesh-hatcher Mhekarnahz', monsters: ['Flesh-hatcher Mhekarnahz'], tier: 50, levels: { Prayer: 40 } },
  { id: 'ivar', boss: 'Ivar, King of Bones', monsters: ['Ivar, King of Bones'], tier: 40 },
  { id: 'silverquill', boss: 'Silverquill, the Dreadhog', monsters: ['Silverquill, the Dreadhog'], tier: 50 },
  { id: 'vorago', boss: 'Vorago', monsters: ['Vorago', 'Vorago (Hard Mode)'], locked: 'group' },
  { id: 'solak', boss: 'Solak', monsters: ['Solak, Guardian of the Grove'], tier: 95 },
  { id: 'barrows-rots', boss: 'Barrows: Rise of the Six', monsters: ['Barrows: Rise of the Six'], tier: 85 },
  { id: 'araxxor', boss: 'Araxxor and Araxxi', monsters: ['Araxxor', 'Araxxi'], tier: 80 },
  { id: 'kalphite-king', boss: 'Kalphite King', monsters: ['Kalphite King', 'Exiled kalphite marauder (Kalphite King)'], locked: 'group' },
  { id: 'queen-black-dragon', boss: 'Queen Black Dragon', monsters: ['Queen Black Dragon'], tier: 60, notes: ['Bring super antifires (not checked).'] },
  { id: 'corporeal-beast', boss: 'Corporeal Beast', monsters: ['Corporeal Beast'], tier: 60, styles: ['Attack'], notes: ['The sheet asks for a tier 60 spear.'] },
  { id: 'the-magister', boss: 'The Magister', monsters: ['The Magister'], tier: 80 },
  { id: 'raksha', boss: 'Raksha, the Shadow Colossus', monsters: ['Raksha, the Shadow Colossus'], tier: 90 },
  { id: 'vorkath', boss: 'Vorkath', monsters: ['Zemouregal & Vorkath', 'Zemouregal & Vorkath (Story Mode)'], tier: 80 },
  { id: 'vorkath-hm', boss: 'Vorkath (Hard Mode)', monsters: ['Zemouregal & Vorkath (Hard Mode)'], locked: 'hard-mode' },
  { id: 'amascut', boss: 'Amascut, the Devourer', monsters: ['Amascut, the Devourer'], locked: 'group' },
  { id: 'nex-angel-of-death', boss: 'Nex, Angel of Death', monsters: ['Nex, Angel of Death'], locked: 'group' },
  { id: 'nex', boss: 'Nex', monsters: ['Nex'], tier: 80, styles: ['Ranged', 'Necromancy'] },
  { id: 'gwd1', boss: 'God Wars Dungeon 1 generals', monsters: ['General Graardor', 'Commander Zilyana', "Kree'arra", "K'ril Tsutsaroth"], tier: 60 },
  { id: 'gwd1-hm', boss: 'God Wars Dungeon 1 generals (Hard Mode)', monsters: ['General Graardor (Hard Mode)', 'Commander Zilyana (Hard Mode)', "Kree'arra (Hard Mode)", "K'ril Tsutsaroth (Hard Mode)"], locked: 'hard-mode' },
  { id: 'telos', boss: 'Telos, the Warden', monsters: ['Telos, the Warden'], tier: 80 },
  { id: 'gwd2', boss: 'God Wars Dungeon 2 generals', monsters: ['Gregorovic', 'Helwyr', 'Twin Furies', 'Vindicta'], tier: 70 },
  { id: 'gwd2-hm', boss: 'God Wars Dungeon 2 generals (Hard Mode)', monsters: ['Gregorovic (Hard Mode)', 'Helwyr (Hard Mode)', 'Twin Furies (Hard Mode)', 'Vindicta (Hard Mode)'], locked: 'hard-mode' },
  { id: 'kerapac', boss: 'Kerapac, the bound', monsters: ['Kerapac, the bound'], tier: 80 },
  { id: 'kerapac-hm', boss: 'Kerapac, the bound (Hard Mode)', monsters: ['Kerapac, the bound (Hard Mode)'], tier: 90 },
  { id: 'arch-glacor', boss: 'Arch-Glacor', monsters: ['Arch-Glacor'], tier: 50 },
  { id: 'arch-glacor-hm', boss: 'Arch-Glacor (Hard Mode)', monsters: ['Arch-Glacor (Hard Mode)'], locked: 'hard-mode' },
  { id: 'croesus', boss: 'Croesus', monsters: ['Croesus'], locked: 'group', notes: ['Only the fight is locked. Croesus skilling tasks in Senntisten stay.'] },
  { id: 'tzkal-zuk', boss: 'TzKal-Zuk', monsters: ['TzKal-Zuk', 'TzekHaar-Hur (TzKal-Zuk)', 'TzekHaar-Kih (TzKal-Zuk)', 'TzekHaar-Mej (TzKal-Zuk)', 'TzekHaar-Mej Disciple (TzKal-Zuk)', 'TzekHaar-Xil (TzKal-Zuk)'], tier: 90 },
  { id: 'tzkal-zuk-hm', boss: 'TzKal-Zuk (Hard Mode)', monsters: ['TzKal-Zuk (Hard Mode)'], locked: 'hard-mode' },
  { id: 'elite-dungeon-1', boss: 'Temple of Aminishi (elite dungeon 1)', monsters: ['Seiryu the Azure Serpent'], tier: 90 },
  { id: 'elite-dungeon-2', boss: 'Dragonkin Laboratory (elite dungeon 2)', monsters: ['Astellarn', 'Verak Lith', 'Black stone dragon'], tier: 90 },
  { id: 'elite-dungeon-3', boss: 'The Shadow Reef (elite dungeon 3)', monsters: ['The Ambassador'], tier: 90 },
  { id: 'zamorak', boss: 'Zamorak, Lord of Chaos', monsters: ['Zamorak, Lord of Chaos'], tier: 90 },
  { id: 'hermod', boss: 'Hermod, the Spirit of War', monsters: ['Hermod, the Spirit of War'], tier: 60, styles: ['Necromancy'] },
  { id: 'rasial', boss: 'Rasial, the First Necromancer', monsters: ['Rasial, the First Necromancer'], tier: 90, styles: ['Necromancy'] },
  { id: 'sanctum-of-rebirth', boss: 'Sanctum of Rebirth', monsters: ['Vermyx, Brood Mother', 'Kezalam, the Wanderer', 'Nakatra, Devourer Eternal'], tier: 80 },
  { id: 'sanctum-of-rebirth-hm', boss: 'Sanctum of Rebirth (Hard Mode)', monsters: ['Vermyx, Brood Mother (Hard Mode)', 'Kezalam, the Wanderer (Hard Mode)', 'Nakatra, Devourer Eternal (Hard Mode)'], tier: 90 },
  { id: 'legiones', boss: 'Legiones', monsters: ['Legiones'], tier: 80, styles: ['Ranged'] },
  { id: 'dagannoth-kings', boss: 'Dagannoth Kings', monsters: ['Dagannoth Prime', 'Dagannoth Rex', 'Dagannoth Supreme'], tier: 60, notes: ['The sheet says "in respective style"; any one combat style counts.'] },
  { id: 'rex-matriarchs', boss: 'Rex Matriarchs', monsters: ['Rathis', 'Pthentraken', 'Orikalka', 'Osseous'], tier: 80, notes: ['The sheet says "in respective style"; any one combat style counts.'] },
  { id: 'raids', boss: 'Liberation of Mazcab raids', monsters: ['Beastmaster Durzag', 'Yakamaru'], locked: 'group' },
  { id: 'tztok-jad', boss: 'TzTok-Jad', monsters: ['TzTok-Jad'], tier: 60, styles: ['Ranged'] },
  { id: 'har-aken', boss: 'Har-Aken', monsters: ['Har-Aken'], tier: 80 },
  { id: 'barrows', boss: 'Barrows', monsters: ['Barrows'], tier: 60 },
];

// Sheet rows that have no gate, kept so a later edit doesn't re-add them by mistake.
export const ungatedSheetRows = Object.freeze([
  { boss: 'Gate of Elidinis', reason: 'The sheet asks for nothing.' },
  { boss: 'Ghrazi Blood Knights', reason: 'Not in the picker data yet (wanted: tier 95).' },
]);
