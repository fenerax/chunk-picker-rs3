import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateJsonKeys } from '../scripts/lib/json-duplicates.mjs';

test('reports overwritten values and both source lines before JSON.parse loses them', () => {
  const source = '{\n "Chunks": ["dungeon"],\n "Chunks": ["surface"]\n}';
  assert.deepEqual(findDuplicateJsonKeys(source), [{ path: ['Chunks'], firstLine: 2, laterLine: 3,
    before: ['dungeon'], after: ['surface'] }]);
});

test('decodes escaped keys and separates object scopes, arrays and literal key punctuation', () => {
  const source = String.raw`{"rows":[{"a.b":1,"a\u002eb":2},{"a.b":3}],"quoted\"key":1,"quoted\"key":2}`;
  const result = findDuplicateJsonKeys(source);
  assert.deepEqual(result.map(row => row.path), [['rows', 0, 'a.b'], ['quoted"key']]);
  assert.equal(findDuplicateJsonKeys('{"a":{"x":1},"b":{"x":2}}').length, 0);
});

test('retains every repeated occurrence including identical values and nested lost records', () => {
  const result = findDuplicateJsonKeys('{"a":{"x":1,"x":2},"a":3,"a":3}');
  assert.deepEqual(result.map(row => [row.path, row.before, row.after]), [
    [['a', 'x'], 1, 2], [['a'], { x: 2 }, 3], [['a'], 3, 3],
  ]);
});

test('invalid syntax cannot produce a partial or misleading clean report', () => {
  for (const source of ['{"a":1,}', '{"a":', '{"a":"bad\nstring"}', '{} extra']) {
    assert.throws(() => findDuplicateJsonKeys(source), SyntaxError);
  }
});
