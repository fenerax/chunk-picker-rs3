import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTable, writeDataset } from '../scripts/cache/game-data-common.mjs';
import { typedCoordinates, enumEntries } from '../scripts/cache/game-data-places.mjs';

test('config IDs and grouped struct IDs retain distinct archive addressing', () => {
  const cache = { table: () => ({ entries: new Map([[2, {}], [9, {}]]) }),
    archive: (_, minor) => minor === 2 ? new Map([[1, Buffer.from('a')], [7, Buffer.from('bad')]]) : null,
    decoders: { decode: (_, bytes) => { if (bytes.toString() === 'bad') throw new Error('Unknown opcode'); return { name: bytes.toString() }; } } };
  const config = loadTable(cache, { major: 2, minor: 2, kind: 'quest' });
  assert.deepEqual([...config.definitions.keys()], [1]);
  assert.equal(config.errors[0].id, 7);
  const grouped = loadTable(cache, { major: 22, groupSize: 32, kind: 'struct' });
  assert.deepEqual([...grouped.definitions.keys()], [65]);
  assert.equal(grouped.errors[0].id, 71);
  assert.equal(grouped.errors[1].message, 'Declared archive missing from copied snapshot');
});

test('versioned datasets refuse overwrites and paths escaping their directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rs3-game-data-test-'));
  try {
    const file = writeDataset(directory, 'version.v1.json', { example: 1 });
    assert.equal(file.sha256.length, 64);
    assert.throws(() => writeDataset(directory, 'version.v1.json', 'replacement'), /EEXIST/);
    assert.throws(() => writeDataset(directory, '../escape.json', 'escape'), /inside/);
    assert.deepEqual(JSON.parse(readFileSync(file.path)), { example: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('only typed coordgrid params become coordinates, preserving source plane', () => {
  const packed = (1 << 28) | (1083 << 14) | 1768;
  const rows = typedCoordinates([{ prop: 1, intvalue: packed }, { prop: 2, intvalue: packed },
    { prop: 1, intvalue: -1 }], new Map([[1, { type: { vartype: 22 } }], [2, { type: { vartype: 0 } }]]));
  assert.deepEqual(rows, [{ param: 1, packed, x: 1083, y: 1768, plane: 1 }]);
  assert.deepEqual(enumEntries({ intArrayValue2: { values: [[1, packed]] } }), [[1, packed]]);
});
