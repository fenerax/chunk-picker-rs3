// Current metadata for known Monster policies, followed by changed-page content
// only. Produces a supplemental report; never modifies runtime policy or saves.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';
import { monsterInfoboxes } from './lib/monster-membership-evidence.mjs';
import { sourceIdentityName } from './lib/source-membership-evidence.mjs';
const dir = '.local/game-data/monster-current-membership-2026-10-12-v1';
mkdirSync(dir, { recursive: true });
const inputPath = 'app/data/source-membership.2026-10-08.v1.json';
const original = JSON.parse(readFileSync(inputPath));
const auditedPath = 'app/data/monster-membership-review.2026-10-12.v1.json';
const audited = new Map(JSON.parse(readFileSync(auditedPath)).knownAudit.map(row => [row.source, row]));
const policies = original.records.filter(row => row.kind === 'Monster' && row.members !== null);
for (const policy of policies) {
  const prior = audited.get(policy.source);
  if (prior?.members !== policy.members || prior.wiki.revisionId !== policy.wiki.revisionId
    || !['retained-pinned-consensus-audited', 'retained-free-ordinary-variants-with-mixed-family'].includes(prior.status)) throw new Error(`Missing verified pinned audit for ${policy.source}`);
}
const titles = [...new Set(policies.map(row => row.wiki.title))].sort();
writeFileSync(`${dir}/requests.json`, JSON.stringify({ titles, knownLabels: policies.length }, null, 2) + '\n');
const fetchBatch = async (name, parameters) => {
  const path = `${dir}/${name}.json`;
  if (!existsSync(path)) {
    const url = new URL('https://runescape.wiki/api.php');
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', prop: 'revisions', rvslots: 'main', ...parameters })) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerCurrentMonsterMembership/1.0 (bounded currentness audit)' }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const bytes = await response.text(), data = JSON.parse(bytes);
    if (data.error) throw new Error(JSON.stringify(data.error));
    writeFileSync(path, bytes + '\n');
    console.log(`Fetched ${name}`);
  }
  return { path, data: JSON.parse(readFileSync(path)) };
};
const current = new Map(), aliases = new Map(), artifacts = [];
for (let i = 0; i < Math.ceil(titles.length / 40); i++) {
  const result = await fetchBatch(`metadata-${String(i).padStart(3, '0')}`, { titles: titles.slice(i * 40, (i + 1) * 40).join('|'), redirects: '1', rvprop: 'ids|timestamp' });
  artifacts.push(result.path);
  for (const row of [...result.data.query.normalized ?? [], ...result.data.query.redirects ?? []]) aliases.set(sourceIdentityName(row.from), row.to);
  for (const page of Object.values(result.data.query.pages)) current.set(sourceIdentityName(page.title), page);
}
const resolve = title => {
  const seen = new Set();
  while (aliases.has(sourceIdentityName(title)) && !seen.has(title)) { seen.add(title); title = aliases.get(sourceIdentityName(title)); }
  return current.get(sourceIdentityName(title));
};
const changed = [...new Set(policies.flatMap(row => {
  const revision = resolve(row.wiki.title)?.revisions?.[0];
  return revision && revision.revid !== row.wiki.revisionId ? [revision.revid] : [];
}))].sort((a, b) => a - b);
const changedContent = new Map();
for (let i = 0; i < Math.ceil(changed.length / 40); i++) {
  const result = await fetchBatch(`changed-${String(i).padStart(3, '0')}`, { revids: changed.slice(i * 40, (i + 1) * 40).join('|'), rvprop: 'ids|timestamp|content' });
  artifacts.push(result.path);
  for (const page of Object.values(result.data.query.pages)) for (const revision of page.revisions ?? []) changedContent.set(revision.revid, { page, revision });
}
const rows = policies.map(row => {
  const page = resolve(row.wiki.title), revision = page?.revisions?.[0];
  let status = !revision ? 'current-page-missing' : revision.revid === row.wiki.revisionId ? 'current-revision-equals-audited-pin' : 'changed-revision-membership-consensus-preserved';
  let entities;
  if (revision && revision.revid !== row.wiki.revisionId) {
    const snapshot = changedContent.get(revision.revid);
    if (!snapshot) throw new Error(`Missing changed content for ${row.source}`);
    const boxes = monsterInfoboxes(snapshot.revision.slots.main['*']).filter(box => box.type === 'Monster');
    entities = boxes.map(box => ({ names: box.names, members: box.members, memberFields: box.memberFields }));
    const retainedName = sourceIdentityName(row.source.split('#')[0]);
    const matching = boxes.filter(box => box.names.includes(retainedName));
    if (!matching.length || boxes.some(box => box.members !== row.members)) status = row.source === 'Goblin' && boxes.some(box => box.members === false) && boxes.some(box => box.members === true)
      ? 'reviewed-ordinary-free-Goblin-with-mixed-family' : 'current-membership-or-identity-review-needed';
  }
  return { source: row.source, members: row.members, status, beforeWiki: row.wiki,
    currentWiki: revision ? { title: page.title, revisionId: revision.revid, revisionTimestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}` } : null,
    ...(entities ? { currentMonsterEntities: entities } : {}) };
});
const counts = { knownLabels: rows.length, canonicalTitles: titles.length, metadataBatches: Math.ceil(titles.length / 40), changedCanonicalRevisions: changed.length, changedContentBatches: Math.ceil(changed.length / 40), unchangedLabels: rows.filter(row => row.status === 'current-revision-equals-audited-pin').length, changedLabelsMembershipPreserved: rows.filter(row => row.status === 'changed-revision-membership-consensus-preserved').length, ordinaryGoblinMixed: rows.filter(row => row.source === 'Goblin').length, needsReview: rows.filter(row => ['current-page-missing', 'current-membership-or-identity-review-needed'].includes(row.status)).length };
const hashes = paths => paths.map(path => ({ path, sha256: sha256RepositoryText(readFileSync(path)) }));
const provenance = { inputs: hashes([inputPath, auditedPath]), generators: hashes(['scripts/audit-current-monster-membership.2026-10-12.v1.mjs', 'scripts/lib/monster-membership-evidence.mjs', 'scripts/lib/source-membership-evidence.mjs', 'scripts/lib/provenance-hash.mjs']), requests: { path: `${dir}/requests.json`, sha256: sha256(readFileSync(`${dir}/requests.json`)) }, artifacts: artifacts.map(path => ({ path, sha256: sha256(readFileSync(path)) })) };
const report = { schemaVersion: 1, verifiedOn: '2026-10-12', scope: 'Current canonical Wiki revisions for all 895 previously known exact Monster labels. Unchanged revisions reuse the complete pinned multi-entity audit; changed revisions receive a new typed Monster comparison. Metadata alone never supplies membership.', counts, rows, provenance };
writeFileSync('docs/research/monster-current-membership.2026-10-12.v1.json', JSON.stringify(report, null, 2) + '\n');
const escape = value => String(value ?? '').replaceAll('|', '&#124;').replaceAll('\n', ' ');
const table = rows.map(row => `| ${escape(row.source)} | ${row.members ? 'Member' : 'Free'} | [${row.beforeWiki.revisionId}](${row.beforeWiki.url}) | ${row.currentWiki ? `[${row.currentWiki.revisionId}](${row.currentWiki.url})` : 'Missing'} | ${row.status} |`).join('\n');
const doc = `# Current Monster membership verification — October 12, 2026

This supplemental check verifies current Wiki revisions for all 895 previously known Monster labels. It closes the difference between re-reading an old pinned revision and checking whether that revision is still current. The [full Monster review](monster-membership-review-2026-10-12.md) records the 304 formerly unknown labels, variants and identity limits.

The audit queried current revision metadata for ${titles.length} canonical titles in ${counts.metadataBatches} batches of at most 40 titles. ${changed.length} canonical pages had newer revisions than the prior pins. Only those changed revisions received content fetches, in ${counts.changedContentBatches} bounded batches. Unchanged revisions reuse the verified pinned multi-entity audit. Metadata itself does not decide membership.

| Result | Labels |
| --- | ---: |
| Current revision equals audited pin | ${counts.unchangedLabels} |
| New revision preserves typed Monster membership consensus | ${counts.changedLabelsMembershipPreserved} |
| Further membership/identity review needed | ${counts.needsReview} |

Goblin retains the explicit ordinary free policy and the known mixed-family limit from the full review. This currentness check does not convert its member subfamilies into free sources. A retained free policy still cannot waive location, quest, item or drop-row gates.

Run node scripts/audit-current-monster-membership.2026-10-12.v1.mjs to reproduce the supplemental report from the locally cached bounded snapshots. Snapshots under .local/game-data/monster-current-membership-2026-10-12-v1 preserve exact response hashes; the JSON report records input and generator hashes with repository LF normalization. The script writes this report and its companion JSON only. It does not change runtime policy or saved player state.

## All 895 current-revision decisions

| Retained label | Retained policy | Prior pinned revision | Current revision | Currentness decision |
| --- | --- | --- | --- | --- |
${table}
`;
writeFileSync('docs/research/monster-current-membership.2026-10-12.v1.md', doc);
console.log(JSON.stringify(counts, null, 2));
const needsReview = rows.filter(row => ['current-page-missing', 'current-membership-or-identity-review-needed'].includes(row.status));
if (needsReview.length) { console.log(JSON.stringify(needsReview, null, 2)); process.exitCode = 2; }
