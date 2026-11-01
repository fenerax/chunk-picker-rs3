import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, link } from 'node:fs/promises';
import { bindingPath, bindDatasetStorage } from '../app/dataset-binding.mjs';
import { encode, inventory, json, sha } from '../scripts/linux/files.mjs';
import { compatibilityReports } from './helpers/release-compatibility.mjs';
import { operatorSettings, readRelease } from '../scripts/linux/runtime.mjs';
import { backupStopped, checkStoppedCompatibility, restoreStopped, storeIdentity, verifyBackup, writeBackupStatus } from '../scripts/linux/recovery.mjs';

// Synthetic trees only. The probe seam exercises recovery without a calculator.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'linux-recovery-paths-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'save'), core = path.join(root, 'core');
  await mkdir(dataDir); await mkdir(core);
  await writeFile(path.join(core, 'release.txt'), 'synthetic release\n');
  await mkdir(path.join(dataDir, 'empty'));
  await writeFile(path.join(dataDir, 'state.json'), encode({ format: 'rs3-chunk-picker', state: { members: [{ id: 'synthetic' }] } }));
  await writeFile(path.join(dataDir, 'opaque.bin'), Buffer.from([0, 255, 128, 10]));
  await bindDatasetStorage(dataDir, { datasetId: 'synthetic', datasetContractVersion: 1, digest: 'a'.repeat(64) });
  const config = path.join(root, 'config.json'), pointer = path.join(root, 'pointer.json');
  const bytes = encode({ coreRoot: core, dataDir });
  await writeFile(config, bytes);
  await writeFile(pointer, encode({ config: { path: config, sha256: sha(bytes) } }));
  const release = await readRelease(pointer, dataDir);
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'sentinel.bin'), Buffer.from([11, 0, 255]));
  const settings = { dataDir, backupDir: path.join(root, 'backups'), scratchRoot: path.join(root, 'scratch'), minFreeBytes: 0, release,
    probe: async (_release, dir, output) => { const bytes = await readFile(path.join(dir, 'state.json')); await writeFile(output, bytes); return JSON.parse(bytes); } };
  const source = await storeIdentity(dataDir), sentinel = await inventory(outside);
  const unchanged = async backup => {
    assert.deepEqual(await storeIdentity(dataDir), source);
    assert.deepEqual(await inventory(outside), sentinel);
    if (backup) assert.deepEqual(await inventory(backup.target), backup.files);
  };
  const backup = async () => {
    const result = await backupStopped(settings);
    return { ...result, files: await inventory(result.target) };
  };
  return { root, settings, source, unchanged, backup };
}

