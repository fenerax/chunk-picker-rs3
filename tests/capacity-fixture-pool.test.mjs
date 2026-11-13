// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { buildGroups } from '../scripts/perf/capacity/fixture-pool.mjs';
import { planFixture } from '../scripts/perf/capacity/model.mjs';
import { prepareFixtureInputs } from '../scripts/perf/capacity/fixture-inputs.mjs';
import { fixtureMigration } from '../scripts/perf/capacity/fixture-migration.mjs';
import { prepareCapacityOwnedRelease } from '../scripts/perf/capacity/owned-release.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { readOwnedBase } from '../app/storage/owned-base.mjs';
import { acquireProcessGuard } from '../app/storage/process-guard.mjs';
import { Worker } from 'node:worker_threads';

const profile = { name: 'smoke', seed: 'synthetic-catalogue-overlap', port: 0, storageFormat: 'format2',
  catalogue: { chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1 },
  fixture: { groups: 6, rosterMix: [0, 1, 0, 0, 0], freshFraction: .5, unlockFraction: .5,
    historyEvents: 1, snapshots: 1, keysPerMember: 0 } };

test('format-2 fixture pool preserves content and drains workers before removing catalogues', async t => {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await mkdtemp(new URL('capacity-pool-test-', base));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { data, rules, migrationInputs } = await prepareFixtureInputs(profile);
  const { challenges, ...worldData } = data;
  const tasks = migrationInputs.catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const bytes = Buffer.from(JSON.stringify({ tasks, migrationInputs })), sharedTasks = new SharedArrayBuffer(bytes.length);
  Buffer.from(sharedTasks).set(bytes);
  const run = async (name, workers, failure, holdIdentities = false) => {
    const directory = path.join(root, name); await mkdir(directory);
    const ownedServing = await prepareCapacityOwnedRelease(directory, { dataset: selectedDataset, registry: rules,
      migrateState: fixtureMigration(migrationInputs, selectedDataset).migrateState });
    const jobs = planFixture(profile).map(item => ({ item, pickerId: `synthetic-${item.index}`,
      dataDir: path.join(directory, 'pickers', `synthetic-${item.index}`) }));
    const admitted = new Set(), barrier = Promise.withResolvers();
    const initializing = [], identityGuards = [];
    const release = failure === 'guard' ? await acquireProcessGuard(ownedServing.catalogueRoot) : undefined;
    const building = buildGroups(jobs, { workers, workerData: { profile, worldData, tasks: sharedTasks, ownedServing },
      ...(holdIdentities ? { workerFactory: workerData => {
        const worker = new Worker(new URL('./helpers/fixture-identity-bootstrap.mjs', import.meta.url), { workerData, execArgv: [] });
        worker.on('message', message => {
          if (message.type !== 'identity-preparing') return;
          initializing.push(worker); identityGuards.push(message.guards);
          // Force all preparations to overlap before letting any one finish.
          if (initializing.length === workers) for (const thread of initializing) thread.postMessage({ type: 'identity-continue' });
        });
        return worker;
      } } : {}),
      onProgress: async (value, slot) => {
        if (value.phase !== 'catalogue-admitted' || admitted.has(slot)) return;
        if (failure === 'progress') throw new Error('Synthetic fixture progress failure');
        admitted.add(slot);
        // All workers must hold their first real kernel-backed lease together.
        // Before isolation, the second admission fails while the first waits.
        if (admitted.size === workers) barrier.resolve();
        await barrier.promise;
      } });
    if (failure) {
      try { await assert.rejects(building, failure === 'guard' ? /data-directory lock/ : /Synthetic fixture progress failure/); }
      finally { await release?.(); }
      assert.deepEqual((await readdir(directory)).sort(), ['catalogue', 'pickers'], 'failure cleans worker catalogues too');
      await (await acquireProcessGuard(ownedServing.catalogueRoot))();
      return;
    }
    const results = await building;
    if (holdIdentities) assert.deepEqual(identityGuards, Array(workers).fill(0), 'all identity children finish before any worker takes a store/catalogue guard');
    assert.equal(admitted.size, workers);
    const pin = ownedServing.manifest.bases[selectedDataset.digest];
    await readOwnedBase(ownedServing.catalogueRoot, { datasetDigest: selectedDataset.digest, sha256: pin.sha256 }, ownedServing);
    for (const job of jobs) {
      const document = JSON.parse(await readFile(path.join(job.dataDir, 'state.json'), 'utf8'));
      assert.equal(document.storage.schemaVersion, 2);
      assert.deepEqual(document.storage.base, { datasetDigest: selectedDataset.digest, sha256: pin.sha256 });
    }
    assert.deepEqual((await readdir(directory)).sort(), ['catalogue', 'pickers'], 'no worker catalogues survive the build');
    return results.map(({ logicalStateDigest, revision, retainedSnapshots, retention }) => ({ logicalStateDigest, revision, retainedSnapshots, retention }));
  };
  // Exercise the pool on Windows too; the public generator's one-worker
  // Windows policy is unchanged. No server or fixed network port is needed.
  await t.test('three overlapping real catalogue leases preserve serial output', async () => {
    assert.deepEqual(await run('parallel', 3), await run('serial', 1));
  });
  await t.test('parallel workers prepare process identity before taking any guard', () => run('identity', 3, undefined, true));
  await t.test('observer failure drains real workers and removes their catalogues', () => run('failed', 3, 'progress'));
  await t.test('an occupied canonical guard still refuses the build', () => run('blocked', 3, 'guard'));
});
