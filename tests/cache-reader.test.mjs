import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, gzipSync } from 'node:zlib';
import { decompress, unpackArchive, parseJsonc } from '../scripts/cache/cache-reader.mjs';

test('SQLite ZLB and JS5 containers verify declared decompressed lengths', () => {
  const plain = Buffer.from('copied cache payload');
  const header = Buffer.alloc(8); header.write('5a4c4201', 0, 'hex'); header.writeUInt32BE(plain.length, 4);
  const zlb = Buffer.concat([header, deflateSync(plain)]);
  assert.deepEqual(decompress(zlb), plain);
  zlb.writeUInt32BE(plain.length + 1, 4);
  assert.throws(() => decompress(zlb), /length/);
  const zipped = gzipSync(plain), js5 = Buffer.alloc(9);
  js5[0] = 2; js5.writeUInt32BE(zipped.length, 1); js5.writeUInt32BE(plain.length, 5);
  assert.deepEqual(decompress(Buffer.concat([js5, zipped])), plain);
  assert.throws(() => decompress(Buffer.from([3, 0, 0, 0, 0])), /Unsupported/);
});

test('SQLite subfile table preserves sparse IDs and rejects overlapping or truncated ranges', () => {
  const bytes = Buffer.alloc(18); bytes[0] = 1;
  bytes.writeUInt32BE(13, 1); bytes.writeUInt32BE(15, 5); bytes.writeUInt32BE(18, 9);
  bytes.write('ABCDE', 13);
  const files = unpackArchive(bytes, [0, 5]);
  assert.equal(files.get(0).toString(), 'AB'); assert.equal(files.get(5).toString(), 'CDE');
  assert.equal(files.has(1), false);
  const corrupt = Buffer.from(bytes); corrupt.writeUInt32BE(14, 9);
  assert.throws(() => unpackArchive(corrupt, [0, 5]), /range/);
  assert.throws(() => unpackArchive(bytes.subarray(0, 10), [0, 5]), /Truncated/);
});

test('JSONC parsing preserves URL and comment-like string contents', () => {
  assert.deepEqual(parseJsonc('{/* schema */"url":"https://example.test/a//b", // note\n"s":"/*literal*/,]","a":[1,2,],}'),
    { url: 'https://example.test/a//b', s: '/*literal*/,]', a: [1, 2] });
});
