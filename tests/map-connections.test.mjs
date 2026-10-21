import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
import { MAP_CONNECTIONS as ACTIVE_CONNECTIONS, getMapConnectionsForChunk, mapConnectionsPayload } from '../app/data/map-connections.mjs';
import MAP_CONNECTIONS from '../archive/data/map-connections.2026-10-08.v1.json' with { type: 'json' };
import { buildMapConnections } from '../scripts/build-map-connections.mjs';

const definitionsBytes = readFileSync(new URL('../rs3-chunkpicker-chunkinfo-export.json',import.meta.url));
const definitions = JSON.parse(definitionsBytes);
const retained = MAP_CONNECTIONS.connections.flatMap(row => row.provenance.filter(source => source.kind === 'retained-reference'));
const escapePointer = value => String(value).replaceAll('~','~0').replaceAll('/','~1');

test('historical map bundles are archived while runtime modules select current catalogues', () => {
  const archived = ['map-connections.2026-10-08.v1.json', 'map-connections.2026-10-08.v2.json',
    'map-connections.2026-10-08.v3.json', 'map-pin-details.2026-10-08.v1.json'];
  for (const name of archived) {
    assert.ok(existsSync(new URL(`../archive/data/${name}`, import.meta.url)), name);
    assert.equal(existsSync(new URL(`../app/data/${name}`, import.meta.url)), false, name);
  }
  const runtime = new URL('../app/', import.meta.url);
  for (const relative of readdirSync(runtime, { recursive: true }).filter(name => name.endsWith('.mjs'))) {
    const source = readFileSync(new URL(relative.replaceAll('\\', '/'), runtime), 'utf8');
    for (const name of archived) assert.equal(source.includes(name), false, `${relative} references ${name}`);
  }
  assert.equal(ACTIVE_CONNECTIONS.version, '2026-10-09.v1');
});

test('catalogue preserves every retained content and incoming section declaration', () => {
  const expected = [];
  for (const [base,record] of Object.entries(definitions.chunks)) {
    for (const target of Object.keys(record.Connect ?? {})) expected.push(`/chunks/${escapePointer(base)}/Connect/${escapePointer(target)}`);
    for (const [part,contents] of Object.entries(record.Sections ?? {})) for (const target of Object.keys(contents.Connect ?? {})) expected.push(`/chunks/${escapePointer(base)}/Sections/${part}/Connect/${escapePointer(target)}`);
  }
  for (const [base,parts] of Object.entries(definitions.sections)) for (const [part,sources] of Object.entries(parts)) sources.forEach((source,index) => expected.push(`/sections/${base}/${part}/${index}`));
  assert.equal(expected.length,4216);
  assert.deepEqual(retained.map(row => row.pointer).sort(),expected.sort());
  assert.equal(MAP_CONNECTIONS.summary.retainedContentDeclarations,1856);
  assert.equal(MAP_CONNECTIONS.summary.retainedSectionDeclarations,2360);
  assert.equal(MAP_CONNECTIONS.inputs.find(row => row.kind === 'retained-reference').sha256,
    sha256RepositoryText(definitionsBytes));
});

test('endpoints, unknown metadata and provenance preserve display evidence boundaries', () => {
  const ids = new Set();
  for (const edge of MAP_CONNECTIONS.connections) {
    assert.ok(!ids.has(edge.id)); ids.add(edge.id);
    assert.equal(typeof edge.label,'string');
    assert.ok(edge.members === null || typeof edge.members === 'boolean');
    assert.ok(edge.requirement === null || typeof edge.requirement === 'string');
    assert.ok(edge.bidirectional === null || typeof edge.bidirectional === 'boolean');
    assert.ok(edge.provenance.length > 0);
    for (const point of [edge.from,edge.to]) {
      assert.ok(point.chunkId || point.areaId);
      assert.ok(['region-center','area-center','map-label-anchor','map-marker-anchor','exact-entrance','exact-boundary-tile','unresolved'].includes(point.precision));
      assert.ok(point.coordinateEvidence || point.precision === 'unresolved');
      if (point.precision === 'unresolved') assert.deepEqual([point.x,point.y,point.mapId,point.worldX,point.worldY],[null,null,null,null,null]);
      if (edge.drawable) {
        assert.equal(point.mapId,28); assert.equal(point.plane,0);
        const offset = point.precision === 'region-center' ? 0 : 0.5;
        assert.equal(point.worldX,(point.x+offset-1856)*2); assert.equal(point.worldY,(4608-point.y-offset)*2);
      }
    }
    if (edge.kind !== 'portal') {
      if (edge.members !== null) assert.ok(edge.provenance.some(row => row.kind === 'reviewed-pin-details'));
      if (edge.requirement) assert.ok(edge.provenance.some(row => ['reviewed-entry-policy','reviewed-pin-details'].includes(row.kind)));
    }
  }
  assert.equal(MAP_CONNECTIONS.summary.connections,MAP_CONNECTIONS.connections.length);
  assert.equal(MAP_CONNECTIONS.summary.drawableConnections,MAP_CONNECTIONS.connections.filter(row => row.drawable).length);
});

