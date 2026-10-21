import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wikiReceiptSha256 } from './lib/open-f2p-receipt.mjs';
import { buildServices, buildOrdinarySupplies } from './lib/open-f2p-services.mjs';
import { buildWalking } from './lib/open-f2p-walking.mjs';
import { buildStories } from './lib/open-f2p-stories.mjs';
import { buildEquipment } from './lib/open-f2p-equipment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const authoredPath = path.join(root, 'app/datasets/open-f2p/authored/batch.json');
export const defaultCache = path.join(root, '.local/wiki-open-f2p');
export const defaultOutput = path.join(root, 'app/datasets/open-f2p/wiki-derived');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cacheFilename = title => `${title.replaceAll(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${hash(title).slice(0, 10)}.json`;
const clean = text => text.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replaceAll("'''", '').trim();
const field = (text, key) => new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|}]+)`, 'i').exec(text)?.[1]?.trim();
export const chunkId = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));

// Balanced templates retain nested requirement templates; a first-}} regex
// would lose the gate and incorrectly admit some members/resource-dungeon rows.
export function templates(text, name) {
  const result = [], expression = new RegExp(`\\{\\{${name}\\s*(?=\\||\\n)`, 'gi');
  for (const match of text.matchAll(expression)) {
    let depth = 1, at = match.index + 2;
    while (depth && at < text.length) {
      const pair = text.slice(at, at + 2);
      if (pair === '{{') { depth++; at += 2; }
      else if (pair === '}}') { depth--; at += 2; }
      else at++;
    }
    if (depth) throw new Error(`Unclosed ${name} template.`);
    result.push(text.slice(match.index, at));
  }
  return result;
}
function coordinates(text) {
  return [...text.matchAll(/\bx:(\d+),\s*y:(\d+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}
function anchor(text) {
  const x = /\bx\s*=\s*(\d+)/i.exec(text), y = /\by\s*=\s*(\d+)/i.exec(text);
  const colon = coordinates(text)[0], tuple = /\|\s*(\d{4}),\s*(\d{4})\s*(?:\||\}\})/.exec(text);
  return x && y ? { x: Number(x[1]), y: Number(y[1]) } : colon ?? (tuple ? { x: +tuple[1], y: +tuple[2] } : null);
}
const sorted = rows => rows.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));

/** Offline-only build: exactly one authored input and pinned Wiki cache files. */
export async function buildOpenF2P({ cacheDir = defaultCache, outputDir = defaultOutput } = {}) {
  const authoredBytes = await readFile(authoredPath);
  const spec = JSON.parse(authoredBytes), pages = new Map(), receipts = [];
  for (const pin of spec.pages) {
    const filename = cacheFilename(pin.requestedTitle), bytes = await readFile(path.join(cacheDir, filename));
    const cached = JSON.parse(bytes), page = cached.page, revision = page?.revisions?.[0];
    if (cached.requestedTitle !== pin.requestedTitle || page.title !== pin.title || revision?.revid !== pin.revision
      || revision.slots?.main?.contentmodel !== (pin.contentModel ?? 'wikitext') || !cached.api.startsWith('https://runescape.wiki/api.php?')) throw new Error(`Pinned Wiki response mismatch: ${pin.requestedTitle}.`);
    const provenance = { page: page.title, revision: revision.revid, url: `https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ', '_'))}?oldid=${revision.revid}` };
    pages.set(pin.requestedTitle, { text: revision.slots.main.content, provenance });
    receipts.push({ ...pin, cacheFile: filename, receipt: pin.contentModel === 'Scribunto' ? 'pinned-scribunto-v1' : 'pinned-wikitext-v1', sha256: wikiReceiptSha256(cached) });
  }
  const inBounds = ({ x, y }) => x >= spec.bounds.minX && x <= spec.bounds.maxX && y >= spec.bounds.minY && y <= spec.bounds.maxY;
  const cells = new Map(), sources = new Map(), anchors = new Map();
  const addCell = (point, name, provenance, priority = false) => {
    const id = chunkId(point.x, point.y), existing = cells.get(id);
    if (!existing) cells.set(id, { id, name, regionX: Math.floor(point.x / 64), regionY: Math.floor(point.y / 64),
      membership: 'free', provenance: [provenance] });
    else {
      if (!existing.provenance.some(row => row.page === provenance.page)) existing.provenance.push(provenance);
    }
    return id;
  };
  for (const title of spec.places) {
    const { text, provenance } = pages.get(title);
    if (field(text, 'members')?.toLowerCase() !== 'no') throw new Error(`Place has no explicit free membership: ${title}.`);
    const point = anchor(text);
    if (!point || !inBounds(point)) throw new Error(`Place has no reviewed surface coordinate: ${title}.`);
    anchors.set(title, { ...point, id: addCell(point, title, provenance, true), provenance });
  }
  const addSource = (type, point, place, provenance, membershipProvenance, level) => {
    if (!inBounds(point)) return;
    const cell = addCell(point, place, membershipProvenance ?? provenance), id = `rs3:open-f2p:source:${type.slug}:${cell}`;
    if (!sources.has(id)) sources.set(id, { id, slug: type.slug, cell, name: type.name ?? provenance.page, skill: type.skill,
      level, output: type.output, tool: type.tool, places: [], coordinates: [], membership: 'free', provenance: [provenance,
        ...(membershipProvenance && membershipProvenance.page !== provenance.page ? [membershipProvenance] : [])] });
    const source = sources.get(id);
    if (!source.places.includes(place)) source.places.push(place);
    if (!source.coordinates.some(row => row.x === point.x && row.y === point.y)) source.coordinates.push(point);
  };
  const minePages = new Map(spec.mines.map(title => [pages.get(title).provenance.page, pages.get(title)]));
  for (const type of spec.types) {
    const { text, provenance } = pages.get(type.page);
    const level = Number(field(text, 'level'));
    if (!Number.isSafeInteger(level) || level < 1 || field(text, 'members')?.toLowerCase() === 'yes') throw new Error(`Unknown level/membership: ${type.page}.`);
    for (const row of templates(text, type.template)) {
      if (field(row, 'plane') && field(row, 'plane') !== '0' || field(row, 'mapID') && field(row, 'mapID') !== '28') continue;
      if (field(row, 'requirements') && !/^(none|no)$/i.test(field(row, 'requirements'))) continue;
      const place = clean(field(row, type.skill === 'Mining' ? 'site' : 'loc') ?? '');
      let membershipProvenance = provenance;
      if (type.skill === 'Mining') {
        const mine = minePages.get(place);
        if (!mine || field(mine.text, 'members')?.toLowerCase() !== 'no') continue;
        // Only explicitly reviewed, ungated surface mines. No nearest
        // mine matching, cache object IDs, interiors or generic members flags.
        if (field(mine.text, 'requirements') && !/^(none|no)$/i.test(field(mine.text, 'requirements'))) continue;
        membershipProvenance = mine.provenance;
      } else if (field(row, 'mem')?.toLowerCase() !== 'no') continue;
      for (const point of coordinates(row)) addSource(type, point, place, provenance, membershipProvenance, level);
    }
  }
  for (const type of spec.fishing) {
    const { text, provenance } = pages.get(type.page);
    for (const [slug, output, tool] of type.fish) {
      const loot = templates(text, 'DropsLineFish').find(row => field(row, 'name') === output);
      const level = Number(field(loot ?? '', 'level') ?? (slug === 'crayfish' ? field(templates(text, 'Fishing info')[0] ?? '', 'level') : NaN));
      if (!Number.isSafeInteger(level) || level < 1) throw new Error(`Unknown fishing level: ${output}.`);
      for (const row of templates(text, 'FishingSpotLocLine')) {
        if (field(row, 'mem')?.toLowerCase() !== 'no' || field(row, 'mapID') !== '28'
          || field(row, 'requirements')?.toLowerCase() !== 'none') continue;
        for (const point of coordinates(row)) addSource({ slug, output, tool, skill: 'Fishing', name: `${slug[0].toUpperCase()}${slug.slice(1)} fishing spot` },
          point, clean(field(row, 'loc')), provenance, null, level);
      }
    }
  }
  const facilities = buildServices({ spec, pages, addCell, anchors });
  const reviewedWalking = buildWalking({ spec, pages, addCell, anchors });
  const connections = spec.connections.map(row => {
    const from = anchors.get(row.from), to = anchors.get(row.to), evidence = pages.get(row.evidence);
    const distance = Math.abs(Math.floor(from.x / 64) - Math.floor(to.x / 64)) + Math.abs(Math.floor(from.y / 64) - Math.floor(to.y / 64));
    if (distance !== 1 || !evidence.text.includes(row.needle)) throw new Error(`Walking evidence changed: ${row.from} to ${row.to}.`);
    return { id: `rs3:open-f2p:connection:${[from.id, to.id].sort().join(':')}`, from: from.id, to: to.id, reason: row.reason,
      provenance: [...new Map([from.provenance, to.provenance, evidence.provenance].map(p => [p.page, p])).values()] };
  });
  connections.push(...reviewedWalking);
  const sourceRows = sorted([...sources.values()]);
  for (const source of sourceRows) { source.coordinates.sort((a, b) => a.x - b.x || a.y - b.y); source.places.sort(); }
  const tasks = sourceRows.map(source => ({ id: `rs3:open-f2p:activity:${source.slug}:${source.cell}`, sourceId: source.id, cell: source.cell,
    skill: source.skill, level: source.level, label: `${source.skill === 'Mining' ? 'Mine' : source.skill === 'Woodcutting' ? 'Cut' : 'Catch'} ${source.output.toLowerCase()} in ${cells.get(source.cell).name} (${source.cell})`,
    reason: `A free-to-play ${source.name.toLowerCase()} is recorded in this cell. Requires ${source.skill} ${source.level}; bring a ${source.tool}.` +
      (spec.supplies ? ' A reviewed shop in your unlocked cells must supply each tool and bait. Bring coins for paid stock; inventory and stock depletion are not tracked.' : ''),
    ...(spec.supplies ? { supplyItems: spec.supplies[source.slug] ?? [] } : {}),
    provenance: [...new Map([...source.provenance, ...(spec.supplies?.[source.slug] ?? []).flatMap(item => {
      const title = item === 'Pickaxe[+]' ? 'Bronze pickaxe' : item === 'Hatchet[+]' ? 'Bronze hatchet' : item;
      return pages.has(title) ? [pages.get(title).provenance] : [];
    })].map(row => [row.page, row])).values()] }));
  tasks.push(...facilities.tasks);
  const stories = buildStories({ spec, pages, cells, templates });
  tasks.push(...stories.tasks);
  const ordinary = buildOrdinarySupplies({ spec, pages, cells });
  tasks.push(...ordinary.tasks);
  const gear = buildEquipment({ spec, pages, cells, templates, stock: facilities.stock, sources: sourceRows });
  tasks.push(...gear.tasks);
  const usedPages = new Set([...cells.values(), ...sourceRows, ...connections, ...tasks, ...facilities.shops, ...facilities.stock, ...facilities.services, ...facilities.routes,
    ...stories.quests, ...stories.achievements, ...stories.achievementReview, ...ordinary.harvests, ...ordinary.dialogueSupplies,
    ...gear.equipment, ...gear.acquisitions, ...gear.monsters, ...gear.drops, ...gear.facilities, ...gear.recipes, ...gear.equipmentReview].flatMap(row => row.provenance.map(p => p.page)));
  const coverage = { cells: cells.size, connections: connections.length, sources: sourceRows.length, tasks: tasks.length,
    wikiPages: usedPages.size, ...(spec.shops ? { shops: facilities.shops.length, stock: facilities.stock.length,
      banks: facilities.services.filter(row => row.kind === 'bank').length, depositBoxes: facilities.services.filter(row => row.kind === 'deposit-box').length,
      routes: facilities.routes.length } : {}), ...(spec.questActivities ? { quests: stories.quests.length, achievements: stories.achievements.length,
      seasonalQuests: stories.quests.filter(row => row.seasonal).length, skippedAchievements: stories.achievementReview.length } : {}), omitted: spec.omitted };
  Object.assign(coverage, Object.fromEntries(['equipment', 'acquisitions', 'monsters', 'drops', 'facilities', 'recipes', 'equipmentReview'].map(key => [key, gear[key].length])));
  Object.assign(coverage, { harvests: ordinary.harvests.length, dialogueSupplies: ordinary.dialogueSupplies.length });
  const dataset = { schemaVersion: 1, id: spec.id, version: spec.version, licence: 'CC-BY-NC-SA-3.0',
    coordinateDerivation: { cellSize: 64, idFormula: 'floor(x / 64) * 256 + floor(y / 64)',
      description: 'Project-authored arithmetic converts Wiki tile coordinates to standard region keys. Wiki provenance supports the input coordinates; no Wiki statement of the numeric ID formula was found.',
      provenance: [pages.get('Template:Map/doc').provenance, pages.get('RuneScape:Map').provenance] },
    coverage, cells: sorted([...cells.values()]), connections: sorted(connections), sources: sourceRows, tasks: sorted(tasks),
    ...(spec.shops ? { shops: facilities.shops, stock: facilities.stock, services: facilities.services, routes: facilities.routes } : {}),
    ...(spec.questActivities ? { quests: stories.quests, achievements: stories.achievements, achievementReview: stories.achievementReview } : {}),
    equipment: gear.equipment, acquisitions: gear.acquisitions, monsters: gear.monsters, drops: gear.drops, facilities: gear.facilities, recipes: gear.recipes, equipmentReview: gear.equipmentReview,
    harvests: ordinary.harvests, dialogueSupplies: ordinary.dialogueSupplies,
    buildInputs: { authored: { path: 'app/datasets/open-f2p/authored/batch.json', sha256: hash(authoredBytes) }, wiki: receipts } };
  const bytes = JSON.stringify(dataset, null, 2) + '\n';
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'dataset.json'), bytes);
  return { dataset, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('The build uses only the pinned local cache and authored batch.');
  const { dataset, bytes } = await buildOpenF2P();
  process.stdout.write(JSON.stringify({ ...dataset.coverage, sha256: hash(bytes) }) + '\n');
}
