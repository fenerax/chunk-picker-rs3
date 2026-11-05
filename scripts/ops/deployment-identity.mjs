// Local-only trust pins. Never transfer these files to a deployment host.
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, mkdtempSync, writeFileSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { isMain } from '../release/vps/entrypoint.mjs';

export const identityFile = alias => process.env.PICKER_DEPLOYMENT_IDENTITY_FILE
  ?? path.join(os.homedir(), '.config', 'chunk-picker', alias === 'picker-vps' ? 'deployment-identity.json' : 'scratch-identity.json');
export const fingerprint = key => 'SHA256:' + createHash('sha256').update(Buffer.from(key.split(' ')[1] ?? '', 'base64')).digest('base64').replace(/=+$/, '');
export const strictOptions = ['-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none'];
export function loadPin(alias, file = identityFile(alias)) {
  try {
    const stat = lstatSync(file), pin = JSON.parse(readFileSync(file, 'utf8'));
    if (!path.isAbsolute(file) || !stat.isFile() || stat.nlink !== 1 || pin.format !== 'picker-host-identity-v1' || pin.alias !== alias
      || pin.role !== (alias === 'picker-vps' ? 'production' : 'rehearsal')
      || !/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(pin.hostKey ?? '')
      || !/^[a-f0-9]{64}$/.test(pin.machineIdHash ?? '') || fingerprint(pin.hostKey) !== pin.fingerprint) throw Error();
    return pin;
  } catch { throw Error('Local deployment identity missing or invalid.'); }
}
export function pinnedSsh(alias, command, input, execute, file) {
  const pin = loadPin(alias, file);
  // A private known_hosts containing ONLY the pinned key makes OpenSSH compare
  // the presented key before executing any command or sending credential stdin.
  // Disable the global database and alternate key sources, including DNS.
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'picker-identity-'));
  try {
    const known = path.join(temporary, 'known_hosts');
    writeFileSync(known, alias + ' ' + pin.hostKey + '\n', { mode: 0o600, flag: 'wx' });
    return execute('ssh', [...strictOptions, '-o', 'GlobalKnownHostsFile=none', '-o', 'KnownHostsCommand=none',
      '-o', 'VerifyHostKeyDNS=no', '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'HostKeyAlias=' + alias,
      '-o', 'UserKnownHostsFile=' + known.replaceAll('\\', '/'), alias, command], input);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export const machineCommand = "python3 -c \"import hashlib;print(hashlib.sha256(open('/etc/machine-id','rb').read().strip()).hexdigest())\"";
export function verifyHost(alias, execute, file) {
  const pin = loadPin(alias, file);
  const hash = pinnedSsh(alias, machineCommand, undefined, execute, file).trim();
  if (hash !== pin.machineIdHash) throw Error('Deployment machine identity differs.');
}
// Explicit one-time operator command. Read-only remotely; create-only locally.
// Strict checking uses the operator's independently established known_hosts.
// Compare the actual negotiated key (OpenSSH diagnostics) to the remote public
// key before recording it. Neither bootstrap nor a deployment marker can pin it.
export function captureIdentity(alias, file, execute = spawnSync) {
  if (!['picker-vps', 'picker-scratch'].includes(alias) || !path.isAbsolute(file ?? '')) throw Error('Explicit role and local output required.');
  const result = execute('ssh', [...strictOptions, '-v', '-o', 'HostKeyAlgorithms=ssh-ed25519', alias,
    machineCommand + '; cat /etc/ssh/ssh_host_ed25519_key.pub'],
  { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1024 ** 2 });
  const [machineIdHash, line] = (result.stdout ?? '').trim().split(/\r?\n/), hostKey = line?.split(/\s+/).slice(0, 2).join(' ');
  const actual = /Server host key: ssh-ed25519 (SHA256:[A-Za-z0-9+/]+)/.exec(result.stderr ?? '')?.[1];
  if (result.status !== 0 || !/^[a-f0-9]{64}$/.test(machineIdHash ?? '') || !hostKey || fingerprint(hostKey) !== actual) throw Error('Identity capture refused.');
  const pin = { format: 'picker-host-identity-v1', role: alias === 'picker-vps' ? 'production' : 'rehearsal', alias,
    hostKey, fingerprint: actual, machineIdHash };
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(pin, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  loadPin(alias, file);
}
if (isMain(import.meta.url)) {
  try {
    const [command, alias, file, ...extra] = process.argv.slice(2);
    if (command !== 'capture-identity' || extra.length) throw Error();
    captureIdentity(alias, file); process.stdout.write('Local deployment identity captured.\n');
  } catch { process.stderr.write('Identity capture refused; no identity values printed.\n'); process.exitCode = 1; }
}
