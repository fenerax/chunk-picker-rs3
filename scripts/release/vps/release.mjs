import path from 'node:path';
import { access, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareBundle } from './bundle.mjs';
import { verify } from '../pc/quick-build.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit', windowsHide: true });
export async function releaseVps(command, values, execute = run) {
  if (command === 'prepare') {
    if (values['go-live']) throw new Error('Prepare cannot activate. Use stage or activate explicitly.');
    await verify({ repo: values.repo, releaseDir: values['release-dir'] });
    await prepareBundle(values['release-dir'], values.out);
    await copyFile(new URL('./bundle.mjs', import.meta.url), path.join(values.out, 'bundle.mjs'), 1);
    return;
  }
  if (!['stage', 'derive', 'activate'].includes(command)) throw new Error('Use prepare, stage, derive or activate.');
  if (command === 'activate' && !values['go-live']) throw new Error('Activation requires explicit --go-live.');
  const host = values.host;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host ?? '')) throw new Error('Use a configured SSH alias.');
  for (const key of ['upload', 'target', 'operator-config', 'tools-root', 'node']) {
    if (!/^\/[A-Za-z0-9_./-]+$/.test(values[key] ?? '') || values[key].split('/').includes('..')) throw new Error('Use explicit safe absolute Linux paths.');
  }
  if (values.upload === values.target || values.target.startsWith(values.upload + '/') || values.upload.startsWith(values.target + '/')) throw new Error('Upload and release paths must be separate.');
  // Dedicated new directory: no overwrite of another upload or installed files.
  if (command === 'stage') {
    execute('ssh', [host, 'umask 077; mkdir ' + quote(values.upload)]);
    for (const name of ['release.tar', 'source-config.json', 'release-manifest.json', 'transfer.json', 'bundle.mjs']) {
      await access(path.join(values.out, name));
      execute('scp', [path.join(values.out, name), host + ':' + values.upload + '/' + name]);
    }
    const rebase = [values.node, path.posix.join(values.upload, 'bundle.mjs'), 'rebase', values.upload, values.target, values['operator-config'], values['tools-root']];
    execute('ssh', [host, 'sudo -- ' + rebase.map(quote).join(' ')]);
  }
  if (command === 'derive') {
    if (values['go-live']) throw new Error('Review cannot activate.');
    if (values['accept-additions'] !== undefined && !/^[a-f0-9]{64}$/.test(values['accept-additions'])) throw new Error('Use the reviewed additions digest.');
    const review = [values.node, path.posix.join(values['tools-root'], 'scripts/release/vps/review.mjs'),
      path.posix.join(values.target, 'pointer.json'), path.posix.join(values.upload, 'verified.json'), values['operator-config'],
      ...(values['accept-additions'] === undefined ? [] : [values['accept-additions']])];
    execute('ssh', [host, 'sudo -- ' + review.map(quote).join(' ')]);
    return;
  }
  if (values['go-live']) {
    // Re-check the exact previous pointer and candidate identity under the
    // operator exclusion. No stale staged candidate can silently replace it.
    execute('ssh', [host, 'sudo -- env ' + quote('RS3_OPERATOR_CONFIG=' + values['operator-config']) + ' '
      + [values.node, path.posix.join(values['tools-root'], 'scripts/linux/operator.mjs'), 'deploy', path.posix.join(values.target, 'pointer.json'), path.posix.join(values.upload, 'verified.json')].map(quote).join(' ')]);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
      ['repo', 'release-dir', 'out', 'host', 'upload', 'target', 'operator-config', 'tools-root', 'node', 'accept-additions'].map(key => [key, { type: 'string' }]).concat([['go-live', { type: 'boolean', default: false }]])) });
    await releaseVps(positionals[0], values);
    if (positionals[0] !== 'derive') process.stdout.write(values['go-live'] ? 'VPS deployment completed.\n' : 'Release prepared/staged; activation requires explicit --go-live.\n');
  } catch { process.stderr.write('VPS release refused; no automatic activation fallback.\n'); process.exitCode = 1; }
}
