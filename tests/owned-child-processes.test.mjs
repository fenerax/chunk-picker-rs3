import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { runOwnedCommand, quoteWindowsArgument } from '../scripts/private-companion/owned-child-processes.mjs';

const windows = process.platform === 'win32';
test('Windows command quoting preserves spaces, quotes and trailing slashes', () => {
  assert.equal(quoteWindowsArgument('a b'), '"a b"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
  assert.equal(quoteWindowsArgument('a\\'), '"a\\\\"');
  assert.throws(() => quoteWindowsArgument('x\0y'), /refused/);
});

test('native owned command preserves arguments/output and observes empty job', { skip: !windows, timeout: 30000 }, async () => {
  const values = ['space value', 'quote"value', 'slash\\', '', 'Player 1'];
  const result = await runOwnedCommand(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)));console.error("fixture stderr")', ...values], { timeout: 5000 });
  assert.deepEqual(JSON.parse(result.stdout), values);
  assert.match(result.stderr, /fixture stderr/);
  assert.equal(result.cleanupVerified, true);
});

test('native failure retains output and proves cleanup', { skip: !windows, timeout: 30000 }, async () => {
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'console.log("fixture failure");process.exit(7)'], { timeout: 5000 }), error => {
    assert.equal(error.code, 7); assert.equal(error.cleanupVerified, true); assert.match(error.stdout, /fixture failure/); return true;
  });
});

test('compiler scratch is isolated and child TEMP/TMP retain their original values', { skip: !windows, timeout: 30000 }, async t => {
  const compilerTemp = await mkdtemp(path.join(process.env.RS3_TEST_SCRATCH_ROOT ?? os.tmpdir(), 'owned-compiler-'));
  t.after(() => rm(compilerTemp, { recursive: true, force: true }));
  // The child's paths deliberately do not exist. Native compilation must use
  // its explicit existing scratch, then restore these values before launch.
  const env = { ...process.env, TEMP: path.join(compilerTemp, 'child-temp'), TMP: path.join(compilerTemp, 'child-tmp') };
  const result = await runOwnedCommand(process.execPath, ['-e', 'console.log(JSON.stringify({TEMP:process.env.TEMP,TMP:process.env.TMP}))'], { env, compilerTemp, timeout: 5000 });
  assert.deepEqual(JSON.parse(result.stdout), { TEMP: env.TEMP, TMP: env.TMP });
  assert.equal(result.cleanupVerified, true);
  await assert.rejects(runOwnedCommand(process.execPath, ['-e', 'process.exit(0)'], { compilerTemp: 'relative' }), /absolute directory/);
});

test('detached descendants are contained on normal exit and timeout; unrelated process survives', { skip: !windows, timeout: 60000 }, async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  try {
    const launch = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore",windowsHide:true});c.unref();console.log(c.pid);';
    for (const hang of [false, true]) {
      await assert.rejects(runOwnedCommand(process.execPath, ['-e', launch + (hang ? 'setInterval(()=>{},1000)' : '')], { timeout: hang ? 1500 : 5000 }), error => {
        assert.equal(error.cleanupVerified, true);
        assert.equal(error.timedOut, hang);
        if (!hang) assert.ok(error.forcedDescendants > 0);
        const pid = Number(error.stdout.trim()); assert.ok(pid > 0);
        assert.throws(() => process.kill(pid, 0), /ESRCH/);
        return true;
      });
      assert.equal(unrelated.exitCode, null);
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    }
  } finally {
    unrelated.kill();
    await new Promise(resolve => { if (unrelated.exitCode !== null) resolve(); else unrelated.once('close', resolve); });
  }
});
