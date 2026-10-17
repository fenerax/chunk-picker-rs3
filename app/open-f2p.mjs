import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { starterCapabilities, starterValues, starterJSON } from './open-starter-data.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => value === undefined ? { $datasetType: 'Undefined' }
  : value instanceof Set ? { $datasetType: 'Set', entries: [...value].map(encode) }
    : value instanceof Map ? { $datasetType: 'Map', entries: [...value].map(([key, row]) => [encode(key), encode(row)]) }
      : Array.isArray(value) ? value.map(encode)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, row]) => [key, encode(row)])) : value;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const row of value instanceof Map || value instanceof Set ? value.values() : Object.values(value)) freeze(row);
    Object.freeze(value);
  }
  return value;
};

/** Wiki facts and authored rules; no filesystem discovery or private fallback. */
export function resolveOpenF2P(options = {}) {
  const payloadPath = 'app/datasets/open-f2p/wiki-derived/dataset.json';
  const payloadBytes = readFileSync(new URL('./datasets/open-f2p/wiki-derived/dataset.json', import.meta.url));
  const batch = JSON.parse(payloadBytes), values = structuredClone(starterValues), json = structuredClone(starterJSON);
  for (const key of Object.keys(json)) if (key.startsWith('app/open-starter-')) delete json[key];
  const put = (module, name, value) => { values[`app/${module}.mjs#${name}`] = value; };
  const skills = ['Mining', 'Woodcutting', 'Fishing'];
  const categories = ['Extra', ...skills, 'Quest', 'Diary'];
  const ruleIds = ['Extra', ...skills, 'Quests', 'Achievement'];
  const defaults = Object.fromEntries(ruleIds.map(id => [id, true]));
  const rules = ruleIds.map(id => ({ id, type: 'boolean', default: true }));
  const text = ruleIds.map(id => ({ id, label: id === 'Extra' ? 'Show shops, banks and manual goals' : id === 'Achievement' ? 'Show area achievements' : id === 'Quests' ? 'Show quest tasks' : `Show ${id.toLowerCase()} tasks`,
    description: id === 'Extra' ? 'Show reviewed services, supply purchases and the goals you write for this journey.'
      : ['Quests', 'Achievement'].includes(id) ? 'Show reviewed free-to-play goals with their locations and requirements.' : `Show reviewed free-to-play ${id.toLowerCase()} sources in your cells.` }));
  put('data/settings', 'taskRuleDefinitions:contract', rules);
  put('data/settings', 'taskRuleDefinitions:presentation', text);
  put('data/settings', 'originalRuleDefaults', defaults);
  put('data/settings', 'originalRulePresets', { 'F2P journey': defaults });
  put('data/settings', 'originalRuleStructure', { Gathering: Object.fromEntries(Object.keys(defaults).map(key => [key, []])) });
  put('web/rules-model', 'actualDefaults', defaults);
  // These are the reviewed task coverage ceilings, not a RuneScape maximum
  // level catalogue. The existing engine uses repeatable sources for training.
  const requiredSkills = [...new Set(batch.tasks.flatMap(row => Object.keys(row.skillRequirements ?? {})))];
  const skillCeilings = Object.fromEntries([...new Set([...skills, ...requiredSkills])].map(skill => [skill,
    Math.max(1, ...batch.sources.filter(row => row.skill === skill).map(row => row.level), ...batch.tasks.map(row => row.skillRequirements?.[skill] ?? 1))]));
  put('tasks/engine', 'skillCaps', skillCeilings);
  put('tasks/engine', 'F2P', new Set(Object.keys(skillCeilings)));
  put('core/player-controls', 'playerControlSkills', skills);
  const minRegionX = Math.min(...batch.cells.map(row => row.regionX)), maxRegionY = Math.max(...batch.cells.map(row => row.regionY));
  const grid = { columns: Math.max(...batch.cells.map(row => row.regionX)) - minRegionX + 1,
    rows: maxRegionY - Math.min(...batch.cells.map(row => row.regionY)) + 1,
    stride: 256, startId: minRegionX * 256 + maxRegionY };
  put('data/surface-grid', 'SURFACE_GRID', grid);
  const chunks = Object.fromEntries(batch.cells.map(row => [row.id, { Nickname: row.name, Object: {}, Shop: {} }]));
  const sections = Object.fromEntries(batch.cells.map(row => [row.id, { '0': [] }]));
  for (const row of batch.connections) { sections[row.from]['0'].push(row.to); sections[row.to]['0'].push(row.from); }
  for (const row of Object.values(sections)) row['0'].sort();
  for (const row of batch.sources) chunks[row.cell].Object[row.name] = true;
  for (const row of batch.shops ?? []) chunks[row.cell].Shop[row.name] = true;
  for (const row of batch.services ?? []) chunks[row.cell].Object[row.name] = true;
  for (const row of batch.harvests ?? []) chunks[row.cell].Object[row.name] = true;
  for (const row of batch.dialogueSupplies ?? []) (chunks[row.cell].NPC ??= {})[row.name] = true;
  for (const row of batch.facilities ?? []) {
    if (row.kind === 'tanner') (chunks[row.cell].NPC ??= {})[row.name] = true;
    else chunks[row.cell].Object[row.name] = true;
  }
  // Each reviewed encounter keeps its variant and cell as its source name.
  // A reachable drop is a supply option, not evidence of a kill or inventory.
  const monsterNames = new Map((batch.monsters ?? []).map(row => [row.id, `${row.name} (${row.variant}; ${row.cell})`]));
  for (const row of batch.monsters ?? []) (chunks[row.cell].Monster ??= {})[monsterNames.get(row.id)] = true;
  const shopItems = Object.fromEntries((batch.shops ?? []).map(row => [row.name, {}]));
  const shopNames = new Map((batch.shops ?? []).map(row => [row.id, row.name]));
  for (const row of batch.stock ?? []) {
    if (!(row.stock > 0)) throw new Error('Only positively reviewed stock can supply an item.');
    const stock = shopItems[shopNames.get(row.shopId)];
    stock[row.item] = Math.max(stock[row.item] ?? 0, row.stock);
  }
  const challenges = Object.fromEntries(categories.map(skill => [skill, {}]));
  const gatheringById = new Map(batch.sources.map(row => [row.id, row]));
  const acquisitionsById = new Map((batch.acquisitions ?? []).map(row => [row.id, row]));
  const stockById = new Map((batch.stock ?? []).map(row => [row.id, row]));
  const dropsById = new Map((batch.drops ?? []).map(row => [row.id, row]));
  for (const row of batch.tasks) challenges[row.skill][row.label] = { PickerId: row.id, Chunks: row.requiredCells ?? [row.cell],
    ...(skills.includes(row.skill) ? { Level: row.level, Primary: true } : {}),
    Description: row.reason.replace('A reviewed shop in your unlocked cells must supply each tool and bait.',
      'A reviewed shop, drop or recipe in your unlocked cells must supply each tool and bait.'),
    ...(row.skillRequirements && Object.keys(row.skillRequirements).length ? { Skills: row.skillRequirements } : {}),
    ...(row.prerequisiteTasks?.length ? { CompletedTasks: row.prerequisiteTasks } : {}),
    ...(row.manualChecks?.length ? { ManualChecks: row.manualChecks } : {}),
    ...(row.questPointsNeeded !== undefined ? { QuestPointsNeeded: row.questPointsNeeded } : {}),
    ...(row.questPoints !== undefined ? { QuestPoints: row.questPoints, BaseQuest: row.baseQuest } : {}),
    ...(row.supplyItems?.length ? { Items: row.supplyItems } : {}),
    ...(row.output?.length ? { Output: row.output } : gatheringById.has(row.sourceId) ? { Output: [gatheringById.get(row.sourceId).output] } : {}),
    ...(row.objectRequirements?.length ? { Objects: row.objectRequirements } : {}),
    ...(row.npcRequirements?.length ? { NPCs: row.npcRequirements } : {}),
    ...(row.dialogueSupply ? { DialogueSupply: row.dialogueSupply } : {}),
    ...(row.finiteRewards?.length ? { FiniteRewards: row.finiteRewards } : {}),
    ...(row.monsterRequirements?.length ? { Monsters: row.monsterRequirements.map(id => monsterNames.get(id) ?? id) } : {}),
    ...(row.sourceId?.startsWith('rs3:open-f2p:stock:') ? { Shops: [shopNames.get(batch.stock.find(stock => stock.id === row.sourceId)?.shopId)] } : {}) };
  for (const row of batch.tasks) {
    const acquisition = acquisitionsById.get(row.sourceId);
    const source = acquisition && (stockById.get(acquisition.sourceId) ?? dropsById.get(acquisition.sourceId));
    if (source?.shopId) challenges[row.skill][row.label].Shops = [shopNames.get(source.shopId)];
    if (source?.monsterId) challenges[row.skill][row.label].Monsters = [monsterNames.get(source.monsterId)];
  }
  const equipment = Object.fromEntries((batch.equipment ?? []).map(row => [row.item, {
    slot: row.slot, class: row.class, tier: row.tier, armour: row.armour, prayer: row.prayer,
    ability_damage: row.ability_damage, accuracy: row.accuracy, requirements: row.requirements, members: false,
  }]));
  const monsters = Object.fromEntries((batch.monsters ?? []).map(row => [monsterNames.get(row.id), {}]));
  const drops = Object.fromEntries([...monsterNames.values()].map(name => [name, {}]));
  for (const row of batch.drops ?? []) {
    const table = drops[monsterNames.get(row.monsterId)];
    (table[row.item] ??= {})[row.quantity] = row.rate;
  }
  const definitions = { chunks, sections, challenges, walkableChunks: batch.cells.map(row => row.id), walkableChunksF2P: batch.cells.map(row => row.id),
    codeItems: { itemsPlus: { 'Pickaxe[+]': ['Bronze pickaxe'], 'Hatchet[+]': ['Bronze hatchet'] } }, equipment, monsters, drops, shopItems, objectItems: {}, npcItems: {} };
  const taskMap = Object.fromEntries(batch.tasks.map(row => [row.label, row.id]));
  const manual = { id: 'custom:open-f2p:journal', label: 'Keep a journey note', category: 'Extra' };
  put('data/identity-registry', 'authoredTasks', batch.tasks.map(row => [row.id, row.skill, row.label]));
  put('data/identity-registry', 'authoredGoals', [[manual.id, 'manual', manual.label, [], 'Extra']]);
  const prefix = 'app/datasets/open-f2p/';
  json[payloadPath] = batch;
  json[`${prefix}definitions.json`] = definitions;
  json[`${prefix}task-map.json`] = taskMap;
  json[`${prefix}provenance.json`] = { schemaVersion: 1, wikiDerived: payloadPath, licence: batch.licence,
    authored: 'Rules, task templates, identities, arithmetic, manual goal and empty compatibility catalogues are project-authored. Wiki facts and their adaptations stay in wiki-derived under its NOTICE.',
    rows: [{ kind: 'manual-goal', id: manual.id, origin: 'project-authored' }, ...rules.map(row => ({ kind: 'rule', id: row.id, origin: 'project-authored' }))] };
  json['app/data/original-rules-ui.2026-10-08.v1.json'] = { schemaVersion: 1,
    sections: [{ id: 'f2p', name: 'F2P journey', rows: text.map(row => ({ key: row.id, label: row.label, descriptionText: row.description, parentKey: null, depth: 0, control: 'checkbox' })) }],
    rules: rules.map(row => ({ key: row.id, default: true, hasDeclaredDefault: true, control: 'checkbox', parentKey: null, depth: 0 })),
    presets: [{ name: 'F2P journey', values: defaults, effectiveValues: defaults }], inputs: { numeric: [] },
    cascade: { enableAllChildrenParents: [], enableDefaults: {} }, selectAll: [] };
  const buffers = new Map(Object.entries(json).map(([key, row]) => [key, Buffer.from(JSON.stringify(row) + '\n')]));
  json['app/data/original-data.2026-10-13.v1.json'] = { schemaVersion: 1, version: `open-f2p-${batch.version}`,
    definitions: { path: `${prefix}definitions.json`, sha256: sha(buffers.get(`${prefix}definitions.json`)) },
    taskMap: { path: `${prefix}task-map.json`, sha256: sha(buffers.get(`${prefix}task-map.json`)) } };
  buffers.set('app/data/original-data.2026-10-13.v1.json', Buffer.from(JSON.stringify(json['app/data/original-data.2026-10-13.v1.json']) + '\n'));
  const contract = { datasetId: 'open-f2p', datasetContractVersion: 1, identityNamespace: 'rs3:open-f2p', coordinateSystem: 'wiki-surface-regions-v1', corePackApi: 1 };
  const gameDefaults = freeze({ title: 'F2P journey', masterLabel: 'Administrator', startingCell: '12850',
    members: [{ id: 'explorer-1', name: 'Explorer 1' }, { id: 'explorer-2', name: 'Explorer 2' }], tasks: [manual] });
  const files = freeze([...buffers].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes), kind: 'input' })).concat(
    ['open-f2p.mjs', 'open-starter-data.mjs'].map(name => { const bytes = readFileSync(new URL(name, import.meta.url)); return { path: `app/${name}`, bytes: bytes.length, sha256: sha(bytes), kind: 'evidence' }; }),
    [{ path: payloadPath, bytes: payloadBytes.length, sha256: sha(payloadBytes), kind: 'evidence' }]));
  const ruleContractHash = sha(JSON.stringify(encode(Object.fromEntries(Object.entries(values).filter(([key]) => /ruleContract|:contract|actualDefaults|originalRuleDefaults|originalRulePresets/.test(key))))));
  const digest = sha(JSON.stringify({ contract, values: encode(values), files, ruleContractHash, gameDefaults }));
  if (options.digest !== undefined && options.digest !== digest) throw Object.assign(new Error('The bundled F2P dataset changed. Restart the game.'), { code: 'DATASET_PACK_INVALID' });
  freeze(json); freeze(values);
  const coverage = freeze(structuredClone(batch.coverage));
  const status = () => ({ id: 'open-f2p', datasetId: 'open-f2p', kind: 'data', version: batch.version, health: 'healthy', digest, contractVersion: 1,
    identityNamespace: contract.identityNamespace, label: 'Open F2P', displayName: 'Open F2P', title: gameDefaults.title,
    description: 'Reviewed free-to-play gathering, shops, routes, quests, achievements, equipment and drops.', coverage });
  const provider = { ...contract, id: 'open-f2p', contractVersion: 1, digest, ruleContractHash, packed: false,
    ...status(), capabilities: starterCapabilities, gameDefaults, coverage, environment: Object.freeze({ RS3_DATASET: 'open-f2p' }),
    overlayOrder: Object.freeze({ server: [], worker: [], tasks: [], world: [], skillGuides: 'unsupported' }), files, status,
    bytes(key) { if (!buffers.has(key)) throw new Error('F2P catalogue unavailable.'); return Buffer.from(buffers.get(key)); },
    json(key) { if (!Object.hasOwn(json, key)) throw new Error('F2P catalogue unavailable.'); return json[key]; },
    value(key) { if (!Object.hasOwn(values, key)) throw new Error(`F2P value unavailable: ${key}`); return freeze(structuredClone(values[key])); },
    metadataBytes: async () => null,
    sourceFile() { throw new Error('The F2P provider has no legacy builder sources.'); },
    materializeValues: () => encode(values), workerSelection: () => ({ datasetId: 'open-f2p', digest }),
    serialize: () => provider.workerSelection(),
  };
  return Object.freeze(provider);
}
