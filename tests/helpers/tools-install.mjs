// Root subprocess, on synthetic trees only. CI's Linux slice must execute it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { buildTools, toolsClosure } from '../../scripts/linux/tools-package.mjs';
import { exchangePaths, switchTools } from '../../scripts/linux/tools-install.mjs';
import { exists, inventory, json } from '../../scripts/linux/files.mjs';
import { checkStart } from '../../scripts/linux/start-check.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp('/var/tmp/tools-install-test-');
try {
  const source = path.join(scratch, 'source'), pkg = path.join(scratch, 'package');
  for (const row of (await toolsClosure(repo)).files) {
    const file = path.join(source, row.path); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await readFile(path.join(repo, row.path)));
  }
  const manifest = await buildTools(source, pkg);
  const parent = path.join(scratch, 'installed'); await mkdir(parent, { mode: 0o755 });
  const toolsRoot = path.join(parent, 'tools'); await mkdir(toolsRoot, { mode: 0o755 });
  await writeFile(path.join(toolsRoot, 'legacy.mjs'), 'export const legacy = true;\n', { mode: 0o644 });
  const controlDir = path.join(scratch, 'control'); await mkdir(controlDir);
  const settings = { controlDir, current: path.join(scratch, 'current.json') };
  await writeFile(settings.current, '{}');
  const idle = async () => {};
  const before = await inventory(toolsRoot);
  // A busy unit or operator lock refuses before even staging a version.
  await assert.rejects(switchTools({ settings, toolsRoot, packageRoot: pkg, idle: async () => { throw Error('busy'); } }), /busy/);
  for (const name of ['operation.lock', 'maintenance.json', 'activation.json', 'transaction.json', 'tools-transaction.json']) {
    await writeFile(path.join(controlDir, name), '{}');
    await assert.rejects(switchTools({ settings, toolsRoot, packageRoot: pkg, idle }));
    assert.deepEqual(await inventory(toolsRoot), before); await rm(path.join(controlDir, name));
  }
  let exchanges = 0;
  const exchange = async (first, second) => {
    assert.deepEqual(await inventory(toolsRoot), before);
    await exchangePaths(first, second); exchanges++;
    assert.equal((await json(path.join(await realpath(toolsRoot), 'tools-manifest.json'))).toolsIdentity, manifest.toolsIdentity);
  };
  const installed = await switchTools({ settings, toolsRoot, packageRoot: pkg, idle, exchange });
  assert.equal(exchanges, 1); assert.equal(installed.writerRestarted, false);
  const receipt = await json(installed.receiptFile);
  assert.deepEqual(await inventory(receipt.previous.root), before);
  assert.equal((await json(path.join(await realpath(toolsRoot), 'tools-manifest.json'))).toolsIdentity, manifest.toolsIdentity);
  const restored = await switchTools({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle });
  assert.equal(restored.writerRestarted, false); assert.deepEqual(await inventory(await realpath(toolsRoot)), before);
  await assert.rejects(switchTools({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle }), /receipt/);
  // Later symlink updates never need the directory exchange operation.
  const next = await switchTools({ settings, toolsRoot, packageRoot: pkg, idle, exchange: async () => { throw Error('unnecessary exchange'); } });
  assert.equal(next.toolsIdentity, manifest.toolsIdentity);
  const nextReceipt = await json(next.receiptFile);
  await writeFile(path.join(nextReceipt.previous.root, 'legacy.mjs'), 'changed');
  await assert.rejects(switchTools({ settings, toolsRoot, rollbackReceipt: next.receiptFile, idle }), /previous-hashes/);
  // An injected failure after initial exchange restores selection and leaves
  // durable maintenance/transaction evidence; start-check cannot bypass it.
  const badParent = path.join(scratch, 'failed'); await mkdir(badParent, { mode: 0o755 });
  const badTools = path.join(badParent, 'tools'); await mkdir(badTools, { mode: 0o755 });
  await writeFile(path.join(badTools, 'old'), 'preserve', { mode: 0o644 });
  let fail = true;
  const failingExchange = async (first, second) => {
    await exchangePaths(first, second);
    if (fail) { fail = false; await writeFile(path.join(await realpath(first), 'scripts/linux/operator.mjs'), 'corrupt'); }
  };
  await assert.rejects(switchTools({ settings, toolsRoot: badTools, packageRoot: pkg, idle, exchange: failingExchange }), /hashes differ/);
  assert.equal(await readFile(path.join(badTools, 'old'), 'utf8'), 'preserve');
  assert(await exists(path.join(controlDir, 'tools-transaction.json'))); assert(await exists(path.join(controlDir, 'maintenance.json')));
  await assert.rejects(checkStart(settings), /Tools transaction/);
  await assert.rejects(switchTools({ settings, toolsRoot: badTools, packageRoot: pkg, idle }), /maintenance/);
  process.stdout.write('tools-install-ok\n');
} finally {
  assert(path.dirname(scratch) === '/var/tmp' && path.basename(scratch).startsWith('tools-install-test-'));
  await rm(scratch, { recursive: true, force: true });
}
