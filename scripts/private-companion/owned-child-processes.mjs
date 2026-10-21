// Windows native containment: assign the suspended command to a private job
// before executing a single instruction. Detached descendants remain in it.
// No PID lookup, command-line inventory, or unrelated-process signal is used.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';

export function quoteWindowsArgument(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw Error('Owned command argument refused.');
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}

// Job membership is stronger than sampled parent PIDs: a short-lived launcher
// cannot lose its descendants between snapshots, and PID reuse is irrelevant.
const native = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Threading;
public static class OwnedCommandJob {
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long a,b,c,d; public uint faults,total,active,terminated; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,xSize,ySize,xCount,yCount,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct SECURITY { public uint length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT value,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out ACCOUNTING value,uint size,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string file,uint access,uint share,ref SECURITY security,uint creation,uint attributes,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUP startup,out PROCESS process);
 public sealed class Result { public uint exitCode; public bool timedOut; public bool cleanupVerified; public uint forcedDescendants; public uint rootPid; }
 static void Require(bool value) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static uint Active(IntPtr job) { ACCOUNTING value; Require(QueryInformationJobObject(job,1,out value,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero)); return value.active; }
 public static Result Run(string executable,string command,string cwd,uint timeout) {
  IntPtr job=IntPtr.Zero,input=IntPtr.Zero; PROCESS child=new PROCESS(); bool assigned=false;
  try {
   job=CreateJobObject(IntPtr.Zero,null); Require(job!=IntPtr.Zero);
   EXTENDED_LIMIT limit=new EXTENDED_LIMIT(); limit.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway permission.
   Require(SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
   SECURITY security=new SECURITY(); security.length=(uint)Marshal.SizeOf(typeof(SECURITY)); security.inherit=true;
   input=CreateFile("NUL",0x80000000,3,ref security,3,0,IntPtr.Zero); Require(input!=new IntPtr(-1));
   STARTUP startup=new STARTUP(); startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP)); startup.flags=0x100;
   startup.input=input; startup.output=GetStdHandle(-11); startup.error=GetStdHandle(-12);
   Require(SetHandleInformation(startup.output,1,1)); Require(SetHandleInformation(startup.error,1,1));
   Require(CreateProcess(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out child));
   Require(AssignProcessToJobObject(job,child.process)); assigned=true;
   Require(ResumeThread(child.thread)!=0xffffffff);
   uint wait=WaitForSingleObject(child.process,timeout); if(wait!=0 && wait!=258) throw new Win32Exception(Marshal.GetLastWin32Error());
   Result result=new Result(); result.rootPid=child.pid; result.timedOut=wait==258;
   if(result.timedOut) Require(TerminateJobObject(job,124));
   else {
    Require(GetExitCodeProcess(child.process,out result.exitCode));
    // Allow ordinary descendant exit/handle teardown before treating it as a leak.
    for(int i=0;i<10 && Active(job)!=0;i++) Thread.Sleep(100);
    result.forcedDescendants=Active(job);
    if(result.forcedDescendants!=0) Require(TerminateJobObject(job,125));
   }
   for(int i=0;i<100 && Active(job)!=0;i++) Thread.Sleep(100);
   result.cleanupVerified=Active(job)==0;
   if(result.timedOut) result.exitCode=124;
   return result;
  } finally {
   // A failed assignment never resumes the direct process; use its native
   // handle to stop it. Closing an assigned job also contains host failures.
   if(child.process!=IntPtr.Zero && !assigned) { TerminateProcess(child.process,126); WaitForSingleObject(child.process,10000); }
   if(job!=IntPtr.Zero) CloseHandle(job);
   if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
   if(child.process!=IntPtr.Zero) CloseHandle(child.process);
   if(input!=IntPtr.Zero && input!=new IntPtr(-1)) CloseHandle(input);
  }
 }
}
`;

const host = `$ErrorActionPreference='Stop'
try {
 $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())) | ConvertFrom-Json
 $compilerEnvironment=@{TEMP=[Environment]::GetEnvironmentVariable('TEMP','Process');TMP=[Environment]::GetEnvironmentVariable('TMP','Process')}
 try {
  [Environment]::SetEnvironmentVariable('TEMP',[string]$request.compilerTemp,'Process')
  [Environment]::SetEnvironmentVariable('TMP',[string]$request.compilerTemp,'Process')
  Add-Type -TypeDefinition @'
${native}
'@
 } finally {
  foreach($name in @('TEMP','TMP')) {[Environment]::SetEnvironmentVariable($name,$compilerEnvironment[$name],'Process')}
 }
 $result=[OwnedCommandJob]::Run([string]$request.executable,[string]$request.command,[string]$request.cwd,[uint32]$request.timeout)
 [Console]::Error.WriteLine([string]$request.marker+($result | ConvertTo-Json -Compress))
} catch { [Console]::Error.WriteLine('Owned native command host refused.'); exit 126 }
`;

/** execFile-compatible output. A surviving descendant makes an otherwise-zero
 * command fail even when the job successfully terminates it. Failed calls carry
 * cleanupVerified only when the job has observed an empty membership count.
 * timeout=0 is allowed for an admission wrapper that must wait indefinitely.
 * compilerTemp selects an existing caller-owned compiler scratch directory;
 * it defaults to env.TEMP/env.TMP. Actual command TEMP/TMP remain unchanged.
 * This is Windows-only and never falls back to unsafe PID tree termination. */
export async function runOwnedCommand(executable, args, options = {}) {
  if (process.platform !== 'win32') throw Error('Owned native commands require Windows Job Objects.');
  const { cwd = process.cwd(), env = process.env, windowsHide = true, timeout = 30 * 60000, maxBuffer = 32 * 1024 ** 2 } = options;
  if (!path.isAbsolute(executable ?? '') || !path.isAbsolute(cwd) || !Array.isArray(args)
      || !Number.isInteger(timeout) || timeout < 0 || timeout > 0xfffffffe || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1) throw Error('Owned command inputs refused.');
  const compilerTemp = options.compilerTemp ?? env.TEMP ?? env.TMP;
  if (!path.isAbsolute(compilerTemp ?? '')) throw Error('Owned compiler scratch must be an existing absolute directory.');
  for (let current = path.resolve(compilerTemp); ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('Owned compiler scratch refuses linked directories.');
    if (path.dirname(current) === current) break;
  }
  const command = [executable, ...args].map(quoteWindowsArgument).join(' ');
  if (command.length > 30000) throw Error('Owned command exceeds the native command-line limit.');
  const marker = 'RS3_OWNED_' + randomUUID() + ':', payload = { executable, command, cwd, compilerTemp: path.resolve(compilerTemp), timeout: timeout || 0xffffffff, marker };
  const ps = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(host, 'utf16le').toString('base64')],
      { cwd, env, windowsHide, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = { stdout: [], stderr: [] }; let bytes = 0, failure, timer;
    const stopHost = reason => { failure ??= reason; child.kill(); }; // Native handle belongs to this spawn; job closes with the host.
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) stopHost('Owned command output exceeded its limit.');
      else output[stream].push(chunk);
    });
    child.stdin.on('error', () => {}); // A refused host may close before reading the bounded request.
    child.on('error', () => { failure = 'Owned command host could not start.'; });
    if (timeout) timer = setTimeout(() => stopHost('Owned command host did not complete cleanup.'), timeout + 60000);
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(output.stdout).toString('utf8');
      let stderr = Buffer.concat(output.stderr).toString('utf8'), proof;
      const offset = stderr.lastIndexOf(marker);
      if (offset >= 0) {
        const end = stderr.indexOf('\n', offset), line = stderr.slice(offset + marker.length, end < 0 ? undefined : end).trim();
        try { proof = JSON.parse(line); } catch { failure ??= 'Owned command cleanup proof is malformed.'; }
        stderr = stderr.slice(0, offset) + (end < 0 ? '' : stderr.slice(end + 1));
      }
      const cleanupVerified = proof?.cleanupVerified === true;
      if (failure || code !== 0 || !cleanupVerified || proof?.timedOut || proof?.exitCode !== 0 || proof?.forcedDescendants !== 0) {
        const error = Error(failure ?? (!cleanupVerified ? 'Owned command cleanup could not be verified.' : proof.timedOut ? 'Owned command timed out; owned job cleaned.' : proof.forcedDescendants ? 'Owned command leaked descendants; owned job cleaned.' : 'Owned command failed; owned job cleaned.'));
        Object.assign(error, { stdout, stderr, cleanupVerified, timedOut: proof?.timedOut === true, code: proof?.exitCode ?? code, forcedDescendants: proof?.forcedDescendants ?? null });
        reject(error);
      } else resolve({ stdout, stderr, cleanupVerified, forcedDescendants: 0 });
    });
    // ASCII transport avoids Windows PowerShell's host-dependent stdin code page.
    child.stdin.end(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') + '\n');
  });
}
