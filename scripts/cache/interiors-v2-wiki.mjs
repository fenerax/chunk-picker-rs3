import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, '.local/interiors-v2-research/wiki-entrances.json');
if (fs.existsSync(output)) throw new Error(`Refusing to replace ${output}`);
const titles = ["Puro-Puro", "Crop circle", "Impetuous Impulses", "Elnock Inquisitor", "Map:Magical wheat", "War's Retreat", "War's Retreat Teleport", "War's Insignia", "Portal (War's Retreat)", "Map:War's Retreat", "Broken bridge (War's Retreat)", "Death's office", "Death's domain", "Death's Hourglass", "Death's door", "City of Um", "City of Um Teleport", "Underworld portal", "Overworld portal", "Mysterious Old Man's cellar", "Evil Bob Tribute", "Trapdoor (Evil Bob Tribute)", "Mysterious Old Man", "The Skullery", "Trapdoor (The Skullery)", "Stolen Hearts", "Module:Map"];
const sources = [];
const redirects = [];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
for (let i=0; i<titles.length; i+=10) {
  const api = 'https://runescape.wiki/api.php?' + new URLSearchParams({action:'query', prop:'revisions', rvprop:'ids|timestamp|content', rvslots:'main', format:'json', redirects:'1', titles:titles.slice(i,i+10).join('|')});
  const response = await fetch(api, {headers:{'User-Agent':'RS3-private-chunk-picker-entrance-evidence/1.0'}});
  if (!response.ok) throw new Error(`Wiki HTTP ${response.status}`);
  const body = await response.json();
  redirects.push(...body.query.redirects??[]);
  for (const p of Object.values(body.query.pages)) {
    if (sources.some(s=>s.title===p.title)) continue;
    const r=p.revisions?.[0];
    if (!r) {sources.push({title:p.title, status:'missing'}); continue;}
    const w=r.slots.main['*'];
    sources.push({title:p.title,pageId:p.pageid,revisionId:r.revid,revisionTimestamp:r.timestamp,url:`https://runescape.wiki/w/${encodeURIComponent(p.title.replaceAll(' ','_'))}?oldid=${r.revid}`,apiUrl:api,wikitextSha256:sha(w),coordinateTemplates:[...w.matchAll(/\{\{(?:Object map|NPC map|Teleport map|Map)\b[^{}]*\}\}/g)].map(m=>m[0]),mapParameterLines:w.split('\n').filter(l=>/^\|\s*(?:mapID|plane|center|title\d+|coords\d+|description\d+)\s*=/.test(l)),mappingDefaultLines:p.title==='Module:Map'?w.split('\n').filter(l=>/mapID = args.mapID or 28|plane = tonumber\(args.plane\) or 0/.test(l)):[]});
  }
}
const source = title => {const s=sources.find(s=>s.title===title);if(!s?.revisionId)throw new Error(`Missing source ${title}`);return {title,url:s.url,revisionId:s.revisionId};};
const anchor=(id,name,x,y,plane,mapId,kind,titles,extra={})=>({id,name,x,y,plane,mapId,kind,precision:kind==='explicit-player-arrival'?'wiki-explicit-arrival':'wiki-map-marker',evidence:titles.map(source),...extra});
const anchors=[
  anchor('zanaris-crop-centre','Zanaris permanent crop-circle centre',2427,4446,0,1,'scenery-map-marker',['Crop circle'],{objectIds:[24991]}),
  anchor('puro-elnock','Elnock Inquisitor',2586,4314,0,168,'npc-map-marker',['Elnock Inquisitor'],{npcIds:[6070],role:'corroborates-map-identity-not-arrival'}),
  anchor('puro-map-centre','Puro-Puro maze map view',2592,4320,0,168,'map-view-centre',['Puro-Puro','Map:Magical wheat'],{role:'display-centre-only-not-arrival'}),
  anchor('wars-insignia','War\'s Insignia',3105,3311,0,28,'scenery-map-marker',["War's Insignia"],{objectIds:[114745]}),
  anchor('wars-broken-bridge','War\'s Retreat western broken bridge',3266,10138,0,10003,'scenery-map-marker',["Broken bridge (War's Retreat)"],{objectIds:[114800],mapNamespace:'wiki',role:'western-layout-corroboration; inaccessible-island-beyond-bridge'}),
  anchor('wars-arrival','War\'s Retreat teleport/Insignia arrival',3294,10127,0,10003,'explicit-player-arrival',["War's Retreat Teleport","Portal (War's Retreat)","Map:War's Retreat"],{objectIds:[114746],mapNamespace:'wiki-map-id; no-equivalence-to-cache-map-id-assumed',arrivalEvidence:'Teleport page identifies exit portal as landing; portal page identifies teleport and Insignia entrants; advanced map declares plane0.'}),
  anchor('deaths-hourglass-surface','Death\'s Hourglass surface entrance',3105,3307,0,28,'scenery-map-marker',["Death's Hourglass"],{objectIds:[96780]}),
  anchor('deaths-hourglass-office','Death\'s Hourglass office exit',414,651,0,28,'scenery-map-marker',["Death's Hourglass"],{objectIds:[96782],mapIdStatus:'wiki-default-28-is-display-default-not-established-office-cache-map',resolvedMapId:null}),
  anchor('deaths-door','Death\'s door',412,684,0,-1,'scenery-map-marker',["Death's door"],{objectIds:[92118,101078],mapIdStatus:'wiki-negative-one-unmapped-source-coordinate'}),
  anchor('underworld-portal','Underworld portal surface entrance',3104,3313,0,28,'scenery-map-marker',['Underworld portal'],{objectIds:[127140,127141]}),
  anchor('overworld-portal','Overworld portal in Um',1023,1761,1,-1,'scenery-map-marker',['Overworld portal'],{objectIds:[127269],mapIdStatus:'wiki-negative-one-unmapped-source-coordinate',corroboratedAreaMapId:742,areaMapEvidence:[source('City of Um')]}),
  anchor('um-teleport-square','City of Um Teleport destination area',1038,1760,1,-1,'teleport-area-square',['City of Um Teleport'],{radius:2.5,role:'destination-area-square-not-explicit-single-player-arrival'}),
  anchor('oldman-trapdoor','Evil Bob Tribute trapdoor',3097,3280,0,28,'scenery-map-marker',['Trapdoor (Evil Bob Tribute)'],{objectIds:[5116]}),
  anchor('skullery-trapdoor','Skullery trapdoor',3091,3277,0,28,'scenery-map-marker',['Trapdoor (The Skullery)'],{objectIds:[75852,75853]})
];
const cacheRoot='C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/';
const transitionFile=cacheRoot+'objects-2026-10-08-v3/objects.transitions.v1.json.gz';
const placesFile=cacheRoot+'places-2026-10-08-v3/places.v1.json';
const transitionBytes=fs.readFileSync(transitionFile);
const placesBytes=fs.readFileSync(placesFile);
const transitions=JSON.parse(zlib.gunzipSync(transitionBytes));
const places=JSON.parse(placesBytes);
const selectedCachePlacements=transitions.transitions.filter(r=>[5116,75852,75853,24991,127269].includes(r.objectId)||[168,320,653].includes(r.mapId)).map(({id,sourceId,objectId,name,actions,memberActions,x,y,plane,mapId,source,transform})=>({id,sourceId,objectId,name,actions,memberActions,x,y,plane,mapId,source,transform,kind:'exact-cache-scenery-anchor',playerArrival:false}));
const areas=[
 {pickerId:'10307',name:'Puro-Puro',mapIds:[168],mapIdentity:'Wiki maze168 corroborated by Elnock and Magical wheat; cache168 impetuous_impulses_wheat_maze. Map1 is Zanaris entrance view.',anchorIds:['zanaris-crop-centre','puro-elnock','puro-map-centre'],entranceRoute:'Enter crop circle; return to field used to enter even if circle has disappeared.',requirements:['Members','Hunter17 for maze; Wiki text differs on whether entry itself requires17','No magic box in inventory'],sources:['Puro-Puro','Crop circle','Impetuous Impulses','Elnock Inquisitor','Map:Magical wheat'].map(source),unknowns:['Exact player landing tile unverified; maze centre is not used as landing.','Four cache25014 exit anchors retained independently; no single exit anchor arbitrarily selected.','Temporary overworld crop-circle availability is world/time dependent.']},
 {pickerId:'13214',name:"War's Retreat",mapIds:[10003],mapNamespace:'wiki',anchorIds:['wars-insignia','wars-arrival','wars-broken-bridge'],requirements:['Combat60 OR total1000','Teleport spell additionally requires10 boss kills unlocked at War\'s Wares'],sources:["War's Retreat","War's Retreat Teleport","Portal (War's Retreat)","Map:War's Retreat","Broken bridge (War's Retreat)"].map(source),westernLayoutEvidence:'Advanced map displaycentre3263,10145 lies in source square50; bridge marker3266,10138 in square51. Location/bridge text establishes an inaccessible western island, but no exact western bounds.',unknowns:['Wiki map10003 not automatically equated with copied-cache map ID.','Exact western island bounds not specified by consulted Wiki sources.','Exact exit-to-Draynor and exit-to-Death player landing tiles not stated; portal page says next to Insignia/Underworld portal.']},
 {pickerId:'1546',name:"Death's Office / Domain",mapIds:[],anchorIds:['deaths-hourglass-surface','deaths-hourglass-office','deaths-door'],sources:["Death's office","Death's Hourglass","Death's door"].map(source),unknowns:['Office Wiki mapID=-1 is unassigned, not cache map ID.','Death\'s domain redirects to Death\'s office; event mansion must not substitute office.','Exact office arrival and War door counterpart scenery anchor unresolved.']},
 {pickerId:'23',name:'City of Um',mapIds:[742],anchorIds:['underworld-portal','overworld-portal','um-teleport-square'],sources:['City of Um','Underworld portal','Overworld portal','City of Um Teleport'].map(source),unknowns:['Player landing from Draynor portal is near ritual site; no exact tile in consulted source.','Wiki127269 marker1023,1761 differs from copied-cache origin1020,1755; both retained.','Wiki source plane1 becomes cache displayplane0 for map742; exact transform preserved in cache placements.']},
 {pickerId:'5706',name:"Mysterious Old Man's cellar / Evil Bob Tribute",mapIds:[653],anchorIds:['oldman-trapdoor'],sources:['Evil Bob Tribute','Trapdoor (Evil Bob Tribute)','Mysterious Old Man'].map(source),requirements:['Ask Mysterious Old Man about abductions so Evil Bob takes him away; ladder exit causes him to reappear'],unknowns:['Exact player landing tile not stated.','Interior10527 ladder1453,4749 is exact cache anchor corroborated by textual ladder exit; no Wiki coordinate for ladder found.']},
 {pickerId:'5705',aliasPickerIds:['The Skullery'],name:'The Skullery',mapIds:[320],anchorIds:['skullery-trapdoor'],sources:['The Skullery','Trapdoor (The Skullery)','Stolen Hearts'].map(source),requirements:['During Stolen Hearts first entrance is stopped by bouncer until threatened'],unknowns:['Exact player landing tile not stated.','Interior75851 ladder1435,4701 is exact cache anchor; counterpart is semantic pairing, not decoded transport destination.']}
];
const report={schemaVersion:1,generatedAt:new Date().toISOString(),scope:'Read-only current Wiki API and copied cache exports; assigned new report and script only.',displayOnly:true,accessEffect:'none',observedInGame:false,coordinateConvention:'x east; y north. Wiki map ID namespace can differ from cache. Unspecified Wiki plane/map defaults documented by Module:Map, not proof of an office cache map.',sources,redirects,anchors,areas,cacheEvidence:{inputs:[{path:transitionFile,sha256:sha(transitionBytes)},{path:placesFile,sha256:sha(placesBytes)}],mapRecords:places.mapRecords.filter(r=>[1,168,320,653,742].includes(r.id)),placements:selectedCachePlacements},limitations:['Cache anchors establish scenery origin; they are not player landing observations.','No region or area centre has been promoted to player arrival.','Object map marker can be approximate/multi-tile scenery centre and may differ from exact cache object origin.','No transport destination has been invented from an object coordinate hint.','No client, original cache, private save, or live server read.']};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,sources:sources.length,anchors:anchors.length,areas:areas.length,cachePlacements:selectedCachePlacements.length}));
