import { step } from './tools-install-progress.mjs';
// Linux root subprocess. Exact historical public package, synthetic installs,
// real SIGKILL and privilege-dropped probes; no systemd or network operations.
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { buildTools, verifyTools, toolsClosure } from '../../scripts/linux/tools-package.mjs';
import { currentToolsContract, toolsContract, toolsContracts } from '../../scripts/linux/tools-contracts.mjs';
import { recoverToolsSwitch, switchTools } from '../../scripts/linux/tools-install.mjs';
import { encode, exists, inventory, json, sha } from '../../scripts/linux/files.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const archive = path.join(repo, 'tests/fixtures/tools-128/package.tar.gz');
const earlierIdentity = '79eb28369aa720d256d64ba088de6600cbc13522d81660bdaf9264c9632bc94c';
const scratch = await mkdtemp('/var/tmp/tools-contract-test-');
const account = { uid: 65534, gid: 65534 }, identity = async () => account, idle = async () => {};
const install = options => step("switch selection", () => switchTools({ ...options, identity, idle }));
const recover = options => step("recover selection", () => recoverToolsSwitch({ ...options, identity, idle }));
try {
  await chmod(scratch, 0o755);
  assert.equal(sha(await readFile(archive)), 'c0907c9ef7b14e29a94400afdb88edceb3e75131af242568f43418f2a417bbb9');
  const earlier = path.join(scratch, 'earlier'), latest = path.join(scratch, 'latest');
  await mkdir(earlier);
  execFileSync('tar', ['-xzf', archive, '-C', earlier], { stdio: 'pipe' });
  const oldManifest = await verifyTools(earlier), newManifest = await buildTools(repo, latest);
  assert.equal(oldManifest.toolsIdentity, earlierIdentity);
  assert.equal(oldManifest.files.length, 49);
  assert.equal(Object.hasOwn(oldManifest, 'contractVersion'), false);
  assert.equal(toolsContract(oldManifest).version, 1);
  assert.equal(newManifest.contractVersion, currentToolsContract.version);
  const parent = path.join(scratch, 'installed'), toolsRoot = path.join(parent, 'tools');
  const controlDir = path.join(scratch, 'control'), settings = { controlDir };
  await mkdir(parent); await mkdir(controlDir);
  await cp(earlier, toolsRoot, { recursive: true }); await rm(path.join(toolsRoot, 'tools-manifest.json'));
  const options = { settings, toolsRoot };
  const selected = async expected => {
    const root = await realpath(toolsRoot);
    assert.equal((await verifyTools(root)).toolsIdentity, expected);
    return root;
  };
  // Real install, package-to-package upgrade, rollback, and completed rollback
  // retry all use the newest installer and the package's own CLI probe contract.
  assert.equal((await install({ ...options, packageRoot: earlier })).toolsIdentity, earlierIdentity);
  await selected(earlierIdentity);
  const upgrade = await install({ ...options, packageRoot: latest });
  await selected(newManifest.toolsIdentity);
  await install({ ...options, rollbackReceipt: upgrade.receiptFile });
  await selected(earlierIdentity);
  assert.equal((await install({ ...options, rollbackReceipt: upgrade.receiptFile })).alreadyCompleted, true);
  assert.equal((await recover(options)).result, 'no-pending-switch');

  // A synthetic version-2 package uses the reviewed v2 roots/probes and exact
  // current compatible module bytes. The immutable #128 fixture above still
  // separately proves the real unversioned v1-to-current transition.
  const v2Root = path.join(scratch, 'version-2'), v2Contract = toolsContracts.find(row => row.version === 2);
  const v2Closure = await toolsClosure(repo, v2Contract.closureRoots);
  await mkdir(v2Root, { mode: 0o755 });
  for (const row of v2Closure.files) {
    const file = path.join(v2Root, row.path); await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
    await writeFile(file, await readFile(path.join(repo, row.path)), { mode: 0o644 });
  }
  const v2Body = { format: 'picker-tools-v1', contractVersion: v2Contract.version, ...v2Closure };
  await writeFile(path.join(v2Root, 'tools-manifest.json'), encode({ ...v2Body, toolsIdentity: sha(encode(v2Body)) }), { mode: 0o644 });
  const v2Manifest = await verifyTools(v2Root);
  assert.equal(toolsContract(v2Manifest), v2Contract);
  assert(!v2Manifest.entries.includes('scripts/linux/inflate-owned-format-1.mjs'));
  await install({ ...options, packageRoot: v2Root });
  const installedV2 = await selected(v2Manifest.toolsIdentity), v2Before = await inventory(installedV2);
  const v2Upgrade = await install({ ...options, packageRoot: latest });
  await selected(newManifest.toolsIdentity);
  await install({ ...options, rollbackReceipt: v2Upgrade.receiptFile });
  assert.equal(await selected(v2Manifest.toolsIdentity), installedV2);
  assert.deepEqual(await inventory(installedV2), v2Before);
  assert.equal((await install({ ...options, rollbackReceipt: v2Upgrade.receiptFile })).alreadyCompleted, true);
  assert.equal((await recover(options)).result, 'no-pending-switch');
  await install({ ...options, packageRoot: earlier }); await selected(earlierIdentity);

  // An attacker can recompute an identity. Contract recognition still refuses
  // unknown versions and any changed unversioned historical entry inventory.
  const manifestFile = path.join(earlier, 'tools-manifest.json'), original = await readFile(manifestFile);
  for (const change of [body => { body.contractVersion = 999; }, body => { body.entries.pop(); },
    body => { body.entries.push('scripts/linux/notify.mjs'); }]) {
    const { toolsIdentity, ...body } = oldManifest; change(body);
    await writeFile(manifestFile, encode({ ...body, toolsIdentity: sha(encode(body)) }));
    const before = await selected(earlierIdentity);
    await assert.rejects(install({ ...options, packageRoot: earlier }), { code: 'TOOLS_HASH' });
    assert.equal(await realpath(toolsRoot), before);
    assert.equal(await exists(path.join(controlDir, 'tools-transaction.json')), false);
  }
  await writeFile(manifestFile, original);

  const installer = pathToFileURL(path.join(repo, 'scripts/linux/tools-install.mjs')).href;
  for (const action of ['install', 'rollback']) {
    let switching = { ...options, packageRoot: latest };
    if (action === 'rollback') {
      switching = { ...options, rollbackReceipt: (await install(switching)).receiptFile };
      await selected(newManifest.toolsIdentity);
    }
    for (const point of ['after-journal', 'after-selection', 'after-receipt', 'after-commit']) {
      process.stderr.write(`tools crash boundary: ${action} ${point}\n`);
      const beforeRoot = await realpath(toolsRoot), before = await inventory(beforeRoot);
      const anchor = {
        'after-journal': "await atomic(transaction, encode(record)); await atomic(maintenance, encode({ command: 'tools-switch' }));",
        'after-selection': 'switched = true; await syncDirectory(parent);',
        'after-receipt': 'await atomic(receiptFile, encode(receipt));',
        'after-commit': 'await rm(maintenance); await rm(transaction); await syncDirectory(settings.controlDir);',
      }[point];
      const hook = `import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
          const loaded = next(url, context);
          if (url !== ${JSON.stringify(installer)}) return loaded;
          const source = String(loaded.source), anchor = ${JSON.stringify(anchor)};
          if (!source.includes(anchor)) throw Error('Kill boundary missing');
          return { ...loaded, source: source.replaceAll(anchor, anchor + "; process.kill(process.pid, 'SIGKILL');") };
        }});
        const { switchTools } = await import(${JSON.stringify(installer)});
        await switchTools({ ...${JSON.stringify(switching)}, idle: async () => {}, identity: async () => (${JSON.stringify(account)}) });`;
      assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', hook],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } }),
      error => error.signal === 'SIGKILL', `${action} ${point}`);
      assert(await exists(path.join(controlDir, 'operation.lock')));
      const committed = point === 'after-commit';
      assert.equal(await exists(path.join(controlDir, 'tools-transaction.json')), !committed);
      if (point !== 'after-journal') assert.notEqual(await realpath(toolsRoot), beforeRoot);
      const recovered = await recover(options);
      if (committed) {
        assert.equal(recovered.result, 'no-pending-switch');
        await selected(action === 'install' ? newManifest.toolsIdentity : earlierIdentity);
        if (action === 'install') {
          await install({ ...options, rollbackReceipt: recovered.receiptFile });
          await selected(earlierIdentity);
        }
      } else {
        assert.equal((await json(recovered.receiptFile)).result, 'recovered');
        assert.equal(await realpath(toolsRoot), beforeRoot);
        assert.deepEqual(await inventory(beforeRoot), before);
        await selected(action === 'install' ? earlierIdentity : newManifest.toolsIdentity);
      }
      assert.equal(await exists(path.join(controlDir, 'tools-transaction.json')), false);
      assert.equal(await exists(path.join(controlDir, 'maintenance.json')), false);
      assert.equal(await exists(path.join(controlDir, 'operation.lock')), false);
    }
  }
  process.stdout.write('tools-contracts-ok\n');
} finally {
  assert(path.dirname(scratch) === '/var/tmp' && path.basename(scratch).startsWith('tools-contract-test-'));
  await rm(scratch, { recursive: true, force: true });
}
