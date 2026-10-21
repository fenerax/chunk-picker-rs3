#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const kinds = new Set(['canoe','boat','ferry','cart','glider','balloon','portal','shortcut','stairs','ladder','cave','teleport','lodestone']);
const wikiRevision = url => /^https:\/\/runescape\.wiki\/w\/.+[?&]oldid=\d+/.test(url ?? '');
const region = (x,y) => String(Math.floor(x/64)*256+Math.floor(y/64));
const pair = (a,b) => JSON.stringify([a,b].sort());
const location = station => station.locationId ?? station.chunkId ?? station.areaId;
const pointLocation = point => point.sectionId ?? point.areaId ?? point.chunkId;
const pointBase = point => point.areaId ?? point.chunkId;
const displayKind = kind => ['ferry'].includes(kind) ? 'boat' : ['cart','glider','balloon','stairs','ladder','cave'].includes(kind) ? 'transport' : kind;

export function validateTransportRoutes(catalogue) {
  const stations = new Map();
  for (const station of catalogue.stations) {
    if (!station.id || stations.has(station.id)) throw new Error(`Duplicate/missing station: ${station.id}`);
    if (!station.name || !['x','y','plane','mapId'].every(key => Number.isInteger(station[key]))) throw new Error(`Unresolved coordinates: ${station.id}`);
    if (!station.coordinateEvidence?.kind || /center|guess/i.test(station.coordinateEvidence.kind)) throw new Error(`Missing exact station evidence: ${station.id}`);
    if (station.mapId === 28 && station.plane === 0 && station.chunkId !== region(station.x,station.y)) throw new Error(`Station region mismatch: ${station.id}`);
    stations.set(station.id,station);
  }
  const ids = new Set();
  for (const route of catalogue.routes) {
    if (!route.id || ids.has(route.id)) throw new Error(`Duplicate/missing route: ${route.id}`);
    ids.add(route.id);
    if (!kinds.has(route.kind)) throw new Error(`Unknown route kind: ${route.id}`);
    if (!stations.has(route.to) || (route.from !== null && !stations.has(route.from))) throw new Error(`Missing endpoint: ${route.id}`);
    if (route.from === null && !['teleport','lodestone'].includes(route.kind)) throw new Error(`Missing origin: ${route.id}`);
    if (typeof route.members !== 'boolean' || route.f2p !== !route.members || typeof route.bidirectional !== 'boolean') throw new Error(`Invalid access flags: ${route.id}`);
    if (!route.requirements || !route.provenance?.some(source => wikiRevision(source.url))) throw new Error(`Missing requirements or pinned Wiki provenance: ${route.id}`);
    if (!Array.isArray(route.unknowns)) throw new Error(`Missing unknowns: ${route.id}`);
  }
  return catalogue;
}

