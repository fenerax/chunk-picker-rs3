/** Private diagnostic only. Never import this script from dataset generation or providers. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = {
  wiki: 'app/datasets/open-f2p/wiki-derived/dataset.json',
  resources: 'app/data/cache-resources.2026-10-08.v1.json',
  walkability: 'app/data/cache-walkability.2026-10-07.v1.json',
};
const loaded = await Promise.all(Object.entries(inputs).map(async ([key, inputPath]) => {
  const bytes = await readFile(path.join(root, inputPath));
  return [key, { inputPath, sha256: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes) }];
}));
const evidence = Object.fromEntries(loaded);
const wiki = evidence.wiki.data;
const resources = evidence.resources.data;
const walkability = evidence.walkability.data;
if (!wiki.cells.length) throw new Error('Wiki dataset has no cells');
const crop = {
  minRegionX: Math.min(...wiki.cells.map(c => c.regionX)),
  maxRegionX: Math.max(...wiki.cells.map(c => c.regionX)),
  minRegionY: Math.min(...wiki.cells.map(c => c.regionY)),
  maxRegionY: Math.max(...wiki.cells.map(c => c.regionY)),
};
const inCrop = id => {
  const n = Number(id), x = Math.floor(n / 256), y = n % 256;
  return x >= crop.minRegionX && x <= crop.maxRegionX && y >= crop.minRegionY && y <= crop.maxRegionY;
};
const sorted = items => [...items].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));
const difference = (a, b) => sorted([...a].filter(key => !b.has(key)));
const intersection = (a, b) => sorted([...a].filter(key => b.has(key)));
const wikiCells = new Set(wiki.cells.map(c => String(c.id)));
const coverage = rows => {
  const decoded = new Set(rows.filter(r => r[1] === 'decoded' && inCrop(r[0])).map(r => String(r[0])));
  return {
    matchedCells: intersection(wikiCells, decoded),
    wikiCellsWithoutDecodedCache: difference(wikiCells, decoded),
    decodedCacheCellsOutsideWikiSelection: difference(decoded, wikiCells),
    decodedCacheCellsInCrop: decoded.size,
  };
};
const classFor = source => source.skill === 'Mining' ? `ore:${source.slug}`
  : source.skill === 'Woodcutting' ? `tree:${source.slug}` : null;
const comparableClasses = new Set(wiki.sources.map(classFor).filter(Boolean));
const wikiGroups = new Set(wiki.sources.filter(s => classFor(s)).map(s => `${s.cell}|${classFor(s)}`));
const columns = resources.schema.placementColumns;
const col = name => {
  const index = columns.indexOf(name);
  if (index < 0) throw new Error(`Missing placement column ${name}`);
  return index;
};
const xColumn = col('x'), yColumn = col('y'), planeColumn = col('effectivePlane'), typeColumn = col('classKey');
const cacheGroups = new Set();
const allResourceGroups = new Set();
let surfacePlacementRowsInCrop = 0;
for (const row of resources.placements) {
  if (row[planeColumn] !== 0) continue;
  const region = String(Math.floor(row[xColumn] / 64) * 256 + Math.floor(row[yColumn] / 64));
  if (!inCrop(region)) continue;
  surfacePlacementRowsInCrop++;
  const classKey = row[typeColumn];
  if (/^(ore|tree):/.test(classKey)) allResourceGroups.add(`${region}|${classKey}`);
  if (comparableClasses.has(classKey)) cacheGroups.add(`${region}|${classKey}`);
}
const groupComparison = {
  matchedGroups: intersection(wikiGroups, cacheGroups),
  wikiGroupsWithoutCacheMatch: difference(wikiGroups, cacheGroups),
  cacheGroupsWithoutWikiMatch: difference(cacheGroups, wikiGroups),
};
const byClass = sorted(comparableClasses).map(classKey => {
  const select = groups => new Set([...groups].filter(g => g.endsWith(`|${classKey}`)).map(g => g.split('|')[0]));
  const w = select(wikiGroups), c = select(cacheGroups);
  return { classKey, wiki: w.size, cache: c.size, matched: intersection(w, c), wikiOnly: difference(w, c), cacheOnly: difference(c, w) };
});
const result = {
  purpose: 'PRIVATE comparison evidence only; never a generation/provider input or distributable F2P authority.',
  generatedAt: new Date().toISOString(),
  inputs: Object.fromEntries(loaded.map(([key, value]) => [key, { path: value.inputPath, sha256: value.sha256 }])),
  wikiTotals: { version: wiki.version, cells: wiki.cells.length, sources: wiki.sources.length,
    connections: wiki.connections.length, tasks: wiki.tasks.length, shops: wiki.shops?.length ?? 0,
    stock: wiki.stock?.length ?? 0, banks: wiki.services?.filter(row => row.kind === 'bank').length ?? 0,
    depositBoxes: wiki.services?.filter(row => row.kind === 'deposit-box').length ?? 0, routes: wiki.routes?.length ?? 0,
    quests: wiki.quests?.length ?? 0, achievements: wiki.achievements?.length ?? 0,
    equipment: wiki.equipment?.length ?? 0, acquisitions: wiki.acquisitions?.length ?? 0,
    equipmentTasks: wiki.tasks.filter(row => row.itemId || row.id.includes(':activity:obtain')).length },
  crop,
  cellComparison: { resources: coverage(resources.coverage), walkability: coverage(walkability.regions) },
  groupComparison,
  byClass,
  surfacePlacementRowsInCrop,
  uncomparableWikiGroups: sorted(wiki.sources.filter(s => !classFor(s)).map(s => `${s.cell}|wiki:${s.slug}`)),
  cacheGroupsOutsideComparableClasses: sorted([...allResourceGroups].filter(g => !comparableClasses.has(g.split('|')[1]))),
  limitations: [
    'All distributable dataset rows remain wholly Wiki-sourced; cache-derived catalogues are permitted here only as private comparison evidence.',
    'The crop is the inclusive region-coordinate bounding rectangle of the Wiki-selected cells. Cache-only cells and groups can be outside this selected irregular subset and are not automatically omissions.',
    'Resource grouping uses raw surface coordinates and classKey only, recomputing numeric region IDs. It does not read retained picker names, definition names, selectors, tasks, saved games, or the original export.',
    'Only ore and tree classes corresponding to Wiki-selected resource types are directly comparable. Fish outputs lack a product-specific cache class; static fishing scenery is not equivalent to a fishing-output source.',
    'The independent dead-tree slug has no equivalent reviewed cache class: the diagnostic catalogue labels dead trees tree:unknown:dead-tree. Those Wiki-only results describe a classification gap, not missing trees. Unknown cache classes are not promoted to verified log sources.',
    'Shops, positive stock rows, banks, deposit boxes, paid routes and generated activities have no equivalent service, stock, fare or task records in these resource and decoded-walkability catalogues. Their totals describe the Wiki dataset only; this diagnostic cannot validate their facts or availability.',
    'Quests, quest prerequisites, seasonal gates and area achievements have no equivalent rows in these two comparison catalogues. Their totals describe independently reviewed Wiki content; this diagnostic cannot validate them or supply replacements.',
    'Equipment variants, wear/use requirements, shop acquisitions, monster drops and reviewed production recipes have no equivalent rows in these two comparison catalogues. Their totals describe independently reviewed Wiki content only; no private row validates or supplies equipment facts.',
    'Tree/fishing dynamic cache absence and conditional/static classification limits make differences diagnostic, not proof of absence, deletion, membership, or a Wiki mistake.',
    'Cache decoded coverage is not F2P coverage, walkable connected access, or a claim that every tile in a region is reachable.',
    'No placements, counts, cache names or membership assumptions may be copied into generation. Resolve any suspected error by fresh Wiki evidence and rerun the Wiki-only generator.',
    'This comparison does not certify connection edges, travel, entrance topology, exact object counts or live-game state.',
  ],
};
const ids = values => values.length ? values.map(v => `\`${v}\``).join(', ') : 'None';
const sections = [
  '# Private open-f2p comparison — 2026-10-13',
  '',
  result.purpose,
  '',
  `Generated: ${result.generatedAt}. Wiki dataset ${wiki.version}: ${wiki.cells.length} cells, ${wiki.sources.length} gathering source groups, ${wiki.connections.length} walking connections and ${wiki.tasks.length} activities.`,
  '',
  `Wiki service totals: ${result.wikiTotals.shops} shops, ${result.wikiTotals.stock} positive stock rows, ${result.wikiTotals.banks} banks, ${result.wikiTotals.depositBoxes} deposit boxes and ${result.wikiTotals.routes} conditional paid routes. These totals are descriptive; the named private catalogues cannot compare these service families.`,
  '',
  `Wiki task-family totals also include ${result.wikiTotals.quests} quests and ${result.wikiTotals.achievements} reviewed area achievements. No quest or achievement rows are read from private inputs.`,
  '',
  `Wiki equipment totals: ${result.wikiTotals.equipment} exact variants, ${result.wikiTotals.acquisitions} reviewed acquisitions and ${result.wikiTotals.equipmentTasks} equipment activities. These descriptive totals come only from the Wiki dataset; private inputs contain no equivalent equipment, requirement, drop or recipe rows.`,
  '',
  '## Inputs and boundary',
  '',
  ...Object.values(result.inputs).map(v => `- \`${v.path}\` — SHA256 \`${v.sha256}\``),
  '',
  `Inclusive region crop: X ${crop.minRegionX}–${crop.maxRegionX}, Y ${crop.minRegionY}–${crop.maxRegionY}. Comparison uses numeric cells and region/type presence, without copying legacy names or rows.`,
  '',
  '## Numeric cell coverage',
  '',
];
for (const [label, c] of Object.entries(result.cellComparison)) sections.push(
  `### ${label}`, '',
  `Matched selected cells (${c.matchedCells.length}): ${ids(c.matchedCells)}`, '',
  `Selected Wiki cells without decoded cache (${c.wikiCellsWithoutDecodedCache.length}): ${ids(c.wikiCellsWithoutDecodedCache)}`, '',
  `Decoded cache cells in crop outside Wiki selection (${c.decodedCacheCellsOutsideWikiSelection.length}): ${ids(c.decodedCacheCellsOutsideWikiSelection)}`, '',
);
sections.push('## Comparable region/type groups', '',
  `Class-key comparison covers ${wikiGroups.size} Wiki groups and ${cacheGroups.size} cache groups across ${comparableClasses.size} selected type classes. Cache surface placement rows in crop: ${surfacePlacementRowsInCrop}.`, '',
  '| Type | Wiki groups | Cache groups | Matched cells | Wiki-only cells | Cache-only cells |',
  '| --- | ---: | ---: | --- | --- | --- |',
  ...byClass.map(c => `| ${c.classKey} | ${c.wiki} | ${c.cache} | ${ids(c.matched)} | ${ids(c.wikiOnly)} | ${ids(c.cacheOnly)} |`), '',
  `Exact matched groups (${groupComparison.matchedGroups.length}): ${ids(groupComparison.matchedGroups)}`, '',
  `Wiki groups without cache matches (${groupComparison.wikiGroupsWithoutCacheMatch.length}): ${ids(groupComparison.wikiGroupsWithoutCacheMatch)}`, '',
  `Cache groups without Wiki matches (${groupComparison.cacheGroupsWithoutWikiMatch.length}): ${ids(groupComparison.cacheGroupsWithoutWikiMatch)}`, '',
  '## Non-equivalent types', '',
  `Wiki fishing groups without equivalent product-specific cache classes (${result.uncomparableWikiGroups.length}): ${ids(result.uncomparableWikiGroups)}`, '',
  `Other cache ore/tree groups beyond Wiki-selected type scope (${result.cacheGroupsOutsideComparableClasses.length}): ${ids(result.cacheGroupsOutsideComparableClasses)}`, '',
  '## What could indicate mistakes', '',
  'A Wiki-only ore group is a useful lead for checking a raw coordinate, coordinate order, plane, or location-to-cell inference against the cited Wiki page. A cache-only group in a selected Wiki cell may suggest an incomplete Wiki location extraction. A cache-only group outside the selected cells may instead reflect the irregular selected scope. A whole-cell coverage mismatch warrants checking coordinate arithmetic and cache coverage before drawing a content conclusion. All repairs require fresh Wiki evidence; these private cache differences cannot supply replacement rows.', '',
  '## Limits', '',
  ...result.limitations.map(v => `- ${v}`), '',
  '## Repeat', '',
  'Run `node scripts/compare-open-f2p-private.mjs`. The script reads exactly the three named local JSON inputs and writes this report and `.local/open-f2p-private-comparison.json`. It imports no generator, provider, app runtime or legacy catalogue. It starts no browser/server and runs no heavy tests.', '',
);
await mkdir(path.join(root, '.local'), { recursive: true });
await writeFile(path.join(root, '.local/open-f2p-private-comparison.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.join(root, 'docs/research/open-f2p-private-comparison-2026-10-13.md'), sections.join('\n'));
console.log(JSON.stringify({ wiki: result.wikiTotals, crop, cells: Object.fromEntries(Object.entries(result.cellComparison).map(([key, c]) => [key, { matched: c.matchedCells.length, missing: c.wikiCellsWithoutDecodedCache.length, extra: c.decodedCacheCellsOutsideWikiSelection.length }])), groups: Object.fromEntries(Object.entries(groupComparison).map(([key, v]) => [key, v.length])), uncomparable: result.uncomparableWikiGroups.length }, null, 2));
