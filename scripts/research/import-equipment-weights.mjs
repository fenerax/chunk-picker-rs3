import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEquipmentWikiPage, selectWikiVariants, resolveWikiVariantWeight } from './equipment-wiki.mjs';

export const hashEquipmentRow = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const commonWeight = variants => variants.length && variants.every(v => v.weight !== null && v.weight === variants[0].weight) ? variants[0].weight : null;

/** Pure offline build: numeric facts require exact Wiki IDs, never first same-name rows. */
export function buildEquipmentWeights({ equipment, comparison, items, wikiSnapshot }) {
  const comparisonRows = new Map((comparison.equipment ?? comparison).map(row => [row.name, row]));
  const cacheItems = new Map((items.records ?? items).map(row => [row.id, row]));
  const wikiPages = new Map(wikiSnapshot.pages.map(page => [page.title, parseEquipmentWikiPage(page)]));
  const records = {}, unresolved = [];
  const summary = { equipmentRows: Object.keys(equipment).length, resolved: 0, unresolved: 0, uniqueCacheIdentities: 0, equivalentCacheVariants: 0, explicitWornVariants: 0 };
  for (const [name, row] of Object.entries(equipment)) {
    const match = comparisonRows.get(name), candidateIds = match?.candidateIds ?? [];
    const canonicalTitle = wikiSnapshot.resolutions[name] ?? name;
    const parsed = wikiPages.get(canonicalTitle);
    const reject = (reason, details = {}) => unresolved.push({ name, reason, cacheCandidateIds: candidateIds, wikiTitle: canonicalTitle, source: parsed?.revisionId ? { ...parsed.source, fetchedAt: wikiSnapshot.completedAt ?? wikiSnapshot.fetchedAt } : null, ...details });
    if (Object.hasOwn(row, 'weight') && row.weight !== null) { reject('picker-weight-already-present'); continue; }
    if (!wikiSnapshot.requestedTitles.includes(name)) { reject('wiki-title-not-fetched'); continue; }
    if (!parsed || parsed.missing) { reject('wiki-page-missing'); continue; }
    if (!parsed.revisionId) { reject('wiki-revision-unavailable'); continue; }
    if (!parsed.items.length) { reject('wiki-item-infobox-unavailable'); continue; }
    if (!candidateIds.length) { reject('no-exact-equippable-cache-identity', { wikiIds: parsed.items.flatMap(v => v.ids) }); continue; }
    if (candidateIds.some(id => !cacheItems.has(id) || !cacheItems.get(id).equipmentCandidate || cacheItems.get(id).normalizedName !== name.normalize('NFC'))) { reject('cache-candidate-precondition-failed'); continue; }
    const variants = selectWikiVariants(parsed, candidateIds).map(variant => {
      const fact = resolveWikiVariantWeight(parsed, variant);
      return { ...variant, weight: fact.weight, weightFields: fact.fields, weightConflict: fact.reason };
    });
    const coveredIds = new Set(variants.flatMap(v => v.ids));
    const missingIds = candidateIds.filter(id => !coveredIds.has(id));
    if (missingIds.length) { reject('wiki-does-not-identify-all-cache-candidates', { missingIds, wikiIds: parsed.items.flatMap(v => v.ids) }); continue; }
    if (variants.some(v => v.conflicts.length)) { reject('conflicting-wiki-infobox-fields'); continue; }
    if (variants.some(v => v.weightConflict)) { reject(variants.find(v => v.weightConflict).weightConflict, { variants: variants.map(v => ({ ids: v.ids, version: v.version, fields: v.weightFields })) }); continue; }
    if (variants.some(v => v.weight === null)) { reject('wiki-weight-missing-or-nonnumeric', { variants: variants.map(v => ({ ids: v.ids, version: v.version, rawWeight: v.fields.weight ?? null })) }); continue; }
    const worn = variants.filter(v => /^(?:worn|equipped)$/i.test(v.version));
    const inventory = variants.filter(v => /^(?:inventory|unworn|backpack)$/i.test(v.version));
    let wornWeight, inventoryWeight, selected, distinction;
    if (worn.length && inventory.length) {
      wornWeight = commonWeight(worn); inventoryWeight = commonWeight(inventory); selected = worn; distinction = 'explicit-inventory-and-worn-variants';
      if (variants.length !== worn.length + inventory.length || wornWeight === null || inventoryWeight === null) { reject('ambiguous-inventory-or-worn-weight'); continue; }
      summary.explicitWornVariants++;
    } else {
      wornWeight = commonWeight(variants); inventoryWeight = wornWeight; selected = variants; distinction = 'same-item-infobox-weight';
      if (wornWeight === null) { reject('cache-variants-have-different-wiki-weights', { variants: variants.map(v => ({ ids: v.ids, version: v.version, weight: v.weight })) }); continue; }
      if (candidateIds.length === 1) summary.uniqueCacheIdentities++; else summary.equivalentCacheVariants++;
    }
    records[name] = {
      before: null, beforePresent: Object.hasOwn(row, 'weight'), equipmentBeforeSha256: hashEquipmentRow(row), weight: wornWeight, wornWeight, inventoryWeight, unit: 'kg', distinction,
      identity: { cacheCandidateIds: candidateIds, wikiIds: [...new Set(selected.flatMap(v => v.ids).filter(id => candidateIds.includes(id)))],
        inventoryIds: [...new Set((inventory.length ? inventory : variants).flatMap(v => v.ids).filter(id => candidateIds.includes(id)))],
        variants: variants.map(v => ({ ids: v.ids, name: v.name, version: v.version, suffix: v.suffix, weight: v.weight, weightFields: v.weightFields })) },
      source: { ...parsed.source, field: [...new Set(selected.flatMap(v => v.weightFields))].join('; '), fields: [...new Set(selected.flatMap(v => v.weightFields))],
        inventoryFields: [...new Set((inventory.length ? inventory : variants).flatMap(v => v.weightFields))], fetchedAt: wikiSnapshot.completedAt ?? wikiSnapshot.fetchedAt }
    };
  }
  summary.resolved = Object.keys(records).length; summary.unresolved = unresolved.length;
  summary.unresolvedReasons = Object.fromEntries([...new Set(unresolved.map(row => row.reason))].sort().map(reason => [reason, unresolved.filter(row => row.reason === reason).length]));
  return { schemaVersion: 1, datasetVersion: '2026-10-08.v1', generatedAt: wikiSnapshot.completedAt ?? wikiSnapshot.fetchedAt,
    provenance: { source: 'RuneScape Wiki current revisions via public MediaWiki API', api: wikiSnapshot.api ?? 'https://runescape.wiki/api.php', fetchedAt: wikiSnapshot.fetchedAt, completedAt: wikiSnapshot.completedAt ?? wikiSnapshot.fetchedAt,
      wikiSnapshotSha256: createHash('sha256').update(JSON.stringify(wikiSnapshot)).digest('hex'),
      requestedEquipmentRows: wikiSnapshot.requestedTitles.length, canonicalPages: wikiSnapshot.pages.length, cacheManifest: comparison.manifest ?? null, cacheReferenceSha256: comparison.reference?.sha256 ?? null,
      inventoryPolicy: 'Explicit inventory/worn variants retain their separate numeric weights. Otherwise the verified item/bonuses infobox weight is used for both contexts; no separate in-game measurement is claimed.',
      fieldPolicy: 'Infobox Item weight is primary. Numeric Infobox Bonuses weight is accepted only for an explicitly matching variant or one shared unsuffixed bonus template. Conflicting numeric facts are withheld. Each source records the exact field and suffix.',
      identityPolicy: 'All exact equippable cache candidate IDs must appear in Wiki infobox variants. Weights must agree across candidates, except explicit inventory/worn identities. Missing facts stay unresolved.' },
    summary, records, unresolved };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const cache = option('--cache', 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-2026-10-08-v2');
  const [reference, comparison, items, wikiSnapshot] = await Promise.all([
    option('--reference', 'rs3-chunkpicker-chunkinfo-export.json'), `${cache}/items.comparison.v1.json`, `${cache}/items.v1.json`, option('--snapshot', '.local/equipment-wiki.2026-10-08.v1.json')
  ].map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const artifact = buildEquipmentWeights({ equipment: reference.equipment, comparison, items, wikiSnapshot });
  const output = option('--output', 'app/data/equipment-weights.2026-10-08.v1.json');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(JSON.stringify(artifact.summary, null, 2));
}
