#!/usr/bin/env node
import { readFileSync, writeFileSync, createReadStream, realpathSync } from 'node:fs';
import { resolve, join, basename, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { inCrop } from './cache/surface.mjs';
import { placementColumns, definitionActions, memberActions, resolveResourceDefinition, effectiveDisplayPlane, componentMasks, resourceWitness, buildSelectors, recoverSourceOrdinal } from './cache/resource-catalogue.mjs';

const repo = fileURLToPath(new URL('../',import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes);
const read = path => readFileSync(path);
// Keep the app's placed duo-data root independent from this copied-cache pack.
const permittedRoot = resolve(process.env.RS3_RESOURCE_GAME_DATA_DIR ?? process.env.RS3_GAME_DATA_DIR ?? 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data').replaceAll('\\','/');
export const resourceMaskDefaults = Object.freeze({
  path:`${permittedRoot}/walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz`,
  walkabilitySha256:'d553ed49ce12254d197e82abe673279f3bb1ede5eb34098cf0376e68bd67fdf6',
  membershipSha256:'972366f985be500c96c432246e18b79d6d9b56568ea74c7889c2189ab8d65173',
  manifestSha256:'ceade7b9d46e1cff30e5279ff99dfc26c6ff2459930e1502a010a614a1806f0d',
});
function assertSource(path) {
  const inside=(root,target)=>{const rel=relative(root,target);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&!isAbsolute(rel);};
  const normalized=resolve(path);
  if(!inside(permittedRoot,normalized))throw new Error('Resource source must be inside the authorized game-data directory.');
  // Resolve links as well as lexical paths, including links on individual files.
  if(!inside(realpathSync(permittedRoot),realpathSync(normalized)))throw new Error('Resource source must be inside the authorized game-data directory.');
}
const readSource=path=>{assertSource(path);return read(path);};
/** This bundle is mandatory: failed/missing masks must never downgrade to the
 * narrow selector-evidence anchors. Validate the copied bytes and their cache
 * identities before using any component label. */
export function verifyResourceMaskManifest({manifestBytes,walkBytes,membershipBytes,objectManifest,walk,evidence,corrections}) {
  const manifest=parse(manifestBytes), inputs=[['walkability.v1.json.gz',walkBytes,resourceMaskDefaults.walkabilitySha256],['membership.v1.json',membershipBytes,resourceMaskDefaults.membershipSha256]];
  if(hash(manifestBytes)!==resourceMaskDefaults.manifestSha256)throw new Error('Pinned mask manifest hash mismatch.');
  for(const [file,bytes,expected] of inputs){const row=manifest.outputs.find(r=>basename(r.path)===file);if(hash(bytes)!==expected||row?.sha256!==expected||row?.bytes!==bytes.length)throw new Error(`Pinned mask input/manifest hash mismatch: ${file}`);}
  if(evidence.provenance.walkabilitySha256!==resourceMaskDefaults.walkabilitySha256||corrections.provenance.walkabilitySha256!==resourceMaskDefaults.walkabilitySha256)throw new Error('Spatial evidence/corrections mask hash mismatch.');
  const tool=manifest.tool,decoder=objectManifest.decoder;
  if(tool.commit!==decoder.commit||tool.buildSchema!==decoder.buildSchema||tool.commit!==walk.provenance.toolCommit||tool.buildSchema!==walk.provenance.buildSchema||JSON.stringify(tool.sourceHashes)!==JSON.stringify(decoder.sourceHashes)||JSON.stringify(tool.sourceHashes)!==JSON.stringify(evidence.provenance.decoderSourceHashes))throw new Error('Mask decoder identity mismatch.');
  if(manifest.layout.mapId!==28||manifest.layout.plane!==0||walk.provenance.mapId!==28||walk.provenance.plane!==0)throw new Error('Mask surface identity mismatch.');
  if(manifest.reference.sha256!==objectManifest.reference.sha256||manifest.reference.sha256!==walk.provenance.referenceSha256)throw new Error('Mask reference identity mismatch.');
  for(const source of manifest.sources){const compact=walk.provenance.snapshot.find(r=>r[0]===source.major);if(!compact||compact[1]!==source.sha256||compact[2]!==source.indexTimestamp)throw new Error(`Mask snapshot identity mismatch: ${source.major}`);}
  for(const source of objectManifest.sources){const maskSource=manifest.sources.find(s=>s.major===source.major);if(maskSource&&(maskSource.sha256!==source.sha256||maskSource.indexTimestamp!==source.indexTimestamp))throw new Error(`Object/mask source identity mismatch: ${source.major}`);}
  for(const [file,sha256] of Object.entries(evidence.provenance.sourceHashes)){if(manifest.sources.find(s=>s.name===file)?.sha256!==sha256)throw new Error(`Selector evidence source identity mismatch: ${file}`);}
  return {file:'walkability.v1.json.gz',sha256:resourceMaskDefaults.walkabilitySha256,manifest:{file:'manifest.v1.json',sha256:hash(manifestBytes)},membership:{file:'membership.v1.json',sha256:hash(membershipBytes)},decoder:tool,sources:manifest.sources,reference:manifest.reference,method:'Mandatory pinned full component masks; exact anchor tile or rotated cardinal footprint perimeter within placement base chunk; source plane checked using paste translation.'};
}
export function validateResourceMaskCoverage(fullWalk,walk,regions) {
  const compact=new Map(walk.regions.map(r=>[r[0],r])),seen=new Set();
  for(const row of fullWalk.regions){const id=String(row.id),r=compact.get(id);if(seen.has(id)||!r||r[1]!==row.status)throw new Error(`Walkability coverage mismatch: ${id}`);seen.add(id);
    const expected=(r[3]??[]).map(c=>[c[0],c[1]]),actual=(row.components??[]).map(c=>[c.label,c.tiles]);
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error(`Walkability component mismatch: ${id}`);
    const mask=regions.get(id);if(row.status==='decoded'&&!mask)throw new Error(`Missing decoded component mask: ${id}`);
    if(mask){if(row.masks.order!=='x*64+z'||row.masks.componentType!=='uint16-le'||row.masks.encoding!=='base64')throw new Error(`Unsupported component mask encoding: ${id}`);
      const counts=new Map();for(let i=0;i<4096;i++){const label=mask.labels.readUInt16LE(i*2);if(label)counts.set(label,(counts.get(label)??0)+1);}
      if(JSON.stringify([...counts].sort((a,b)=>a[0]-b[0]))!==JSON.stringify(expected))throw new Error(`Walkability label/count mismatch: ${id}`);
    }
  }
  if(seen.size!==compact.size||JSON.stringify(fullWalk.summary.crop)!==JSON.stringify(walk.summary.crop))throw new Error('Walkability mask crop/coverage mismatch.');
}
export function loadResourceMasks({path=resourceMaskDefaults.path,objectManifest,walk,evidence,corrections}) {
  const maskPath=resolve(path);assertSource(maskPath);
  const maskBytes=readSource(maskPath),maskManifestBytes=readSource(join(dirname(maskPath),'manifest.v1.json')),membershipBytes=readSource(join(dirname(maskPath),'membership.v1.json'));
  const provenance=verifyResourceMaskManifest({manifestBytes:maskManifestBytes,walkBytes:maskBytes,membershipBytes,objectManifest,walk,evidence,corrections});
  const fullWalk=parse(gunzipSync(maskBytes)),regions=componentMasks(fullWalk,corrections);
  validateResourceMaskCoverage(fullWalk,walk,regions);
  return {provenance,regions};
}
/** The pinned placement exporter always starts a record with its stable ID.
 * These delimiters cannot occur inside escaped JSON strings or nested records
 * (which start objectId/source fields). Boundaries are processed in native
 * string searches instead of copying every character of a multi-GB dataset. */
export async function* readPlacementRows(path) {
  assertSource(path);
  const stream=createReadStream(path).pipe(createGunzip());stream.setEncoding('utf8');
  yield* readPlacementChunks(stream);
}
export async function* readPlacementChunks(stream) {
  let buffer='',started=false,count=0;
  for await(const chunk of stream){buffer+=chunk;
    if(!started){const at=buffer.indexOf('"placements":[');if(at<0){if(buffer.length>4*1024*1024)throw new Error('Missing placements array');continue;}buffer=buffer.slice(at+14);started=true;}
    let at;while((at=buffer.indexOf('},{"id":"object-'))>=0){const text=buffer.slice(0,at+1);buffer=buffer.slice(at+2);count++;yield text;}
    if(buffer.length>8*1024*1024)throw new Error('Unexpected placement record schema');
  }
  const end=buffer.lastIndexOf('],"summary":');
  if(!started||end<0||!buffer.endsWith('}'))throw new Error('Truncated placement dataset');
  if(buffer.slice(0,end)){count++;yield buffer.slice(0,end);}
  const summary=JSON.parse(`{${buffer.slice(end+2)}`);
  if(summary.summary.mappedPlacements!==count)throw new Error('Placement record count differs from exporter summary');
}
export async function buildResourceCatalogue(options={}) {
  const input=resolve(options.input??`${permittedRoot}/objects-2026-10-08-v3`);assertSource(input);
  const output=resolve(options.output??join(repo,'app/data/cache-resources.2026-10-08.v1.json'));
  const selectorsOutput=resolve(options.selectors??join(repo,'app/data/cache-resource-selectors.2026-10-08.v1.json'));
  for(const path of [output,selectorsOutput]) if(!path.replaceAll('\\','/').toLowerCase().startsWith(repo.replaceAll('\\','/').toLowerCase()))throw new Error('Output must remain in this worktree.');
  const manifestPath=join(input,'objects.manifest.v1.json'),manifestBytes=readSource(manifestPath),manifest=parse(manifestBytes);
  const sourceNames=['objects.definitions.v1.json.gz','objects.layouts.v1.json.gz','objects.placements.v1.json.gz','objects.retained-comparison.v1.json.gz'];
  const inputs=[];
  // Bind the exact compressed input bytes, not merely a source path or summary.
  for(const name of sourceNames){const path=join(input,name),sha256=hash(readSource(path)),declared=manifest.outputs.find(row=>basename(row.path)===name);if(!declared||declared.sha256!==sha256)throw new Error(`Manifest hash mismatch: ${name}`);inputs.push({file:name,sha256});}
  const rawRows=parse(gunzipSync(readSource(join(input,sourceNames[0])))).definitions;
  const rawDefinitions=new Map(rawRows.map(d=>[d.objectId,d.raw]));
  const resolved=new Map(),definitions=[];
  for(const row of rawRows){const r=resolveResourceDefinition(row.objectId,rawDefinitions);if(!r.classKeys.length&&!r.possibleClassKeys?.length)continue;resolved.set(row.objectId,r);definitions.push({objectId:row.objectId,name:row.name,actions:definitionActions(row.raw),memberActions:memberActions(row.raw),classKeys:r.classKeys,possibleClassKeys:r.possibleClassKeys??r.classKeys,conditionalPolicy:r.policy,leafObjectIds:r.leaves,leafNames:[...new Set(r.leaves.map(id=>rawDefinitions.get(id)?.name).filter(Boolean))],footprint:r.footprint,membersFlags:{is_members:row.raw.is_members??null,isMembers:row.raw.isMembers??null},definitionSource:{major:16,minor:Math.floor(row.objectId/256),subfile:row.objectId%256},...(r.branches?{branchReview:{count:r.branches.length,absent:r.branches.filter(b=>b.absentState).length,problems:[...new Set(r.branches.map(b=>b.problem).filter(Boolean))],sha256:hash(Buffer.from(JSON.stringify(r.branches))),source:'objects.definitions.v1.json.gz raw morph selector paths'}}:{})});}
  definitions.sort((a,b)=>a.objectId-b.objectId);
  const walkPath=join(repo,'app/data/cache-walkability.2026-10-07.v1.json'),walkBytes=read(walkPath),walk=parse(walkBytes);
  const evidencePath=join(repo,'app/data/cache-selector-evidence.2026-10-07.v1.json'),evidenceBytes=read(evidencePath),evidence=parse(evidenceBytes);
  const correctionsPath=join(repo,'app/data/cache-surface-corrections.2026-10-08.v1.json'),correctionsBytes=read(correctionsPath),corrections=parse(correctionsBytes);
  const {provenance:maskProvenance,regions}=loadResourceMasks({path:options.masks,objectManifest:manifest,walk,evidence,corrections});
  const placements=[],review=[],usedArchives=new Set(),classCounts={};let scanned=0,effectiveSurface=0,boundaryUnwitnessed=0;
  for(const definition of definitions)for(const id of [definition.objectId,...definition.leafObjectIds])usedArchives.add(`16:${Math.floor(id/256)}`);
  for await(const text of readPlacementRows(join(input,'objects.placements.v1.json.gz'))){
    scanned++;
    if(!text.includes('"mapId":28,'))continue;
    const p=JSON.parse(text);
    if(p.mapId!==28||!inCrop(p.x,p.y)||effectiveDisplayPlane(p)!==0)continue;
    effectiveSurface++;
    const r=resolved.get(p.objectId);if(!r)continue;
    if(!r.classKeys.length){review.push([p.id,p.objectId,p.chunkId,p.x,p.y,r.policy,r.possibleClassKeys]);continue;}
    const witness=resourceWitness(regions,p,r.footprint);
    if(witness.excludedComponents?.length)review.push([p.id,p.objectId,p.chunkId,p.x,p.y,'excluded-surface-component',witness.excludedComponents]);
    if(!witness.components.length&&witness.outsideBaseTiles)boundaryUnwitnessed++;
    if(!witness.components.length)review.push([p.id,p.objectId,p.chunkId,p.x,p.y,'no-exact-walkable-component',r.classKeys]);
    else if(witness.components.length>1)review.push([p.id,p.objectId,p.chunkId,p.x,p.y,'multiple-perimeter-components',witness.components]);
    usedArchives.add(`5:${p.source.minor}`);usedArchives.add(`16:${Math.floor(p.objectId/256)}`);
    for(const leaf of r.leaves)usedArchives.add(`16:${Math.floor(leaf/256)}`);
    const ordinal=recoverSourceOrdinal(p);
    for(const key of r.classKeys){placements.push([p.id,p.objectId,key,String(p.chunkId),p.x,p.y,p.plane,effectiveDisplayPlane(p),p.rotation,witness.components,witness.method,witness.tiles,p.source.minor,p.source.x,p.source.y,p.source.plane,p.type,ordinal]);classCounts[key]=(classCounts[key]??0)+1;}
  }
  placements.sort((a,b)=>a[3].localeCompare(b[3],'en')||a[2].localeCompare(b[2],'en')||a[4]-b[4]||a[5]-b[5]||a[1]-b[1]||a[0].localeCompare(b[0],'en'));
  review.sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const layout=parse(gunzipSync(readSource(join(input,sourceNames[1]))));
  const objectCoverage=new Map(parse(gunzipSync(readSource(join(input,sourceNames[3])))).byChunk.map(row=>[row.chunk,row.coverage]));
  for(const [chunk,status] of walk.regions)if((status==='decoded')!==(objectCoverage.get(chunk)==='decoded-layout-source'))throw new Error(`Object/walking surface coverage disagree: ${chunk}`);
  const title=text=>text.charAt(0).toUpperCase()+text.slice(1);
  const classes=Object.keys(classCounts).sort().map(key=>{const [category,...parts]=key.split(':'),type=parts.join(':'),matching=definitions.filter(d=>d.classKeys.includes(key));let name;
    if(/^(?:tree|ore):unknown:/.test(key))name=`${title(parts.slice(1).join(' ').replaceAll('-',' '))} (untyped)`;
    else if((category==='tree'||category==='ore')&&parts.length>1)name=matching.find(d=>d.name&&d.name!=='null')?.name??type.replaceAll('-',' ');
    else if(category==='tree')name=type==='bamboo'?'Bamboo':`${title(type.replaceAll('-',' '))} tree`;
    else if(category==='ore')name=`${title(type.replaceAll('-',' '))} rock`;
    else if(category==='facility'&&/^bank-/.test(parts[0])&&parts.length>1){const label=matching.find(d=>d.name&&d.name!=='null')?.name??parts.slice(1).join(' ').replaceAll('-',' ');name=`${parts[0]==='bank-other'?'Bank facility':title(parts[0].replaceAll('-',' '))} (${label})`;}
    else name=matching.find(d=>d.name&&d.name!=='null')?.name??type.replaceAll('-',' ');
    return {key,category,type,name};});
  const provenance={snapshot:'objects-2026-10-08-v3',manifest:{file:basename(manifestPath),sha256:hash(manifestBytes)},inputs,decoder:manifest.decoder,sources:manifest.sources,archives:manifest.archives.filter(a=>usedArchives.has(`${a.major}:${a.minor}`)||a.major===23),walkability:{file:basename(walkPath),sha256:sha256RepositoryText(walkBytes),masks:maskProvenance},selectorEvidence:{file:basename(evidencePath),sha256:sha256RepositoryText(evidenceBytes)},reference:manifest.reference,generatorSha256:sha256RepositoryText(read(fileURLToPath(import.meta.url))),classificationSha256:sha256RepositoryText(read(new URL('./cache/resource-catalogue.mjs',import.meta.url)))};
  const catalogue={schemaVersion:1,provenance,schema:{placementColumns,coverageColumns:['chunkId','status'],reviewColumns:['placementId','objectId','chunkId','x','y','reason','details'],sourceIdentity:'ID source prefix reconstructed from SHA256([sourceMinor,objectId,sourcePlane,sourceX%64,sourceY%64,sourceType,rotation,sourceOrdinal]) first24 hex. Rotation is the unchanged source-use rotation; map layouts translate without rotating.'},scope:{mapId:28,effectivePlane:0,crop:walk.summary.crop},classes,definitions,placements,coverage:walk.regions.map(r=>[r[0],r[1]]),review,summary:{scannedPlacements:scanned,effectiveSurfacePlacements:effectiveSurface,resourcePlacements:new Set(placements.map(p=>p[0])).size,placementClassRows:placements.length,witnessedPlacements:new Set(placements.filter(p=>p[9].length).map(p=>p[0])).size,conditionalReviewPlacements:review.filter(p=>p[5]==='conditional-review').length,dynamicReviewPlacements:review.filter(p=>p[5]==='dynamic-template-review').length,multipleComponentPlacements:review.filter(p=>p[5]==='multiple-perimeter-components').length,decodedSourceRegions:layout.coverage.filter(r=>r.status==='decoded').length,classCounts},limits:['Build 950 is inferred decoder compatibility, not a verified live-game build.','Name and action classify static scenery; membership flags do not certify geographic F2P access or server interaction.','Generic Tree/Rocks stay untyped; no model equivalence or product type is invented.','Conditional resources require every encoded leaf present with identical classes and footprint; renderer default alone is insufficient.','Divine, portable, temporary and player-created definition prefixes are review templates, never ordinary static-resource grants.','Exact tile/perimeter witnesses establish spatial correspondence, not server interaction or travel; multiple components remain explicit.','No upper-plane or underground contents are included: no certified entrance/landing topology was available.','Missing resource or layout is not a verified deletion; unwitnessed and unmatched retained declarations remain review evidence.']};
  catalogue.provenance.surfaceCorrections={file:basename(correctionsPath),sha256:sha256RepositoryText(correctionsBytes),invalidRegionIds:corrections.invalidRegionIds,nonWalkingComponentIds:corrections.nonWalkingComponentIds};
  Object.assign(catalogue.summary,{witnessedChunks:new Set(placements.filter(p=>p[9].length).map(p=>p[3])).size,unwitnessedPlacements:review.filter(p=>p[5]==='no-exact-walkable-component').length,excludedReviewPlacements:review.filter(p=>p[5]==='excluded-surface-component').length,boundaryUnwitnessedPlacements:boundaryUnwitnessed});
  catalogue.limits.push('Witnesses remain within the placement base chunk; an outside-base perimeter tile cannot grant a resource in either chunk.','Pinned surface corrections exclude invalid regions and nonwalking components before attachment; rejected exact candidates remain review evidence.');
  const reference=parse(read(join(repo,'rs3-chunkpicker-chunkinfo-export.json'))),selectorData=buildSelectors(reference,definitions);
  const selectors={schemaVersion:1,provenance:{catalogue:basename(output),catalogueSha256:hash(Buffer.from(JSON.stringify(catalogue))),referenceSha256:sha256RepositoryText(read(join(repo,'rs3-chunkpicker-chunkinfo-export.json'))),method:'Exact definition name/action classes plus explicit retained objectsPlus expansions; ambiguous names and missing alias members retained for review.'},...selectorData};
  writeFileSync(output,JSON.stringify(catalogue));writeFileSync(selectorsOutput,JSON.stringify(selectors));
  return {summary:catalogue.summary,mappedSelectors:selectors.mappings.length,unmatchedSelectors:selectors.unmatched.length,bytes:read(output).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const options={};for(let i=2;i<process.argv.length;i+=2){if(!/^--(?:input|output|selectors|masks)$/.test(process.argv[i])||!process.argv[i+1])throw new Error('Use --input, --output, --selectors or --masks followed by a path.');options[process.argv[i].slice(2)]=process.argv[i+1];}buildResourceCatalogue(options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.stack);process.exitCode=1;});}
