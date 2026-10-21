import net from 'node:net';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink, lstat, realpath } from 'node:fs/promises';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const failure = code => Object.assign(new Error(code), { code });
const phases = new Set(['prepared', 'standby-intent', 'freeze-intent', 'frozen', 'release-intent', 'released', 'activate-intent', 'acquired', 'commit-intent', 'committed', 'admitted', 'rolled-back', 'recovery-required', 'recovery-stopping', 'recovery-released', 'recovery-acquired', 'recovery-committed']);
export async function assertPlainPath(file) {
  if (!path.isAbsolute(file)) throw failure('LIVE_SWAP_PATH');
  for (let item = path.resolve(file); ; item = path.dirname(item)) {
    try { if ((await lstat(item)).isSymbolicLink()) throw failure('LIVE_SWAP_PATH'); }
    catch (error) { if (error.code !== 'ENOENT' || item !== path.resolve(file)) throw error; }
    if (path.dirname(item) === item) break;
  }
}
export async function replaceSynced(temporary, file, { platform = process.platform, replace = rename, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await replace(temporary, file); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
      // Defender/indexer readers can briefly deny replacement. Retry this same
      // synchronized temporary; never unlink the authoritative old journal.
      await pause(10 * (attempt + 1));
    }
  }
}
export async function atomicJSON(file, value) {
  await assertPlainPath(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await replaceSynced(temporary, file);
    // Windows does not expose directory fsync. File data is synchronized before
    // atomic replacement; an unreadable/missing journal always fails closed.
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function acquireOperation(file) {
  await assertPlainPath(file);
  const directory = await realpath(path.dirname(file));
  const canonical = path.join(directory, path.basename(file));
  const key = digest(process.platform === 'win32' ? canonical.toLowerCase() : canonical);
  // Kernel ownership dies with the controller. No stale lock-file deletion or
  // unverified PID can grant a second controller ownership.
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\picker-swap-${key}` : `\0picker-swap-${key}`;
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
  return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
export class Journal {
  constructor(file) { this.file = file; this.value = undefined; }
  async read({ optional = false } = {}) {
    await assertPlainPath(this.file);
    let envelope;
    try {
      const handle = await open(this.file, 'r');
      try { if ((await handle.stat()).size > 128 * 1024) throw failure('LIVE_SWAP_JOURNAL_INVALID'); envelope = JSON.parse(await handle.readFile('utf8')); }
      finally { await handle.close(); }
    } catch (error) { if (optional && error.code === 'ENOENT') return null; throw failure('LIVE_SWAP_JOURNAL_INVALID'); }
    const value = envelope?.value;
    if (!value || envelope.sha256 !== digest(JSON.stringify(value)) || value.schemaVersion !== 2
      || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.transaction !== 'string'
      || !phases.has(value.phase) || !value.old || !value.next) throw failure('LIVE_SWAP_JOURNAL_INVALID');
    this.value = value; return structuredClone(value);
  }
  async write(value) {
    const next = { ...structuredClone(value), schemaVersion: 2, sequence: (this.value?.sequence ?? 0) + 1 };
    await atomicJSON(this.file, { value: next, sha256: digest(JSON.stringify(next)) });
    this.value = next; return structuredClone(next);
  }
}
export async function latestCheckpoint(dataDir) {
  const file = path.join(dataDir, 'state.json'); await assertPlainPath(file);
  const bytes = await readFile(file), document = JSON.parse(bytes);
  if (!Number.isSafeInteger(document?.state?.revision) || document.state.revision < 0 || !Number.isInteger(document.schemaVersion) || document.schemaVersion < 1) throw failure('LIVE_SWAP_SAVE_INVALID');
  return { revision: document.state.revision, schemaVersion: document.schemaVersion, sha256: digest(bytes) };
}
