import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, rename, symlink } from 'node:fs/promises';
import { readPin, placedPath, placePacks } from '../.github/packs/fetch-packs.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const repository = fileURLToPath(new URL('..', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-packs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), tree = path.join(root, 'tree');
  await mkdir(path.join(checkout, 'app/data'), { recursive: true });
  await writeFile(path.join(checkout, 'app/data/tracked.json'), 'tracked\n');
  const selection = { schemaVersion: 1 };
  const packs = {
    data: ['duo-data', { 'local-game/sections.json': 'game\n', 'local-map/pins.json': 'pins\n', 'indexes/values.json': 'index\n', 'provenance.json': '{}\n', 'app/data/tracked.json': 'pack copy\n' }],
    art: ['duo-art', { 'world-images/world.png': 'png\n', 'map-assets/tiles/a.png': 'tile\n', 'task-item-artwork.v1/x.png': 'art\n', 'resources/icon.png': 'icon\n', 'notes.txt': 'skip\n' }],
    cacheInputs: ['cache-inputs', { 'local-game/sections.json': 'cache sections\n', 'local-game/cache-only.json': 'cache only\n' }],
  };
  for (const [kind, [id, files]] of Object.entries(packs)) {
    const version = kind === 'cacheInputs' ? '2026-10-21-v1' : '1.0.0';
    const directory = path.join(tree, id, version), records = [];
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), text);
      records.push({ path: name, sha256: sha(Buffer.from(text)), bytes: Buffer.byteLength(text) });
    }
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, id, version, files: records }));
    await writeFile(path.join(directory, 'pack.json'), manifest);
    selection[kind] = { id, version, sha256: sha(manifest) };
  }
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(selection));
  return { checkout, tree };
}

test('the committed pack pin names the approved public release and all four packs', () => {
  const pin = readPin(repository);
  assert.equal(pin.tag, 'packs-public-2026-10-21');
  assert.deepEqual(pin.assets.map(asset => asset.name),
    ['duo-data-1.0.6-public.3.tar.gz', 'duo-rules-text-1.0.6.tar.gz', 'duo-art-1.0.0-public.1.tar.gz', 'cache-inputs-1.0.0-public.1.tar.gz']);
  assert.deepEqual(Object.keys(pin.selection), ['data', 'rulesText', 'art', 'cacheInputs']);
  assert.equal(pin.selection.cacheInputs.id, 'cache-inputs');
  assert.equal(pin.selection.cacheInputs.version, '1.0.0-public.1');
  assert.match(pin.selection.cacheInputs.sha256, /^[a-f0-9]{64}$/);
});

test('pack files land where the app looks, and tracked files always win', async t => {
  const { checkout, tree } = await fixture(t);
  assert.equal(placedPath('data', 'local-game/a.json'), '.local/game-data/a.json');
  assert.equal(placedPath('data', 'local-map/a.json'), '.local/map-assets/a.json');
  assert.equal(placedPath('data', 'indexes/values.json'), null);
  assert.equal(placedPath('art', 'world-images/world.png'), 'reference/original-picker/world.png');
  assert.equal(placedPath('cacheInputs', 'local-game/sections.json'), null);
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 6, present: 1 });
  assert.equal(await readFile(path.join(checkout, '.local/game-data/sections.json'), 'utf8'), 'game\n');
  assert.equal(await readFile(path.join(checkout, '.local/map-assets/pins.json'), 'utf8'), 'pins\n');
  assert.equal(await readFile(path.join(checkout, '.local/map-assets/tiles/a.png'), 'utf8'), 'tile\n');
  assert.equal(await readFile(path.join(checkout, 'reference/original-picker/world.png'), 'utf8'), 'png\n');
  assert.equal(await readFile(path.join(checkout, 'app/web/task-item-artwork.v1/x.png'), 'utf8'), 'art\n');
  assert.equal(await readFile(path.join(checkout, 'resources/icon.png'), 'utf8'), 'icon\n');
  assert.equal(await readFile(path.join(checkout, 'app/data/tracked.json'), 'utf8'), 'tracked\n');
  assert.equal(await readFile(path.join(tree, 'cache-inputs/2026-10-21-v1/local-game/sections.json'), 'utf8'), 'cache sections\n');
  await assert.rejects(access(path.join(checkout, '.local/game-data/cache-only.json')), { code: 'ENOENT' });
  // A second run finds everything in place and writes nothing.
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 0, present: 7 });
});

