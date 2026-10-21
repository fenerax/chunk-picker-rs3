import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
  };
  for (const [kind, [id, files]] of Object.entries(packs)) {
    const directory = path.join(tree, id, '1.0.0'), records = [];
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), text);
      records.push({ path: name, sha256: sha(Buffer.from(text)), bytes: Buffer.byteLength(text) });
    }
    const manifest = Buffer.from(JSON.stringify({ id, version: '1.0.0', files: records }));
    await writeFile(path.join(directory, 'pack.json'), manifest);
    selection[kind] = { id, version: '1.0.0', sha256: sha(manifest) };
  }
  await writeFile(path.join(tree, 'selection.json'), JSON.stringify(selection));
  return { checkout, tree };
}

test('the committed pack pin is empty, so CI runs without packs', () => {
  assert.equal(readPin(repository), null);
});

test('pack files land where the app looks, and tracked files always win', async t => {
  const { checkout, tree } = await fixture(t);
  assert.equal(placedPath('data', 'local-game/a.json'), '.local/game-data/a.json');
  assert.equal(placedPath('data', 'local-map/a.json'), '.local/map-assets/a.json');
  assert.equal(placedPath('data', 'indexes/values.json'), null);
  assert.equal(placedPath('art', 'world-images/world.png'), 'reference/original-picker/world.png');
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 6, present: 1 });
  assert.equal(await readFile(path.join(checkout, '.local/game-data/sections.json'), 'utf8'), 'game\n');
  assert.equal(await readFile(path.join(checkout, '.local/map-assets/pins.json'), 'utf8'), 'pins\n');
  assert.equal(await readFile(path.join(checkout, '.local/map-assets/tiles/a.png'), 'utf8'), 'tile\n');
  assert.equal(await readFile(path.join(checkout, 'reference/original-picker/world.png'), 'utf8'), 'png\n');
  assert.equal(await readFile(path.join(checkout, 'app/web/task-item-artwork.v1/x.png'), 'utf8'), 'art\n');
  assert.equal(await readFile(path.join(checkout, 'resources/icon.png'), 'utf8'), 'icon\n');
  assert.equal(await readFile(path.join(checkout, 'app/data/tracked.json'), 'utf8'), 'tracked\n');
  // A second run finds everything in place and writes nothing.
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 0, present: 7 });
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
