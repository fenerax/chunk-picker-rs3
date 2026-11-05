// Privilege-dropped access and CLI checks, with no supplementary groups.
// CLI probes are fenced into an operation-owned synthetic configuration.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, chown, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { encode, noLinks } from './files.mjs';
import { toolsCliChecks } from './entrypoint-checks.mjs';
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

export async function assertToolsEntrypoints(root, { uid, gid }, checks = toolsCliChecks) {
  let scratch;
  try {
    if (process.platform !== 'linux' || process.getuid() !== 0
      || ![uid, gid].every(id => Number.isSafeInteger(id) && id > 0)) throw Error();
    // This is an exclusive operation-owned fixture, outside the hashed package.
    // Only its control directory is writable to the privilege-dropped probe.
    scratch = await mkdtemp(path.join(path.dirname(root), '.tools-check-'));
    await chmod(scratch, 0o755);
    const controlDir = path.join(scratch, 'control');
    await mkdir(controlDir); await chmod(controlDir, 0o700); await chown(controlDir, uid, gid);
    const current = path.join(scratch, 'current.json'), config = path.join(scratch, 'operator.json');
    await writeFile(current, '{}'); await chmod(current, 0o644);
    const maintenance = path.join(controlDir, 'maintenance.json');
    await writeFile(maintenance, '{}'); await chmod(maintenance, 0o644);
    await writeFile(config, encode({ service: 'chunk-picker.service', current, controlDir,
      dataDir: path.join(scratch, 'game'), scratchRoot: path.join(scratch, 'scratch'), backupDir: path.join(scratch, 'backups') }));
    await chmod(config, 0o644);
    const alias = path.join(scratch, 'tools'); await symlink(root, alias, 'dir');
    await execute('/usr/bin/python3', ['-c',
      'import os,sys,json,subprocess\n'
      + 'uid,gid,root,node,config,checks=json.loads(sys.argv[1])\n'
      + 'os.setgroups([]);os.setgid(gid);os.setuid(uid)\n'
      + 'assert os.getuid()==uid and os.getgid()==gid and not os.getgroups()\n'
      + 'env={"PATH":"/usr/sbin:/usr/bin:/sbin:/bin","LANG":"C","RS3_OPERATOR_CONFIG":config}\n'
      + 'for entry,args,diagnostic in checks:\n result=subprocess.run([node,os.path.join(root,entry)]+args,env=env,capture_output=True,text=True,timeout=15)\n assert result.returncode==1 and not result.stdout and result.stderr.startswith(diagnostic)\n',
      JSON.stringify([uid, gid, alias, process.execPath, config, checks])],
    { cwd: scratch, timeout: 60000, maxBuffer: 4096, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } });
  } catch { throw Object.assign(Error('Installed entrypoint behavior refused.'), { code: 'TOOLS_ENTRYPOINT' }); }
  finally {
    // mkdtemp proved exclusive ownership; rm removes the alias, never its target.
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
