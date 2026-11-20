import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { backupRetention, assertOperatorService, operatorSettings, readRelease, openApplication } from '../scripts/linux/runtime.mjs';
import { sha, encode } from '../scripts/linux/files.mjs';
import { backupDeletionDisclosure } from '../app/storage/tombstones.mjs';

test('backup retention validates bounded integer milliseconds and exact operator/release agreement', () => {
  for (const value of [null, 0, -1, 1.5, '1000', Infinity, NaN, Number.MAX_SAFE_INTEGER, 10 * 366 * 86400000 + 1]) {
    assert.throws(() => backupRetention({ backupRetentionMs: value }), /backupRetentionMs/);
    assert.throws(() => assertOperatorService({ backupRetentionMs: value }, { config: {} }), /backupRetentionMs/);
  }
  for (const value of [undefined, 1, 2592000000, 10 * 366 * 86400000]) {
    assert.equal(backupRetention({ backupRetentionMs: value }), value);
    assert.doesNotThrow(() => assertOperatorService({ backupRetentionMs: value }, { config: { backupRetentionMs: value } }));
  }
  for (const [operator, release] of [[1, 2], [undefined, 1], [1, undefined]])
    assert.throws(() => assertOperatorService({ backupRetentionMs: operator }, { config: { backupRetentionMs: release } }), /retention differ/);
  const roots = { registryDir: 'registry', pickerRoot: 'pickers', tombstoneDir: 'ledger' };
  assert.throws(() => assertOperatorService({ multiPicker: roots }, { config: { multiPicker: { ...roots, pickerRoot: 'other' } } }), /roots differ/);
});

test('release and operator readers validate retention; live and probe application options forward it', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'linux-runtime-config-'));
  const environment = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
    await rm(root, { recursive: true });
  });
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app/server.mjs'), 'export const createServer = options => options; export const startServer = options => options;\n');
  const originFile = path.join(root, 'origin'); await writeFile(originFile, 'https://picker.example');
  const configFile = path.join(root, 'release.json'), pointerFile = path.join(root, 'current.json'), operatorFile = path.join(root, 'operator.json');
  const config = { coreRoot: root, dataDir: path.join(root, 'data'), host: '127.0.0.1', port: 0, loopbackPort: 1, publicOriginFile: originFile };
  const settings = { service: 'chunk-picker.service', current: pointerFile, dataDir: config.dataDir,
    controlDir: path.join(root, 'control'), scratchRoot: path.join(root, 'scratch'), backupDir: path.join(root, 'backups') };
  for (const value of [undefined, 2592000000, null, 0, '1000']) {
    const releaseConfig = { ...config, backupRetentionMs: value }, bytes = encode(releaseConfig);
    await writeFile(configFile, bytes); await writeFile(pointerFile, encode({ config: { path: configFile, sha256: sha(bytes) } }));
    await writeFile(operatorFile, encode({ ...settings, backupRetentionMs: value }));
    process.env.RS3_OPERATOR_CONFIG = operatorFile;
    if (value !== undefined && typeof value !== 'number' || value === 0) {
      await assert.rejects(readRelease(pointerFile, config.dataDir), /backupRetentionMs/);
      await assert.rejects(operatorSettings(), /backupRetentionMs/);
      await assert.rejects(openApplication(releaseConfig, config.dataDir), /backupRetentionMs/);
      continue;
    }
    assert.equal((await readRelease(pointerFile, config.dataDir)).config.backupRetentionMs, value);
    assert.equal((await operatorSettings()).backupRetentionMs, value);
    for (const probe of [false, true]) {
      const options = await openApplication(releaseConfig, config.dataDir, { probe });
      assert.equal(options.backupRetentionMs, value);
      const disclosure = backupDeletionDisclosure(options.backupRetentionMs);
      assert.equal(disclosure.retentionMs, value ?? null);
      assert.equal(disclosure.message.includes('expire'), value !== undefined);
      if (value === undefined) assert.match(disclosure.message, /not configured/);
      else assert(disclosure.message.includes(String(value)));
    }
  }
});