const spellings = { canonical: dir => dir, separator: dir => dir + path.sep, dot: dir => dir + path.sep + '.' };
for (const [name, spell] of Object.entries(spellings)) {
  test(`operator settings normalize ${name} data paths accepted by release checks`, async t => {
    const f = await fixture(t), { settings } = f;
    const file = path.join(f.root, 'operator.json');
    const config = { ...settings, dataDir: spell(settings.dataDir), current: path.join(f.root, 'pointer.json'),
      controlDir: path.join(f.root, 'control'), service: 'chunk-picker.service' };
    await writeFile(file, encode(config));
    const previous = process.env.RS3_OPERATOR_CONFIG;
    t.after(() => { if (previous === undefined) delete process.env.RS3_OPERATOR_CONFIG; else process.env.RS3_OPERATOR_CONFIG = previous; });
    process.env.RS3_OPERATOR_CONFIG = file;
    assert.equal((await operatorSettings()).dataDir, settings.dataDir);
    assert.equal((await readRelease(config.current, spell(settings.dataDir))).identity, settings.release.identity);
    assert.equal((await json(file)).dataDir, spell(settings.dataDir));
    await f.unchanged();
  });

  test(`stopped backup accepts ${name} directory spellings and preserves source bytes`, async t => {
    const f = await fixture(t), settings = f.settings;
    const result = await backupStopped({ ...settings, dataDir: spell(settings.dataDir), backupDir: spell(settings.backupDir), scratchRoot: spell(settings.scratchRoot) });
    await verifyBackup(spell(result.target));
    assert.deepEqual(await inventory(path.join(result.target, 'store')), f.source.files);
    assert.deepEqual(await readFile(path.join(result.target, 'store.dataset.json')), await readFile(bindingPath(settings.dataDir)));
    await f.unchanged();
  });

  for (const exists of [false, true]) {
    test(`restore to ${exists ? 'empty' : 'absent'} ${name} target installs the canonical sibling binding`, async t => {
      const f = await fixture(t), backup = await f.backup(), target = path.join(f.root, 'target');
      if (exists) await mkdir(target);
      assert.deepEqual(await restoreStopped({ ...f.settings, backup: spell(backup.target), dataDir: spell(target), scratchRoot: spell(f.settings.scratchRoot) }), { verified: true });
      assert.deepEqual(await inventory(target), f.source.files);
      assert.deepEqual(await readFile(bindingPath(target)), await readFile(bindingPath(f.settings.dataDir)));
      await f.unchanged(backup);
    });

    test(`bound ${exists ? 'empty' : 'absent'} ${name} target refuses before probes or copies`, async t => {
      const f = await fixture(t), backup = await f.backup(), target = path.join(f.root, 'target');
      if (exists) await mkdir(target);
      const binding = Buffer.from('existing canonical binding\n');
      await writeFile(bindingPath(target), binding);
      let probes = 0;
      await assert.rejects(restoreStopped({ ...f.settings, backup: backup.target, dataDir: spell(target), probe: async () => { probes++; } }), /existing binding/);
      assert.equal(probes, 0);
      if (exists) assert.deepEqual(await readdir(target), []);
      else await assert.rejects(readFile(target), { code: 'ENOENT' });
      assert.deepEqual(await readFile(bindingPath(target)), binding);
      await f.unchanged(backup);
    });
  }

  test(`exclusive binding install refuses a late canonical binding for ${name} target`, async t => {
    const f = await fixture(t), backup = await f.backup(), target = path.join(f.root, 'target');
    await mkdir(target);
    const binding = Buffer.from('late canonical binding\n');
    await assert.rejects(restoreStopped({ ...f.settings, backup: backup.target, dataDir: spell(target), probe: async (...args) => {
      await f.settings.probe(...args); await writeFile(bindingPath(target), binding, { flag: 'wx' });
    } }), { code: 'EEXIST' });
    assert.deepEqual(await readdir(target), []);
    assert.deepEqual(await readFile(bindingPath(target)), binding);
    await f.unchanged(backup);
  });

  test(`stopped compatibility and status use canonical sidecars for ${name} spelling`, async t => {
    const f = await fixture(t), { settings } = f;
    let probes = 0, stopped = 0;
    const result = await checkStoppedCompatibility({ ...settings, dataDir: spell(settings.dataDir), current: settings.release, candidate: settings.release,
      assertStopped: async () => { stopped++; }, probe: async () => { probes++; return structuredClone(compatibilityReports().before); } });
    assert.equal(result.steps, 4); assert.equal(probes, 4); assert.equal(stopped, 2);
    await writeBackupStatus(spell(settings.dataDir), { result: 'success', byteSize: 123, at: '2026-10-27T04:00:00.000Z' });
    await writeBackupStatus(spell(settings.dataDir), { result: 'failed', at: '2026-10-28T04:00:00.000Z' });
    const status = await json(path.join(f.root, 'backup-status.json'));
    assert.equal(status.result, 'failed'); assert.equal(status.lastSuccessAt, '2026-10-27T04:00:00.000Z');
    await f.unchanged();
  });

  for (const kind of ['directory symlink', 'binding symlink', 'binding hardlink']) {
    test(`backup refuses ${kind} with ${name} spelling`, async t => {
      const f = await fixture(t), dir = f.settings.dataDir;
      if (kind === 'directory symlink') {
        const alias = path.join(f.root, 'alias'); await symlink(dir, alias);
        await assert.rejects(backupStopped({ ...f.settings, dataDir: spell(alias) }), /Linked paths/);
      } else {
        const binding = bindingPath(dir), retained = path.join(f.root, 'retained-binding');
        await writeFile(retained, await readFile(binding)); await rm(binding);
        await (kind === 'binding symlink' ? symlink : link)(retained, binding);
        await assert.rejects(backupStopped({ ...f.settings, dataDir: spell(dir) }), /Linked paths/);
        await rm(binding); await writeFile(binding, await readFile(retained));
      }
      await f.unchanged();
    });
  }

  test(`restore refuses a linked ${name} target without touching outside bytes`, async t => {
    const f = await fixture(t), backup = await f.backup(), target = path.join(f.root, 'target');
    await symlink(path.join(f.root, 'outside'), target);
    await assert.rejects(restoreStopped({ ...f.settings, backup: backup.target, dataDir: spell(target) }), /Linked paths/);
    await f.unchanged(backup);
  });
}
