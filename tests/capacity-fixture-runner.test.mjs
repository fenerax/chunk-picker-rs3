// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixtureInventory } from '../scripts/perf/capacity/fixture-cache.mjs';
import { digest } from '../scripts/perf/capacity/model.mjs';

const execute = promisify(execFile), json = async filename => JSON.parse(await readFile(filename, 'utf8'));
const runner = fileURLToPath(new URL('../scripts/perf/capacity/run.mjs', import.meta.url));

test('fixture-only CLI carries old-seal reuse provenance through IPC and protects its source', async t => {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await mkdtemp(new URL('capacity-fixture-runner-', base));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = { ...await json(new URL('../scripts/perf/capacity/profiles/smoke.json', import.meta.url)),
    seed: 'synthetic-runner-reuse', port: 0,
    catalogue: { chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1, aliases: 100 },
    fixture: { groups: 2, rosterMix: [0, 1, 0, 0, 0], freshFraction: .5, unlockFraction: .5,
      historyEvents: 1, snapshots: 1, keysPerMember: 1 } };
  const profileFile = path.join(root, 'profile.json'); await writeFile(profileFile, JSON.stringify(profile));
  const source = path.join(root, 'source'), output = path.join(root, 'output'), evidence = path.join(root, 'evidence');
  const run = (destination, reuse = false) => execute(process.execPath, [runner, '--profile', profileFile, '--format', 'format2',
    '--fixture-workers', '1', '--fixture-only', '--output', destination, ...(reuse ? ['--residency', 'trial', '--fixture-from', source, '--fixture-evidence-from', evidence] : [])],
  { windowsHide: true, maxBuffer: 1024 * 1024 });
  // This prepares tiny data only. No measured server or arrival driver runs.
  await run(source);
  const sourceFixture = await json(path.join(source, 'fixture.json'));
  assert.ok(sourceFixture.datasetEvidence);
  await mkdir(evidence); const evidenceFile = path.join(evidence, 'dataset-evidence.json');
  const evidenceBytes = JSON.stringify({ schemaVersion: 1, records: [sourceFixture.datasetEvidence] });
  await writeFile(evidenceFile, evidenceBytes);
  const originalRun = await json(path.join(source, 'run-manifest.json'));
  const sealPath = path.join(source, 'fixture-complete.json'), seal = await json(sealPath);
  for (const key of ['fixtureContentVersion', 'storageSchema', 'sourceCommit']) delete seal[key];
  seal.implementationDigest = digest('synthetic-previous-runtime');
  await writeFile(sealPath, JSON.stringify(seal));
  const sourceSeal = await readFile(sealPath), sourceManifest = await readFile(path.join(source, 'run-manifest.json'));
  const sourceProgress = await readFile(path.join(source, 'fixture-progress.json')), inventory = await fixtureInventory(source);
  await run(output, true);
  const reused = await json(path.join(output, 'run-manifest.json'));
  const datasetDigest = (await json(path.join(source, 'fixture.json'))).datasetDigest;
  assert.equal(reused.fixtureDigest, seal.fixtureDigest);
  assert.deepEqual(reused.fixtureReuse, { reused: true, acrossVersions: true,
    fixtureImplementationDigest: seal.implementationDigest,
    currentImplementationDigest: originalRun.fixtureReuse.currentImplementationDigest, sourceCommit: originalRun.sourceCommit,
    datasetTransition: { oldDigest: datasetDigest, newDigest: datasetDigest, applied: 'none', refreshedPickers: 0 } });
  assert.deepEqual((await json(path.join(output, 'setup-summary.json'))).fixtureReuse, reused.fixtureReuse);
  assert.equal(reused.memoryProfile, null, 'fixture-only setup makes no measured-memory claim');
  assert.equal(originalRun.requestedResidency, 'default');
  assert.equal(reused.requestedResidency, 'trial'); assert.equal(reused.residency, null, 'fixture-only setup makes no residency claim');
  assert.deepEqual(await fixtureInventory(source), inventory);
  assert.deepEqual(await readFile(sealPath), sourceSeal);
  assert.deepEqual(await readFile(path.join(source, 'run-manifest.json')), sourceManifest);
  assert.deepEqual(await readFile(path.join(source, 'fixture-progress.json')), sourceProgress);
  assert.equal(await readFile(evidenceFile, 'utf8'), evidenceBytes);
  await assert.rejects(readFile(path.join(output, 'results.json')), { code: 'ENOENT' });
  const nested = path.join(source, '..-nested-output');
  await assert.rejects(run(nested, true), /outside|overlap/);
  await assert.rejects(readFile(path.join(nested, 'profile.json')), { code: 'ENOENT' });
});
