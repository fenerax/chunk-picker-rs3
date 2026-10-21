// Bounded current Wiki snapshots for retained exact labels. No cache/client reads.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { sourceInfobox, sourceIdentityName } from './lib/source-membership-evidence.mjs';
const dir = '.local/game-data/source-membership-2026-10-08-v1';
mkdirSync(dir, { recursive: true });
const definitions = JSON.parse(readFileSync('rs3-chunkpicker-chunkinfo-export.json'));
const resourceIdentities = JSON.parse(readFileSync('app/data/cache-resources.2026-10-08.v1.json'));
const npcIdentities = JSON.parse(readFileSync('app/data/cache-npcs.2026-10-08.v1.json'));
const requests = [];
const titleOf = text => text.split('#')[0].replaceAll('_', ' ').trim();
for (const [location, record] of Object.entries(definitions.chunks)) {
  if (!/^\d+$/.test(location)) requests.push({ kind: 'Area', source: location, title: titleOf(location) });
  const visit = record => {
    for (const kind of ['Monster', 'NPC', 'Shop', 'Object']) for (const source of Object.keys(record[kind] ?? {})) requests.push({ kind, source, title: titleOf(source) });
    for (const part of Object.values(record.Sections ?? {})) visit(part);
  };
  visit(record);
}
for (const [category, records] of Object.entries(definitions.challenges)) for (const [label, record] of Object.entries(records)) {
  const links = [...label.matchAll(/~\|([^|]+)\|~/g)].map(match => titleOf(match[1]));
  if (category === 'Quest') requests.push({ kind: 'Task', category, source: label, title: record.BaseQuest ?? links[0], quest: true });
  else if (category === 'Magic' && /^Cast /.test(label) || category === 'Prayer' && /prayer|curse/i.test(label)) requests.push({ kind: 'Task', category, source: label, title: links[0], method: true });
}
const unique = [...new Map(requests.filter(row => row.title).map(row => [`${row.kind}\0${row.category ?? ''}\0${row.source}`, row])).values()];
writeFileSync(`${dir}/requested-labels.json`, JSON.stringify(unique, null, 2) + '\n');
const titles = [...new Set(unique.map(row => row.title))].sort();
const chunks = Array.from({ length: Math.ceil(titles.length / 40) }, (_, i) => titles.slice(i * 40, (i + 1) * 40));
console.log(`Fetching ${titles.length} titles in ${chunks.length} bounded API batches`);
for (let i = 0; i < chunks.length; i++) {
  const path = `${dir}/batch-${String(i).padStart(3, '0')}.json`;
  if (existsSync(path)) continue;
  const url = new URL('https://runescape.wiki/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', redirects: '1', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: chunks[i].join('|') })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerMembershipReview/1.0 (bounded personal source audit)' } });
  if (!response.ok) throw new Error(`Wiki batch ${i}: HTTP ${response.status}`);
  const bytes = await response.text(); const data = JSON.parse(bytes);
  if (data.error) throw new Error(JSON.stringify(data.error));
  writeFileSync(path, bytes + '\n');
  console.log(`Fetched ${i + 1}/${chunks.length}`);
}
const pages = new Map(), aliases = new Map(), artifacts = [];
for (let i = 0; i < chunks.length; i++) {
  const path = `${dir}/batch-${String(i).padStart(3, '0')}.json`, bytes = readFileSync(path), data = JSON.parse(bytes);
  artifacts.push({ path, sha256: sha256(bytes) });
  for (const row of [...data.query.normalized ?? [], ...data.query.redirects ?? []]) aliases.set(row.from, row.to);
  for (const page of Object.values(data.query.pages)) pages.set(page.title, page);
}
const resolve = title => { const seen = new Set(); while (aliases.has(title) && !seen.has(title)) { seen.add(title); title = aliases.get(title); } return title; };
const records = unique.map(row => {
  const page = pages.get(resolve(row.title)), revision = page?.revisions?.[0], box = sourceInfobox(revision?.slots.main['*'] ?? '');
  const allowed = { Monster: ['Monster'], NPC: ['NPC'], Shop: ['Shop'], Object: ['Scenery'], Area: ['Location', 'Area'], Task: row.quest ? ['Quest'] : ['Prayer', 'Spell'] }[row.kind];
  const sourceKind = row.kind !== 'Task';
  const exactIdentity = box?.names.some(name => sourceIdentityName(name) === sourceIdentityName(titleOf(row.source)));
  // Generic scenery labels are not globally unique. Restrict Objects only when
  // exact Wiki IDs independently match a typed natural-resource definition.
  const resources = row.kind === 'Object' ? resourceIdentities.definitions.filter(candidate => box?.ids.includes(candidate.objectId)
    && sourceIdentityName(candidate.name) === sourceIdentityName(titleOf(row.source))
    && candidate.classKeys.some(key => /^(tree|ore):/.test(key) && !key.includes(':unknown'))) : [];
  const monsterIds = row.kind === 'Monster' ? (npcIdentities.records[row.source]?.candidates ?? []).map(candidate => candidate.id).filter(id => box?.ids.includes(id)) : [];
  const reviewedIdentity = resources.length > 0 || monsterIds.length > 0;
  const ambiguousIdentity = sourceKind && (!exactIdentity || row.kind === 'Object' && !resources.length || box?.ambiguous && !reviewedIdentity);
  const members = !ambiguousIdentity && box && allowed.includes(box.type) ? box.members : null;
  return { ...row, members, status: ambiguousIdentity ? 'identity-unresolved' : members === null ? 'unresolved' : 'verified-infobox', ...(sourceKind ? { identity: reviewedIdentity ? 'exact-Wiki-and-reviewed-cache-definition-IDs' : ambiguousIdentity ? 'generic-name-redirect-or-disambiguation-needs-placement-review' : 'exact-infobox-name', ...(resources.length ? { identityEvidence: { objectIds: resources.map(candidate => candidate.objectId), classKeys: [...new Set(resources.flatMap(candidate => candidate.classKeys))] } } : {}), ...(monsterIds.length ? { identityEvidence: { npcIds: monsterIds } } : {}) } : {}), wiki: revision ? { title: page.title, revisionId: revision.revid, revisionTimestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, infobox: box?.type ?? null, memberValues: box?.fields ?? [] } : null };
});
// A free quest's exact authored location contradicts a blanket member-region
// claim. The region may contain both free and member rooms: do not grant new
// access, but withhold the global ban until a precise room policy is reviewed.
const freeQuestAreas = new Map();
for (const row of records) if (row.kind === 'Task' && row.category === 'Quest' && row.members === false && row.status === 'verified-infobox') {
  for (const area of definitions.challenges.Quest[row.source]?.Chunks ?? []) if (typeof area === 'string' && !/^\d/.test(area)) {
    const evidence = freeQuestAreas.get(area) ?? [];
    evidence.push({ category: row.category, label: row.source, wiki: row.wiki });
    freeQuestAreas.set(area, evidence);
  }
}
for (const row of records) if (row.kind === 'Area' && freeQuestAreas.has(row.source)
  && row.wiki?.memberValues.some(value => /^(yes|true)$/i.test(value))) {
  row.members = null;
  row.status = 'membership-contradiction';
  row.identity = 'named-region-has-pinned-free-quest-locations-needs-room-policy';
  row.freeQuestEvidence = freeQuestAreas.get(row.source);
}
const dataset = { schemaVersion: 1, verifiedOn: '2026-10-08', policy: 'Exact runtime labels; only typed canonical Infobox consensus membership values authorize a source policy. Unknown/mixed membership is unresolved. Area geography never determines source membership. No source placements, drops, quantities, or live player facts are inferred.', counts: { requestedLabels: unique.length, requestedTitles: titles.length, verifiedMembers: records.filter(row => row.members === true).length, verifiedFree: records.filter(row => row.members === false).length, unresolved: records.filter(row => row.members === null).length }, records };
const reference = { path: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(readFileSync('rs3-chunkpicker-chunkinfo-export.json')) };
const generators = ['scripts/review-source-membership.mjs', 'scripts/lib/source-membership-evidence.mjs', 'scripts/lib/provenance-hash.mjs'].map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) }));
const identityInputs = ['app/data/cache-resources.2026-10-08.v1.json', 'app/data/cache-npcs.2026-10-08.v1.json'].map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) }));
writeFileSync(`${dir}/manifest.json`, JSON.stringify({ verifiedOn: dataset.verifiedOn, counts: dataset.counts, reference, generators, requests: { path: `${dir}/requested-labels.json`, sha256: sha256(readFileSync(`${dir}/requested-labels.json`)) }, artifacts }, null, 2) + '\n');
dataset.provenance = { reference, generators, identityInputs, snapshotManifest: { path: `${dir}/manifest.json`, sha256: sha256(readFileSync(`${dir}/manifest.json`)) } };
writeFileSync('app/data/source-membership.2026-10-08.v1.json', JSON.stringify(dataset, null, 2) + '\n');
console.log(dataset.counts);
