#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { parseEquipmentWikiPage, hasWikiFieldConflict } from './research/equipment-wiki.mjs';

const VERSION = '2026-10-08.v1';
const USER_AGENT = 'RS3ChunkPickerItemIcons/1.0 (local personal inventory icon evidence audit)';
export const ITEM_ICON_HASH_SCOPES = Object.freeze({
  sha256:'Saved PNG HTTP response body bytes',
  downloadSha1:'Saved PNG HTTP response body bytes',
  wikiSha1:'MediaWiki stored upload file bytes; may differ from CDN-optimized response bytes',
  timestamp:'MediaWiki upload version timestamp; not the HTTP Last-Modified or download timestamp',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const list = x => x == null ? [] : Array.isArray(x) ? x : [x];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Follow explicit item selectors and output tables; never turn labels or objects into items. */
export function extractItemNames(definitions) {
  const categories = { equipment: new Set(), taskRequirements: new Set(), taskOutputs: new Set(), bisGoals: new Set(), chunkSpawns: new Set(), shopStock: new Set() };
  const excluded = new Map(), namedShops = new Set();
  const add = (name, category, seen = new Set()) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const clean = name.replace(/\*/g, '').trim();
    if (seen.has(clean)) return;
    const alias = clean.match(/^(.*\[\+\])(?:x\d+)?$/);
    if (alias) {
      const aliases = definitions.codeItems?.itemsPlus ?? {};
      const matches=Object.keys(aliases).filter(key=>key.toLowerCase()===alias[1].toLowerCase());
      const key = Object.hasOwn(aliases,alias[1]) ? alias[1] : matches.length===1 ? matches[0] : null;
      if (key) for (const value of list(aliases[key])) add(value, category, new Set([...seen, clean]));
      else excluded.set(clean, matches.length>1?'ambiguous-declarative-item-selector':'unresolved-declarative-item-selector');
      return;
    }
    categories[category].add(clean);
  };
  for (const name of Object.keys(definitions.equipment ?? {})) add(name, 'equipment');
  const output = (category, name, seen = new Set()) => {
    if (typeof name !== 'string' || seen.has(name)) return;
    const table = definitions.skillItems?.[category]?.[name] ?? definitions.codeItems?.dropTables?.[name];
    if (table) for (const child of Object.keys(table)) output(category, child, new Set([...seen, name]));
    else add(name, 'taskOutputs');
  };
  for (const [category, rows] of Object.entries(definitions.challenges ?? {})) for (const row of Object.values(rows)) {
    for (const name of list(row.Items ?? row.Itmems)) {
      add(name, 'taskRequirements');
      if (list(row.Category).some(x => /BIS/i.test(x))) add(name, 'bisGoals');
    }
    for (const name of list(row.Output)) output(category, name);
    for (const name of list(row.Reward)) if (typeof name === 'string') add(name, 'taskOutputs');
  }
  const visit = row => {
    for (const [name, amount] of Object.entries(row.Spawn ?? {})) if (amount !== false) add(name, 'chunkSpawns');
    for (const [shop, available] of Object.entries(row.Shop ?? {})) if (available !== false) namedShops.add(shop);
    for (const section of Object.values(row.Sections ?? {})) visit(section);
  };
  for (const row of Object.values(definitions.chunks ?? {})) visit(row);
  for(const shop of Object.keys(definitions.taskUnlocks?.Shops ?? {})) if(!shop.includes('^')) namedShops.add(shop);
  for(const name of Object.keys(definitions.taskUnlocks?.Spawns ?? {})) if(!name.includes('^')) add(name,'chunkSpawns');
  for(const shop of namedShops) for (const [name,stock] of Object.entries(definitions.shopItems?.[shop] ?? {})) if(stock!==false) add(name,'shopStock');
  return { names: [...new Set(Object.values(categories).flatMap(set => [...set]))].sort(), categories: Object.fromEntries(Object.entries(categories).map(([k,v]) => [k,[...v].sort()])), excluded: [...excluded].map(([name,reason]) => ({ name,reason })), shopCoverage:{namedShops:namedShops.size,withoutStock:[...namedShops].filter(name=>!Object.hasOwn(definitions.shopItems??{},name)).sort()} };
}

export function inventoryImageFile(value) {
  const text = String(value ?? '').trim();
  const matches = [...text.matchAll(/\[\[(?:File|Image):([^|\]]+)(?:\|[^\]]*)?\]\]/gi)];
  if (matches.length === 1 && !/\{\{/.test(text)) return `File:${matches[0][1].trim().replace(/_/g,' ')}`;
  if (/^(?:File:)?[^\[\]{}|]+\.png$/i.test(text)) return `File:${text.replace(/^File:/i,'').replace(/_/g,' ')}`;
  return null;
}

/** Delivery encoding can differ from the stored Wiki upload; dimensions must agree. */
export function inventoryByteProvenance(bytes,info,getResponseHeaders) {
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Inventory response is not a PNG');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width!==info.width||height!==info.height)throw new Error('Inventory response dimensions differ from Wiki upload');
  return {downloadSha1:createHash('sha1').update(bytes).digest('hex'),wikiSha1:info.sha1,wikiUploadBytes:info.size,wikiUploadWidth:info.width,wikiUploadHeight:info.height,...(getResponseHeaders?{getResponseHeaders}: {})};
}

export function deliveryUploadComparison(icons) {
  const records=Object.values(icons),different=records.filter(x=>x.source.downloadSha1!==x.source.wikiSha1);
  return {sourceRecordsChecked:records.length,sourceRecordsMatching:different.length===0?records.length:records.length-different.length,sourceRecordsDifferent:different.length,uniquePngFilesChecked:new Set(records.map(x=>x.file)).size,uniquePngFilesWithAnyDifferentUploadHash:new Set(different.map(x=>x.file)).size};
}

/** ID selection uses the reviewed Wiki suffix. Exact-name fallback requires image agreement. */
export function selectInventoryImage(name, parsed, identity) {
  if (parsed.missing || !parsed.items.length) return { reason: 'missing-item-infobox' };
  const valid = parsed.items.filter(v => !hasWikiFieldConflict(v, ['id','name','image','version','bucketname']));
  let variants, identityMethod;
  if (identity?.status === 'verified') {
    variants = valid.filter(v => v.ids.includes(identity.cacheId) && v.suffix === identity.wiki.itemSuffix);
    identityMethod = 'verified-cache-wiki-variant';
    if (variants.length !== 1) return { reason: 'verified-variant-not-present-in-snapshot' };
  } else {
    variants = valid.filter(v => v.name === name);
    identityMethod = 'exact-name-infobox';
    if (!variants.length) return { reason: 'no-exact-item-name-variant' };
  }
  const files = variants.map(v => inventoryImageFile(v.fields.image));
  if (files.some(x => !x)) {
    const multiple=variants.some(v=>[...String(v.fields.image??'').matchAll(/\[\[(?:File|Image):([^|\]]+)(?:\|[^\]]*)?\]\]/gi)].length>1);
    return { reason:multiple?'multiple-inventory-images':'missing-or-dynamic-inventory-image' };
  }
  if (new Set(files).size !== 1) return { reason: 'ambiguous-variant-inventory-image' };
  return { fileTitle: files[0], identityMethod, infoboxName:variants[0].name, itemId: identity?.status === 'verified' ? identity.cacheId : null, variant: identity?.variant ?? null, itemSource: parsed.source };
}

