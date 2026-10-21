import { readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './lib/provenance-hash.mjs';
import { wikiAliasItemFacts,resolveWikiItemAlias } from './lib/item-membership-alias-evidence.mjs';

export function buildItemMembershipAliases({source,wiki,priorWiki,output}={}) {
  if(!source||!wiki||!output)throw new Error('Specify --source --wiki --output.');
  const rawBytes=readFileSync(join(source,'items.raw.v1.json')),raw=JSON.parse(rawBytes),rawById=new Map(raw.records.map(r=>[r.id,r]));
  const manifestBytes=readFileSync(join(wiki,'wiki.manifest.v1.json')),manifest=JSON.parse(manifestBytes);
  const selectionBytes=readFileSync(join(wiki,manifest.selectionFile)),selection=JSON.parse(selectionBytes);
  if(sha256(rawBytes)!==selection.sourceRawSha256||sha256(selectionBytes)!==manifest.selectionSha256)throw new Error('Alias evidence input hash differs');
  const pages=new Map(),redirects=new Map(),pageSources=new Map();
  for(const record of manifest.batches){
    const bytes=readFileSync(join(wiki,record.file));if(sha256(bytes)!==record.sha256)throw new Error('Alias Wiki batch hash differs');
    const batch=JSON.parse(bytes);
    for(const redirect of [...(batch.payload.query.normalized??[]),...(batch.payload.query.redirects??[])])redirects.set(redirect.from,redirect.to);
    for(const page of batch.payload.query.pages){pages.set(page.title,page);pageSources.set(page.title,record.file);}
  }
  const priorPages=new Map(),priorSources=new Map(),supplementProvenance=[];
  if(priorWiki){
    const priorManifestBytes=readFileSync(join(priorWiki,'wiki.manifest.v1.json')),priorManifest=JSON.parse(priorManifestBytes);
    supplementProvenance.push({snapshot:'item-membership-2026-10-08-v1',manifestSha256:sha256(priorManifestBytes)});
    for(const record of priorManifest.batches){
      const bytes=readFileSync(join(priorWiki,record.file));if(sha256(bytes)!==record.sha256)throw new Error('Prior Wiki alias batch hash differs');
      for(const page of JSON.parse(bytes).payload.query.pages){priorPages.set(page.title,page);priorSources.set(page.title,record);}
    }
  }
  const reviews=selection.queries.map(query=>{
    if(query.skip)return {name:query.name,status:'unknown',reason:query.skip,query};
    const chain=[query.title];let title=query.title;for(let i=0;i<10&&redirects.has(title);i++){title=redirects.get(title);chain.push(title);}
    const page=pages.get(title);if(!page)return {name:query.name,status:'unknown',reason:'missing-response-page',query,redirectChain:chain};
    const facts=wikiAliasItemFacts(page),resolution=resolveWikiItemAlias(query.name,facts,rawById,query);
    return {...resolution,query,redirectChain:chain,source:pageSources.get(title),facts};
  });
  const typo=reviews.find(r=>r.name==='Off-hand mihril crossbow'),correct=priorPages.get('Off-hand mithril crossbow');
  if(typo&&correct){
    const facts=wikiAliasItemFacts(correct),resolution=resolveWikiItemAlias(typo.name,facts,rawById);
    Object.assign(typo,resolution,{query:{name:typo.name,title:correct.title,identity:'Explicit picker spelling error: mihril versus mithril; existing pinned article and literal item ID establish identity.'},
      redirectChain:[correct.title],source:priorSources.get(correct.title),sourceSnapshot:'item-membership-2026-10-08-v1',facts});
  }
  const entries=reviews.filter(r=>typeof r.members==='boolean').map(({facts,...review})=>review);
  const hand=reviews.find(r=>r.name==='Crawling hand (item)'&&typeof r.members==='boolean');
  if(hand)entries.push({...entries.find(e=>e.name===hand.name),name:'Crawling hand',query:{name:'Crawling hand',title:'Crawling hand (item)',identity:'Exact cache item name for the reviewed inventory drop; NPC selectors do not use item membership.'}});
  const summary={selectedNames:selection.names.length,queriedTitles:selection.titles.length,
    resolvedFree:reviews.filter(r=>r.members===false).length,resolvedMembers:reviews.filter(r=>r.members===true).length,
    unknown:reviews.filter(r=>r.status==='unknown').length,totalAliasEntries:entries.length,supplementaryAliases:entries.length-reviews.filter(r=>typeof r.members==='boolean').length};
  const result={schemaVersion:1,id:'item-membership-aliases:2026-10-08:v1',generatedAt:'2026-10-08',
    provenance:{rawSha256:sha256(rawBytes),decoder:raw.decoder,selectionSha256:sha256(selectionBytes),wikiManifestSha256:sha256(manifestBytes),batches:manifest.batches.map(({file,sha256})=>({file,sha256})),supplements:supplementProvenance},
    policy:{matching:'Exact reviewed picker aliases only; no generated name substitution. Only consulted when ordinary catalogue lookup is unknown.',
      identity:'Literal IDs from pinned balanced Infobox Item templates establish cache identity. NPC and Recipe IDs never count. Raw cache names may be charged/colour/stage variants or a recorded Wiki redirect.',
      membership:'Every selected Wiki ID must exist as a named non-template cache item, have an explicit boolean Wiki members field, agree with its raw cache flag, and agree with all selected IDs. A single rejected ID or mixed flag leaves unknown.',
      limits:['Membership does not certify a free acquisition method or quest/activity availability.','Pseudoentities and historical variants without explicit current matching IDs remain unknown.']},summary,entries,reviews};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];console.log(JSON.stringify(buildItemMembershipAliases(options).summary,null,2));}
