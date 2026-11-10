import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runToolsHelper } from './helpers/run-tools-helper.mjs';

test('installer helper waits for completion and drains cancellation without a subprocess deadline', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const controller = new AbortController(), progress = [];
  let options, finished = false;
  const running = runToolsHelper('synthetic-helper.mjs', { signal: controller.signal, report: text => progress.push(text) }, {
    spawn: (executable, args, value) => { options = value; assert.ok(args.includes('synthetic-helper.mjs')); return child; },
  });
  const result = running.catch(error => error).then(value => { finished = true; return value; });
  child.stderr.write('entered real contract step\n');
  assert.deepEqual(progress, ['entered real contract step\n']);
  assert.equal(options.timeout, undefined);
  controller.abort(new Error('synthetic outer cancellation'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.stdin.writableEnded, true, 'EOF asks the root host to clean its owned group');
  assert.equal(finished, false, 'cancellation waits for root cleanup and stdio closure');
  child.emit('close', 125, null);
  assert.equal((await result).message, 'synthetic outer cancellation');
});

// The adaptive runner owns the existing 15-minute file guard. Every package,
// permission and real SIGKILL scenario still runs, once, in its original order.
test('Linux root installer contracts', { skip: process.platform !== 'linux' ? 'Linux package contract/root ownership' : false }, async file => {
  await file.test('killing the adaptive worker group closes helper pipes and reaps its isolated session', async t => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'tools-group-kill-'));
    const helper = path.join(scratch, 'helper.mjs'), workerFile = path.join(scratch, 'worker.mjs');
    const host = fileURLToPath(new URL('./helpers/tools-install-host.py', import.meta.url));
    await writeFile(helper, `import { MessageChannel } from 'node:worker_threads';
const channel = new MessageChannel(); channel.port1.on('message', () => {});
console.log(JSON.stringify({helperPid: process.pid}));`);
    await writeFile(workerFile, `import { spawn } from 'node:child_process';
// Inherit these pipes exactly as a runner-owned worker does. The supervisor
// owns the helper's stdin; the worker's death must close its only writer.
const host = spawn('/usr/bin/python3', [${JSON.stringify(host)}, process.execPath, ${JSON.stringify(helper)}],
  {stdio: ['pipe', 'inherit', 'inherit']});
host.once('error', error => { console.error(error); process.exitCode = 1; });`);
    const worker = fork(workerFile, [], { detached: true, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const closed = new Promise(resolve => worker.once('close', (code, signal) => resolve({ code, signal })));
    let stderr = '';
    worker.stderr.on('data', bytes => { stderr += bytes; });
    t.after(async () => {
      if (worker.pid && worker.exitCode === null && worker.signalCode === null) process.kill(-worker.pid, 'SIGKILL');
      await closed;
      await rm(scratch, { recursive: true, force: true });
    });
    const lines = createInterface({ input: worker.stdout });
    const ready = new Promise((resolve, reject) => {
      worker.once('error', reject);
      lines.once('line', line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
      lines.once('close', () => reject(new Error(`Helper exited before readiness. ${stderr}`)));
    });
    const { helperPid } = await ready;
    assert.ok(Number.isSafeInteger(helperPid) && helperPid > 0);
    process.kill(-worker.pid, 'SIGKILL'); // The adaptive runner's exact killTree operation.
    assert.deepEqual(await closed, { code: null, signal: 'SIGKILL' }, stderr);
    assert.throws(() => process.kill(helperPid, 0), error => error.code === 'ESRCH',
      'helper was reaped before its inherited stdout/stderr pipes closed');
  });
  await file.test('outer cancellation reaps the root helper and its live descendant', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'tools-host-contract-'));
    try {
      const script = path.join(scratch, 'held.mjs');
      await writeFile(script, `import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', "process.stderr.write('DESCENDANT_READY'); process.stdin.resume()"], {stdio:['pipe','ignore','inherit']});
await new Promise(() => {});`);
      const controller = new AbortController();
      let output = '';
      await assert.rejects(runToolsHelper(script, { signal: controller.signal, report: text => {
        output += text;
        if (output.includes('DESCENDANT_READY')) controller.abort(new Error('owned root cancellation'));
      } }), /owned root cancellation/);
      // The host closes only after waitpid has reaped every owned descendant.
      assert.equal(output.includes('DESCENDANT_READY'), true);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  });
  for (const [script, expected, name] of [
    ['tools-install-contracts.mjs', 'tools-contracts-ok', 'upgrades v1 and v2 packages to current, rolls back, and recovers cross-contract process kills'],
    ['tools-install.mjs', 'tools-install-ok', 'exchanges a real directory, verifies, rolls back, and fences failures without writer control'],
    ['tools-install-crashes.mjs', 'tools-crashes-ok', 'recovers real process kills outside the journal, retaining live locks'],
  ]) await file.test(name, async () => {
    const output = await runToolsHelper(fileURLToPath(new URL(`./helpers/${script}`, import.meta.url)), {
      signal: file.signal, report: text => process.stderr.write(text),
    });
    assert.equal(output.trim(), expected);
  });
});