export async function wikiQuery(parameters) {
  const url = new URL('https://runescape.wiki/api.php');
  for (const [k,v] of Object.entries({ action:'query', format:'json', formatversion:2, maxlag:5, ...parameters })) url.searchParams.set(k,v);
  for (let attempt=0; attempt<5; attempt++) {
    try {
      const response = await fetch(url, { headers:{'User-Agent':USER_AGENT}, signal:AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(JSON.stringify(data.error));
      await sleep(150); return data.query ?? {};
    } catch(error) { if(attempt===4) throw error; await sleep(1000 * 2**attempt); }
  }
}

async function loadJson(file, fallback) { try { return JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
async function saveJson(file, value) {
  const tmp=file+'.tmp';await writeFile(tmp, JSON.stringify(value,null,2)+'\n');
  // Windows scanners can briefly hold the destination after a checkpoint read.
  for(let attempt=0;attempt<15;attempt++) {
    try {await rename(tmp,file);return} catch(e) {if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt===14)throw e;await sleep(50*(attempt+1))}
  }
}
export async function exportItemIcons({ reference, review, snapshot, scratch, assetDirectory, manifestPath, concurrency=4 }) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('Image download concurrency must be an integer from 1 to 4');
  for(const file of [manifestPath,join(assetDirectory,'manifest.json')]) {
    try {await access(file)} catch(e) {if(e.code==='ENOENT')continue;throw e}
    throw new Error(`Finalized manifest already exists; select a new version/output: ${file}`);
  }
  await mkdir(scratch,{recursive:true}); await mkdir(assetDirectory,{recursive:true});
  const definitions = await loadJson(reference), identities = await loadJson(review), retained = await loadJson(snapshot);
  const request = extractItemNames(definitions);
  console.log(JSON.stringify({ requested:request.names.length, categories:Object.fromEntries(Object.entries(request.categories).map(([k,v])=>[k,v.length])), sample:request.names.slice(0,10), excluded:request.excluded.length }));
  const extraPath=join(scratch,'item-pages.json'), extra=await loadJson(extraPath,{pages:[],resolutions:{},requested:[]});
  const complete=new Set([...retained.requestedTitles,...extra.requested]);
  const pending=request.names.filter(x=>!complete.has(x));
  for(let i=0;i<pending.length;i+=40) {
    const titles=pending.slice(i,i+40), q=await wikiQuery({ titles:titles.join('|'),redirects:1,prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main' });
    const aliases=new Map([...(q.normalized??[]),...(q.redirects??[])].map(x=>[x.from,x.to]));
    for(const title of titles){let target=title, seen=new Set();while(aliases.has(target)&&!seen.has(target)){seen.add(target);target=aliases.get(target)}extra.resolutions[title]=target}
    extra.pages.push(...q.pages??[]);extra.requested.push(...titles);await saveJson(extraPath,extra);
    console.log(`Item pages ${i+titles.length}/${pending.length}`);
  }
  const pages=new Map([...retained.pages,...extra.pages].map(p=>[p.title,p])), resolutions={...retained.resolutions,...extra.resolutions};
  const identityMap=new Map(identities.identityReview.map(x=>[x.name,x]));
  const selections=new Map(), unmatched=request.excluded.map(x=>({...x,requested:false}));
  for(const name of request.names) {
    const page=pages.get(resolutions[name]??name), selected=selectInventoryImage(name,parseEquipmentWikiPage(page),identityMap.get(name));
    if(selected.reason) unmatched.push({name,reason:selected.reason}); else selections.set(name,selected);
  }
  const files=[...new Set([...selections.values()].map(x=>x.fileTitle))];
  const filePath=join(scratch,'file-pages.json'), filePages=await loadJson(filePath,{pages:[],requested:[],resolutions:{}}), fetched=new Set(filePages.requested);
  filePages.resolutions??={};
  const need=files.filter(x=>!fetched.has(x));
  for(let i=0;i<need.length;i+=40) {
    const titles=need.slice(i,i+40),q=await wikiQuery({titles:titles.join('|'),redirects:1,prop:'imageinfo|revisions',iiprop:'url|size|timestamp|sha1|mime|extmetadata',rvprop:'ids|timestamp|content',rvslots:'main'});
    const aliases=new Map([...(q.normalized??[]),...(q.redirects??[])].map(x=>[x.from,x.to]));
    for(const title of titles){let target=title,seen=new Set();while(aliases.has(target)&&!seen.has(target)){seen.add(target);target=aliases.get(target)}filePages.resolutions[title]=target}
    filePages.pages.push(...q.pages??[]);filePages.requested.push(...titles);await saveJson(filePath,filePages);
    console.log(`Inventory file metadata ${i+titles.length}/${need.length}`);
  }
  const fileMap=new Map(filePages.pages.map(p=>[p.title,p])), downloadsPath=join(scratch,'downloads.json');
  // A fully written temp checkpoint survives interrupted Windows rename safely.
  const downloads={...await loadJson(downloadsPath,{}),...await loadJson(downloadsPath+'.tmp',{})};
  let downloaded=0, downloadIndex=0, saveQueue=Promise.resolve();
  const persist=()=>saveQueue=saveQueue.then(()=>saveJson(downloadsPath,downloads));
  // Existing successful evidence must still match its PNG before reuse.
  for(const image of Object.values(downloads)) if(!image.reason) {
    const bytes=await readFile(join(assetDirectory,image.file));
    if(bytes.length!==image.bytes||hash(bytes)!==image.sha256)throw new Error(`Resume asset missing or altered: ${image.file}`);
    const page=fileMap.get(filePages.resolutions[image.source.fileTitle]??image.source.fileTitle),info=page?.imageinfo?.[0];
    if(!info)throw new Error(`Missing resume upload metadata: ${image.source.fileTitle}`);
    Object.assign(image.source,inventoryByteProvenance(bytes,info));
  }
  const urlDownloads=new Map();
  for(const image of Object.values(downloads)) if(!image.reason) urlDownloads.set(image.source.url,Promise.resolve(image));
  const fetchFile=async title=>{
    if(downloads[title]) return;
    const page=fileMap.get(filePages.resolutions[title]??title),info=page?.imageinfo?.[0],content=page?.revisions?.[0]?.slots?.main?.content??'';
    if(!info||info.mime!=='image/png'||!/{{\s*Inventory license\b/i.test(content)) { downloads[title]={reason:!info?'missing-file':info.mime!=='image/png'?'not-png':'not-inventory-licensed-file'};await persist();return; }
    if(urlDownloads.has(info.url)) {
      const image=await urlDownloads.get(info.url);downloads[title]={...image,source:{...image.source,fileTitle:title,filePageUrl:info.descriptionurl,fileRevisionId:page.revisions?.[0]?.revid,licenseTemplate:content.trim()}};await persist();return;
    }
    let finish;
    urlDownloads.set(info.url,new Promise(r=>{finish=r}));
    let bytes,getResponseHeaders;
    for(let attempt=0;attempt<5;attempt++) {
      try {const r=await fetch(info.url,{headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`Image HTTP ${r.status}`);getResponseHeaders=Object.fromEntries(['content-type','content-length','content-encoding','last-modified','etag','cf-polished','cf-cache-status'].map(key=>[key,r.headers.get(key)]).filter(([,value])=>value!==null));bytes=Buffer.from(await r.arrayBuffer());break}
      catch(e){if(attempt===4)throw e;await sleep(1000*2**attempt)}
    }
    const byteProvenance=inventoryByteProvenance(bytes,info,getResponseHeaders);
    const sha256=hash(bytes),filename=`item-${sha256.slice(0,24)}.png`;
    try {await writeFile(join(assetDirectory,filename),bytes,{flag:'wx'})} catch(e) {
      if(e.code!=='EEXIST')throw e;
      if(hash(await readFile(join(assetDirectory,filename)))!==sha256)throw new Error(`Refusing to replace existing PNG ${filename}`);
    }
    downloads[title]={file:filename,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,sha256,source:{kind:'wiki-inventory',fileTitle:title,filePageUrl:info.descriptionurl,timestamp:info.timestamp,downloadedAt:new Date().toISOString(),url:info.url,...byteProvenance,fileRevisionId:page.revisions?.[0]?.revid,licenseNote:'RuneScape inventory artwork; copyright Jagex Ltd. Wiki file page declares Inventory license (used with permission). Private local use; no redistribution grant inferred.',licenseTemplate:content.trim()}};
    finish(downloads[title]);const progress=++downloaded;await persist();if(progress%50===0)console.log(`Downloaded ${progress}/${files.length} inventory files`);
    await sleep(80);
  };
  const worker=async()=>{while(downloadIndex<files.length){const title=files[downloadIndex++];await fetchFile(title)}};
  await Promise.all(Array.from({length:concurrency},worker));await persist();
  const icons={};
  for(const [name,selection] of selections) {
    const image=downloads[selection.fileTitle];if(!image||image.reason){unmatched.push({name,reason:image?.reason??'missing-file'});continue}
    icons[name]={...image,aliases:[],...(selection.itemId!==null?{itemId:selection.itemId}:{}),source:{...image.source,identityMethod:selection.identityMethod,infoboxName:selection.infoboxName,requestedName:name,variant:selection.variant,itemPage:selection.itemSource}};
  }
  const uniqueFiles=new Map(Object.values(icons).map(x=>[x.file,x]));
  const coverage={requested:request.names.length,mapped:Object.keys(icons).length,excludedSelectors:request.excluded.length,unmatchedRequested:request.names.length-Object.keys(icons).length,shops:request.shopCoverage,bySource:{'wiki-inventory':Object.keys(icons).length},byIdentityMethod:{},byCategory:{}};
  for(const icon of Object.values(icons)) coverage.byIdentityMethod[icon.source.identityMethod]=(coverage.byIdentityMethod[icon.source.identityMethod]??0)+1;
  for(const [category,names]of Object.entries(request.categories)) coverage.byCategory[category]={requested:names.length,mapped:names.filter(x=>icons[x]).length};
  const manifest={schemaVersion:1,kind:'items',version:VERSION,assetDirectory:'icons-items.'+VERSION,generatedAt:new Date().toISOString(),source:{kind:'wiki-inventory',api:'https://runescape.wiki/api.php',userAgent:USER_AGENT,imageConcurrency:concurrency,apiBatchSize:40,apiDelayMs:150,imageDelayMs:80,referenceSha256:sha256RepositoryText(await readFile(reference)),identityReviewSha256:sha256RepositoryText(await readFile(review)),equipmentSnapshotSha256:hash(await readFile(snapshot)),additionalItemSnapshotSha256:hash(await readFile(extraPath)),fileMetadataSnapshotSha256:hash(await readFile(filePath)),rendererAssessment:'Pinned rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15 src/viewer/tabs/simplemodes.tsx ItemCameraMode and src/viewer/threejsrender.ts makeUIRenderer support a browser inventory camera at 36x32; src/headless/api.ts renderAppearance exports a 500x700 model view. Browser/WebGL stack unavailable in retained terrain runtime; declared Wiki inventory images used.',dimensionsPolicy:'Preserve original inventory PNG dimensions; application contains each within a 32px box.'},icons,unmatched:unmatched.sort((a,b)=>a.name.localeCompare(b.name)),coverage,totalBytes:[...uniqueFiles.values()].reduce((n,x)=>n+x.bytes,0),uniqueFiles:uniqueFiles.size};
  manifest.source.hashScopes={...ITEM_ICON_HASH_SCOPES};
  manifest.source.deliveryUploadComparison=deliveryUploadComparison(icons);
  await saveJson(manifestPath,manifest);await saveJson(join(assetDirectory,'manifest.json'),manifest);
  console.log(JSON.stringify({coverage,totalBytes:manifest.totalBytes,uniqueFiles:manifest.uniqueFiles,downloaded}));return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
  await exportItemIcons({reference:option('--reference','rs3-chunkpicker-chunkinfo-export.json'),review:option('--review','docs/research/cache-equipment-corrections.2026-10-08.v1.json'),snapshot:option('--snapshot','C:/Users/User/Projects/chunk-picker-rs3-wt/equip/.local/equipment-wiki.2026-10-08.v1.json'),scratch:option('--scratch','.local/item-icons.'+VERSION),assetDirectory:option('--assets','C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/icons-items.'+VERSION),manifestPath:option('--manifest','app/data/item-icons.'+VERSION+'.json'),concurrency:Number(option('--concurrency',4))});
}
