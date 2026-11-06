import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const pluginItemFiles = Object.freeze(['plugin-items.json', 'plugin-item-journal-beta.json',
  'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']);
const captureFiles = ['state.json', ...pluginItemFiles];

// Atomic replacements give each file a new generation, including across worker
// isolates. Read every generation before any bytes and again after all bytes:
// a commit cannot enter the capture without its scopes or inherited evidence.
export async function capturePluginItemFiles(dataDir, { read = readFile, discard = async () => {} } = {}) {
  async function generation() {
    const result = [];
    for (const name of captureFiles) {
      try {
        const info = await lstat(path.join(dataDir, name), { bigint: true });
        if (!info.isFile() || info.nlink !== 1n) throw new Error('Plugin evidence capture requires regular unlinked files.');
        result.push([info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'));
      } catch (error) { if (error.code !== 'ENOENT') throw error; result.push(null); }
    }
    return JSON.stringify(result);
  }
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
