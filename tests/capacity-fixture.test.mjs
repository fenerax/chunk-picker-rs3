// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../scripts/perf/capacity/fixture.mjs';
import { verifyFixture, copyFixture, logicalFixtureDigest } from '../scripts/perf/capacity/fixture-cache.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { createServer } from '../app/server.mjs';
import { createGroupState } from '../app/core/state.mjs';
import { createTaskEngine } from '../app/tasks/engine.mjs';
import { buildWorld } from '../app/data/world.mjs';
import { catalogue, syntheticWorld } from '../scripts/perf/capacity/model.mjs';
import { fixtureDataset } from './helpers/server-dataset.mjs';
import { loadCapacityOwnedRelease } from '../scripts/perf/capacity/owned-release.mjs';
import { verifyOwnedBaseBytes } from '../app/storage/owned-base.mjs';

const profile = { name: 'smoke', seed: 'synthetic-pool-42', port: 0,
  catalogue: { chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1 },
  fixture: { groups: 3, rosterMix: [0, 1, 0, 0, 0], freshFraction: 1 / 3, unlockFraction: .5, historyEvents: 2, snapshots: 1, keysPerMember: 1 } };
// Stability retains stdout/stderr on failure, including a killed file. Native
// case completion alone cannot locate a wait in a case or its after hook.
let currentStep = 'starting cases';
const scratchRoots = new Set();
// One file-level diagnostic, below CI's existing 15-minute outer deadline.
// It neither cancels work nor keeps an otherwise finished process alive. Read
// synchronously so a blocked libuv pool cannot also swallow the last receipt.
setTimeout(() => {
  console.error(`[capacity-fixture] file still running: ${currentStep}`);
  console.error(`[capacity-fixture] active resources: ${process.getActiveResourcesInfo().join(', ')}`);
  for (const root of scratchRoots) {
    let directories;
    try {
      directories = [root, ...readdirSync(root, { withFileTypes: true }).filter(row => row.isDirectory())
        .map(row => path.join(root, row.name))];
    } catch (error) {
      console.error(`[capacity-fixture] scratch unreadable (${error.code})`);
      continue;
    }
    for (const directory of directories) {
      try {
        const progress = readFileSync(path.join(directory, 'fixture-progress.json'), 'utf8');
        console.error(`[capacity-fixture] ${path.relative(root, directory) || '.'} progress: ${progress}`);
      } catch (error) { if (error.code !== 'ENOENT') console.error(`[capacity-fixture] progress unreadable (${error.code})`); }
    }
  }
}, 480_000).unref();
test.after(() => {
  currentStep = 'all cases and cleanup completed; waiting for process exit';
  console.error(`[capacity-fixture] ${currentStep}`);
});
async function step(t, label, work) {
  currentStep = `${t.name}: ${label}`;
  console.error(`[capacity-fixture] ${t.name}: start ${label}`);
  try {
    const value = await work();
    console.error(`[capacity-fixture] ${t.name}: done ${label}`);
    return value;
  } catch (error) {
    console.error(`[capacity-fixture] ${t.name}: failed ${label} (${error.name})`);
    throw error;
  }
}
async function scratch(t, close = async () => {}) {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(new URL('capacity-fixture-test-', base));
  assert.equal(path.dirname(directory), path.resolve(fileURLToPath(base)));
  scratchRoots.add(directory);
  t.after(async () => {
    await step(t, 'close application', close);
    await step(t, 'remove scratch', () => rm(directory, { recursive: true, force: true }));
    scratchRoots.delete(directory);
  });
  return directory;
}

