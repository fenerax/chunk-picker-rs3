// PC-only helpers. All child stdout/stderr is captured. Secrets travel in
// memory and stdin, never argv, diagnostics, temporary files or receipts.
import { execFileSync } from 'node:child_process';
import { privateEndpoint } from '../linux/ops-status.mjs';
import { pinnedSsh, verifyHost } from './deployment-identity.mjs';
export const run = (file, args, input) => {
  try { return execFileSync(file, args, { input, encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 ** 2, timeout: 120000 }); }
  catch { throw Error('Setup subprocess failed; inspect account access privately.'); }
};
export function sshAlias(alias, { rehearsal = false } = {}) {
  if (alias !== 'picker-vps' && !(rehearsal && alias === 'picker-scratch')) throw Error('Approved deployment role required.'); return alias;
}
export const deploymentIdentity = alias => ({ format: 'picker-deployment-v1', role: alias === 'picker-vps' ? 'production' : 'rehearsal', alias });
export function verifyDeployment(alias, execute = run, identityFile) {
  sshAlias(alias); // Cloud setup/cleanup never accepts a rehearsal destination.
  verifyHost(alias, execute, identityFile);
  const program = "import os,stat; p='/etc/chunk-picker/deployment.json'; s=os.lstat(p); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and not s.st_mode&0o022; print(open(p).read())";
  const value = JSON.parse(pinnedSsh(alias, `sudo -n python3 -c "${program}"`, undefined, execute, identityFile));
  const expected = deploymentIdentity(alias);
  if (Object.keys(value).length !== 3 || Object.entries(expected).some(([key, entry]) => value[key] !== entry)) throw Error('Deployment identity differs.');
  return value;
}
export async function request(url, options = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(); return await response.json();
  } catch { throw Error('Setup API request failed.'); }
}
// One remote Python transaction, without any secret in the remote command.
// Files are 0600, directories 0700, owner root. Existing values must agree.
export function installSecrets(alias, secrets, execute = run, { rotate = [], identityFile } = {}) {
  const allowed = ['b2-account', 'b2-key', 'restic-password', 'health-ping', 'backup-ping', 'offhost-ping', 'discord-webhook'];
  if (!Object.keys(secrets).length || Object.entries(secrets).some(([name, value]) => !allowed.includes(name)
    || typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) || rotate.some(name => !Object.hasOwn(secrets, name))) throw Error('Invalid credential input.');
  for (const [name, value] of Object.entries(secrets)) {
    if (name === 'discord-webhook') privateEndpoint(value, 'discord');
    else if (name.endsWith('-ping')) privateEndpoint(value, 'healthchecks');
  }
  verifyDeployment(alias, execute, identityFile);
  const program = String.raw`import json,os,stat,sys,tempfile
base='/etc/chunk-picker/secrets'
if os.geteuid()!=0: raise RuntimeError('root required')
s=os.lstat('/etc/chunk-picker/deployment.json')
if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode&0o022: raise RuntimeError('unsafe deployment')
with open('/etc/chunk-picker/deployment.json') as f:
 if json.load(f)!={'format':'picker-deployment-v1','role':'production','alias':'picker-vps'}: raise RuntimeError('deployment differs')
for parent in ['/etc','/etc/chunk-picker']:
 s=os.lstat(parent)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise RuntimeError('unsafe parent')
os.makedirs(base,mode=0o700,exist_ok=True)
s=os.lstat(base)
if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077: raise RuntimeError('unsafe secrets')
payload=json.load(sys.stdin);values=payload['values'];rotate=payload['rotate']
allowed={'b2-account','b2-key','restic-password','health-ping','backup-ping','offhost-ping','discord-webhook'}
if not set(values)<=allowed: raise RuntimeError('unknown credential')
for name,value in values.items():
 if not isinstance(value,str) or not value or '\n' in value: raise RuntimeError('invalid credential')
 target=base+'/'+name
 if os.path.lexists(target):
  s=os.lstat(target)
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode&0o077: raise RuntimeError('unsafe credential')
  with open(target) as f: previous=f.read().strip()
  if previous!=value and name not in rotate: raise RuntimeError('credential differs; explicit rotation required')
for name,value in values.items():
 target=base+'/'+name
 if not os.path.exists(target) or name in rotate:
  fd,tmp=tempfile.mkstemp(prefix='.setup-',dir=base)
  try:
   with os.fdopen(fd,'w') as f: f.write(value+'\n');f.flush();os.fsync(f.fileno())
   os.chmod(tmp,0o600);os.chown(tmp,0,0)
   if name in rotate: os.replace(tmp,target)
   else: os.link(tmp,target)
  finally:
   if os.path.exists(tmp): os.unlink(tmp)
 os.chmod(target,0o600);os.chown(target,0,0)
fd=os.open(base,os.O_RDONLY);os.fsync(fd);os.close(fd)
`;
  const encoded = Buffer.from(program).toString('base64');
  // Repeat machine verification immediately before credential transfer; the
  // transfer connection itself is also restricted to the pinned host key.
  verifyHost(alias, execute, identityFile);
  pinnedSsh(alias, `sudo -n python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`, JSON.stringify({ values: secrets, rotate }), execute, identityFile);
}
export function installedB2Id(alias, execute = run, identityFile) {
  verifyDeployment(alias, execute, identityFile);
  const value = pinnedSsh(alias, "sudo -n sh -c 'if test -f /etc/chunk-picker/secrets/b2-account; then cat /etc/chunk-picker/secrets/b2-account; fi'", undefined, execute, identityFile).trim();
  if (value && !/^[A-Za-z0-9]+$/.test(value)) throw Error('Installed key metadata invalid.'); return value;
}
