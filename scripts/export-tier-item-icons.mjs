#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseEquipmentWikiPage, hasWikiFieldConflict } from './research/equipment-wiki.mjs';
import { inventoryImageFile, inventoryByteProvenance, wikiQuery, ITEM_ICON_HASH_SCOPES } from './export-item-icons.mjs';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';

const VERSION = '2026-10-09.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const tierName = /^(Death guard|Skull lantern|Deathwarden (?:hood|robe top|robe bottom|gloves|boots)) \(tier ([1-9]0)\)$/u;

/** A bounded artwork-only review. A tier-qualified page, short infobox name,
 * matching bonuses tier and image agreement across ALL states are required.
 * No game ID is assigned and a bare family name is never made an alias.
 */
export function selectTierInventoryImage(name, parsed) {
  const match = tierName.exec(name);
  if (!match || parsed.missing || parsed.title !== name || !parsed.revisionId) return { reason: 'unreviewed-tier-page' };
  if (!parsed.items.length || parsed.items.some(item => item.name !== match[1]
    || hasWikiFieldConflict(item, ['name', 'id', 'image', 'version', 'bucketname']))) return { reason: 'conflicting-tier-item-identity' };
  if (!parsed.bonuses.length || parsed.bonuses.some(bonus => bonus.fields.tier !== match[2]
    || hasWikiFieldConflict(bonus, ['tier', 'version', 'bucketname']))) return { reason: 'conflicting-tier-bonuses' };
  const files = parsed.items.map(item => inventoryImageFile(item.fields.image));
  if (files.some(file => !file) || new Set(files).size !== 1) return { reason: 'ambiguous-tier-inventory-image' };
  return { fileTitle: files[0], identityMethod: 'reviewed-tier-page-shared-artwork', infoboxName: match[1], tier: Number(match[2]), itemPage: parsed.source,
    variants: parsed.items.map(item => ({ suffix: item.suffix, version: item.version, name: item.name, ids: item.ids, image: item.fields.image })),
    bonuses: parsed.bonuses.map(bonus => ({ suffix: bonus.suffix, tier: bonus.fields.tier })) };
}

