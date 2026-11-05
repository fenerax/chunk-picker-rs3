import { isMain } from '../release/vps/entrypoint.mjs';
import path from 'node:path';
import { chmod, link, lstat, open, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { directory, encode, exists, noLinks } from './files.mjs';

// Publication cannot truncate an existing value, even with empty/partial input.
export async function publishConfig(file, bytes) {
  JSON.parse(bytes); // Validate all input before touching its destination.
  await noLinks(path.dirname(file));
  if (await exists(file)) {
    await noLinks(file);
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1 || process.platform === 'linux' && info.uid !== process.getuid()
      || await readFile(file, 'utf8') !== bytes) throw Error('Existing configuration differs; reconcile explicitly.');
    await chmod(file, 0o644); return;
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', 0o644);
    try { await handle.writeFile(bytes); await handle.chmod(0o644); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, file); // Create-only even if another installer races.
  } finally { await rm(temporary, { force: true }); }
  if (process.platform !== 'win32') {
    const handle = await open(path.dirname(file), 'r'); try { await handle.sync(); } finally { await handle.close(); }
  }
}
export async function bootstrapAlerts({ alias, etc = '/etc/chunk-picker', monitorFile, offhostFile }) {
  if (process.platform !== 'linux' || process.getuid() !== 0 || !['picker-vps', 'picker-scratch'].includes(alias)) throw Error('Root installation and approved role required.');
  const monitor = await readFile(monitorFile, 'utf8'), offhost = await readFile(offhostFile, 'utf8');
  const m = JSON.parse(monitor), o = JSON.parse(offhost);
  if (!path.isAbsolute(m.controlDir ?? '') || !path.isAbsolute(m.diskPath ?? '') || o.controlDir !== m.controlDir
    || !/^b2:[a-z0-9][a-z0-9-]{5,49}:chunk-picker$/.test(o.repository ?? '')) throw Error('Configuration invalid.');
  // Rehearsal uses only scratch-alerts.mjs and its local repository. Cloud
  // setup/credential installers refuse this role regardless of destination.
  if (alias === 'picker-scratch') throw Error('Use the account-free scratch rehearsal.');
  await directory(etc);
  const info = await lstat(etc);
  if (info.uid !== 0 || info.mode & 0o022) throw Error('Unsafe configuration directory.');
  for (const [name, bytes] of [['monitor.json', monitor], ['offhost.json', offhost],
    ['deployment.json', encode({ format: 'picker-deployment-v1', role: 'production', alias })]]) {
    await publishConfig(path.join(etc, name), bytes);
  }
}
if (isMain(import.meta.url)) {
  try {
    const [alias, monitorFile, offhostFile, ...extra] = process.argv.slice(2); if (extra.length) throw Error();
    await bootstrapAlerts({ alias, monitorFile, offhostFile });
  } catch { process.stderr.write('Alert bootstrap refused; existing configuration retained.\n'); process.exitCode = 1; }
}
