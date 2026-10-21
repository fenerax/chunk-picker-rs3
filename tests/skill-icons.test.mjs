import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SKILLS, VERSION, verifySkillEnums, decodeSkillContainer, exportSkillIcons } from '../scripts/export-skill-icons.mjs';

const manifest = JSON.parse(readFileSync(new URL('../app/data/skill-icons.2026-10-08.v1.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('all 29 canonical skill icons retain small and large native cache provenance', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'skills');
  assert.equal(manifest.version, VERSION);
  assert.deepEqual(Object.keys(manifest.icons), SKILLS);
  assert.deepEqual(manifest.unmatched, []);
  assert.deepEqual(manifest.unavailableLarge, []);
  assert.deepEqual(manifest.coverage, { requested: 29, mapped: 29, bySource: { 'cache-sprite': 29 } });
  let bytes = 0;
  for (const [name, icon] of Object.entries(manifest.icons)) {
    for (const [size, asset] of [['small', icon], ['large', icon.large]]) {
      assert.match(asset.file, /^[A-Za-z0-9_-]+\.png$/);
      assert.equal(asset.width, size === 'small' ? 25 : 52);
      assert.equal(asset.height, asset.width);
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
      assert.equal(asset.source.kind, 'cache-sprite');
      assert.equal(asset.source.archiveId, 8);
      assert.equal(asset.source.frameId, 0);
      assert.equal(asset.source.enumId, size === 'small' ? 371 : 745);
      assert.equal(asset.source.nameEnumId, 108);
      assert.match(asset.source.archiveSha256, /^[a-f0-9]{64}$/);
      assert.match(asset.source.groupSha256, /^[a-f0-9]{64}$/);
      bytes += asset.bytes;
    }
    assert.equal(icon.mappingEvidence.interfaceId, 1213);
    assert.equal(icon.mappingEvidence.spriteId, icon.source.groupId);
    assert.equal(icon.mappingEvidence.triggerSkillKey, SKILLS.indexOf(name) + 1);
    assert.deepEqual(icon.aliases, ({ Constitution: ['Hitpoints','Hit points'], Defence: ['Defense'], Runecrafting: ['Runecraft'] })[name] ?? []);
  }
  assert.equal(manifest.totalBytes, bytes);
  assert.equal(manifest.icons.Archaeology.source.groupId, 10782);
  assert.equal(manifest.icons.Necromancy.source.groupId, 30934);
  assert.equal(manifest.icons.Archaeology.large.source.groupId, 10785);
  assert.equal(manifest.icons.Necromancy.large.source.groupId, 30937);
  for (const enumId of [108,371,745]) assert.match(manifest.source.enumEvidence[enumId].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.source.copiedFiles.map(row => row.archiveId), [3,8,17]);
});

test('enum evidence cannot silently shift skill names or omit a sprite mapping', () => {
  const names = { stringArrayValue2: { values: SKILLS.map((name, index) => [index + 1, name]) } };
  const sprites = { intArrayValue2: { values: SKILLS.map((_, index) => [index + 1, index + 100]) } };
  assert.equal(verifySkillEnums(names, sprites, sprites).length, 29);
  const wrong = structuredClone(names); wrong.stringArrayValue2.values[28][1] = 'Attack';
  assert.throws(() => verifySkillEnums(wrong, sprites, sprites), /Necromancy/);
  const missing = structuredClone(sprites); missing.intArrayValue2.values.pop();
  assert.throws(() => verifySkillEnums(names, sprites, missing), /Necromancy/);
});

test('legacy bzip containers reject truncated or excessive bounds before Python executes', () => {
  assert.throws(() => decodeSkillContainer(Buffer.from([1]), 'must-never-execute'), /Truncated/);
  const malformed = Buffer.alloc(9); malformed[0] = 1; malformed.writeUInt32BE(4, 1);
  assert.throws(() => decodeSkillContainer(malformed, 'must-never-execute'), /bounds/);
  malformed.writeUInt32BE(0, 1); malformed.writeUInt32BE(0xffffffff, 5);
  assert.throws(() => decodeSkillContainer(malformed, 'must-never-execute'), /bounds/);
});

test('legacy bzip decoding accepts the optional two-byte JS5 version footer', t => {
  const payload = Buffer.from('MUFZJlNZWVj37wAAAREAQAAqYaAAIgY1BDAhIYM7fF3JFOFCQWVj37w=', 'base64');
  const header = Buffer.alloc(9); header[0] = 1; header.writeUInt32BE(payload.length, 1); header.writeUInt32BE(10, 5);
  for (const footer of [Buffer.alloc(0), Buffer.from([0xcd, 2])]) {
    let decoded;
    try { decoded = decodeSkillContainer(Buffer.concat([header, payload, footer])); }
    catch (error) { if (error.code === 'ENOENT') return t.skip('Python is required for the exporter bzip backend'); throw error; }
    assert.equal(decoded.toString(), 'cache icon');
  }
});

test('exporter refuses existing output before accessing a cache', async () => {
  await assert.rejects(exportSkillIcons({ workspace: 'must-never-open', output: import.meta.dirname, manifest: 'must-never-write' }), /overwrite/);
});

const assetRoot = process.env.SKILL_ICON_ASSET_ROOT;
test('generated PNGs match manifest bytes, hashes, dimensions and native alpha', { skip: !assetRoot }, () => {
  const dir = resolve(assetRoot);
  assert.ok(existsSync(dir));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'manifest.json'))), manifest);
  for (const icon of Object.values(manifest.icons)) for (const asset of [icon, icon.large]) {
    const png = readFileSync(join(dir, asset.file));
    assert.equal(png.length, asset.bytes); assert.equal(hash(png), asset.sha256);
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), asset.width); assert.equal(png.readUInt32BE(20), asset.height);
    assert.equal(png[25], 6); // RGBA
    const parts = [];
    for (let pos = 8; pos < png.length;) {
      const length = png.readUInt32BE(pos), type = png.subarray(pos + 4, pos + 8).toString();
      if (type === 'IDAT') parts.push(png.subarray(pos + 8, pos + 8 + length));
      pos += length + 12;
    }
    const raw = inflateSync(Buffer.concat(parts)), stride = asset.width * 4 + 1;
    let opaque = 0, transparent = 0;
    for (let y=0;y<asset.height;y++) {
      assert.equal(raw[y * stride], 0);
      for (let x=0;x<asset.width;x++) { const alpha=raw[y * stride + 4 + x * 4]; if (alpha) opaque++; else transparent++; }
    }
    assert.ok(opaque > 0); assert.ok(transparent > 0);
  }
});
