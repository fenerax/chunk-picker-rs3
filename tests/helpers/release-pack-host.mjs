// One file-owned PowerShell host for non-crash invocations. Every request runs
// in a child scope with a distinct script, release inputs and mutable store.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { joinChild } from '../../scripts/private-companion/release-pack-check.mjs';

const source = fileURLToPath(new URL('../../scripts/private-companion/', import.meta.url));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
let host;
export const stageFileController = new AbortController();
export const stageTrace = `function Write-FixtureStep([string]$Name) {
 [Console]::Error.WriteLine(('Fixture step: '+$Name+' at '+[DateTime]::UtcNow.ToString('o')))
}
`;
export async function stageLibrary(root) {
  for (const name of ['Operator-Common.ps1', 'ReleaseV2-Common.ps1', 'Frozen-Bundle.ps1']) {
    let code = await readFile(path.join(source, name), 'utf8');
    if (name === 'ReleaseV2-Common.ps1') code = code.replace(
      ". (Join-Path $PSScriptRoot 'Frozen-Bundle.ps1')",
      "Write-FixtureStep 'dot-source:Frozen-Bundle:start'; . (Join-Path $PSScriptRoot 'Frozen-Bundle.ps1'); Write-FixtureStep 'dot-source:Frozen-Bundle:end'")
      .replace(/^(\s*)(\$tick = \[IO.File\]::Open[^\r\n]+)/m, "$1Write-FixtureStep 'tick-lock:start'\n$1$2\n$1Write-FixtureStep 'tick-lock:acquired'");
    await writeFile(path.join(root, name), code);
  }
  return stageTrace + ['Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility'].map(name =>
    `Write-FixtureStep 'module:${name}:start'\nImport-Module ${name}\nWrite-FixtureStep 'module:${name}:end'\n`).join('') +
    ['Operator-Common.ps1', 'ReleaseV2-Common.ps1'].map(name =>
      `Write-FixtureStep 'dot-source:${name}:start'\n. ${quote(path.join(root,name))}\nWrite-FixtureStep 'dot-source:${name}:end'\n`).join('');
}
async function startHost(signal) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pack-stage-host-'));
  const library = await stageLibrary(root), file = path.join(root, 'host.ps1');
  await writeFile(file, `$ErrorActionPreference='Stop'\n${library}
[Console]::Out.WriteLine('Fixture host ready')
while ($null -ne ($request=[Console]::In.ReadLine())) {
 $code=0
 if(Test-Path Function:Fail-Once){throw 'A fixture function escaped its request scope'}
 try { & { param($file) . $file } $request } catch {
  $code=1; [Console]::Error.WriteLine($_.ToString()); [Console]::Error.WriteLine($_.ScriptStackTrace)
 }
 Write-FixtureStep 'request:complete'
 [Console]::Out.WriteLine(('Fixture result: '+$code))
}
`);
  const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-File',file], {windowsHide:true,stdio:['pipe','pipe','pipe']});
  const joined = joinChild(child, {setTimer:()=>undefined,clearTimer(){},signal,label:'Release stage shared host'});
  joined.catch(()=>{});
  let active, startup = '', readyResolve, readyReject;
  const complete=()=>{
    if(!active?.stderrComplete||active.code===undefined)return;
    const request=active;active=undefined;
    request.resolve({pid:child.pid,exitCode:request.code,signal:null,closed:false,acknowledged:true,
      startedAt:request.startedAt,completedAt:Date.now(),stderrTail:request.stderrTail,stdout:request.stdout});
  };
  const ready = new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const output = createInterface({input:child.stdout}), errors = createInterface({input:child.stderr});
  errors.on('line', line => {
    // Stream each timestamp to the job log immediately, including before ready.
    console.error('[release-stage pid='+child.pid+'] '+line);
    if(active) {
      active.stderrTail += line+'\n';
      if(line.startsWith('Fixture step: request:complete at '))active.stderrComplete=true;
      complete();
    } else startup += line+'\n';
  });
  output.on('line', line => {
    if(line==='Fixture host ready')return readyResolve();
    if(line.startsWith('Fixture result: ')&&active) {
      active.code=Number(line.slice(16));complete();
    } else if(active)active.stdout += line+'\n';
  });
  joined.then(result=>{
    const error=new Error('Stage host exited before acknowledgement: '+JSON.stringify(result),{cause:result.original});
    error.childResult=result;error.retainScratch=!result.closed;
    readyReject(error);active?.reject(error);
  },error=>{readyReject(error);active?.reject(error);});
  return {
    async run(file) {
      const startedAt=Date.now();
      await ready;
      if(active)throw Error('Concurrent shared stage requests are forbidden');
      return new Promise((resolve,reject)=>{
        active={resolve,reject,startedAt,stderrTail:startup,stdout:''};startup='';
        child.stdin.write(file+'\n',error=>{if(error){active?.reject(error);active=undefined;}});
      });
    },
    async close() {
      child.stdin.end();
      const result=await joined;
      output.close();errors.close();
      if(result.closed)await rm(root,{recursive:true,force:true});
      else console.error('Retained unjoined stage host: '+root);
      if(result.exitCode!==0||result.signal!==null)throw Error('Stage host shutdown refused: '+JSON.stringify(result));
    }
  };
}
export async function runHostedStage(file, signal) {
  signal?.throwIfAborted();
  host ??= startHost(stageFileController.signal);
  return (await host).run(file);
}
export async function closeStageHost() {
  if(host)await (await host).close();
}
