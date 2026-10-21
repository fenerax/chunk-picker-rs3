import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildCacheInputsPack, cacheInputFiles, cacheInputsVersion } from '../scripts/ci/build-cache-inputs-pack.mjs';
import { addFingerprints, loadCorpus } from '../scripts/secret-scan/fingerprints.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const manifestName = name => /manifest\.v1\.json$/.test(name);
const decode = (name, bytes) => JSON.parse(name.endsWith('.gz') ? gunzipSync(bytes) : bytes);
const home = [String.fromCharCode(67, 58), 'Users', 'Fixture', 'exports'].join('/');
const sentinel = 'Invented-Cache-Identity-Sentinel';
async function put(file, bytes) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); }
async function snapshot(root) {
  const result = {};
  for (const name of cacheInputFiles) {
    const file = path.join(root, name), metadata = await stat(file);
    result[name] = { sha256: sha(await readFile(file)), mtime: metadata.mtimeMs, ctime: metadata.ctimeMs };
  }
  return result;
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-cache-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gameDataDir = path.join(root, 'source'), original = new Map();
  const corpusDir = path.join(root, 'corpus');
  await addFingerprints([sentinel], corpusDir);
  const corpus = await loadCorpus(corpusDir);
  for (const name of cacheInputFiles.filter(name => !manifestName(name))) {
    const document = { gameplay: { mapId: 28, objectId: 42, levels: [1, 10], mask: 'AQIDBA==' }, archiveSha256: 'a'.repeat(64) };
    if (/skill-guides\.v1|definitions\.v1/.test(name)) document.provenance = { path: `${home}/${path.posix.basename(name)}` };
    const bytes = name.endsWith('.gz') ? gzipSync(encode(document), { level: 1 }) : encode(document);
    original.set(name, bytes); await put(path.join(gameDataDir, name), bytes);
  }
  for (const name of cacheInputFiles.filter(manifestName)) {
    const outputs = [...original].filter(([sibling]) => path.posix.dirname(sibling) === path.posix.dirname(name))
      .map(([sibling, bytes]) => ({ path: `${home}/${path.posix.basename(sibling)}`, bytes: bytes.length, sha256: sha(bytes) }));
    const bytes = encode({ schemaVersion: 1, outputs, archiveSha256: 'a'.repeat(64),
      sourceHash: `sha256:${outputs[0].sha256}`, gameplay: { mapId: 28 } });
    original.set(name, bytes); await put(path.join(gameDataDir, name), bytes);
  }
  return { root, original, options: { gameDataDir, outputDir: path.join(root, 'output'), corpus } };
}
async function noOutput(outputDir) {
  let entries;
  try { entries = await readdir(outputDir); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  assert.deepEqual(entries, []);
}

test('cache input archive is deterministic, repairs receipts, preserves gameplay and never writes sources', async t => {
  const { root, original, options } = await fixture(t), before = await snapshot(options.gameDataDir);
  assert.equal(cacheInputFiles.length, 10);
  const first = await buildCacheInputsPack(options);
  const second = await buildCacheInputsPack({ ...options, outputDir: path.join(root, 'second') });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.files, 10);
  assert.ok(first.redactions > 0);
  const archive = await readFile(path.join(options.outputDir, first.filename));
  assert.equal(sha(archive), first.sha256);
  assert.equal(archive.length, first.bytes);
  assert.equal(await readFile(path.join(options.outputDir, first.filename + '.sha256'), 'utf8'), `${first.sha256}  ${first.filename}\n`);
  const unpacked = path.join(root, 'unpacked'); await mkdir(unpacked);
  const result = spawnSync('tar', ['-xzf', first.filename, '-C', unpacked.replaceAll('\\', '/')], { encoding: 'utf8', cwd: options.outputDir });
  assert.equal(result.status, 0, 'fixture archive must unpack successfully');
  const packRoot = path.join(unpacked, 'cache-inputs', cacheInputsVersion);
  const manifestBytes = await readFile(path.join(packRoot, 'pack.json'));
  assert.equal(sha(manifestBytes), first.manifestSha256);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.id, 'cache-inputs');
  assert.equal(manifest.version, cacheInputsVersion);
  assert.equal(manifest.distribution, 'public');
  assert.deepEqual(manifest.files.map(record => record.path).sort(), cacheInputFiles.map(name => `local-game/${name}`).sort());
  const clean = new Map();
  for (const record of manifest.files) {
    const name = record.path.slice('local-game/'.length), bytes = await readFile(path.join(packRoot, record.path));
    assert.equal(bytes.length, record.bytes); assert.equal(sha(bytes), record.sha256);
    const document = decode(name, bytes), source = decode(name, original.get(name));
    assert.deepEqual(document.gameplay, source.gameplay);
    assert.equal(document.archiveSha256, source.archiveSha256);
    assert.equal(JSON.stringify(document).includes(home), false);
    if (source.provenance) assert.equal(document.provenance.path, `[redacted-path]/${path.posix.basename(name)}`);
    if (!manifestName(name) && !source.provenance) assert.deepEqual(bytes, original.get(name));
    clean.set(name, { bytes, document });
  }
  for (const [name, { document }] of clean) if (manifestName(name)) {
    for (const output of document.outputs) {
      const sibling = path.posix.dirname(name) + '/' + path.posix.basename(output.path);
      assert.equal(output.path, `[redacted-path]/${path.posix.basename(sibling)}`);
      assert.equal(output.sha256, sha(clean.get(sibling).bytes));
      assert.equal(output.bytes, clean.get(sibling).bytes.length);
    }
    assert.equal(document.sourceHash, `sha256:${document.outputs[0].sha256}`);
  }
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('private identity, network identifiers, player bindings and home-path keys refuse without artifacts', async t => {
  const cases = [
    ['fingerprint', { note: sentinel }, 'private-fingerprint'],
    ['double-encoded fingerprint', { note: encodeURIComponent([...sentinel].map(letter => '%' + letter.charCodeAt(0).toString(16)).join('')) }, 'private-fingerprint'],
    ['long URL with account query', { source: 'https://runescape.wiki/' + 'x'.repeat(600) + '?user=fixture-account' }, 'network-identifier'],
    ['email', { contact: ['invented-cache-fixture', 'mail.fixture-domain.com'].join('@') }, 'network-identifier'],
    ['computer', { machine: ['DESKTOP', 'A1B2C3D'].join('-') }, 'network-identifier'],
    ['player binding', { [['player', 'name'].join('')]: ['Cedar', 'Quartz', '73'].join(' ') }, 'personal-default'],
    ['home key', { [`${home}/fixture.json`]: 42 }, 'home-path-key'],
  ];
  for (const [label, document, category] of cases) await t.test(label, async t => {
    const { options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
    await put(path.join(options.gameDataDir, name), gzipSync(encode(document)));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('source-contained and existing output locations refuse without modifying their contents', async t => {
  const { options } = await fixture(t), before = await snapshot(options.gameDataDir);
  const nested = path.join(options.gameDataDir, 'output');
  await assert.rejects(buildCacheInputsPack({ ...options, outputDir: nested }), { category: 'output-location' });
  await noOutput(nested);
  const existing = path.join(options.outputDir, `cache-inputs-${cacheInputsVersion}.tar.gz`), marker = Buffer.from('fixture-existing-output');
  await put(existing, marker);
  await assert.rejects(buildCacheInputsPack(options), { category: 'output-exists' });
  assert.deepEqual(await readdir(options.outputDir), [path.basename(existing)]);
  assert.deepEqual(await readFile(existing), marker);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('malformed and truncated JSON documents refuse without publishing output', async t => {
  const malformed = ['{"value":', '{"value":1', '{"value":1,}', '{"value":01}', '{"value":tru}', '{"value":"bad\\q"}', '[1 2]', '{} {}'];
  for (const [index, text] of malformed.entries()) {
    await t.test(`invalid JSON case ${index + 1}`, async t => {
      const { options } = await fixture(t);
      const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
      await put(path.join(options.gameDataDir, name), gzipSync(Buffer.from(text)));
      const before = await snapshot(options.gameDataDir);
      await assert.rejects(buildCacheInputsPack(options), { category: 'payload-json' });
      await noOutput(options.outputDir);
      assert.deepEqual(await snapshot(options.gameDataDir), before);
    });
  }
});

test('optional gzip comment, filename and extra metadata refuse without publishing output', async t => {
  for (const [label, flag, metadata] of [
    ['comment', 16, Buffer.from(sentinel + '\0')],
    ['filename', 8, Buffer.from('fixture-export.json\0')],
    ['extra', 4, Buffer.from([4, 0, 65, 66, 0, 0])],
  ]) await t.test(label, async t => {
    const { options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
    const compressed = gzipSync(encode({ gameplay: { mapId: 28 } }));
    const header = Buffer.from(compressed.subarray(0, 10)); header[3] |= flag;
    await put(path.join(options.gameDataDir, name), Buffer.concat([header, metadata, compressed.subarray(10)]));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category: 'gzip-metadata' });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

async function replaceReceiptedSource(options, name, bytes) {
  await put(path.join(options.gameDataDir, name), bytes);
  const manifest = cacheInputFiles.find(candidate => manifestName(candidate) && path.posix.dirname(candidate) === path.posix.dirname(name));
  const filename = path.join(options.gameDataDir, manifest), document = JSON.parse(await readFile(filename));
  const output = document.outputs.find(row => path.posix.basename(row.path) === path.posix.basename(name));
  const oldHash = output.sha256;
  Object.assign(output, { sha256: sha(bytes), bytes: bytes.length });
  if (document.sourceHash === `sha256:${oldHash}`) document.sourceHash = `sha256:${output.sha256}`;
  await put(filename, encode(document));
}

test('a home value crossing the 256 KiB boundary is scrubbed and its changed receipt is repaired', async t => {
  const { root, options } = await fixture(t);
  const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
  const prefix = '{"padding":"', separator = '","path":', value = `${home}/boundary.json`;
  const text = prefix + 'x'.repeat(256 * 1024 - 4 - prefix.length - separator.length - 1)
    + separator + JSON.stringify(value) + ',"gameplay":{"mapId":28}}';
  assert.equal(text.indexOf(home), 256 * 1024 - 4);
  await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
  const before = await snapshot(options.gameDataDir), receipt = await buildCacheInputsPack(options);
  const unpacked = path.join(root, 'boundary-unpacked'); await mkdir(unpacked);
  const result = spawnSync('tar', ['-xzf', receipt.filename, '-C', unpacked.replaceAll('\\', '/')], { encoding: 'utf8', cwd: options.outputDir });
  assert.equal(result.status, 0, 'boundary fixture archive must unpack');
  const packRoot = path.join(unpacked, 'cache-inputs', cacheInputsVersion, 'local-game');
  const bytes = await readFile(path.join(packRoot, name)), document = decode(name, bytes);
  assert.equal(document.path, '[redacted-path]/boundary.json');
  assert.deepEqual(document.gameplay, { mapId: 28 });
  assert.equal(document.padding, JSON.parse(text).padding);
  const receiptName = cacheInputFiles.find(candidate => candidate.endsWith('objects.manifest.v1.json'));
  const manifest = JSON.parse(await readFile(path.join(packRoot, receiptName)));
  const output = manifest.outputs.find(row => path.posix.basename(row.path) === path.posix.basename(name));
  assert.equal(output.sha256, sha(bytes)); assert.equal(output.bytes, bytes.length);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('a fingerprint across a 256 KiB scan boundary refuses without output', async t => {
  const { options } = await fixture(t);
  const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
  const prefix = '{"padding":"', separator = '","note":"';
  const text = prefix + 'x'.repeat(256 * 1024 - 8 - prefix.length - separator.length)
    + separator + sentinel + '"}';
  assert.equal(text.indexOf(sentinel), 256 * 1024 - 8);
  await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
  const before = await snapshot(options.gameDataDir);
  await assert.rejects(buildCacheInputsPack(options), { category: 'private-fingerprint' });
  await noOutput(options.outputDir);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('missing selected sources and mismatched source output receipts refuse without artifacts', async t => {
  await t.test('missing source', async t => {
    const { options } = await fixture(t);
    await rm(path.join(options.gameDataDir, cacheInputFiles[0]));
    await assert.rejects(buildCacheInputsPack(options), { category: 'invalid-input' });
    await noOutput(options.outputDir);
  });
  for (const field of ['sha256', 'bytes']) await t.test(`mismatched ${field}`, async t => {
    const { options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('objects.manifest.v1.json'));
    const filename = path.join(options.gameDataDir, name), document = JSON.parse(await readFile(filename));
    document.outputs[0][field] = field === 'sha256' ? 'b'.repeat(64) : document.outputs[0].bytes + 1;
    await put(filename, encode(document));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category: 'source-receipt' });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('semantic scan retains binding context when the same value was already seen safely', async t => {
  const { options } = await fixture(t);
  const value = ['Cedar', 'Quartz', '73'].join(' '), key = ['player', 'name'].join('');
  const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
  await replaceReceiptedSource(options, name, gzipSync(encode({ note: value, [key]: value })));
  const before = await snapshot(options.gameDataDir);
  await assert.rejects(buildCacheInputsPack(options), { category: 'personal-default' });
  await noOutput(options.outputDir);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('numeric values, object keys and Unicode escapes remain covered by private fingerprints', async t => {
  for (const kind of ['numeric value', 'object key', 'escaped Unicode']) await t.test(kind, async t => {
    const { root, options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
    let bytes;
    if (kind === 'numeric value') {
      const number = 8877665544;
      const corpusDir = path.join(root, 'corpus');
      await addFingerprints([String(number)], corpusDir);
      options.corpus = await loadCorpus(corpusDir);
      bytes = encode({ quantity: number });
    } else if (kind === 'object key') {
      bytes = encode({ [sentinel]: 42 });
    } else {
      const escaped = [...sentinel].map(character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
      bytes = Buffer.from('{"note":"' + escaped + '"}');
      assert.equal(bytes.toString().includes(sentinel), false);
      assert.equal(JSON.parse(bytes).note, sentinel);
    }
    await replaceReceiptedSource(options, name, gzipSync(bytes));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category: 'private-fingerprint' });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('a generated object ID used as a player binding cannot borrow a structural ID exemption', async t => {
  const { options } = await fixture(t);
  const value = 'object-' + 'a'.repeat(24) + '@28:0:1:2', key = ['player', 'name'].join('');
  const name = cacheInputFiles.find(name => name.endsWith('definitions.v1.json.gz'));
  await replaceReceiptedSource(options, name, gzipSync(encode({ id: value, [key]: value })));
  const before = await snapshot(options.gameDataDir);
  await assert.rejects(buildCacheInputsPack(options), { category: 'personal-default' });
  await noOutput(options.outputDir);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

function compactPlacementRows({ redact = false } = {}) {
  const rows = [0, 1].map(index => ({
    id: 'object-' + (index ? 'b' : 'a').repeat(24) + '@28:0:1:2',
    sourceId: 'object-' + (index ? 'd' : 'c').repeat(24),
    objectId: 42 + index, mapId: 28, x: 3200 + index, y: 3200, plane: 0,
    source: { minor: 12850, x: 1 + index, y: 2, plane: 0 },
  }));
  if (redact) rows[1].provenance = { path: `${home}/placement.json` };
  // Deliberate harmless spacing makes raw-row preservation observable.
  const rawRows = rows.map((row, index) => JSON.stringify(row).replace(`"objectId":${42 + index}`, `"objectId": ${42 + index}`));
  const text = '{"schemaVersion":1,"provenance":{"format":"fixture"},"placements":['
    + rawRows.join(',') + '],"summary":{"mappedPlacements":2}}';
  return { rows, rawRows, text };
}

test('compact placement rows preserve IDs, source identities and unchanged row bytes while scrubbing home provenance', async t => {
  for (const redact of [false, true]) await t.test(redact ? 'changed provenance' : 'unchanged export', async t => {
    const { root, options } = await fixture(t), source = compactPlacementRows({ redact });
    const name = cacheInputFiles.find(name => name.endsWith('objects.placements.v1.json.gz'));
    const original = gzipSync(Buffer.from(source.text), { level: 1 });
    await replaceReceiptedSource(options, name, original);
    const before = await snapshot(options.gameDataDir), receipt = await buildCacheInputsPack(options);
    const unpacked = path.join(root, 'compact-unpacked'); await mkdir(unpacked);
    const result = spawnSync('tar', ['-xzf', receipt.filename, '-C', unpacked.replaceAll('\\', '/')], { encoding: 'utf8', cwd: options.outputDir });
    assert.equal(result.status, 0, 'compact fixture archive must unpack');
    const packRoot = path.join(unpacked, 'cache-inputs', cacheInputsVersion, 'local-game');
    const bytes = await readFile(path.join(packRoot, name)), text = gunzipSync(bytes).toString('utf8'), clean = JSON.parse(text);
    assert.equal(clean.summary.mappedPlacements, 2);
    assert.equal(clean.placements.length, 2);
    assert.deepEqual(clean.placements[0], source.rows[0]);
    assert.equal(text.includes(source.rawRows[0]), true);
    const expectedSecond = structuredClone(source.rows[1]);
    if (redact) expectedSecond.provenance.path = '[redacted-path]/placement.json';
    assert.deepEqual(clean.placements[1], expectedSecond);
    if (!redact) assert.deepEqual(bytes, original);
    const manifestName = cacheInputFiles.find(candidate => candidate.endsWith('objects.manifest.v1.json'));
    const manifest = JSON.parse(await readFile(path.join(packRoot, manifestName)));
    const output = manifest.outputs.find(row => path.posix.basename(row.path) === path.posix.basename(name));
    assert.equal(output.sha256, sha(bytes)); assert.equal(output.bytes, bytes.length);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('compact placement malformed rows and mismatched summary counts refuse without artifacts', async t => {
  for (const kind of ['malformed row', 'summary count']) await t.test(kind, async t => {
    const { options } = await fixture(t), source = compactPlacementRows();
    const text = kind === 'malformed row' ? source.text.replace('"objectId": 42', '"objectId":')
      : source.text.replace('"mappedPlacements":2', '"mappedPlacements":3');
    const name = cacheInputFiles.find(name => name.endsWith('objects.placements.v1.json.gz'));
    await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category: 'payload-json' });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('compact placement scalar and array rows refuse before values can bypass object scanning', async t => {
  for (const value of [sentinel, [sentinel], null, 42]) await t.test(typeof value + (Array.isArray(value) ? ' array' : ''), async t => {
    const { options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('objects.placements.v1.json.gz'));
    const text = '{"schemaVersion":1,"placements":[' + JSON.stringify(value) + '],"summary":{"mappedPlacements":1}}';
    await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
    await assert.rejects(buildCacheInputsPack(options), { category: 'payload-json' });
    await noOutput(options.outputDir);
  });
});

test('compact placement duplicate keys cannot hide original private text in prefix, rows or summary', async t => {
  for (const location of ['prefix', 'row', 'summary']) await t.test(location, async t => {
    const { options } = await fixture(t), source = compactPlacementRows();
    const duplicate = '"note":' + JSON.stringify(sentinel) + ',"note":"public"';
    let text;
    if (location === 'prefix') text = source.text.replace('"schemaVersion":1,', '"schemaVersion":1,' + duplicate + ',');
    else if (location === 'row') text = source.text.replace('"objectId": 42,', '"objectId": 42,' + duplicate + ',');
    else text = source.text.replace('"mappedPlacements":2', '"mappedPlacements":2,' + duplicate);
    // JSON.parse alone discards the private original before a value scanner sees it.
    const parsed = JSON.parse(text);
    assert.equal(JSON.stringify(parsed).includes(sentinel), false);
    const name = cacheInputFiles.find(name => name.endsWith('objects.placements.v1.json.gz'));
    await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category: 'payload-json' });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});

test('compact placement unsafe numeric literals refuse before JSON rounding can hide their original bytes', async t => {
  const { options } = await fixture(t), source = compactPlacementRows();
  const unsafe = '9007199254740993';
  const text = source.text.replace('"objectId": 42', '"objectId": ' + unsafe);
  assert.notEqual(String(JSON.parse(text).placements[0].objectId), unsafe);
  const name = cacheInputFiles.find(name => name.endsWith('objects.placements.v1.json.gz'));
  await replaceReceiptedSource(options, name, gzipSync(Buffer.from(text)));
  const before = await snapshot(options.gameDataDir);
  await assert.rejects(buildCacheInputsPack(options), { category: 'payload-json' });
  await noOutput(options.outputDir);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('long contiguous mask strings do not create artificial standalone token boundaries', async t => {
  const { options } = await fixture(t);
  const tail = 'aZ9'.repeat(14) + 'b', components = 'Q'.repeat(512) + tail;
  assert.equal(tail.length, 43);
  const name = cacheInputFiles.find(name => name.endsWith('walkability.v1.json.gz'));
  await replaceReceiptedSource(options, name, gzipSync(encode({ regions: [{ masks: { components } }] })));
  const before = await snapshot(options.gameDataDir), receipt = await buildCacheInputsPack(options);
  assert.equal(receipt.files, 10);
  assert.equal(sha(await readFile(path.join(options.outputDir, receipt.filename))), receipt.sha256);
  assert.deepEqual(await snapshot(options.gameDataDir), before);
});

test('standalone tokens and long bound private values still refuse after mask scan optimization', async t => {
  const tail = 'aZ9'.repeat(14) + 'b', long = 'Q'.repeat(512) + tail;
  const cases = [
    ['standalone token', { regions: [{ masks: { components: tail } }] }, 'token'],
    ['long password', { [['pass', 'word'].join('')]: long }, 'token'],
    ['long player binding', { [['player', 'name'].join('')]: long }, 'personal-default'],
  ];
  for (const [label, document, category] of cases) await t.test(label, async t => {
    const { options } = await fixture(t);
    const name = cacheInputFiles.find(name => name.endsWith('walkability.v1.json.gz'));
    await replaceReceiptedSource(options, name, gzipSync(encode(document)));
    const before = await snapshot(options.gameDataDir);
    await assert.rejects(buildCacheInputsPack(options), { category });
    await noOutput(options.outputDir);
    assert.deepEqual(await snapshot(options.gameDataDir), before);
  });
});