export function buildTransportRoutes(segments, inputs = [],componentEvidence=null,accessEvidence=null) {
  const stations = new Map(), routes = new Map(), networks = [],pendingRoutes=[],unresolvedDestinations=[],obstacles=[];
  for (const segment of segments) {
    for (const station of segment.stations) {
      const prior = stations.get(station.id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(station)) throw new Error(`Conflicting station ${station.id}`);
      stations.set(station.id,clone(station));
    }
    for (const route of segment.routes) {
      if (routes.has(route.id)) throw new Error(`Conflicting route ${route.id}`);
      routes.set(route.id,clone(route));
    }
    if (segment.networks) networks.push(...(Array.isArray(segment.networks) ? clone(segment.networks) : [clone(segment.networks)]));
    const networkRows=Array.isArray(segment.networks)?segment.networks:segment.networks?[segment.networks]:[];
    pendingRoutes.push(...clone(segment.pendingRoutes ?? networkRows.flatMap(network=>network.pendingRoutes??[])));
    unresolvedDestinations.push(...clone(segment.unresolvedDestinations ?? networkRows.flatMap(network=>network.unresolvedDestinations??[])));
    obstacles.push(...clone(segment.obstacles ?? networkRows.flatMap(network=>network.obstacles??[])));
  }
  for(const anchor of accessEvidence?.anchors ?? []){
    const station=stations.get(anchor.stationId);
    if(!station||anchor.mapId!==station.mapId||anchor.plane!==station.plane||region(anchor.x,anchor.y)!==station.chunkId||!wikiRevision(anchor.coordinateEvidence?.url))throw new Error(`Invalid named station access anchor: ${anchor.stationId}`);
    station.accessAnchor=clone(anchor);
  }
  for(const witness of componentEvidence?.witnesses ?? []){
    const station=stations.get(witness.stationId);
    const anchor=station?.accessAnchor ?? station;
    if(!station||!['x','y','plane','mapId'].every(key=>anchor[key]===witness[key]))throw new Error(`Stale transport component witness: ${witness.stationId}`);
    station.componentWitness=clone(witness);
  }
  const catalogue = {schemaVersion:1,version:'2026-10-08.v1',reviewedOn:'2026-10-08',
    provenance:{attribution:'RuneScape Wiki contributors; facts adapted from linked revisions. Coordinates from Wiki object/NPC maps and copied-cache exports.',licence:'https://creativecommons.org/licenses/by-nc-sa/3.0/',generator:'scripts/build-transport-routes.mjs'},
    inputs,stations:[...stations.values()].sort((a,b)=>a.id.localeCompare(b.id)),routes:[...routes.values()].sort((a,b)=>a.id.localeCompare(b.id)),networks,pendingRoutes,unresolvedDestinations,obstacles,
    limitations:['Reviewed catalogue coverage is described in docs/research/transport-routes.md; missing routes remain unknown.',
      'Coordinates identify scenery, NPC, station or map-marker anchors unless explicitly labelled destination landings. A marker does not establish an exact landing tile.',
      'Membership and route mechanics do not prove personal usability or house-rule admission. access.transport defaults off.',
      'No retained connection, map projection or cache struct creates a walking edge. Interiors preserve their own map coordinates.']};
  validateTransportRoutes(catalogue);
  const byKind = {};
  for (const route of catalogue.routes) {
    const counts = byKind[route.kind] ??= {total:0,f2p:0,members:0}; counts.total++; counts[route.f2p?'f2p':'members']++;
  }
  catalogue.summary = {stations:catalogue.stations.length,routes:catalogue.routes.length,pendingRoutes:pendingRoutes.length,unresolvedDestinations:unresolvedDestinations.length,obstacles:obstacles.length,
    f2p:catalogue.routes.filter(route=>route.f2p).length,members:catalogue.routes.filter(route=>route.members).length,byKind};
  return catalogue;
}

export function formatTransportRequirements(requirements) {
  const entries = Object.entries(requirements.levels ?? {}).map(([skill,level])=>`${level} ${skill}`);
  for (const quest of requirements.quests ?? []) entries.push(typeof quest === 'string' ? quest : quest.name ?? quest.id ?? JSON.stringify(quest));
  for (const item of requirements.items ?? []) entries.push(typeof item === 'string' ? item : `${item.quantity ?? 1} ${item.name ?? item.id}`);
  if (requirements.fare) entries.push(typeof requirements.fare === 'string' ? requirements.fare : `${requirements.fare.amount ?? '?'} ${requirements.fare.currency ?? 'coins'}${requirements.fare.detail ? ` (${requirements.fare.detail})` : ''}`);
  entries.push(...(requirements.conditions ?? []).map(value=>typeof value === 'string'?value:value.detail??value.id));
  entries.push(...(requirements.confirmations ?? []).map(value=>`Personally confirm ${typeof value==='string'?value:value.id}`));
  return entries.filter(Boolean).join('; ') || null;
}

