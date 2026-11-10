import { step } from './tools-install-progress.mjs';
// Root subprocess; real SIGKILL at the two unjournaled boundaries, synthetic trees only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { buildTools } from '../../scripts/linux/tools-package.mjs';
import { recoverToolsSwitch, switchTools, toolsInstallCli } from '../../scripts/linux/tools-install.mjs';
import { exclusive, exists, inventory, json } from '../../scripts/linux/files.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp('/var/tmp/tools-crash-test-');
const account = { uid: 65534, gid: 65534 }, identity = async () => account, idle = async () => {};
const installer = pathToFileURL(path.join(repo, 'scripts/linux/tools-install.mjs')).href;
const switcher = options => step("switch selection", () => switchTools({ ...options, identity, idle }));
const recover = options => step("recover selection", () => recoverToolsSwitch({ ...options, identity, idle }));
try {
  await chmod(scratch, 0o755);
  const pkg = path.join(scratch, 'package');
  await buildTools(repo, pkg);
  for (const action of ['install', 'rollback']) for (const point of ['before-journal', 'after-journal-removal']) {
    // Separate crashes prove ordinary retry can reclaim the lock without recovery
    // first, and recovery itself can reclaim it without help from a retry.
    for (const route of ['retry', 'recover']) {
      process.stderr.write(`tools crash boundary: ${action} ${point} ${route}\n`);
      const parent = path.join(scratch, `${action}-${point}-${route}`);
      const toolsRoot = path.join(parent, 'tools'), controlDir = path.join(parent, 'control');
      await mkdir(parent, { mode: 0o755 }); await mkdir(controlDir);
      await cp(pkg, toolsRoot, { recursive: true }); await rm(path.join(toolsRoot, 'tools-manifest.json'));
      const settings = { controlDir };
      const options = { settings, toolsRoot, ...(action === 'install' ? { packageRoot: pkg }
        : { rollbackReceipt: (await switcher({ settings, toolsRoot, packageRoot: pkg })).receiptFile }) };
      const before = await inventory(await realpath(toolsRoot));
      const hook = `import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
          const loaded = next(url, context);
          if (url !== ${JSON.stringify(installer)}) return loaded;
          const anchor = ${JSON.stringify(point === 'before-journal' ? 'await atomic(transaction, encode(record));'
            : 'await rm(maintenance); await rm(transaction);')};
          const source = String(loaded.source);
          if (!source.includes(anchor)) throw Error('Kill boundary missing');
          return { ...loaded, source: source.replaceAll(anchor, ${JSON.stringify(point === 'before-journal'
            ? "process.kill(process.pid, 'SIGKILL'); " : '')} + anchor + ${JSON.stringify(point === 'after-journal-removal'
            ? " process.kill(process.pid, 'SIGKILL');" : '')}) };
        }});
        const { switchTools } = await import(${JSON.stringify(installer)});
        await switchTools({ ...${JSON.stringify(options)}, idle: async () => {}, identity: async () => (${JSON.stringify(account)}) });`;
      assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', hook],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } }),
      error => error.signal === 'SIGKILL', `${action} ${point} ${route}`);
      assert(await exists(path.join(controlDir, 'operation.lock')));
      assert.equal(await exists(path.join(controlDir, 'tools-transaction.json')), false);
      assert.equal(await exists(path.join(controlDir, 'maintenance.json')), false);
      const after = await inventory(await realpath(toolsRoot));
      if (point === 'before-journal') assert.deepEqual(after, before);
      const versions = path.join(parent, 'tools-versions'), prepared = await readdir(versions);
      if (route === 'retry') {
        const retried = await switcher(options);
        assert(await exists(retried.receiptFile));
        if (action === 'rollback' && point === 'after-journal-removal') assert.equal(retried.alreadyCompleted, true);
      }
      let output = '', errors = '';
      assert.equal(await toolsInstallCli(['recover', toolsRoot], { settings: async () => settings, recover,
        stdout: text => output += text, stderr: text => errors += text }), 0, errors);
      const status = JSON.parse(output);
      assert.equal(status.result, 'no-pending-switch');
      assert.equal(status.writerRestarted, false);
      assert.equal(status.selection.linked, route === 'retry' ? action === 'install'
        : point === 'before-journal' ? action === 'rollback' : action === 'install');
      if (route === 'recover') assert.deepEqual(await inventory(status.selection.root), after);
      if (action === 'install' && point === 'before-journal' && route === 'recover') assert.equal(status.receiptFile, null);
      else assert.equal((await json(status.receiptFile)).result, 'success');
      assert.equal(await exists(path.join(controlDir, 'operation.lock')), false);
      for (const name of prepared) assert(await exists(path.join(versions, name)), 'prepared trees stay for inspection');
      if (route === 'recover') await switcher(options);
      assert.equal((await lstat(toolsRoot)).isSymbolicLink(), action === 'install');
    }
  }
  // A real live owner and an arbitrary record must be left byte-for-byte intact.
  const parent = path.join(scratch, 'ownership'); await mkdir(parent, { mode: 0o755 });
  const controlDir = path.join(parent, 'control'), toolsRoot = path.join(parent, 'tools');
  await mkdir(controlDir); await cp(pkg, toolsRoot, { recursive: true });
  const settings = { controlDir }, lock = path.join(controlDir, 'operation.lock');
  const refuseBusy = async () => {
    const bytes = await readFile(lock);
    await assert.rejects(switcher({ settings, toolsRoot, packageRoot: pkg }), { code: 'EEXIST' });
    await assert.rejects(switcher({ settings, toolsRoot, rollbackReceipt: path.join(parent, 'unused-receipt.json') }), { code: 'EEXIST' });
    await assert.rejects(recover({ settings, toolsRoot }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(lock), bytes);
    assert.equal(await exists(path.join(parent, 'tools-versions')), false);
  };
  await exclusive(lock, refuseBusy);
  await writeFile(lock, '{}'); await refuseBusy(); await rm(lock);
  // No-journal recovery still refuses unrelated gates, unsafe selections and receipts.
  for (const [name, code] of [['maintenance.json', 'TOOLS_MAINTENANCE'], ['activation.json', 'TOOLS_TRANSACTION'],
    ['start-permit.json', 'TOOLS_TRANSACTION'], ['transaction.json', 'TOOLS_TRANSACTION']]) {
    await writeFile(path.join(controlDir, name), '{}');
    await assert.rejects(recover({ settings, toolsRoot }), { code });
    assert(await exists(path.join(controlDir, name))); await rm(path.join(controlDir, name));
  }
  const progress = path.join(controlDir, 'service-restore', 'progress.json');
  await mkdir(path.dirname(progress)); await writeFile(progress, '{"phase":"copying"}');
  await assert.rejects(recover({ settings, toolsRoot }), { code: 'TOOLS_TRANSACTION' });
  await writeFile(progress, '{"phase":"complete"}');
  await chmod(toolsRoot, 0o777);
  await assert.rejects(recover({ settings, toolsRoot }), { code: 'TOOLS_OWNERSHIP' });
  await chmod(toolsRoot, 0o755);
  const receipt = path.join(controlDir, 'tools-receipt-00000000-0000-0000-0000-000000000000.json');
  await writeFile(receipt, '{');
  await assert.rejects(recover({ settings, toolsRoot }), { code: 'TOOLS_RECEIPT' });
  await rm(receipt); await symlink(path.join(pkg, 'tools-manifest.json'), receipt);
  await assert.rejects(recover({ settings, toolsRoot }), { code: 'TOOLS_RECEIPT' });
  process.stdout.write('tools-crashes-ok\n');
} finally {
  assert(path.dirname(scratch) === '/var/tmp' && path.basename(scratch).startsWith('tools-crash-test-'));
  await rm(scratch, { recursive: true, force: true });
}