test('Port Sarim–Musa Point ferry reuses reciprocal reviewed dock markers and route provenance', () => {
  const sourceBytes = readFileSync(new URL('../archive/data/map-pin-details.2026-10-08.v1.json',import.meta.url));
  const source = JSON.parse(sourceBytes), edge = MAP_CONNECTIONS.connections.find(row => row.id === 'connection-port-sarim-musa-point-boat');
  assert.equal(MAP_CONNECTIONS.inputs.find(row => row.kind === 'reviewed-pin-details').sha256,sha256RepositoryText(sourceBytes));
  assert.equal(edge.kind,'boat'); assert.equal(edge.members,false); assert.equal(edge.bidirectional,true); assert.equal(edge.drawable,true);
  assert.equal(edge.requirement,'Base fare: 30 coins.');
  assert.deepEqual([edge.from.chunkId,edge.from.x,edge.from.y],['12082',3029,3219]);
  assert.deepEqual([edge.to.chunkId,edge.to.x,edge.to.y],['11825',2958,3143]);
  for (const point of [edge.from,edge.to]) {
    assert.equal(point.precision,'map-marker-anchor');
    const detail = source.pins.find(row => row.id === point.coordinateEvidence.pinId);
    const provenance = edge.provenance.find(row => row.pinId === detail.id);
    assert.deepEqual(provenance.provenance,detail.provenance);
    assert.ok(provenance.provenance.some(row => row.kind === 'wiki-boat-route'));
    assert.ok(getMapConnectionsForChunk(point.chunkId).some(row => row.kind === edge.kind));
  }
  assert.ok(edge.unknowns.some(value => /Exact ship landing tile is unknown/.test(value)));
});

test('Iron Enclave has verified free two-way Lumbridge portals and exact scenery coordinates', () => {
  const edge = MAP_CONNECTIONS.connections.find(row => row.id === 'connection-iron-enclave-lumbridge-portal');
  assert.ok(edge.drawable); assert.equal(edge.members,false); assert.equal(edge.bidirectional,true);
  assert.deepEqual([edge.from.chunkId,edge.from.sectionId,edge.from.x,edge.from.y],['12850','12850-1',3223,3232]);
  assert.deepEqual([edge.to.chunkId,edge.to.x,edge.to.y],['9001',2260,2674]);
  assert.match(edge.requirement,/Ironman or Group Ironman/);
  assert.equal(edge.from.precision,'exact-entrance'); assert.equal(edge.to.precision,'exact-entrance');
  assert.equal(edge.from.coordinateEvidence.objectId,131451); assert.equal(edge.to.coordinateEvidence.objectId,131450);
  assert.ok(edge.provenance.some(row => row.url.endsWith('Iron_Enclave_portal?oldid=36872074')));
  for (const id of ['9001','12850']) assert.ok(getMapConnectionsForChunk(id).some(row => row.kind === 'portal'));
  assert.ok(!getMapConnectionsForChunk('11575').some(row => row.kind === 'portal' && /Iron Enclave/.test(row.label)));
});

test('lookup and selected payload preserve catalogue identity without editable shared arrays', () => {
  assert.equal(mapConnectionsPayload(),ACTIVE_CONNECTIONS);
  const rows = getMapConnectionsForChunk('12850'); rows.pop();
  assert.equal(getMapConnectionsForChunk('12850').length,rows.length+1);
  assert.deepEqual(getMapConnectionsForChunk('missing'),[]);
  assert.deepEqual(mapConnectionsPayload({chunkId:'missing'}).connections,[]);
  assert.deepEqual(mapConnectionsPayload({chunkId:'missing'}).destinations,[]);
  assert.ok(Object.isFrozen(ACTIVE_CONNECTIONS.connections));
  assert.ok(Object.isFrozen(ACTIVE_CONNECTIONS.connections[0].from));
  assert.ok(mapConnectionsPayload({chunkId:'12850'}).destinations.some(row => /Lumbridge Lodestone/i.test(row.name)));
});

