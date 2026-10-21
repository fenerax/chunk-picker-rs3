import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildItemMembershipIndex } from '../app/data/item-membership-index.mjs';
import { runtimeItemNames } from './lib/item-membership-evidence.mjs';
import { sha256, sha256RepositoryText } from './lib/provenance-hash.mjs';

export const namedMembershipExamples = ['Onyx','Uncut onyx','Onyx ring','Onyx necklace','Onyx bracelet','Onyx amulet',
  'Onyx amulet (unstrung)','Amulet of fury','Amulet of glory','Amulet of glory (4)',
  'Magic logs','Magic shortbow','Magic shortbow (unstrung)','Magic longbow','Magic longbow (unstrung)',
  'Magic stock','Magic incense sticks','Magic pyre logs','Magic planks','Magic plank','Magic frame','Arrow shaft',
  'Saradomin staff','Guthix staff','Zamorak staff','Uncut sapphire','Uncut emerald','Uncut ruby','Uncut diamond',
  'Uncut dragonstone','Sapphire','Emerald','Ruby','Diamond','Dragonstone','Sapphire ring','Emerald ring','Ruby ring',
  'Diamond ring','Dragonstone ring','Sapphire necklace','Emerald necklace','Ruby necklace','Diamond necklace',
  'Dragonstone necklace','Sapphire amulet','Emerald amulet','Ruby amulet','Diamond amulet','Dragonstone amulet'];

