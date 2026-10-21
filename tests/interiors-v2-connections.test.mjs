import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInteriorConnections } from '../scripts/cache/interiors-v2-connections.mjs';

const layer = (mapId = 719, plane = 0) => ({ mapId, plane, bounds: { minX: 64, minY: 0, maxX: 256, maxY: 320 } });
const surface = (chunkId = '11318') => ({ chunkId, areaId: null, locationId: null, sectionId: null, name: 'Surface',
  x: 2874, y: 3502, plane: 0, mapId: 28, precision: 'exact-entrance', worldX: 2037, worldY: 2211,
  coordinateEvidence: { kind: 'wiki-object-map', objectId: 66876 } });
const collision = () => ({ ...surface('9030'), sectionId: '9030-2', name: 'Mine', x: 2272, y: 4512,
  precision: 'region-center', worldX: 832, worldY: 192, coordinateEvidence: { kind: 'retained-region-grid' } });
const edge = (from, to = surface(), extra = {}) => ({ id: 'connection-retained', kind: 'retained-connection', from, to,
  drawable: true, members: false, requirement: 'Existing gate', bidirectional: null,
  provenance: [{ kind: 'retained-reference', pointer: '/chunks/9030/Connect/11318', from: '9030', to: '11318' }], ...extra });
const catalogue = (areas = []) => ({ displayOnly: true, accessEffect: 'none', areas, maps: [] });
const area = (extra = {}) => ({ areaId: '9030', status: 'mapped', mapIds: [719], layers: [layer()],
  displayAnchor: { x: 117, y: 100, plane: 0, mapId: 719, precision: 'source-region-anchor',
    coordinateEvidence: { kind: 'verified-source-paste', source: { x: 2293, y: 4516, plane: 1 }, destinationPlane: 0 } }, ...extra });
const payload = connections => ({ schemaVersion: 1, version: '2026-10-08.v2', connections,
  inputs: [{ kind: 'existing-input' }], summary: { retainedDeclarations: 1 },
  destinations: [], entryEvidence: [{ id: 'unchanged-entry' }], replacedConnections: [{ id: 'unchanged-replacement' }] });

test('numeric interior aliases replace colliding surface centres without mutating inputs or access', () => {
  const base = payload([edge(collision())]), interior = catalogue([area()]), original = structuredClone({ base, interior });
  const result = buildInteriorConnections(base, interior, { inputs: [{ kind: 'interior-input' }] });
  const point = result.connections[0].from;
  assert.equal(result.version, '2026-10-08.v3');
  assert.deepEqual([point.x, point.y, point.mapId, point.worldX, point.worldY], [117, 100, 719, null, null]);
  assert.equal(point.offSurface, true); assert.equal(point.precision, 'source-region-anchor');
  assert.equal(point.coordinateEvidence.source.plane, 1); assert.equal(point.plane, 0);
  assert.deepEqual(point.interiorMap, { areaId: '9030', status: 'mapped', mapIds: [719], layers: [layer()], api: '/api/interior-maps?area=9030' });
  assert.equal(result.connections[0].drawable, false);
  for (const key of ['id', 'kind', 'members', 'requirement', 'bidirectional', 'provenance']) assert.deepEqual(result.connections[0][key], base.connections[0][key]);
  for (const key of ['entryEvidence', 'replacedConnections']) assert.deepEqual(result[key], base[key]);
  assert.deepEqual(result.inputs, [{ kind: 'existing-input' }, { kind: 'interior-input' }]);
  assert.deepEqual({ base, interior }, original);
  point.interiorMap.layers[0].bounds.minX = 0;
  assert.equal(interior.areas[0].layers[0].bounds.minX, 64);
});

test('map 28 interiors remain explicitly off surface, including location section suffixes', () => {
  const mapped = area({ areaId: 'Pocket', mapIds: [28], layers: [layer(28)],
    displayAnchor: { x: 100, y: 100, plane: 0, mapId: 28, precision: 'area-center', coordinateEvidence: { kind: 'wiki-reviewed-map-centre' } } });
  const point = { ...collision(), chunkId: '99999', locationId: 'Pocket-3', areaId: null };
  const result = buildInteriorConnections(payload([edge(point)]), catalogue([mapped]));
  assert.equal(result.connections[0].from.interiorMap.areaId, 'Pocket');
  assert.equal(result.connections[0].from.mapId, 28);
  assert.equal(result.connections[0].from.offSurface, true);
  assert.equal(result.connections[0].from.worldX, null);
  assert.equal(result.connections[0].drawable, false);
});