test('all coordinate travel structs remain candidates with no invented origin', () => {
  assert.equal(MAP_CONNECTIONS.summary.cacheTravelStructs,180);
  assert.equal(MAP_CONNECTIONS.destinations.length,204);
  assert.equal(new Set(MAP_CONNECTIONS.destinations.map(row => row.structId)).size,180);
  assert.equal(new Set(MAP_CONNECTIONS.destinations.map(row => row.id)).size,204);
  for (const row of MAP_CONNECTIONS.destinations) {
    assert.equal(row.origin,null); assert.equal(row.members,null); assert.equal(row.requirement,null);
    assert.equal(row.precision,'coordinate-candidate');
    assert.equal(row.provenance.kind,'cache-travel-struct');
    assert.match(row.provenance.pointer,/^\/travelStructs\/\d+\/coordinates\/\d+$/);
    assert.ok(Number.isInteger(row.sourceCoordinate.packed));
  }
});

test('incoming dependencies have the documented direction and independent reverse evidence', () => {
  const fixture = { chunks: {'12850':{Nickname:'A'},'12851':{Nickname:'B'}}, sections: {'12850':{'1':['12851-2']},'12851':{'2':['12850-1']}} };
  const result = buildMapConnections({definitions:fixture,places:{},travel:{}});
  const edge = result.connections.find(row => row.sourceSchema === 'section-connection');
  assert.deepEqual([edge.from.sectionId,edge.to.sectionId],['12851-2','12850-1']);
  assert.equal(edge.bidirectional,true); assert.equal(edge.provenance.length,2);
});

test('walking edges use filtered cache cardinal witnesses with an exact adjacent tile on each side', () => {
  const walking = MAP_CONNECTIONS.connections.filter(row => row.kind === 'walking');
  assert.equal(walking.length,MAP_CONNECTIONS.summary.cacheWalkingConnections);
  assert.ok(walking.length > 1500);
  for (const edge of walking) {
    assert.equal(edge.from.precision,'exact-boundary-tile'); assert.equal(edge.to.precision,'exact-boundary-tile');
    assert.equal(Math.abs(edge.from.x-edge.to.x)+Math.abs(edge.from.y-edge.to.y),1);
    for (const point of [edge.from,edge.to]) assert.equal(String(Math.floor(point.x/64)*256+Math.floor(point.y/64)),point.chunkId);
    assert.ok(edge.from.sectionId.match(/-100\d{4}$/));
    assert.equal(edge.bidirectional,true); assert.equal(edge.members,null);
    assert.ok(edge.provenance[0].portals>0); assert.match(edge.provenance[0].pointer,/^\/edges\/\d+$/);
  }
  assert.ok(MAP_CONNECTIONS.connections.some(row => row.kind === 'transport' && row.provenance.some(source => source.kind === 'reviewed-route')));
  assert.ok(MAP_CONNECTIONS.connections.some(row => row.kind === 'boat' && row.provenance.some(source => source.kind === 'reviewed-entry-policy')));
});

test('ambiguous labels and other-map centres never receive a guessed surface transform', () => {
  const fixture = { chunks: {'Cave':{},'Unknown':{},'12850':{}}, sections: {}, };
  fixture.chunks.Cave.Connect = {'12850':true}; fixture.chunks.Unknown.Connect = {'12850':true};
  const places = { placements:[{label:'Unknown',mapId:28,plane:0,x:3000,y:3000},{label:'Unknown',mapId:28,plane:0,x:3200,y:3200}],
    mapRecords:[{id:17,name:'Cave',center:(2500<<14)|9000,bounds:[{plane:0,src:{xstart:2496,xend:2559,zstart:8960,zend:9023},dst:{xstart:0,xend:63,zstart:0,zend:63}}]}] };
  const result = buildMapConnections({definitions:fixture,places,travel:{}});
  const cave = result.connections.find(row => row.from.areaId === 'Cave');
  assert.equal(cave.from.mapId,17); assert.equal(cave.from.precision,'area-center');
  assert.deepEqual([cave.from.x,cave.from.y],[4,40]); assert.equal(cave.drawable,false);
  const unknown = result.connections.find(row => row.from.areaId === 'Unknown');
  assert.equal(unknown.from.precision,'unresolved'); assert.equal(unknown.drawable,false);
});
