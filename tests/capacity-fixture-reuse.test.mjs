// @test full shared dataset=open-f2p
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rm, cp, utimes, symlink } from 'node:fs/promises';
import * as cache from '../scripts/perf/capacity/fixture-cache.mjs';
import { generate } from '../scripts/perf/capacity/fixture.mjs';
import { catalogue, digest } from '../scripts/perf/capacity/model.mjs';
import { selectedDataset } from '../app/dataset-runtime.mjs';
import { servingServer, servingRequest } from './helpers/owned-serving-fixture.mjs';

const profile = { name: 'smoke', seed: 'synthetic-reuse-contract', port: 0,
  catalogue: { chunks: 4, tasks: 4, dependencyDepth: 2, crossLinks: 1, aliases: 100, stateBytes: 300000 },
  fixture: { groups: 2, rosterMix: [0, 1, 0, 0, 0], freshFraction: .5, unlockFraction: .5,
    historyEvents: 2, snapshots: 1, keysPerMember: 1 } };
const sealFile = directory => path.join(directory, 'fixture-complete.json');
const json = async filename => JSON.parse(await readFile(filename, 'utf8'));
async function editSeal(directory, change) {
  const seal = await json(sealFile(directory)); change(seal);
  await writeFile(sealFile(directory), JSON.stringify(seal));
}
// Model a self-consistently sealed older writer, rather than a checksum error.
async function editFile(directory, relative, change) {
  const filename = path.join(directory, relative), value = await json(filename); change(value);
  const bytes = Buffer.from(JSON.stringify(value)); await writeFile(filename, bytes);
  await editSeal(directory, seal => {
    const entry = seal.files.find(entry => entry.path === relative);
    entry.bytes = bytes.length; entry.digest = digest(bytes);
    seal.inventoryDigest = digest(seal.files);
  });
  const entry = (await json(sealFile(directory))).files.find(entry => entry.path === relative);
  await utimes(filename, new Date(entry.modifiedMs), new Date(entry.modifiedMs));
}
const oldFields = ['schemaVersion', 'complete', 'storageFormat', 'ownedBasePin', 'configDigest',
  'fixtureDigest', 'implementationDigest', 'files', 'inventoryDigest'];

