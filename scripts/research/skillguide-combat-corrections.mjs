#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
const acceptTitles = new Set(['Sacrifice', 'Transfigure', 'Ingenuity of the Humans', 'Limitless', "Slayer's Insight", "Kuradal's Favour", 'Dragon Slayer (ability)', 'Undead Slayer (ability)', 'Greater Sonic Wave', 'Living Death']);
const aliases = { 'Dragon Slayer (ability)': 'Dragon Slayer', 'Demon Slayer (ability)': 'Demon Slayer', 'Undead Slayer (ability)': 'Undead Slayer' };
export function buildCombatCorrections({ reference, dataset, comparison, wikiPages }) {
  const validations = wikiPages.map(page => {
    const revision = page.revisions?.[0], text = revision?.slots?.main?.['*'] ?? '';
    const runeEntries=[...text.matchAll(/^\|rune(\d+)\s*=\s*([^\n]+)$/gm)].map(m=>({name:m[2].trim(),quantity:Number(text.match(new RegExp('^\\|rune'+m[1]+'qty\\s*=\\s*(\\d+)','m'))?.[1]??1)}));
    return { title: page.title, pageId: page.pageid, revisionId: revision?.revid ?? null, timestamp: revision?.timestamp ?? null,
      url: `https://runescape.wiki/w/${encodeURIComponent(page.title.replaceAll(' ','_'))}?oldid=${revision?.revid}`,
      ids: [...text.matchAll(/^\|id\s*=\s*(\d+)/gm)].map(m=>Number(m[1])),
      levels: [...text.matchAll(/^\|level\s*=\s*(\d+)/gm)].map(m=>Number(m[1])),
      cooldowns: [...text.matchAll(/^\|cooldown\s*=\s*(\d+)/gm)].map(m=>Number(m[1])),
      removal: /^\|removal\s*=/m.test(text), sourceContentSha256: sha256(text),
      proseLevel10Conflict: /requires level 10.*Constitution/i.test(text),
      members: /^\|members\s*=\s*Yes\s*$/mi.test(text)?true:/^\|members\s*=\s*No\s*$/mi.test(text)?false:null,
      book: text.match(/^\|spellbook\s*=\s*([^\n]+)$/m)?.[1].trim()??null,runeEntries,
      fieldValidation: 'Current raw revision infobox + matching struct ID; prose checked for contradictory numeric claim. Units and unlocks remain separate.' };
  });
  const fieldValidations=validations.map(w=>{const action=dataset.actions.find(a=>w.ids.includes(a.id));if(!action)return null;
    const costs=action.runeCosts?.map(r=>({name:r.item.name,quantity:r.quantity}))??[];
    return {title:w.title,revisionId:w.revisionId,url:w.url,id:action.id,cache:{members:action.members??null,book:action.book??null,runes:costs},wiki:{members:w.members,book:w.book,runes:w.runeEntries},
      variantAmbiguous:w.ids.length>1,
      membersAgree:w.ids.length>1||w.members===null||action.members==null?null:w.members===action.members,
      bookAgree:w.ids.length>1||w.book===null||action.book==null?null:w.book===action.book,
      runeCostsAgree:w.ids.length>1||!w.runeEntries.length?null:w.runeEntries.length===costs.length&&w.runeEntries.every(r=>costs.some(c=>c.name.toLowerCase()===r.name.toLowerCase()&&c.quantity===r.quantity))};}).filter(Boolean);
  const corrections = [], reviewedCandidates = [];
  for (const candidate of comparison.comparisons.filter(c=>c.status === 'disagrees' || c.status === 'ambiguous' || c.status === 'missing-level')) {
    const action = candidate.candidates.length === 1 ? dataset.actions.find(a=>a.id === candidate.candidates[0].id) : null;
    const wiki = validations.find(w=>action && w.ids.includes(action.id));
    const approved = candidate.status === 'disagrees' && wiki && acceptTitles.has(wiki.title) && wiki.levels.length === 1 && wiki.levels[0] === action.level && !wiki.removal && !wiki.proseLevel10Conflict;
    reviewedCandidates.push({ ...candidate, decision: approved ? 'accepted numeric correction' : 'retained',
      reason: approved ? 'Explicit action requirement agrees with current Wiki infobox, matching struct ID and prose' : wiki?.proseLevel10Conflict ? 'Wiki infobox and prose conflict' : candidate.status !== 'disagrees' ? 'Ambiguous variant or missing explicit level; no automatic join' : 'No corroborated consistent Wiki field', wiki: wiki ?? null });
    if (!approved) continue;
    const original = reference.challenges[candidate.skill][candidate.label];
    corrections.push({ skill: candidate.skill, label: candidate.label, beforeRecordSha256: sha256(JSON.stringify(original)),
      changes: [{ field: 'Level', before: original.Level, after: action.level }],
      cache: { id: action.id, name: action.name, source: action.source, params: { skill: 2806, level: 2807 }, skillId: action.skillId, level: action.level },
      wiki, rationale: 'Action level only. Authored codex/items, quest gates, equipment and membership conditions retain their existing meaning.' });
  }
  return { schemaVersion: 1, reviewedAt: '2026-10-08', kind: 'reviewed-combat-task-numeric-corrections',
    defaultEnabled: false, ruleKey: 'tasks.cache-combat-corrections',
    scope: 'Level corrections only; no new task, identity, effect, XP, rune, access, equipment or membership replacement',
    corrections, validations, fieldValidations, fieldCounts:dataset.summary?.fieldCounts??null, families:dataset.summary?.families??null, reviewedCandidates,
    comparisonSummary: { taskCount: comparison.taskCount, statuses: comparison.statuses,membershipStatuses:comparison.membershipStatuses,membershipFlags:comparison.membershipFlags,runeNameStatuses:comparison.runeNameStatuses },
    membershipReviews:comparison.comparisons.filter(c=>c.membershipStatus==='disagrees').map(c=>({skill:c.skill,label:c.label,retainedMembership:c.retainedMembership,candidates:c.candidates,
      retainedItems:c.retainedItems,retainedSkills:c.retainedSkills,retainedTasks:c.retainedTasks,equipmentAssumptions:c.equipmentAssumptions,
      decision:'retain all authored membership flags and item/quest/equipment gates',reason:'Cache action flag alone does not establish complete authored task eligibility; action-specific gates require independent review'})),
    runeNameDifferences:comparison.comparisons.filter(c=>c.runeNameComparison?.status==='plain-name-difference').map(c=>({skill:c.skill,label:c.label,...c.runeNameComparison,decision:'retain authored inputs; no quantity, substitution or consumption equivalence assumed'})),
    limits: ['Old combat definitions survive in cache (Slice removed per Wiki). Definition presence cannot certify availability.',
      'Demon Slayer level withheld because current Wiki infobox1 contradicts prose10.',
      'House Teleport and Spectral Scythe variants are not collapsed. Encoded rune costs are extracted through helper18436; runtime substitutions, free casts and scaling remain unknown.',
      'Six targeted helper bodies count-validated; broad clientscript execution remains unavailable. Spell rune runtime gate18411 depends on player state.',
      '61 quest-related unlock texts retained; no action params typed as direct quest IDs. One typed item reference retained without assuming consumption.'] };
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,s)=>i%2?a:[...a,[v.replace(/^--/,''),s[i+1]]],[]));
  if (!args.export || !args.wiki) throw new Error('Required --export combat-output-directory --wiki scratch-directory');
  const root = resolve(import.meta.dirname,'../..'), source = name => readFileSync(join(args.export,name));
  const referenceBytes = readFileSync(join(root,'rs3-chunkpicker-chunkinfo-export.json'));
  const wikiFiles = ['samples','candidates','slayer','last','fields'].map(s=>join(args.wiki,`skillguide-combat-wiki-${s}.json`));
  const wikiPages = wikiFiles.flatMap(path=>Object.values(JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/, '')).query.pages));
  const result = buildCombatCorrections({ reference: JSON.parse(referenceBytes), dataset: JSON.parse(source('combat.cache-2026-10-08.v1.json')),
    comparison: JSON.parse(source('combat-retained-comparison.2026-10-08.v1.json')), wikiPages });
  result.provenance = { referenceSha256: sha256RepositoryText(referenceBytes), referenceHashScope: 'repository text normalized CRLF to LF',
    cacheManifest: { file: 'combat-manifest.v1.json', sha256: sha256(source('combat-manifest.v1.json')) },
    cacheDataset: { file: 'combat.cache-2026-10-08.v1.json', sha256: sha256(source('combat.cache-2026-10-08.v1.json')) },
    generatorSha256: sha256RepositoryText(readFileSync(import.meta.filename)),
    extractorSha256: sha256RepositoryText(readFileSync(join(root,'scripts/cache/game-data-combat.mjs'))),
    overlaySha256: sha256RepositoryText(readFileSync(join(root,'app/data/skillguide-combat-corrections.mjs'))),
    wikiSources: wikiFiles.map(path=>({ path: path.replaceAll('\\','/'), sha256: sha256(readFileSync(path)) })) };
  const output = join(root,'app/data/skillguide-combat-corrections.2026-10-08.v1.json');
  writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,{flag:args.replace === 'true' ? 'w' : 'wx'});
  const report = join(root,'docs/research/skillguide-combat-review.2026-10-08.v1.json');
  writeFileSync(report,`${JSON.stringify({ ...result, corrections: result.corrections.map(c=>({skill:c.skill,label:c.label,changes:c.changes,cache:c.cache,wiki:c.wiki})) },null,2)}\n`,{flag:args.replace === 'true' ? 'w' : 'wx'});
  console.log(JSON.stringify({ corrections: result.corrections.length, reviewedCandidates: result.reviewedCandidates.length, output, report }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
