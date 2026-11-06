import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { encode, sha } from '../scripts/linux/files.mjs';
import { checkStart } from '../scripts/linux/start-check.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../.local/operator-maintenance-tests/', import.meta.url));
const operatorUrl = new URL('../scripts/linux/operator.mjs', import.meta.url).href;
async function fixture(t) {
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(path.join(root, 'run-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const settings = { service: 'chunk-picker.service', dataDir: path.join(scratch, 'save'),
    controlDir: path.join(scratch, 'control'), current: path.join(scratch, 'current.json'),
    scratchRoot: path.join(scratch, 'scratch'), backupDir: path.join(scratch, 'backups'), minFreeBytes: 0 };
  const coreRoot = path.join(scratch, 'core');
  for (const directory of [settings.dataDir, settings.controlDir, settings.backupDir, coreRoot]) await mkdir(directory);
  const config = path.join(scratch, 'operator.json'), releaseConfig = path.join(scratch, 'release.json');
  await writeFile(config, encode(settings));
  const bytes = encode({ coreRoot, dataDir: settings.dataDir });
  await writeFile(releaseConfig, bytes);
  await writeFile(settings.current, encode({ config: { path: releaseConfig, sha256: sha(bytes) } }));
  await writeFile(path.join(scratch, 'backup-status.json'), encode({ lastSuccessAt: new Date().toISOString() }));
  return { scratch, settings, config };
}

// Run the real operator in an isolated process with synthetic systemctl only.
// The online capture fails on its absent credential before making any request.
async function run(f, command, stopped = false) {
  const source = `import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { promisify } from 'node:util';
    import { readFile } from 'node:fs/promises';
    const command = process.argv[2], stopped = process.argv[3] === 'true';
    const calls = [], maintenance = ${JSON.stringify(path.join(f.settings.controlDir, 'maintenance.json'))};
    let inactive = false;
    cp.execFile = () => { throw new Error('Unexpected callback command'); };
    cp.execFile[promisify.custom] = async (file, args) => {
      if (file !== 'systemctl') throw new Error('Unexpected external command');
      calls.push(args[0]);
      if (args[0] !== 'show') throw new Error('Synthetic service stop failure');
      return { stdout: inactive ? 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\nControlGroup=\\nTasksCurrent=0\\n'
        : 'ActiveState=active\\nSubState=running\\nMainPID=1\\nControlGroup=synthetic\\nTasksCurrent=1\\n', stderr: '' };
    };
    syncBuiltinESMExports();
    const { runOperator } = await import(${JSON.stringify(operatorUrl)});
    const invoke = async (...args) => {
      try { return { result: await runOperator(...args) }; }
      catch (error) { return { error: error.code, message: error.message }; }
    };
    const args = command === 'deploy' ? ['deploy', ${JSON.stringify(f.settings.current)}, undefined, '--stopped']
      : ['backup', stopped ? '--stopped' : undefined];
    const failure = await invoke(...args);
    const marker = await readFile(maintenance, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    });
    const retry = command === 'backup' && !stopped ? await invoke(...args) : null;
    inactive = true;
    const health = await invoke('health');
    console.log(JSON.stringify({ failure, marker, retry, health, calls }));`;
  const runner = path.join(f.scratch, 'operator-runner.mjs');
  await writeFile(runner, source);
  const { stdout, stderr } = await execute(process.execPath, [runner, command, String(stopped)], {
    env: { ...process.env, RS3_OPERATOR_CONFIG: f.config }, windowsHide: true, timeout: 15000,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

test('failed online backup clears maintenance, reports failure and permits another backup and health run', async t => {
  const f = await fixture(t), result = await run(f, 'backup');
  assert.equal(result.failure.error, 'ENOENT');
  assert.equal(result.marker, null);
  assert.equal(result.retry.error, 'ENOENT');
  assert.deepEqual(result.health, { result: { skipped: true } });
  assert.deepEqual(result.calls, ['show', 'show', 'show']);
  const status = JSON.parse(await readFile(path.join(f.scratch, 'backup-status.json')));
  assert.equal(status.result, 'failed');
  await assert.rejects(readFile(path.join(f.settings.controlDir, 'maintenance.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.settings.controlDir, 'operation.lock')), { code: 'ENOENT' });
  await checkStart(f.settings);
});

test('unwritable timing receipt location aborts deployment without stopping or leaving maintenance', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.settings.controlDir, 'phase-receipts'), 'synthetic obstruction');
  const result = await run(f, 'deploy');
  assert.equal(result.failure.error, 'PHASE_RECEIPT_UNWRITABLE');
  assert.equal(result.marker, null);
  assert.deepEqual(result.calls, ['show', 'show']);
  assert.deepEqual(result.health, { result: { skipped: true } });
  await assert.rejects(readFile(path.join(f.settings.controlDir, 'operation.lock')), { code: 'ENOENT' });
});

for (const command of ['deploy', 'backup']) {
  test(`failed ${command === 'backup' ? 'stopped backup' : 'deploy'} keeps maintenance evidence and blocks later health`, async t => {
    const f = await fixture(t), result = await run(f, command, true);
    assert.equal(result.failure.message, 'Service control refused; inspect the private system journal.');
    assert.equal(result.marker.command, command);
    assert.equal(result.health.error, 'OPERATOR_MAINTENANCE');
    assert.deepEqual(result.calls, ['show', 'stop']);
    assert.equal(JSON.parse(await readFile(path.join(f.settings.controlDir, 'maintenance.json'))).command, command);
    await assert.rejects(readFile(path.join(f.settings.controlDir, 'operation.lock')), { code: 'ENOENT' });
    await assert.rejects(checkStart(f.settings), { code: 'ENOENT' });
  });
}
