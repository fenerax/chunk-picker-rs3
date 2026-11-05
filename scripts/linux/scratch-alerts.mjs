// Disposable Linux scratch only. No B2/Discord/Healthchecks account access.
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyRestic, retentionArgs } from './restic.mjs';
import { offhostBackup, selectSnapshot } from './offhost-backup.mjs';
import { monitor } from './monitor.mjs';
import { notify } from './notify.mjs';
import { verifyBackup } from './recovery.mjs';
import { encode, json, inventory } from './files.mjs';
import { operatorSettings } from './runtime.mjs';
const execute = promisify(execFile);
export async function scratchAlerts(settings, staging) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !/^\/var\/tmp\/chunk-tools-scratch-[a-f0-9-]{36}$/.test(staging)) throw Error('Disposable scratch required.');
  await verifyRestic();
  const local = path.join(staging, 'local-restic'); await mkdir(local, { mode: 0o700 });
  const password = path.join(local, 'password'); await writeFile(password, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
  const env = { PATH: '/usr/bin:/bin', TZ: 'UTC', HOME: '/root', RESTIC_REPOSITORY: path.join(local, 'repository'), RESTIC_PASSWORD_FILE: password, RESTIC_CACHE_DIR: path.join(local, 'cache') };
  const run = async args => (await execute('/usr/local/bin/restic', ['--no-lock', ...args], { env, maxBuffer: 4 * 1024 ** 2, timeout: 120000 })).stdout;
  await run(['init']);
  await offhostBackup({ settings, config: {}, run, ping: async () => false });
  const selected = await selectSnapshot(settings.backupDir), restored = path.join(local, 'restore');
  await run(['restore', 'latest', '--target', restored]);
  await verifyBackup(path.join(restored, selected.backup.slice(1)));
  await run([...retentionArgs]); await run(['check', '--read-data']);
  // Verify the complete rebuild payload too, including synthetic /etc secrets.
  const snapshots = JSON.parse(await run(['snapshots', '--json']));
  const rebuildPath = snapshots[0].paths.find(file => path.basename(file) === 'rebuild');
  const rebuild = path.join(restored, rebuildPath.slice(1)), manifest = await json(path.join(rebuild, 'rebuild-manifest.json'));
  if (encode((await inventory(rebuild)).filter(row => row.path !== 'rebuild-manifest.json')) !== encode(manifest.files)) throw Error('Rebuild roundtrip differs.');
  let received = 0;
  const server = http.createServer((request, response) => {
    let bytes = ''; request.on('data', chunk => { bytes += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(bytes);
      if (!payload.content.startsWith('Chunk picker\n') || bytes.includes(password)) { response.writeHead(400); response.end(); return; }
      received++; response.writeHead(204); response.end();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8971, '127.0.0.1', resolve); });
  try {
    const send = async content => {
      const response = await fetch('http://127.0.0.1:8971/', { method: 'POST', body: JSON.stringify({ content }), signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error('Local notification rejected.');
    };
    const now = Date.now();
    await notify({ controlDir: settings.controlDir, faults: { test: 'critical' }, now, send });
    const observed = await monitor({ controlDir: settings.controlDir, diskPath: settings.backupDir }, { now: now + 31000, send });
    if (observed.faults['writer-inactive'] || observed.faults['offhost-source'] || !received) throw Error('Scratch alerts failed.');
    return { restored: true, retentionChecked: true, notificationsReceived: received };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await scratchAlerts(await operatorSettings(), process.argv[2]); process.stdout.write('Local encrypted backup and alert rehearsal passed.\n'); }
  catch { process.stderr.write('Local rehearsal failed; retain scratch evidence.\n'); process.exitCode = 1; }
}
