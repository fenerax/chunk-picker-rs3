import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEquipmentWikiPage, parseWikiTemplates, wikiNumber, wikiPlainText, selectWikiBonusVariants } from './equipment-wiki.mjs';

const root = resolve(import.meta.dirname, '../..');
const dataset = 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-2026-10-08-v2';
async function replaceArtifact(filename, bytes) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = value => String(value ?? '').normalize('NFC').trim().toLowerCase();
const slots = { head:'head', cape:'back', back:'back', neck:'neck', body:'torso', torso:'torso', legs:'legs', hands:'hands', feet:'feet', ring:'ring', ammo:'ammo', ammunition:'ammo', aura:'aura', pocket:'pocket', '2h':'2h weapon', '2h weapon':'2h weapon', weapon:'main hand weapon', 'main hand':'main hand weapon', 'main hand weapon':'main hand weapon', shield:'off-hand', 'off-hand':'off-hand', 'off-hand weapon':'off-hand' };
const damageParams = { melee_damage:641, ranged_damage:643, magic_damage:965, necromancy_damage:8881 };
const statParams = { armour:2870, prayer:2946, ...damageParams };
const wikiStats = { armour:'armour', prayer:'prayer', accuracy:'accuracy', auto_damage:'damage', melee_damage:'strength', ranged_damage:'ranged', magic_damage:'magic', necromancy_damage:'necromancy' };
const skills = ['Attack','Defence','Strength','Constitution','Ranged','Prayer','Magic','Cooking','Woodcutting','Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer','Farming','Runecrafting','Hunter','Construction','Summoning','Dungeoneering','Divination','Invention','Archaeology','Necromancy'];
const skillNames = new Map(skills.map(skill => [normalize(skill), skill]));

export function parseEquipRequirements(text) {
  const values = {}, ambiguous = new Set();
  for (const template of parseWikiTemplates(text ?? '')) {
    if (!['sc','skillreq','skill requirement'].includes(normalize(template.name))) continue;
    const skill = skillNames.get(normalize(template.positional[0]));
    const level = wikiNumber(template.positional[1]);
    if (!skill || !Number.isSafeInteger(level) || level < 1) continue;
    if (Object.hasOwn(values,skill) && values[skill] !== level) ambiguous.add(skill);
    values[skill] = level;
  }
  for (const skill of ambiguous) delete values[skill];
  // A flat requirements map means conjunction. Do not flatten alternatives.
  if (/\bor\b/i.test(wikiPlainText(text))) { for (const skill of Object.keys(values)) { ambiguous.add(skill); delete values[skill]; } }
  return { values, ambiguous:[...ambiguous] };
}

/** An ID from the current item infobox is required even for a unique cache name.
 * Multiple intersecting IDs/states remain unresolved; array order never decides.
 */
export function resolveEquipmentIdentity(name, candidates, page) {
  if (!page || page.missing || !page.revisionId) return { status:'unresolved', reason:'Current Wiki page/revision unavailable' };
  const matches = page.items.flatMap(variant => candidates.filter(cache => variant.ids.includes(cache.id)).map(cache => ({cache, variant})));
  const deduped = [...new Map(matches.map(match => [JSON.stringify([match.cache.id,match.variant.version,match.variant.name,match.variant.fields]), match])).values()];
  if (!deduped.length) return { status:'unresolved', reason:'No current Wiki infobox ID intersects the exact equippable cache candidates', wikiIds:page.items.flatMap(item=>item.ids) };
  let selected = deduped;
  if (selected.length > 1) {
    const exact = selected.filter(match => normalize(match.variant.name) === normalize(name));
    if (exact.length) selected = exact;
  }
  if (selected.length !== 1) return {status:'unresolved',reason:'Multiple current Wiki ID/state variants match; retained row does not establish which state', matches:selected.map(({cache,variant})=>({cacheId:cache.id,version:variant.version,name:variant.name}))};
  const {cache,variant} = selected[0];
  if (variant.conflicts?.some(field=>/^(?:id|name|version|bucketname)\d*$/.test(field))) return {status:'unresolved',reason:'Wiki infobox has conflicting identity declarations'};
  if (!cache.equipmentCandidate || cache.template) return {status:'unresolved',reason:'Cache ID is not an independent equippable definition'};
  return {status:'verified',cache,variant};
}

