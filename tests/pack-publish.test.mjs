import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { addFingerprints } from '../scripts/secret-scan/fingerprints.mjs';
import { readPin, placePacks } from '../.github/packs/fetch-packs.mjs';
import { publishAssets } from '../scripts/packs/publish-assets.mjs';

// All inputs, outputs and fingerprint corpora are synthetic and temporary.
// No approved apply call, release download, live save or installed pack is used.
const repository = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sentinel = 'Invented-Publisher-Private-Sentinel';
const token = 'ghp_' + 'a'.repeat(24);
const contract = 'a'.repeat(64);
const specs = [
  ['dataPack', 'duo-data', 'data', '1.0.6-public.1', 'local-game/items.json', '{"items":[]}\n'],
  ['rulesTextPack', 'duo-rules-text', 'rules-text', '1.0.6', 'app/data/rules.json', '{"rules":[]}\n'],
  ['artPack', 'duo-art', 'art', '1.0.0', 'resources/tile.png', 'synthetic image bytes\n'],
];

async function put(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corpusDir = path.join(root, 'corpus');
  await addFingerprints([sentinel], corpusDir);
  const options = { tag: 'synthetic-packs-1', corpusDir, outputDir: path.join(root, 'output'), pinOut: path.join(root, 'pin.json'), apply: false };
  for (const [key, id, kind, version, name, text] of specs) {
    const directory = path.join(root, 'inputs', id);
    options[key] = directory;
    const bytes = Buffer.from(text);
    await put(path.join(directory, name), bytes);
    await put(path.join(directory, 'pack.json'), JSON.stringify({ schemaVersion: 1, id, kind, version,
      ...(kind === 'art' ? {} : { ruleContractHash: contract }),
      files: [{ path: name, bytes: bytes.length, sha256: sha(bytes) }] }, null, 2) + '\n');
  }
  return { root, options };
}

