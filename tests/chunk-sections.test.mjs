import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { compactChunkSections, buildChunkSectionIndex, chunkSectionsPayload, loadChunkSectionIndex,
  SECTION_MASK_ENCODING, SECTION_BUNDLE_DIRECTORY, SECTION_INPUTS } from '../app/core/chunk-sections.mjs';
import { sha256, sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const componentId = label => `12850-${1000000 + label}`;
function fixtureWorld() {
  return { chunks: new Map([['12850', { name: 'Fixture' }], ['12851', { name: 'Unknown' }]]),
    sectionTopology: new Map([['12850', new Map([['0', []], ['1', []], ['2', []], ['3', []]])]]),
    cacheWalking: { components: new Map([1, 2, 3].map(label => [componentId(label), { id: componentId(label), base: '12850', label, tiles: label === 1 ? 2 : 1 }])),
      legacyToComponents: new Map([['12850-0', [componentId(1), componentId(2)]], ['12850-1', [componentId(1)]], ['12850-2', [componentId(1)]]]),
      componentToLegacy: new Map([[componentId(1), ['12850-1', '12850-2']], [componentId(2), ['12850-0']]]),
      coverage: new Map([['12850', 'decoded']]), surfaceCorrections: { invalidRegionIds: [], nonWalkingComponentIds: [], provenance: { walkabilitySha256: 'fixture-source' } } } };
}
function fixtureCatalogue(world = fixtureWorld()) {
  const labels = Buffer.alloc(8192);
  // Deliberately asymmetric: an accidental x/y transpose is observable.
  for (const [x, y, label] of [[2, 55, 1], [3, 55, 1], [60, 1, 2], [8, 9, 3]]) labels.writeUInt16LE(label, (x * 64 + y) * 2);
  return compactChunkSections({ regions: [{ id: '12850', status: 'decoded', masks: {
    encoding: 'base64', order: 'x*64+z', componentType: 'uint16-le', components: labels.toString('base64') } }] }, world,
  { pins: [{ id: 'fixture-pin', mapId: 28, plane: 0, chunkId: '12850', x: 3202, y: 3255, label: 'Fixture landmark' },
    { id: 'off-mask', mapId: 28, plane: 0, chunkId: '12850', x: 3204, y: 3255, label: 'Nearby is insufficient' }] });
}
const tiles = row => {
  const bytes = Buffer.from(row.mask.data, 'base64'), result = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (bytes[(y * 64 + x) >> 3] & 1 << ((y * 64 + x) & 7)) result.push([x, y]);
  return result;
};

test('sections preserve retained selectors, exact union masks, tiny extra components and shared mappings', () => {
  const world = fixtureWorld(), payload = chunkSectionsPayload(world, '12850', buildChunkSectionIndex(fixtureCatalogue(world), world));
  assert.equal(payload.coordinateSystem, 'local-x-east-y-north');
  assert.deepEqual(payload.sections.map(row => row.id), ['12850-0', '12850-1', '12850-2', '12850-3', componentId(3)]);
  const [whole, first, shared, unknown, tiny] = payload.sections;
  assert.equal(whole.mask.encoding, SECTION_MASK_ENCODING); assert.equal(Buffer.from(whole.mask.data, 'base64').length, 512);
  assert.deepEqual(tiles(whole), [[60, 1], [2, 55], [3, 55]]);
  assert.equal(whole.walkableTileCount, 3); assert.deepEqual(tiles(first), [[2, 55], [3, 55]]);
  assert.deepEqual(first.mask, shared.mask); assert.match(first.description, /Fixture landmark/); assert.doesNotMatch(first.description, /Nearby/);
  assert.deepEqual(first.labelPoint, { x: 2.5, y: 55.5 });
  assert.equal(unknown.geometryStatus, 'unknown'); assert.equal(unknown.mask, null); assert.equal(unknown.labelPoint, null); assert.equal(unknown.walkableTileCount, null);
  assert.deepEqual(tiles(tiny), [[8, 9]]); assert.equal(tiny.kind, 'cache-component'); assert.equal(tiny.walkableTileCount, 1);
  assert.deepEqual(tiny.retainedSectionIds, []);
});

test('unknown coverage and suppressed surface geometry never choose a candidate or reveal invalid tiles', () => {
  const world = fixtureWorld(), catalogue = fixtureCatalogue(world);
  assert.ok(chunkSectionsPayload(world, '12850').sections.every(row => row.geometryStatus === 'unknown' && row.mask === null));
  assert.deepEqual(chunkSectionsPayload(world, '12851').sections, []); assert.equal(chunkSectionsPayload(world, '99999'), null);
  world.cacheWalking.surfaceCorrections.nonWalkingComponentIds.push('12850:3');
  let index = buildChunkSectionIndex(catalogue, world);
  assert.equal(chunkSectionsPayload(world, '12850', index).sections.length, 4);
  world.cacheWalking.surfaceCorrections.invalidRegionIds.push('12850');
  index = buildChunkSectionIndex(catalogue, world);
  assert.ok(chunkSectionsPayload(world, '12850', index).sections.every(row => row.mask === null && row.cacheComponentIds.length === 0));
});

async function isolated(t, { cleanup = true } = {}) {
  const directoryRoot = path.join(root, '.local', 'chunk-section-tests');
  await mkdir(directoryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(directoryRoot, 'fixture-'));
  if (cleanup) t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('optional geometry bundle verifies manifest bytes, pinned source, and LF runtime inputs', async t => {
  const directory = await isolated(t), world = fixtureWorld(), catalogue = fixtureCatalogue(world);
  const bundleDir = path.join(directory, SECTION_BUNDLE_DIRECTORY);
  await mkdir(bundleDir);
  await assert.rejects(loadChunkSectionIndex(directory, root, world), /explicit dataset provider/);
  const absentDataset = { files: [],
    json() { assert.fail('An undeclared geometry bundle must not be read.'); },
    bytes() { assert.fail('An undeclared geometry bundle must not be read.'); },
  };
  assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset: absentDataset })).reason, 'geometry-bundle-missing');
  const fixtureKeys = [...SECTION_INPUTS, `local-game/${SECTION_BUNDLE_DIRECTORY}/manifest.json`,
    `local-game/${SECTION_BUNDLE_DIRECTORY}/sections.v1.json.gz`];
  const dataset = {
    files: fixtureKeys.map(key => ({ path: key })),
    bytes(key) {
      assert.ok(fixtureKeys.includes(key));
      return readFileSync(key.startsWith('local-game/') ? path.join(directory, key.slice('local-game/'.length)) : path.join(root, key));
    },
    json(key) { return JSON.parse(this.bytes(key).toString('utf8')); },
  };
  assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset })).reason, 'geometry-bundle-missing');
  catalogue.provenance = { walkabilitySha256: 'fixture-source', repositoryHashes: Object.fromEntries(await Promise.all(SECTION_INPUTS.map(async file => [file, sha256RepositoryText(await readFile(path.join(root, file)))]))) };
  const install = async () => {
    const bytes = gzipSync(JSON.stringify(catalogue));
    await writeFile(path.join(bundleDir, 'sections.v1.json.gz'), bytes);
    await writeFile(path.join(bundleDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, sha256: sha256(bytes) }));
  };
  await install(); assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset })).components.size, 3);
  catalogue.provenance.walkabilitySha256 = 'different-source'; await install();
  assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset })).reason, 'geometry-bundle-invalid');
  catalogue.provenance.walkabilitySha256 = 'fixture-source'; catalogue.provenance.repositoryHashes[SECTION_INPUTS[0]] = 'stale'; await install();
  assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset })).reason, 'geometry-bundle-invalid');
  await writeFile(path.join(bundleDir, 'sections.v1.json.gz'), 'wrong bytes');
  assert.equal((await loadChunkSectionIndex(directory, root, world, { dataset })).reason, 'geometry-bundle-invalid');
});