export function selectEquipmentBonuses(page, item) {
  const selected=selectWikiBonusVariants(page,item);
  return selected.length===1 && !selected[0].conflicts?.some(field=>/^(?:version|bucketname)\d*$/.test(field))?selected[0]:null;
}

function at(record,field) {
  let value=record;
  for (const key of field.split('.')) { if (value == null || !Object.hasOwn(value,key)) return {present:false,value:null}; value=value[key]; }
  return {present:true,value};
}
function paramOf(cache,field) {
  if (field.startsWith('requirements.')) {
    const skill=skills.indexOf(field.split('.')[1]);
    return cache.params?.filter(p=>p.prop>=749 && p.prop<769 && p.prop%2===1 && p.intvalue===skill).map(p=>({skillParam:p.prop,levelParam:p.prop+1})) ?? [];
  }
  if (field==='accuracy') return cache.params?.filter(p=>[3267,4,3].includes(p.prop)).map(p=>p.prop) ?? [];
  if (field==='auto_damage') return cache.params?.filter(p=>Object.values(damageParams).includes(p.prop)).map(p=>p.prop) ?? [];
  return statParams[field];
}
function factsFor(cache,page,item,bonus) {
  const facts=[];
  const membership=normalize(wikiPlainText(item.fields.members));
  const membershipConflict=item.conflicts?.some(field=>field==='members' || field===`members${item.suffix}`);
  const itemField=key=>item.fieldSources?.[key] ?? `Infobox Item.${key}${item.suffix}`;
  facts.push({field:'members',cacheValue:cache.members,wikiValue:membershipConflict?null:membership==='yes'?true:membership==='no'?false:null,cacheField:'members',wikiField:itemField('members'),raw:item.fields.members});
  if (!bonus) return facts;
  const fieldAvailable = key => !bonus.conflicts?.some(field=>field===key || field===`${key}${bonus.suffix}`);
  const bonusField=key=>bonus.fieldSources?.[key] ?? `Infobox Bonuses.${key}${bonus.suffix}`;
  const slot=fieldAvailable('slot')?slots[normalize(wikiPlainText(bonus.fields.slot))] ?? null:null;
  facts.push({field:'slot',cacheValue:cache.slot,wikiValue:slot,cacheField:'slot',wikiField:bonusField('slot'),raw:bonus.fields.slot});
  for (const [field,cacheValue] of Object.entries(cache.stats ?? {})) {
    if (!wikiStats[field]) continue;
    const key=wikiStats[field];
    facts.push({field,cacheValue,wikiValue:fieldAvailable(key)?wikiNumber(bonus.fields[key]):null,cacheField:`stats.${field}`,wikiField:bonusField(key),raw:bonus.fields[key],param:paramOf(cache,field)});
  }
  // Sparse meanings independently calibrated against exact current Wiki IDs.
  // Read only unambiguous integer params, and require item-specific agreement.
  for (const [field,param,key] of [['tier',4596,'tier'],['lp',1326,'life'],['accuracy',8879,'accuracy'],['attack_speed_ticks',14,'speed'],['attack_range',13,'attack_range']]) {
    if (field==='accuracy' && Object.hasOwn(cache.stats??{},'accuracy')) continue;
    const params=(cache.params??[]).filter(p=>p.prop===param);
    if (!params.length || cache.conflictingParams?.includes(param) || new Set(params.map(p=>p.intvalue)).size!==1 || !Number.isFinite(params[0].intvalue)) continue;
    facts.push({field,cacheValue:params[0].intvalue,wikiValue:fieldAvailable(key)?wikiNumber(bonus.fields[key]):null,cacheField:`params[prop=${param}].intvalue`,wikiField:bonusField(key),raw:bonus.fields[key],param});
  }
  // Slot 5 also contains shields. Only the Wiki's explicit weapon classification
  // admits the independently calibrated off-hand displayed-damage formula.
  if (cache.equipSlotId===5 && fieldAvailable('slot') && normalize(wikiPlainText(bonus.fields.slot))==='off-hand weapon') {
    const params=(cache.params??[]).filter(p=>Object.values(damageParams).includes(p.prop));
    const properties=[...new Set(params.map(p=>p.prop))];
    if (properties.length===1 && !cache.conflictingParams?.includes(properties[0]) && new Set(params.map(p=>p.intvalue)).size===1 && Number.isFinite(params[0].intvalue)) {
      facts.push({field:'auto_damage',cacheValue:params[0].intvalue/20,wikiValue:fieldAvailable('damage')?wikiNumber(bonus.fields.damage):null,cacheField:`params[prop=${properties[0]}].intvalue / 20`,wikiField:bonusField('damage'),raw:bonus.fields.damage,param:properties[0],formula:{rawValue:params[0].intvalue,divisor:20,scope:'Explicit Wiki off-hand weapon; displayed auto damage, not ability damage'}});
    }
  }
  const requirements=parseEquipRequirements(bonus.fields.requirements);
  for (const [skill,level] of Object.entries(cache.requirements ?? {})) {
    const field=`requirements.${skill}`;
    facts.push({field,cacheValue:level,wikiValue:fieldAvailable('requirements')?requirements.values[skill] ?? null:null,cacheField:field,wikiField:`${bonusField('requirements')}.${skill}`,raw:bonus.fields.requirements,param:paramOf(cache,field),ambiguous:requirements.ambiguous.includes(skill)});
  }
  return facts;
}