const stationPoint = station => ({chunkId:station.chunkId ?? null,locationId:station.locationId ?? null,areaId:station.areaId ?? (station.locationId&&station.locationId!==station.chunkId&&!station.locationId.startsWith(`${station.chunkId}-`)?station.locationId:!/^\d+(?:-\d+)?$/.test(location(station) ?? '') ? location(station) : null),
  sectionId:/^\d+-\d+$/.test(station.locationId ?? '') ? station.locationId : null,stationId:station.id,name:station.name,
  x:station.x,y:station.y,plane:station.plane,mapId:station.mapId,
  precision:station.coordinateEvidence.kind.includes('marker')?'map-marker-anchor':'exact-entrance',coordinateEvidence:clone(station.coordinateEvidence),
  ...(station.mapId===28&&station.plane===0?{worldX:(station.x+0.5-1856)*2,worldY:(4608-station.y-0.5)*2}:{worldX:null,worldY:null})});

/** Replace approximate display declarations, preserving every original pointer once. */
export function mergeTransportConnections(baseline, catalogue, input = null) {
  validateTransportRoutes(catalogue);
  const result = clone(baseline), stations = new Map(catalogue.stations.map(station=>[station.id,station]));
  const exact = catalogue.routes.filter(route=>route.from!==null).map(route=>{
    const from=stationPoint(stations.get(route.from)),to=stationPoint(stations.get(route.to));
    return {id:`connection-${route.id}`,routeId:route.id,kind:displayKind(route.kind),routeKind:route.kind,from,to,label:route.name,members:route.members,f2p:route.f2p,
      requirement:formatTransportRequirements(route.requirements),requirements:clone(route.requirements),bidirectional:route.bidirectional,
      drawable:from.mapId===28&&to.mapId===28&&from.plane===0&&to.plane===0,
      provenance:[{kind:'reviewed-transport-route',file:'app/data/transport-routes.2026-10-08.v1.json',routeId:route.id,provenance:clone(route.provenance)},...clone(route.provenance)],unknowns:clone(route.unknowns)};
  });
  const replaced = [];
  result.connections = result.connections.filter(edge=>{
    if (edge.kind==='walking') return true;
    const match = exact.find(route=> {
      const precisePair = pair(pointLocation(edge.from),pointLocation(edge.to))===pair(pointLocation(route.from),pointLocation(route.to));
      const barePair = edge.from.precision==='region-center'&&edge.to.precision==='region-center'
        &&edge.from.chunkId!==edge.to.chunkId&&pair(pointBase(edge.from),pointBase(edge.to))===pair(pointBase(route.from),pointBase(route.to));
      const knownRoute = (edge.id==='connection-port-sarim-musa-point-boat'&&pair(pointBase(route.from),pointBase(route.to))===pair('12082','11825')&&route.routeKind==='boat')
        ||(edge.id==='connection-iron-enclave-lumbridge-portal'&&pair(pointBase(route.from),pointBase(route.to))===pair('12850','9001')&&route.routeKind==='portal');
      return precisePair || barePair || knownRoute;
    });
    if (!match) return true;
    match.provenance.push(...edge.provenance.map(source=>({...source,replacedConnectionId:edge.id})));
    replaced.push({id:edge.id,routeId:match.routeId,from:pointLocation(edge.from),to:pointLocation(edge.to),kind:edge.kind});
    return false;
  });
  result.connections.push(...exact);
  result.connections.sort((a,b)=>a.id.localeCompare(b.id));
  for (const route of catalogue.routes.filter(route=>route.from===null)) {
    const station=stations.get(route.to);
    result.destinations.push({id:`destination-${route.id}`,routeId:route.id,name:route.name,...stationPoint(station),kind:route.kind,
      members:route.members,f2p:route.f2p,requirement:formatTransportRequirements(route.requirements),requirements:clone(route.requirements),origin:null,
      provenance:{kind:'reviewed-transport-route',routeId:route.id,provenance:clone(route.provenance)}});
  }
  result.version='2026-10-08.v2';
  if (input) result.inputs.push(input);
  result.provenance.transport={file:'app/data/transport-routes.2026-10-08.v1.json',generator:'scripts/build-transport-routes.mjs'};
  result.replacedConnections=replaced;
  Object.assign(result.summary,{connections:result.connections.length,drawableConnections:result.connections.filter(edge=>edge.drawable).length,
    unresolvedConnections:result.connections.filter(edge=>!edge.drawable).length,destinations:result.destinations.length,
    reviewedTransportRoutes:catalogue.routes.length,reviewedTransportConnections:exact.length,replacedConnections:replaced.length,
    supplementalConnections:baseline.summary.supplementalConnections+exact.length-replaced.filter(edge=>['connection-port-sarim-musa-point-boat','connection-iron-enclave-lumbridge-portal'].includes(edge.id)).length});
  result.limitations.push('Exact reviewed routes replace matching approximate retained display links; original declarations survive in route provenance and replacedConnections.');
  return result;
}

