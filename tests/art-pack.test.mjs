import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildArtPack, selectArtPack } from '../scripts/build-art-pack.mjs';
import { loadArtPack, packRelative, safeArtFile, validateInertSvg, PACK_LIMITS } from '../app/packs.mjs';
import { ART_BINDINGS, artBinding } from '../app/art-bindings.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('safe files reject linked ancestors above the supplied root and wrong path types', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picker-safe-path-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'ordinary'), root = path.join(parent, 'nested');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'input.json'), '{}');
  assert.equal(await safeArtFile(root, 'input.json'), path.join(root, 'input.json'));
  assert.equal(await safeArtFile(root), root);
  await assert.rejects(safeArtFile(parent, 'nested'));
  await assert.rejects(safeArtFile(root, 'input.json/child'));
  const alias = path.join(directory, 'alias');
  await symlink(parent, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safeArtFile(path.join(alias, 'nested'), 'input.json'));
});
const bindings = new Map([
  ['/assets/Attack_skill.png', { component: 'legacyResources', relative: 'Attack_skill.png' }],
  ['/assets/SVG/rs3/attack-rs3.svg', { component: 'legacyResources', relative: 'SVG/rs3/attack-rs3.svg' }],
  ['/task-item-artwork.2026-10-09.v1/synthetic.png', { component: 'taskArtwork', relative: 'synthetic.png' }],
  ['/assets/world.png', { component: 'worldImages', relative: 'runescape_world_map.png' }],
  ['/assets/background.png', { component: 'worldImages', relative: 'Background-chunk.PNG' }],
]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path fill="#777" d="M0 0L12 12"/></svg>\r\n');
async function fixture(t, extra = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'picker-art-pack-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const sourceRoot = path.join(temp, 'source'), packsDir = path.join(temp, 'packs');
  for (const [component, relative] of [...bindings.values()].map(value => [value.component, value.relative])) {
    const root = component === 'legacyResources' ? 'resources' : component === 'worldImages' ? 'reference/original-picker' : 'app/web/task-item-artwork.2026-10-09.v1';
    const filename = path.join(sourceRoot, root, relative); await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, relative.endsWith('.svg') ? svg : png);
  }
  const absentAssets = path.join(temp, 'not-installed');
  return { temp, sourceRoot, packsDir, bindings, mapAssetsDir: absentAssets, terrainAssetsDir: absentAssets, iconAssetsDir: absentAssets, ...extra };
}
async function rewriteManifest(built, mutate) {
  const manifest = JSON.parse(await readFile(path.join(built.directory, 'pack.json')));
  mutate(manifest); const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(built.directory, 'pack.json'), bytes);
  await writeFile(path.join(path.dirname(path.dirname(built.directory)), 'selection.json'), JSON.stringify({ schemaVersion: 1, art: { id: 'duo-art', version: manifest.version, sha256: hash(bytes) } }));
}

test('builder copies bytes, pins selection, and preserves all compatibility surface roles', async t => {
  const options = await fixture(t), built = await buildArtPack(options);
  const provider = await loadArtPack(options);
  assert.deepEqual(provider.status().components, ['legacyResources', 'taskArtwork', 'worldImages']);
  assert.equal(provider.status().health, 'healthy');
  assert.equal(provider.status().digest, built.selection.art.sha256);
  assert.equal(JSON.stringify(provider.status()).includes(options.temp), false);
  for (const [route, binding] of bindings) {
    assert.deepEqual(provider.bindings.get(route), binding);
    const filename = await provider.file(binding.component, binding.relative);
    assert.deepEqual(await readFile(filename), binding.relative.endsWith('.svg') ? svg : png);
    assert.deepEqual(provider.expected(filename), { bytes: (binding.relative.endsWith('.svg') ? svg : png).length, sha256: hash(binding.relative.endsWith('.svg') ? svg : png) });
  }
  assert.equal(await provider.file('legacyResources', 'not-listed.png'), null);
  assert(provider.files('legacyResources').includes('SVG/rs3/attack-rs3.svg'));
  assert.equal(provider.expected(path.join(options.temp, 'outside.png')), null);
  await assert.rejects(buildArtPack(options), { code: 'EEXIST' });
  assert.equal(ART_BINDINGS.size, 111);
  assert.equal(artBinding('/assets/attack_skill.PNG')?.relative ?? null, process.platform === 'win32' ? 'Attack_skill.png' : null);
  assert(ART_BINDINGS.has('/assets/fontawesome/fa-solid-900.woff2'));
});

