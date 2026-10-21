#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256RepositoryText } from './lib/provenance-hash.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { surfaceCoordinates } from '../app/data/world.mjs';
import { MAP_CORRECTIONS } from '../app/data/map-corrections.mjs';
import { cacheEntryPolicies } from '../app/data/cache-entry-policy.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const placesRoot = 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3';
const retainedUrl = 'https://github.com/source-chunk/chunk-picker-rs3/blob/98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0/rs3-chunkpicker-chunkinfo-export.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const escapePointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const nameKey = value => String(value ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
const worldPoint = (x, y, centred = false) => ({ worldX: (x + (centred ? 0 : 0.5) - 1856) * 2, worldY: (4608 - y - (centred ? 0 : 0.5)) * 2 });
const region = (x, y) => String(Math.floor(x / 64) * 256 + Math.floor(y / 64));
const packedPoint = value => ({ x: (value >>> 14) & 16383, y: value & 16383, plane: value >>> 28 });

/** Display evidence only. Retained links are never inserted into walking/access state. */
export function buildMapConnections({ definitions, places, travel, inputs = [], manifest = {}, pinDetails = null, walking = {edges:[]}, corrections = {invalidRegionIds:[],nonWalkingComponentIds:[]} }) {
  const labels = new Map(), maps = new Map();
  for (const row of places.placements ?? []) if (row.mapId === 28 && row.plane === 0 && row.label) {
    const key = nameKey(row.label), list = labels.get(key) ?? [];
    if (!list.some(point => point.x === row.x && point.y === row.y)) list.push(row);
    labels.set(key, list);
  }
  for (const row of places.mapRecords ?? []) {
    const key = nameKey(row.name), list = maps.get(key) ?? []; list.push(row); maps.set(key, list);
  }
  const endpoint = location => {
    const match = /^(\d+)-(\d+)$/.exec(location), base = match?.[1] ?? location;
    const record = definitions.chunks[base], name = record?.Nickname ?? record?.Name ?? base;
    const point = { chunkId: /^\d+$/.test(base) ? base : null, areaId: /^\d+$/.test(base) ? null : base,
      sectionId: match ? location : null, name, x: null, y: null, plane: null, mapId: null,
      precision: 'unresolved', worldX: null, worldY: null, coordinateEvidence: null };
    // Numeric retained regions have known grid centres, never exact entrances.
    if (surfaceCoordinates(base)) {
      const x = Math.floor(Number(base) / 256) * 64 + 32, y = Number(base) % 256 * 64 + 32;
      return { ...point, x, y, plane: 0, mapId: 28, precision: 'region-center', ...worldPoint(x, y, true),
        coordinateEvidence: { kind: 'retained-region-grid', location: base } };
    }
    const candidates = labels.get(nameKey(name)) ?? [];
    if (candidates.length === 1) {
      const row = candidates[0];
      return { ...point, x: row.x, y: row.y, plane: row.plane, mapId: row.mapId, precision: 'map-label-anchor',
        displayChunkId: region(row.x, row.y), ...worldPoint(row.x, row.y),
        coordinateEvidence: { kind: 'cache-explicit-label', elementId: row.elementId, source: row.source, transform: row.transform } };
    }
    const mapCandidates = maps.get(nameKey(name)) ?? [];
    if (mapCandidates.length === 1 && Number.isInteger(mapCandidates[0].center)) {
      const map = mapCandidates[0], source = packedPoint(map.center);
      const bounds = (map.bounds ?? []).filter(b => b.plane === source.plane && source.x >= b.src.xstart
        && source.x <= b.src.xend && source.y >= b.src.zstart && source.y <= b.src.zend);
      const translations = new Set(bounds.map(bound => `${bound.dst.xstart-bound.src.xstart}:${bound.dst.zstart-bound.src.zstart}`));
      if (bounds.length && translations.size === 1) {
        const bound = bounds[0], x = source.x + bound.dst.xstart - bound.src.xstart,
          y = source.y + bound.dst.zstart - bound.src.zstart;
        // Other-map centres are useful detail endpoints, without a guessed surface paste.
        return { ...point, x, y, plane: source.plane, mapId: map.id, precision: 'area-center',
          coordinateEvidence: { kind: 'cache-map-zone-center', mapId: map.id, packed: map.center, source, bounds: bound } };
      }
    }
    return point;
  };
  const edges = new Map();
  let retainedContentDeclarations = 0, retainedSectionDeclarations = 0;
  const add = (fromId, toId, kind, pointer, extra = {}) => {
    const ids = [fromId, toId].sort(), key = JSON.stringify([kind,...ids]);
    let edge = edges.get(key);
    if (!edge) {
      const from = endpoint(fromId), to = endpoint(toId);
      edge = { id: `connection-${hash(key).slice(0,24)}`, from, to, kind: 'retained-connection', sourceSchema: kind, label: `${from.name} → ${to.name}`,
        members: null, requirement: null, bidirectional: kind === 'section-connection' ? false : null,
        drawable: from.mapId === 28 && to.mapId === 28 && from.plane === 0 && to.plane === 0,
        provenance: [], ...extra };
      edges.set(key, edge);
    }
    if (extra.routeKind && ['transport','boat','teleport','ladder','shortcut','walking','quest-route'].includes(extra.routeKind)) {
      edge.kind = extra.routeKind === 'transport' && /\b(ship|ferry)\b/i.test(extra.routeNote) ? 'boat' : extra.routeKind;
      edge.provenance.push({kind:'reviewed-route',url:extra.routeEvidence,interpretation:extra.routeNote});
    }
    if (kind === 'section-connection' && edge.provenance.some(row => row.from === toId && row.to === fromId)) edge.bidirectional = true;
    edge.provenance.push({ kind: 'retained-reference', url: retainedUrl, pointer, from: fromId, to: toId,
      interpretation: kind === 'section-connection' ? 'Incoming entry dependency; source points to destination section.' : 'Chunk contents display link; direction and access are not established.' });
  };
  for (const [base, contents] of Object.entries(definitions.chunks)) {
    const scan = (record, location, path) => {
      for (const target of Object.keys(record.Connect ?? {})) {
        retainedContentDeclarations++;
        add(location, target, 'area-connection', `${path}/Connect/${escapePointer(target)}`);
      }
    };
    scan(contents, base, `/chunks/${escapePointer(base)}`);
    for (const [part, record] of Object.entries(contents.Sections ?? {})) scan(record, `${base}-${part}`, `/chunks/${escapePointer(base)}/Sections/${part}`);
  }
  for (const [base, parts] of Object.entries(definitions.sections ?? {})) for (const [part, sources] of Object.entries(parts)) sources.forEach((source, index) => {
    retainedSectionDeclarations++;
    const route = MAP_CORRECTIONS.find(row => row.field === 'routeKind' && row.chunk === base && row.section === part && row.edge === source);
    add(source, `${base}-${part}`, 'section-connection', `/sections/${base}/${part}/${index}`, route ? {
      routeKind: route.newValue, routeNote: route.rationale, routeEvidence: route.evidenceUrl,
    } : {});
  });
  // These two entry policies identify the same single retained incoming route.
  // A policy on an island is not applied to every island walking dependency.
  for (const [destination,source] of [['12073','12329-4'],['14902','14646-1']]) {
    const policy = cacheEntryPolicies.find(row => row.location === destination);
    const edge = [...edges.values()].find(row => row.sourceSchema === 'section-connection' && row.provenance.some(p => p.from === source && p.to === `${destination}-0`));
    if (!policy || !edge) continue;
    edge.kind = policy.kind; edge.requirement = policy.conditions || null;
    edge.provenance.push({kind:'reviewed-entry-policy',url:policy.evidence,verifiedOn:policy.verifiedOn,interpretation:policy.detail});
  }
  const portalEndpoint = (chunkId, name, x, y, objectId, sectionId = null) => ({ chunkId, areaId: null, sectionId, name, x, y,
    plane: 0, mapId: 28, precision: 'exact-entrance', ...worldPoint(x,y), coordinateEvidence: {
      kind: 'wiki-object-map', objectId, url: 'https://runescape.wiki/w/Iron_Enclave_portal?oldid=36872074', verifiedOn: '2026-10-08',
    } });
  const iron = { id: 'connection-iron-enclave-lumbridge-portal', kind: 'portal', label: 'Iron Enclave portal · Lumbridge ↔ Iron Enclave',
    from: portalEndpoint('12850','Lumbridge',3223,3232,131451,'12850-1'),
    to: portalEndpoint('9001','Iron Enclave',2260,2674,131450), members: false,
    requirement: 'Ironman or Group Ironman account; portal visibility and entry depend on account mode.', bidirectional: true, drawable: true,
    provenance: [{ kind: 'wiki', url: 'https://runescape.wiki/w/Iron_Enclave_portal?oldid=36872074', verifiedOn: '2026-10-08',
      interpretation: 'Two map-28 object coordinates and travel between locations; coordinates are portal scenery anchors, not a claimed landing tile.' },
    { kind: 'wiki', url: 'https://runescape.wiki/w/Iron_Enclave?oldid=37163617', verifiedOn: '2026-10-08',
      interpretation: 'Free-to-play island; standard accounts cannot enter; Ironman and Group Ironman accounts use Lumbridge portal.' }] };
  const invalid = new Set(corrections.invalidRegionIds), nonWalking = new Set(corrections.nonWalkingComponentIds), walkingEdges = [];
  for (const [index,row] of (walking.edges ?? []).entries()) {
    const [a,b,portals,x,y] = row, [baseA,labelA] = a.split(':'), [baseB,labelB] = b.split(':');
    const dx = Math.floor(Number(baseB)/256)-Math.floor(Number(baseA)/256), dy = Number(baseB)%256-Number(baseA)%256;
    if (invalid.has(baseA) || invalid.has(baseB) || nonWalking.has(a) || nonWalking.has(b)
      || !surfaceCoordinates(baseA) || !surfaceCoordinates(baseB) || Math.abs(dx)+Math.abs(dy)!==1
      || !(portals>0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    let fromX,fromY,toX,toY;
    if (region(x,y) === baseA) { fromX=x;fromY=y;toX=x+dx;toY=y+dy; }
    else if (region(x,y) === baseB) { toX=x;toY=y;fromX=x-dx;fromY=y-dy; }
    else continue;
    if (region(fromX,fromY)!==baseA || region(toX,toY)!==baseB) continue;
    const boundary = (base,label,x,y) => ({...endpoint(base),sectionId:`${base}-${1000000+Number(label)}`,x,y,
      precision:'exact-boundary-tile',...worldPoint(x,y),coordinateEvidence:{kind:'cache-cardinal-portals',component:`${base}:${label}`,portals,witness:[x,y]}});
    walkingEdges.push({id:`connection-walking-${hash(JSON.stringify([a,b])).slice(0,24)}`,
      from:boundary(baseA,labelA,fromX,fromY),to:boundary(baseB,labelB,toX,toY),kind:'walking',
      label:`${endpoint(baseA).name} ↔ ${endpoint(baseB).name} · walking boundary`,members:null,requirement:null,bidirectional:true,drawable:true,
      provenance:[{kind:'cache-cardinal-portals',path:'app/data/cache-walkability.2026-10-07.v1.json',pointer:`/edges/${index}`,portals,witness:[x,y],
        interpretation:'Conservative plane-0 cardinal walking portals in copied cache; one adjacent tile on each side. No current-player access is implied.'}]});
  }
  const reviewedPinEdges = [];
  const portId = 'cache-d7277ddb549f7bafb65fc743', musaId = 'cache-f82dc351018379ceaf8aa330';
  const port = pinDetails?.pins?.find(row => row.id === portId), musa = pinDetails?.pins?.find(row => row.id === musaId);
  if (pinDetails) {
    const toMusa = port?.destinations?.find(row => row.pinId === musaId && row.kind === 'boat'),
      toPort = musa?.destinations?.find(row => row.pinId === portId && row.kind === 'boat');
    if (!toMusa || !toPort || ![toMusa,toPort].every(row => row.mapId === 28 && row.plane === 0
      && row.coordinateKind === 'destination-map-marker' && row.source === 'reviewed-wiki-route-and-cache-marker'
      && Number.isFinite(row.x) && Number.isFinite(row.y))) throw new Error('Missing reciprocal reviewed Port Sarim–Musa Point dock markers.');
    const dock = (point,detail) => ({chunkId:region(point.x,point.y),areaId:null,sectionId:null,name:point.name,
      x:point.x,y:point.y,plane:point.plane,mapId:point.mapId,precision:'map-marker-anchor',...worldPoint(point.x,point.y),
      coordinateEvidence:{kind:'cache-map-marker',pinId:detail.id,source:point.source,
        provenance:detail.provenance.filter(row => row.kind === 'cache-pin')}});
    reviewedPinEdges.push({id:'connection-port-sarim-musa-point-boat',kind:'boat',label:'Port Sarim ↔ Musa Point · ferry dock markers',
      from:dock(toPort,port),to:dock(toMusa,musa),members:typeof port.members === 'boolean' && port.members === musa.members ? port.members : null,
      requirement:[port,musa].every(row => /base fare of 30 coins/i.test(row.description)) ? 'Base fare: 30 coins.' : null,
      bidirectional:true,drawable:true,
      provenance:[port,musa].map(detail => ({kind:'reviewed-pin-details',file:'archive/data/map-pin-details.2026-10-08.v1.json',pinId:detail.id,
        provenance:detail.provenance,interpretation:'Reciprocal Wiki-reviewed ferry route and cache dock marker; coordinates are map-marker anchors, not exact entrances or landing tiles.'})),
      unknowns:[...new Set([...port.unknowns,...musa.unknowns])],
    });
  }
  const connections = [...edges.values(), iron,...walkingEdges,...reviewedPinEdges].sort((a,b) => a.id.localeCompare(b.id));
  const destinations = [];
  for (const [rowIndex,row] of (travel.travelStructs ?? []).entries()) for (const [index, coord] of row.coordinates.entries()) {
    const name = row.strings.find(value => value.param === 2794)?.value ?? row.strings[0]?.value ?? `Travel struct ${row.id}`;
    const projections = coord.surface?.length ? coord.surface : coord.mapProjections?.length ? coord.mapProjections : [{ x: coord.x, y: coord.y, plane: coord.plane, mapId: null }];
    for (const projection of projections) destinations.push({ id: `travel-struct-${row.id}-${index}-${projection.mapId ?? 'unknown'}-${projection.x}-${projection.y}-${projection.plane}`,
      structId: row.id, name, description: row.strings.find(value => value.param === 2795)?.value ?? null,
      chunkId: projection.mapId === 28 && projection.plane === 0 ? region(projection.x,projection.y) : null,
      x: projection.x, y: projection.y, plane: projection.plane, mapId: projection.mapId, precision: 'coordinate-candidate',
      ...(projection.mapId === 28 && projection.plane === 0 ? worldPoint(projection.x,projection.y) : {}),
      sourceCoordinate: { x: coord.x, y: coord.y, plane: coord.plane, packed: coord.packed, param: coord.param },
      members: null, requirement: null, origin: null,
      provenance: { kind: 'cache-travel-struct', pointer: `/travelStructs/${rowIndex}/coordinates/${index}`, decoderCommit: travel.provenance?.decoder?.commit,
        interpretation: 'Typed coordinate and travel text candidate; no route origin or personal availability is established.', projection },
    });
  }
  return { schemaVersion: 1, version: '2026-10-08.v1', generatedAt: '2026-10-08', inputs,
    provenance: { generator:'scripts/build-map-connections.mjs', places:{generatedAt:places.provenance?.generatedAt,
      decoder:manifest.decoder ?? places.provenance?.decoder,sources:manifest.sources ?? []},
      walking:walking.provenance ?? null,
      wiki:{attribution:'RuneScape Wiki contributors; portal coordinates and access facts adapted with linked revision provenance.',
        licence:'https://creativecommons.org/licenses/by-nc-sa/3.0/',verifiedOn:'2026-10-08'} },
    summary: { retainedContentDeclarations, retainedSectionDeclarations, retainedDeclarations: retainedContentDeclarations + retainedSectionDeclarations,
      connections: connections.length, drawableConnections: connections.filter(row => row.drawable).length,
      unresolvedConnections: connections.filter(row => !row.drawable).length, cacheTravelStructs: travel.travelStructs?.length ?? 0,
      destinations: destinations.length, supplementalConnections: 1+reviewedPinEdges.length, cacheWalkingConnections: walkingEdges.length, cacheWalkingCandidates:walking.edges?.length ?? 0 },
    limitations: [
      'Display connections do not change ownership, walking topology, access, tasks or personal teleport availability.',
      'All retained declarations are preserved; reciprocal declarations share an edge. Retained display links do not certify direction, membership or access requirements.',
      'Region centres and map-label anchors are approximate display endpoints, not entrances. Named area centres use uniquely matched cache map definitions; unmatched locations stay unresolved.',
      'Section dependency direction follows the retained incoming-entry convention; false bidirectional means no independently recorded reverse dependency, not a gameplay proof of one-way travel. Stale or corrected reference dependencies remain labelled reference evidence.',
      'Cache travel structs are separate destination candidates with no invented origin; typed coordinates and client text alone do not verify a usable teleport.',
      'Copied cache schema build 950 is inferred compatibility, not verified live-client build or a completeness guarantee.',
      'Wiki portal coordinates identify scenery anchors; exact teleport landing tiles have not been observed in gameplay.',
    ], connections, destinations, entryEvidence:cacheEntryPolicies };
}

export function generateMapConnections({ inputPaths = {} } = {}) {
  // Rebuilding historical provenance may retain its path labels while reading
  // the corresponding repository input from this worktree.
  const load = (path, kind, repositoryText = false) => { const bytes = readFileSync(path); return { data: JSON.parse(bytes), input: { kind, path: inputPaths[kind] ?? path.replaceAll('\\','/'), sha256: repositoryText ? sha256RepositoryText(bytes) : hash(bytes) } }; };
  const definitions = load(resolve(repo,'rs3-chunkpicker-chunkinfo-export.json'),'retained-reference',true);
  const places = load(`${placesRoot}/places.v1.json`,'cache-places');
  const travel = load(`${placesRoot}/travel.v1.json`,'cache-travel');
  const manifest = load(`${placesRoot}/manifest.v1.json`,'cache-places-manifest');
  const walking = load(resolve(repo,'app/data/cache-walkability.2026-10-07.v1.json'),'cache-walking',true);
  const corrections = load(resolve(repo,'app/data/cache-surface-corrections.2026-10-08.v1.json'),'cache-surface-corrections',true);
  const pinDetails = load(resolve(repo,'archive/data/map-pin-details.2026-10-08.v1.json'),'reviewed-pin-details',true);
  const result = buildMapConnections({ definitions: definitions.data, places: places.data, travel: travel.data,
    walking:walking.data,corrections:corrections.data,manifest:manifest.data,pinDetails:pinDetails.data,
    inputs: [definitions.input,places.input,travel.input,manifest.input,walking.input,corrections.input,pinDetails.input,
      {kind:'generator',path:'scripts/build-map-connections.mjs',sha256:sha256RepositoryText(readFileSync(fileURLToPath(import.meta.url)))}] });
  writeFileSync(resolve(repo,'archive/data/map-connections.2026-10-08.v1.json'), `${JSON.stringify(result)}\n`);
  return result.summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(generateMapConnections()));