test('unknown interiors clear every coordinate and retain an explicit useful reference', () => {
  const unknown = area({ status: 'unknown', layers: [], mapIds: [], unknowns: ['No static map identity verified.'] });
  const result = buildInteriorConnections(payload([edge(collision())]), catalogue([unknown]));
  const point = result.connections[0].from;
  assert.deepEqual([point.x, point.y, point.mapId, point.plane, point.worldX, point.worldY], Array(6).fill(null));
  assert.equal(point.precision, 'unresolved'); assert.equal(point.coordinateEvidence, null);
  assert.equal(point.interiorMap.status, 'unknown'); assert.equal(point.offSurface, true);
  assert.match(point.unresolvedReason, /No static map identity/);
  assert.equal(result.summary.unresolvedInteriorEndpoints, 1);
});

test('surface exact entrances and drawing survive the display join unchanged', () => {
  const base = payload([edge(surface('12339'), surface('12850'), { id: 'connection-surface', kind: 'portal' }),
    edge(surface('12339'), surface('12850'), { id: 'connection-no-drawing', drawable: false })]);
  const result = buildInteriorConnections(base, catalogue([area()]));
  assert.deepEqual(result.connections, base.connections);
  assert.equal(result.summary.drawableConnections, 1); assert.equal(result.summary.offSurfaceConnections, 0);
});

test('only a unique entrance matching the other endpoint supplies exact station coordinates', () => {
  const station = (id, chunkId, x) => ({ id, chunkId, locationId: chunkId, x, y: 80, mapId: 719, plane: 0,
    coordinateEvidence: { kind: 'cache-object-placement', objectId: 999 } });
  const entrances = [
    { id: 'wrong-route', from: surface('12339'), to: station('wrong', '9030', 170), precision: 'reviewed-station-anchor', provenance: [{ url: 'wrong' }] },
    { id: 'mine-route', from: surface(), to: station('right', '9030', 110), precision: 'reviewed-station-anchor', provenance: [{ url: 'verified' }], unknowns: ['Player landing is unknown.'] },
  ];
  const base = payload([edge(collision())]);
  const result = buildInteriorConnections(base, catalogue([area({ entrances })]));
  const point = result.connections[0].from;
  assert.equal(point.x, 110); assert.equal(point.precision, 'exact-entrance');
  assert.equal(point.interiorEvidence.routeId, 'mine-route');
  assert.deepEqual(point.interiorEvidence.provenance, [{ url: 'verified' }]);
  assert.deepEqual(point.interiorEvidence.unknowns, ['Player landing is unknown.']);
  assert.deepEqual(result.connections[0].provenance, base.connections[0].provenance);
  const unmatched = buildInteriorConnections(payload([edge(collision(), surface('12850'))]), catalogue([area({ entrances })]));
  assert.equal(unmatched.connections[0].from.precision, 'source-region-anchor');
});

test('ambiguous routes and unverified/out-of-bounds display anchors remain coordinate-unresolved', () => {
  const entrances = [100, 120].map(x => ({ id: `route-${x}`, from: surface(), to: { chunkId: '9030', x, y: 50, mapId: 719, plane: 0,
    coordinateEvidence: { kind: 'wiki-object-map' } } }));
  for (const displayAnchor of [undefined, { x: 100, y: 100, mapId: 719, plane: 0 },
    { x: 256, y: 100, mapId: 719, plane: 0, coordinateEvidence: { kind: 'outside-half-open-bound' } }]) {
    const result = buildInteriorConnections(payload([edge(collision())]), catalogue([area({ entrances, displayAnchor })]));
    assert.equal(result.connections[0].from.precision, 'unresolved');
    assert.equal(result.connections[0].from.interiorMap.status, 'mapped');
    assert.match(result.connections[0].from.unresolvedReason, /no verified coordinate anchor/);
  }
});

test('named aliases reuse numeric route stations and preserve reviewed v2 route coordinates', () => {
  const numeric = area();
  const named = area({ areaId: 'Burthorpe Mine', aliasAreaIds: ['9030'], displayAnchor: undefined,
    entrances: [{ id: 'mine', from: surface(), to: { ...surface('9030'), x: 117, y: 100, mapId: 719 } }] });
  const namedPoint = { ...collision(), areaId: 'Burthorpe Mine', chunkId: null };
  const result = buildInteriorConnections(payload([edge(namedPoint)]), catalogue([numeric, named]));
  assert.equal(result.connections[0].from.precision, 'exact-entrance');
  assert.equal(result.connections[0].from.interiorMap.api, '/api/interior-maps?area=Burthorpe%20Mine');
  const reviewed = edge({ ...surface('9030'), x: 120, y: 80, mapId: 719 }, surface(), { routeId: 'new-reviewed-route',
    provenance: [{ kind: 'reviewed-transport-route', routeId: 'new-reviewed-route' }] });
  const retained = buildInteriorConnections(payload([reviewed]), catalogue([numeric]));
  assert.equal(retained.connections[0].from.x, 120); assert.equal(retained.connections[0].from.precision, 'exact-entrance');
});

