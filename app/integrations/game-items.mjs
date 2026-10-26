// Reviewed RS3 item IDs for game plugin evidence. Each row was checked on
// 2026-10-22 (the last four on 2026-10-25) three ways: the wiki infobox ID (revision below), the decoded game
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
  ['00080a', 'Noose wand', '2h weapon', [10150], [10151], 36256305],
  ['0009f0', 'Rune full helm + 3', 'head', [46845], [46846], 36992348],
  ['0009f8', 'Rune hatchet', 'main hand weapon', [1359], [1360], 37020035],
  ['000a6e', 'Rune platebody + 3', 'torso', [46885], [46886], 37058332],
  ['000a80', 'Rune platelegs + 3', 'legs', [46865], [46866], 36992397],
  ['000b61', 'Splitbark helm', 'head', [3385], [3386], 37191937],
  ['000be4', 'Steel kiteshield', 'off-hand', [45465], [1194], 36970590],
  ['000cb2', 'Team-46 cape', 'back', [4405], [4406], 36961340],
  ['00006c', 'Adamant kiteshield', 'off-hand', [45519], [1200], 37179170],
  ['0009f4', 'Rune gauntlets + 3', 'hands', [46938], [46939], 36992351],
  ['0009c5', 'Rune armoured boots + 3', 'feet', [46925], [46926], 36992333],
  ['0000e3', 'Amulet of power', 'neck', [1731], [1732], 36997571],
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
 * Rows from item evidence. Possession matches the source-neutral BiS "Obtain"
 * goal; Wear tasks need worn evidence. Source-specific tasks are never in the
 * table, so they never match. With autoTick, owned goals come back as ticks
 * (all of them) and only the rest go to review.
 * evidence: Map(gameItemId -> { name, ownedAt, wornAt, first }).
 */
export function matchGameItems({ evidence, task, completed, handled = () => false, unmapped = [], world, autoTick = false }) {
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
  const ticks = [], all = [];
  for (const row of rows.values()) (autoTick && row.evidence === 'owned' ? ticks : all).push(row);
  return { ticks, rows: all.slice(0, ITEM_REVIEW_LIMIT), more: Math.max(0, all.length - ITEM_REVIEW_LIMIT),
    unmapped: unmapped.slice(0, UNMAPPED_LIMIT), unmappedMore: Math.max(0, unmapped.length - UNMAPPED_LIMIT) };
}