async function replaceFile(options, key, text, name) {
  const directory = options[key], manifestFile = path.join(directory, 'pack.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const bytes = Buffer.from(text);
  if (name && name !== manifest.files[0].path) {
    await rm(path.join(directory, manifest.files[0].path));
    manifest.files[0].path = name;
  }
  await put(path.join(directory, manifest.files[0].path), bytes);
  Object.assign(manifest.files[0], { bytes: bytes.length, sha256: sha(bytes) });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

async function absent(file) {
  await assert.rejects(readFile(file), { code: 'ENOENT' });
}

async function noOutput(options) {
  await absent(options.pinOut);
  const names = await readdir(options.outputDir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  assert.deepEqual(names, []);
}

async function refused(options, category, hidden = []) {
  const logs = [];
  await assert.rejects(publishAssets(options, { log: (...args) => logs.push(args.join(' ')) }), error => {
    if (category) assert.equal(error.category, category);
    for (const value of hidden) assert.equal(String(error.stack).includes(value), false, 'error must redact matched values');
    return true;
  });
  for (const value of hidden) assert.equal(logs.join('\n').includes(value), false, 'logs must redact matched values');
}

test('directory publishing produces deterministic asset bytes and a CI-compatible pin', async t => {
  const { root, options } = await fixture(t);
  const first = await publishAssets(options, { log() {} });
  assert.equal(first.pin.schema, 'rs3-ci-pack-pin-v1');
  assert.equal(first.pin.tag, options.tag);
  assert.equal(first.assets.length, 3);
  const pinFile = JSON.parse(await readFile(options.pinOut, 'utf8'));
  assert.deepEqual(pinFile, first.pin);
  const checkout = path.join(root, 'checkout'), tree = path.join(root, 'tree');
  await put(path.join(checkout, '.github/packs/pack-pin.json'), JSON.stringify(first.pin));
  assert.deepEqual(readPin(checkout), first.pin);
  await mkdir(tree, { recursive: true });
  for (const asset of first.assets) {
    const file = path.join(options.outputDir, asset.name), bytes = await readFile(file);
    assert.equal(bytes.length, asset.bytes);
    assert.equal(sha(bytes), asset.sha256);
    execFileSync('tar', ['-xzf', `output/${asset.name}`, '-C', 'tree'], { cwd: root, stdio: 'pipe' });
  }
  await put(path.join(tree, 'selection.json'), JSON.stringify({ schemaVersion: 1, ...first.pin.selection }));
  assert.deepEqual(placePacks({ checkout, tree }), { placed: 3, present: 0 });
  assert.equal(await readFile(path.join(checkout, '.local/game-data/items.json'), 'utf8'), specs[0][5]);
  assert.equal(await readFile(path.join(checkout, 'app/data/rules.json'), 'utf8'), specs[1][5]);
  assert.equal(await readFile(path.join(checkout, 'resources/tile.png'), 'utf8'), specs[2][5]);
  const secondOptions = { ...options, outputDir: path.join(root, 'output-again'), pinOut: path.join(root, 'pin-again.json') };
  const second = await publishAssets(secondOptions, { log() {} });
  assert.deepEqual(second.pin, first.pin);
  for (const asset of first.assets) assert.deepEqual(await readFile(path.join(secondOptions.outputDir, asset.name)), await readFile(path.join(options.outputDir, asset.name)));
});

test('previously generated tar.gz packs are accepted and preserve the CI selection', async t => {
  const { root, options } = await fixture(t);
  const first = await publishAssets(options, { log() {} });
  const archived = { ...options, outputDir: path.join(root, 'from-archives'), pinOut: path.join(root, 'archive-pin.json') };
  for (const [key, id] of specs) {
    const asset = first.assets.find(row => row.name.startsWith(id + '-'));
    assert.ok(asset, `asset for ${id}`);
    archived[key] = path.join(options.outputDir, asset.name);
  }
  const result = await publishAssets(archived, { log() {} });
  assert.deepEqual(result.pin.selection, first.pin.selection);
  assert.deepEqual(result.pin.assets, first.pin.assets);
});

for (const [key, , , , name] of specs) {
  test(`a credential in ${key} refuses before any output, including the last art input`, async t => {
    const { options } = await fixture(t);
    await replaceFile(options, key, `${name}\n${token}\n`);
    await refused(options, 'secret-scan', [token]);
    await noOutput(options);
  });
}

test('the supplied private fingerprint corpus blocks a value without exposing it', async t => {
  const { options } = await fixture(t);
  await replaceFile(options, 'artPack', sentinel);
  await refused(options, 'secret-scan', [sentinel]);
  await noOutput(options);
});

test('a gzip payload is expanded and scanned before output', async t => {
  for (const value of [token, sentinel]) {
    await t.test(value === token ? 'credential' : 'private fingerprint', async t => {
      const { options } = await fixture(t);
      const compressed = gzipSync(Buffer.from(JSON.stringify({ note: value })));
      // A direct scan of the compressed bytes cannot see either plaintext.
      assert.equal(compressed.includes(Buffer.from(value)), false);
      await replaceFile(options, 'dataPack', compressed, 'local-game/items.json.gz');
      await refused(options, 'secret-scan', [value]);
      await noOutput(options);
    });
  }
});

test('credentials and private fingerprints spanning a 64 KiB read boundary are blocked', async t => {
  for (const value of [token, sentinel]) {
    await t.test(value === token ? 'credential' : 'private fingerprint', async t => {
      const { options } = await fixture(t);
      const start = 65536 - Math.floor(Buffer.byteLength(value) / 2);
      const payload = Buffer.concat([Buffer.alloc(start, 32), Buffer.from(value), Buffer.from('\n')]);
      assert.ok(start < 65536 && start + Buffer.byteLength(value) > 65536);
      await replaceFile(options, 'dataPack', payload);
      await refused(options, 'secret-scan', [value]);
      await noOutput(options);
    });
  }
});

test('a private Unicode fingerprint with a UTF-8 character split at 64 KiB is blocked', async t => {
  const { options } = await fixture(t);
  const value = 'Érable-Ångström-😀-Private-Value';
  await addFingerprints([value], options.corpusDir);
  // The first byte of É ends the first filesystem chunk; its second byte
  // starts the next. String decoding must retain that incomplete character.
  const prefix = Buffer.alloc(65535, 32);
  const encoded = Buffer.from(value);
  assert.equal(encoded[0], 0xc3);
  assert.equal(encoded[1], 0x89);
  await replaceFile(options, 'rulesTextPack', Buffer.concat([prefix, encoded, Buffer.from('\n')]));
  await refused(options, 'secret-scan', [value]);
  await noOutput(options);
});

test('a retained UTF-8 overlap cannot hide a later Unicode fingerprint', async t => {
  const { options } = await fixture(t);
  const value = 'Érable-Ångström-Private-Value';
  await addFingerprints([value], options.corpusDir);
  const prefix = Buffer.concat([Buffer.alloc(65535, 32), Buffer.from('É')]);
  const start = 131072 - 8;
  const payload = Buffer.concat([prefix, Buffer.alloc(start - prefix.length, 32), Buffer.from(value), Buffer.alloc(80000, 32)]);
  await replaceFile(options, 'dataPack', payload);
  await refused(options, 'secret-scan', [value]);
  await noOutput(options);
});

test('a nested gzip Unicode comment is scanned as well as its expanded payload', async t => {
  const { options } = await fixture(t), value = 'Érable-Ångström';
  await addFingerprints([value], options.corpusDir);
  const directory = options.dataPack, manifestFile = path.join(directory, 'pack.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const compressed = gzipSync(Buffer.from('{"items":[]}\n'));
  const header = Buffer.from(compressed.subarray(0, 10)); header[3] |= 16;
  const bytes = Buffer.concat([header, Buffer.from(value + '\0'), compressed.subarray(10)]);
  const name = 'local-game/commented.json.gz';
  await put(path.join(directory, name), bytes);
  manifest.files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
  await writeFile(manifestFile, JSON.stringify(manifest));
  await refused(options, 'secret-scan', [value]);
  await noOutput(options);
});

test('Unicode corpus values in gzip comments and USTAR owner metadata block archives', async t => {
  for (const metadata of ['gzip comment', 'tar owner']) {
    await t.test(metadata, async t => {
      const { root, options } = await fixture(t), value = 'Érable-Ångström';
      await addFingerprints([value], options.corpusDir);
      const first = await publishAssets(options, { log() {} });
      const next = { ...options, outputDir: path.join(root, 'archive-output'), pinOut: path.join(root, 'archive-pin.json') };
      for (const [key, id] of specs) next[key] = path.join(options.outputDir, first.assets.find(asset => asset.name.startsWith(id + '-')).name);
      const original = await readFile(next.artPack);
      if (metadata === 'gzip comment') {
        const header = Buffer.from(original.subarray(0, 10)); header[3] |= 16;
        await writeFile(next.artPack, Buffer.concat([header, Buffer.from(value + '\0'), original.subarray(10)]));
      } else {
        const tar = gunzipSync(original); tar.fill(0, 265, 297); tar.write(value, 265, 32);
        tar.fill(32, 148, 156);
        const checksum = tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
        tar.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
        await writeFile(next.artPack, gzipSync(tar));
      }
      await refused(next, 'secret-scan', [value]);
      await noOutput(next);
    });
  }
});

test('the optional save is scanned before any pack or pin is emitted', async t => {
  const { root, options } = await fixture(t);
  options.saveCopy = path.join(root, 'save.json');
  await put(options.saveCopy, JSON.stringify({ note: sentinel }));
  await refused(options, 'secret-scan', [sentinel]);
  await noOutput(options);
});

test('a clean optional save is emitted separately and excluded from the CI pin', async t => {
  const { root, options } = await fixture(t);
  options.saveCopy = path.join(root, 'save.json');
  await put(options.saveCopy, '{"progress":[]}\n');
  const result = await publishAssets(options, { log() {} });
  assert.equal(result.pin.assets.length, 3);
  assert.deepEqual(Object.keys(result.pin.selection).sort(), ['art', 'data', 'rulesText']);
  const names = await readdir(options.outputDir);
  assert.equal(names.filter(name => !result.pin.assets.some(asset => asset.name === name)).length, 1);
});

test('changed file bytes and unexpected files are refused before output', async t => {
  for (const mode of ['changed', 'unexpected']) {
    await t.test(mode, async t => {
      const { options } = await fixture(t);
      await put(path.join(options.dataPack, mode === 'changed' ? specs[0][4] : 'extra.txt'), 'synthetic extra bytes\n');
      await refused(options);
      await noOutput(options);
    });
  }
});

test('mismatched rule contracts refuse before output', async t => {
  const { options } = await fixture(t);
  const file = path.join(options.rulesTextPack, 'pack.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.ruleContractHash = 'b'.repeat(64);
  await writeFile(file, JSON.stringify(manifest));
  await refused(options);
  await noOutput(options);
});

test('apply with a mismatched approval tag refuses without invoking release publication', async t => {
  const { options } = await fixture(t);
  // A process environment is deliberately never given the matching approval.
  options.tag = process.env.RS3_PUBLISH_APPROVED === 'synthetic-unapproved-1' ? 'synthetic-unapproved-2' : 'synthetic-unapproved-1';
  options.apply = true;
  await refused(options, 'approval-required');
  await noOutput(options);
});

test('existing output files and pin files are preserved', async t => {
  for (const target of ['output', 'pin']) {
    await t.test(target, async t => {
      const { options } = await fixture(t);
      const file = target === 'pin' ? options.pinOut : path.join(options.outputDir, 'keep.txt');
      await put(file, 'existing synthetic content\n');
      await refused(options);
      assert.equal(await readFile(file, 'utf8'), 'existing synthetic content\n');
    });
  }
});

test('the checked-in CI pin cannot be selected as pin output', async t => {
  const { options } = await fixture(t);
  options.pinOut = path.join(repository, '.github/packs/pack-pin.json');
  const before = await readFile(options.pinOut);
  await refused(options);
  assert.deepEqual(await readFile(options.pinOut), before);
  assert.deepEqual(await readdir(options.outputDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});