test('sustained-smoke builds and seals a format-2 fixture without alias calibration', async t => {
  const directory = await scratch(t);
  const smoke = { ...JSON.parse(await readFile(new URL('../scripts/perf/capacity/profiles/sustained-smoke.json', import.meta.url))),
    storageFormat: 'format2', port: 0 };
  assert.equal(smoke.catalogue.aliases, undefined);
  const manifest = await step(t, 'generate format2 smoke', () => generate(smoke, directory, { workers: 1 }));
  assert.equal(manifest.storageFormat, 'format2');
  assert.equal(manifest.groups.length, smoke.fixture.groups);
  assert.deepEqual(manifest.groups.map(group => group.grown), [false, true]);
  const release = await loadCapacityOwnedRelease(directory);
  const base = verifyOwnedBaseBytes(release.releaseBytes, release);
  assert.equal(base.tasks.length, smoke.catalogue.tasks);
  assert.equal(base.identityRegistry.schemaVersion, 1);
  assert.deepEqual(base.identityRegistry.unresolved, []);
  for (const task of base.tasks) assert.ok(base.identityRegistry.entries[task.id]);
  for (const group of manifest.groups) {
    const document = JSON.parse(await readFile(path.join(directory, 'pickers', group.pickerId, 'state.json'), 'utf8'));
    assert.equal(document.storage.schemaVersion, 2);
    assert.deepEqual(document.storage.base, { datasetDigest: manifest.ownedBasePin.dataset.digest, sha256: manifest.ownedBasePin.sha256 });
  }
  assert.equal((await step(t, 'verify format2 smoke', () => verifyFixture(directory, smoke, selectedDataset.digest))).fixtureDigest, manifest.fixtureDigest);
});

test('a sealed serial fixture reuses exact bytes and refuses mutations, mismatches and incomplete inputs', async t => {
  const directory = await scratch(t), source = path.join(directory, 'source'), copy = path.join(directory, 'copy');
  await mkdir(source); await mkdir(copy);
  const manifest = await step(t, 'generate source', () => generate(profile, source, { workers: 1 }));
  assert.equal(manifest.fixtureDigest, logicalFixtureDigest(manifest));
  assert.equal((await step(t, 'verify source', () => verifyFixture(source, profile, selectedDataset.digest))).fixtureDigest, manifest.fixtureDigest);
  const progress = JSON.parse(await readFile(path.join(source, 'fixture-progress.json'), 'utf8'));
  assert.equal(progress.groups, 3); assert.equal(progress.builtGroups, 3); assert.deepEqual(progress.active, []);
  // Stage/traffic/name changes do not change stored fixture requirements.
  const reused = await step(t, 'copy source', () => copyFixture(source, copy,
    { ...profile, name: 'step-up', stages: [{ seconds: 1 }] }, selectedDataset.digest));
  assert.equal(reused.fixtureDigest, manifest.fixtureDigest);
  await step(t, 'verify copy', () => verifyFixture(copy, profile, selectedDataset.digest));
  const copiedManifest = JSON.parse(await readFile(path.join(copy, 'fixture.json'), 'utf8'));
  const sourceManifest = JSON.parse(await readFile(path.join(source, 'fixture.json'), 'utf8'));
  const withoutNormalization = ({ retentionNormalization, groups, ...value }) => ({ ...value,
    groups: groups.map(({ retentionNormalization, ...group }) => group) });
  assert.deepEqual(withoutNormalization(copiedManifest), withoutNormalization(sourceManifest));
  assert.equal(copiedManifest.retentionNormalization.candidatesAfter, 0);
  assert.equal(sourceManifest.retentionNormalization.at, manifest.retentionNormalization.at);
  await step(t, 'reject source as destination', () => assert.rejects(copyFixture(source, source, profile, selectedDataset.digest), /outside/));
  await step(t, 'reject mismatched seed', () => assert.rejects(verifyFixture(source,
    { ...profile, seed: 'synthetic-other' }, selectedDataset.digest), /digest mismatch/));
  const incomplete = path.join(directory, 'incomplete'); await mkdir(incomplete);
  await step(t, 'reject incomplete source', () => assert.rejects(copyFixture(incomplete,
    path.join(directory, 'unused'), profile, selectedDataset.digest), /ENOENT/));
  const file = path.join(source, 'pickers', manifest.groups[0].pickerId, 'state.json');
  const before = await readFile(file), timestamp = (await stat(file)).mtime;
  const changed = Buffer.from(before); changed[changed.length - 1] ^= 1;
  await writeFile(file, changed);
  await utimes(file, timestamp, timestamp);
  await step(t, 'reject mutated source', () => assert.rejects(verifyFixture(source, profile, selectedDataset.digest), /file digest mismatch/));
  await step(t, 'reject mutated copy', () => assert.rejects(copyFixture(source,
    path.join(directory, 'bad-copy'), profile, selectedDataset.digest), /copy digest mismatch/));
  await assert.rejects(readFile(path.join(directory, 'bad-copy', 'fixture-complete.json')), /ENOENT/);
});

