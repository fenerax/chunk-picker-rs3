#!/usr/bin/env node
// Offline copied-cache investigation. Ordinary inventory names are unknown until
// a complete external name/stock witness is supplied; numeric coincidences never join.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openGameCache, loadTable, writeDataset, finishManifest, cliOptions } from './game-data-common.mjs';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';

const clean = value => String(value ?? '').trim().toLowerCase();
const enumEntries = def => def.stringArrayValue1 ?? def.stringArrayValue2?.values ?? def.intArrayValue1 ?? def.intArrayValue2?.values ?? [];
const extraMap = def => new Map((def?.extra ?? []).map(row => [row.prop, row.intvalue ?? row.stringvalue]));
const shopText = /\bshop\b|\bshops\b|\bstore\b|emporium|aubury|beefy bill|\bbob's axes\b|\bzaff\b|\blowe\b/i;

export function extractInventories(inventories, items) {
  return [...inventories].map(([id, def]) => ({ id, source: { major: 2, minor: 5, subid: id },
    size: def.size ?? null, shopdataPresent: Object.hasOwn(def, 'shopdata'),
    name: null, currency: null, members: null, keeperNpcIds: [],
    identityStatus: 'Cache inventory definition has no encoded shop name, currency, membership or NPC keeper field',
    stock: (def.shopdata ?? []).map((row, slot) => ({ slot, itemId: row.item, name: items.get(row.item)?.name ?? null,
      baseStock: row.stock, membersMarked: items.has(row.item) ? items.get(row.item).members === true : null,
      definitionPresent: items.has(row.item) })), raw: def,
    stockMeaning: 'Encoded shopdata quantity; supported base-stock/cap candidate, not live remaining stock, price, restock timing or server availability' }));
}

export function retainedShopDeclarations(reference) {
  const declarations = [];
  for (const [chunkId, chunk] of Object.entries(reference.chunks ?? {})) {
    for (const [name, value] of Object.entries(chunk.Shop ?? {})) declarations.push({ address: chunkId, name, value });
    for (const [sectionId, section] of Object.entries(chunk.Sections ?? {}))
      for (const [name, value] of Object.entries(section.Shop ?? {})) declarations.push({ address: `${chunkId}-${sectionId}`, name, value });
  }
  return declarations;
}

export function compareShopCandidates(inventories, reference) {
  const candidates = inventories.filter(inv => inv.shopdataPresent && inv.stock.length)
    .map(inv => ({ inv, names: new Set(inv.stock.filter(row => row.name).map(row => clean(row.name))) }));
  const declarations = retainedShopDeclarations(reference);
  const comparisons = Object.entries(reference.shopItems ?? {}).map(([name, items]) => {
    const beforeNames = Object.keys(items), before = new Set(beforeNames.map(clean));
    const ranked = candidates.map(({ inv, names }) => {
      const common = [...before].filter(name => names.has(name));
      return { inventoryId: inv.id, overlap: common.length, retainedCount: before.size, cacheCount: names.size,
        exactNameSet: common.length === before.size && common.length === names.size,
        score: common.length ? common.length / (before.size + names.size - common.length) : 0,
        cacheOnlyNames: inv.stock.filter(row => row.name && !before.has(clean(row.name))).map(row => row.name),
        retainedOnlyNames: beforeNames.filter(name => !names.has(clean(name))) };
    }).filter(row => row.overlap).sort((a, b) => b.score - a.score || b.overlap - a.overlap || a.inventoryId - b.inventoryId);
    const exact = ranked.filter(row => row.exactNameSet);
    return { name, beforeItems: items, addresses: declarations.filter(row => row.name === name).map(row => row.address),
      identityStatus: 'Unproven name-set association; shared/free inventories and obsolete variants may exist',
      exactNameSetInventoryIds: exact.map(row => row.inventoryId), bestCandidates: ranked.slice(0, 5),
      additions: null, removals: null, renames: [], inventoryComparisonLimit: 'Inventory IDs have no cache shop identity; no changes certified by name overlap' };
  });
  return { comparisons, declarations, summary: { retainedShops: comparisons.length, declarations: declarations.length,
    withExactNameSet: comparisons.filter(row => row.exactNameSetInventoryIds.length).length,
    uniqueExactNameSet: comparisons.filter(row => row.exactNameSetInventoryIds.length === 1).length,
    ambiguousExactNameSet: comparisons.filter(row => row.exactNameSetInventoryIds.length > 1).length,
    withoutNameOverlap: comparisons.filter(row => !row.bestCandidates.length).length },
    meaning: 'Complete inventory evidence coverage and unproven name-set candidates; only reviewed complete Wiki witnesses permit named differences' };
}

