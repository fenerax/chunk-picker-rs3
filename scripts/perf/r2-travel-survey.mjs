// Public-source inventory only. This does not evaluate eligibility or read saves.
// Run from any directory: node scripts/perf/r2-travel-survey.mjs
import { readFileSync } from 'node:fs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 20) throw Error('Node 24.20+ required.');
if (process.env.RS3_PACKS_DIR || process.env.RS3_GAME_DEFAULTS_FILE) throw Error('Run this public survey without private dataset overrides.');
const { selectedDataset } = await import('../../app/dataset-runtime.mjs');
if (selectedDataset.packed || selectedDataset.datasetId !== 'duo-legacy') throw Error('This inventory requires the tracked legacy dataset.');
const { prepareTaskDefinitions } = await import('../../app/dataset-pipeline.mjs');
const read = file => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const raw = read('rs3-chunkpicker-chunkinfo-export.json');
const definitions = prepareTaskDefinitions(raw, selectedDataset);
const transport = read('app/data/transport-routes.2026-10-09.v2.json');
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const rowsOf = data => Object.entries(data.challenges).flatMap(([category, rows]) =>
  Object.entries(rows).map(([label, record]) => ({ category, label, record })));
const rows = rowsOf(definitions);
function travelKind({ category, label, record }) {
  if (category === 'Extra' && array(record.Category).includes('Permanent Unlockables')
    && /teleport|transport|balloon|portal/i.test(label) && !array(record.Category).includes('Cosmetics')) return 'permanent unlock';
  if (category === 'Construction' && label.startsWith('Unlock the ~|house portal')) return 'house location';
  if (label.startsWith('Activate the ~|Orthen teleportation device')) return 'device activation';
  if (category === 'Firemaking' && label.startsWith('Use the ~|Balloon transport system')) return 'balloon flight';
  if (/^(Grow|Construct) a ~\|spirit tree/.test(label)) return 'spirit tree';
  if (category === 'Construction' && label.startsWith('Construct a ~|fairy ring')) return 'fairy ring';
  if (category === 'Construction' && label.includes('lodestone')
    || category === 'Diary' && label.startsWith('~|Exploration achievements#Lodestones|~') && !label.includes('Complete the')) return 'lodestone';
  if (category === 'Construction' && label.startsWith('Construct') && /portal|teleport stone/.test(label)) return 'transport furniture';
  if (category === 'Nonskill' && label === 'Gnome glider hangar') return 'glider area helper';
}
const travel = rows.flatMap(row => {
  const kind = travelKind(row);
  return kind ? [{ ...row, kind }] : [];
});
const byKind = Object.fromEntries([...new Set(travel.map(row => row.kind))].sort().map(kind => {
  const group = travel.filter(row => row.kind === kind);
  return [kind, { rows: group.length, withChunks: group.filter(row => array(row.record.Chunks).length).length }];
}));
// Chunks may identify a section, not a top-level chunk record.
const mapped = id => {
  const section = /^(.*)-(\d+)$/.exec(id);
  return Object.hasOwn(definitions.chunks, id)
    || Boolean(section && Object.hasOwn(definitions.sections[section[1]] ?? {}, section[2]));
};
const noChunks = travel.filter(row => !array(row.record.Chunks).length);
const planRows = rows.filter(row => row.category === 'Extra' && row.label.startsWith('(Furniture Plans)'));
const builds = rows.filter(row => row.category === 'Construction');
const matchesPlan = (plan, build) => array(plan.record.Items).some(item => array(build.record.Items).includes(item));
const planSources = rows.filter(row => row.category !== 'Construction'
  && array(row.record.Output).some(item => /^Furniture plans:/i.test(item)));
const planShopEntries = Object.entries(definitions.shopItems).flatMap(([shop, entries]) =>
  Object.keys(entries).filter(item => /^Furniture plans:/i.test(item)).map(item => ({ shop, item })));
const cannon = rows.filter(row => row.category === 'Extra' && /dwarf multicannon|royale cannon/.test(row.label));
const countKinds = values => Object.fromEntries([...new Set(values)].sort().map(kind => [kind, values.filter(value => value === kind).length]));
console.log(JSON.stringify({
  scope: 'tracked public legacy definitions, with current preparation and reviewed overlays; row counts, not unique activities',
  rawRows: rowsOf(raw).length, preparedRows: rows.length,
  travel: { total: travel.length, byKind,
    chunksNotInMap: travel.filter(row => array(row.record.Chunks).length && !array(row.record.Chunks).some(mapped)).length,
    noExplicitChunks: noChunks.length,
    noExplicitChunksExamples: noChunks.filter(row => !['transport furniture', 'spirit tree', 'fairy ring'].includes(row.kind))
      .map(({ category, label }) => ({ category, label })),
    permanentByKind: countKinds(travel.filter(row => row.kind === 'permanent unlock').map(({ label }) =>
      /balloon/.test(label) ? 'balloon' : /Orthen/.test(label) ? 'device' : /Max Guild/.test(label) ? 'attunement' : 'other')),
  },
  relatedExcluded: {
    teleportSpellCasts: rows.filter(row => row.category === 'Magic' && row.label.startsWith('Cast') && /teleport/i.test(row.label) && !row.label.includes('Teleport Block')).length,
    canoeBuilds: rows.filter(row => row.category === 'Woodcutting' && row.label.includes('~|canoe|~')).length,
    portalResearch: rows.filter(row => row.category === 'Archaeology' && row.label.includes('~|Incomplete Portal Network')).length,
    lodestoneAggregate: rows.filter(row => row.category === 'Diary' && row.label.startsWith('~|Exploration achievements#Lodestones|~') && row.label.includes('Complete the')).length,
    cosmeticTeleport: rows.filter(row => row.category === 'Extra' && /teleport/i.test(row.label) && array(row.record.Category).includes('Cosmetics')).length,
  },
  furniture: { collectionRows: planRows.length,
    collectionRowsWithBuildMatch: planRows.filter(plan => builds.some(build => matchesPlan(plan, build))).length,
    constructionUnlockRows: builds.filter(row => row.label.startsWith('Unlock the ~|Furniture plans:')).length,
    outputSourceRows: planSources.length,
    shopEntries: planShopEntries.length, shops: new Set(planShopEntries.map(row => row.shop)).size,
    shopPlansWithCollectionRow: planShopEntries.filter(({ item }) => planRows.some(row => array(row.record.Items).includes(item))).length,
  },
  cannon: { upgradeRows: cannon.length,
    setupRows: rows.filter(row => row.category === 'Ranged' && row.label === 'Setup a ~|dwarf multicannon|~').length,
    basePartShopEntries: Object.values(definitions.shopItems).flatMap(Object.keys)
      .filter(item => ['Cannon stand', 'Cannon base', 'Cannon furnace', 'Cannon barrels'].includes(item)).length,
  },
  transport: { stations: transport.stations.length, routes: transport.routes.length,
    byKind: countKinds(transport.routes.map(row => row.kind)) },
}, null, 2));
