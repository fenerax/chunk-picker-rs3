import './helpers/file-safety-stop.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { runOwnedCommand, quoteWindowsArgument, OWNED_COMMAND_NATIVE_SOURCE } from '../scripts/private-companion/owned-child-processes.mjs';

const windows = process.platform === 'win32';
test('Windows command quoting preserves spaces, quotes and trailing slashes', () => {
  assert.equal(quoteWindowsArgument('a b'), '"a b"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsArgument('a\\'), '"a\\\\"');
  assert.throws(() => quoteWindowsArgument('x\0y'), /refused/);
});

test('native owned command preserves arguments/output and observes empty job', { skip: !windows}, async () => {
  const values = ['space value', 'quote"value', 'slash\\', '', 'Player 1'];
  const result = await runOwnedCommand(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)));console.error("fixture stderr")', ...values], { timeout: 0 });
  assert.deepEqual(JSON.parse(result.stdout), values);
  assert.match(result.stderr, /fixture stderr/);
  assert.equal(result.cleanupVerified, true);
});

test('native failure retains output and proves cleanup', { skip: !windows}, async () => {
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'console.log("fixture failure");process.exit(7)'], { timeout: 0 }), error => {
    assert.equal(error.code, 7); assert.equal(error.cleanupVerified, true); assert.match(error.stdout, /fixture failure/); return true;
  });
});

test('compiler scratch is isolated and child TEMP/TMP retain their original values', { skip: !windows}, async t => {
  const compilerTemp = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'owned-compiler-'));
  t.after(() => rm(compilerTemp, { recursive: true, force: true }));
  // The child's paths deliberately do not exist. Native compilation must use
  // its explicit existing scratch, then restore these values before launch.
  const env = { ...process.env, TEMP: path.join(compilerTemp, 'child-temp'), TMP: path.join(compilerTemp, 'child-tmp') };
  const result = await runOwnedCommand(process.execPath, ['-e', 'console.log(JSON.stringify({TEMP:process.env.TEMP,TMP:process.env.TMP}))'], { env, compilerTemp, timeout: 0 });
  assert.deepEqual(JSON.parse(result.stdout), { TEMP: env.TEMP, TMP: env.TMP });
  assert.equal(result.cleanupVerified, true);
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'process.exit(0)'], { compilerTemp: 'relative' }), /absolute directory/);
});

test('detached descendants are contained on normal exit and timeout; unrelated process survives', { skip: !windows}, async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  try {
    const launch = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore",windowsHide:true});c.unref();console.log(c.pid);';
    await assert.rejects(runOwnedCommand(process.execPath, ['-e', launch], { timeout: 0 }), error => {
      assert.equal(error.cleanupVerified, true); assert.equal(error.timedOut, false);
      assert.ok(error.forcedDescendants > 0);
      const pid = Number(error.stdout.trim()); assert.ok(pid > 0);
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
      return true;
    });
    // Drive the actual native job termination branch through its wait seam.
    // No real clock competes with launch, compilation or descendant scheduling.
    const source = `$ErrorActionPreference='Stop'
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $request.source
$wait=[Func[IntPtr,uint32,uint32]]{param($handle,$milliseconds) return [uint32]258}
$result=[OwnedCommandJob]::Run($request.executable,$request.command,$request.cwd,[uint32]1000,$wait)
[Console]::Error.WriteLine('CONTROLLED_RESULT:'+($result|ConvertTo-Json -Compress))`;
    const host = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = ''; host.stderr.on('data', bytes => { stderr += bytes; }); host.stdout.resume();
    const closed = new Promise((resolve, reject) => { host.once('error', reject); host.once('close', resolve); });
    host.stdin.end(JSON.stringify({ source: OWNED_COMMAND_NATIVE_SOURCE, executable: process.execPath,
      command: [process.execPath, '-e', 'setInterval(()=>{},1000)'].map(quoteWindowsArgument).join(' '), cwd: process.cwd() }));
    assert.equal(await closed, 0, stderr);
    const result = JSON.parse(stderr.split('CONTROLLED_RESULT:')[1].split(/\r?\n/)[0]);
    assert.equal(result.timedOut, true); assert.equal(result.cleanupVerified, true); assert.equal(result.exitCode, 124);
    assert.equal(unrelated.exitCode, null); assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    unrelated.kill();
    await new Promise(resolve => { if (unrelated.exitCode !== null) resolve(); else unrelated.once('close', resolve); });
  }
});
