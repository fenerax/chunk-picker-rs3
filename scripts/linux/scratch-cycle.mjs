import { isMain } from '../release/vps/entrypoint.mjs';
// Invoked only by scratch-rehearsal after its fresh-machine guards. This file
// has no save/credential/host argument and cannot adopt an existing install.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, chown, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode, json, sha } from './files.mjs';
import { buildTools } from './tools-package.mjs';
import { switchTools } from './tools-install.mjs';
import { prepareBundle } from '../release/vps/bundle.mjs';
import { readRelease, assertServiceAccess } from './runtime.mjs';
import { lockRelease } from '../release/vps/bundle.mjs';
import { scratchAlerts } from './scratch-alerts.mjs';
import { privateRequest } from './operator.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 600000 });
export async function scratchCycle(staging) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !/^\/var\/tmp\/chunk-tools-scratch-[a-f0-9-]{36}$/.test(staging)) throw Error('Scratch environment required.');
  const base = '/opt/chunk-picker', source = path.join(base, 'source'), toolsRoot = path.join(base, 'tools');
  // The unit is installed later; resolve the already provisioned account here.
  const uid = Number(run('id', ['-u', 'chunk-picker']).trim()), gid = Number(run('id', ['-g', 'chunk-picker']).trim());
  if (![uid, gid].every(id => Number.isSafeInteger(id) && id > 0)) throw Error('Dedicated service identity required.');
  const account = { uid, gid };
  // Exclusive creation is the final guard. Never rerun on an adopted service.
  await mkdir(path.join(base, 'releases'), { mode: 0o755 });
  await chown(path.join(base, 'releases'), 0, gid); await chmod(path.join(base, 'releases'), 0o750);
  const dataDir = '/var/lib/chunk-picker/game', controlDir = '/var/lib/chunk-picker/control';
  await mkdir('/etc/chunk-picker/secrets', { mode: 0o700 });
  await writeFile('/etc/chunk-picker/deployment.json', encode({ format: 'picker-deployment-v1', role: 'rehearsal', alias: 'picker-scratch' }), { mode: 0o644, flag: 'wx' });
  for (const name of ['health-ping', 'backup-ping', 'offhost-ping', 'discord-webhook', 'b2-account', 'b2-key', 'restic-password']) await writeFile('/etc/chunk-picker/secrets/' + name, randomBytes(32).toString('base64url'), { mode: 0o600 });
  await writeFile('/etc/chunk-picker/monitor.json', encode({ controlDir, diskPath: '/var/backups/chunk-picker' }), { mode: 0o644 });
  await mkdir('/var/lib/chunk-picker', { mode: 0o755 });
  await mkdir(dataDir, { mode: 0o700 }); await mkdir(controlDir, { mode: 0o700 });
  for (const [dir, mode] of [['/var/lib/chunk-picker', 0o755], [dataDir, 0o700], [controlDir, 0o700]]) await chmod(dir, mode);
  await chown(dataDir, uid, gid);
  // The service can publish snapshots without owning the control directory's
  // parent. Root-owned ancestors also permit privilege-dropped prewarming.
  await mkdir(dataDir + '.snapshots', { mode: 0o700 }); await chown(dataDir + '.snapshots', uid, gid);
  await chmod(dataDir + '.snapshots', 0o700);
  process.env.RS3_DATASET = 'open-starter'; process.env.RS3_SIGNIN = 'off';
  for (const key of Object.keys(process.env)) if (/^RS3_/.test(key) && !['RS3_DATASET', 'RS3_SIGNIN'].includes(key)) delete process.env[key];
  const { createGroupState, exportBackup } = await import('../../app/core/state.mjs');
  const { resolveDataset } = await import('../../app/datasets.mjs');
  const { bindDatasetStorage } = await import('../../app/dataset-binding.mjs');
  await writeFile(path.join(dataDir, 'state.json'), encode(exportBackup(createGroupState([{ id: 'one', name: 'Explorer 1' }, { id: 'two', name: 'Explorer 2' }]))), { mode: 0o600 });
  await writeFile(path.join(dataDir, 'access-token'), randomBytes(32).toString('base64url') + '\n', { mode: 0o600 });
  await bindDatasetStorage(dataDir, await resolveDataset({ datasetId: 'open-starter' }));
  for (const name of await readdir(dataDir)) await chown(path.join(dataDir, name), uid, gid);
  await chown(dataDir + '.dataset.json', uid, gid);
  const origin = '/etc/chunk-picker/origin'; await writeFile(origin, 'https://127.0.0.1\n', { mode: 0o644 });
  const seed = path.join(base, 'releases', 'synthetic-seed'); await mkdir(seed, { mode: 0o755 });
  await cp(source, path.join(seed, 'core'), { recursive: true });
  await mkdir(path.join(seed, 'packs')); await mkdir(path.join(seed, 'addons'));
  await writeFile(path.join(seed, 'profile.json'), '{}\n');
  const config = { coreRoot: path.join(seed, 'core'), dataDir, datasetId: 'open-starter', packs: {},
    host: '127.0.0.1', port: 8952, loopbackPort: 8953, publicOriginFile: origin, nodePath: '/opt/node/bin/node', runtimeOptions: {} };
  const configFile = path.join(seed, 'config.json'), configBytes = encode(config);
  await writeFile(configFile, configBytes, { mode: 0o644 });
  const pointerBytes = encode({ config: { path: configFile, sha256: sha(configBytes) } });
  await lockRelease(seed, gid);
  await assertServiceAccess(seed, account, ['core/app/server.mjs']);
  const settings = { current: '/var/lib/chunk-picker/current.json', dataDir, controlDir,
    backupDir: '/var/backups/chunk-picker', scratchRoot: '/var/lib/chunk-picker/scratch', service: 'chunk-picker.service', minFreeBytes: 0, keep: 2 };
  await writeFile(settings.current, pointerBytes, { mode: 0o644 });
  await writeFile('/etc/chunk-picker/operator.json', encode(settings), { mode: 0o644 });
  process.env.RS3_OPERATOR_CONFIG = '/etc/chunk-picker/operator.json';
  await writeFile('/etc/chunk-picker/runtime.env', 'RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json\nRS3_SIGNIN=off\n', { mode: 0o644 });
  for (const file of [origin, settings.current, '/etc/chunk-picker/operator.json', '/etc/chunk-picker/runtime.env']) await chmod(file, 0o644);
  await mkdir(toolsRoot, { mode: 0o755 }); // empty legacy layout exercises exchange
  await chmod(toolsRoot, 0o755);
  const packageRoot = path.join(staging, 'package');
  const manifest = await buildTools(source, packageRoot);
  // Use the installed operator path even on the initial synthetic machine.
  for (const name of await readdir(path.join(source, 'scripts/linux/systemd'))) {
    await cp(path.join(source, 'scripts/linux/systemd', name), path.join('/etc/systemd/system', name));
    await chmod(path.join('/etc/systemd/system', name), 0o644);
  }
  await mkdir('/etc/systemd/system/chunk-picker-offhost.service.d');
  await writeFile('/etc/systemd/system/chunk-picker-offhost.service.d/local.conf', '[Service]\nLoadCredential=\nExecStart=\nExecStart=/usr/bin/true\n');
  run('systemctl', ['daemon-reload']);
  const installed = await switchTools({ settings, toolsRoot, packageRoot });
  run('systemctl', ['start', settings.service]);
  const current = await readRelease(settings.current, dataDir);
  for (let n = 0; ; n++) {
    const health = await privateRequest(current, '/api/health').catch(() => ({}));
    if (health.ready && health.savesReady) break;
    if (n === 60) throw Error('Synthetic readiness timed out.'); await delay(1000);
  }
  const upload = path.join(staging, 'upload'), target = path.join(base, 'releases', 'synthetic-candidate');
  // The transport/stage implementation is the normal release flow. There is no
  // pack/profile/private input because open-starter is wholly synthetic.
  await prepareBundle(seed, upload);
  run('/opt/node/bin/node', [path.join(toolsRoot, 'scripts/release/vps/bundle.mjs'), 'rebase', upload, target, '/etc/chunk-picker/operator.json', toolsRoot]);
  const installedRun = (...args) => run('/opt/node/bin/node', [path.join(toolsRoot, 'scripts/linux/operator.mjs'), ...args]);
  installedRun('backup');
  const pointer = path.join(target, 'pointer.json'), receiptFile = path.join(upload, 'verified.json');
  const review = (...args) => JSON.parse(run('/opt/node/bin/node', [path.join(toolsRoot, 'scripts/release/vps/review.mjs'), pointer, receiptFile, '/etc/chunk-picker/operator.json', ...args]));
  const derived = review(); review(derived.digest);
  // Rehearse from the synthetic backup, with the helper's isolated controller.
  const { newestVerifiedBackup } = await import(pathToFileURL(path.join(toolsRoot, 'scripts/release/vps/review.mjs')));
  const backup = await newestVerifiedBackup(settings.backupDir);
  const rehearsal = JSON.parse(run('/opt/node/bin/node', [path.join(toolsRoot, 'scripts/linux/rehearse.mjs'),
    '--pointer', pointer, '--source', path.join(backup.backup, 'store'), '--scratch', path.join(staging, 'rehearsal'), '--port', '8963']));
  installedRun('health'); installedRun('deploy', pointer, receiptFile);
  const selected = await readRelease(settings.current, dataDir), health = await privateRequest(selected, '/api/health');
  if (!health.ready || !health.savesReady || sha(await readFile(settings.current)) !== sha(await readFile(pointer))) throw Error('Synthetic activation verification failed.');
  installedRun('backup');
  const alerts = await scratchAlerts(settings, staging);
  const receipts = [];
  for (const name of await readdir(path.join(controlDir, 'phase-receipts'))) {
    const receipt = await json(path.join(controlDir, 'phase-receipts', name));
    receipts.push(receipt);
  }
  const activation = receipts.filter(row => row.operation === 'activate').at(-1);
  if (!activation?.stoppedToReadyMs || activation.result !== 'success') throw Error('Missing activation phases.');
  run('systemctl', ['enable', '--now', 'chunk-picker-backup.timer', 'chunk-picker-health.timer']);
  return { format: 'picker-synthetic-rehearsal-v1', node: process.versions.node, toolsFiles: manifest.files.length,
    toolsIdentity: manifest.toolsIdentity, writerRestartedForInstall: installed.writerRestarted,
    stoppedToReadyMs: activation.stoppedToReadyMs, rehearsal, alerts, phases: receipts };
}
if (isMain(import.meta.url)) {
  try { process.stdout.write(encode(await scratchCycle(process.argv[2]))); }
  catch { process.stderr.write('Synthetic cycle failed; retain scratch evidence.\n'); process.exitCode = 1; }
}
