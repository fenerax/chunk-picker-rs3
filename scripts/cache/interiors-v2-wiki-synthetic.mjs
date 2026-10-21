import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const output=path.resolve(import.meta.dirname,'../../.local/interiors-v2-research/wiki-synthetic.json');
const titles=['Rex Matriarch lair','Rex Matriarchs','Matriarch lair','Map:Rex Matriarch lair','Teleportation device','Temple of Aminishi','Map:Temple of Aminishi','Dragonkin Laboratory','Map:Dragonkin Laboratory','The Shadow Reef','Map:The Shadow Reef','Elite Dungeons','Story mode','Senntisten Old Crypt','Old Crypt','Crypt (Wilderness)','The Sanctum Guardian','Large cave opening (City of Um)','Cave exit (City of Um)','City of Um troll cave','Ghostly troll','Seradoomin'];
const sources=[];const redirects=[];
for(let i=0;i<titles.length;i+=10){
 const apiUrl='https://runescape.wiki/api.php?'+new URLSearchParams({action:'query',prop:'revisions',rvprop:'ids|timestamp|content',rvslots:'main',format:'json',titles:titles.slice(i,i+10).join('|'),redirects:'1'});
 const result=await(await fetch(apiUrl)).json(); redirects.push(...result.query.redirects??[]);
 for(const p of Object.values(result.query.pages)){const r=p.revisions?.[0];if(!r){sources.push({title:p.title,status:'missing'});continue;}
 const w=r.slots.main['*'];sources.push({title:p.title,pageId:p.pageid,revisionId:r.revid,revisionTimestamp:r.timestamp,url:`https://runescape.wiki/w/${encodeURIComponent(p.title.replaceAll(' ','_'))}?oldid=${r.revid}`,apiUrl,wikitextSha256:crypto.createHash('sha256').update(w).digest('hex'),coordinateTemplates:[...w.matchAll(/\{\{(?:Object map|NPC map|Map|Maplink|Teleport map|LocLine)\b[^{}]*\}\}/g)].map(m=>m[0]),mapParameterLines:w.split('\n').filter(l=>/^\|\s*(?:mapID|plane|center|title\d+|coords\d+)\s*=/.test(l)),relevantLines:w.split('\n').filter(l=>/story mode|storymode|Old crypt|Old Crypt|old crypt|Senntisten|entrance|teleporting|teleports|troll cave|lair|ghostly troll|Trollgrav/i.test(l)).slice(0,100)});
 }
}
const searches=[];
for(const query of ['crypt Senntisten','"Old Crypt"','"City of Um" "cave exit"']){const apiUrl='https://runescape.wiki/api.php?'+new URLSearchParams({action:'query',list:'search',srsearch:query,srlimit:'15',format:'json'});const j=await(await fetch(apiUrl)).json();searches.push({query,apiUrl,titles:j.query?.search.map(p=>p.title)??[]});}
const report={schemaVersion:1,generatedAt:new Date().toISOString(),displayOnly:true,accessEffect:'none',observedInGame:false,sources,redirects,searches,areas:[
 {pickerId:'1',name:'Lair of Rex Matriarchs',cacheCandidateMapId:749,status:'partial-boss-arena-corroborated; entry-corridor-unmapped',evidence:'Wiki inactive devices119682 at4021,9793 and4043,9788 fall in cache749 boss-arena plane0 bounds. Entry device1196853865,9854 and bossdoor3931,9866 lie outside749. No exact player landing inferred.'},
 {pickerId:'21',name:'Temple of Aminishi',wikiMapId:10000,cacheCandidateMapId:708,status:'Wiki-custom-map-not-equivalent-to-cache-map',evidence:'Wiki SanctumGuardianNPC25587 source4739,9135plane1; cache708 sameXY bounds butplane0 only. Current exact layer/mode mapping remainsunverified.'},
 {pickerId:'22',name:'Senntisten Old Crypt',status:'unknown',excludedCacheMapIds:[741],unknowns:['No exact matching article found; Wiki capitalized Old Crypt is Wilderness/Fort Forinthry questUnwelcomeGuests. Map741125314 exit matches1978,1575sourceplane1/displayplane0. This does not establish SenntistenOldCrypt identity.']},
 {pickerId:'25',name:'City of Um troll cave',cacheCandidateMapId:742,status:'source-display-coordinate-conflict-needs-cross-check',evidence:'Wiki126997 entrance1133,1706plane1;126998 exit1160,2026plane1;126999 Trollgrav1204,2016plane1;NPC30423Seradoomin1203,2017(defaultplane0). Cache742 candidate extra paste source960..1023x9600..9663plane0 ->768..831x1984..2047plane0 does not match these coordinates. Only surface126997 projected at1135,1707sourceplane1/displayplane0 is present in transition export.'},
 {pickerId:'49',name:'Temple of Aminishi story mode',relatedPickerId:'21',wikiMapId:10000,status:'mode-of-same-dungeon; separate-instance-identity-unverified'},
 {pickerId:'50',name:'Dragonkin Laboratory story mode',wikiMapId:10001,status:'mode-of-same-dungeon; separate-instance-identity-unverified'},
 {pickerId:'51',name:'The Shadow Reef story mode',wikiMapId:10002,status:'mode-of-same-dungeon; separate-instance-identity-unverified'}
 ],limitations:['Wiki10000/10001/10002 are custom maps with fractional/local display coordinates; do not equate them with copied-cache IDs or game source tiles.','Normal/story choices are modes of each Elite Dungeon; map-sharing does not prove exact cache instance identity or access.','No player arrival derived from map centres or scenery markers.']};
