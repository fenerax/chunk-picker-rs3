// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { generate } from '../scripts/perf/capacity/fixture.mjs';
import { prepareFixtureInputs } from '../scripts/perf/capacity/fixture-inputs.mjs';
import { fixtureConfigDigest, logicalFixtureDigest, fixtureInventory, sealFixture, copyFixture, verifyFixture } from '../scripts/perf/capacity/fixture-cache.mjs';
import { fixtureReuseMarkdown } from '../scripts/perf/capacity/report.mjs';
import { writeRunManifest } from '../scripts/perf/capacity/run-artifacts.mjs';
import { syntheticWorld, digest } from '../scripts/perf/capacity/model.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { openStore } from '../app/storage/store.mjs';
import { bindingPath } from '../app/dataset-binding.mjs';
import { datasetEvidencePath, datasetEvidenceRecord } from '../app/dataset-evidence.mjs';
import { syntheticDataset } from './helpers/dataset-evidence.mjs';

const profile = { name: 'smoke', storageFormat: 'format1', seed: 'synthetic-evidence-copy', port: 0,
  catalogue: { chunks: 4, tasks: 4, dependencyDepth: 1, crossLinks: 1, aliases: 100 },
  fixture: { groups: 1, rosterMix: [1, 0, 0, 0, 0], freshFraction: 1, unlockFraction: .5, historyEvents: 0, snapshots: 0, keysPerMember: 0 } };
const json = async file => JSON.parse(await readFile(file, 'utf8'));

