import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
    ['tools-install-contracts.mjs', 'tools-contracts-ok', 'upgrades and rolls back the exact #128 package, recovering cross-contract process kills'],
    ['tools-install.mjs', 'tools-install-ok', 'exchanges a real directory, verifies, rolls back, and fences failures without writer control'],
    ['tools-install-crashes.mjs', 'tools-crashes-ok', 'recovers real process kills outside the journal, retaining live locks'],
  ]) await file.test(name, async () => {
    const output = await runToolsHelper(fileURLToPath(new URL(`./helpers/${script}`, import.meta.url)), {
      signal: file.signal, report: text => process.stderr.write(text),
    });
    assert.equal(output.trim(), expected);
  });
});