test('sealed fixture reuse compatibility and source isolation', async t => {
  const base = new URL('../.local/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await mkdtemp(new URL('capacity-reuse-test-', base));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = new Map();
  for (const storageFormat of ['format1', 'format2']) {
    const directory = path.join(root, storageFormat); await mkdir(directory);
    const shape = { ...profile, storageFormat };
    const manifest = await generate(shape, directory, { workers: 1, sourceCommit: 'synthetic-fixture-source' });
    fixtures.set(storageFormat, { directory, profile: shape, manifest });
  }
  let next = 0;
  const clone = async (format = 'format1') => {
    const fixture = fixtures.get(format), directory = path.join(root, `case-${++next}`);
    await cp(fixture.directory, directory, { recursive: true, preserveTimestamps: true });
    return { ...fixture, directory };
  };

  for (const format of ['format1', 'format2']) await t.test(`${format} tiny generated output is pinned to the fixture content version`, async () => {
    // Advance the version and add a new golden when builder semantics change.
    // Retain version 1: old seals without a content version mean version 1.
    const golden = { 1: {
      format1: '0f1f9260b897485a8b65df0eac7449359e0242d490dcf7fd4753c6b9a77d9886',
      format2: '6ddc4a47e758dc6720ac705089591f2482097faf2108f170e8d8f6656caeb88f',
    } };
    const { manifest } = fixtures.get(format);
    const storageSchemas = [];
    for (const group of manifest.groups) {
      const document = await json(path.join(fixtures.get(format).directory, 'pickers', group.pickerId, 'state.json'));
      storageSchemas.push({ envelope: document.schemaVersion, state: document.state.schemaVersion, storage: document.storage?.schemaVersion });
      assert.equal(document.storage?.schemaVersion, format === 'format1' ? 1 : 2, 'exercise the physical static/owned writer');
    }
    const output = digest({ fixtureDigest: manifest.fixtureDigest, characters: manifest.characters,
      logins: manifest.logins, keys: manifest.keys, taskIds: manifest.groups.map(group => group.taskIds), storageSchemas });
    assert.equal(output, golden[cache.fixtureContentVersion ?? 1]?.[format], format);
  });

  for (const format of ['format1', 'format2']) {
    await t.test(`${format} accepts old-field seals across implementations without resealing`, async () => {
      const f = await clone(format);
      await editSeal(f.directory, seal => {
        for (const key of Object.keys(seal)) if (!oldFields.includes(key)) delete seal[key];
        seal.implementationDigest = digest('synthetic-older-implementation');
      });
      const before = await readFile(sealFile(f.directory));
      assert.deepEqual(Object.keys(await json(sealFile(f.directory))).sort(), oldFields.filter(key => key !== 'ownedBasePin' || format === 'format2').sort());
      assert.equal((await cache.verifyFixture(f.directory, f.profile, selectedDataset.digest)).fixtureDigest, f.manifest.fixtureDigest);
      const copied = await cache.copyFixture(f.directory, path.join(root, `run-${++next}`), f.profile, selectedDataset.digest);
      assert.equal(copied.fixtureDigest, f.manifest.fixtureDigest);
      assert.equal(copied.fixtureReuse.reused, true);
      assert.equal(copied.fixtureReuse.acrossVersions, true);
      assert.equal(copied.fixtureReuse.fixtureImplementationDigest, digest('synthetic-older-implementation'));
      assert.equal(copied.fixtureReuse.currentImplementationDigest, await cache.fixtureImplementationDigest());
      assert.equal(copied.fixtureReuse.sourceCommit, null, 'original field set has no recorded source commit');
      assert.deepEqual(await readFile(sealFile(f.directory)), before);
    });
  }

  await t.test('exact reuse reports both implementation digests and recorded source commit', async () => {
    const f = await clone(), copied = await cache.copyFixture(f.directory, path.join(root, `run-${++next}`), f.profile, selectedDataset.digest);
    const seal = await json(sealFile(f.directory));
    assert.equal(seal.fixtureContentVersion, cache.fixtureContentVersion);
    assert.ok(seal.storageSchema);
    assert.equal(copied.fixtureReuse.acrossVersions, false);
    assert.equal(copied.fixtureReuse.fixtureImplementationDigest, seal.implementationDigest);
    assert.equal(copied.fixtureReuse.currentImplementationDigest, seal.implementationDigest);
    assert.equal(copied.fixtureReuse.sourceCommit, 'synthetic-fixture-source');
  });

  await t.test('old seals can retain their source commit in the original run manifest', async () => {
    const f = await clone();
    await editSeal(f.directory, seal => { delete seal.sourceCommit; });
    await writeFile(path.join(f.directory, 'run-manifest.json'), JSON.stringify({ sourceCommit: 'synthetic-legacy-source' }));
    const copied = await cache.copyFixture(f.directory, path.join(root, `run-${++next}`), f.profile, selectedDataset.digest);
    assert.equal(copied.fixtureReuse.sourceCommit, 'synthetic-legacy-source');
  });

  await t.test('a reused copy reports its original builder, not the code that copied it', async () => {
    for (const [original, expected] of [['synthetic-legacy-source', 'synthetic-legacy-source'], [null, null]]) {
      const f = await clone();
      await editSeal(f.directory, seal => { delete seal.sourceCommit; });
      await writeFile(path.join(f.directory, 'run-manifest.json'), JSON.stringify({ sourceCommit: 'synthetic-copier-source',
        fixtureReuse: { reused: true, acrossVersions: true, sourceCommit: original } }));
      const copied = await cache.copyFixture(f.directory, path.join(root, `run-${++next}`), f.profile, selectedDataset.digest);
      assert.equal(copied.fixtureReuse.sourceCommit, expected);
    }
  });

  const sealCases = [
    ['incomplete seal', seal => { seal.complete = false; }, /completion|configuration/],
    ['seal schema', seal => { seal.schemaVersion = 0; }, /completion|configuration/],
    ['format label', seal => { seal.storageFormat = 'format2'; }, /configuration|format/],
    ['inventory checksum', seal => { seal.inventoryDigest = digest('wrong'); }, /digest mismatch/],
    ['logical checksum', seal => { seal.fixtureDigest = digest('wrong'); }, /logical digest/],
    ['builder output version', seal => { seal.fixtureContentVersion = 0; }, /content.*version/],
    ['null builder output version', seal => { seal.fixtureContentVersion = null; }, /content.*version/],
    ['writer storage schema', seal => { seal.storageSchema = { state: 0 }; }, /storage schema/],
    ['null writer storage schema', seal => { seal.storageSchema = null; }, /storage schema/],
  ];
  for (const [name, change, error] of sealCases) await t.test(`rejects changed ${name}`, async () => {
    const f = await clone(); await editSeal(f.directory, change);
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), error);
    await assert.rejects(cache.copyFixture(f.directory, path.join(root, `rejected-${++next}`), f.profile, selectedDataset.digest), error);
  });

  await t.test('rejects a logical state mismatch even when cached digest fields agree', async () => {
    const f = await clone();
    await editFile(f.directory, 'fixture.json', manifest => { manifest.groups[0].logicalStateDigest = digest('wrong-logical-state'); });
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), /logical digest mismatch/);
    await assert.rejects(cache.copyFixture(f.directory, path.join(root, `rejected-${++next}`), f.profile, selectedDataset.digest), /logical digest mismatch/);
  });

  await t.test('rejects fixture content configuration and dataset changes', async () => {
    const f = fixtures.get('format1');
    for (const changed of [{ ...f.profile, seed: 'synthetic-other' },
      { ...f.profile, fixture: { ...f.profile.fixture, historyEvents: 3 } },
      { ...f.profile, entityCaps: { accounts: 3 } }]) {
      await assert.rejects(cache.verifyFixture(f.directory, changed, selectedDataset.digest), /configuration.*digest mismatch/);
    }
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, digest('other-dataset')), /configuration.*digest mismatch/);
  });

  await t.test('rejects added files and changed mtimes', async () => {
    const f = await clone();
    await writeFile(path.join(f.directory, 'registry', 'extra.json'), '{}');
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), /inventory mismatch/);
    const g = await clone(), entry = (await json(sealFile(g.directory))).files[0];
    await utimes(path.join(g.directory, entry.path), new Date(0), new Date(0));
    await assert.rejects(cache.verifyFixture(g.directory, g.profile, selectedDataset.digest), /inventory mismatch/);
  });

  await t.test('rejects a changed file even when size and mtime match', async () => {
    const f = await clone(), entry = (await json(sealFile(f.directory))).files.find(entry => entry.path.startsWith('registry/'));
    const filename = path.join(f.directory, entry.path), bytes = await readFile(filename); bytes[0] ^= 1;
    await writeFile(filename, bytes); await utimes(filename, new Date(entry.modifiedMs), new Date(entry.modifiedMs));
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), /file digest mismatch/);
    await assert.rejects(cache.copyFixture(f.directory, path.join(root, `rejected-${++next}`), f.profile, selectedDataset.digest), /copy digest mismatch/);
  });

  for (const [name, change, error] of [
    ['physical format', doc => { doc.storage = { schemaVersion: 2 }; }, /physical storage format mismatch/],
    ['state schema', doc => { doc.state.schemaVersion = 0; }, /storage schema/],
    ['envelope schema', doc => { doc.schemaVersion = 0; }, /storage schema/],
  ]) await t.test(`rejects self-consistent old seal with changed ${name}`, async () => {
    const f = await clone();
    await editSeal(f.directory, seal => { for (const key of Object.keys(seal)) if (!oldFields.includes(key)) delete seal[key]; });
    await editFile(f.directory, `pickers/${f.manifest.groups[0].pickerId}/state.json`, change);
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), error);
    await assert.rejects(cache.copyFixture(f.directory, path.join(root, `rejected-${++next}`), f.profile, selectedDataset.digest), error);
  });

  await t.test('rejects physical group pin changes', async () => {
    const f = await clone('format2');
    await editFile(f.directory, `pickers/${f.manifest.groups[0].pickerId}/state.json`, doc => { doc.storage.base.sha256 = digest('wrong-base'); });
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), /owned base pin mismatch/);
  });

  await t.test('rejects an internally matching base pin that differs from the current runtime', async () => {
    const f = await clone('format2'), sha256 = digest('synthetic-old-runtime-base');
    for (const group of f.manifest.groups) await editFile(f.directory, `pickers/${group.pickerId}/state.json`, doc => { doc.storage.base.sha256 = sha256; });
    await editFile(f.directory, 'fixture.json', manifest => { manifest.ownedBasePin.sha256 = sha256; });
    await editSeal(f.directory, seal => { seal.ownedBasePin.sha256 = sha256; });
    await assert.rejects(cache.verifyFixture(f.directory, f.profile, selectedDataset.digest), /current.*owned base|owned.*runtime/i);
    await assert.rejects(cache.copyFixture(f.directory, path.join(root, `rejected-${++next}`), f.profile, selectedDataset.digest), /current.*owned base|owned.*runtime/i);
  });

  await t.test('copy rejects overlapping destinations, including a directory alias', async () => {
    const f = await clone(), alias = path.join(root, `alias-${++next}`);
    await symlink(f.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    t.after(() => rm(alias, { force: true }));
    for (const destination of [f.directory, path.join(f.directory, 'nested'), path.join(f.directory, '..-nested'), path.dirname(f.directory), path.join(alias, 'nested')]) {
      await assert.rejects(cache.copyFixture(f.directory, destination, f.profile, selectedDataset.digest), /outside|overlap/);
    }
  });

  await t.test('real measured-store writes change only the copied fixture and never reseal the source', async () => {
    const f = fixtures.get('format2'), sourceSeal = await readFile(sealFile(f.directory)), inventory = await cache.fixtureInventory(f.directory);
    const sourceProgress = await readFile(path.join(f.directory, 'fixture-progress.json'));
    const directory = path.join(root, `measured-copy-${++next}`);
    const manifest = await cache.copyFixture(f.directory, directory, f.profile, selectedDataset.digest);
    assert.deepEqual(await cache.fixtureInventory(directory), inventory, 'copy preserves every modifiedMs');
    const before = await readFile(path.join(directory, 'pickers', manifest.groups[0].pickerId, 'state.json'));
    const app = await servingServer({ ...f, directory, manifest });
    try {
      await app.listen();
      const state = await servingRequest(app, manifest.groups[0], '/api/state'); assert.equal(state.status, 200);
      const edit = await servingRequest(app, manifest.groups[0], '/api/command', { expectedRevision: state.value.state.revision,
        command: { type: 'set-note', memberId: 'owner', chunkId: Object.keys(catalogue(profile.catalogue).chunks)[0], note: 'Synthetic measured edit' } });
      assert.equal(edit.status, 200);
    } finally { await app.close(); }
    assert.notDeepEqual(await readFile(path.join(directory, 'pickers', manifest.groups[0].pickerId, 'state.json')), before);
    assert.deepEqual(await readFile(sealFile(f.directory)), sourceSeal);
    assert.deepEqual(await readFile(path.join(f.directory, 'fixture-progress.json')), sourceProgress);
    assert.deepEqual(await cache.fixtureInventory(f.directory), inventory);
    await cache.verifyFixture(f.directory, f.profile, selectedDataset.digest);
  });
});
