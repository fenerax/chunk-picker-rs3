// Run on a disposable recovery machine with independently recovered credentials.
import path from 'node:path';
import { isMain } from '../release/vps/entrypoint.mjs';
import { guardedRestic, verifyRestic } from './restic.mjs';

export async function restoreOffhost({ snapshot, target, scratchRoot, reserve, env = process.env }) {
  if (process.platform !== 'linux' || !snapshot || !path.isAbsolute(target ?? '')
    || !path.isAbsolute(scratchRoot ?? '') || !Number.isSafeInteger(reserve) || reserve < 0) throw Error('Recovery arguments required.');
  const binary = '/usr/local/bin/restic'; await verifyRestic(binary);
  return guardedRestic({ root: scratchRoot, reserve, binary, args: ['restore', snapshot, '--target', target],
    env: { PATH: '/usr/bin:/bin', HOME: env.HOME, TZ: 'UTC', RESTIC_REPOSITORY: env.RESTIC_REPOSITORY,
      RESTIC_PASSWORD_FILE: env.RESTIC_PASSWORD_FILE, B2_ACCOUNT_ID: env.B2_ACCOUNT_ID, B2_ACCOUNT_KEY: env.B2_ACCOUNT_KEY } });
}
if (isMain(import.meta.url)) {
  try {
    const [snapshot, target, scratchRoot, reserve, ...extra] = process.argv.slice(2);
    if (extra.length || !/^\d+$/.test(reserve ?? '')) throw Error();
    await restoreOffhost({ snapshot, target, scratchRoot, reserve: Number(reserve) });
    process.stdout.write('Snapshot restored; verify manifests before installing.\n');
  } catch { process.stderr.write('Restore failed; preserve the partial destination for inspection.\n'); process.exitCode = 1; }
}