test('authenticated chunk geometry endpoint validates base IDs and leaves isolated gameplay unchanged', async t => {
  const directory = await isolated(t, { cleanup: false }), world = fixtureWorld();
  const app = await createServer({ port: 0, dataDir: path.join(directory, 'state'), gameDataDir: path.join(directory, 'game-data'), world,
    chunkSectionCatalogue: fixtureCatalogue(world), definitions: { chunks: { '12850': {}, '12851': {} }, walkableChunks: [], walkableChunksF2P: [] }, taskMap: {},
    initialState: createGroupState([{ id: 'a', name: 'Fixture A' }, { id: 'b', name: 'Fixture B' }]) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); }); await app.listen();
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { authorization: `Bearer ${app.store.getAccessToken()}` };
  const get = url => fetch(`${origin}${url}`, { headers });
  const stateFile = path.join(directory, 'state', 'state.json'), before = await readFile(stateFile);
  assert.equal((await fetch(`${origin}/api/chunk-sections?chunk=12850`)).status, 401);
  const response = await get('/api/chunk-sections?chunk=12850'); assert.equal(response.status, 200);
  assert.equal((await response.json()).sections[0].walkableTileCount, 3);
  for (const suffix of ['', '?chunk=', '?chunk=012850', '?chunk=12850-1', '?chunk=12850&chunk=12851', '?chunk=9007199254740992', '?chunk=..%2Fprivate']) assert.equal((await get(`/api/chunk-sections${suffix}`)).status, 400, suffix);
  assert.equal((await get('/api/chunk-sections?chunk=99999')).status, 404);
  assert.equal((await get('/api/chunk-sections?chunk=12851')).status, 200);
  assert.equal((await fetch(`${origin}/api/chunk-sections?chunk=12850`, { method: 'POST', headers })).status, 405);
  assert.deepEqual(await readFile(stateFile), before);
});

test('mask conversion rejects inconsistent source format and count rather than drawing approximations', () => {
  const world = fixtureWorld(), catalogue = fixtureCatalogue(world);
  catalogue.components[0].data = Buffer.alloc(512).toString('base64');
  assert.throws(() => buildChunkSectionIndex(catalogue, world), /Invalid component mask/);
  assert.throws(() => compactChunkSections({ regions: [{ id: '12850', status: 'decoded', masks: { order: 'guessed' } }] }, world), /Unsupported mask format/);
});