test('a worker failure propagates and cannot publish fixture completion', async t => {
  const directory = await scratch(t);
  await step(t, 'reject failed generation', () => assert.rejects(generate({ ...profile,
    fixture: { ...profile.fixture, unlockFraction: NaN } }, directory, { workers: 1 }), /timestamp|time/i));
  await assert.rejects(readFile(path.join(directory, 'fixture-complete.json')), /ENOENT/);
});

test('one and three real fixture workers produce the same tiny logical fixture digest in both formats',
  { skip: process.platform === 'win32' ? 'Windows generation is deliberately limited to one worker; real parallel proof runs on Linux CI.' : false }, async t => {
    const directory = await scratch(t);
    for (const storageFormat of ['format1', 'format2']) {
      const serial = path.join(directory, `${storageFormat}-serial`), parallel = path.join(directory, `${storageFormat}-parallel`);
      await mkdir(serial); await mkdir(parallel);
      const shape = { ...profile, storageFormat };
      const one = await step(t, `generate ${storageFormat} serial`, () => generate(shape, serial, { workers: 1 }));
      const many = await step(t, `generate ${storageFormat} parallel`, () => generate(shape, parallel, { workers: 3 }));
      assert.equal(one.fixtureDigest, many.fixtureDigest);
      assert.deepEqual(one.groups.map(group => group.logicalStateDigest), many.groups.map(group => group.logicalStateDigest));
      assert.equal(one.keys, many.keys); assert.equal(one.characters, many.characters);
      await step(t, `verify ${storageFormat} parallel`, () => verifyFixture(parallel, shape, selectedDataset.digest));
    }
  });

test('Why needs a calculated task row; a stale revision still receives a genuine unexpected 409', async t => {
  let app;
  const directory = await scratch(t, () => app?.close()), definitions = catalogue(profile.catalogue);
  const tasks = createTaskEngine(definitions).catalogue.map(({ id, label, category }) => ({ id, label, category }));
  const initialState = createGroupState([{ id: 'owner', name: 'Synthetic owner', unlocked: Object.keys(definitions.chunks).slice(0, 2) }]);
  initialState.tasks = tasks;
  app = await step(t, 'create application', () => createServer({ dataDir: path.join(directory, 'why'), dataset: fixtureDataset, definitions,
    world: syntheticWorld(definitions, buildWorld), initialState, port: 0, predictionPrewarm: false }));
  await step(t, 'listen', () => app.listen());
  const origin = `http://127.0.0.1:${app.address().port}`, headers = { Authorization: `Bearer ${app.store.getAccessToken()}` };
  const get = route => step(t, `GET ${route}`, async () => {
    const response = await fetch(origin + route, { headers });
    return { status: response.status, value: await response.json() };
  });
  const revision = app.store.getInfo().revision;
  const why = (id, at = revision) => `/api/task-why?view=display-v1&memberId=owner&taskId=${encodeURIComponent(id)}&revision=${at}`;
  const before = await get(why(tasks[0].id));
  assert.equal(before.status, 409); assert.equal(before.value.code, 'TASK_WHY_UNAVAILABLE');
  assert.equal(app.store.getInfo().revision, revision, 'the original failure needs no concurrent writer');
  const list = await get('/api/tasks?memberId=owner&view=play-v1');
  assert.equal(list.status, 200); assert.ok(list.value.tasks.length);
  assert.equal((await get(why(list.value.tasks[0].id, list.value.stateRevision))).status, 200);
  await step(t, 'commit concurrent edit', () => app.store.command({ type: 'set-note', memberId: 'owner',
    chunkId: Object.keys(definitions.chunks)[0], note: 'Synthetic concurrent edit' }, revision));
  const raced = await get(why(list.value.tasks[0].id, list.value.stateRevision));
  assert.equal(raced.status, 409); assert.notEqual(raced.value.code, 'TASK_WHY_UNAVAILABLE');
});
