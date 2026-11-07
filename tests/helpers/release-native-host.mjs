import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
let host, pending, serial = 0;
const children = new Set();
const launch = file => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child); child.once('exit', () => children.delete(child)); return child;
};
export function stopNativeChildren() {
  console.error('Native stage file stuck', [...children].map(c => ({ pid: c.pid, exitCode: c.exitCode })), process.getActiveResourcesInfo());
  for (const child of children) { child.kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
}
export async function runNative(root, body, crash = false) {
  const file = path.join(root, 'fixture.ps1'); await writeFile(file, body);
  if (crash) return new Promise((resolve, reject) => {
    const child = launch(file); let output = '';
    child.stdin.end(); child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
    child.once('error', reject); child.once('exit', code => {
      child.stdout.destroy(); child.stderr.destroy();
      Number.isInteger(code) && code !== 0 ? resolve(output) : reject(Error('Hard crash missing: ' + output));
    });
  });
  if (!host) {
    const entry = path.join(root, 'stage-host.ps1');
    await writeFile(entry, `$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module ($PSHOME + '/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1')
Import-Module ($PSHOME + '/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
while($null -ne ($line=[Console]::In.ReadLine())) {
 $request=$line|ConvertFrom-Json
 try { & $request.path; [Console]::Out.WriteLine('FIXTURE_ACK:'+$request.id) }
 catch { [Console]::Error.WriteLine($_.Exception.Message+' '+$_.ScriptStackTrace); [Console]::Out.WriteLine('FIXTURE_REFUSED:'+$request.id) }
}
`);
    host = launch(entry); host.buffer = ''; host.detail = '';
    host.joined = new Promise((resolve, reject) => { host.once('error', reject); host.once('exit', code => {
      host.stdout.destroy(); host.stderr.destroy();
      if (pending) { pending.reject(Error('Host exited before acknowledgement: ' + host.detail)); pending = null; }
      code === 0 ? resolve() : reject(Error('Stage host refused: ' + host.detail));
    }); });
    host.joined.catch(() => {});
    host.stderr.on('data', bytes => { host.detail += bytes; });
    host.stdout.on('data', bytes => {
      host.buffer += bytes;
      let end;
      while ((end = host.buffer.indexOf('\n')) !== -1) {
        const line = host.buffer.slice(0, end).trim(); host.buffer = host.buffer.slice(end + 1);
        if (pending && line === 'FIXTURE_ACK:' + pending.id) { const p = pending; pending = null; p.resolve(host.detail); }
        else if (pending && line === 'FIXTURE_REFUSED:' + pending.id) { const p = pending; pending = null; p.reject(Error(host.detail)); }
      }
    });
  }
  return new Promise((resolve, reject) => { pending = { resolve, reject, id: ++serial }; host.stdin.write(JSON.stringify({ id: serial, path: file }) + '\n'); });
}
export async function closeNativeHost() { if (host) { host.stdin.end(); await host.joined; } }
