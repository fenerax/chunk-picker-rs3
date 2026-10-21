import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyDefinitionOverlays } from '../app/data/definition-overlays.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const document = patches => [{ schemaVersion: 1, id: 'fixture', version: '1', patches }];
const patch = (path, before, after) => ({ path, beforePresent: before !== undefined, ...(before === undefined ? {} : { before, beforeRecordSha256: hash(before) }), afterPresent: after !== undefined, ...(after === undefined ? {} : { after }) });
test('guarded records support insertion, deletion and copy-on-write idempotence', () => {
  const source = { tasks: { kept: { Level: 1 }, changed: { Level: 2, Output: 'Example' } }, shops: { wrong: true } };
  const overlays = document([patch(['tasks', 'changed'], source.tasks.changed, { Level: 3, Output: 'Example' }), patch(['tasks', 'new'], undefined, { Output: 'Other' }), patch(['shops', 'wrong'], true)]);
  const result = applyDefinitionOverlays(source, overlays);
  assert.equal(source.tasks.changed.Level, 2); assert.equal(source.shops.wrong, true);
  assert.equal(result.tasks.kept, source.tasks.kept); assert.equal(result.tasks.changed.Level, 3);
  assert.equal(Object.hasOwn(result.shops, 'wrong'), false);
  assert.equal(applyDefinitionOverlays(result, overlays), result);
});
test('full-record drift, insertion collisions and invalid paths fail closed', () => {
  assert.throws(() => applyDefinitionOverlays({ tasks: { task: { Level: 1, Output: 'Drift' } } }, document([patch(['tasks', 'task'], { Level: 1 }, { Level: 2 })])), /drift/);
  assert.throws(() => applyDefinitionOverlays({ tasks: { task: true } }, document([patch(['tasks', 'task'], undefined, false)])), /drift/);
  assert.throws(() => applyDefinitionOverlays({}, document([patch(['__proto__', 'polluted'], undefined, true)])), /invalid/);
  assert.throws(() => applyDefinitionOverlays({}, document([patch(['missing', 'task'], undefined, true)])), /missing parent/);
});
test('a late failed patch never mutates an earlier caller-owned record', () => {
  const source = { tasks: { one: { Level: 1 }, two: { Level: 5 } } };
  assert.throws(() => applyDefinitionOverlays(source, document([patch(['tasks', 'one'], { Level: 1 }, { Level: 2 }), patch(['tasks', 'two'], { Level: 4 }, { Level: 6 })])), /drift/);
  assert.equal(source.tasks.one.Level, 1);
});
test('many patches in one large category copy each touched path once and match one-at-a-time application', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const rows = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`task ${index}`, { Level: index, Items: [`item ${index}`] }]));
  const source = freeze({ challenges: { Extra: rows, Other: { kept: { Level: 1 } } }, chunks: { one: {} } });
  const patches = Array.from({ length: 400 }, (_, index) => patch(['challenges', 'Extra', `task ${index * 2}`, 'Level'], index * 2, index * 2 + 1))
    .concat(patch(['challenges', 'Extra', 'task 1', 'Items'], ['item 1'], ['item 1', 'extra']), patch(['challenges', 'Extra', 'added'], undefined, { Level: 7 }),
      patch(['challenges', 'Extra', 'task 3'], rows['task 3']));
  const result = applyDefinitionOverlays(source, document(patches));
  // Reference: each patch applied as its own overlay, so nothing is shared between patches.
  const reference = patches.reduce((current, row) => applyDefinitionOverlays(current, document([row])), source);
  assert.deepEqual(result, reference);
  assert.deepEqual(Object.keys(result.challenges.Extra), Object.keys(reference.challenges.Extra));
  assert.equal(result.challenges.Extra['task 0'].Level, 1); assert.equal(source.challenges.Extra['task 0'].Level, 0);
  assert.deepEqual(result.challenges.Extra['task 1'].Items, ['item 1', 'extra']);
  assert.equal(Object.hasOwn(result.challenges.Extra, 'task 3'), false);
  assert.equal(result.challenges.Extra['task 5'], source.challenges.Extra['task 5']);
  assert.equal(result.challenges.Other, source.challenges.Other); assert.equal(result.chunks, source.chunks);
  assert.equal(applyDefinitionOverlays(result, document(patches)), result);
  // The second overlay in one application sees the first one's private copies.
  const twice = applyDefinitionOverlays(source, [...document([patches[0]]), { ...document([patch(['challenges', 'Extra', 'task 0', 'Level'], 1, 9)])[0], id: 'second' }]);
  assert.equal(twice.challenges.Extra['task 0'].Level, 9); assert.equal(source.challenges.Extra['task 0'].Level, 0);
});