test('atomic selection retains exact prior receipt and deliberate rollback works', async t => {
  const options = await fixture(t), first = await buildArtPack(options);
  const firstBytes = await readFile(path.join(options.packsDir, 'selection.json'));
  const second = await buildArtPack({ ...options, version: '1.0.1' });
  assert.deepEqual(await readFile(path.join(options.packsDir, 'selection.json.previous')), firstBytes);
  assert.equal((await loadArtPack(options)).status().version, '1.0.1');
  await selectArtPack({ ...options, selection: first.selection });
  assert.equal((await loadArtPack(options)).status().version, '1.0.0');
  assert.equal(JSON.parse(await readFile(path.join(options.packsDir, 'selection.json.previous'))).art.sha256, second.selection.art.sha256);
});

test('builder refuses pack/selection outputs inside any source art root before writing', async t => {
  const options = await fixture(t);
  const sourceArt = path.join(options.sourceRoot, 'resources');
  const before = await readFile(path.join(sourceArt, 'Attack_skill.png'));
  await assert.rejects(buildArtPack({ ...options, packsDir: path.join(sourceArt, 'generated') }), /outside source art/);
  await assert.rejects(buildArtPack({ ...options, selectionPath: path.join(sourceArt, 'selection.json') }), /outside source art/);
  assert.deepEqual(await readFile(path.join(sourceArt, 'Attack_skill.png')), before);
  await assert.rejects(readFile(path.join(sourceArt, 'generated/duo-art/1.0.0/pack.json')), { code: 'ENOENT' });
  const alias = path.join(options.temp, 'art-alias');
  await symlink(sourceArt, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildArtPack({ ...options, packsDir: path.join(alias, 'generated') }), /Invalid art pack/);
  await assert.rejects(readFile(path.join(sourceArt, 'generated/duo-art/1.0.0/pack.json')), { code: 'ENOENT' });
  await assert.rejects(buildArtPack({ ...options, selectionPath: path.join(alias, 'selection.json') }), /Invalid art pack/);
  await assert.rejects(readFile(path.join(sourceArt, 'selection.json')), { code: 'ENOENT' });
  const linkedNested = path.join(options.temp, 'linked-nested'); await mkdir(linkedNested);
  await writeFile(path.join(linkedNested, 'nested.png'), png);
  const sourceAlias = path.join(sourceArt, 'nested');
  await symlink(linkedNested, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildArtPack({ ...options, bindings: new Map([['/assets/nested.png', { component: 'legacyResources', relative: 'nested/nested.png' }]]) }), /Invalid art pack/);
});

test('missing, hash-mismatched, and incompatible selections do not discover another version', async t => {
  const options = await fixture(t);
  assert.equal((await loadArtPack(options)).status().health, 'absent');
  const built = await buildArtPack(options);
  await writeFile(path.join(options.packsDir, 'selection.json'), JSON.stringify({ schemaVersion: 1, art: { ...built.selection.art, sha256: '0'.repeat(64) } }));
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
  await rewriteManifest(built, manifest => manifest.requires.datasetId = 'other');
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
  await writeFile(path.join(options.packsDir, 'selection.json'), JSON.stringify({ schemaVersion: 1, art: { ...built.selection.art, version: '9.0.0' } }));
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
});

test('missing/corrupt payload falls back per file and reopens detect post-verification changes', async t => {
  const options = await fixture(t), built = await buildArtPack(options);
  await rm(path.join(built.directory, 'world-images/Background-chunk.PNG'));
  const provider = await loadArtPack(options);
  assert.equal(await provider.file('worldImages', 'Background-chunk.PNG'), null);
  assert.equal(provider.status().health, 'partial');
  assert(await provider.file('legacyResources', 'Attack_skill.png'));
  await writeFile(path.join(built.directory, 'world-images/runescape_world_map.png'), Buffer.alloc(png.length));
  assert.equal(await provider.file('worldImages', 'runescape_world_map.png'), null);
  const filename = await provider.file('legacyResources', 'Attack_skill.png');
  await writeFile(filename, Buffer.alloc(png.length));
  assert.equal(await provider.file('legacyResources', 'Attack_skill.png'), null);
  await rm(path.join(built.directory, 'world-images'), { recursive: true, force: true });
  const missingComponent = await loadArtPack(options);
  assert.equal(missingComponent.status().health, 'partial');
  assert(await missingComponent.file('taskArtwork', 'synthetic.png'));
});

