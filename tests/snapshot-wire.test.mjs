import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { encodeSnapshotBytes, decodeSnapshotBytes } from '../app/tasks/snapshot-wire.mjs';

test('snapshot blocks restore exact bytes across literals, long matches, offsets, overlap and binary data', () => {
  let seed = 42;
  const random = Buffer.alloc(150_000);
  for (let i = 0; i < random.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; random[i] = seed >>> 24; }
  const cases = [Buffer.alloc(0), Buffer.from('x'), Buffer.from('abc'.repeat(100_000)), random,
    Buffer.concat([random, random]), Buffer.from('Synthetic description 雪 '.repeat(5000)),
    ...[14, 15, 16, 254, 255, 256, 65534, 65535, 65536].map(length => Buffer.alloc(length, 65))];
  for (const raw of cases) {
    const expected = Buffer.from(raw), wire = encodeSnapshotBytes(raw);
    assert.deepEqual(decodeSnapshotBytes(wire), expected);
    assert.equal(wire.byteLength, wire.buffer.byteLength, 'no hidden backing allocation');
  }
});

test('native calculation graphs preserve text, property order, maps, sets, cycles, aliases and typed arrays', () => {
  const description = 'Synthetic description 雪 '.repeat(200);
  const rows = Array.from({ length: 1000 }, (_, id) => ({ id, description }));
  const value = { rows, shared: rows[0], map: new Map([[description, rows[0]]]), set: new Set([description]),
    sparse: [undefined, , null], special: { nan: NaN, zero: -0, bigint: 99n }, bytes: new Uint8Array([1, 2]) };
  value.self = value;
  const raw = serialize(value), rawSize = raw.length, wire = encodeSnapshotBytes(raw);
  assert.ok(wire.length < rawSize / 10, 'duplicate text must not stay resident per task');
  const copy = deserialize(decodeSnapshotBytes(wire));
  assert.deepEqual(copy, value);
  assert.equal(copy.rows[0], copy.shared);
  assert.equal(copy.map.get(description), copy.shared);
  assert.equal(copy.self, copy);
  assert.deepEqual(Object.keys(copy), Object.keys(value));
});

test('known LZ4 tokens decode independently and malformed internal blocks fail closed', () => {
  // One literal A, an overlapping four-byte match at offset one, then B.
  const block = Buffer.from([1, 6, 0, 0, 0, 0x10, 65, 1, 0, 0x10, 66]);
  assert.equal(decodeSnapshotBytes(block).toString(), 'AAAAAB');
  for (const bytes of [Buffer.alloc(0), Buffer.from([2, 0, 0, 0, 0]),
    Buffer.from([0, 1, 0, 0, 0]), Buffer.from([1, 1, 0, 0, 0, 0x10]),
    Buffer.from([1, 4, 0, 0, 0, 0, 0, 0]), Buffer.from([1, 1, 0, 0, 0, 0xf0])])
    assert.throws(() => decodeSnapshotBytes(bytes), TypeError);
});

test('large 15-literal runs and growing incompressible blocks round-trip cleanly', () => {
  // Exercises the 15-literal length boundary across tens of thousands of tokens
  // (where V8 Maglev previously miscompiled closed-over length helpers) and forces
  // output buffer growth on incompressible data.
  const parts = [];
  for (let i = 0; i < 50_000; i++) {
    parts.push(Buffer.from('LIT' + String(i).padStart(12, '0')));
    parts.push(Buffer.from('MATCH_8B'));
  }
  const repetitive = Buffer.concat(parts);
  const encRep = encodeSnapshotBytes(Buffer.from(repetitive));
  assert.equal(encRep[0], 1);
  assert.equal(encRep.byteLength, encRep.buffer.byteLength);
  assert.equal(Buffer.compare(decodeSnapshotBytes(encRep), repetitive), 0);

  let seed = 1337;
  const incompressible = Buffer.alloc(300_000);
  for (let i = 0; i < incompressible.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    incompressible[i] = seed >>> 24;
  }
  const encRaw = encodeSnapshotBytes(Buffer.from(incompressible));
  assert.equal(encRaw[0], 0, 'incompressible block falls back to raw wire header');
  assert.equal(encRaw.byteLength, encRaw.buffer.byteLength);
  assert.equal(Buffer.compare(decodeSnapshotBytes(encRaw), incompressible), 0);
});
