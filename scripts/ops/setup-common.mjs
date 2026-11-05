// PC-only helpers. All child stdout/stderr is captured. Secrets travel in
// memory and stdin, never argv, diagnostics, temporary files or receipts.
import { execFileSync } from 'node:child_process';
export const run = (file, args, input) => {
  try { return execFileSync(file, args, { input, encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 ** 2, timeout: 120000 }); }
  catch { throw Error('Setup subprocess failed; inspect account access privately.'); }
};
export function sshAlias(alias) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(alias ?? '')) throw Error('SSH alias required.'); return alias;
}
export async function request(url, options = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(); return await response.json();
  } catch { throw Error('Setup API request failed.'); }
}
// One remote Python transaction, without any secret in the remote command.
// Files are 0600, directories 0700, owner root. Existing values must agree.
export function installSecrets(alias, secrets, execute = run) {
  sshAlias(alias);
  const program = String.raw`import json,os,stat,sys,tempfile
base='/etc/chunk-picker/secrets'
if os.geteuid()!=0: raise RuntimeError('root required')
for parent in ['/etc','/etc/chunk-picker']:
 s=os.lstat(parent)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise RuntimeError('unsafe parent')
os.makedirs(base,mode=0o700,exist_ok=True)
s=os.lstat(base)
if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077: raise RuntimeError('unsafe secrets')
values=json.load(sys.stdin)
allowed={'b2-account','b2-key','restic-password','health-ping','backup-ping','offhost-ping'}
if not set(values)<=allowed: raise RuntimeError('unknown credential')
for name,value in values.items():
 if not isinstance(value,str) or not value or '\n' in value: raise RuntimeError('invalid credential')
 target=base+'/'+name
 if os.path.lexists(target):
  s=os.lstat(target)
  if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode&0o077: raise RuntimeError('unsafe credential')
  with open(target) as f: previous=f.read().strip()
  if previous!=value: raise RuntimeError('credential differs; explicit rotation required')
for name,value in values.items():
 target=base+'/'+name
 if not os.path.exists(target):
  fd,tmp=tempfile.mkstemp(prefix='.setup-',dir=base)
  try:
   with os.fdopen(fd,'w') as f: f.write(value+'\n');f.flush();os.fsync(f.fileno())
   os.chmod(tmp,0o600);os.link(tmp,target)
  finally: os.unlink(tmp)
fd=os.open(base,os.O_RDONLY);os.fsync(fd);os.close(fd)
`;
  const encoded = Buffer.from(program).toString('base64');
  execute('ssh', [alias, `sudo -n python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`], JSON.stringify(secrets));
}
export function installedB2Id(alias, execute = run) {
  const value = execute('ssh', [sshAlias(alias), "sudo -n sh -c 'if test -f /etc/chunk-picker/secrets/b2-account; then cat /etc/chunk-picker/secrets/b2-account; fi'"]).trim();
  if (value && !/^[A-Za-z0-9]+$/.test(value)) throw Error('Installed key metadata invalid.'); return value;
}
