// Offline recovery into a NEW store. Existing stores are never replaced.
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { importBackup } from '../app/core/state.mjs';
import { openStore } from '../app/storage/store.mjs';
import { openFeedbackStore } from '../app/storage/feedback.mjs';

const MAX_BYTES = 256 * 1024 * 1024;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error('Backup must be a regular file under 256 MiB.');
}

async function checkedTarget(folder) {
  const target = path.resolve(folder);
  // Require an existing parent, and reject redirected parents (junctions too).
  const parent = path.dirname(target);
  if (path.resolve(await realpath(parent)).toLowerCase() !== parent.toLowerCase()) throw new Error('Restore parent must not use a symbolic link or junction.');
  for (let cursor = parent; ; cursor = path.dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Restore parent must not use a symbolic link or junction.');
    if (path.dirname(cursor) === cursor) break;
  }
  try { await lstat(target); } catch (error) { if (error.code === 'ENOENT') return target; throw error; }
  throw new Error('Target already exists. Choose a new folder; this helper never replaces a save.');
}

export async function restorePicker({ backupPath, targetFolder, feedbackPath } = {}) {
  if (!backupPath) throw new Error('Choose a portable JSON backup.');
  const target = await checkedTarget(targetFolder ?? path.join(root, '.local', `restore-${Date.now()}-${randomUUID()}`));
  await regularFile(backupPath);
  let document, state;
  try {
    const bytes = await readFile(backupPath);
    document = JSON.parse((/\.gz$/i.test(backupPath) ? gunzipSync(bytes, { maxOutputLength: MAX_BYTES }) : bytes).toString('utf8'));
    if (document.storage !== undefined || document.state?.provenance?.historyArchive?.length) throw new Error('External dependencies');
    state = importBackup(document);
  } catch { throw new Error('Not a valid standalone full backup. Download a full backup; raw state files may need static/history sidecars.'); }
  let feedbackBytes;
  if (feedbackPath) { await regularFile(feedbackPath); feedbackBytes = await readFile(feedbackPath); }
  // mkdir is exclusive: a competing invocation cannot take over this target.
  await mkdir(target);
  let store, feedback;
  try {
    store = await openStore({ dataDir: target, initialState: state, retention: false });
    if (feedbackBytes) {
      await writeFile(path.join(target, 'feedback.json'), feedbackBytes, { flag: 'wx', mode: 0o600 });
      try { feedback = await openFeedbackStore({ dataDir: target }); }
      catch { throw new Error('The feedback backup is invalid.'); }
    }
    await feedback?.close(); feedback = undefined;
    await store.close(); store = undefined;
    return { targetFolder: target, revision: state.revision, historyEntries: state.history.length,
      players: state.members.map(member => ({ name: member.name, unlocked: member.unlocked.length, completed: member.completedTasks.length })),
      feedbackRestored: Boolean(feedbackBytes) };
  } catch (error) {
    await feedback?.close().catch(() => {});
    await store?.close().catch(() => {});
    // Only the fresh directory made above is ours. Resolve again before cleanup.
    if (path.resolve(await realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error('Restore failed; redirected target needs manual review.');
    await rm(target, { recursive: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}, names = { '--backup': 'backupPath', '--target': 'targetFolder', '--feedback': 'feedbackPath' };
    for (let i = 2; i < process.argv.length; i += 2) {
      if (!names[process.argv[i]] || !process.argv[i + 1]) throw new Error('Use --backup, --target and optional --feedback.');
      options[names[process.argv[i]]] = process.argv[i + 1];
    }
    process.stdout.write(`${JSON.stringify(await restorePicker(options))}\n`);
  } catch {
    // Validation errors can contain private saved values. Do not print them.
    process.stderr.write('Restore refused or failed. Choose a valid full backup and a new folder with an existing, ordinary parent.\n');
    process.exitCode = 1;
  }
}