/** Pure builder: no network, filesystem mutation, application imports or state. */
export function buildEquipmentCorrections({reference,items,comparison,snapshot}) {
  const cacheById=new Map(items.records.map(row=>[row.id,row]));
  const pages=new Map(snapshot.pages.map(raw=>[raw.title,parseEquipmentWikiPage(raw)]));
  const identities=[],corrections=[],identityReview=[],fieldReview=[],consensusReview=[];
  for (const row of comparison.equipment) {
    const record=reference.equipment[row.name];
    if (!record) throw new TypeError(`Missing retained equipment: ${row.name}`);
    const page=pages.get(snapshot.resolutions[row.name] ?? row.name);
    const candidates=row.candidateIds.map(id=>cacheById.get(id));
    if (candidates.some(cache=>!cache || cache.normalizedName!==row.normalizedName)) throw new TypeError(`Cache candidate drift: ${row.name}`);
    const identity=resolveEquipmentIdentity(row.name,candidates,page);
    const review={name:row.name,candidateStatus:row.status,candidateIds:row.candidateIds,status:identity.status};
    if (identity.status!=='verified') {
      Object.assign(review,{reason:identity.reason,wiki:page?.source ?? null,...(identity.matches?{matches:identity.matches}:{}),...(identity.wikiIds?{wikiIds:identity.wikiIds}:{})});
      identityReview.push(review);
      if (row.consensusDifferences.length) consensusReview.push({...review,fields:row.consensusDifferences.map(diff=>({...diff,decision:'unresolved',reason:identity.reason}))});
      continue;
    }
    const {cache,variant}=identity, bonus=selectEquipmentBonuses(page,variant);
    const confirmed={name:row.name,cacheId:cache.id,variant:variant.version || 'default',wiki:{...page.source,itemName:variant.name,itemSuffix:variant.suffix,ids:variant.ids},beforeRecordSha256:sha256(JSON.stringify(record))};
    identities.push(confirmed); identityReview.push({...review,...confirmed});
    const changes=[],decisions=new Map();
    for (const fact of factsFor(cache,page,variant,bonus)) {
      const before=at(record,fact.field);
      const entry={name:row.name,cacheId:cache.id,field:fact.field,before:before.value,beforePresent:before.present,cache:fact.cacheValue,wiki:fact.wikiValue};
      if (fact.wikiValue===null || fact.ambiguous) Object.assign(entry,{decision:'unresolved',reason:fact.ambiguous?'Conflicting Wiki skill requirements':'Comparable field unavailable in matched current Wiki variant'});
      else if (!same(fact.cacheValue,fact.wikiValue)) Object.assign(entry,{decision:'preserved',reason:fact.formula && Math.abs(fact.cacheValue-fact.wikiValue)<=0.051?'Off-hand formula and Wiki differ only at display rounding; exact agreement required, so preserve authored value':'Current Wiki value and cache disagree; preserve authored value'});
      else if (fact.field==='slot' && slots[normalize(before.value)]===fact.cacheValue) Object.assign(entry,{decision:'preserved',reason:'Physical slot agrees; retain authored shield/off-hand weapon distinction'});
      else if (fact.field.startsWith('requirements.') && !before.present && fact.cacheValue===1) Object.assign(entry,{decision:'preserved',reason:'Missing skill level is already an implicit level 1; no additional gate needed'});
      else if (before.present && (same(before.value,fact.cacheValue) || typeof before.value==='number' && typeof fact.cacheValue==='number' && Math.abs(before.value-fact.cacheValue)<=0.051)) Object.assign(entry,{decision:'preserved',reason:'Authored value agrees at established display precision'});
      else {
        Object.assign(entry,{decision:'applied',reason:'Current matched Wiki revision and decoded cache agree; authored field differs or is absent'});
        changes.push({field:fact.field,before:before.value,after:fact.cacheValue,...(!before.present?{beforePresent:false}:{}),cache:{artifact:'items-2026-10-08-v2/items.v1.json',id:cache.id,field:fact.cacheField,value:fact.cacheValue,...(fact.param!==undefined?{param:fact.param}:{}),...(fact.formula?{formula:fact.formula}:{})},wiki:{...page.source,field:fact.wikiField,value:fact.wikiValue,raw:fact.raw}});
      }
      decisions.set(fact.field,entry);fieldReview.push(entry);
    }
    if (changes.length) corrections.push({...confirmed,rationale:'Apply only ID/variant-verified comparable fields independently corroborated by the current Wiki revision.',changes});
    if (row.consensusDifferences.length) consensusReview.push({...review,...confirmed,fields:row.consensusDifferences.map(diff=>{
      const decision=decisions.get(diff.field);return {...diff,decision:decision?.decision ?? 'unresolved',reason:decision?.reason ?? 'No unambiguous matching Wiki bonuses state for this item variant',wiki:decision?.wiki ?? null};
    })});
  }
  const byField={},decisionCounts={},identityCounts={},consensusCounts={};
  for (const row of corrections) for (const change of row.changes) byField[change.field]=(byField[change.field]??0)+1;
  for (const row of fieldReview) decisionCounts[row.decision]=(decisionCounts[row.decision]??0)+1;
  for (const row of identityReview) identityCounts[row.status]=(identityCounts[row.status]??0)+1;
  for (const row of consensusReview) for (const field of row.fields) consensusCounts[field.decision]=(consensusCounts[field.decision]??0)+1;
  return {schemaVersion:1,verifiedOn:'2026-10-08',policy:'Exact retained equipment names, current Wiki item IDs and explicit variant state. Change only independently agreeing comparable fields; preserve authored labels, task IDs, unrelated fields and additional gates.',counts:{equipmentRows:comparison.equipment.length,uniqueCandidates:comparison.equipment.filter(row=>row.status==='unique').length,uniqueVerified:identityReview.filter(row=>row.candidateStatus==='unique'&&row.status==='verified').length,uniqueUnresolved:identityReview.filter(row=>row.candidateStatus==='unique'&&row.status!=='verified').length,identities:identities.length,identityStatus:identityCounts,correctionRows:corrections.length,correctionFields:corrections.reduce((sum,row)=>sum+row.changes.length,0),byField,fieldDecisions:decisionCounts,consensusRows:consensusReview.length,consensusFields:consensusReview.reduce((sum,row)=>sum+row.fields.length,0),consensusDecisions:consensusCounts},identities,corrections,identityReview,fieldReview,consensusReview,semantics:{status:'inferred, independently calibrated against exact current Wiki item IDs and explicit bonus variants; each applied field additionally agrees for its own item',calibration:{tier:{param:4596,checks:495,matches:492,disagreements:3,withheldIds:[14577,14578,14579]},lp:{param:1326,checks:268,matches:268,disagreements:0},necromancyAccuracy:{param:8879,checks:24,matches:24,disagreements:0},attack_speed_ticks:{param:14,checks:1256,matches:1253,disagreements:3,withheldIds:[63339,63327,55508]},offhandAutoDamage:{params:[641,643,965,8881],divisor:20,checks:282,matches:282,displayPrecisionTolerance:0.051,matchCriterion:"Absolute cache/Wiki difference <= 0.051 at displayed precision",exactMatches:229,roundingOnlyMatches:53,appliedFieldCriterion:"Exact numeric equality for the individual matched ID/variant; rounding-only matches never authorize a correction",disagreements:0,scope:"Wiki explicit off-hand weapon slot only; /10 fails281of282"},attack_range:{param:13,checks:473,matches:469,disagreements:4,withheldIds:[21582,37263,44176,14121]}},rejectedTierParameter:{param:2645,checks:1450,matches:327,disagreements:1123,reason:'Production skill level, not equipment tier: Mystic wand param57 matches Crafting57 while tier50; Bronze platebody param1 while tier5.'}},limits:['Sparse/absent cache params are unknown, never zero.','Decoded skill pairs do not establish complete server equipability; extra authored gates survive.','Derived ability damage and weights are outside cache field corrections.','Authored speed is preserved; explicit attack_speed_ticks uses raw14 game ticks only.','Sparse tier, life, speed, range and Necromancy accuracy params are inferred, not formally named by this snapshot; only independently matching current Wiki fields apply.','Ambiguous cache/Wiki item states remain unresolved rather than selecting the first same-name row.']};
}