export async function exportTierItemIcons({ reference, snapshot, assets, manifest, evidence }) {
  for (const file of [manifest, join(assets, 'manifest.json'), evidence]) {
    try { await access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Finalized output exists; choose a new version: ${file}`);
  }
  const referenceBytes = await readFile(reference), snapshotBytes = await readFile(snapshot);
  const definitions = JSON.parse(referenceBytes), retained = JSON.parse(snapshotBytes);
  const pages = new Map(retained.pages.map(page => [page.title, page]));
  const names = Object.keys(definitions.equipment).filter(name => tierName.test(name)).sort();
  const selections = {}, unmatched = [];
  for (const name of names) {
    const parsed = parseEquipmentWikiPage(pages.get(retained.resolutions[name] ?? name));
    const selection = selectTierInventoryImage(name, parsed);
    if (selection.reason) unmatched.push({ name, reason: selection.reason }); else selections[name] = selection;
  }
  const fileTitles = [...new Set(Object.values(selections).map(value => value.fileTitle))];
  const filePages = [], resolutions = {};
  for (let offset = 0; offset < fileTitles.length; offset += 40) {
    const titles = fileTitles.slice(offset, offset + 40);
    const result = await wikiQuery({ titles: titles.join('|'), redirects: 1, prop: 'imageinfo|revisions', iiprop: 'url|size|timestamp|sha1|mime', rvprop: 'ids|timestamp|content', rvslots: 'main' });
    filePages.push(...result.pages ?? []);
    const aliases = new Map([...(result.normalized ?? []), ...(result.redirects ?? [])].map(value => [value.from, value.to]));
    for (const title of titles) { let target = title; const seen = new Set(); while (aliases.has(target) && !seen.has(target)) { seen.add(target); target = aliases.get(target); } resolutions[title] = target; }
  }
  await mkdir(assets, { recursive: true }); await mkdir(dirname(manifest), { recursive: true }); await mkdir(dirname(evidence), { recursive: true });
  const fileMap = new Map(filePages.map(page => [page.title, page])), downloads = new Map();
  for (const fileTitle of fileTitles) {
    const page = fileMap.get(resolutions[fileTitle]), info = page?.imageinfo?.[0], revision = page?.revisions?.[0];
    const content = revision?.slots?.main?.content ?? '';
    if (!info || info.mime !== 'image/png' || !/\{\{\s*Inventory license\b/iu.test(content)) throw new Error(`Missing inventory licence/PNG: ${fileTitle}`);
    const response = await fetch(info.url, { headers: { 'User-Agent': 'RS3ChunkPickerTierIcons/1.0 (private artwork evidence audit)' }, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Inventory HTTP ${response.status}: ${fileTitle}`);
    const bytes = Buffer.from(await response.arrayBuffer()), sha256 = hash(bytes), file = `item-${sha256.slice(0, 24)}.png`;
    const getResponseHeaders = Object.fromEntries(['content-type', 'content-length', 'etag', 'last-modified', 'cf-polished'].map(key => [key, response.headers.get(key)]).filter(([,value]) => value != null));
    const byteProvenance = inventoryByteProvenance(bytes, info, getResponseHeaders);
    try { await writeFile(join(assets, file), bytes, { flag: 'wx' }); } catch (error) {
      if (error.code !== 'EEXIST' || hash(await readFile(join(assets, file))) !== sha256) throw error;
    }
    downloads.set(fileTitle, { file, width: info.width, height: info.height, bytes: bytes.length, sha256, aliases: [],
      source: { kind: 'wiki-inventory', fileTitle, filePageUrl: info.descriptionurl, fileRevisionId: revision.revid,
        fileRevisionUrl: `https://runescape.wiki/w/${encodeURIComponent(page.title.replace(/ /gu, '_'))}?oldid=${revision.revid}`,
        timestamp: info.timestamp, downloadedAt: new Date().toISOString(), url: info.url, ...byteProvenance, licenseTemplate: content.trim(),
        licenseNote: 'RuneScape inventory artwork; copyright Jagex Ltd. Wiki file page declares Inventory license. Private local use; no redistribution grant inferred.' } });
    await new Promise(done => setTimeout(done, 80));
  }
  const icons = {};
  for (const [name, selection] of Object.entries(selections)) {
    const image = downloads.get(selection.fileTitle);
    icons[name] = { ...image, source: { ...image.source, identityMethod: selection.identityMethod, requestedName: name, infoboxName: selection.infoboxName, tier: selection.tier, itemPage: selection.itemPage } };
  }
  const review = { schemaVersion: 1, version: VERSION, source: { snapshotSha256: hash(snapshotBytes), referenceSha256: sha256RepositoryText(referenceBytes), scope: '63 retained tier-qualified Necromancy equipment artwork names; no new cache IDs or aliases.' }, selections, unmatched,
    filePages: filePages.map(page => ({ title: page.title, pageid: page.pageid, revisions: page.revisions, imageinfo: page.imageinfo })) };
  const reviewBytes = JSON.stringify(review, null, 2) + '\n';
  const unique = new Map(Object.values(icons).map(icon => [icon.file, icon]));
  const bundle = { schemaVersion: 1, kind: 'items', version: VERSION, assetDirectory: `icons-items.${VERSION}`, generatedAt: new Date().toISOString(),
    source: { kind: 'wiki-inventory', reviewSha256: hash(reviewBytes), snapshotSha256: hash(snapshotBytes), hashScopes: ITEM_ICON_HASH_SCOPES,
      review: `docs/research/item-icon-review.${VERSION}.json`, selectionPolicy: 'Exact tier page and base infobox identity, explicit equal bonuses tier, all inventory state images agree. Artwork lookup only; no bare-name aliases or game IDs.' },
    icons, unmatched, coverage: { requested: names.length, mapped: Object.keys(icons).length, unmatchedRequested: unmatched.length }, uniqueFiles: unique.size, totalBytes: [...unique.values()].reduce((sum, icon) => sum + icon.bytes, 0) };
  await writeFile(evidence, reviewBytes, { flag: 'wx' });
  const bundleBytes = JSON.stringify(bundle, null, 2) + '\n';
  await writeFile(manifest, bundleBytes, { flag: 'wx' });
  await writeFile(join(assets, 'manifest.json'), bundleBytes, { flag: 'wx' });
  return bundle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (key, fallback) => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1]; };
  const result = await exportTierItemIcons({ reference: option('--reference', 'rs3-chunkpicker-chunkinfo-export.json'), snapshot: option('--snapshot', '.local/icon-evidence/equipment-wiki.2026-10-08.v1.json'),
    assets: option('--assets', '.local/map-assets/icons-items.' + VERSION), manifest: option('--manifest', 'app/data/item-icons.' + VERSION + '.json'), evidence: option('--evidence', 'docs/research/item-icon-review.' + VERSION + '.json') });
  console.log(JSON.stringify({ coverage: result.coverage, uniqueFiles: result.uniqueFiles, totalBytes: result.totalBytes }));
}
