#!/usr/bin/env node
// New evidence versions only. Reads retained definitions and public Wiki API;
// never opens any save, cache, server, or original picker.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { permanentTaskId } from '../../app/tasks/identity.mjs';

const root = resolve(import.meta.dirname, '../..');
const flag = process.argv.indexOf('--output');
if (flag < 0 || !process.argv[flag + 1]) throw new Error('Pass --output with a NEW versioned JSON path inside this worktree.');
const output = resolve(root, process.argv[flag + 1]);
const local = relative(root, output);
if (isAbsolute(local) || local === '..' || local.startsWith('..\\') || local.startsWith('../') || existsSync(output)) throw new Error('Output must be a new file inside this worktree.');
const referenceBytes = readFileSync(resolve(root, 'rs3-chunkpicker-chunkinfo-export.json'));
const definitions = JSON.parse(referenceBytes);
const specs = [
  ["War's Retreat", { entryAnyOf: [{ combatLevel: 60 }, { totalLevel: 1000 }], f2p: true }, '[[combat level]] 60 or [[total level]] 1,000'],
  ["War's Retreat Teleport", { totalBossKills: 10, differentBossesRequired: false, magicLevel: 0, f2p: true }, '10 total boss kills'],
  ["War's Wares", { bossKillsConsumed: false }, 'you do not lose your kill count'],
  ["Template:War's Wares stock", { hubTeleportBossKills: 10 }, 'sell=10|threshold=yes'],
  ['On the Warpath', { achievementCombatLevel: 60, recommendationIsAchievementTarget: true }, '{{Skillreq|Combat|60}}'],
  ['Black mask', { combatLevel: 40, defence: 10, strength: 20 }, '{{sc|combat|40}}'],
  ['Turael', { noCombatUnlockRequirement: true }, 'There are no [[Slayer]] or combat level requirement'],
  ['Jacquelyn', { minimumAccountCombat: 3, combatUnlockRequirementNotStated: true }, "'''Jacquelyn Manslaughter'''"],
  ['Vannaka', { combatLevel: 30 }, '[[combat level]] of 30 or higher'],
  ['The Raptor', { combatLevel: 35 }, '[[combat level]] 35'],
  ['Mazchna', { combatLevel: 50 }, '[[combat level]] of 50 or above'],
  ['Chaeldar', { combatLevel: 75 }, '[[combat level]] of at least 75'],
  ['Sumona', { combatLevel: 90, slayer: 35 }, '90 Combat and 35 Slayer'],
  ['Duradel', { combatLevel: 100, slayer: 50 }, '100 combat'],
  ['Kuradal', { combatLevel: 110, slayer: 75 }, '[[combat level]] of 110 or more'],
  ['Morvran', { combatLevel: 120, slayer: 85 }, '[[combat level]] of 120'],
  ['Mandrith', { combatLevel: 120, slayer: 95, retainedCombatMirrorSlayerMismatch: 85 }, 'level 95 [[Slayer]]'],
  ['Laniakea', { combatLevel: 120, slayer: 90 }, 'level 120 [[Combat level|Combat]]'],
  ['Soul Reaper', { combatLevel: 50, slayer: 45 }, 'Soul Reaper assignments require level 45 Slayer'],
  ['Yes, My Master', { combatLevel: 100 }, '{{Skillreq|Combat|100}}'],
  ['Ten in a Row', { combatLevel: 100 }, '{{Skillreq|Combat|100}}'],
  ['Can I Have Some Morvran?', { combatLevel: 120 }, '{{Skillreq|Combat|120}}'],
  ['Challenge Vannaka', { combatLevel: 30 }, '{{Skillreq|Combat|30}}'],
  ['I Presume These Rewards Are Mine, Death?', { combatLevel: 80 }, '{{Skillreq|Combat|80}}'],
  ['Keeping Up with the Carnilleans', { combatLevel: 120 }, '{{Skillreq|Combat|120}}'],
  ['Lamp of Luxury', { combatLevel: 80 }, '{{Skillreq|Combat|80}}'],
  ['Supply and Demand', { combatLevel: 18 }, '{{Skillreq|Combat|18}}'],
  ['Order of Slayers', { combatLevel: 120 }, '{{Skillreq|Combat|120}}'],
  ['A-Voiding Conflict', { combatLevel: 35 }, '{{Skillreq|Combat|35}}'],
  ['Conquest Adore', { combatLevel: 55 }, '{{Skillreq|Combat|55}}'],
  ["Warriors' Guild", { combinedAttackStrength: 130, attackOrStrengthMastery: 99, retained65EachOverconstrains: true }, 'either a combined [[Attack]] and [[Strength]] level of 130'],
];
const url = new URL('https://runescape.wiki/api.php');
url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main', titles: specs.map(row => row[0]).join('|') });
const response = await fetch(url, { headers: { 'User-Agent': 'RS3ChunkPickerRequirementAudit/1.0 (bounded public metadata verification)' } });
if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
const data = await response.json();
const pages = new Map(data.query.pages.map(page => [page.title, page]));
const wiki = specs.map(([title, facts, required]) => {
  const revision = pages.get(title)?.revisions?.[0];
  const content = revision?.slots?.main?.content;
  if (!content?.includes(required)) throw new Error(`Verify changed or missing Wiki fact: ${title}: ${required}`);
  return { title, revisionId: revision.revid, timestamp: revision.timestamp, url: `https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, contentSha256: sha256(content), facts };
});
const pageTitleFor = (category, label) => {
  if (/War's retreat/.test(label)) return "War's Retreat";
  if (/black mask/.test(label)) return 'Black mask';
  if (/Reaper assignment/.test(label)) return 'Soul Reaper';
  if (/slayer assignment/.test(label)) return /~\|([^|]+)\|~/.exec(label)?.[1];
  const title = label.slice(label.indexOf('|~') + 2).trim();
  if (title === 'Can I Have Some Morvran') return 'Can I Have Some Morvran?';
  if (title === 'I Presume These Rewards are Mine, Death?') return 'I Presume These Rewards Are Mine, Death?';
  return title;
};
const combatAudit = [], recommendationTextAudit = [];
let retainedRows = 0, numericRequirementFields = 0;
for (const [category, rows] of Object.entries(definitions.challenges)) for (const [label, record] of Object.entries(rows)) {
  retainedRows++;
  numericRequirementFields += Number(typeof record.Level === 'number') + ['Skills', 'SkillsNeeded', 'Requirements'].reduce((sum, field) => sum + Object.values(record[field] ?? {}).filter(value => typeof value === 'number').length, 0);
  const id = permanentTaskId(category, label, record);
  if (/recommend/i.test(label + JSON.stringify(record))) recommendationTextAudit.push({ category, label, id, decision: 'preserve',
    reason: category === 'Diary' ? 'Combat 60 is the actual achievement objective, even though its description calls this the recommended entry route.' : 'Recommendation wording belongs to the clue text; this row has no numeric level or skill gate.',
    ...(category === 'Diary' ? { wikiTitle: 'On the Warpath' } : {}),
  });
  const values = category === 'Combat' ? { Level: record.Level } : Object.fromEntries(['Skills', 'SkillsNeeded', 'Requirements'].filter(field => typeof record[field]?.Combat === 'number').map(field => [`${field}.Combat`, record[field].Combat]));
  if (!Object.keys(values).length) continue;
  const wikiTitle = pageTitleFor(category, label);
  if (!wiki.some(row => row.title === wikiTitle)) throw new Error(`No audit pin: ${category}: ${label}`);
  combatAudit.push({ category, label, id, retainedValues: values, wikiTitle, decision: /War's retreat/.test(label) ? 'correct-entry-alternatives' : 'preserve-combat-gate' });
}
const category = 'Combat', label = "Get access to ~|War's retreat|~", record = definitions.challenges[category][label];
const description = "Enter War's Retreat with either Combat level 60 or total skill level 1,000. The separate War's Retreat Teleport unlock requires 10 total boss kills and unlocking it from War's Wares; it does not require five different bosses. Entry does not unlock the teleport.";
const corrections = [{ category, label, id: permanentTaskId(category, label, record), beforeRecordSha256: sha256(JSON.stringify(record)), rationale: 'Combat 60 is a genuine entry option, but the retained record omitted the total-level alternative. Boss kills unlock the separate teleport, not entry.', changes: [
  { field: 'Level', beforePresent: true, before: 60, after: 1 },
  { field: 'RequirementAlternatives', beforePresent: false, before: null, after: [{ Skills: { Combat: 60 } }, { TotalLevelNeeded: 1000 }] },
  { field: 'Description', beforePresent: false, before: null, after: description },
] }];
const bundle = { schemaVersion: 1, reviewedOn: '2026-10-09', provenance: { reference: 'rs3-chunkpicker-chunkinfo-export.json', referenceSha256: sha256RepositoryText(referenceBytes), referenceHashMode: 'git-lf', generator: 'scripts/research/retained-task-requirements.mjs', generatorSha256: sha256RepositoryText(readFileSync(import.meta.filename)), method: 'Retained recommendation-text sweep, every numeric Combat gate, and explicit current public Wiki requirements; no source data, cache or save mutations.' }, wiki, corrections, audit: { retainedRows, numericRequirementFields, combatGateRows: combatAudit.length, recommendationTextRows: recommendationTextAudit.length, confirmedRecommendationAsRequirement: [], combatAudit, recommendationTextAudit, adjacentFindings: [
  { category: 'Attack/Strength', label: "Gain access to the ~|Warriors' Guild|~", decision: 'document-only', reason: '65 Attack AND 65 Strength is sufficient but overconstrains the true combined-130 or 99-in-either entry alternatives; not a recommendation-as-requirement issue.', wikiTitle: "Warriors' Guild" },
  { category: 'Combat', label: 'Receive a slayer assignment from ~|Mandrith|~', decision: 'document-only', reason: 'Its Combat 120 gate is genuine. This mirror has Slayer 85 while the Slayer row/current master require 95; separate retained mismatch.', wikiTitle: 'Mandrith' },
], limitations: ['The text scan covers every retained row, but external requirement evidence covers numeric Combat gates and the named Warriors Guild rows. It does not certify every numeric requirement in the whole catalogue.', 'Boss kill counts are not modelled as saved personal facts by this correction. Teleport usability still requires separate personal confirmation; an access task never grants it.', 'Turael and Jacquelyn Combat 3 are the account minimum, not an additional unlock requirement.'] } };
writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, corrections: corrections.length, combatGateRows: combatAudit.length, wikiPins: wiki.length, recommendationTextRows: recommendationTextAudit.length }));