export function mergeTransportPinDetails(baseline, catalogue, inputPins) {
  const result=clone(baseline),stations=new Map(catalogue.stations.map(station=>[station.id,station])),byId=new Map(result.pins.map(pin=>[pin.id,pin]));
  const immutable=new Map(inputPins.map(pin=>[pin.id,pin])), joins=[];
  const attach=(station,destination,route)=>{
    for (const pinId of station.pinIds ?? []) {
      const detail=byId.get(pinId),pin=immutable.get(pinId);
      if (!detail||!pin) throw new Error(`Unknown stable station pin ${pinId}`);
      if (pin.mapId!==station.mapId || pin.plane!==station.plane || Math.hypot(pin.x-station.x,pin.y-station.y)>16) throw new Error(`Unbounded station pin join ${pinId} -> ${station.id}`);
      const evidence={kind:'reviewed-transport-route',routeId:route.id,stationId:station.id,url:route.provenance.find(source=>wikiRevision(source.url)).url,
        coordinateEvidence:clone(station.coordinateEvidence),distanceTiles:Math.hypot(pin.x-station.x,pin.y-station.y)};
      if (!detail.provenance.some(source=>source.kind==='reviewed-transport-route'&&source.routeId===route.id)) detail.provenance.push(evidence);
      detail.specificity='specific'; detail.title=station.name;
      if (detail.members===null) detail.members=route.members;
      else if (detail.members!==route.members) detail.members=false; // At least one free service at this station.
      const target={name:destination.name,x:destination.x,y:destination.y,plane:destination.plane,mapId:destination.mapId,
        stationId:destination.id,routeId:route.id,kind:displayKind(route.kind),routeKind:route.kind,members:route.members,f2p:route.f2p,
        bidirectional:route.bidirectional,requirements:clone(route.requirements),source:'reviewed-transport-route',coordinateKind:'reviewed-station-anchor',coordinateEvidence:clone(destination.coordinateEvidence)};
      detail.destinations=detail.destinations.filter(old=>old.source==='reviewed-transport-route'?old.routeId!==target.routeId:!(old.x===target.x&&old.y===target.y&&old.mapId===target.mapId&&old.plane===target.plane));
      detail.destinations.push(target);
      detail.unknowns=detail.unknowns.filter(value=>!value.startsWith('Exact route destination is unknown')&&!value.startsWith('Membership is unknown'));
      if (!detail.unknowns.includes('Personal route requirements and house-rule admission must be checked separately.')) detail.unknowns.push('Personal route requirements and house-rule admission must be checked separately.');
      joins.push({pinId,stationId:station.id,routeId:route.id});
    }
  };
  for (const route of catalogue.routes) {
    const to=stations.get(route.to);
    if (route.from===null) { attach(to,to,route); continue; }
    const from=stations.get(route.from); attach(from,to,route); if(route.bidirectional) attach(to,from,route);
  }
  for (const detail of result.pins.filter(pin=>pin.provenance.some(source=>source.kind==='reviewed-transport-route'))) {
    const destinations=[...new Set(detail.destinations.map(destination=>destination.name))];
    detail.description=`${detail.title}. Reviewed destinations: ${destinations.join(', ')}. Requirements are recorded per destination; personal availability remains separate.`;
  }
  const categories={};
  for (const pin of result.pins) {const row=categories[pin.categoryId]??={total:0,basic:0,specific:0,provenance:0}; row.total++;row[pin.specificity]++;if(pin.provenance.length)row.provenance++;}
  result.version='2026-10-08.v2';result.transportRoutesSha256=sha256(JSON.stringify(catalogue)); result.transportJoins=joins;
  result.coverage={total:result.pins.length,basic:result.pins.filter(pin=>pin.specificity==='basic').length,specific:result.pins.filter(pin=>pin.specificity==='specific').length,provenance:result.pins.length,categories,
    transportWithDestinations:result.pins.filter(pin=>pin.categoryId==='transportation'&&pin.destinations.length).length};
  result.limits=result.limits.map(limit=>limit.startsWith('Lodestone structs supply automatic typed landings;')?'Typed cache lodestone landings and reviewed transport station anchors retain independent evidence. Player landing tiles remain unknown unless explicitly sourced; unreviewed route destinations remain unknown.':limit);
  result.limits.push('Transport destinations join only explicitly reviewed stable pin IDs to catalogue stations, with same-map/plane and maximum 16-tile safeguards. No new pin identity is invented.');
  return result;
}

