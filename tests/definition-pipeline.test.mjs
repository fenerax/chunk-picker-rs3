import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDefinitionPipeline } from '../app/dataset-pipeline.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stages = ['divinationTraining', 'retainedTaskCorrections', 'retainedUnsupportedCorrections', 'metadataCorrections', 'equipmentCorrections'];
const dataset = { capabilities: Object.fromEntries(stages.map(stage => [stage, true])) };
const original = () => ({ chunks: { one: { Shop: { Removed: true, Kept: true } } },
  challenges: { Nonskill: { Example: { Label: 'Example' } } } });
const replacement = { Label: 'Example', Reviewed: true, Output: 'Reviewed output' };
const before = { Label: 'Example', Reviewed: true };
const overlays = [{ schemaVersion: 1, id: 'synthetic-review', version: '1', patches: [
  { path: ['chunks', 'one', 'Shop', 'Removed'], beforePresent: true, before: true, beforeRecordSha256: hash(true), afterPresent: false },
  { path: ['challenges', 'Nonskill', 'Example'], beforePresent: true, before, beforeRecordSha256: hash(before), afterPresent: true, after: replacement },
] }];
const operations = Object.fromEntries(stages.map(stage => [stage, data => ({ ...data,
  counts: { ...data.counts, [stage]: (data.counts?.[stage] ?? 0) + 1 },
  ...(stage === 'metadataCorrections' ? { challenges: { Nonskill: { Example: { ...data.challenges.Nonskill.Example, Reviewed: true } } } } : {}),
})]));
const pipeline = selected => createDefinitionPipeline({ requireDataset: value => value, overlays: selected, operations,
  applySelectedCorrections: data => data });

test('server definitions serialization contains reviewed shop and task changes after all prerequisite stages', () => {
  const p = pipeline(overlays), raw = original();
  const result = p.prepareServerDefinitions(raw, dataset);
  const publishedDefinitions = JSON.parse(JSON.stringify(result));
  assert.deepEqual(publishedDefinitions.chunks.one.Shop, { Kept: true });
  assert.deepEqual(publishedDefinitions.challenges.Nonskill.Example, replacement);
  assert.equal(raw.chunks.one.Shop.Removed, true);
  assert.deepEqual(Object.values(result.counts), [1, 1, 1, 1, 1]);
  assert.equal(p.prepareServerDefinitions(result, dataset), result);
  assert.equal(p.prepareTaskDefinitions(result, dataset), result);
});

test('serialized worker inherits the complete preparation ledger without repeating guarded stages', () => {
  const p = pipeline(overlays), server = p.prepareServerDefinitions(original(), dataset);
  const stages = p.preparedDefinitionStages(server), transported = structuredClone(server);
  const worker = p.prepareWorkerDefinitions(transported, dataset, stages);
  assert.equal(worker, transported);
  assert.deepEqual(worker, server);
  assert.equal(p.prepareTaskDefinitions(worker, dataset), worker);
  assert.deepEqual(p.prepareWorkerDefinitions(original(), dataset), server);
  assert.deepEqual(p.prepareTaskDefinitions(original(), dataset), server);
});

test('unselected legacy server preparation retains the equipment-only boundary', () => {
  const p = pipeline([]), raw = original(), result = p.prepareServerDefinitions(raw, dataset);
  assert.deepEqual(result.counts, { equipmentCorrections: 1 });
  assert.deepEqual(result.chunks, raw.chunks);
  assert.equal(result.challenges.Nonskill.Example.Reviewed, undefined);
});

test('injected fixtures explicitly skip selected overlays while full selected definitions reject drift', () => {
  let selectedCorrections = 0;
  const p = createDefinitionPipeline({ requireDataset: value => value, overlays, operations,
    applySelectedCorrections: data => { selectedCorrections++; return data; } });
  const fixture = { chunks: {}, challenges: {} };
  assert.equal(p.prepareTaskDefinitions(fixture), fixture);
  assert.equal(selectedCorrections, 0);
  const serverFixture = p.prepareServerDefinitions(original(), dataset, { reviewedOverlays: false });
  assert.equal(serverFixture.chunks.one.Shop.Removed, true);
  p.prepareWorkerDefinitions(structuredClone(serverFixture), dataset, p.preparedDefinitionStages(serverFixture), { reviewedOverlays: false });
  assert.equal(selectedCorrections, 0);
  const drifted = original(); drifted.chunks.one.Shop.Removed = 'drift';
  assert.throws(() => p.prepareServerDefinitions(drifted, dataset), /drift/);
  assert.equal(selectedCorrections, 1);
});
