import path from 'node:path';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertReleased, atomic, copyTree, directory, encode, exists, headroom, inventory, json, noLinks, outside, sha } from './files.mjs';
import { assertSameRelease } from './runtime.mjs';
import { assertCompatibleStep } from '../private-companion/release-compatibility.mjs';

export async function runProbe(release, dataDir, output) {
  return runChildProbe(release, dataDir, output, 'portable');
}
export async function runCompatibilityProbe(release, dataDir, output) {
  return runChildProbe(release, dataDir, output, 'compatibility');
}
async function runChildProbe(release, dataDir, output, mode) {
  // Pass only an explicit config file, never credentials in argv or diagnostics.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(new URL('./probe.mjs', import.meta.url)), release.pointer.config.path, dataDir, output, mode],
      { env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, stdio: 'ignore', windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 180000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Recovery probe could not start.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(new Error('Recovery probe refused or timed out.')); });
  });
  const document = await json(output);
  if (mode === 'portable' && (document.format !== 'rs3-chunk-picker' || !document.state?.members?.length)) throw new Error('Invalid portable export.');
  return document;
}
export async function storeIdentity(dataDir) {
  await assertReleased(dataDir);
  await noLinks(dataDir + '.dataset.json');
  return { files: await inventory(dataDir), binding: sha(await readFile(dataDir + '.dataset.json')) };
}
async function snapshot(dataDir, target, binding) {
  await copyTree(dataDir, target);
  await writeFile(target + '.dataset.json', binding ?? await readFile(dataDir + '.dataset.json'), { flag: 'wx', mode: 0o600 });
}
export async function backupStopped({ dataDir, backupDir, scratchRoot, release, keep = 30, minFreeBytes, probe = runProbe }) {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('Backup count must be positive.');
  outside(dataDir, backupDir); outside(backupDir, dataDir); outside(dataDir, scratchRoot); outside(backupDir, scratchRoot);
  await directory(backupDir); await directory(scratchRoot);
  const before = await storeIdentity(dataDir);
  const size = before.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  // Stage store + probe copy + potentially expanded portable export. Check both filesystems.
  await headroom(backupDir, size * 3, minFreeBytes); await headroom(scratchRoot, size * 3, minFreeBytes);
  const stage = await mkdtemp(path.join(backupDir, '.pending-'));
  const scratch = await mkdtemp(path.join(scratchRoot, 'backup-'));
  try {
    await snapshot(dataDir, path.join(stage, 'store'));
    await snapshot(path.join(stage, 'store'), path.join(scratch, 'store'));
    await probe(release, path.join(scratch, 'store'), path.join(stage, 'portable.json'));
    await assertSameRelease(release);
    if (encode(before) !== encode(await storeIdentity(dataDir))) throw new Error('Stopped store changed during backup.');
    const files = await inventory(stage);
    await writeFile(path.join(stage, 'manifest.json'), encode({ format: 'picker-recovery-v1', createdAt: new Date().toISOString(), files }), { flag: 'wx', mode: 0o600 });
    await verifyBackup(stage);
    await headroom(backupDir, 0, minFreeBytes);
    const name = 'recovery-' + new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID();
    const target = path.join(backupDir, name);
    await rename(stage, target);
    // Prune only complete, validated snapshots; leave unrelated entries alone.
    const candidates = (await readdir(backupDir)).filter(name => /^recovery-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(name)).sort().reverse();
    for (const name of candidates.slice(keep)) {
      const old = path.join(backupDir, name); await verifyBackup(old); await rm(old, { recursive: true });
    }
    return { target, byteSize: files.reduce((sum, row) => sum + (row.bytes ?? 0), 0) };
  } finally { await rm(stage, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true }); }
}
export async function verifyBackup(backup) {
  await noLinks(backup);
  const manifest = await json(path.join(backup, 'manifest.json'));
  const actual = (await inventory(backup)).filter(row => row.path !== 'manifest.json');
  if (manifest.format !== 'picker-recovery-v1' || encode(manifest.files) !== encode(actual)
    || !actual.some(row => row.path === 'store/state.json') || !actual.some(row => row.path === 'store.dataset.json')
    || !actual.some(row => row.path === 'portable.json')) throw new Error('Recovery manifest verification failed.');
  await assertReleased(path.join(backup, 'store'));
  const portable = await json(path.join(backup, 'portable.json'));
  if (portable.format !== 'rs3-chunk-picker' || !portable.state?.members?.length) throw new Error('Recovery portable export is invalid.');
  return manifest;
}
export async function restoreStopped({ backup, dataDir, scratchRoot, release, minFreeBytes, probe = runProbe }) {
  outside(backup, dataDir); outside(dataDir, backup); outside(dataDir, scratchRoot);
  await noLinks(path.dirname(dataDir));
  if (await exists(dataDir + '.dataset.json')) throw new Error('Restore refuses an existing binding.');
  if (await exists(dataDir)) {
    await noLinks(dataDir);
    if ((await readdir(dataDir)).length) throw new Error('Restore requires an empty data directory.');
  }
  const manifest = await verifyBackup(backup);
  await directory(scratchRoot);
  const size = manifest.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  await headroom(path.dirname(dataDir), size, minFreeBytes); await headroom(scratchRoot, size * 2, minFreeBytes);
  const scratch = await mkdtemp(path.join(scratchRoot, 'restore-'));
  try {
    await snapshot(path.join(backup, 'store'), path.join(scratch, 'store'));
    await probe(release, path.join(scratch, 'store'), path.join(scratch, 'portable.json'));
    await assertSameRelease(release); await verifyBackup(backup);
    if (await exists(dataDir)) {
      if ((await readdir(dataDir)).length) throw new Error('Restore target changed.');
    } else await mkdir(dataDir, { mode: 0o700 });
    // Exclusive binding creation prevents an existing game being replaced.
    await writeFile(dataDir + '.dataset.json', await readFile(path.join(backup, 'store.dataset.json')), { flag: 'wx', mode: 0o600 });
    for (const row of manifest.files.filter(row => row.path.startsWith('store/'))) {
      const relative = row.path.slice(6), target = path.join(dataDir, relative);
      if (row.directory) await mkdir(target, { mode: 0o700 });
      else { await copyFile(path.join(backup, row.path), target, 1); await chmod(target, 0o600); }
    }
    const expected = await inventory(path.join(backup, 'store'));
    if (encode(expected) !== encode(await inventory(dataDir))) throw new Error('Restored store verification failed; keep service stopped.');
    await assertReleased(dataDir);
    return { verified: true };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
// Call under the deploy/health/backup exclusion, AFTER graceful systemd stop and
// immediately BEFORE binding/pointer CAS. Even equal descriptors are probed.
export async function checkStoppedCompatibility({ dataDir, scratchRoot, current, candidate, candidateBinding, minFreeBytes, assertStopped, savedIdentityAdditions, probe = runCompatibilityProbe }) {
  if (typeof assertStopped !== 'function') throw new Error('A stopped-service ownership check is required.');
  await assertStopped();
  const before = await storeIdentity(dataDir);
  const binding = await readFile(dataDir + '.dataset.json');
  outside(dataDir, scratchRoot); await directory(scratchRoot);
  await headroom(scratchRoot, before.files.reduce((sum, row) => sum + (row.bytes ?? 0), 0) * 6, minFreeBytes);
  const scratch = await mkdtemp(path.join(scratchRoot, 'compatibility-'));
  try {
    let source = dataDir, additions = [];
    const reports = [];
    for (const [index, release] of [current, candidate, current, candidate].entries()) {
      const copy = path.join(scratch, String(index));
      await snapshot(source, copy, index % 2 ? candidateBinding ?? binding : binding);
      const report = await probe(release, copy, path.join(scratch, index + '.json'));
      const derived = assertCompatibleStep(reports.at(-1), report, { forward: index === 1,
        ...(index === 1 ? { declaredAdditions: savedIdentityAdditions } : {}) });
      if (index === 1) additions = derived;
      reports.push(report); source = copy;
    }
    await assertSameRelease(current); await assertSameRelease(candidate); await assertStopped();
    if (encode(before) !== encode(await storeIdentity(dataDir))) throw new Error('Final stopped save changed during compatibility check.');
    return { passed: true, steps: reports.length, savedIdentityAdditions: additions, storeDigest: sha(encode(before)), bindingSha256: sha(binding) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export async function writeBackupStatus(dataDir, { result, byteSize = null, at = new Date().toISOString() }) {
  const parent = path.dirname(dataDir), file = path.join(parent, 'backup-status.json');
  let previous;
  try { previous = await json(file); } catch {}
  await atomic(file, encode({ lastRunAt: at, result, byteSize, lastSuccessAt: result === 'success' ? at : previous?.lastSuccessAt ?? null }), 0o644);
}
