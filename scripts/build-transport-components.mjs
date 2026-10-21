#!/usr/bin/env node
import { readFileSync,writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo=fileURLToPath(new URL('../',import.meta.url));
const source='C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function buildTransportComponents(stations,mask,maskSha256,runtimeSha256){
  const regions=new Map(mask.regions.map((region,index)=>[region.id,{region,index}]));
  const witnesses=[],unresolved=[];
  for(const station of stations){
    if(station.mapId!==28||station.plane!==0){unresolved.push({stationId:station.id,reason:'other map or plane; requires verified interior selector'});continue;}
    const anchor=station.accessAnchor ?? station;
    const value=regions.get(station.chunkId),offset=(anchor.x%64)*64+anchor.y%64;
    if(!value?.region.masks?.components||value.region.status!=='decoded'){unresolved.push({stationId:station.id,reason:'no exact decoded mask'});continue;}
    const bytes=Buffer.from(value.region.masks.components,'base64'),label=bytes.readUInt16LE(offset*2);
    if(!label){unresolved.push({stationId:station.id,reason:'station anchor tile is blocked; no landing/approach tile inferred'});continue;}
    const rawPlane=Buffer.from(value.region.masks.planes,'base64')[offset];
    const sourceShift=(value.region.provenance?.destinationPlane??0)-(value.region.provenance?.sourcePlane??0);
    if(rawPlane+sourceShift!==anchor.plane){unresolved.push({stationId:station.id,reason:'exact tile source plane does not match station display plane'});continue;}
    witnesses.push({stationId:station.id,componentId:`${station.chunkId}-${1000000+label}`,x:anchor.x,y:anchor.y,plane:anchor.plane,mapId:anchor.mapId,
      maskSha256,runtimeSha256,evidence:{kind:'exact-decoded-mask-tile',file:source,pointer:`/regions/${value.index}/masks/components`,
        encoding:'base64-u16le',order:'x*64+z',offsetBytes:offset*2,label,sourcePlane:rawPlane,sourceShift,encodedLabelBytes:[bytes[offset*2],bytes[offset*2+1]]}});
  }
  return {schemaVersion:1,version:'2026-10-08.v1',source:{path:source,sha256:maskSha256},runtime:{path:'app/data/cache-walkability.2026-10-07.v1.json',sha256:runtimeSha256},
    policy:'Only the exact scenery/station coordinate is sampled. Blocked anchors stay unresolved; no nearest tile, perimeter, bounding box or landing is inferred.',witnesses,unresolved};
}
export function generateTransportComponents(){
  const paths=['transport-routes.f2p.2026-10-08.v1.json','transport-routes.interiors-members.2026-10-08.v1.json','transport-routes.ships.2026-10-08.v1.json'];
  const stations=paths.flatMap(path=>JSON.parse(readFileSync(resolve(repo,'app/data',path),'utf8')).stations);
  const accessAnchors=JSON.parse(readFileSync(resolve(repo,'app/data/transport-access-anchors.2026-10-08.v1.json'),'utf8'));
  for(const anchor of accessAnchors.anchors){const station=stations.find(station=>station.id===anchor.stationId);if(!station)throw new Error(`Missing station ${anchor.stationId}`);station.accessAnchor=anchor;}
  const bytes=readFileSync(source),runtime=readFileSync(resolve(repo,'app/data/cache-walkability.2026-10-07.v1.json'));
  const result=buildTransportComponents(stations,JSON.parse(gunzipSync(bytes)),hash(bytes),sha256RepositoryText(runtime));
  writeFileSync(resolve(repo,'app/data/transport-components.2026-10-08.v1.json'),`${JSON.stringify(result)}\n`);
  return {witnesses:result.witnesses.length,unresolved:result.unresolved.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(generateTransportComponents()));
