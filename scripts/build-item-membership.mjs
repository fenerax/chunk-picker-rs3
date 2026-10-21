import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildItemMembershipIndex, createItemMembershipLookup } from '../app/data/item-membership-index.mjs';
import { runtimeItemNames, wikiItemFacts, crosscheckItemMembership } from './lib/item-membership-evidence.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';

export function buildItemMembership({source,reference,wiki,output}={}) {
  if(!source||!reference||!wiki||!output)throw new Error('Specify --source, --reference, --wiki, --output.');
  const read=(dir,file)=>readFileSync(join(dir,file));
  const rawBytes=read(source,'items.raw.v1.json'),projectedBytes=read(source,'items.v1.json'),manifestBytes=read(source,'items.manifest.v1.json');
  const raw=JSON.parse(rawBytes),projected=JSON.parse(projectedBytes),manifest=JSON.parse(manifestBytes), referenceBytes=readFileSync(reference);
  for(const [file,bytes]of [['items.raw.v1.json',rawBytes],['items.v1.json',projectedBytes]]){
    const declared=manifest.outputs.find(o=>o.path.endsWith('/'+file));
    if(!declared||declared.sha256!==sha256(bytes))throw new Error(`Export manifest hash mismatch: ${file}`);
  }
  const entries=buildItemMembershipIndex(raw.records),index=new Map(entries.map(e=>[e.name,e])),rawById=new Map(raw.records.map(r=>[r.id,r]));
  const projectedById=new Map(projected.records.map(r=>[r.id,r]));
  for(const row of raw.records)if((row.definition.members===true)!==projectedById.get(row.id)?.members)throw new Error(`Raw/projected membership differs: ${row.id}`);
  const wikiManifestBytes=read(wiki,'wiki.manifest.v1.json'),wikiManifest=JSON.parse(wikiManifestBytes),selectionBytes=read(wiki,'selection.v1.json'),selection=JSON.parse(selectionBytes);
  if(sha256(selectionBytes)!==wikiManifest.selectionSha256||selection.sourceRawSha256!==sha256(rawBytes)||selection.referenceSha256!==sha256RepositoryText(referenceBytes))throw new Error('Wiki selection does not match inputs');
  const checks=[],pages=[],seen=new Set();
  for(const batch of wikiManifest.batches){
    const bytes=read(wiki,batch.file);if(sha256(bytes)!==batch.sha256)throw new Error(`Wiki batch hash mismatch: ${batch.file}`);
    const evidence=JSON.parse(bytes),facts=evidence.payload.query.pages.map(wikiItemFacts);pages.push(...facts);
    const redirects=new Map([...(evidence.payload.query.normalized??[]),...(evidence.payload.query.redirects??[])].map(r=>[r.from,r.to]));
    for(const requested of evidence.requestedTitles){
      let title=requested;for(let step=0;step<10&&redirects.has(title);step++)title=redirects.get(title);
      const fact=facts.find(f=>f.title===title),entry=index.get(requested);
      if(!fact){checks.push({name:requested,status:'missing-response-page'});continue;}
      if(!entry){checks.push({name:requested,title:fact.title,revid:fact.revid,status:'unmatched-cache-name'});continue;}
      const check=crosscheckItemMembership(entry,fact,rawById);checks.push(check);seen.add(requested);
      if(check.status==='conflict-resolved-by-explicit-wiki-ids')entry.wikiResolution=check.resolution;
      if(check.status==='cache-wiki-disagreement')entry.wikiDisagreement={members:check.members,ids:check.ids,title:fact.title,revid:fact.revid,url:fact.url};
    }
  }
  for(const name of selection.conflictNames)if(!seen.has(name))throw new Error(`Runtime conflict was not crosschecked: ${name}`);
  const lookup=createItemMembershipLookup(entries),runtime=runtimeItemNames(JSON.parse(referenceBytes)).map(row=>{
    const fact=lookup(row.name);return {...row,status:fact.status,members:fact.members,reason:fact.reason,candidateIds:fact.candidateIds};
  });
  const count=(rows,key)=>Object.fromEntries([...new Set(rows.map(r=>r[key]))].sort().map(value=>[String(value),rows.filter(r=>r[key]===value).length]));
  const result={schemaVersion:1,id:'item-membership:2026-10-08:v1',generatedAt:'2026-10-08',
    provenance:{raw:{file:'items.raw.v1.json',sha256:sha256(rawBytes)},projected:{file:'items.v1.json',sha256:sha256(projectedBytes)},manifest:{file:'items.manifest.v1.json',sha256:sha256(manifestBytes)},
      decoder:raw.decoder,reference:{file:'rs3-chunkpicker-chunkinfo-export.json',sha256:sha256RepositoryText(referenceBytes)},
      wiki:{manifest:'wiki.manifest.v1.json',sha256:sha256(wikiManifestBytes),selectionSha256:sha256(selectionBytes),batches:wikiManifest.batches.map(b=>({file:b.file,sha256:b.sha256})),schema:wikiManifest.schema}},
    policy:{field:'raw.definition.members',opcode:'0x10',semantics:'Pinned decoder schema reads opcode 0x10 as true; absent opcode defaults false. Raw booleans crosschecked against the projected export. No numeric param is used.',
      templates:'Exclude all note, loan, bind and combine template definitions, including old opcode forms.',
      matching:'NFC plus legacy text decoding; exact name first; casefold only for one exact name. Markup and trailing picker markers belong to the caller.',
      conflicts:'Cache name conflicts are unknown unless pinned Infobox Item literal IDs match that exact cache name, every selected ID has an explicit consistent Wiki membership field, and the cache flags agree. Wiki IDs narrow identity; other candidate IDs remain recorded.',
      limits:['Membership of an item is distinct from membership or availability of each acquisition/processing source.','Copied cache and pinned Wiki snapshots are dated evidence, not a live game-client or server guarantee.','Missing or unresolved names keep an explicit unknown classification.']},
    summary:{decodedRows:raw.records.length,namedEntries:entries.length,cacheFree:entries.filter(e=>e.members===false).length,cacheMembers:entries.filter(e=>e.members===true).length,cacheConflicts:entries.filter(e=>e.members===null).length,
      wikiResolvedConflicts:entries.filter(e=>e.wikiResolution).length,runtimeNames:runtime.length,runtimeStatuses:count(runtime,'status'),runtimeReasons:count(runtime,'reason'),wikiTitles:selection.titles.length,wikiChecks:count(checks,'status')},
    entries,runtimeCoverage:runtime,wikiCrosschecks:checks.map(({resolution,...check})=>check),wikiPages:pages.map(({fields,variants,...page})=>({...page,fields,variants}))};
  writeFileSync(output,JSON.stringify(result)+'\n');return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];console.log(JSON.stringify(buildItemMembership(options).summary,null,2));}