export async function generateEquipmentCorrectionArtifacts({cacheDirectory=dataset,wikiPath=resolve(root,'.local/equipment-wiki.2026-10-08.v1.json')}={}) {
  const read=async (path,hash)=>{const bytes=await readFile(path);return {path,sha256:hash(bytes),bytes:bytes.length,data:JSON.parse(bytes)}};
  const readRepositoryText=path=>read(path,sha256RepositoryText);
  const readExternalArtifact=path=>read(path,sha256);
  const [reference,compact,manifest,items,comparison,snapshot]=await Promise.all([
    readRepositoryText(resolve(root,'rs3-chunkpicker-chunkinfo-export.json')),
    readRepositoryText(resolve(root,'docs/research/cache-game-data-items.2026-10-08.v1.json')),
    readExternalArtifact(resolve(cacheDirectory,'items.manifest.v1.json')),
    readExternalArtifact(resolve(cacheDirectory,'items.v1.json')),
    readExternalArtifact(resolve(cacheDirectory,'items.comparison.v1.json')),
    readExternalArtifact(wikiPath),
  ]);
  if (compact.data.datasetDirectory!==cacheDirectory || compact.data.manifestSha256!==manifest.sha256) throw new TypeError('Copied item dataset/manifest does not match the committed provenance');
  if (reference.sha256!==compact.data.reference.sha256 || reference.sha256!==manifest.data.reference.sha256) throw new TypeError('Retained reference hash drift');
  if (!same(compact.data.decoder,manifest.data.decoder) || manifest.data.decoder.commit!=='a92b8920b9b9842adde78822646ecad1a6f4fc15') throw new TypeError('Decoder provenance drift');
  for (const artifact of [items,comparison]) {
    const expected=manifest.data.outputs.find(output=>basename(output.path)===basename(artifact.path));
    if (!expected || expected.sha256!==artifact.sha256 || expected.bytes!==artifact.bytes || artifact.data.reference.sha256!==reference.sha256 || !same(artifact.data.decoder,manifest.data.decoder)) throw new TypeError(`Copied artifact hash/provenance drift: ${artifact.path}`);
  }
  if (Object.keys(reference.data.equipment).some(name=>!snapshot.data.requestedTitles.includes(name))) throw new TypeError('Wiki snapshot is incomplete for retained equipment');
  if (comparison.data.equipment.length!==Object.keys(reference.data.equipment).length || new Set(comparison.data.equipment.map(row=>row.name)).size!==comparison.data.equipment.length) throw new TypeError('Copied equipment comparison coverage drift');
  const report=buildEquipmentCorrections({reference:reference.data,items:items.data,comparison:comparison.data,snapshot:snapshot.data});
  report.sources={reference:{path:'rs3-chunkpicker-chunkinfo-export.json',sha256:reference.sha256},cache:{directory:cacheDirectory,compactReport:{path:'docs/research/cache-game-data-items.2026-10-08.v1.json',sha256:compact.sha256},manifestSha256:manifest.sha256,artifacts:[items,comparison].map(({path,sha256,bytes})=>({artifact:basename(path),sha256,bytes})),decoder:manifest.data.decoder},wiki:{snapshotPath:wikiPath,snapshotSha256:snapshot.sha256,fetchedAt:snapshot.data.fetchedAt,completedAt:snapshot.data.completedAt,revisions:snapshot.data.pages.filter(page=>page.revisions?.length).map(page=>({title:page.title,revisionId:page.revisions[0].revid,contentSha256:sha256(page.revisions[0].slots.main.content)}))}};
  report.sources.implementation=await Promise.all(['scripts/research/build-equipment-corrections.mjs','scripts/research/equipment-wiki.mjs'].map(async path=>({path,sha256:sha256RepositoryText(await readFile(resolve(root,path)))})));
  const reportPath='docs/research/cache-equipment-corrections.2026-10-08.v1.json';
  // Applied field evidence and identity attachment facts live once in the runtime
  // bundle. This report retains every candidate decision, every original
  // consensus disagreement, and every withheld/missing comparable field.
  const {identities,corrections,...reviewReport}=report;
  const ordinaryAgreement=new Set(['Physical slot agrees; retain authored shield/off-hand weapon distinction','Missing skill level is already an implicit level 1; no additional gate needed','Authored value agrees at established display precision']);
  reviewReport.fieldReview=report.fieldReview.filter(row=>row.decision!=='applied' && !ordinaryAgreement.has(row.reason));
  reviewReport.appliedEvidence={artifact:'app/data/equipment-corrections.2026-10-08.v1.json',identities:identities.length,correctionRows:corrections.length,correctionFields:report.counts.correctionFields,policy:'Applied ID/variant facts and complete field provenance are in the bundle; this report is its hash-bound review source.'};
  const reportBytes=`${JSON.stringify(reviewReport,null,2)}\n`;
  const bundle={schemaVersion:1,verifiedOn:report.verifiedOn,policy:report.policy,evidence:[{path:reportPath,sha256:sha256RepositoryText(reportBytes)}],reference:report.sources.reference,counts:report.counts,identities:report.identities,corrections:report.corrections};
  await replaceArtifact(resolve(root,reportPath),reportBytes);
  await replaceArtifact(resolve(root,'app/data/equipment-corrections.2026-10-08.v1.json'),`${JSON.stringify(bundle,null,2)}\n`);
  return {report:reviewReport,bundle};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node scripts/research/build-equipment-corrections.mjs [--wiki PATH]';
  if (args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    if (args.length && (args.length !== 2 || args[0] !== '--wiki' || args[1].startsWith('--'))) throw new TypeError(usage);
    const options = args.length ? { wikiPath: resolve(args[1]) } : {};
    console.log(JSON.stringify((await generateEquipmentCorrectionArtifacts(options)).bundle.counts,null,2));
  }
}
