import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { TRANSPORT_ROUTES as ACTIVE_TRANSPORT_ROUTES } from '../app/data/transport-routes.mjs';
import { MAP_CONNECTIONS } from '../app/data/map-connections.mjs';
import { MAP_PIN_DETAILS } from '../app/data/map-pin-details.mjs';
import { buildTransportRoutes,validateTransportRoutes,mergeTransportConnections,mergeTransportPinDetails } from '../scripts/build-transport-routes.mjs';
import { buildTransportComponents } from '../scripts/build-transport-components.mjs';

const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
// These reproduce the immutable October 8 generator and map artifacts. Active
// extensions have their own provenance and requirement checks in transport-audit.
const TRANSPORT_ROUTES=read('app/data/transport-routes.2026-10-08.v1.json');
const sha256=sha256RepositoryText;
const baseline=read('archive/data/map-connections.2026-10-08.v1.json');
const transportMerged=read('archive/data/map-connections.2026-10-08.v2.json');
const pinBaseline=read('archive/data/map-pin-details.2026-10-08.v1.json');
const pinInputs=read('app/data/map-pin-details.inputs.2026-10-08.v1.json');

test('transport catalogue is deterministic, versioned, exact and revision sourced',()=>{
  assert.equal(validateTransportRoutes(TRANSPORT_ROUTES),TRANSPORT_ROUTES);
  const sources=TRANSPORT_ROUTES.inputs.map(input=>{
    const bytes=readFileSync(new URL(`../${input.path}`,import.meta.url));
    assert.equal(sha256(bytes),input.sha256);return JSON.parse(bytes);
  });
  const segments=sources.filter((source,index)=>TRANSPORT_ROUTES.inputs[index].kind==='segment');
  const componentEvidence=sources.find((source,index)=>TRANSPORT_ROUTES.inputs[index].kind==='exact-components');
  const accessEvidence=sources.find((source,index)=>TRANSPORT_ROUTES.inputs[index].kind==='station-access-anchors');
  assert.deepEqual(buildTransportRoutes(segments,TRANSPORT_ROUTES.inputs,componentEvidence,accessEvidence),TRANSPORT_ROUTES);
  assert.ok(Object.isFrozen(ACTIVE_TRANSPORT_ROUTES.routes));
  assert.ok(TRANSPORT_ROUTES.stations.length>20);
  for(const route of TRANSPORT_ROUTES.routes){
    assert.equal(route.f2p,!route.members);
    assert.ok(route.provenance.some(source=>/^https:\/\/runescape\.wiki\/w\/.+[?&]oldid=\d+/.test(source.url??'')));
    assert.ok(Array.isArray(route.requirements.quests));assert.ok(Array.isArray(route.requirements.items));
    assert.ok(Array.isArray(route.requirements.conditions));assert.ok(Array.isArray(route.requirements.confirmations));
  }
  const byKind=TRANSPORT_ROUTES.summary.byKind;
  assert.equal(Object.values(byKind).reduce((total,row)=>total+row.total,0),TRANSPORT_ROUTES.routes.length);
  assert.equal(TRANSPORT_ROUTES.summary.f2p+TRANSPORT_ROUTES.summary.members,TRANSPORT_ROUTES.routes.length);
});