export function generateTransportRoutes() {
  const paths=['app/data/transport-routes.f2p.2026-10-08.v1.json','app/data/transport-routes.interiors-members.2026-10-08.v1.json','app/data/transport-routes.ships.2026-10-08.v1.json'];
  const componentPath='app/data/transport-components.2026-10-08.v1.json';
  const accessPath='app/data/transport-access-anchors.2026-10-08.v1.json';
  const inputs=paths.map(path=>({kind:'segment',path,sha256:sha256RepositoryText(readFileSync(resolve(repo,path)))}));
  inputs.push({kind:'exact-components',path:componentPath,sha256:sha256RepositoryText(readFileSync(resolve(repo,componentPath)))});
  inputs.push({kind:'station-access-anchors',path:accessPath,sha256:sha256RepositoryText(readFileSync(resolve(repo,accessPath)))});
  const catalogue=buildTransportRoutes(paths.map(path=>JSON.parse(readFileSync(resolve(repo,path),'utf8'))),inputs,JSON.parse(readFileSync(resolve(repo,componentPath),'utf8')),JSON.parse(readFileSync(resolve(repo,accessPath),'utf8')));
  const write=(path,value)=>writeFileSync(resolve(repo,path),`${JSON.stringify(value)}\n`);
  write('app/data/transport-routes.2026-10-08.v1.json',catalogue);
  const read=path=>JSON.parse(readFileSync(resolve(repo,path),'utf8'));
  const connections=mergeTransportConnections(read('archive/data/map-connections.2026-10-08.v1.json'),catalogue,{kind:'reviewed-transport-routes',path:'app/data/transport-routes.2026-10-08.v1.json',sha256:sha256RepositoryText(readFileSync(resolve(repo,'app/data/transport-routes.2026-10-08.v1.json')))});
  write('archive/data/map-connections.2026-10-08.v2.json',connections);
  const pins=mergeTransportPinDetails(read('archive/data/map-pin-details.2026-10-08.v1.json'),catalogue,read('app/data/map-pin-details.inputs.2026-10-08.v1.json').pins);
  write('app/data/map-pin-details.2026-10-08.v2.json',pins);
  return {routes:catalogue.summary,connections:connections.summary,pins:pins.coverage};
}
if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(generateTransportRoutes()));
