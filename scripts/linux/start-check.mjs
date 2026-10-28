// Root ExecStartPre gate. An interrupted transaction must not be bypassed by
// boot startup or an unrelated systemctl start.
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exists, json, sha } from './files.mjs';
import { operatorSettings } from './runtime.mjs';

export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid operator owner.');
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  // comm can contain spaces/parentheses; field 22 follows the final closing paren.
  const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  if (!/^\d+$/.test(start ?? '')) throw new Error('Unverifiable operator owner.');
  return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() + ':' + start;
}
export async function checkStart(settings, { identity = processIdentity, now = Date.now() } = {}) {
  const control = settings.controlDir, permitFile = path.join(control, 'start-permit.json');
  const evidence = ['operation.lock', 'maintenance.json', 'activation.json'];
  if (!(await Promise.all(evidence.map(name => exists(path.join(control, name))))).some(Boolean)) {
    await rm(permitFile, { force: true }); return;
  }
  const permit = await json(permitFile);
  await rm(permitFile); // One attempt only, including refused starts.
  const lock = await readFile(path.join(control, 'operation.lock'));
  const owner = JSON.parse(lock);
  if (!Number.isSafeInteger(permit.expiresAt) || permit.expiresAt < now || permit.expiresAt > now + 30000
    || sha(lock) !== permit.lockSha256 || sha(await readFile(settings.current)) !== permit.pointerSha256
    || await identity(owner.pid) !== permit.processIdentity) throw new Error('Service start is blocked by transaction evidence.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkStart(await operatorSettings()); }
  catch { process.stderr.write('Service start blocked; reconcile maintenance evidence privately.\n'); process.exitCode = 1; }
}
