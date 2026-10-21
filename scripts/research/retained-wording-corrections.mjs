#!/usr/bin/env node
// Bounded wording review: one public Wiki revision and one retained diary row.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { permanentTaskId } from '../../app/tasks/identity.mjs';

const root = resolve(import.meta.dirname, '../..');
const flag = process.argv.indexOf('--output');
if (flag < 0 || !process.argv[flag + 1]) throw new Error('Pass --output with a NEW versioned JSON path.');
const output = resolve(root, process.argv[flag + 1]);
const local = relative(root, output);
if (isAbsolute(local) || local === '..' || local.startsWith('..\\') || local.startsWith('../') || existsSync(output)) throw new Error('Output must be a new file inside this worktree.');
const bytes = readFileSync(resolve(root, 'rs3-chunkpicker-chunkinfo-export.json'));
const definitions = JSON.parse(bytes);
const specs = [
  ['Kitchen Aid', { f2p: true, anyPlayerFeedsTeammate: true, ironmanFamiliarAlternative: true }, ["''All players:'' feed a teammate some food", "''Ironmen only:'' attempt to feed a [[Dungeoneering/Summoning#Familiars"]],
];
const url = new URL('https://runescape.wiki/api.php');
url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: specs.map(row => row[0]).join('|') });
const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerRequirementAudit/1.0 (bounded public metadata verification)' }, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
const data = await response.json();
const pages = new Map(data.query.pages.map(page => [page.title, page]));
const wiki = specs.map(([title, facts, required]) => {
  const revision = pages.get(title)?.revisions?.[0];
  const content = revision?.slots?.main?.content;
  if (!content || required.some(text => !content.includes(text)) || !/members\s*=\s*no/i.test(content)) throw new Error(`Verify changed or missing Wiki fact: ${title}`);
  console.log(`${title}: ${revision.revid}\n${content.split('\n').filter(line => /members|teammate|familiar/i.test(line)).join('\n')}`);
  return { title, revisionId: revision.revid, timestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, contentSha256: sha256(content), facts };
});
const change = (record, field, after) => ({ field, beforePresent: Object.hasOwn(record, field), before: record[field] ?? null, after });
const correction = (category, label, rationale, values) => {
  const record = definitions.challenges[category][label];
  return { category, label, id: permanentTaskId(category, label, record), beforeRecordSha256: sha256(JSON.stringify(record)), rationale, changes: Object.entries(values).map(([field, after]) => change(record, field, after)) };
};
const corrections = [correction('Diary', '~|Daemonheim Achievements#Easy|~ Kitchen Aid', 'The retained text is only the Ironman variant and reads as members-only Summoning. Every player, Ironmen included, can instead feed a teammate inside a floor.', {
  Description: 'Feed your teammate some food to heal them inside a Dungeoneering floor. (Ironmen may instead try to feed a Dungeoneering familiar, which needs members-only Summoning.)',
})];
const bundle = { schemaVersion: 1, reviewedOn: '2026-10-12', provenance: {
  reference: 'rs3-chunkpicker-chunkinfo-export.json', referenceSha256: sha256RepositoryText(bytes), referenceHashMode: 'git-lf',
  generator: 'scripts/research/retained-wording-corrections.mjs', generatorSha256: sha256RepositoryText(readFileSync(import.meta.filename)),
  method: 'Bounded public Wiki API review of Kitchen Aid; generated exact-record Description overlay. No save or source export mutations.',
}, wiki, corrections };
writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote ${local}`);