test('fixture copy uses production evidence migration and keeps the source bytes and seal valid', async t => {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await mkdtemp(new URL('fixture-evidence-', base)); t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await mkdir(source);
  const manifest = await generate(profile, source, { workers: 1 });
  const previous = syntheticDataset(), current = syntheticDataset({ evidence: 'new source' });
  const { data, rules } = await prepareFixtureInputs(profile), world = syntheticWorld(data, buildWorld);
  // A synthetic older writer with a real sealed registry/store layout.
  for (const group of manifest.groups) {
    const dataDir = path.join(source, 'pickers', group.pickerId), store = await openStore({ dataDir, world, registry: rules, retention: false });
    try {
      const state = store.getState();
      state.provenance.dataset = { id: previous.datasetId, contractVersion: previous.datasetContractVersion, digest: previous.digest };
      await store.replace({ format: 'rs3-chunk-picker', schemaVersion: 1, state }, state.revision);
      const saved = store.getState(); group.revision = saved.revision; group.stateDigest = digest(saved);
      group.logicalStateDigest = digest(saved); group.retainedSnapshots = (await store.listBackups()).length;
    } finally { await store.close(); }
    await writeFile(bindingPath(dataDir), JSON.stringify({ schemaVersion: 1, datasetId: previous.datasetId, datasetContractVersion: 1, digest: previous.digest }));
  }
  await writeFile(bindingPath(path.join(source, 'legacy')), JSON.stringify({ schemaVersion: 1, datasetId: previous.datasetId, datasetContractVersion: 1, digest: previous.digest }));
  manifest.datasetDigest = previous.digest; manifest.datasetEvidence = datasetEvidenceRecord(previous);
  manifest.configDigest = fixtureConfigDigest(profile, previous.digest); manifest.fixtureDigest = logicalFixtureDigest(manifest);
  await writeFile(path.join(source, 'fixture.json'), JSON.stringify(manifest));
  const sealFile = directory => path.join(directory, 'fixture-complete.json');
  await rm(sealFile(source)); await sealFixture(source, manifest, { sourceCommit: 'synthetic-old-writer' });
  const sourceSeal = await readFile(sealFile(source)), sourceInventory = await fixtureInventory(source);
  const sourceHashes = await Promise.all(sourceInventory.map(async row => digest(await readFile(path.join(source, row.path)))));

  await t.test('copy commits one backup, revision and event per picker and records the applied transition', async () => {
    const output = path.join(root, 'upgraded'), copied = await copyFixture(source, output, profile, current);
    const transition = copied.fixtureReuse.datasetTransition;
    assert.equal(copied.fixtureReuse.retentionNormalization.clock, 'serving-wall-clock');
    assert.equal(copied.retentionNormalization.candidatesAfter, 0);
    assert.deepEqual({ oldDigest: transition.oldDigest, newDigest: transition.newDigest, applied: transition.applied,
      refreshedPickers: transition.refreshedPickers, backupsAdded: transition.backupsAdded },
    { oldDigest: previous.digest, newDigest: current.digest, applied: 'evidence-only catalogue-refresh', refreshedPickers: 1, backupsAdded: 1 });
    const group = copied.groups[0], store = await openStore({ dataDir: path.join(output, 'pickers', group.pickerId), world, registry: rules, retention: false });
    try {
      assert.equal(store.getState().provenance.dataset.digest, current.digest);
      assert.equal(store.getState().revision, manifest.groups[0].revision + 1);
      assert.equal(store.getState().history.at(-1).type, 'catalogue-refresh');
      assert.equal((await store.listBackups()).length, manifest.groups[0].retainedSnapshots + 1);
    } finally { await store.close(); }
    assert.equal((await verifyFixture(output, profile, current)).datasetDigest, current.digest);
    const run = { fixtureDigest: copied.fixtureDigest, fixtureReuse: copied.fixtureReuse };
    await writeRunManifest(output, run);
    assert.deepEqual((await json(path.join(output, 'run-manifest.json'))).fixtureReuse.datasetTransition, transition);
    const summary = fixtureReuseMarkdown(run);
    for (const value of [previous.digest, current.digest, transition.applied]) assert(summary.includes(value));
    const repeated = await copyFixture(output, path.join(root, 'reused-again'), profile, current);
    assert.equal(repeated.fixtureReuse.datasetTransition.applied, 'none'); assert.equal(repeated.groups[0].revision, group.revision);
  });

  await t.test('old-field seals accept a proven old manifest without resealing the source', async () => {
    const legacy = path.join(root, 'old-seal'); await cp(source, legacy, { recursive: true, preserveTimestamps: true });
    const seal = await json(sealFile(legacy)); delete seal.fixtureContentVersion; delete seal.storageSchema; delete seal.sourceCommit;
    await writeFile(sealFile(legacy), JSON.stringify(seal));
    const before = await readFile(sealFile(legacy));
    assert.equal((await copyFixture(legacy, path.join(root, 'old-seal-copy'), profile, current)).datasetDigest, current.digest);
    assert.deepEqual(await readFile(sealFile(legacy)), before);
  });

  await t.test('an old seal without evidence proof and a changed input are both refused', async () => {
    const unknown = path.join(root, 'unknown'); await cp(source, unknown, { recursive: true, preserveTimestamps: true });
    const unproven = await json(path.join(unknown, 'fixture.json')); delete unproven.datasetEvidence;
    await writeFile(path.join(unknown, 'fixture.json'), JSON.stringify(unproven)); await rm(sealFile(unknown)); await sealFixture(unknown, unproven);
    await assert.rejects(copyFixture(unknown, path.join(root, 'unknown-copy'), profile, current), /cannot be proven evidence-only/);
    await assert.rejects(copyFixture(source, path.join(root, 'input-copy'), profile, syntheticDataset({ input: 'different data' })), /cannot be proven evidence-only/);
    const sealBefore = await readFile(sealFile(unknown));
    const proven = await copyFixture(unknown, path.join(root, 'externally-proven-copy'), profile, current,
      { evidenceRecords: [datasetEvidenceRecord(previous)] });
    assert.equal(proven.datasetDigest, current.digest);
    assert.deepEqual(await readFile(sealFile(unknown)), sealBefore);
  });

  await t.test('a sealed retained evidence history can prove an old stamp without a provenance field', async () => {
    const legacy = path.join(root, 'retained'); await cp(source, legacy, { recursive: true, preserveTimestamps: true });
    const old = await json(path.join(legacy, 'fixture.json')); delete old.datasetEvidence;
    await writeFile(path.join(legacy, 'fixture.json'), JSON.stringify(old));
    await writeFile(datasetEvidencePath(path.join(legacy, 'legacy')), JSON.stringify({ schemaVersion: 1, records: [datasetEvidenceRecord(previous)] }));
    await rm(sealFile(legacy)); await sealFixture(legacy, old);
    assert.equal((await copyFixture(legacy, path.join(root, 'retained-copy'), profile, current)).datasetDigest, current.digest);
  });

  assert.deepEqual(await fixtureInventory(source), sourceInventory);
  assert.deepEqual(await readFile(sealFile(source)), sourceSeal);
  assert.deepEqual(await Promise.all(sourceInventory.map(async row => digest(await readFile(path.join(source, row.path))))), sourceHashes);
  assert.equal((await verifyFixture(source, profile, previous)).datasetDigest, previous.digest);
});
