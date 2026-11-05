// Read and syntax checks only, with no supplementary groups or runtime imports.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { noLinks } from './files.mjs';
export { serviceIdentity } from './prewarm.mjs';

const execute = promisify(execFile);
export async function assertServiceAccess(root, { uid, gid }, entries = []) {
  try {
    if (process.platform !== 'linux' || process.getuid() !== 0
      || ![uid, gid].every(id => Number.isSafeInteger(id) && id > 0)) throw Error();
    root = path.resolve(root);
    await noLinks(root);
    if (entries.some(entry => !entry || path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..'))) throw Error();
    await execute('/usr/bin/python3', ['-c',
      'import os,sys,json,subprocess,stat\n'
      + 'root,uid,gid,entries,node=json.loads(sys.argv[1])\n'
      + 'os.setgroups([]);os.setgid(gid);os.setuid(uid)\n'
      + 'assert os.getuid()==uid and os.getgid()==gid and not os.getgroups()\n'
      + 'at=root\nwhile True:\n assert os.access(at,os.X_OK)\n parent=os.path.dirname(at)\n if parent==at: break\n at=parent\n'
      + 'def check(file):\n s=os.lstat(file)\n if stat.S_ISDIR(s.st_mode):\n  assert os.access(file,os.R_OK|os.X_OK)\n  for name in os.listdir(file): check(os.path.join(file,name))\n else:\n  assert stat.S_ISREG(s.st_mode) and s.st_nlink==1\n  with open(file,"rb") as f:\n   while f.read(1048576): pass\n'
      + 'check(root)\n'
      + 'for entry in entries:\n subprocess.run([node,"--check",os.path.join(root,entry)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n',
      JSON.stringify([root, uid, gid, entries, process.execPath])],
    { timeout: 60000, maxBuffer: 4096, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } });
  } catch { throw Object.assign(Error('Service access refused.'), { code: 'TOOLS_ACCESS' }); }
}
