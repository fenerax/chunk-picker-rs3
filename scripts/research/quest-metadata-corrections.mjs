#!/usr/bin/env node
// Research-only: read the pinned retained reference and copied extraction; write
// a review artifact in this worktree. This never imports application or duo state.
import { readFileSync, writeFileSync } from 'node:fs';
import { sha256 as hash, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const cacheRoot = 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/quests-achievements-2026-10-08-v2';
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const referencePath = resolve(root, 'rs3-chunkpicker-chunkinfo-export.json');
const reference = load(referencePath);
const quests = load(`${cacheRoot}/quests.v1.json`).records;
const achievements = load(`${cacheRoot}/achievements.v1.json`).records;
const comparison = load(`${cacheRoot}/quests-achievements.comparison.v1.json`);
const manifest = load(`${cacheRoot}/quests-achievements.manifest.v1.json`);
const records = reference.challenges.Quest;
const qById = new Map(quests.map(row => [row.id, row]));
const names = ["Beneath Scabaras' Sands", 'Princess and the Pauper', "Gertrude's Cat", "Benedict's World Tour (miniquest)", 'A Clockwork Syringe', 'Devious Minds', "Doric's Task II (miniquest)", 'Hunt for Red Raktuber', 'Tears of Guthix (quest)', 'Recipe for Disaster: Freeing Skrach Uglogwee', 'Cooked chompy', "Kili's Knowledge", "Kili's Knowledge VII", "Kili's Knowledge VII (power)", 'Kindred Spirits', 'Kili Row'];
const url = new URL('https://runescape.wiki/api.php');
Object.entries({ action:'query', prop:'revisions', rvprop:'ids|timestamp|content', rvslots:'main', format:'json', formatversion:'2', redirects:'1', titles:names.join('|') }).forEach(([key,value]) => url.searchParams.set(key,value));
const response = await fetch(url, { headers:{ 'User-Agent':'RS3ChunkPickerMetadataResearch/1.0 (bounded public wiki metadata verification)' } });
if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
const rawResponse = await response.text();
const pages = new Map(JSON.parse(rawResponse).query.pages.map(page => {
  if (!page.revisions?.length) throw new Error(`Missing Wiki revision: ${page.title}`);
  const revision = page.revisions[0], text = revision.slots.main.content;
  return [page.title, { title:page.title, revisionId:revision.revid, timestamp:revision.timestamp, url:`https://runescape.wiki/w/Special:PermanentLink/${revision.revid}`, contentSha256:hash(text), text }];
}));
const evidence = (title, field, value, snippet) => {
  const page = pages.get(title);
  if (!page || !page.text.includes(snippet)) throw new Error(`Wiki evidence missing: ${title}: ${snippet}`);
  return { title, revisionId:page.revisionId, url:page.url, field, value, snippet };
};
const corrections = [], review = [];
function add(label, change, rationale) {
  let correction = corrections.find(row => row.label === label);
  if (!correction) { correction = { category:'Quest', label, rationale, changes:[] }; corrections.push(correction); }
  correction.changes.push(change);
}
const cacheEvidence = (id, field, value, artifact='quests.v1.json') => ({ artifact, id, field, value });
const membership = comparison.questRows.filter(row => row.questIds.length === 1 && Boolean(records[row.label]['Not F2P'] ?? records[row.label].NotF2P) !== qById.get(row.questIds[0]).members);
const f2pItems = { '2a':'Fox pelt', '2b':'Toffee apple', '2c':'Package', '2g':'Crystal', '2i':'Toy ship', '2k':'Pipe', '2n':'Monocle', '2o':'Scarf', '2p':'Surgical mask' };
for (const row of membership) {
  const quest = qById.get(row.questIds[0]), record = records[row.label];
  if ([517,525].includes(quest.id)) {
    add(row.label, { field:'Not F2P', before:record['Not F2P'] ?? null, after:true, cache:cacheEvidence(quest.id,'members',true), wiki:evidence(row.name,'Infobox Quest.members',true,'|members = Yes') }, 'The quest is members-only in both sources; this row omitted its membership gate.');
  } else if (quest.id === 138) {
    add(row.label, { field:'Not F2P', before:true, after:false, cache:cacheEvidence(138,'members',false), wiki:evidence("Gertrude's Cat",'Quest details.members',false,'|members = No') }, 'Both sources identify Gertrude\'s Cat as F2P; these two retained steps alone incorrectly carried a membership gate.');
  } else if (quest.id === 436) {
    const suffix = row.label.slice(row.label.indexOf('|~')+2).trim();
    const item = f2pItems[suffix], page = pages.get(row.name);
    const freeSection = page.text.slice(page.text.indexOf('===Free-to-play==='),page.text.indexOf('===Members==='));
    if (suffix === '1' || item) {
      if (item && !freeSection.includes(`[[${item} (Benedict's World Tour)|${item}]]`)) throw new Error(`F2P item missing: ${item}`);
      const snippet = suffix === '1' ? 'It is available to both [[free-to-play]] and [[members]].' : `[[${item} (Benedict's World Tour)|${item}]]`;
      add(row.label, { field:'Not F2P', before:true, after:false, cache:cacheEvidence(436,'members',false), wiki:evidence(row.name,suffix === '1' ? 'Availability' : 'Item locations.Free-to-play',false,snippet) }, 'Cache marks the miniquest F2P; Wiki separately confirms this exact start/item step is available to F2P.');
    } else {
      review.push({ category:'Quest', label:row.label, field:'Not F2P', before:true, cache:cacheEvidence(436,'members',false), decision:'preserve', wiki:evidence(row.name,'Availability split','nine F2P locations; seven members locations','The first nine locations are available to all players, and the last seven locations are exclusive to members.'), reason:'Quest-level F2P metadata does not remove member-only location gates. Full retained completion requires all sixteen authored branches. Foot/Wizard\'s Tower branch is outside the current F2P list; no route or wording rewritten.' });
    }
  }
}
review.push({ category:'Quest', label:'~|Princess and the Pauper|~ 1', field:'NotF2P', before:true, decision:'preserve', reason:'The engine already normalizes this authored alias to Not F2P; its effective membership agrees. Keep the alias rather than rewriting authored data.' });
let skillValues = 0, skillComparable = 0, qpValues = 0, qpComparable = 0;
const achievementSkillComparisons = [], uncomparedSkillValues = [];
const numericDifferences = [];
for (const row of comparison.questRows) {
  const record = records[row.label], quest = row.questIds.length === 1 ? qById.get(row.questIds[0]) : null;
  for (const [skill, before] of Object.entries(record.Skills ?? {})) {
    if (typeof before !== 'number') continue;
    skillValues++;
    const requirement = quest?.requirements.skills.find(value => value.skillName === skill);
    if (!requirement) {
      const name = row.label.replace(/~\|([^|]+)\|~/g,'$1').replace(/\s+/g,' ').trim();
      const candidates = achievements.filter(value=>value.name === name);
      const skillRequirements = candidates.length === 1 ? candidates[0].encodedRequirements.skills.filter(value=>value.skillName === skill) : [];
      if (skillRequirements.length === 1) {
        const after = skillRequirements[0].level;
        achievementSkillComparisons.push({label:row.label,id:candidates[0].id,skill,before,after,status:before === after ? 'match' : 'mismatch'});
        if (before !== after) throw new Error('New achievement requirement difference needs current Wiki review before regeneration.');
      } else uncomparedSkillValues.push({label:row.label,skill,before,reason:quest ? 'No explicit cache quest requirement for this authored operation skill' : candidates.length === 1 ? 'No explicit cache achievement requirement for this skill' : 'No unambiguous exact quest or achievement identity'});
      continue;
    }
    skillComparable++;
    if (before !== requirement.level) numericDifferences.push({ row, quest, field:`Skills.${skill}`, skill, before, after:requirement.level });
  }
  if (typeof record.QuestPointsNeeded === 'number') {
    qpValues++;
    if (quest?.requirements.questPoints != null) {
      qpComparable++;
      if (record.QuestPointsNeeded !== quest.requirements.questPoints) numericDifferences.push({ row, quest, field:'QuestPointsNeeded', skill:'Quest points', before:record.QuestPointsNeeded, after:quest.requirements.questPoints });
    }
  }
}
for (const candidate of numericDifferences) {
  const {row,quest,field,skill,before,after} = candidate;
  if (quest.id === 304) {
    review.push({ category:'Quest', label:row.label, field, before, cache:cacheEvidence(304,'requirements.skills.Cooking',after), decision:'preserve', wiki:evidence('Cooked chompy','Cooking level',30,'|skill1lvl = 30'), supportingQuestWiki:evidence('Recipe for Disaster: Freeing Skrach Uglogwee','Quest Cooking requirement',41,'{{Skillreq|Cooking|41}}'), reason:'This authored operation cooks a chompy at level30. The quest requires41 for the later jubbly; retained step1 already has41. Global quest requirements are not per-operation requirements.' });
    continue;
  }
  const title = quest.id === 81 ? 'Tears of Guthix (quest)' : row.name;
  add(row.label, { field, before, after, cache:cacheEvidence(quest.id,field === 'QuestPointsNeeded' ? 'requirements.questPoints' : `requirements.skills.${skill}`,after), wiki:evidence(title,'Quest details.requirements',after,`{{Skillreq|${skill}|${after}}}`) }, 'The start row stores a plain numeric quest requirement; cache and current Wiki explicitly agree on its corrected value.');
}
const kiliLabel = "~|Kili's Knowledge|~ Complete the lore activity";
add(kiliLabel, { field:'BaseQuest', before:'Kindred Spirits', after:"Kili's Knowledge", cache:cacheEvidence(3355,'name',"Kili's Knowledge VII",'achievements.v1.json'), wiki:evidence("Kili's Knowledge",'Achievement group identity',"Kili's Knowledge",'|Kili\'s Knowledge VII') }, 'The completion label and authored dependencies aggregate the Kili achievement group. Kindred Spirits is an unrelated quest; the cache identities and Wiki group listing establish the correction. No quest prerequisite is inferred from an associated ID.');
const kili = achievements.filter(row => /^Kili's Knowledge (?:I|II|III|IV|V|VI|VII)(?: \(power\))?$/.test(row.name));
const identityReview = { group:"Kili's Knowledge", questListEntries:quests.filter(row => row.listEntry && row.name === "Kili's Knowledge").map(row=>row.id), achievementRecords:kili.map(row => ({ id:row.id, name:row.name, associatedQuestReferences:row.encodedRequirements.associatedQuestReferences, miniquestQuestReferences:row.encodedRequirements.miniquestQuestReferences, stateConditions:row.stateConditions })), unrelatedQuest:{ id:384, name:qById.get(384).name, stateFields:qById.get(384).stateFields }, wiki:[evidence('Kindred Spirits','Infobox Quest.id',384,'|id = 384'), evidence('Kili Row','Infobox Quest.id',500,'|id = 500'), evidence("Kili's Knowledge VII",'Infobox Achievement.id',3355,'|id = 3355'), evidence("Kili's Knowledge VII (power)",'Infobox Achievement.id',3356,'|id = 3356')], conclusion:'All ten Kili achievement records have no associated quest references. Their miniquest prerequisite reference500 identifies Kili Row and remains a prerequisite, not an identity alias. Their distinct state varbits53743–53752 do not match Kindred Spirits state. Preserve0QP, authored dependencies, wording and chunks (including the suspicious14131). RuneMetrics excludes this lore-completion label already; the fix corrects engine/activity grouping.' };
const labelIdentityDisagreements = Object.entries(records).flatMap(([label, record]) => { const linkedTitle = /~\|([^|]+)\|~/.exec(label)?.[1]; return linkedTitle && linkedTitle !== record.BaseQuest ? [{label,linkedTitle,baseQuest:record.BaseQuest}] : []; });
const storedMetadata = [];
function walk(value, path=[]) {
  if (!value || typeof value !== 'object') return;
  for (const [key,child] of Object.entries(value)) {
    if (/^(?:quest)?(?:difficulty|length)$/i.test(key)) storedMetadata.push({path:[...path,key].join('.'),value:child});
    walk(child,[...path,key]);
  }
}
walk(reference);
const metadataDifferences = comparison.questRows.flatMap(row => row.metadata.filter(field=>field.status === 'mismatch').map(field=>({label:row.label,...field})));
const files = ['quests.v1.json','achievements.v1.json','quests-achievements.comparison.v1.json','quests-achievements.manifest.v1.json'];
const artifact = { schemaVersion:1, generatedAt:new Date().toISOString(), sources:{ reference:{path:'rs3-chunkpicker-chunkinfo-export.json',sha256:sha256RepositoryText(readFileSync(referencePath))}, cache:{directory:cacheRoot,artifacts:files.map(artifact=>({artifact,sha256:hash(readFileSync(`${cacheRoot}/${artifact}`))})),decoder:manifest.decoder}, wiki:{method:'Tavily discovery first, then direct MediaWiki API current revisions with redirects',queryUrl:url.href,responseSha256:hash(rawResponse),checkedAt:new Date().toISOString(),revisions:[...pages.values()].map(({text,...page})=>page)} }, coverage:{retainedQuestRows:comparison.questRows.length,wholeQuestCompletionRows:comparison.summary.wholeQuestCompletionRows,uniquelyMatchedQuestRows:comparison.questRows.filter(row=>row.questIds.length===1).length,originalCompletionMetadataDifferences:metadataDifferences,labelIdentityDisagreements,effectiveMembershipDifferences:membership.length,rawAliasMembershipReviewCount:1,difficultyAndLength:{scope:'Every key recursively in the complete retained export',storedFields:storedMetadata,changes:0,reason:'No stored difficulty/length fields; do not invent metadata fields.'},numericRequirements:{scope:'Every plain numeric Skills value and QuestPointsNeeded in all 3515 Quest rows, compared only against the same explicit cache requirement',skillValues,skillComparable,achievementSkillComparisons,uncomparedSkillValues,qpValues,qpComparable,differences:numericDifferences.length,changes:numericDifferences.length-1,withheldOperationDifference:1},correctionRows:corrections.length,correctionFields:corrections.reduce((sum,row)=>sum+row.changes.length,0),reviewRows:review.length},corrections,review,identityReview,limits:['Quest skill metadata is not an exhaustive server prerequisite list. Missing cache skills and authored operation gates are preserved.','Benedict F2P metadata covers a partial tier; full completion and member-only branches stay gated.','No authored descriptions, steps, dependencies, rewards, items, access or state tests replaced.'], verification:{beforeValuesMatchReference:corrections.every(row=>row.changes.every(change=>{const current=change.field.split('.').reduce((value,key)=>value?.[key],records[row.label]);return (current ?? null) === change.before;}))} };
if (!artifact.verification.beforeValuesMatchReference) throw new Error('Before-value mismatch');
const output = resolve(root,'docs/research/cache-quest-metadata-corrections.2026-10-08.v1.json');
writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({output,correctionRows:corrections.length,reviewRows:review.length,plainSkillValues:skillValues,questSkillComparisons:skillComparable,achievementSkillComparisons:achievementSkillComparisons.length,uncomparedSkillValues:uncomparedSkillValues.length},null,2));
