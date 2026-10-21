import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 as hash, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { pathToFileURL } from 'node:url';

const artifact = 'quests-achievements-2026-10-08-v2/achievements.v1.json';
const clean = value => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
// Explicit disambiguations discovered in current Wiki Otheruses/Disambig/achievement links.
const wikiTitles = new Map([
  [458, 'Breaking and Entering (achievement)'], [704, 'A Familiar Feeling (achievement)'],
  [715, 'Big Game Hunter (achievement)'], [742, 'Beachcomber (achievement)'],
  [956, 'What Lies Below? (Medium Varrock achievement)'],
  [3221, 'Collection of Zamorakian Notes (achievement)'], [2184, 'Mask of Dragith Nurn (achievement)'],
  [4995, 'The Tale of Hawthorn (achievement)'], [2545, 'The Archivist (achievement)'],
  [3328, 'City of Um (achievement)'], [4918, 'Wendlewick (achievement)'],
  [3153, 'The Infernal Sauce (achievement)'], [1751, 'Second Wind (achievement)'],
]);
const wikiTitle = record => wikiTitles.get(record.id) ?? clean(record.name);

// Split at top-level template pipes only, preserving nested requirement templates.
export function achievementInfoboxes(raw) {
  const result = [];
  const pattern = /\{\{Infobox Achievement\b/gi;
  let match;
  while ((match = pattern.exec(raw))) {
    let depth = 1, links = 0, start = pattern.lastIndex, cursor = start;
    const parts = [];
    for (; cursor < raw.length && depth; cursor++) {
      const pair = raw.slice(cursor, cursor + 2);
      if (pair === '{{') { depth++; cursor++; }
      else if (pair === '}}') {
        depth--;
        if (!depth) { parts.push(raw.slice(start, cursor)); break; }
        cursor++;
      } else if (pair === '[[') { links++; cursor++; }
      else if (pair === ']]') { links--; cursor++; }
      else if (raw[cursor] === '|' && depth === 1 && !links) { parts.push(raw.slice(start, cursor)); start = cursor + 1; }
    }
    if (depth) continue;
    const fields = Object.fromEntries(parts.filter(p => p.includes('=')).map(p => {
      const at = p.indexOf('='); return [p.slice(0, at).trim().toLowerCase(), p.slice(at + 1).trim()];
    }));
    result.push(fields);
    pattern.lastIndex = cursor + 2;
  }
  return result;
}

export function wikiVariant(raw, id) {
  const boxes = achievementInfoboxes(raw);
  const matches = [];
  for (const fields of boxes) {
    for (const [key, value] of Object.entries(fields)) {
      if (!/^id\d*$/.test(key) || Number(value) !== id) continue;
      const suffix = key.slice(2);
      const fieldKey = name => Object.hasOwn(fields, `${name}${suffix}`) ? `${name}${suffix}` : name;
      const get = name => fields[fieldKey(name)];
      const scoreRaw = get('score'), membersRaw = get('members');
      matches.push({ id, name: get('name'), score: /^\d+$/.test(scoreRaw ?? '') ? Number(scoreRaw) : null,
        members: /^yes$/i.test(membersRaw ?? '') ? true : /^no$/i.test(membersRaw ?? '') ? false : null,
        scoreRaw, membersRaw, suffix, idField: key, scoreField: fieldKey('score'), membersField: fieldKey('members') });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function run({ cacheDirectory, output, scratch = path.resolve('.local/metafix-research/achievement-wiki') }) {
  const retainedPath = path.resolve('rs3-chunkpicker-chunkinfo-export.json');
  const [retainedBytes, cacheBytes, comparisonBytes, manifestBytes] = await Promise.all([
    fs.readFile(retainedPath), fs.readFile(path.join(cacheDirectory, 'achievements.v1.json')),
    fs.readFile(path.join(cacheDirectory, 'quests-achievements.comparison.v1.json')),
    fs.readFile(path.join(cacheDirectory, 'quests-achievements.manifest.v1.json')),
  ]);
  const retained = JSON.parse(retainedBytes).challenges.Diary;
  const cache = JSON.parse(cacheBytes), comparison = JSON.parse(comparisonBytes);
  const records = new Map(cache.records.map(record => [record.id, record]));
  const rows = comparison.achievementRows;
  const candidates = rows.filter(row => row.status === 'unique-name').map(row => {
    const record = records.get(row.achievementIds[0]), raw = retained[row.label];
    const fields = [];
    if (raw.RuneScore !== record.runescore && (record.runescore !== null || Object.hasOwn(raw, 'RuneScore'))) fields.push('RuneScore');
    if (Boolean(raw['Not F2P']) === record.f2pFlag) fields.push('Not F2P');
    return { row, record, raw, fields };
  }).filter(candidate => candidate.fields.length);
  await fs.mkdir(scratch, { recursive: true });
  const titles = [...new Set(candidates.filter(c => !c.record.removed).map(c => wikiTitle(c.record)))];
  const pages = new Map();
  const retrieval = [];
  for (let offset = 0; offset < titles.length; offset += 40) {
    const batch = titles.slice(offset, offset + 40);
    const file = path.join(scratch, `wiki-${hash(batch.join('|')).slice(0,16)}.json`);
    let response;
    try {
      response = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Date.now() - Date.parse(response.fetchedAt) > 60 * 60 * 1000) throw new Error('Refresh stale Wiki snapshot');
    }
    catch {
      const params = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', redirects: '1', format: 'json', titles: batch.join('|') });
      const res = await fetch(`https://runescape.wiki/api.php?${params}`, { headers: { 'User-Agent': 'RS3ChunkPickerMetadataResearch/1.0 (read-only metadata verification)' } });
      if (!res.ok) throw new Error(`Wiki API ${res.status}`);
      response = { fetchedAt: new Date().toISOString(), data: await res.json() };
      if (response.data.error) throw new Error(JSON.stringify(response.data.error));
      await fs.writeFile(file, JSON.stringify(response));
    }
    const query = response.data.query;
    const aliases = new Map([...(query.normalized ?? []), ...(query.redirects ?? [])].map(v => [v.from, v.to]));
    const returned = new Map(Object.values(query.pages).map(page => [page.title, { ...page, fetchedAt: response.fetchedAt }]));
    for (const title of batch) {
      let key = title;
      const seen = new Set();
      while (aliases.has(key) && !seen.has(key)) { seen.add(key); key = aliases.get(key); }
      pages.set(title, returned.get(key));
    }
    retrieval.push({ fetchedAt: response.fetchedAt, requestedTitles: batch.length, revisionCount: Object.values(query.pages).filter(p => p.revisions).length });
    console.log(`Wiki batch ${offset / 40 + 1}: ${Math.min(offset + 40, titles.length)}/${titles.length}`);
  }
  const corrections = [], review = [];
  for (const row of rows.filter(row => row.status !== 'unique-name')) review.push({ category: 'Diary', label: row.label, status: row.status, cacheIds: row.achievementIds,
    ...(row.achievementIds.length ? { variants: row.achievementIds.map(id => {
      const record = records.get(id); return { id, name: clean(record.name), runescore: record.runescore, f2pFlag: record.f2pFlag, removed: record.removed };
    }) } : {}),
    reason: 'No unique cache identity; metadata remains authored.' });
  for (const {row,record,raw,fields} of candidates) {
    const page = pages.get(wikiTitle(record)), revision = page?.revisions?.[0];
    const variant = revision && wikiVariant(revision.slots.main['*'], record.id);
    const pending = [], changes = [];
    for (const field of fields) {
      const cacheValue = field === 'RuneScore' ? record.runescore : record.f2pFlag;
      const after = field === 'RuneScore' ? cacheValue : !cacheValue;
      const wikiValue = field === 'RuneScore' ? variant?.score : variant?.members;
      const wiki = revision ? { title: page.title, revisionId: revision.revid,
        url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`,
        achievementId: variant?.id ?? null,
        idField: variant?.idField ?? null,
        field: field === 'RuneScore' ? variant?.scoreField ?? 'score' : variant?.membersField ?? 'members',
        value: wikiValue ?? null,
        rawValue: (field === 'RuneScore' ? variant?.scoreRaw : variant?.membersRaw) ?? null } : null;
      const evidence = { field, before: raw[field] ?? null, after,
        cache: { artifact, id: record.id, field: field === 'RuneScore' ? 'runescore' : 'f2pFlag', value: cacheValue }, wiki };
      if (record.removed || cacheValue === null || !variant || wikiValue === null || wikiValue === undefined || wikiValue !== after) {
        pending.push({ ...evidence, status: record.removed ? 'removed-cache-record' : cacheValue === null ? 'missing-cache-field' : !variant ? 'wiki-id-unresolved' : wikiValue == null ? 'wiki-field-unresolved' : 'cache-wiki-disagreement' });
      } else changes.push(evidence);
    }
    if (changes.length) corrections.push({ category: 'Diary', label: row.label, changes });
    if (pending.length) review.push({ category: 'Diary', label: row.label, cacheIds: [record.id], status: 'metadata-review', fields: pending });
  }
  const countFields = list => Object.fromEntries(['RuneScore','Not F2P'].map(field => [field, list.flatMap(r => r.changes ?? r.fields ?? []).filter(change => change.field === field).length]));
  const evidence = { schemaVersion: 1, sources: {
    retained: { path: 'rs3-chunkpicker-chunkinfo-export.json', sha256: sha256RepositoryText(retainedBytes) },
    cache: { artifact, sha256: hash(cacheBytes), manifest: 'quests-achievements-2026-10-08-v2/quests-achievements.manifest.v1.json', manifestSha256: hash(manifestBytes),
      decoderCommit: cache.provenance.decoder.commit, buildSchema: cache.provenance.decoder.buildSchema, buildStatus: cache.provenance.decoder.buildStatus },
    comparison: { artifact: 'quests-achievements-2026-10-08-v2/quests-achievements.comparison.v1.json', sha256: hash(comparisonBytes) },
    discovery: { tool: 'Tavily search', query: 'site:runescape.wiki achievement RuneScore Members "Lumbridge Strikes Back"', checkedAt: '2026-10-08', urls: ['https://runescape.wiki/w/Combat_Mastery_achievements','https://runescape.wiki/w/List_of_achievements'] },
    wiki: { endpoint: 'https://runescape.wiki/api.php', retrieval, identity: 'Exact achievement ID in current raw Infobox Achievement; tier-specific score/members fields when explicitly present.' },
  }, coverage: { retainedDiaryRows: rows.length, uniqueCacheNameRows: rows.filter(r=>r.status==='unique-name').length,
    candidateRows: candidates.length, candidateFields: countFields(candidates.map(c=>({changes:c.fields.map(field=>({field}))}))),
    reportScoreMismatches: rows.filter(r=>r.metadata.some(m=>m.field==='runescore'&&m.status==='mismatch')).length,
    missingRetainedScoresCorrected: corrections.flatMap(r=>r.changes).filter(c=>c.field==='RuneScore'&&c.before===null).length,
    membershipAdded: corrections.flatMap(r=>r.changes).filter(c=>c.field==='Not F2P'&&c.after===true).length,
    f2pRestored: corrections.flatMap(r=>r.changes).filter(c=>c.field==='Not F2P'&&c.after===false).length,
    uniqueMatchedRemovedCacheRecords: rows.filter(r=>r.status==='unique-name'&&records.get(r.achievementIds[0]).removed).length,
    corrections: countFields(corrections), correctedRows: corrections.length, metadataReview: countFields(review),
    uniqueWikiTitlesQueried: titles.length, unresolvedIdentityRows: rows.filter(r=>r.status!=='unique-name').length,
    policy: 'Only differing RuneScore and direct Not F2P metadata with unique cache identity, nonremoved record, matching Wiki achievement ID and agreement between current revision and cache are corrected. Absent before is null; false after preserves explicit F2P metadata. All authored text, steps, requirements, relations and other fields remain untouched.' }, corrections, review };
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence.coverage));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map((value,index,arr) => value.startsWith('--') ? [value.slice(2),arr[index+1]] : null).filter(Boolean));
  if (!args.cache || !args.output) throw new Error('Required --cache DIRECTORY --output FILE');
  await run({ cacheDirectory: args.cache, output: args.output, scratch: args.scratch });
}