test('destination joins preserve source identity, provenance and unknown origin', () => {
  const base = payload([]); base.destinations = [{ ...collision(), id: 'destination', origin: null,
    precision: 'coordinate-candidate', sourceCoordinate: { packed: 123 }, provenance: { kind: 'cache-travel-struct' } }];
  const result = buildInteriorConnections(base, catalogue([area()]));
  assert.equal(result.destinations[0].offSurface, true);
  for (const key of ['id', 'origin', 'sourceCoordinate', 'provenance']) assert.deepEqual(result.destinations[0][key], base.destinations[0][key]);
  assert.equal(result.destinations[0].worldX, null);
});

test('surface counterparts replace approximate centres while retaining verified surface coordinates', () => {
  const verifiedSurface = { ...surface(), x: 2801, y: 3501 };
  const entrance = { id: 'mine-route', from: verifiedSurface,
    to: { ...surface('9030'), x: 117, y: 100, mapId: 719 }, provenance: [{ kind: 'wiki', url: 'verified' }] };
  const interior = catalogue([area({ entrances: [entrance] })]);
  const approximate = { ...surface(), x: 2848, y: 3488, precision: 'region-center', coordinateEvidence: { kind: 'retained-region-grid' } };
  const joined = buildInteriorConnections(payload([edge(collision(), approximate)]), interior);
  assert.deepEqual([joined.connections[0].to.x, joined.connections[0].to.y, joined.connections[0].to.precision], [2801, 3501, 'exact-entrance']);
  assert.equal(joined.connections[0].to.interiorEvidence.routeId, 'mine-route');
  assert.equal(joined.connections[0].to.worldX, (2801 + 0.5 - 1856) * 2);
  for (const precision of ['exact-entrance', 'map-marker-anchor', 'exact-boundary-tile']) {
    const point = { ...surface(), precision };
    const retained = buildInteriorConnections(payload([edge(collision(), point)]), interior);
    assert.deepEqual(retained.connections[0].to, point);
  }
});

test('known unmatched route IDs never borrow another route station in the same chunk', () => {
  const entrance = { id: 'unrelated-route', from: { ...surface(), x: 2801, y: 3501 },
    to: { ...surface('9030'), x: 150, y: 100, mapId: 719 } };
  const interior = catalogue([area({ entrances: [entrance] })]);
  const approximate = { ...surface(), precision: 'region-center' };
  const joined = buildInteriorConnections(payload([edge(collision(), approximate, { routeId: 'requested-route' })]), interior);
  assert.deepEqual(joined.connections[0].to, approximate);
  assert.equal(joined.connections[0].from.x, 117);
  assert.equal(joined.connections[0].from.precision, 'source-region-anchor');
  const verified = { ...surface('9030'), x: 120, y: 80, mapId: 719 };
  const reviewed = edge(verified, surface(), { routeId: 'requested-route',
    provenance: [{ kind: 'reviewed-transport-route', routeId: 'requested-route' }] });
  const retained = buildInteriorConnections(payload([reviewed]), interior);
  assert.deepEqual([retained.connections[0].from.x, retained.connections[0].from.y, retained.connections[0].from.precision], [120, 80, 'exact-entrance']);
});

test('typed exact cache surface walking witnesses survive numeric interior alias collisions byte for byte', () => {
  const point = { ...collision(), mapId: 28, plane: 0, precision: 'exact-boundary-tile',
    coordinateEvidence: { kind: 'cache-cardinal-portals', component: '9030:1', portals: 2, witness: [2272, 4512] } };
  const walking = edge(point, { ...surface(), precision: 'exact-boundary-tile',
    coordinateEvidence: { kind: 'cache-cardinal-portals', component: '11318:1', portals: 2, witness: [2874, 3502] } }, { kind: 'walking' });
  const interior = catalogue([area()]);
  const result = buildInteriorConnections(payload([walking]), interior);
  assert.equal(JSON.stringify(result.connections[0]), JSON.stringify(walking));
  assert.equal(result.summary.offSurfaceConnections, 0);
  for (const mutation of [
    { precision: 'region-center' },
    { precision: 'exact-entrance' },
    { mapId: 719 },
    { plane: 1 },
    { coordinateEvidence: { kind: 'retained-region-grid' } },
  ]) {
    const ordinary = buildInteriorConnections(payload([edge({ ...point, ...mutation })]), interior);
    assert.equal(ordinary.connections[0].from.offSurface, true, JSON.stringify(mutation));
  }
});
