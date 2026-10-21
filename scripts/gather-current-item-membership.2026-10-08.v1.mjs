import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './lib/provenance-hash.mjs';

// Explicit identity reviews, not string substitutions. All other titles use
// their exact picker name and the Wiki's recorded redirects.
export const reviewedAliasQueries = {
  'Spirit shards pack': { title:'Spirit shard pack',identity:'Picker plural spelling of the named 5000-shard pack.' },
  'Crawling hand': { title:'Crawling hand (item)',identity:'Inventory drop, distinct from the same-name Slayer creature.' },
  'Cat': { title:'Cat',cacheNames:['Pet cat'],identity:'Adult cat inventory item; exclude kitten and NPC IDs.' },
  'Kitten': { title:'Cat',cacheNames:['Pet kitten'],identity:'Kitten inventory item; exclude adult and NPC IDs.' },
};

const pseudoEntity = name => name.startsWith('Revenant Spirit#') || ['Nothing','Slayer XP','Runes for Slayer Dart'].includes(name);

export async function gatherCurrentItemMembership({selection,source,output}={}) {
  if(!selection||!source||!output)throw new Error('Specify --selection --source --output.');
  const selectionBytes=readFileSync(selection),input=JSON.parse(selectionBytes);
  const names=[...new Set(Array.isArray(input)?input:input.names??input.unknownNames??[])].sort((a,b)=>a.localeCompare(b,'en'));
  if(!names.length||names.length>112||names.some(n=>typeof n!=='string'))throw new Error('Current unknown selection requires 1–112 exact names.');
  const queries=names.map(name=>pseudoEntity(name)?{name,skip:'pseudoentity-without-inventory-identity'}:{name,...(reviewedAliasQueries[name]??{title:name,identity:'Exact picker name, resolved only by recorded Wiki redirect/item IDs.'})});
  const titles=[...new Set(queries.filter(q=>!q.skip).map(q=>q.title))].sort((a,b)=>a.localeCompare(b,'en'));
  if(titles.length>100)throw new Error('At most five batches of twenty titles.');
  const rawBytes=readFileSync(join(source,'items.raw.v1.json'));
  mkdirSync(output,{recursive:true});
  const pinned={schemaVersion:1,selectionSha256:sha256(selectionBytes),sourceRawSha256:sha256(rawBytes),names,queries,titles};
  const pinnedPath=join(output,'queries.v1.json');
  if(existsSync(pinnedPath)&&JSON.stringify(JSON.parse(readFileSync(pinnedPath)))!==JSON.stringify(pinned))throw new Error('Use a new snapshot version for a changed current-unknown selection.');
  if(!existsSync(pinnedPath))writeFileSync(pinnedPath,JSON.stringify(pinned,null,2)+'\n',{flag:'wx'});
  const batches=[];
  for(let offset=0;offset<titles.length;offset+=20){
    const requestedTitles=titles.slice(offset,offset+20),file=`wiki-batch-${String(offset/20+1).padStart(3,'0')}.v1.json`,path=join(output,file);
    if(!existsSync(path)){
      const url=new URL('https://runescape.wiki/api.php');url.search=new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main',redirects:'1',titles:requestedTitles.join('|'),format:'json',formatversion:'2'});
      const response=await fetch(url,{headers:{'User-Agent':'RS3ChunkPickerMembershipAudit/1.0 (100 current unknown item names; public pinned infobox review)'}});
      if(!response.ok)throw new Error(`Wiki API ${response.status}`);
      const payload=await response.json();if(payload.error||!payload.query?.pages)throw new Error('Wiki API returned no page evidence');
      writeFileSync(path,JSON.stringify({retrievedAt:new Date().toISOString(),url:String(url),requestedTitles,payload},null,2)+'\n',{flag:'wx'});
    }
    const bytes=readFileSync(path),batch=JSON.parse(bytes);
    if(JSON.stringify(batch.requestedTitles)!==JSON.stringify(requestedTitles))throw new Error('Pinned batch titles differ');
    batches.push({file,sha256:sha256(bytes),revisions:batch.payload.query.pages.flatMap(p=>p.revisions?.map(r=>({title:p.title,revid:r.revid,timestamp:r.timestamp}))??[])});
    console.log(JSON.stringify({batch:offset/20+1,titles:requestedTitles.length}));
  }
  const manifest={schemaVersion:1,names:names.length,titles:titles.length,selectionFile:'queries.v1.json',selectionSha256:sha256(readFileSync(pinnedPath)),batches};
  writeFileSync(join(output,'wiki.manifest.v1.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2)options[args[i].slice(2)]=args[i+1];console.log(JSON.stringify(await gatherCurrentItemMembership(options)));}
