import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CacheCopy, loadDecoders, sha256 } from './cache-reader.mjs';
import { loadSurfaceLayout } from './surface.mjs';
import { interiorBounds } from './interior-layout.mjs';
const out=new URL('../../.local/interiors-v2-research/',import.meta.url);mkdirSync(out,{recursive:true});
const json=p=>JSON.parse(readFileSync(p));
const extractionPath='C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/archaeology-2026-10-08-archmaps-v1/archaeology-extraction.2026-10-08.v1.json';
const placesPath='C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json';
const arch=json(extractionPath),places=json(placesPath),definitions=json(new URL('../../rs3-chunkpicker-chunkinfo-export.json',import.meta.url)),old=json(new URL('../../app/data/cache-interiors.2026-10-08.v1.json',import.meta.url));
const unknown=old.areas.filter(a=>Number.isInteger(+a.areaId)&&+a.areaId>0&&+a.areaId<100&&a.status==='unknown');
const cache=new CacheCopy('C:/Users/User/Projects/rs3-cache-work/cache-copy',await loadDecoders('C:/Users/User/Projects/rs3-cache-work/rsmv',950));
const def=new Map(arch.definitions.map(d=>[d.objectId,d]));
function areaEvidence(rowId,mapId) {
 const row=arch.areas.find(a=>a.rowId===rowId),hotspots=arch.hotspots.filter(h=>row?.hotspotRowIds.includes(h.rowId)),objectIds=new Set(arch.definitions.filter(d=>d.rowIds.some(r=>row?.hotspotRowIds.includes(r))).map(d=>d.objectId));
 const placements=arch.placements.filter(p=>p.mapId===mapId&&objectIds.has(p.objectId));
 return {kind:'typed-archaeology-subarea-and-placement',area:row,hotspots:hotspots.map(h=>({rowId:h.rowId,name:h.name,source:h.source})),placements:placements.map(p=>({objectId:p.objectId,name:p.name,source:p.source,display:{x:p.x,y:p.y,plane:p.plane,mapId:p.mapId},transform:p.transform,definitionRowIds:def.get(p.objectId)?.rowIds}))};
}
const semantic=[
 ['2',720,3256,'Barracks'],['3',720,3260,'Prison block'],['4',722,3270,'Praetorium'],['6',724,2804,null],['7',724,3189,'Star Lodge cellar'],['8',724,3192,'Dungeon of Disorder'],['9',723,3149,'Underwater cave'],['11',728,2805,null],['12',727,3325,null],['13',729,3357,'Crucible'],['14',729,null,'North tunnels'],['15',729,null,"Thalmund's forge"],['16',729,null,"Bandos's sanctum"],['17',731,3758,'Crypt of Varanus'],['18',731,3762,'Observation outpost'],['19',731,3768,'Xolo city'],['20',731,3765,'Moksha ritual site'],['27',751,null,'Fort Forinthry Prison'],['44',757,null,null],['60',768,18328,null]
];
const proposals=semantic.map(([id,mapId,rowId,label])=>{
 const map=places.mapRecords.find(m=>m.id===mapId),labels=places.placements.filter(p=>p.mapId===mapId&&p.label===label),layoutEvidence={major:23,mapId,zoneSha256:sha256(cache.archive(23,0).get(mapId)),pasteSha256:sha256(cache.archive(23,1).get(mapId))};
 const layers=[0,1,2,3].map(plane=>{const l=loadSurfaceLayout(cache,{mapId,plane});return{plane,bounds:interiorBounds(l.blocks),blocks:l.blocks.size,sourcePlanes:[...new Set([...l.blocks.values()].map(b=>b.source.plane))]};}).filter(l=>l.blocks);
 const evidence=[{kind:'retained-picker-record',areaId:id,name:definitions.chunks[id].Name},{kind:'cache-map-semantic-name',mapId,name:map.name,internalName:map.internal_name},...labels.map(l=>({kind:'cache-map-label',...l})),...(rowId?[areaEvidence(rowId,mapId)]:[])];
 return{areaIds:[id],name:definitions.chunks[id].Name,mapId,cacheMapId:mapId,planes:layers.map(l=>l.plane),renderKind:'encoded-layout',layoutEvidence,layers,evidence,displayAnchor:labels[0]?{x:labels[0].x,y:labels[0].y,plane:labels[0].plane,source:labels[0].source,kind:'static-map-label'}:null,semanticBounds:null,unknowns:['Whole map layout coverage is not a semantic enclosure of the subarea.','Partial/quest map variants and live player state are not selected by this correspondence.','Static placement/morph evidence does not grant live access or establish player landing tiles.']};
});
const reasons={
 '1':'Cache maps749/750 both name Rex Matriarch Lair; internal rexkings_lair/rexkings_pre_lair describe variants, but retained alias alone does not establish a selector.',
 '21':'Cache708 Aminishi Dungeon is a plausible semantic correspondence, but exact temple/mode source selector not independently corroborated.',
 '22':'No exact Old Crypt label/typed identity verified. Cache741 fort_slayer_crypt refers to a Fort crypt; cannot equate it with Senntisten Old Crypt.',
 '23':'Resolved separately in static-identities.reviewed.json: Underworld742 exact City of Um label and lodestone structs.',
 '25':'No exact City of Um troll cave label/map identity verified. Generic troll caves173/719 are geographically unrelated.',
 '29':'No Sanctum of Rebirth map zone or exact label found in JS5-23/42 census; unzoned source template not established.',
 '30':'Cache302 temple_trek is one swamp template, not evidence that all Temple Trekking route identities use it.',
 '34':'DBarea13716 Depths has exact hotpot row/object definitions130314-130319, but no placements in extracted active world-map layouts.',
 '36':'Procedural Sinkhole instance template assembly not established by fixed world-map zones.',
 '44':null,
 '49':'Story-mode identity/geometry not independently tied to Aminishi cache708; mode equivalence cannot be inferred from names.',
 '50':'Story-mode identity/geometry not independently tied to Dragonkin Laboratory; exact source template remains unverified.',
 '51':'Cache716 is The Shadow Reef, but story-mode identity/geometry correspondence not established.',
 '52':'Generic Spirit Realm zones429/447/448 do not establish Aminishi Spirit Realm identity.',
 '53':'Uncharted Isles requires verified template family/layout selectors; one arbitrary island map would lose variable layout identity.',
 '58':'Witch\'s House section-man-hole suffix is not a verified static map-name/source coordinate identity.',
 '59':'Procedural Dungeoneering rooms do not have one verified fixed static map; cache338 slug3_daemonheim_dungeon is a quest template.',
 '61':'No Homestead map zone/label found; cache770 Player Owned Housing describes a separate broad template without exact Homestead selector.',
 '62':'Cache699 Shattered Worlds has zero active paste layout; direct source/live instance assembly remains unverified.'
};
const result={schemaVersion:1,displayOnly:true,accessEffect:'none',inputs:[{path:extractionPath,sha256:sha256(readFileSync(extractionPath))},{path:placesPath,sha256:sha256(readFileSync(placesPath))}],census:unknown.map(a=>({areaId:a.areaId,name:a.name,status:proposals.some(p=>p.areaIds.includes(a.areaId))?'reviewed-proposal':a.areaId==='23'?'resolved-separate-artifact':'unresolved',reason:proposals.some(p=>p.areaIds.includes(a.areaId))?null:reasons[a.areaId]??'No reviewed exact map-label, typed subarea placement or static source-template identity verified; synthetic ID not interpreted as packed coordinates.'})),proposals};
if(process.argv.includes('--source-sweep')){
 const targets=new Set([130314,130315,130316,130317,130318,130319]),matches=[],errors=[];
 let count=0;
 for(const [minor,entry] of cache.table(5).entries){if(!entry.subindices.includes(0))continue;count++;try{const a=cache.archive(5,minor);if(!a?.has(0))continue;for(const loc of cache.decoders.decode('locations',a.get(0)).locations){if(!targets.has(loc.id))continue;for(const use of loc.uses)matches.push({objectId:loc.id,source:{x:minor%128*64+use.x,y:Math.floor(minor/128)*64+use.y,plane:use.plane},use,provenance:{major:5,minor,subid:0,locationSha256:sha256(a.get(0)),archiveSha256:sha256(cache.file(5,minor))}});}}catch(e){errors.push({major:5,minor,message:e.message});}if(count%500===0)console.log('Source location sweep',count);}
 writeFileSync(new URL('synthetic-identities.source-sweep.json',out),JSON.stringify({targets:[...targets],scannedArchives:count,matches,errors},null,2));
}
writeFileSync(new URL('synthetic-identities.raw.json',out),JSON.stringify(result,null,2));
writeFileSync(new URL('synthetic-identities.reviewed.json',out),JSON.stringify(result,null,2));
for(const p of proposals)console.log(p.areaIds,p.mapId,p.evidence.filter(e=>e.kind==='typed-archaeology-subarea-and-placement').map(e=>({rowId:e.area.rowId,placements:e.placements.length,hotspots:e.hotspots.map(h=>[h.rowId,h.name])})),p.displayAnchor);
cache.close();