test('cache input payloads and manifests verify again on a restored tree without replacing game data', async t => {
  const { checkout, tree } = await fixture(t);
  await mkdir(path.join(checkout, '.local/game-data'), { recursive: true });
  await writeFile(path.join(checkout, '.local/game-data/sections.json'), 'existing game data\n');
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 5, present: 2 });
  assert.equal(await readFile(path.join(checkout, '.local/game-data/sections.json'), 'utf8'), 'existing game data\n');
  const packRoot = path.join(tree, 'cache-inputs/2026-10-21-v1');
  await writeFile(path.join(packRoot, 'local-game/sections.json'), 'tampered\n');
  assert.throws(() => placePacks({ checkout, tree }), /Pack file changed: cache-inputs\/local-game\/sections.json/);
  await writeFile(path.join(packRoot, 'local-game/sections.json'), 'cache sections\n');
  await writeFile(path.join(packRoot, 'pack.json'), '{}');
  assert.throws(() => placePacks({ checkout, tree }), /Pack manifest changed: cache-inputs/);
  assert.equal(await readFile(path.join(checkout, '.local/game-data/sections.json'), 'utf8'), 'existing game data\n');
});

test('cache input verification finishes before any checkout placement', async t => {
  const { checkout, tree } = await fixture(t);
  await writeFile(path.join(tree, 'cache-inputs/2026-10-21-v1/local-game/cache-only.json'), 'changed\n');
  assert.throws(() => placePacks({ checkout, tree }), /Pack file changed: cache-inputs/);
  await assert.rejects(access(path.join(checkout, '.local/game-data/sections.json')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(checkout, 'resources/icon.png')), { code: 'ENOENT' });
});

test('restored selections must match the committed selection including cache inputs', async t => {
  const { checkout, tree } = await fixture(t);
  const { schemaVersion, ...pinnedSelection } = JSON.parse(await readFile(path.join(tree, 'selection.json'), 'utf8'));
  assert.deepEqual(placePacks({ checkout, tree, pinnedSelection }), { placed: 6, present: 1 });
  const restored = { schemaVersion, ...pinnedSelection };
  delete restored.cacheInputs;
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(restored));
  assert.throws(() => placePacks({ checkout, tree, pinnedSelection }), /Pack selection changed from pin/);
  restored.cacheInputs = { ...pinnedSelection.cacheInputs, sha256: '0'.repeat(64) };
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(restored));
  assert.throws(() => placePacks({ checkout, tree, pinnedSelection }), /Pack selection changed from pin/);
});

