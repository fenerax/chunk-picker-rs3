// Reviewed RS3 item IDs for game plugin evidence. Each row was checked on
// 2026-10-22 three ways: the wiki infobox ID (revision below), the decoded game
// cache name and slot, and the picker entity for the same name. Names are never
// matched at runtime; an ID absent from this table stays unmapped.
// Row: [picker entity suffix, name, slot, wearable IDs, noted IDs, wiki revision].
const ROWS = [
  ['000dc1', 'Yew shortbow', '2h weapon', [857], [858], 37200969],
  ['000eca', 'Ectoplasmator', 'pocket', [25354], [], 36908579],
  ['000052', 'Adamant dagger', 'main hand weapon', [45495], [1212], 37082383],
  ['000080', 'Adamant off hand dagger', 'off-hand', [45496], [25703], 36299301],
  ['000552', 'Ghost hunter body', 'torso', [32380, 32381, 32382], [], 37073963],
  ['000553', 'Ghost hunter goggles', 'head', [32386, 32387, 32388], [], 37073962],
  ['000554', 'Ghost hunter legs', 'legs', [32383, 32384, 32385], [], 37073964],
  ['000551', 'Ghost hunter backpack', 'back', [32389, 32390, 32391], [], 37202497],
  ['000596', 'Gud raider axe', 'main hand weapon', [34828], [34829], 36644223],
  ['000597', 'Gud raider chainbody', 'torso', [34830], [34831], 36961895],
  ['000598', 'Gud raider shield', 'off-hand', [34832], [34833], 36644225],
  ['0001e5', 'Batwing book', 'off-hand', [25660], [25661], 36993264],
  ['0001ec', 'Batwing wand', 'main hand weapon', [25648], [25649], 36974470],
  ['0001e6', 'Batwing boots', 'feet', [25833], [25834], 36974463],
  ['0001e7', 'Batwing gloves', 'hands', [25829], [25830], 36974464],
  ['000b0d', 'Shade robe bottom', 'legs', [548], [], 37172741],
  ['000b0e', 'Shade robe top', 'torso', [546], [], 37172742],
  ['000c91', 'Team-16 cape', 'back', [4345], [4346], 36961308],
  ['00003c', 'Adamant armoured boots', 'feet', [45520], [4130], 36970609],
  ['00005e', 'Adamant gauntlets', 'hands', [45058], [45059], 36970497],
  ['00002c', 'Acadia longbow', '2h weapon', [63327], [63328], 37198397],
  ['00003d', 'Adamant arrow', 'ammo', [890], [], 37155728],
  ['000654', 'Iron mace', 'main hand weapon', [1420], [1421], 37134916],
  ['000585', 'Green dragonhide boots', 'feet', [41212], [41231], 36974501],
  ['00058b', 'Green dragonhide vambraces', 'hands', [1065], [1066], 37057149],
  ['000b51', 'Spiked gauntlets', 'hands', [23035], [], 36471462],
  ['0002ae', 'Bronze dagger', 'main hand weapon', [1205], [1206], 37131007],
];

// Tasks proved only by wearing one of the listed items. The Gud raider set is
// the wiki's Infobox Set (axe, chainbody, shield); lent copies stay unmapped.
const WORN_TASKS = [['rs3:task:000b41', [34828, 34830, 34832]]];

export const GAME_ITEMS = new Map();
for (const [suffix, name, slot, wearable, noted, revision] of ROWS) {
  const item = Object.freeze({ entityId: `rs3:entity:${suffix}`, goalId: `rs3:goal:equipment:${suffix}`, name, slot, wiki: revision });
  for (const id of wearable) GAME_ITEMS.set(id, { ...item, noted: false });
  for (const id of noted) GAME_ITEMS.set(id, { ...item, noted: true });
}
export const GAME_WORN_TASKS = new Map(WORN_TASKS.map(([taskId, ids]) => [taskId, new Set(ids)]));

export const ITEM_REVIEW_LIMIT = 100;
const UNMAPPED_LIMIT = 30;

/**
 * Review rows from item evidence. Possession proposes the source-neutral BiS
 * "Obtain" goal; Wear tasks need worn evidence. Source-specific tasks are never
 * in the table, so they never match.
 * evidence: Map(gameItemId -> { name, ownedAt, wornAt, first }).
 */
export function matchGameItems({ evidence, task, completed, handled = () => false, unmapped = [], world }) {
  const rows = new Map();
  const propose = (taskId, gameItemId, kind, fact) => {
    const row = task(taskId);
    // Lowest game ID first, so one task shows one stable item.
    if (!row || rows.has(taskId) || completed.has(taskId) || handled(taskId)) return;
    rows.set(taskId, { taskId, label: row.label, gameItemId, gameName: fact.name, evidence: kind,
      seen: kind === 'worn' ? `worn ${fact.wornAt}` : fact.first ? 'owned when first seen; source unknown' : `new since ${fact.ownedAt}`, world });
  };
  for (const [gameItemId, fact] of [...evidence].sort(([a], [b]) => a - b)) {
    const item = GAME_ITEMS.get(gameItemId);
    if (!item) continue;
    if (fact.ownedAt) propose(item.goalId, gameItemId, 'owned', fact);
    if (fact.wornAt) {
      for (const [taskId, ids] of GAME_WORN_TASKS) if (ids.has(gameItemId)) propose(taskId, gameItemId, 'worn', fact);
    }
  }
  const all = [...rows.values()];
  return { rows: all.slice(0, ITEM_REVIEW_LIMIT), more: Math.max(0, all.length - ITEM_REVIEW_LIMIT),
    unmapped: unmapped.slice(0, UNMAPPED_LIMIT), unmappedMore: Math.max(0, unmapped.length - UNMAPPED_LIMIT) };
}