test('River Lum has four return-capable stations and a one-way Wilderness destination',()=>{
  const canoe=TRANSPORT_ROUTES.routes.filter(route=>route.kind==='canoe');
  assert.equal(canoe.length,6);
  const stationById=new Map(TRANSPORT_ROUTES.stations.map(station=>[station.id,station]));
  const ids=new Set(canoe.flatMap(route=>[route.from,route.to]));assert.equal(ids.size,4);
  const pending=TRANSPORT_ROUTES.pendingRoutes.filter(route=>route.kind==='canoe');
  assert.equal(pending.length,4);
  const wilderness=pending[0].to;
  assert.ok(TRANSPORT_ROUTES.unresolvedDestinations.some(station=>station.id===wilderness&&/wilderness/i.test(station.name)));
  assert.ok(pending.every(route=>route.to===wilderness&&route.bidirectional===false));
  assert.ok(pending.every(route=>ids.has(route.from)));
  for(const route of canoe){
    assert.equal(route.members,false);assert.equal(route.f2p,true);
    const level=route.requirements.levels.Woodcutting??route.requirements.levels.woodcutting;
    assert.ok([12,27,42,57].includes(level));
    assert.equal(route.bidirectional,true);
  }
  for(const route of pending)assert.equal(route.requirements.levels.Woodcutting??route.requirements.levels.woodcutting,57);
  for(const id of ids){
    const station=stationById.get(id),anchor=station.accessAnchor;
    assert.equal(anchor.coordinateEvidence.kind,'wiki-canoe-instructor-map');
    assert.ok(anchor.coordinateEvidence.url.includes('oldid='));
    assert.deepEqual([station.componentWitness.x,station.componentWitness.y],[anchor.x,anchor.y]);
    assert.equal(station.componentWitness.evidence.kind,'exact-decoded-mask-tile');
  }
  const ordinary=canoe.filter(route=>route.to!==wilderness);
  assert.deepEqual(ordinary.map(route=>route.requirements.levels.Woodcutting??route.requirements.levels.woodcutting).sort((a,b)=>a-b),[12,12,12,27,27,42]);
});

test('map merge retains all declaration provenance and exactly preserves cache walking edges',()=>{
  const activeRetained=MAP_CONNECTIONS.connections.flatMap(edge=>edge.provenance.filter(source=>source.kind==='retained-reference')).map(source=>source.pointer).sort();
  const oldRetained=baseline.connections.flatMap(edge=>edge.provenance.filter(source=>source.kind==='retained-reference')).map(source=>source.pointer).sort();
  assert.deepEqual(activeRetained,oldRetained);
  assert.deepEqual(MAP_CONNECTIONS.connections.filter(edge=>edge.kind==='walking'),baseline.connections.filter(edge=>edge.kind==='walking'));
  const replaced=new Set(MAP_CONNECTIONS.replacedConnections.map(edge=>edge.id));
  assert.ok(replaced.size>0);
  assert.ok(MAP_CONNECTIONS.connections.every(edge=>!replaced.has(edge.id)));
  assert.equal(new Set(MAP_CONNECTIONS.connections.map(edge=>edge.id)).size,MAP_CONNECTIONS.connections.length);
  const input=MAP_CONNECTIONS.inputs.find(input=>input.kind==='reviewed-transport-routes');
  assert.equal(input.sha256,sha256(readFileSync(new URL('../app/data/transport-routes.2026-10-08.v1.json',import.meta.url))));
  // The reviewed transport pass produces v2; active v3 then adds display-only
  // interior metadata. Keep this pass's complete byte/coordinate expectations.
  assert.deepEqual(mergeTransportConnections(baseline,TRANSPORT_ROUTES,input),transportMerged);
  for(const edge of transportMerged.connections.filter(edge=>edge.routeId)){
    assert.ok(['canoe','boat','transport','portal','shortcut','teleport','lodestone'].includes(edge.kind));
    for(const point of [edge.from,edge.to])assert.ok(['exact-entrance','map-marker-anchor'].includes(point.precision));
    if(edge.drawable)for(const point of [edge.from,edge.to]){assert.equal(point.mapId,28);assert.equal(point.plane,0);}
  }
});