const evidence=title=>{const s=sources.find(s=>s.title===title);if(!s?.revisionId)throw Error(title);return{title,url:s.url,revisionId:s.revisionId};};
const anchor=(id,objectId,x,y,plane,mapId,title,extra={})=>({id,objectId,x,y,plane,wikiMapId:mapId,kind:'wiki-scenery-map-marker',playerArrival:false,evidence:[evidence(title)],...extra});
report.anchors=[
 anchor('rex-surface-device',119683,4027,4261,0,28,'Teleportation device'),
 anchor('rex-entrance-device',119685,3865,9854,0,-1,'Teleportation device'),
 anchor('rex-inactive-device-a',119682,4043,9788,0,-1,'Teleportation device',{cacheCoordinateBoundsCandidate:749}),
 anchor('rex-inactive-device-b',119682,4021,9793,0,-1,'Teleportation device',{cacheCoordinateBoundsCandidate:749}),
 anchor('um-troll-cave-entrance',126997,1133,1706,1,-1,'Large cave opening (City of Um)'),
 anchor('um-troll-cave-exit',126998,1160,2026,1,-1,'Large cave opening (City of Um)'),
 anchor('trollgrav-opening',126999,1204,2016,1,-1,'Large cave opening (City of Um)'),
 anchor('fort-crypt-entrance',125311,3285,3609,0,-1,'Old Crypt',{excludedPickerId:'22'}),
 anchor('fort-crypt-exit',125314,1978,1575,1,-1,'Old Crypt',{excludedPickerId:'22',corroboratedCacheMapId:741}),
 {id:'aminishi-sanctum-guardian',npcId:25587,x:4739,y:9135,plane:1,wikiMapId:-1,kind:'wiki-npc-map-marker',playerArrival:false,evidence:[evidence('The Sanctum Guardian')],cacheCoordinateBoundsCandidate:708,unknowns:['Cache708 sourcebounds specifyplane0; exact layer correspondence not established.']}
];
for(const a of report.areas){a.evidenceSources=(a.pickerId==='1'?['Rex Matriarch lair','Map:Rex Matriarch lair','Teleportation device']:a.pickerId==='22'?['Old Crypt','Crypt (Wilderness)']:a.pickerId==='25'?['City of Um troll cave','Large cave opening (City of Um)','Seradoomin']:a.pickerId==='21'?['Temple of Aminishi','Map:Temple of Aminishi','The Sanctum Guardian']:a.pickerId==='49'?['Temple of Aminishi','Elite Dungeons','Story mode']:a.pickerId==='50'?['Dragonkin Laboratory','Map:Dragonkin Laboratory','Elite Dungeons']:['The Shadow Reef','Map:The Shadow Reef','Elite Dungeons']).map(evidence);}
const cacheInputs=['C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json','C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/objects-2026-10-08-v3/objects.transitions.v1.json.gz'];
const cb=cacheInputs.map(p=>fs.readFileSync(p));const maps=JSON.parse(cb[0]);const trans=JSON.parse(zlib.gunzipSync(cb[1]));
report.cacheEvidence={inputs:cacheInputs.map((p,i)=>({path:p,sha256:crypto.createHash('sha256').update(cb[i]).digest('hex')})),mapRecords:maps.mapRecords.filter(r=>[708,741,742,749].includes(r.id)),placements:trans.transitions.filter(r=>[126997,126998,126999,119683,119685,125314,125311].includes(r.objectId)).map(({id,objectId,name,x,y,plane,mapId,source,transform})=>({id,objectId,name,x,y,plane,mapId,source,transform,playerArrival:false}))};
if(fs.existsSync(output))throw Error('Refusing to replace assigned existing output');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
for(const s of sources)console.log(JSON.stringify({title:s.title,revisionId:s.revisionId,templates:s.coordinateTemplates,lines:s.relevantLines?.filter(l=>/story mode|crypt|Senntisten|entrance|Trollgrav/i.test(l)).slice(0,12),params:s.mapParameterLines?.filter(l=>/^\|\s*(mapID|plane|center)\s*=/.test(l))}));
console.log(JSON.stringify({output,searches}));
