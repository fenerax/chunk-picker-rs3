import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withPluginEvidence } from './plugin-evidence-lock.mjs';

export const pluginItemFiles = Object.freeze(['plugin-items.json', 'plugin-item-journal-beta.json',
  'plugin-item-journal-unknown.json', 'plugin-item-journal-commits.json']);
const captureFiles = ['state.json', ...pluginItemFiles];

// Publications and sidecar replacements share this gate in the live process.
// Worker isolates only prepare/read evidence; they never publish these files.
export const withPluginItemEvidenceWrite = withPluginEvidence;
const unavailableAllowed = (name, { retainCommittedReplay, allowUnavailableJournals }) => name === 'plugin-items.json'
  ? retainCommittedReplay : name !== 'state.json' && allowUnavailableJournals;

export async function pluginItemGeneration(dataDir, { includeState = false, retainCommittedReplay = false, allowUnavailableJournals = false } = {}) {
  const availability = { retainCommittedReplay, allowUnavailableJournals };
  const result = [];
  for (const name of includeState ? captureFiles : pluginItemFiles) {
    try {
      const info = await lstat(path.join(dataDir, name), { bigint: true });
      if (unavailableAllowed(name, availability) && info.isDirectory()) { result.push('unavailable'); continue; }
      if (!info.isFile() || info.nlink !== 1n) throw new Error('Plugin evidence capture requires regular unlinked files.');
      result.push([info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'));
    } catch (error) {
      if (unavailableAllowed(name, availability) && ['EACCES', 'EPERM', 'EBUSY'].includes(error.code)) result.push('unavailable');
      else { if (error.code !== 'ENOENT') throw error; result.push(null); }
    }
  }
  return JSON.stringify(result);
}

// Atomic replacements give each file a new generation, including across worker
// isolates. Read every generation before any bytes and again after all bytes:
// a commit cannot enter the capture without its scopes or inherited evidence.
export async function capturePluginItemFiles(dataDir, { read = readFile, discard = async () => {}, includeState = true, retainCommittedReplay = false, allowUnavailableJournals = false } = {}) {
  const availability = { retainCommittedReplay, allowUnavailableJournals };
  const names = includeState ? captureFiles : pluginItemFiles;
  const generation = () => pluginItemGeneration(dataDir, { includeState, retainCommittedReplay, allowUnavailableJournals });
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await generation(), files = {};
    for (const name of names) {
      try { files[name] = await read(path.join(dataDir, name)); }
      catch (error) {
        if (error.code !== 'ENOENT' && !(unavailableAllowed(name, availability) && ['EISDIR', 'EACCES', 'EPERM', 'EBUSY'].includes(error.code))) throw error;
      }
    }
    if (before === await generation()) return files;
    await discard(files);
  }
  throw Object.assign(new Error('Plugin evidence changed during backup; retry the export.'), { status: 503 });
}
