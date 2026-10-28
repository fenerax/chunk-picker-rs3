// Offline-source rehearsal only. Never controls systemd or an existing writer.
import path from 'node:path';
import net from 'node:net';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { assertReleased, copyTree, encode, noLinks, outside, sha } from './files.mjs';
import { readRelease, openApplication } from './runtime.mjs';
import { backupOnline, deployPrechecked, privateRequest } from './operator.mjs';
import { captureOnline } from './online.mjs';
import { verifyBackup } from './recovery.mjs';

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
export async function rehearse({ pointer, source, scratch, port, coreRoot }) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 8900 || port > 8998) throw new Error('Use two free scratch ports in 8900–8999.');
  scratch = path.resolve(scratch); source = path.resolve(source);
  outside(source, scratch); outside(scratch, source);
  await noLinks(source); await assertReleased(source);
  await freePort(port); await freePort(port + 1);
  const originalPointer = JSON.parse(await readFile(pointer, 'utf8'));
  const configBytes = await readFile(originalPointer.config.path);
  if (sha(configBytes) !== originalPointer.config.sha256) throw new Error('Source config pin mismatch.');
  const original = JSON.parse(configBytes);
  if (path.resolve(original.dataDir) === scratch || path.resolve(original.coreRoot) === scratch) throw new Error('Scratch overlaps source runtime.');
  await mkdir(scratch, { mode: 0o700 }); // must be a new, owned directory
  let app, downAt, downMs, heldMs;
  try {
    const dataDir = path.join(scratch, 'game');
    await copyTree(source, dataDir); await copyFile(source + '.dataset.json', dataDir + '.dataset.json', 1);
    const publicOriginFile = path.join(scratch, 'origin');
    await writeFile(publicOriginFile, 'https://picker.example');
    const config = { ...original, coreRoot: coreRoot ? path.resolve(coreRoot) : original.coreRoot,
      dataDir, host: '127.0.0.1', port, loopbackPort: port + 1, publicOriginFile };
    const configFile = path.join(scratch, 'config.json'), bytes = encode(config);
    await writeFile(configFile, bytes);
    const current = path.join(scratch, 'current.json');
    await writeFile(current, encode({ config: { path: configFile, sha256: sha(bytes) } }));
    const release = await readRelease(current, dataDir);
    process.env.RS3_SIGNIN = 'off';
    const start = async () => { app = await openApplication(config, dataDir); await app.ready; };
    const controller = {
      state: async () => ({ active: !!app, stopped: !app }),
      stop: async () => { downAt = performance.now(); await app?.close(); app = null; },
      start: async () => { await start(); downMs = performance.now() - downAt; },
    };
    const settings = { dataDir, current, scratchRoot: path.join(scratch, 'probes'), backupDir: path.join(scratch, 'backups'),
      controlDir: path.join(scratch, 'control'), minFreeBytes: 0, keep: 2 };
    await mkdir(settings.controlDir);
    await start();
    const capture = async args => { const result = await captureOnline(args); heldMs = Math.max(heldMs ?? 0, result.heldMs); return result; };
    const began = performance.now();
    const backup = await backupOnline({ settings, release, capture }); await verifyBackup(backup.target);
    const backupMs = performance.now() - began;
    await deployPrechecked({ settings, current: release, candidate: release, controller, capture, request: privateRequest });
    return { heldMs, writerDownMs: downMs, onlineBackupMs: backupMs, recoveryFormat: 'picker-recovery-v1' };
  } finally {
    await app?.close();
    // mkdir above proved this exact, task-owned directory did not pre-exist.
    await rm(scratch, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['pointer', 'source', 'scratch', 'port', 'core-root'].map(key => [key, { type: 'string' }])) });
    const result = await rehearse({ ...values, coreRoot: values['core-root'] });
    process.stdout.write(encode(result));
  } catch { process.stderr.write('Scratch rehearsal refused; inspect privately.\n'); process.exitCode = 1; }
}