test('cache input manifests require the selected identity, schema and local-game records', async t => {
  const { checkout, tree } = await fixture(t);
  const manifestPath = path.join(tree, 'cache-inputs/2026-10-21-v1/pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const selection = JSON.parse(await readFile(path.join(tree, 'selection.json'), 'utf8'));
  for (const invalid of [
    { ...manifest, schemaVersion: 2 }, { ...manifest, id: 'other' }, { ...manifest, version: 'other' },
    { ...manifest, files: [] }, { ...manifest, files: null },
    { ...manifest, files: [{ ...manifest.files[0], path: 'app/data/escape.json' }] },
    { ...manifest, files: [{ ...manifest.files[0], bytes: -1 }] },
    { ...manifest, files: [{ ...manifest.files[0], bytes: '15' }] },
    { ...manifest, files: [{ ...manifest.files[0], sha256: 'invalid' }] },
    { ...manifest, files: [{ ...manifest.files[0], path: 'local-game/sections.json:stream' }] },
    { ...manifest, files: [{ ...manifest.files[0], path: 'local-game/sections.json.' }] },
    { ...manifest, files: [{ ...manifest.files[0], path: 'local-game/sections\\file.json' }] },
    { ...manifest, files: [null] },
    { ...manifest, files: [manifest.files[0], manifest.files[0]] },
  ]) {
    const bytes = Buffer.from(JSON.stringify(invalid));
    await writeFile(manifestPath, bytes);
    selection.cacheInputs.sha256 = sha(bytes);
    await writeFile(path.join(tree, 'selection.json'), JSON.stringify(selection));
    assert.throws(() => placePacks({ checkout, tree }), /Cache input pack (?:manifest|file) invalid/);
  }
  await assert.rejects(access(path.join(checkout, '.local/game-data/sections.json')), { code: 'ENOENT' });
});

test('cache input selection refuses aliases and nested versions', async t => {
  const { checkout, tree } = await fixture(t);
  const selectionPath = path.join(tree, 'selection.json');
  const selection = JSON.parse(await readFile(selectionPath, 'utf8'));
  const choice = selection.cacheInputs;
  for (const invalid of [{ ...choice, id: 'duo-data' }, { ...choice, version: 'nested/version' },
    { ...choice, sha256: 'invalid' }]) {
    selection.cacheInputs = invalid;
    await writeFile(selectionPath, JSON.stringify(selection));
    assert.throws(() => placePacks({ checkout, tree }), /Cache input pack selection invalid/);
  }
});

test('restored cache input paths cannot traverse directory links even when bytes match', async t => {
  const { checkout, tree } = await fixture(t);
  const packRoot = path.join(tree, 'cache-inputs/2026-10-21-v1');
  const payload = path.join(packRoot, 'local-game');
  const outside = path.join(path.dirname(tree), 'outside');
  await rename(payload, outside);
  await symlink(outside, payload, 'junction');
  assert.throws(() => placePacks({ checkout, tree }), /Cache input pack tree invalid/);
  await assert.rejects(access(path.join(checkout, '.local/game-data/sections.json')), { code: 'ENOENT' });
});

test('missing cache input files refuse before checkout placement', async t => {
  const { checkout, tree } = await fixture(t);
  await rm(path.join(tree, 'cache-inputs/2026-10-21-v1/local-game/cache-only.json'));
  assert.throws(() => placePacks({ checkout, tree }), { code: 'ENOENT' });
  await assert.rejects(access(path.join(checkout, 'resources/icon.png')), { code: 'ENOENT' });
});

test('cache input hashing covers payloads beyond the verification buffer', async t => {
  const { checkout, tree } = await fixture(t);
  const packRoot = path.join(tree, 'cache-inputs/2026-10-21-v1');
  const manifestPath = path.join(packRoot, 'pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const payload = Buffer.alloc(2 * 1024 * 1024 + 37, 'x');
  const record = manifest.files[1];
  record.bytes = payload.length;
  record.sha256 = sha(payload);
  await writeFile(path.join(packRoot, record.path), payload);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(manifestPath, manifestBytes);
  const selectionPath = path.join(tree, 'selection.json');
  const selection = JSON.parse(await readFile(selectionPath, 'utf8'));
  selection.cacheInputs.sha256 = sha(manifestBytes);
  await writeFile(selectionPath, JSON.stringify(selection));
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 6, present: 1 });
  payload[payload.length - 1] = 'y'.charCodeAt(0);
  await writeFile(path.join(packRoot, record.path), payload);
  assert.throws(() => placePacks({ checkout, tree }), /Pack file changed: cache-inputs/);
});

test('changed pack bytes or manifests refuse before anything is placed', async t => {
  const { checkout, tree } = await fixture(t);
  await writeFile(path.join(tree, 'duo-data/1.0.0/local-game/sections.json'), 'changed\n');
  assert.throws(() => placePacks({ checkout, tree }), /Pack file changed: duo-data\/local-game\/sections\.json/);
  const selection = JSON.parse(await readFile(path.join(tree, 'selection.json'), 'utf8'));
  selection.art.sha256 = '0'.repeat(64);
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(selection));
  assert.throws(() => placePacks({ checkout, tree }), /Pack manifest changed|Pack file changed/);
});

test('pack pins and file paths refuse anything outside their shapes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = pin => mkdir(path.join(root, '.github/packs'), { recursive: true }).then(() => writeFile(path.join(root, '.github/packs/pack-pin.json'), JSON.stringify(pin)));
  const asset = { name: 'duo-data.tar.gz', sha256: 'a'.repeat(64), bytes: 10 };
  await write({ schema: 'rs3-ci-pack-pin-v1', tag: 'packs-1', selection: { data: {} }, assets: [asset] });
  assert.equal(readPin(root).tag, 'packs-1');
  for (const pin of [{ schema: 'other', tag: null, selection: null, assets: [] },
    { schema: 'rs3-ci-pack-pin-v1', tag: '../x', selection: {}, assets: [asset] },
    { schema: 'rs3-ci-pack-pin-v1', tag: 'packs-1', selection: {}, assets: [] },
    { schema: 'rs3-ci-pack-pin-v1', tag: 'packs-1', selection: {}, assets: [{ ...asset, name: 'x.zip' }] }]) {
    await write(pin);
    assert.throws(() => readPin(root), /pin invalid/);
  }
  const { checkout, tree } = await fixture(t);
  const manifestPath = path.join(tree, 'duo-art/1.0.0/pack.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].path = '../escape.png';
  const bytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(manifestPath, bytes);
  const selection = JSON.parse(await readFile(path.join(tree, 'selection.json'), 'utf8'));
  selection.art.sha256 = sha(bytes);
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(selection));
  assert.throws(() => placePacks({ checkout, tree }), /Pack file path invalid/);
});
