import { isMain } from '../release/vps/entrypoint.mjs';
// Linux root only. This command NEVER starts/stops a service or opens a save.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, open, readlink, realpath, rename, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomic, copyTree, encode, exclusive, exists, inventory, json, noLinks, outside, sha } from './files.mjs';
import { operatorSettings } from './runtime.mjs';
import { verifyTools } from './tools-package.mjs';
import { serviceOperation } from './service-lock.mjs';
import { assertServiceAccess, assertToolsEntrypoints, serviceIdentity } from './service-access.mjs';
import { toolsCliChecks } from './entrypoint-checks.mjs';

const execute = promisify(execFile);
const refuse = category => { throw Object.assign(Error('Tools switch refused: ' + category + '.'), { code: 'TOOLS_' + category.toUpperCase() }); };
export async function operatorUnitsIdle(query = execute) {
  for (const service of ['chunk-picker-backup.service', 'chunk-picker-health.service']) {
    const { stdout } = await query('/usr/bin/systemctl', ['show', '--property=ActiveState,SubState,MainPID', '--', service],
      { timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } });
    const fields = Object.fromEntries(stdout.trim().split('\n').map(row => row.split('=')));
    if (!['inactive', 'failed'].includes(fields.ActiveState) || !['dead', 'failed'].includes(fields.SubState) || fields.MainPID !== '0') refuse('active-run');
  }
}
export async function cleanToolsEvidence(settings, { locked = false } = {}) {
  const control = settings.controlDir;
  if (!locked && await exists(path.join(control, 'operation.lock'))) refuse('lock');
  if (await exists(path.join(control, 'maintenance.json'))) refuse('maintenance');
  for (const name of ['activation.json', 'start-permit.json', 'transaction.json', 'tools-transaction.json']) {
    if (await exists(path.join(control, name))) refuse('transaction');
  }
  const recovery = path.join(control, 'service-restore', 'progress.json');
  if (await exists(recovery)) {
    let progress;
    try { progress = await json(recovery); } catch { refuse('receipt'); }
    if (progress?.phase !== 'complete') refuse('transaction');
  }
}
async function syncDirectory(directory) {
  const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); }
}
// rename cannot replace a nonempty directory with a symlink. renameat2's
// RENAME_EXCHANGE makes the initial migration a single filesystem operation.
// Python's stdlib ctypes is used instead of a compiler/native npm dependency.
export async function exchangePaths(first, second) {
  await execute('/usr/bin/python3', ['-c',
    'import ctypes,os,sys\nlib=ctypes.CDLL(None,use_errno=True)\nf=lib.renameat2\nf.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nf.restype=ctypes.c_int\nr=f(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),2)\nif r: raise OSError(ctypes.get_errno(),"atomic tools exchange refused")', first, second],
    { timeout: 10000, maxBuffer: 4096 });
}
async function selection(toolsRoot) {
  const info = await lstat(toolsRoot);
  if (!info.isDirectory() && !info.isSymbolicLink()) refuse('selection');
  const root = info.isSymbolicLink() ? await realpath(toolsRoot) : toolsRoot;
  await noLinks(root);
  const files = await inventory(root);
  const manifest = await exists(path.join(root, 'tools-manifest.json')) ? await verifyTools(root) : null;
  return { root, linked: info.isSymbolicLink(), link: info.isSymbolicLink() ? await readlink(toolsRoot) : null,
    treeIdentity: sha(encode(files)), toolsIdentity: manifest?.toolsIdentity ?? null };
}
async function verifySelection(root, expected) {
  await noLinks(root);
  if (sha(encode(await inventory(root))) !== expected.treeIdentity) refuse('previous-hashes');
  if (expected.toolsIdentity && (await verifyTools(root)).toolsIdentity !== expected.toolsIdentity) refuse('previous-hashes');
}
export async function switchTools({ settings, toolsRoot, packageRoot, rollbackReceipt,
  idle = operatorUnitsIdle, exchange = exchangePaths, identity = () => serviceIdentity(settings) }) {
  if (process.platform !== 'linux' || process.getuid() !== 0) refuse('linux-root');
  toolsRoot = path.resolve(toolsRoot);
  const parent = path.dirname(toolsRoot), versions = path.join(parent, 'tools-versions');
  await noLinks(parent); await noLinks(settings.controlDir);
  outside(settings.controlDir, toolsRoot); outside(toolsRoot, settings.controlDir);
  await cleanToolsEvidence(settings); await idle();
  const runLocked = work => settings.multiPicker ? serviceOperation(settings, 'tools-switch', work)
    : exclusive(path.join(settings.controlDir, 'operation.lock'), work);
  return runLocked(async () => {
    await cleanToolsEvidence(settings, { locked: true }); await idle();
    const previous = await selection(toolsRoot);
    // Selected symlinks must stay inside our root-owned version namespace.
    if (previous.linked && path.dirname(previous.root) !== versions) refuse('selection');
    const id = randomUUID(), temporary = path.join(parent, '.tools-switch-' + id);
    await mkdir(versions, { recursive: true, mode: 0o755 }); await noLinks(versions);
    // mkdir's mode is filtered through the caller's umask. This namespace is
    // installer-owned; existing ancestors and retained trees are validated below
    // rather than broadening permissions on unrelated system directories.
    await chmod(versions, 0o755);
    let target, targetIdentity, undo;
    if (rollbackReceipt) {
      await noLinks(rollbackReceipt);
      try { undo = await json(rollbackReceipt); } catch { refuse('receipt'); }
      if (undo?.format !== 'picker-tools-switch-v1' || undo.result !== 'success' || undo.action !== 'install'
        || undo.toolsRoot !== toolsRoot || undo.installed?.toolsIdentity !== previous.toolsIdentity
        || undo.installed?.treeIdentity !== previous.treeIdentity || typeof undo.previous?.root !== 'string'
        || path.dirname(undo.previous.root) !== versions) refuse('receipt');
      target = undo.previous.root; await verifySelection(target, undo.previous); targetIdentity = undo.previous;
    } else {
      packageRoot = path.resolve(packageRoot);
      outside(parent, packageRoot); outside(packageRoot, parent);
      const manifest = await verifyTools(packageRoot);
      target = path.join(versions, manifest.toolsIdentity + '-' + id);
      await copyTree(packageRoot, target);
      // copyTree deliberately makes private recovery directories. Tools must be
      // readable by the service, immutable to it, and durable before selection.
      for (const row of [...await inventory(target), { path: '', directory: true }]) {
        const file = path.join(target, row.path);
        await chmod(file, row.directory ? 0o755 : 0o644);
        if (!row.directory) { const handle = await open(file, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
      }
      for (const row of [...await inventory(target)].filter(row => row.directory).reverse()) await syncDirectory(path.join(target, row.path));
      await syncDirectory(target); await syncDirectory(versions);
      await verifyTools(target); targetIdentity = await selection(target);
    }
    const ancestors = [];
    for (let at = parent; ; at = path.dirname(at)) {
      ancestors.push(at); if (at === path.dirname(at)) break;
    }
    for (const root of new Set([...ancestors, versions, target, previous.root])) {
      const rows = ancestors.includes(root) || root === versions ? [] : await inventory(root);
      const parentInfo = await lstat(root);
      if (parentInfo.uid !== 0 || (parentInfo.mode & 0o022)
        && !(ancestors.includes(root) && root !== parent && parentInfo.mode & 0o1000)) refuse('ownership');
      for (const row of rows) {
        const info = await lstat(path.join(root, row.path));
        if (info.uid !== 0 || info.mode & 0o022) refuse('ownership');
      }
    }
    let account;
    try { account = await identity(); } catch { refuse('access'); }
    for (const root of new Set([target, previous.root])) {
      const manifest = await exists(path.join(root, 'tools-manifest.json')) ? await verifyTools(root) : null;
      const entries = manifest?.entries ?? (await inventory(root)).filter(row => /\.mjs$/.test(row.path)).map(row => row.path);
      await assertServiceAccess(root, account, entries);
      if (root === target) {
        const checks = [];
        for (const check of toolsCliChecks) if (manifest || await exists(path.join(root, check[0]))) checks.push(check);
        if (checks.length) await assertToolsEntrypoints(root, account, checks);
      }
    }
    await verifySelection(previous.root, previous); await idle();
    const transaction = path.join(settings.controlDir, 'tools-transaction.json');
    const maintenance = path.join(settings.controlDir, 'maintenance.json');
    const receiptFile = path.join(settings.controlDir, 'tools-receipt-' + id + '.json');
    const record = { format: 'picker-tools-switch-v1', action: undo ? 'rollback' : 'install',
      startedAt: new Date().toISOString(), toolsRoot, previous, target, writerRestarted: false, temporary,
      retainedRoot: previous.linked ? previous.root : path.join(versions, 'legacy-' + id) };
    // Both gates persist if switching or verification becomes uncertain. Old
    // installed operators already understand maintenance.json.
    await atomic(transaction, encode(record)); await atomic(maintenance, encode({ command: 'tools-switch' }));
    let switched = false, retained;
    try {
      await symlink(target, temporary, 'dir');
      if (previous.linked) await rename(temporary, toolsRoot);
      else { await exchange(toolsRoot, temporary); retained = temporary; }
      switched = true; await syncDirectory(parent);
      if (undo) await verifySelection(await realpath(toolsRoot), targetIdentity);
      else await verifyTools(await realpath(toolsRoot));
      if (retained) {
        const saved = record.retainedRoot;
        await rename(retained, saved); retained = saved; previous.root = saved;
        await syncDirectory(versions); await syncDirectory(parent);
      }
      const installed = await selection(toolsRoot);
      const receipt = { ...record, previous, installed, completedAt: new Date().toISOString(), result: 'success' };
      await atomic(receiptFile, encode(receipt));
      await rm(maintenance); await rm(transaction); await syncDirectory(settings.controlDir);
      return { receiptFile, toolsIdentity: installed.toolsIdentity, writerRestarted: false };
    } catch (error) {
      // No automatic writer operation. Revert only a provably owned selection.
      // Uncertain failures retain both gates and all trees for reconciliation.
      if (switched && await realpath(toolsRoot).catch(() => null) === target) {
        if (!previous.linked && retained) await exchange(toolsRoot, retained);
        else { await rm(temporary, { force: true }); await symlink(previous.root, temporary, 'dir'); await rename(temporary, toolsRoot); }
        await syncDirectory(parent);
      }
      await atomic(receiptFile, encode({ ...record, result: 'failed', completedAt: new Date().toISOString() }));
      throw error;
    }
  });
}
const refusalCategories = Object.freeze({
  TOOLS_ACTIVE_RUN: 'timer active', 'TOOLS_ACTIVE-RUN': 'timer active', TOOLS_LOCK: 'lock held', EEXIST: 'lock held',
  OPERATOR_LOCK_LONG_HELD: 'lock held', TOOLS_MAINTENANCE: 'maintenance', TOOLS_TRANSACTION: 'transaction evidence',
  TOOLS_RECEIPT: 'receipt invalid', TOOLS_OWNERSHIP: 'ownership/access', TOOLS_ACCESS: 'ownership/access',
  EACCES: 'ownership/access', EPERM: 'ownership/access', TOOLS_HASH: 'hash mismatch', 'TOOLS_PREVIOUS-HASHES': 'hash mismatch',
  TOOLS_SELECTION: 'selection invalid', 'TOOLS_LINUX-ROOT': 'Linux root required', TOOLS_ARGUMENTS: 'arguments invalid',
  TOOLS_ENTRYPOINT: 'entrypoint behavior',
});
export const toolsRefusal = error => 'Tools switch refused: '
  + (Object.hasOwn(refusalCategories, error?.code) ? refusalCategories[error.code] : 'unclassified')
  + '; inspect transaction evidence privately.\n';
export async function toolsInstallCli(args, { settings = operatorSettings, switcher = switchTools,
  stdout = text => process.stdout.write(text), stderr = text => process.stderr.write(text) } = {}) {
  try {
    const [command, toolsRoot, input, ...extra] = args;
    if (!['install', 'rollback'].includes(command) || !path.isAbsolute(toolsRoot ?? '') || !path.isAbsolute(input ?? '') || extra.length) refuse('arguments');
    const result = await switcher({ settings: await settings(), toolsRoot,
      ...(command === 'install' ? { packageRoot: input } : { rollbackReceipt: input }) });
    stdout(encode(result)); return 0;
  } catch (error) { stderr(toolsRefusal(error)); return 1; }
}
if (isMain(import.meta.url)) {
  process.exitCode = await toolsInstallCli(process.argv.slice(2));
}
