import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { CacheCopy, loadDecoders, sha256 } from './cache-reader.mjs';
import { loadSurfaceLayout, mapsquareId } from './surface.mjs';
import { interiorBounds } from './interior-layout.mjs';

const out = new URL('../../.local/interiors-v2-research/', import.meta.url);
mkdirSync(out, { recursive: true });
const places = JSON.parse(readFileSync('C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json'));
const travel = JSON.parse(readFileSync('C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/travel.v1.json'));
const cache = new CacheCopy('C:/Users/User/Projects/rs3-cache-work/cache-copy', await loadDecoders('C:/Users/User/Projects/rs3-cache-work/rsmv', 950));
const names = new Map();
function object(id) { if (!names.has(id)) names.set(id, cache.object(16, id, 'loc')); return names.get(id); }
function square(x,y) {
  const minor=mapsquareId(x,y), a=cache.archive(5,minor);
  if(!a) return {x,y,minor,present:false};
  const terrain=a.has(3)?cache.decoders.decode('tiles',a.get(3)).tiles:[];
  const locations=a.has(0)?cache.decoders.decode('locations',a.get(0)).locations:[];
  const rows=locations.flatMap(l=>l.uses.map(u=>({objectId:l.id,name:object(l.id)?.name??null,actions:object(l.id)?.actions??null,source:{x:x*64+u.x,y:y*64+u.y,plane:u.plane},type:u.type,rotation:u.rotation})));
  return {x,y,minor,present:true,subfiles:[...a.keys()],archiveSha256:sha256(cache.file(5,minor)),terrainSha256:a.has(3)?sha256(a.get(3)):null,locationSha256:a.has(0)?sha256(a.get(0)):null,
    planes:[0,1,2,3].map(p=>{const cells=terrain.slice(p*4096,(p+1)*4096).map((t,i)=>({t,x:i>>6,y:i%64})).filter(({t})=>t&&(t.underlay||t.overlay));return {plane:p,tiles:terrain.slice(p*4096,(p+1)*4096).filter(Boolean).length,floorTiles:cells.length,floorBounds:cells.length?{minX:x*64+Math.min(...cells.map(t=>t.x)),minY:y*64+Math.min(...cells.map(t=>t.y)),maxX:x*64+Math.max(...cells.map(t=>t.x))+1,maxY:y*64+Math.max(...cells.map(t=>t.y))+1}:null,objects:rows.filter(r=>r.source.plane===p).length};}),objects:rows};
}
const probes = [{areaId:'13214',name:"War's Retreat",squares:[[51,158]]},{areaId:'1546',name:"Death's Office",squares:[[6,10]]},{areaId:'5706',name:"Mysterious Old Man's cellar",squares:[[22,74]]},{areaId:'10307',name:'Puro-Puro',squares:[[40,67]]}].map(p=>({...p,squares:p.squares.map(([x,y])=>square(x,y))}));
const um=[];
for(let plane=0;plane<4;plane++) {const l=loadSurfaceLayout(cache,{mapId:742,plane});um.push({mapId:742,plane,bounds:interiorBounds(l.blocks),blocks:[...l.blocks.values()]});}
const umRegions=[...new Set(um.flatMap(l=>l.blocks.map(b=>mapsquareId(Math.floor(b.source.x/64),Math.floor(b.source.y/64)))))];
const umSquares=umRegions.map(id=>square(id%128,Math.floor(id/128)));
const neighborProbes = probes.filter(p=>['13214','1546'].includes(p.areaId)).map(p=>({areaId:p.areaId,squares:[[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy])=>square(p.squares[0].x+dx,p.squares[0].y+dy))}));
const artifact={schemaVersion:1,displayOnly:true,accessEffect:'none',probes,um:{map:places.mapRecords.find(m=>m.id===742),layouts:um,squares:umSquares,labels:places.placements.filter(p=>p.mapId===742),lodestones:travel.lodestones.filter(p=>/\bum\b/i.test(JSON.stringify(p))),travelStructs:travel.travelStructs.filter(p=>/\bum\b|war.s retreat|death.s office/i.test(JSON.stringify(p)))},relatedMaps:places.mapRecords.filter(m=>m.id===168||/tribut|old_man|pinball/i.test(JSON.stringify(m)))};
artifact.neighborProbes=neighborProbes;
writeFileSync(new URL('static-identities.raw.json',out),JSON.stringify(artifact,null,2));
const witnesses=(p,pattern)=>p.squares.flatMap(s=>s.objects.filter(o=>pattern.test(o.name??'')).map(o=>({...o,evidence:{major:5,minor:s.minor,subid:0,locationSha256:s.locationSha256,archiveSha256:s.archiveSha256,definitionMajor:16,definitionArchive:Math.floor(o.objectId/256),definitionSubid:o.objectId%256}})));
const encodedEvidence=id=>{const zone=cache.archive(23,0).get(id),paste=cache.archive(23,1).get(id);return {major:23,mapId:id,zoneSha256:sha256(zone),pasteSha256:sha256(paste),pastes:cache.decoders.decode('pastes',paste)};};
const proposal=(id,mapId,cacheMapId,kind,pattern)=>{const p=probes.find(p=>p.areaId===id);return {areaIds:[id],name:p.name,mapId,cacheMapId,planes:[0],sourceSquares:p.squares.map(s=>({x:s.x,y:s.y,major:5,minor:s.minor,planes:s.planes,archiveSha256:s.archiveSha256,terrainSha256:s.terrainSha256})),renderKind:kind,bounds:p.squares.length===1?{minX:p.squares[0].x*64,minY:p.squares[0].y*64,maxX:(p.squares[0].x+1)*64,maxY:(p.squares[0].y+1)*64}:null,boundsKind:kind==='direct-source'?'reviewed-source-square-template-coverage':'encoded-layout-coverage',evidence:witnesses(p,pattern),semanticBounds:null,accessEffect:'none',unknowns:['No player landing tile or live instance established.','Semantic area enclosure remains unknown.']};};
const reviewed={schemaVersion:1,displayOnly:true,accessEffect:'none',rawEvidenceFile:'static-identities.raw.json',proposals:[
  {...proposal('13214',10003,null,'direct-source',/War|Adrenaline|Reaper|Fateful|Portal/),mapIdNamespace:'wiki-map10003; no JS5-23 identity',unknowns:['Reviewed source-square crop; west neighboring square50,158 has floor tiles but no area-specific scenery identity. Entire semantic extent remains unknown.','Upper sourceplane1 has scenery but no decoded floor tiles.','No player landing tile or live instance established.']},
  {...proposal('1546',10004,null,'direct-source',/War's Retreat|Closure|Hourglass/),mapIdNamespace:'application-display-template; no JS5-23 identity',unknowns:['Upper sourceplanes1/2 have scenery but no decoded floor tiles.','East neighboring square7,10 has Closure\'s writing desk and separate floors; not added to Death\'s Office coverage.','No player landing tile or live instance established.']},
  {...proposal('5706',653,653,'encoded-layout',/Pinball post|Exit sign|Ladder/),layoutEvidence:encodedEvidence(653),correspondence:'Retained numeric alias points exactly to source22,74; retained single Pinball post matches exact placement9319. Cache map653 Evil Bob Tribute pastes precisely this source square. Name difference explicitly preserved.'},
  {...proposal('10307',168,168,'encoded-layout',/Magic wheat|Portal/),bounds:{minX:2552,minY:4280,maxX:2632,maxY:4360},layoutEvidence:encodedEvidence(168),correspondence:'Retained numeric alias points exactly to source40,67. Cache internal impetuous_impulses_wheat_maze and magic wheat center support Puro-Puro correspondence. Encoded layout contains central square plus exact surrounding8x8 halo.'},
  {areaIds:['23'],name:'City of Um',mapId:742,cacheMapId:742,planes:[0,1,2],renderKind:'encoded-layout',layoutEvidence:encodedEvidence(742),layers:um.filter(l=>l.plane<3),evidence:[{kind:'cache-map-label',...artifact.um.labels.find(p=>p.label==='City of Um')},{kind:'typed-lodestone-structs',structs:artifact.um.lodestones}],boundsKind:'encoded-layout-coverage',semanticBounds:null,unknowns:['Cache sourceplane1 becomes displayplane0; displayplane1 uses sourceplane2; displayplane2 uses sourceplane3.','Encoded displayplane3 requests sourceplane4, absent from four-plane decoded terrain; do not admit phantom floor data.','Map742 also contains a disconnected source0 square15,150 pasted to display12,31; whole-map bounds are not City of Um enclosure.','Current server/player states and landing positions are not established.']}
],unresolved:[{areaIds:['25'],name:'City of Um troll cave',reason:'No exact independent cache map/transform/entrance verified. Underworld map742 alone does not establish this cave identity.'},{name:"Closure's Study",reason:'Source7,10 floor/scenery and named writing desk119177 at480,677plane0 exist, but no retained picker identity or verified transport transform establishes independently selectable area.'}],validation:{sourceCacheReadOnly:true,decodedSourceMaps:[20275,1286,9494,8616],sourceSquareCount:4,sourceTerrainPlanes:4,livePlayerStateObserved:false}};
writeFileSync(new URL('static-identities.reviewed.json',out),JSON.stringify(reviewed,null,2));
for(const p of probes)console.log(p.areaId,p.squares.map(s=>({minor:s.minor,present:s.present,planes:s.planes,signature:s.objects.filter(o=>/war|adrenaline|altar|reaper|fateful|closure|hourglass|pinball|bob|portal|exit|study/i.test(o.name??''))})));
console.log('Um',artifact.um.map,um.map(l=>({plane:l.plane,bounds:l.bounds,blocks:l.blocks.length})),umSquares.map(s=>({minor:s.minor,planes:s.planes})));
cache.close();
