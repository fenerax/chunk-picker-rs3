import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export const pluginItemFiles = Object.freeze(['plugin-items.json', 'plugin-item-journal-beta.json',
  'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']);
const captureFiles = ['state.json', ...pluginItemFiles];
const writers = new Map();
const context = new AsyncLocalStorage();

// Publications and sidecar replacements share this gate in the live process.
// Worker isolates only prepare/read evidence; they never publish these files.
export async function withPluginItemEvidenceWrite(dataDir, work) {
  const directory = await realpath(dataDir), key = process.platform === 'win32' ? directory.toLowerCase() : directory;
  if (context.getStore()?.key === key && context.getStore().active) return work();
  const prior = writers.get(key) ?? Promise.resolve();
  const result = prior.then(async () => {
    const owner = { key, active: true };
    try { return await context.run(owner, work); } finally { owner.active = false; }
  });
  const settled = result.catch(() => {});
  writers.set(key, settled);
  void settled.then(() => { if (writers.get(key) === settled) writers.delete(key); });
  return result;
}

export async function pluginItemGeneration(dataDir, { includeState = false } = {}) {
  const result = [];
  for (const name of includeState ? captureFiles : pluginItemFiles) {
    try {
      const info = await lstat(path.join(dataDir, name), { bigint: true });
      if (!info.isFile() || info.nlink !== 1n) throw new Error('Plugin evidence capture requires regular unlinked files.');
      result.push([info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; result.push(null); }
  }
  return JSON.stringify(result);
}

// Atomic replacements give each file a new generation, including across worker
// isolates. Read every generation before any bytes and again after all bytes:
// a commit cannot enter the capture without its scopes or inherited evidence.
export async function capturePluginItemFiles(dataDir, { read = readFile, discard = async () => {} } = {}) {
  const generation = () => pluginItemGeneration(dataDir, { includeState: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await generation(), files = {};
    for (const name of captureFiles) {
      try { files[name] = await read(path.join(dataDir, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (before === await generation()) return files;
    await discard(files);
  }
  throw Object.assign(new Error('Plugin evidence changed during backup; retry the export.'), { status: 503 });
}