export async function gatherWikiMembership({source, reference, output, batchSize=20, sampleSize=120}={}) {
  if (!source || !reference || !output) throw new Error('Specify --source, --reference, --output. Only exported cache JSON is read.');
  if (batchSize < 1 || batchSize > 20 || sampleSize < 1 || sampleSize > 200) throw new Error('Bounded Wiki batches: 1–20 titles; sample 1–200 names.');
  mkdirSync(output,{recursive:true});
  const rawBytes=readFileSync(join(source,'items.raw.v1.json')), raw=JSON.parse(rawBytes);
  const referenceBytes=readFileSync(reference), definitions=JSON.parse(referenceBytes);
  const entries=buildItemMembershipIndex(raw.records), index=new Map(entries.map(e=>[e.name,e]));
  const runtime=runtimeItemNames(definitions), conflicts=runtime.filter(r=>index.get(r.name)?.members===null);
  const matched=runtime.filter(r=>index.has(r.name) && index.get(r.name).members!==null);
  // Evenly spaced lexicographic sample, reproducible over the runtime names.
  const sample=Array.from({length:Math.min(sampleSize,matched.length)},(_,i)=>matched[Math.floor(i*matched.length/Math.min(sampleSize,matched.length))].name);
  const desired=[...new Set([...conflicts.map(r=>r.name),...namedMembershipExamples,...sample])].sort((a,b)=>a.localeCompare(b,'en'));
  const selectionFile=join(output,'selection.v1.json'),previous=existsSync(selectionFile)?JSON.parse(readFileSync(selectionFile)):null;
  if(previous && (previous.sourceRawSha256!==sha256(rawBytes)||previous.referenceSha256!==sha256RepositoryText(referenceBytes))) throw new Error('Pinned collection inputs differ.');
  const selected=previous ? [...previous.titles,...desired.filter(title=>!previous.titles.includes(title))] : desired;
  if (selected.length>1500) throw new Error('Wiki collection exceeds the audited 1500-title bound.');
  const selection={schemaVersion:1,sourceRawSha256:sha256(rawBytes),referenceSha256:sha256RepositoryText(referenceBytes),
    batchSize,sampleSize,conflictNames:conflicts.map(r=>r.name),namedExamples:namedMembershipExamples,systematicSample:sample,titles:selected};
  writeFileSync(selectionFile,JSON.stringify(selection,null,2)+'\n');
  const groups=[];let cursor=0,batchNumber=1;
  while(existsSync(join(output,`wiki-batch-${String(batchNumber).padStart(3,'0')}.v1.json`))){
    const previousBatch=JSON.parse(readFileSync(join(output,`wiki-batch-${String(batchNumber).padStart(3,'0')}.v1.json`)));
    if(JSON.stringify(previousBatch.requestedTitles)!==JSON.stringify(selected.slice(cursor,cursor+previousBatch.requestedTitles.length)))throw new Error('Existing pinned batch order differs.');
    groups.push(previousBatch.requestedTitles);cursor+=previousBatch.requestedTitles.length;batchNumber++;
  }
  for(;cursor<selected.length;cursor+=batchSize)groups.push(selected.slice(cursor,cursor+batchSize));
  const batches=[];
  for(let batchIndex=0;batchIndex<groups.length;batchIndex++){
    const titles=groups[batchIndex], file=`wiki-batch-${String(batchIndex+1).padStart(3,'0')}.v1.json`, path=join(output,file);
    if(!existsSync(path)){
      const url=new URL('https://runescape.wiki/api.php');
      url.search=new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main',redirects:'1',titles:titles.join('|'),format:'json',formatversion:'2'});
      const response=await fetch(url,{headers:{'User-Agent':'RS3ChunkPickerMembershipAudit/1.0 (bounded public item infobox review)'}});
      if(!response.ok)throw new Error(`Wiki API ${response.status}`);
      const payload=await response.json();if(payload.error||!payload.query?.pages)throw new Error(`Wiki response failed: ${JSON.stringify(payload.error)}`);
      writeFileSync(path,JSON.stringify({retrievedAt:new Date().toISOString(),url:String(url),requestedTitles:titles,payload},null,2)+'\n',{flag:'wx'});
    }
    const bytes=readFileSync(path), evidence=JSON.parse(bytes);
    batches.push({file,sha256:sha256(bytes),pages:evidence.payload.query.pages.length,revisions:evidence.payload.query.pages.flatMap(p=>p.revisions?.map(r=>({title:p.title,revid:r.revid,timestamp:r.timestamp}))??[])});
    console.log(JSON.stringify({batch:batchIndex+1,total:groups.length,titles:titles.length}));
  }
  const decoder=raw.decoder, schemaUrl=`https://raw.githubusercontent.com/skillbert/rsmv/${decoder.commit}/src/opcodes/items.jsonc`;
  const schemaPath=join(output,'items.decoder-schema.jsonc');
  if(!existsSync(schemaPath)){const response=await fetch(schemaUrl);if(!response.ok)throw new Error('Pinned schema retrieval failed');writeFileSync(schemaPath,Buffer.from(await response.arrayBuffer()),{flag:'wx'});}
  const schemaBytes=readFileSync(schemaPath),schemaHash=sha256(schemaBytes);
  const crlfSchemaHash=sha256(schemaBytes.toString('utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
  if(schemaHash!==decoder.schemaHashes['items.jsonc'] && crlfSchemaHash!==decoder.schemaHashes['items.jsonc'])throw new Error('Pinned schema does not match copied export provenance, including its Windows checkout line endings');
  const manifestPath=join(output,'wiki.manifest.v1.json');
  const createdAt=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath)).createdAt:new Date().toISOString();
  const manifest={schemaVersion:1,createdAt,selectionFile:'selection.v1.json',selectionSha256:sha256(readFileSync(selectionFile)),
    titles:selected.length,conflicts:conflicts.length,systematicSample:sample.length,batches,
    schema:{url:schemaUrl,file:'items.decoder-schema.jsonc',sha256:schemaHash,exportSchemaSha256:decoder.schemaHashes['items.jsonc'],
      match: schemaHash===decoder.schemaHashes['items.jsonc'] ? 'exact bytes' : 'same schema text; exported decoder checkout uses CRLF',opcode:'0x10',field:'members',read:'true'}};
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];
  const result=await gatherWikiMembership(options);console.log(JSON.stringify({titles:result.titles,conflicts:result.conflicts,batches:result.batches.length}));
}
