import path from 'node:path';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const encode = value => JSON.stringify(value, null, 2) + '\n';
export async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function outside(source, target) {
  const relative = path.relative(path.resolve(source), path.resolve(target));
  if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('Paths must not overlap.');
}
export async function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw new Error('Linked paths are refused.');
    if (current === path.dirname(current)) break;
  }
}
export async function directory(file) {
  let ancestor = path.resolve(file);
  while (!await exists(ancestor)) ancestor = path.dirname(ancestor);
  await noLinks(ancestor);
  await mkdir(file, { recursive: true, mode: 0o700 });
  await noLinks(file);
}
export async function atomic(file, bytes, mode = 0o600) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
    if (process.platform !== 'win32') {
      const parent = await open(path.dirname(file), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  }
  finally { await rm(temporary, { force: true }); }
}
export async function inventory(root, { ignoreRoot = [] } = {}) {
  await noLinks(root);
  const rows = [];
  async function walk(relative = '') {
    for (const entry of (await readdir(path.join(root, relative))).sort()) {
      if (!relative && ignoreRoot.includes(entry)) continue;
      const name = relative ? relative + '/' + entry : entry;
      const file = path.join(root, name), info = await lstat(file);
      if (info.isDirectory()) { rows.push({ path: name, directory: true }); await walk(name); }
      else if (info.isFile() && info.nlink === 1) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        rows.push({ path: name, bytes: info.size, sha256: hash.digest('hex') });
      } else throw new Error('Recovery trees must contain only regular files and directories.');
    }
  }
  await walk(); return rows;
}
export async function copyTree(source, target) {
  const before = await inventory(source);
  await mkdir(target, { mode: 0o700 });
  for (const row of before) {
    if (row.directory) await mkdir(path.join(target, row.path), { mode: 0o700 });
    else {
      await copyFile(path.join(source, row.path), path.join(target, row.path), 1);
      // copyFile preserves file mode; the containing directory is private.
    }
  }
  if (encode(before) !== encode(await inventory(source)) || encode(before) !== encode(await inventory(target))) throw new Error('Recovery source changed while copying.');
  return before;
}
export async function assertReleased(dataDir) {
  await noLinks(await exists(dataDir) ? dataDir : path.dirname(dataDir));
  for (const name of ['store.lock', 'store.lock.recovery']) if (await exists(path.join(dataDir, name))) throw new Error('Storage ownership has not been released.');
}
export async function headroom(root, bytes, reserve) {
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw new Error('A free-space reserve is required.');
  const fs = await statfs(root, { bigint: true });
  if (fs.bavail * fs.bsize < BigInt(Math.ceil(bytes)) + BigInt(reserve)) throw new Error('Insufficient free space for recovery work and reserve.');
}
// An interrupted owner leaves evidence. Never guess that an old lock is stale.
export async function exclusive(file, action, { skipBusy = false } = {}) {
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { if (skipBusy && error.code === 'EEXIST') return { skipped: true }; throw error; }
  try { await handle.writeFile(encode({ pid: process.pid, startedAt: new Date().toISOString() })); return await action(); }
  finally { await handle.close(); await rm(file); }
}
