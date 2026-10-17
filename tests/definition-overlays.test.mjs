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