test('pin destinations use explicit station identities from the same route catalogue',()=>{
  assert.deepEqual(mergeTransportPinDetails(pinBaseline,TRANSPORT_ROUTES,pinInputs.pins),MAP_PIN_DETAILS);
  assert.deepEqual(new Set(MAP_PIN_DETAILS.pins.map(pin=>pin.id)),new Set(pinBaseline.pins.map(pin=>pin.id)));
  const routes=new Map(TRANSPORT_ROUTES.routes.map(route=>[route.id,route]));
  const stations=new Map(TRANSPORT_ROUTES.stations.map(station=>[station.id,station]));
  for(const join of MAP_PIN_DETAILS.transportJoins){
    assert.ok(stations.get(join.stationId).pinIds.includes(join.pinId));assert.ok(routes.has(join.routeId));
  }
  for(const pin of MAP_PIN_DETAILS.pins)for(const destination of pin.destinations.filter(destination=>destination.source==='reviewed-transport-route')){
    const station=stations.get(destination.stationId);assert.ok(routes.has(destination.routeId));
    assert.deepEqual([destination.x,destination.y,destination.plane,destination.mapId],[station.x,station.y,station.plane,station.mapId]);
  }
  assert.ok(MAP_PIN_DETAILS.coverage.transportWithDestinations>9);
});

test('exact component sampling never substitutes a blocked tile or incompatible plane',()=>{
  const bytes=Buffer.alloc(8192),planes=Buffer.alloc(4096);
  bytes.writeUInt16LE(1,((50%64)*64+60%64)*2);
  const station={id:'fixture',mapId:28,plane:0,chunkId:'0',x:49,y:60};
  const masks={regions:[{id:'0',status:'decoded',provenance:{sourcePlane:0,destinationPlane:0},masks:{components:bytes.toString('base64'),planes:planes.toString('base64')}}]};
  const blocked=buildTransportComponents([station],masks,'mask','runtime');
  assert.equal(blocked.witnesses.length,0);assert.match(blocked.unresolved[0].reason,/blocked/);
  const sampled=buildTransportComponents([{...station,x:50}],masks,'mask','runtime');
  assert.equal(sampled.witnesses[0].componentId,'0-1000001');assert.equal(sampled.witnesses[0].evidence.offsetBytes,((50%64)*64+60%64)*2);
  planes[(50%64)*64+60%64]=1;masks.regions[0].masks.planes=planes.toString('base64');
  assert.equal(buildTransportComponents([{...station,x:50}],masks,'mask','runtime').witnesses.length,0);
});

test('Port Sarim ferry replacement keeps Musa identity and separate routes to a shared destination',()=>{
  const replacement=MAP_CONNECTIONS.replacedConnections.find(row=>row.id==='connection-port-sarim-musa-point-boat');
  assert.equal(replacement.routeId,'port-sarim--musa-point');
  const pin={id:'fixture',x:3201,y:3201,plane:0,mapId:28};
  const station=(id,x)=>({id,name:id,x,y:3201,plane:0,mapId:28,chunkId:'12850',coordinateEvidence:{kind:'wiki-object-map'},...(id==='a'?{pinIds:['fixture']}:{})});
  const route=id=>({id,name:id,kind:'boat',from:'a',to:'b',bidirectional:false,members:false,f2p:true,requirements:{levels:{},quests:[],items:[],fare:null,conditions:[],confirmations:[]},provenance:[{kind:'wiki',url:'https://runescape.wiki/w/Boat?oldid=123'}],unknowns:[]});
  const catalogue={stations:[station('a',3201),station('b',3202)],routes:[route('first'),route('second')]};
  const baseline={pins:[{id:'fixture',categoryId:'transportation',title:'Unknown',specificity:'basic',members:null,destinations:[],provenance:[],unknowns:[]}],limits:[]};
  const merged=mergeTransportPinDetails(baseline,catalogue,[pin]);
  assert.deepEqual(merged.pins[0].destinations.map(row=>row.routeId),['first','second']);
});

test('validation rejects guessed stations, unpinned facts and contradictory F2P flags',()=>{
  const sample=structuredClone(TRANSPORT_ROUTES);
  sample.stations[0].coordinateEvidence.kind='region-center';assert.throws(()=>validateTransportRoutes(sample),/exact station evidence/);
  const flags=structuredClone(TRANSPORT_ROUTES);flags.routes[0].f2p=flags.routes[0].members;assert.throws(()=>validateTransportRoutes(flags),/access flags/);
  const provenance=structuredClone(TRANSPORT_ROUTES);provenance.routes[0].provenance=[];assert.throws(()=>validateTransportRoutes(provenance),/pinned Wiki/);
});