test('small JSON/catalogue corruption fails activation and duplicate routes are ambiguous', async t => {
  const options = await fixture(t), built = await buildArtPack(options);
  const filename = path.join(built.directory, 'indexes/art-bindings.json');
  await writeFile(filename, '{}');
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
  const catalogue = { schemaVersion: 1, bindings: [...bindings].map(([route, value]) => ({ route, ...value })) };
  catalogue.bindings.push(catalogue.bindings[0]);
  const bytes = Buffer.from(JSON.stringify(catalogue)); await writeFile(filename, bytes);
  await rewriteManifest(built, manifest => Object.assign(manifest.files.find(file => file.path === 'indexes/art-bindings.json'), { bytes: bytes.length, sha256: hash(bytes) }));
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
});

test('path traversal, drives, UNC, alternate streams, encoded paths and links are refused', async t => {
  for (const relative of ['../outside.png', '/outside.png', 'C:/outside.png', '\\\\server\\share\\image.png', 'a\\b.png', 'a//b.png', 'a/./b.png', 'a.png:stream', '%2e%2e/a.png', 'CON.png', 'a./b.png']) assert.throws(() => packRelative(relative));
  const options = await fixture(t), built = await buildArtPack(options);
  const target = path.join(built.directory, 'resources/Attack_skill.png');
  const provider = await loadArtPack(options);
  assert.equal(await provider.file('legacyResources', '../world-images/runescape_world_map.png'), null);
  const outside = path.join(options.temp, 'outside.png'); await writeFile(outside, png); await rm(target);
  try { await symlink(outside, target, 'file'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('File symlinks require Windows privilege; directory junction case still tested.'); } else throw error; }
  assert.equal(await provider.file('legacyResources', 'Attack_skill.png'), null);
  const resources = path.join(built.directory, 'resources'); await rm(resources, { recursive: true, force: true });
  const outsideDirectory = path.join(options.temp, 'outside'); await mkdir(outsideDirectory); await writeFile(path.join(outsideDirectory, 'Attack_skill.png'), png);
  await symlink(outsideDirectory, resources, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
});

test('type, dimensions, limits and active SVG are rejected even when hashes match', async t => {
  for (const text of ['<svg width="1" height="1"><script>bad()</script></svg>', '<svg width="1" height="1"><image href="https://example.org/x"/></svg>', '<svg width="1" height="1" onload="bad()"/>', '<svg width="1" height="1"><path style="fill:url(x)"/></svg>', '<!DOCTYPE svg><svg width="1" height="1"/>', '<svg width="1" height="1"><foreignObject/></svg>', '<svg width="1" height="1"><path fill="url(x)"/></svg>']) assert.throws(() => validateInertSvg(Buffer.from(text), hash(text)));
  const options = await fixture(t), built = await buildArtPack(options);
  const bytes = Buffer.from(png); bytes.writeUInt32BE(PACK_LIMITS.dimension + 1, 16);
  await writeFile(path.join(built.directory, 'resources/Attack_skill.png'), bytes);
  await rewriteManifest(built, manifest => Object.assign(manifest.files.find(file => file.path === 'resources/Attack_skill.png'), { sha256: hash(bytes) }));
  const provider = await loadArtPack(options);
  assert.equal(await provider.file('legacyResources', 'Attack_skill.png'), null);
  assert.equal(provider.status().health, 'partial');
  await rewriteManifest(built, manifest => manifest.files[0].bytes = PACK_LIMITS.fileBytes + 1);
  assert.equal((await loadArtPack(options)).status().health, 'invalid');
});

test('optional trees reuse nested hashes, omit raw captures, and share inherited roots', async t => {
  const options = await fixture(t), root = path.join(options.sourceRoot, '.local/map-assets');
  Object.assign(options, { mapAssetsDir: root, terrainAssetsDir: root, iconAssetsDir: root });
  await mkdir(path.join(root, 'terrain/28/2'), { recursive: true });
  await mkdir(path.join(root, 'raw')); await writeFile(path.join(root, 'raw/private.json'), '{"unreachable":true}');
  await writeFile(path.join(root, 'terrain/28/2/0_1_2.png'), png);
  const record = { path: 'terrain/28/2/0_1_2.png', bytes: png.length, sha256: hash(png), status: 'downloaded' };
  const manifestBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, terrain: { tiles: [record] }, raw: [{ path: 'raw/private.json' }] })}\r\n`);
  await writeFile(path.join(root, 'manifest.json'), manifestBytes);
  await writeFile(path.join(root, 'pins.normalized.json'), '{"pins":[]}\r\n');
  const built = await buildArtPack(options), provider = await loadArtPack(options);
  assert.equal(provider.root('mapAssets'), provider.root('terrainAssets'));
  assert.equal(provider.root('mapAssets'), provider.root('iconAssets'));
  assert.deepEqual(await readFile(await provider.file('mapAssets', 'manifest.json')), manifestBytes);
  assert.deepEqual(await readFile(await provider.file('mapAssets', record.path)), png);
  assert.equal(await provider.file('mapAssets', 'raw/private.json'), null);
  assert.equal(built.manifest.files.filter(file => file.path.endsWith(record.path)).length, 1);
  assert.equal(built.manifest.files.find(file => file.path.endsWith(record.path)).sha256, record.sha256);
  await writeFile(path.join(provider.root('mapAssets'), 'manifest.json'), '{}');
  const corruptNested = await loadArtPack(options);
  assert.equal(corruptNested.status().health, 'partial');
  assert.equal(await corruptNested.file('mapAssets', 'manifest.json'), null);
  assert(await corruptNested.file('legacyResources', 'Attack_skill.png'));
  await rm(path.join(provider.root('mapAssets'), 'pins.normalized.json'));
  const missingNested = await loadArtPack(options);
  assert.equal(missingNested.status().health, 'partial');
  assert(await missingNested.file('taskArtwork', 'synthetic.png'));
  const interiorDirectory = 'interiors.cache-synthetic-reviewed', diagnosticPath = `${interiorDirectory}/manifest.json`;
  await mkdir(path.join(root, interiorDirectory, '1/2'), { recursive: true });
  const diagnostic = await open(path.join(root, diagnosticPath), 'w+');
  const diagnosticBytes = PACK_LIMITS.jsonBytes + 1, digest = createHash('sha256');
  try {
    await diagnostic.truncate(diagnosticBytes);
    for await (const bytes of diagnostic.createReadStream({ autoClose: false })) digest.update(bytes);
  } finally { await diagnostic.close(); }
  const diagnosticSha256 = digest.digest('hex');
  const interiorTile = { ...record, path: `${interiorDirectory}/1/2/0_1_2.png`, status: 'rendered' };
  await writeFile(path.join(root, interiorTile.path), png);
  const descriptor = { assets: { manifestPath: diagnosticPath, manifestSha256: diagnosticSha256 }, maps: [{ tiles: [interiorTile] }] };
  await mkdir(path.join(options.sourceRoot, 'app/data'), { recursive: true });
  await writeFile(path.join(options.sourceRoot, 'app/data/cache-interiors.2026-10-08.v2.json'), JSON.stringify(descriptor));
  const opaqueBuilt = await buildArtPack({ ...options, version: '1.0.1' }), opaqueProvider = await loadArtPack(options);
  const diagnosticRecord = opaqueBuilt.manifest.files.find(file => file.path.endsWith(diagnosticPath));
  assert.equal(diagnosticRecord.role, 'opaque-manifest');
  assert.equal(diagnosticRecord.bytes, diagnosticBytes);
  assert.equal(diagnosticRecord.sha256, diagnosticSha256);
  assert(await opaqueProvider.file('mapAssets', diagnosticPath)); // Zeros are not parseable JSON.
  assert(await opaqueProvider.file('mapAssets', interiorTile.path));
  assert.equal(opaqueProvider.status().health, 'healthy');
  const priorSelection = await readFile(path.join(options.packsDir, 'selection.json'));
  const changed = await open(path.join(root, diagnosticPath), 'r+');
  try { await changed.write(Buffer.from('x'), 0, 1, 0); } finally { await changed.close(); }
  await assert.rejects(buildArtPack({ ...options, version: '1.0.2' }), /Interior manifest does not match its descriptor/);
  assert.deepEqual(await readFile(path.join(options.packsDir, 'selection.json')), priorSelection);
});
