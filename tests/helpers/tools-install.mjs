// Root subprocess, on synthetic trees only. CI's Linux slice must execute it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { chmod, chown, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { buildTools, toolsClosure } from '../../scripts/linux/tools-package.mjs';
import { exchangePaths, switchTools, recoverToolsSwitch } from '../../scripts/linux/tools-install.mjs';
import { encode, exists, inventory, json, sha } from '../../scripts/linux/files.mjs';
import { checkStart } from '../../scripts/linux/start-check.mjs';
import { assertServiceAccess, assertToolsEntrypoints } from '../../scripts/linux/service-access.mjs';
import { runtimeCliChecks } from '../../scripts/linux/entrypoint-checks.mjs';
import { serviceIdentity } from '../../scripts/linux/prewarm.mjs';
import { serviceQuery } from './prewarm.mjs';
import { lockRelease, prepareBundle, rebaseBundle } from '../../scripts/release/vps/bundle.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp('/var/tmp/tools-install-test-');
const account = { uid: 65534, gid: 65534 }, identity = async () => account;
const install = options => switchTools({ ...options, identity });
try {
  await chmod(scratch, 0o755);
  const source = path.join(scratch, 'source'), pkg = path.join(scratch, 'package');
  for (const row of (await toolsClosure(repo)).files) {
    const file = path.join(source, row.path); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await readFile(path.join(repo, row.path)));
  }
  const manifest = await buildTools(source, pkg);
  const legacy = async destination => {
    await cp(pkg, destination, { recursive: true }); await rm(path.join(destination, 'tools-manifest.json'));
    for (const row of manifest.files.filter(row => row.path.endsWith('.mjs'))) {
      const file = path.join(destination, row.path), text = await readFile(file, 'utf8');
      if (text.includes('import { isMain }')) {
        let legacy = text.replace(/^import \{ isMain \}[^\n]+\n/m, '')
          .replaceAll('isMain(import.meta.url)', 'process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)');
        if (!/^import .*\bfileURLToPath\b.*from ['"]node:url['"]/m.test(legacy)) legacy = "import { fileURLToPath } from 'node:url';\n" + legacy;
        if (!/^import path from ['"]node:path['"]/m.test(legacy)) legacy = "import path from 'node:path';\n" + legacy;
        await writeFile(file, legacy);
      }
    }
  };
  const parent = path.join(scratch, 'installed'); await mkdir(parent, { mode: 0o755 });
  const toolsRoot = path.join(parent, 'tools'); await legacy(toolsRoot);
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
  const oldUmask = process.umask(0o077);
  let installed;
  try { installed = await install({ settings, toolsRoot, packageRoot: pkg, idle, exchange }); }
  finally { process.umask(oldUmask); }
  assert.equal((await lstat(path.join(parent, 'tools-versions'))).mode & 0o777, 0o755);
  assert.equal(exchanges, 1); assert.equal(installed.writerRestarted, false);
  const receipt = await json(installed.receiptFile);
  assert.deepEqual(await inventory(receipt.previous.root), before);
  assert.equal((await json(path.join(await realpath(toolsRoot), 'tools-manifest.json'))).toolsIdentity, manifest.toolsIdentity);
  // Hashes do not encode modes: inaccessible retained trees must refuse rollback.
  for (const file of [receipt.previous.root, path.join(receipt.previous.root, 'legacy.mjs')]) {
    await chmod(file, file === receipt.previous.root ? 0o700 : 0o600);
    await assert.rejects(install({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle }), { code: 'TOOLS_ACCESS' });
    assert.equal(await realpath(toolsRoot), receipt.installed.root);
    await chmod(file, file === receipt.previous.root ? 0o755 : 0o644);
  }
  // Existing path-component drift must fail before publication too.
  await chmod(parent, 0o700);
  await assert.rejects(install({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle }), { code: 'TOOLS_ACCESS' });
  await chmod(parent, 0o755);
  const entry = path.join(await realpath(toolsRoot), 'scripts/linux/serve.mjs');
  await chmod(entry, 0o600);
  await assert.rejects(install({ settings, toolsRoot, packageRoot: pkg, idle }), { code: 'TOOLS_ACCESS' });
  await chmod(entry, 0o644);
  const restored = await install({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle });
  assert.equal(restored.writerRestarted, false); assert.deepEqual(await inventory(await realpath(toolsRoot)), before);
  assert.equal((await lstat(toolsRoot)).isSymbolicLink(), false);
  await assertToolsEntrypoints(toolsRoot, account, runtimeCliChecks, { linked: false });
  const repeatedRollback = await install({ settings, toolsRoot, rollbackReceipt: installed.receiptFile, idle });
  assert.equal(repeatedRollback.alreadyCompleted, true);
  assert.equal(repeatedRollback.receiptFile, restored.receiptFile);
  // After re-migrating the restored directory, later symlink updates need no exchange.
  const next = await install({ settings, toolsRoot, packageRoot: pkg, idle });
  const update = await install({ settings, toolsRoot, packageRoot: pkg, idle, exchange: async () => { throw Error('unnecessary exchange'); } });
  assert.equal(next.toolsIdentity, manifest.toolsIdentity);
  const nextReceipt = await json(next.receiptFile);
  // Roll back the latest update to make next's exact installed selection current.
  await install({ settings, toolsRoot, rollbackReceipt: update.receiptFile, idle });
  await writeFile(path.join(nextReceipt.previous.root, 'legacy.mjs'), 'changed');
  await assert.rejects(install({ settings, toolsRoot, rollbackReceipt: next.receiptFile, idle }), /previous-hashes/);
  // A hash-valid package with a no-op main guard must fail the service-account
  // behavioral check through the alias, before any selection or gate changes.
  const operator = path.join(source, 'scripts/linux/operator.mjs');
  await writeFile(operator, (await readFile(operator, 'utf8')).replace('if (isMain(import.meta.url))', 'if (false)'));
  const noOpPackage = path.join(scratch, 'no-op-package'); await buildTools(source, noOpPackage);
  const selected = await realpath(toolsRoot);
  await assert.rejects(install({ settings, toolsRoot, packageRoot: noOpPackage, idle }), { code: 'TOOLS_ENTRYPOINT' });
  assert.equal(await realpath(toolsRoot), selected);
  assert.equal(await exists(path.join(controlDir, 'tools-transaction.json')), false);
  // An injected failure after initial exchange restores selection and leaves
  // durable maintenance/transaction evidence; start-check cannot bypass it.
  const badParent = path.join(scratch, 'failed'); await mkdir(badParent, { mode: 0o755 });
  const badTools = path.join(badParent, 'tools'); await legacy(badTools);
  const badBefore = await inventory(badTools);
  let fail = true;
  const failingExchange = async (first, second) => {
    await exchangePaths(first, second);
    if (fail) { fail = false; throw Error('Interrupted after exchange'); }
  };
  await assert.rejects(install({ settings, toolsRoot: badTools, packageRoot: pkg, idle, exchange: failingExchange }), /Interrupted/);
  assert(await exists(badTools));
  assert(await exists(path.join(controlDir, 'tools-transaction.json'))); assert(await exists(path.join(controlDir, 'maintenance.json')));
  await assert.rejects(checkStart(settings), /Tools transaction/);
  await assert.rejects(switchTools({ settings, toolsRoot: badTools, packageRoot: pkg, idle }), /maintenance/);
  const deadPid = Number(execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8' }).trim());
  await writeFile(path.join(controlDir, 'operation.lock'), encode({ pid: deadPid, host: hostname(), startedAt: new Date().toISOString() }));
  fail = true;
  await assert.rejects(recoverToolsSwitch({ settings: { ...settings, multiPicker: {} }, toolsRoot: badTools, idle, identity, exchange: failingExchange }), /Interrupted/);
  assert(await exists(badTools));
  await recoverToolsSwitch({ settings, toolsRoot: badTools, idle, identity });
  assert.equal((await lstat(badTools)).isSymbolicLink(), false);
  assert.deepEqual(await inventory(badTools), badBefore);
  // Rollback's exchange can be interrupted too; recovery restores the exact
  // refreshed selection, then the same rollback receipt can be retried.
  const migrated = await install({ settings, toolsRoot: badTools, packageRoot: pkg, idle });
  fail = true;
  await assert.rejects(install({ settings, toolsRoot: badTools, rollbackReceipt: migrated.receiptFile, idle, exchange: failingExchange }), /Interrupted/);
  assert.equal((await lstat(badTools)).isSymbolicLink(), false);
  await recoverToolsSwitch({ settings, toolsRoot: badTools, idle, identity });
  assert.equal((await lstat(badTools)).isSymbolicLink(), true);
  await install({ settings, toolsRoot: badTools, rollbackReceipt: migrated.receiptFile, idle });
  // Empty and partial legacy layouts must never be selected for rollback.
  for (const partial of [false, true]) {
    const missingParent = path.join(scratch, partial ? 'partial' : 'empty'); await mkdir(missingParent);
    const missing = path.join(missingParent, 'tools');
    if (partial) { await legacy(missing); await rm(path.join(missing, 'scripts/linux/operator.mjs')); }
    else await mkdir(missing);
    const upgrade = await install({ settings, toolsRoot: missing, packageRoot: pkg, idle });
    await assert.rejects(install({ settings, toolsRoot: missing, rollbackReceipt: upgrade.receiptFile, idle }), { code: 'TOOLS_ENTRYPOINT' });
    assert.equal((await lstat(missing)).isSymbolicLink(), true);
  }
  // A forged uid/gid assertion must refuse before touching the selected path.
  const settingsWithOverride = { ...settings, service: 'chunk-picker.service', serviceUid: account.uid, serviceGid: account.gid };
  await assert.rejects(switchTools({ settings: settingsWithOverride, toolsRoot: badTools, packageRoot: pkg, idle,
    identity: () => serviceIdentity(settingsWithOverride, serviceQuery({ uid: 1201, gid: 1202 })) }), { code: 'TOOLS_ACCESS' });
  const validUpgrade = await install({ settings, toolsRoot: badTools, packageRoot: pkg, idle });
  await assert.rejects(switchTools({ settings: settingsWithOverride, toolsRoot: badTools, rollbackReceipt: validUpgrade.receiptFile, idle,
    identity: () => serviceIdentity(settingsWithOverride, serviceQuery({ uid: 1201, gid: 1202 })) }), { code: 'TOOLS_ACCESS' });
  await assert.rejects(assertToolsEntrypoints(badTools, account, []), { code: 'TOOLS_ENTRYPOINT' });
  // The release lock must use the resolved service group, even beside root:root
  // releases; the access gate catches both group mistakes and ancestor drift.
  const releases = path.join(scratch, 'releases'), candidate = path.join(releases, 'candidate');
  await mkdir(releases); await chmod(releases, 0o755); await chown(releases, 0, 0);
  await mkdir(candidate); await writeFile(path.join(candidate, 'entry.mjs'), 'export {};');
  await lockRelease(candidate, 0);
  await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' });
  await lockRelease(candidate, account.gid);
  await assertServiceAccess(candidate, account, ['entry.mjs']);
  await chmod(releases, 0o700);
  await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' });
  await chmod(releases, 0o755);
  await writeFile(path.join(candidate, 'entry.mjs'), 'export ???');
  await assert.rejects(assertServiceAccess(candidate, account, ['entry.mjs']), { code: 'TOOLS_ACCESS' });
  // Run real rebase against a root:root parent with only the systemd/NSS
  // identity seam synthetic. A drifted ancestor cannot receive a verified receipt.
  const seed = path.join(scratch, 'seed'), transportTools = path.join(scratch, 'transport-tools');
  for (const dir of ['core/app', 'packs', 'addons']) await mkdir(path.join(seed, dir), { recursive: true });
  await writeFile(path.join(seed, 'core/app/server.mjs'), 'export {};');
  await writeFile(path.join(seed, 'profile.json'), '{}');
  const configFile = path.join(seed, 'config.json'), dataDir = path.join(scratch, 'synthetic-game');
  const configBytes = encode({ coreRoot: path.join(seed, 'core'), dataDir, packs: {} });
  await writeFile(configFile, configBytes);
  const current = path.join(scratch, 'release-current.json');
  await writeFile(current, encode({ config: { path: configFile, sha256: sha(configBytes) } }));
  const operatorFile = path.join(scratch, 'release-operator.json');
  await writeFile(operatorFile, encode({ current, dataDir }));
  await mkdir(path.join(transportTools, 'scripts/linux'), { recursive: true });
  await writeFile(path.join(transportTools, 'scripts/linux/runtime.mjs'),
    `export { readRelease, assertServiceAccess } from ${JSON.stringify(pathToFileURL(path.join(repo, 'scripts/linux/runtime.mjs')).href)};\n`
    + `import { serviceIdentity as resolve } from ${JSON.stringify(pathToFileURL(path.join(repo, 'scripts/linux/prewarm.mjs')).href)};\n`
    + `import { serviceQuery } from ${JSON.stringify(pathToFileURL(path.join(repo, 'tests/helpers/prewarm.mjs')).href)};\n`
    + `export const serviceIdentity = settings => resolve(settings, serviceQuery(${JSON.stringify(account)}));\n`);
  await writeFile(operatorFile, encode({ service: 'chunk-picker.service', current, dataDir }));
  const upload = path.join(scratch, 'upload'), rebased = path.join(releases, 'rebased');
  await prepareBundle(seed, upload); await rebaseBundle(upload, rebased, operatorFile, transportTools);
  assert.equal((await lstat(rebased)).gid, account.gid);
  await assertServiceAccess(rebased, account, ['core/app/server.mjs']);
  assert(await exists(path.join(upload, 'verified.json')));
  const forgedUpload = path.join(scratch, 'forged-upload'); await prepareBundle(seed, forgedUpload);
  await writeFile(operatorFile, encode({ service: 'chunk-picker.service', current, dataDir, serviceUid: 1201, serviceGid: 1202 }));
  await assert.rejects(rebaseBundle(forgedUpload, path.join(releases, 'forged-identity'), operatorFile, transportTools), /override differs/);
  assert.equal(await exists(path.join(forgedUpload, 'verified.json')), false);
  await writeFile(operatorFile, encode({ service: 'chunk-picker.service', current, dataDir }));
  const badUpload = path.join(scratch, 'bad-upload'); await prepareBundle(seed, badUpload);
  await chmod(releases, 0o700);
  await assert.rejects(rebaseBundle(badUpload, path.join(releases, 'inaccessible'), operatorFile, transportTools), { code: 'TOOLS_ACCESS' });
  assert.equal(await exists(path.join(badUpload, 'verified.json')), false);
  await chmod(releases, 0o755);
  process.stdout.write('tools-install-ok\n');
} finally {
  assert(path.dirname(scratch) === '/var/tmp' && path.basename(scratch).startsWith('tools-install-test-'));
  await rm(scratch, { recursive: true, force: true });
}
