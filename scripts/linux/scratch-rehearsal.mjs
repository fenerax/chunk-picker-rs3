// Run locally: exports committed public code and provisions ONLY a fresh host.
// No live-save input exists. All subprocess output is captured, never echoed.
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const execute = (file, args, input) => execFileSync(file, args, { input, encoding: 'utf8', windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 ** 2, timeout: 1800000 });
const normalize = address => address.replace(/^::ffff:/, '').toLowerCase();
export async function scratchHostGuard(alias, { run = execute, resolve = lookup } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(alias ?? '') || ['picker-vps', 'chunkpicker.ca'].includes(alias.toLowerCase())) throw Error('Scratch target refused.');
  const production = new Set((await resolve('chunkpicker.ca', { all: true })).map(row => normalize(row.address)));
  if (!production.size) throw Error('Scratch target cannot be verified.');
  const config = run('ssh', ['-G', alias]);
  const host = /^hostname (.+)$/m.exec(config)?.[1];
  if (!host || host.toLowerCase() === 'chunkpicker.ca') throw Error('Scratch target refused.');
  const targets = await resolve(host, { all: true });
  if (!targets.length || targets.some(row => production.has(normalize(row.address)))) throw Error('Scratch target refused.');
  // SSH_CONNECTION's server address also covers ProxyJump and HostName tricks.
  const connection = run('ssh', [alias, 'printf "%s\\n" "$SSH_CONNECTION"']).trim().split(/\s+/);
  if (connection.length !== 4 || production.has(normalize(connection[2]))) throw Error('Scratch target refused.');
  return true;
}
export const freshHostGuard = String.raw`set -eu
test ! -e /opt/chunk-picker
test ! -e /etc/chunk-picker
test ! -e /etc/systemd/system/chunk-picker.service
test ! -e /lib/systemd/system/chunk-picker.service
# Refuse any existing HTTP(S) listener, including a wildcard reverse proxy.
awk 'FNR>1 && $4=="0A" {split($2,a,":"); if(a[2]=="0050" || a[2]=="01BB") found=1} END {exit found ? 1 : 0}' /proc/net/tcp /proc/net/tcp6
if test -d /etc/caddy || test -d /etc/nginx || test -d /etc/apache2; then exit 1; fi
command -v getent >/dev/null
server=$(printf '%s' "$SSH_CONNECTION" | awk '{print $3}')
test -n "$server"
live=$(getent ahosts chunkpicker.ca)
test -n "$live"
if printf '%s\n' "$live" | awk '{print $1}' | grep -Fxq "$server"; then exit 1; fi
`;
export async function provisionScratch(alias, nodeArchive, expectedSha, { run = execute, resolve = lookup } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha ?? '')) throw Error('A reviewed Node archive SHA-256 is required.');
  const bytes = await readFile(nodeArchive);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha) throw Error('Node archive hash differs.');
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  if (run('git', ['-C', repo, 'status', '--porcelain']).trim()) throw Error('Commit the rehearsal source first.');
  await scratchHostGuard(alias, { run, resolve });
  const id = randomUUID(), output = path.join(repo, '.local', 'tools-scratch', id);
  await mkdir(output, { recursive: true });
  const archive = path.join(output, 'source.tar'), remote = '/var/tmp/chunk-tools-scratch-' + id;
  run('git', ['-C', repo, 'archive', '--format=tar', '-o', archive, 'HEAD']);
  // The second guard runs immediately before the first remote write.
  run('ssh', [alias, 'sh -s -- ' + quote(remote)], freshHostGuard + '\numask 077\nmkdir "$1"\n');
  run('scp', [archive, alias + ':' + remote + '/source.tar']);
  run('scp', [path.resolve(nodeArchive), alias + ':' + remote + '/node.tar.xz']);
  const bootstrap = String.raw`set -eu
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) exit 1;; esac
test ! -e /opt/chunk-picker
echo "$2  $1/node.tar.xz" | sha256sum -c - >/dev/null
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >"$1/provision.log" 2>&1
apt-get install -y -qq python3 xz-utils util-linux ca-certificates >>"$1/provision.log" 2>&1
mkdir /opt/node /opt/chunk-picker /etc/chunk-picker
tar -xf "$1/node.tar.xz" --strip-components=1 -C /opt/node
test "$(/opt/node/bin/node --version)" = v24.20.0
ln -sf /opt/node/bin/node /usr/bin/node
id chunk-picker >/dev/null 2>&1 || useradd --system --home-dir /var/lib/chunk-picker --shell /usr/sbin/nologin chunk-picker
mkdir /opt/chunk-picker/source
tar -xf "$1/source.tar" -C /opt/chunk-picker/source
chown -R root:root /opt/chunk-picker/source
chmod -R go-w /opt/chunk-picker/source
/opt/node/bin/node /opt/chunk-picker/source/scripts/linux/scratch-cycle.mjs "$1"
`;
  const result = run('ssh', [alias, 'sudo -n -- sh -s -- ' + quote(remote) + ' ' + quote(expectedSha)], bootstrap);
  // The runner's sole stdout document is numeric timings and phase receipts.
  const report = JSON.parse(result);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { reportFile: path.join(output, 'report.json'), ...report };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [alias, archive, sha, ...extra] = process.argv.slice(2);
    if (!archive || extra.length) throw Error();
    process.stdout.write(JSON.stringify(await provisionScratch(alias, archive, sha), null, 2) + '\n');
  } catch { process.stderr.write('Synthetic scratch rehearsal refused; no live fallback.\n'); process.exitCode = 1; }
}
