#!/usr/bin/env node
// Bounded H6 review: two public Wiki revisions and three retained task rows.
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
  ["Warriors' Guild", { combinedAttackStrength: 130, attackOrStrengthMastery: 99, boostsAllowed: false }, ['either a combined [[Attack]] and [[Strength]] level of 130', '99', 'boost']],
  ['Mandrith', { combatLevel: 120, slayer: 95 }, ['level 95 [[Slayer]]', '120']],
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
  if (!content || required.some(text => !content.includes(text))) throw new Error(`Verify changed or missing Wiki fact: ${title}`);
  console.log(`${title}: ${revision.revid}\n${content.split('\n').filter(line => /combined|99|boost|95.*Slayer|Slayer.*95|120/i.test(line)).join('\n')}`);
  return { title, revisionId: revision.revid, timestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, contentSha256: sha256(content), facts };
});
const guild = wiki.find(row => row.title === "Warriors' Guild").facts;
// Enumerate only non-mastery boundary pairs. Higher base levels satisfy a pair;
// either mastery clause covers the omitted 31/99 and 99/31 endpoints.
const minimumCombinedAttack = guild.combinedAttackStrength - (guild.attackOrStrengthMastery - 1);
const alternatives = [
  { Skills: { Attack: guild.attackOrStrengthMastery } },
  { Skills: { Strength: guild.attackOrStrengthMastery } },
  ...Array.from({ length: guild.attackOrStrengthMastery - minimumCombinedAttack }, (_, i) => ({ Skills: { Attack: i + minimumCombinedAttack, Strength: guild.combinedAttackStrength - (i + minimumCombinedAttack) } })),
];
const change = (record, field, after) => ({ field, beforePresent: Object.hasOwn(record, field), before: record[field] ?? null, after });
const correction = (category, label, rationale, values) => {
  const record = definitions.challenges[category][label];
  return { category, label, id: permanentTaskId(category, label, record), beforeRecordSha256: sha256(JSON.stringify(record)), rationale, changes: Object.entries(values).map(([field, after]) => change(record, field, after)) };
};
const corrections = ['Attack', 'Strength'].map(category => correction(category, "Gain access to the ~|Warriors' Guild|~", 'The retained 65 in each skill excludes uneven combined-130 and single-skill mastery entry options. Entry cannot be boosted.', {
  Level: 1, Skills: {}, RequirementAlternatives: alternatives,
  RequirementAlternativesDescription: 'Attack + Strength 130, or Attack 99, or Strength 99 (base levels).',
  Description: "Enter the Warriors' Guild with base Attack + Strength of at least 130, or base Attack 99, or base Strength 99. Temporary boosts do not count.",
}));
corrections.push(correction('Combat', 'Receive a slayer assignment from ~|Mandrith|~', 'The Combat mirror must match current Mandrith and the retained Slayer row: Combat 120 and Slayer 95.', { Skills: { Slayer: wiki.find(row => row.title === 'Mandrith').facts.slayer } }));
const bundle = { schemaVersion: 1, reviewedOn: '2026-10-12', provenance: {
  reference: 'rs3-chunkpicker-chunkinfo-export.json', referenceSha256: sha256RepositoryText(bytes), referenceHashMode: 'git-lf',
  generator: 'scripts/research/retained-entry-requirements.mjs', generatorSha256: sha256RepositoryText(readFileSync(import.meta.filename)),
  method: 'Bounded public Wiki API review of Warriors Guild and Mandrith; generated exact-record overlay for both guild mirrors and the Combat Mandrith mirror. No save or source export mutations.',
}, wiki, corrections, audit: { limitation: 'Three retained rows only; existing retained-task-requirements evidence remains an immutable historical audit.', guildAlternativeEncoding: 'Attack99 OR Strength99 OR boundary pairs Attack32..98 AND Strength(130−Attack). Existing NoBoost:true applies to every clause.' } };
writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, corrections: corrections.length, wikiPins: wiki.length, guildClauses: alternatives.length }));
