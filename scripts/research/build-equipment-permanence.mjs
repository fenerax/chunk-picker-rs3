import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, sha256RepositoryText } from '../lib/provenance-hash.mjs';
import { parseEquipmentWikiPage, wikiPlainText } from './equipment-wiki.mjs';

const root = resolve(import.meta.dirname, '../..');
const defaultCache = 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/items-2026-10-08-v2';
export const permanenceKinds = ['dust', 'charges-vanish', 'temporary', 'use-destruction'];
const relevantParams = new Set([3382,3383,3384,3385,3109,3110,1079,1081,1324,1430,1429,528,529,1097]);
const dustFamilies = /^(?:Corrupt (?:dragon |Morrigan's |Statius's |Vesta's |Zuriel's )|(?:Superior )?(?:Morrigan's |Statius's |Vesta's |Zuriel's )|Malevolent |Sirenic |Tectonic |Primeval |Tempest |Teralith |Death Lotus (?:chaps|chestplate|hood)$|Seasinger's (?:hood|robe bottom|robe top)$|Tetsu (?:body|helm|platelegs)$|Superior (?:rock-shell |skeletal |spined )|(?:Superior )?scrimshaw of )/i;
const dustNames = new Set(['Ascension grips','Celestial handwraps','Razorback gauntlets','Reefwalker\'s cape','Leviathan ring','Dragon slayer gloves','Ring of retribution']);
const ammoNames = /(?:\b(?:arrow|arrows|bolt|bolts|dart|javelin|knife|throwing axe|chinchompa|skillchompa)\b|^Deathtouched dart$)/i;
const currentText = text => text.split(/==\s*(?:Update history|Trivia|History)\s*==/i)[0];
const param = (record, key) => {
  const values = record?.params?.filter(row => row.prop === key).map(row => row.intvalue) ?? [];
  return values.length && values.every(value => value === values[0]) ? values[0] : undefined;
};

/** Follow only the calibrated degradation transition, preserving all visited
 * states. A -1 transition loses the item; a named broken/seed state survives.
 * Repair-cost sentinels are deliberately never treated as item transitions.
 */
export function traceDegradation(record, byId) {
  const states = [], seen = new Set();
  let state = record;
  while (state && !seen.has(state.id)) {
    seen.add(state.id);
    const transitionParam = [3382,1081].find(key=>param(state,key)!==undefined);
    const next = transitionParam === undefined ? undefined : param(state,transitionParam);
    states.push({ id:state.id, name:state.name, next:next ?? null, transitionParam:transitionParam ?? null,
      params:(state.params ?? []).filter(row => relevantParams.has(row.prop)) });
    if (states.length > 1 && (state.equipmentCandidate === false || /\((?:broken|uncharged)\)$/i.test(state.name))) return { outcome:'retained-state', states };
    if (next === -1) return { outcome:'vanishes', states };
    if (next === undefined) return { outcome:states.length > 1 ? 'unresolved-terminal-state' : 'no-transition', states };
    if (!byId.has(next)) return { outcome:'unresolved-target', states };
    state = byId.get(next);
  }
  return { outcome:'cycle', states };
}

export function classifyEquipmentPermanence(name, data, page, cacheCandidates, byId, supportingPages = []) {
  const content = page?.revisions?.[0]?.slots?.main?.content ?? page?.content ?? '';
  const parsed = parseEquipmentWikiPage(page);
  const prose = currentText(content);
  const fields = parsed.items.map(item => ({ ids:item.ids, version:item.version, name:item.name,
    examine:item.fields.examine ?? null, actions:item.fields.actions ?? item.fields.options ?? null }));
  const wikiIds = parsed.items.flatMap(item => item.ids);
  const current = cacheCandidates.filter(item => wikiIds.includes(item.id));
  const candidates = current.length ? current : cacheCandidates;
  const cache = candidates.map(item => traceDegradation(item,byId));
  const plain = wikiPlainText([prose,...supportingPages.map(page=>currentText(page.revisions?.[0]?.slots?.main?.content ?? ''))].join('\n'));
  const dominionGloves = /^(?:Goliath|Swift|Spellcaster) gloves \((?:black|red|white|yellow)\)$/.test(name);
  const areaLimited = ['Wooden sword','Vial of bile',"War's javelin",'Smouldering fever grass','Smouldering tansymum','Smouldering lavender'].includes(name);
  const ammunition = !areaLimited && (data.slot === 'ammo' || data.slot === 'ammunition' || ammoNames.test(name) &&
    (data.style === 'thrown' || data.style === 'javelins' || data.style === 'darts' || data.style === 'knives' || /chinchompa|skillchompa|Deathtouched dart/i.test(name)));
  let kind = null, basis = 'ordinary-equipment-review';
  if (ammunition) basis = 'ammunition-excluded';
  else if (name !== 'Malevolent kiteshield' && (dustFamilies.test(name) || dustNames.has(name) || dominionGloves)) {
    // The reviewed family is a candidate selector, not the proof. Require a
    // pinned per-item loss statement or a calibrated disappearing cache state.
    const loss = /(?:degrad\w*.{0,140}(?:dust|nothing|disintegrat)|(?:turn\w*|crumbl\w*).{0,35}dust|cannot be repaired)/i.test(plain);
    const terminal = cache.some(trace => trace.outcome === 'vanishes');
    const timedScrimshaw = /scrimshaw/i.test(name) && candidates.some(item => param(item,3109) > 0);
    if (!loss && !terminal && !timedScrimshaw) throw new Error(`Dust candidate lacks item-specific evidence: ${name}`);
    kind = 'dust'; basis = loss ? 'wiki-loss-and-cache-review' : 'cache-loss-and-family-review';
  }
  else if (name === 'Ferocious ring') { kind='charges-vanish'; basis='wiki-charge-exhaustion'; }
  else if (name === 'Ferocious ring (c)') basis='retained-rechargeable-compacted-jewellery';
  else if (name === 'Hand cannon') { kind='use-destruction'; basis='wiki-destruction-through-firing'; }
  else if (areaLimited) { kind='temporary'; basis='wiki-area-limited-item'; }
  else if (name === 'Air staff (Dominion Tower)') {
    if(!parsed.items.some(item=>item.fields.bankable?.toLowerCase()==='no' && item.fields.kept?.toLowerCase()==='never')) throw new Error('Dominion staff lacks reviewed instance restriction');
    kind='temporary'; basis='inferred-instance-only-never-kept-not-bankable';
  }
  else if (name.startsWith('Academy ')) { kind='temporary'; basis='wiki-retired-tutorial-only-item'; }
  else if (cache.some(trace=>trace.outcome==='vanishes')) {
    if(!/(?:degrad\w*.{0,140}(?:dust|nothing|disintegrat)|(?:turn\w*|crumbl\w*).{0,35}dust|cannot be repaired)/i.test(plain)) throw new Error(`Unreviewed disappearing cache equipment: ${name}`);
    kind='dust'; basis='cache-terminal-with-wiki-loss';
  }
  else if (cache.some(trace => trace.outcome === 'retained-state' || trace.outcome==='cycle') || parsed.bonuses.some(bonus=>Number(bonus.fields.repair_cost)>0) || /(?:can be (?:repaired|recharged)|reverts? to (?:a |the )?(?:seed|broken)|degrades? to a broken state)/i.test(plain)) basis='retained-repairable-or-rechargeable';
  return { permanent:kind === null, kind, basis, ammunitionExcluded:ammunition,
    cacheIds:[...new Set(candidates.map(item => item.id))].sort((a,b)=>a-b),
    evidence:{ cache:cache.filter(trace => trace.states.some(state => state.next !== null || state.params.some(row=>row.prop===3109))),
      wiki:parsed.revisionId ? {...parsed.source,contentSha256:sha256(Buffer.from(content)),
      degradation:[...new Set(parsed.bonuses.map(bonus=>bonus.fields.degrades).filter(Boolean))],
      repairCost:[...new Set(parsed.bonuses.map(bonus=>bonus.fields.repair_cost).filter(Boolean))],
      supportingRevisions:supportingPages.map(page=>page.revisions?.[0]?.revid).filter(Boolean),
      states:fields.filter(field=>field.ids.some(id=>candidates.some(item=>item.id===id))).map(({ids,version})=>({ids,version}))} : null } };
}

export function buildEquipmentPermanence(definitions, snapshot, items, supplemental = []) {
  const byId = new Map(items.records.map(row=>[row.id,row]));
  const byName = new Map();
  for (const row of items.records) if (row.equipmentCandidate && !row.template) {
    const key = row.normalizedName ?? row.name;
    if (!byName.has(key)) byName.set(key,[]);
    byName.get(key).push(row);
  }
  const extraPages = supplemental.flatMap(s=>s.pages ?? s.response?.query?.pages ?? []);
  const pages = new Map(snapshot.pages.map(page=>[page.title,page]));
  const extra = new Map(extraPages.map(page=>[page.title,page]));
  const records = {}, sources = {};
  for (const [name,data] of Object.entries(definitions.equipment)) {
    const supportTitles = /^(Goliath|Swift|Spellcaster) gloves /.test(name) ? [`Template:${name.split(' gloves ')[0]} gloves`] :
      name === 'Ferocious ring (c)' ? ['Teleportation compactor'] : name.startsWith('Academy ') ? ['Combat Academy'] : [];
    const supports = supportTitles.map(title=>extra.get(title)).filter(Boolean);
    if(supportTitles.length && supports.length !== supportTitles.length) throw new Error(`Required supplemental evidence missing: ${name}`);
    records[name] = classifyEquipmentPermanence(name,data,pages.get(snapshot.resolutions[name] ?? name),byName.get(name) ?? [],byId,supports);
    const row = records[name], wiki = row.evidence.wiki;
    if(wiki) {
      const {revisionId,title,timestamp,url,contentSha256,...facts}=wiki;
      sources[revisionId]={title,timestamp,url,contentSha256};
      row.evidence.wiki={revisionId,...facts};
    }
  }
  for(const page of extraPages) {
    const parsed=parseEquipmentWikiPage(page),content=page.revisions?.[0]?.slots?.main?.content ?? '';
    if(parsed.revisionId) sources[parsed.revisionId]={...parsed.source,contentSha256:sha256(Buffer.from(content))};
  }
  const counts = { total:Object.keys(records).length, permanent:0, dust:0, 'charges-vanish':0, temporary:0, 'use-destruction':0, ammunitionExcluded:0 };
  for (const row of Object.values(records)) { counts[row.kind ?? 'permanent']++; if(row.ammunitionExcluded) counts.ammunitionExcluded++; }
  return { schemaVersion:1, version:'2026-10-08.v1', rule:'Lost through normal use or elapsed/activation time; repairable/rechargeable retained items are permanent; ammunition is excluded.', counts, sources, records };
}

async function main() {
  const args=process.argv.slice(2), option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
  const reference=resolve(option('--reference',resolve(root,'rs3-chunkpicker-chunkinfo-export.json')));
  const wiki=resolve(option('--wiki',resolve(root,'.local/game-data/equipment-permanence-wiki.2026-10-08.v1.json')));
  const cache=resolve(option('--cache',defaultCache));
  const supplementalPaths = ['v1','v2'].map(version=>resolve(root,`.local/game-data/equipment-permanence-exceptions-wiki.2026-10-08.${version}.json`));
  const output=resolve(option('--output',resolve(root,'app/data/equipment-permanence.2026-10-08.v1.json')));
  if ([reference,wiki,resolve(cache,'items.v1.json'),resolve(cache,'items.manifest.v1.json')].includes(output)) throw new Error('Output must not replace an input');
  const [referenceBytes,wikiBytes,itemBytes,manifestBytes] = await Promise.all([readFile(reference),readFile(wiki),readFile(resolve(cache,'items.v1.json')),readFile(resolve(cache,'items.manifest.v1.json'))]);
  const supplementalBytes=await Promise.all(supplementalPaths.map(path=>readFile(path)));
  const result=buildEquipmentPermanence(JSON.parse(referenceBytes),JSON.parse(wikiBytes),JSON.parse(itemBytes),supplementalBytes.map(bytes=>JSON.parse(bytes)));
  result.provenance={reference:{path:'rs3-chunkpicker-chunkinfo-export.json',sha256:sha256RepositoryText(referenceBytes)},
    wiki:{path:'.local/game-data/equipment-permanence-wiki.2026-10-08.v1.json',sha256:sha256(wikiBytes),fetchedAt:JSON.parse(wikiBytes).fetchedAt,completedAt:JSON.parse(wikiBytes).completedAt},
    supplemental:supplementalPaths.map((path,index)=>({path:path.slice(root.length+1).replace(/\\/g,'/'),sha256:sha256(supplementalBytes[index])})),
    cache:{dataset:'items-2026-10-08-v2',itemsSha256:sha256(itemBytes),manifestSha256:sha256(manifestBytes),decoder:JSON.parse(itemBytes).decoder},
    implementation:await Promise.all(['scripts/research/build-equipment-permanence.mjs','scripts/research/equipment-wiki.mjs','app/data/equipment-permanence.mjs'].map(async path=>({path,sha256:sha256RepositoryText(await readFile(resolve(root,path)))})))};
  await mkdir(dirname(output),{recursive:true});
  if (output.includes(`${resolve(root,'.local')}`)) await writeFile(output,`${JSON.stringify(result)}\n`,{flag:'wx'});
  else {
    await writeFile(`${output}.tmp`,`${JSON.stringify(result)}\n`);
    await rename(`${output}.tmp`,output);
  }
  console.log(JSON.stringify(result.counts));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