export function textFields(value, path = '') {
  if (typeof value === 'string') return [{ path, value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => textFields(child, path ? `${path}.${key}` : key));
}

// Opcode bodies are deliberately opaque. These ASCII spans are search evidence,
// not decoded string opcodes or executable instruction semantics.
export function printableSpans(bytes, minimum = 4) {
  const spans = [];
  for (let start = 0; start < bytes.length;) {
    if (bytes[start] < 32 || bytes[start] > 126) { start++; continue; }
    let end = start + 1;
    while (end < bytes.length && bytes[end] >= 32 && bytes[end] <= 126) end++;
    if (end - start >= minimum) spans.push({ offset: start, text: bytes.subarray(start, end).toString('ascii') });
    start = end;
  }
  return spans;
}

export function scanTypedReferences({ enums, structs, params, npcs }, inventories) {
  const inventoryParams = [...params].filter(([, def]) => def.type?.vartype === 39);
  const inventoryParamIds = new Set(inventoryParams.map(([id]) => id));
  const stockIds = new Set(inventories.filter(inv => inv.shopdataPresent).map(inv => inv.id));
  const paramRefs = defs => [...defs].flatMap(([id, def]) => {
    const refs = (def.extra ?? []).filter(row => inventoryParamIds.has(row.prop));
    return refs.length ? [{ id, name: def.name ?? null, refs, stockInventoryRefs: refs.filter(row => stockIds.has(row.intvalue)), raw: def }] : [];
  });
  const inventoryEnums = [...enums].filter(([, def]) => def.key_type2 === 39 || def.value_type2 === 39)
    .map(([id, raw]) => ({ id, raw, stockInventoryRefs: enumEntries(raw).filter(([key, value]) => stockIds.has(raw.key_type2 === 39 ? key : value)) }));
  const textHits = defs => [...defs].flatMap(([id, raw]) => { const hits = textFields(raw).filter(row => shopText.test(row.value));
    return hits.length ? [{ id, hits, raw }] : []; });
  const rewardFragments = [...structs].flatMap(([id, def]) => {
    const p = extraMap(def);
    if (!p.has(4843)) return [];
    const enumId = p.get(4842), list = enums.get(enumId);
    const entries = list?.value_type2 === 73 ? enumEntries(list).map(([key, structId]) => {
      const itemDef = structs.get(structId), e = extraMap(itemDef);
      return { key, structId, typedItemId: params.get(4851)?.type?.vartype === 33 ? e.get(4851) ?? null : null,
        label: e.get(4849) ?? null, raw: itemDef ?? null };
    }) : [];
    return [{ structId: id, titleText: p.get(4843), currencyText: p.get(4844) ?? null, enumId, entries, raw: def,
      baseStock: null, members: null, keeperNpcIds: [],
      meaning: 'Reward UI struct/title/enum/item fragments; label/currency params inferred by coherent text family, no base stock or server shop execution inferred' }];
  });
  return { inventoryParams, inventoryEnums, structInventoryReferences: paramRefs(structs), npcInventoryReferences: paramRefs(npcs),
    enumTextHits: textHits(enums), structTextHits: textHits(structs), rewardFragments };
}

export function parseWikiShopPage(page) {
  const revision = page.revisions?.[0], content = revision?.slots?.main?.content ?? '';
  const stock = [...content.matchAll(/\{\{StoreLine\|([^{}]*)\}\}/g)].map(match => {
    const fields = Object.fromEntries(match[1].split('|').map(field => { const i = field.indexOf('='); return [field.slice(0, i).trim(), field.slice(i + 1).trim()]; }));
    return { name: fields.name ?? null, baseStock: /^\d+$/.test(fields.stock ?? '') ? Number(fields.stock) : null,
      members: fields.members ? /^yes$/i.test(fields.members) : null, sell: fields.sell ?? null };
  });
  const info = content.match(/\{\{Infobox Shop\s*([\s\S]*?)\n\}\}/)?.[1] ?? '';
  const field = key => info.match(new RegExp(`\\|${key}\\s*=\\s*([^\\n]+)`))?.[1]?.trim() ?? null;
  return { name: page.title, revisionId: revision?.revid ?? null, revisionTimestamp: revision?.timestamp ?? null,
    url: `https://runescape.wiki/w/Special:PermanentLink/${revision?.revid}`, members: field('members') ? /^yes$/i.test(field('members')) : null,
    owner: field('owner')?.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') ?? null, currency: field('currency'), stock,
    missing: page.missing === true };
}

export function reviewWikiStocks(inventories, reference, snapshot, proposed = {}) {
  const byId = new Map(inventories.map(inv => [inv.id, inv]));
  const pages = (snapshot?.pages ?? []).map(parseWikiShopPage), reviews = [];
  for (const page of pages) {
    if (page.missing || !page.stock.length) { reviews.push({ ...page, status: 'no-stock-witness' }); continue; }
    const ids = proposed[page.name] ?? inventories.filter(inv => inv.shopdataPresent && inv.stock.length === page.stock.length
      && inv.stock.every(row => page.stock.some(w => clean(w.name) === clean(row.name) && w.baseStock === row.baseStock))).map(inv => inv.id);
    const stock = ids.flatMap(id => (byId.get(id)?.stock ?? []).map(row => ({ ...row, inventoryId: id })));
    const mismatches = [], unmatched = new Set(stock.map((_, i) => i));
    for (const row of page.stock) {
      const matchIndex = [...unmatched].find(i => clean(stock[i].name) === clean(row.name) && stock[i].baseStock === row.baseStock);
      if (matchIndex === undefined) mismatches.push({ name: row.name, wikiBaseStock: row.baseStock,
        cache: stock.filter(candidate => clean(candidate.name) === clean(row.name)).map(candidate => ({ inventoryId: candidate.inventoryId, baseStock: candidate.baseStock })) });
      else { unmatched.delete(matchIndex); stock[matchIndex].wikiMembers = row.members; }
    }
    const extraRows = [...unmatched].map(i => stock[i]);
    const complete = ids.length > 0 && stock.length === page.stock.length && !mismatches.length && !extraRows.length;
    const beforeNames = Object.keys(reference.shopItems?.[page.name] ?? {}), afterNames = [...new Set(stock.filter(row => row.baseStock > 0).map(row => row.name))];
    const declarations = retainedShopDeclarations(reference).filter(row => row.name === page.name);
    reviews.push({ ...page, inventoryIds: ids, status: complete ? 'reviewed-complete-stock' : 'incomplete-or-disagrees',
      stockWitness: page.stock, stock, mismatches, extraRows, reference: { beforeItems: Object.keys(reference.shopItems?.[page.name] ?? {}),
        beforeShopItems: reference.shopItems?.[page.name] ?? null },
      comparison: { addresses: declarations.map(row => row.address), additions: complete ? afterNames.filter(name => !beforeNames.includes(name)) : null,
        removals: complete ? beforeNames.filter(name => !afterNames.includes(name)) : null, renames: [],
        retainedQuantityComparison: 'Unavailable: picker shopItems has item availability flags rather than encoded stock quantities',
        locationChanges: 'Not established: inventory definitions have no shop keeper or location link' } });
  }
  return reviews;
}

export function runtimeShopDataset(reviews, provenance) {
  return { schemaVersion: 1, kind: 'reviewed-cache-shop-stock', provenance,
    shops: reviews.filter(row => row.status === 'reviewed-complete-stock' && row.reference.beforeShopItems).map(row => ({
      name: row.name, inventoryIds: row.inventoryIds, confidence: row.status,
      stock: row.stock.map(({ itemId, name, baseStock, membersMarked, inventoryId }) => ({ itemId, name, baseStock, membersMarked, inventoryId,
        wikiMembers: row.stock.find(w => w.itemId === itemId && w.inventoryId === inventoryId && w.baseStock === baseStock)?.wikiMembers ?? null })),
      cacheCurrency: null, cacheMembers: null, cacheKeeperNpcIds: [], wiki: { url: row.url, revisionId: row.revisionId,
        members: row.members, owner: row.owner, currency: row.currency }, reference: row.reference,
      identityBasis: 'Complete unique name/quantity multiset witness from a dated Wiki page; cache itself contains no name-to-inventory link' })),
    limits: ['Reviewed cache quantities are caps/base stocks, not live remaining quantities.',
      'Name-to-inventory association uses external full-stock witness; it is not an encoded server/NPC link.',
      'Shop membership and keeper names are Wiki metadata. Item membersMarked alone does not establish world/player access.'] };
}

export async function exportShops({ cache, context, output, reference, wiki = null, wikiPath = null }) {
  const specs = { inventories: { major: 2, minor: 5, kind: 'inventory' }, items: { major: 19, kind: 'item' },
    params: { major: 2, minor: 11, kind: 'param' }, enums: { major: 17, kind: 'enum' },
    structs: { major: 22, kind: 'struct', groupSize: 32 }, npcs: { major: 18, kind: 'npc', groupSize: 128 } };
  const tables = Object.fromEntries(Object.entries(specs).map(([name, opts]) => [name, loadTable(cache, opts)]));
  const defs = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.definitions]));
  const inventories = extractInventories(defs.inventories, defs.items), retained = compareShopCandidates(inventories, reference);
  const typed = scanTypedReferences(defs, inventories);
  const interfaces = loadTable(cache, { major: 3, kind: 'interface', groupSize: 65536 });
  const stockIds = new Set(inventories.filter(row => row.shopdataPresent).map(row => row.id));
  const interfaceHits = [], interfaceInventoryTriggers = [];
  for (const [id, raw] of interfaces.definitions) {
    const hits = textFields(raw).filter(row => shopText.test(row.value));
    if (hits.length) interfaceHits.push({ id, major: 3, minor: Math.floor(id / 65536), subid: id % 65536, hits, raw });
    const triggers = raw.scriptdata?.inventory_trigger ?? [];
    if (triggers.length) interfaceInventoryTriggers.push({ id, triggers, stockInventoryIds: triggers.filter(id => stockIds.has(id)) });
  }
  const uiInventoryAssociations = interfaceInventoryTriggers.filter(row => row.stockInventoryIds.length).map(row => ({
    interfaceId: Math.floor(row.id / 65536), triggerComponent: row.id % 65536, stockInventoryIds: row.stockInventoryIds,
    sameInterfaceText: interfaceHits.filter(hit => hit.minor === Math.floor(row.id / 65536)).map(({ subid, hits }) => ({ component: subid, hits })),
    interpretation: 'Same-interface typed inventory trigger and text; candidate association only, script execution and server identity unknown' }));
  const scriptHeaders = [], scriptErrors = [], scriptTextHits = [];
  let scriptProbe = null;
  for (const minor of cache.table(12).entries.keys()) {
    try {
      for (const [subid, bytes] of cache.archive(12, minor) ?? []) {
        if (!scriptProbe) {
          try { cache.decoders.decode('clientscript', bytes); scriptProbe = { minor, status: 'decoded' }; }
          catch (error) { scriptProbe = { minor, status: 'unavailable', reason: error.message }; }
        }
        const { opcodedata, ...header } = cache.decoders.decode('clientscriptdata', bytes);
        scriptHeaders.push({ minor, subid, rawOpcodeBytes: opcodedata.length, ...header });
        const hits = printableSpans(opcodedata).filter(row => shopText.test(row.text));
        if (hits.length) scriptTextHits.push({ minor, subid, hits });
      }
    } catch (error) { scriptErrors.push({ minor, message: error.message }); }
  }
  const wikiProvenance = wikiPath ? { path: resolve(wikiPath).replaceAll('\\', '/'), sha256: sha256(readFileSync(wikiPath)),
    fetchedAt: wiki.fetchedAt, pages: wiki.pages.length } : null;
  const provenance = { generatedAt: context.generatedAt, decoder: context.decoder, reference: context.reference,
    extractor: { path: 'scripts/cache/game-data-shops.mjs', sha256: sha256RepositoryText(readFileSync(import.meta.filename)), hashScope: 'repository LF text' },
    wikiSnapshot: wikiProvenance, manifest: 'shops-manifest.v1.json' };
  const reviews = reviewWikiStocks(inventories, reference, wiki, { "Bob's Brilliant Axes": [1, 554], "Lowe's Archery Emporium": [7, 556], "Aubury's Rune Shop": [5, 557] });
  const runtime = runtimeShopDataset(reviews, provenance);
  const fieldCounts = {};
  for (const def of defs.inventories.values()) for (const field of Object.keys(def)) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
  const stock = inventories.flatMap(inv => inv.stock);
  const summary = { inventoryDefinitions: inventories.length, inventoryDecodeErrors: tables.inventories.errors.length, fieldCounts,
    withShopdata: inventories.filter(inv => inv.shopdataPresent).length, withoutShopdata: inventories.filter(inv => !inv.shopdataPresent).length,
    emptyShopdata: inventories.filter(inv => inv.shopdataPresent && !inv.stock.length).length, stockRows: stock.length,
    positiveStockRows: stock.filter(row => row.baseStock > 0).length, zeroStockRows: stock.filter(row => row.baseStock === 0).length,
    missingItemDefinitions: stock.filter(row => !row.definitionPresent).length, duplicateItemInventories: inventories.filter(inv => new Set(inv.stock.map(row => row.itemId)).size < inv.stock.length).length,
    encodedShopNames: 0, encodedCurrencies: 0, encodedShopMembership: 0, encodedKeeperLinks: 0,
    inventoryTypedParams: typed.inventoryParams.length, inventoryTypedEnums: typed.inventoryEnums.length,
    inventoryTypedStructs: typed.structInventoryReferences.length, inventoryTypedNpcs: typed.npcInventoryReferences.length,
    interfaceTextHits: interfaceHits.length, interfaceStockTriggerComponents: interfaceInventoryTriggers.filter(row => row.stockInventoryIds.length).length,
    scriptHeaders: scriptHeaders.length, scriptHeaderErrors: scriptErrors.length, scriptTextHits: scriptTextHits.length,
    rewardUiFragments: typed.rewardFragments.length, reviewedCompleteNamedShops: runtime.shops.length, retained: retained.summary };
  const inspection = { tables: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, { decoded: table.definitions.size, archives: table.archives, errors: table.errors }])),
    ...typed, interfaces: { decoded: interfaces.definitions.size, errors: interfaces.errors, interfaceHits, interfaceInventoryTriggers, uiInventoryAssociations,
      limit: 'Pinned schema documented through build932; modern parse failures remain explicit' },
    clientscripts: { declared: cache.table(12).entries.size, scriptProbe, headersDecoded: scriptHeaders.length, errors: scriptErrors, scriptTextHits,
      limit: 'Opaque obfuscated opcode bytes; printable spans and headers only, no numeric/name-to-stock execution inference' } };
  const dataset = { schemaVersion: 1, kind: 'advisory-cache-shop-inventory-investigation', provenance, summary, inventories,
    wikiReviews: reviews, inspection, conclusion: `Shopdata is present in ${summary.withShopdata} copied-cache inventory configs; universal ordinary-stock absence is disproven. Complete live-shop coverage and identity are not established.` };
  const files = [];
  for (const [name, value] of [['shops.cache-2026-10-08.v1.json', dataset], ['shops-retained-comparison.2026-10-08.v1.json', { schemaVersion: 1, provenance, ...retained }],
    ['shops-clientscript-headers.2026-10-08.v1.json', { schemaVersion: 1, provenance, scriptHeaders, errors: scriptErrors }],
    ['shops-reviewed.2026-10-08.v1.json', runtime], ['shops-wiki-snapshot.2026-10-08.v1.json', wiki ?? { status: 'not supplied' }]]) {
    const file = writeDataset(output, name, value); files.push(file); context.outputs.push(file);
  }
  return { dataset, runtime, retained, files };
}

async function main() {
  const args = cliOptions();
  if (!args.output) throw new Error('Required --output NEW-directory');
  const { cache, context } = await openGameCache({ workspace: args.workspace, build: args.build ? Number(args.build) : 950 });
  try {
    const reference = JSON.parse(readFileSync(context.reference.path, 'utf8'));
    const wiki = args.wiki ? JSON.parse(readFileSync(args.wiki, 'utf8')) : null;
    const result = await exportShops({ cache, context, output: args.output, reference, wiki, wikiPath: args.wiki });
    const { manifest, file } = await finishManifest(cache, context, args.output, { name: 'shops-manifest.v1.json', summary: result.dataset.summary });
    console.log(JSON.stringify({ files: [...result.files, file], summary: result.dataset.summary,
      reviewedShops: result.runtime.shops.map(row => ({ name: row.name, inventoryIds: row.inventoryIds, items: row.stock.length })),
      manifestSourceCount: manifest.sources.length }, null, 2));
  } finally { cache.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
