// Trusted PC only. The delete-capable key is read from 1Password into memory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { run, sshAlias } from './setup-common.mjs';
import { retentionArgs, verifyRestic } from '../linux/restic.mjs';
export async function pruneB2({ alias, vault, item, binary }, { execute = run, verify = verifyRestic,
  repositoryRun = (file, args, env) => execFileSync(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    encoding: 'utf8', maxBuffer: 4 * 1024 ** 2, timeout: 60 * 60000 }) } = {}) {
  sshAlias(alias); await verify(binary);
  const metadata = execute('ssh', [alias, 'sudo -n env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /usr/bin/node /opt/chunk-picker/tools/scripts/linux/offhost-backup.mjs paused']);
  if (JSON.parse(metadata).paused !== true) throw Error('Pause and drain the uploader first.');
  const recovery = JSON.parse(execute('op', ['item', 'get', item, '--vault', vault, '--format=json', '--reveal']));
  const value = name => recovery.fields?.find(field => field.label === name)?.value;
  if (!/^b2:[a-z0-9][a-z0-9-]{5,49}:chunk-picker$/.test(value('repository') ?? '')
    || !value('repository-password') || !value('cleanup-id') || !value('cleanup-key')) throw Error('Recovery item incomplete.');
  const env = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}), TZ: 'UTC', RESTIC_REPOSITORY: value('repository'),
    RESTIC_PASSWORD: value('repository-password'), B2_ACCOUNT_ID: value('cleanup-id'), B2_ACCOUNT_KEY: value('cleanup-key') };
  for (const args of [['check'], [...retentionArgs], ['check']]) repositoryRun(binary, ['--no-lock', '--no-cache', ...args], env);
  return { pruned: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['ssh', 'vault', 'item', 'restic'].map(name => [name, { type: 'string' }])) });
    await pruneB2({ alias: values.ssh, vault: values.vault, item: values.item, binary: values.restic });
    process.stdout.write('Retention applied and repository checked; resume the uploader and verify a new delivery.\n');
  } catch { process.stderr.write('Trusted cleanup refused; leave restore points and inspect privately.\n'); process.exitCode = 1; }
}
