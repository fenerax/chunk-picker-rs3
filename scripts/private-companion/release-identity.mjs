// Complete byte identities and fail-closed, local gate evidence. No application imports.
import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new Error(message); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const own = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function stableStringify(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail('Identity contains an unsupported value.');
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (own(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return '{' + Object.keys(value).sort(compare).map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  fail('Identity contains an unsupported value.');
}
export const digestValue = value => sha(stableStringify(value));

function relativeName(value) {
  if (typeof value !== 'string' || !value || /[\\:\u0000-\u001f*?]/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) fail('Identity exclusion is invalid.');
  return value;
}

async function noLinkedAncestors(target, { allowMissing = false } = {}) {
  let current = path.resolve(target);
  while (true) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) fail('Identity refuses linked inputs.');
    } catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function fileRecord(filename, relative, { includeBytes = false, maxBytes = Infinity, allowHardlinks = false } = {}) {
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || !allowHardlinks && before.nlink !== 1) fail('Identity refuses linked or non-regular inputs.');
  if (before.size > maxBytes) fail('Identity input exceeds the allowed size.');
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== before.nlink) fail('Identity input changed during capture.');
    const bytes = await handle.readFile();
    const after = await handle.stat(), final = await lstat(filename);
    if (bytes.length !== before.size || final.isSymbolicLink() || !final.isFile() || [after, final].some(stat => stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs || stat.nlink !== before.nlink)) fail('Identity input changed during capture.');
    const record = { path: relative, size: bytes.length, mode: before.mode & 0o777, sha256: sha(bytes) };
    return includeBytes ? { record, bytes } : record;
  } finally { await handle.close(); }
}

async function safeRead(action) {
  try { return await action(); } catch (error) {
    if (error.message?.startsWith('Identity ')) throw error;
    throw new Error('Identity input could not be read.');
  }
}

/** No default ignores: even dotfiles, untracked files and empty directories count. */
export async function hashTree(root, { excludePaths = [] } = {}) {
  return safeRead(async () => {
    if (!path.isAbsolute(root) || !Array.isArray(excludePaths)) fail('Identity root or exclusions are invalid.');
    const exclusions = [...new Set(excludePaths.map(relativeName))].sort(compare);
    await noLinkedAncestors(root);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) fail('Identity tree root must be a directory.');
    const files = [], directories = [];
    async function walk(directory, prefix = '') {
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) fail('Identity refuses linked inputs.');
      const entries = (await readdir(directory)).sort(compare);
      for (const entry of entries) {
        const relative = prefix ? prefix + '/' + entry : entry;
        const filename = path.join(directory, entry), stat = await lstat(filename);
        if (stat.isSymbolicLink()) fail('Identity refuses linked inputs.');
        if (exclusions.some(excluded => relative === excluded || relative.startsWith(excluded + '/'))) continue;
        if (stat.isDirectory()) {
          directories.push({ path: relative, mode: stat.mode & 0o777 });
          await walk(filename, relative);
        } else files.push(await fileRecord(filename, relative));
      }
      if (stableStringify(entries) !== stableStringify((await readdir(directory)).sort(compare))) fail('Identity input changed during capture.');
      const after = await lstat(directory);
      if (!after.isDirectory() || after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('Identity input changed during capture.');
    }
    await walk(root);
    const inventory = { schema: 'rs3-tree-v2', rootMode: rootStat.mode & 0o777, exclusions, directories, files };
    return { ...inventory, digest: digestValue(inventory) };
  });
}

/** Components are explicit directories ({name,root}) or individual files ({name,file}). */
export async function captureInputIdentity({ components, metadata = {} }) {
  if (!Array.isArray(components) || !components.length) fail('Identity components are required.');
  const names = new Set(), records = [];
  for (const component of components) {
    if (!own(component) || typeof component.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(component.name) || names.has(component.name) || Boolean(component.root) === Boolean(component.file)) fail('Identity component is invalid.');
    names.add(component.name);
    if (component.root) records.push({ name: component.name, kind: 'tree', ...await hashTree(component.root, { excludePaths: component.excludePaths ?? [] }) });
    else records.push(await safeRead(async () => {
      if (!path.isAbsolute(component.file) || component.excludePaths !== undefined) fail('Identity file component is invalid.');
      await noLinkedAncestors(component.file);
      const record = await fileRecord(component.file, '.');
      return { name: component.name, kind: 'file', files: [record], digest: digestValue(record) };
    }));
  }
  records.sort((a, b) => compare(a.name, b.name));
  const identity = { schema: 'rs3-input-v2', components: records, metadata };
  return { ...identity, digest: digestValue(identity) };
}

const baseEnvironment = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'CI', 'NO_COLOR', 'FORCE_COLOR']);
const ownerEnvironment = new Set(['RS3_HEAVY_LOCK_PATH', 'RS3_HEAVY_LOCK_TOKEN', 'RS3_HEAVY_LOCK_PID']);

/** Use this exact environment for spawning. Additional behavior belongs in explicit overrides. */
export function sanitizeExecutionEnvironment(inherited = process.env, { overrides = {} } = {}) {
  const env = {};
  const name = key => process.platform === 'win32' ? key.toUpperCase() : key;
  for (const [key, value] of Object.entries(inherited)) if (baseEnvironment.has(key.toUpperCase()) && typeof value === 'string') env[name(key)] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) fail('Identity environment override is invalid.');
    env[name(key)] = value;
  }
  return env;
}

// Windows system executables may be hardlinked to WinSxS. This exception is
// restricted to execution binaries; authored inputs and receipts stay single-link.
async function captureExecutableIdentity(components) {
  const records = [];
  for (const { name, file } of components) records.push(await safeRead(async () => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) fail('Identity executable path is invalid.');
    await noLinkedAncestors(file);
    const record = await fileRecord(file, '.', { allowHardlinks: true });
    return { name, kind: 'file', files: [record], digest: digestValue(record) };
  }));
  records.sort((a, b) => compare(a.name, b.name));
  const identity = { schema: 'rs3-input-v2', components: records, metadata: {} };
  return { ...identity, digest: digestValue(identity) };
}

export async function captureExecutionIdentity({ lane, command = process.execPath, args = [], cwd = process.cwd(), env = sanitizeExecutionEnvironment(), policy = {}, nodeExecutable = process.execPath }) {
  if (typeof lane !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(lane) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string') || !path.isAbsolute(cwd)) fail('Identity execution is invalid.');
  const binaries = await captureExecutableIdentity(command === nodeExecutable ? [{ name: 'node', file: nodeExecutable }] : [{ name: 'node', file: nodeExecutable }, { name: 'command', file: command }]);
  let nodeVersion = process.version;
  if (path.resolve(nodeExecutable) !== path.resolve(process.execPath)) {
    try { nodeVersion = (await promisify(execFile)(nodeExecutable, ['--version'], { env, windowsHide: true, timeout: 10000 })).stdout.trim(); }
    catch { fail('Identity Node version could not be read.'); }
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(nodeVersion)) fail('Identity Node version is invalid.');
  const environment = Object.entries(env).filter(([key]) => !ownerEnvironment.has(key.toUpperCase())).map(([key, value]) => {
    if (typeof value !== 'string') fail('Identity execution environment is invalid.');
    return { name: process.platform === 'win32' ? key.toUpperCase() : key, sha256: sha(value) };
  }).sort((a, b) => compare(a.name, b.name));
  if (new Set(environment.map(item => item.name)).size !== environment.length) fail('Identity execution environment contains duplicate keys.');
  const identity = { schema: 'rs3-execution-v2', lane, platform: process.platform, arch: process.arch, nodeVersion, binaries, cwdDigest: sha(path.resolve(cwd)), argsDigest: digestValue(args), environment, ownerEnvironmentExcluded: [...ownerEnvironment].sort(compare), policyDigest: digestValue(policy) };
  return { ...identity, digest: digestValue(identity) };
}

export function deriveLaneKey({ inputIdentity, executionIdentity }) {
  if (!hex(inputIdentity?.digest) || !hex(executionIdentity?.digest)) fail('Identity lane digests are invalid.');
  return digestValue({ schema: 'rs3-lane-key-v2', inputDigest: inputIdentity.digest, executionDigest: executionIdentity.digest });
}

function validReceipt(value, expected, { now = Date.now(), maxAgeMs = Infinity } = {}) {
  if (!Number.isFinite(now) || !(maxAgeMs === Infinity || Number.isFinite(maxAgeMs) && maxAgeMs >= 0)) return false;
  if (!own(value) || value.schema !== 'rs3-success-v2' || value.success !== true || value.exitCode !== 0 || value.cleanupVerified !== true || !hex(value.key) || !hex(value.inputDigest) || !hex(value.executionDigest)) return false;
  if (value.key !== deriveLaneKey({ inputIdentity: { digest: value.inputDigest }, executionIdentity: { digest: value.executionDigest } })) return false;
  if (!own(expected) || !hex(expected.key) || !hex(expected.inputDigest) || !hex(expected.executionDigest)) return false;
  if (['key', 'inputDigest', 'executionDigest'].some(key => value[key] !== expected[key])) return false;
  if (value.assemblyDigest !== undefined && !hex(value.assemblyDigest)) return false;
  if (expected.assemblyDigest !== undefined && value.assemblyDigest !== expected.assemblyDigest) return false;
  const started = Date.parse(value.startedAt), completed = Date.parse(value.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > now || now - completed > maxAgeMs) return false;
  if (typeof value.startedAt !== 'string' || typeof value.completedAt !== 'string' || new Date(started).toISOString() !== value.startedAt || new Date(completed).toISOString() !== value.completedAt) return false;
  return true;
}

/** Missing, malformed, linked, incomplete, failed and mismatched evidence never grants reuse. */
export async function readSuccessReceipt(filename, expected, options = {}) {
  try {
    await noLinkedAncestors(filename);
    const { bytes } = await fileRecord(filename, '.', { includeBytes: true, maxBytes: 65536 });
    const value = JSON.parse(bytes.toString('utf8'));
    return validReceipt(value, expected, options) ? value : null;
  } catch { return null; }
}

/** Caller supplies exit/cleanup observations only after the owned child and scratch cleanup finish. */
export async function writeSuccessReceipt(filename, { key, inputDigest, executionDigest, exitCode, cleanupVerified, startedAt, completedAt = new Date().toISOString(), assemblyDigest }) {
  const receipt = { schema: 'rs3-success-v2', key, inputDigest, executionDigest, success: true, exitCode, cleanupVerified, startedAt, completedAt, ...(assemblyDigest === undefined ? {} : { assemblyDigest }) };
  if (!validReceipt(receipt, { key, inputDigest, executionDigest })) fail('Identity success receipt requires exact successful execution and verified cleanup.');
  if (!path.isAbsolute(filename)) fail('Identity receipt path is invalid.');
  let lock, temporary;
  try {
    await noLinkedAncestors(path.dirname(filename), { allowMissing: true });
    await mkdir(path.dirname(filename), { recursive: true });
    await noLinkedAncestors(path.dirname(filename));
    lock = await open(filename + '.lock', 'wx', 0o600);
    try { await lstat(filename); fail('Identity receipt already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = filename + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(receipt) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filename); temporary = undefined;
    return receipt;
  } catch (error) {
    if (error.message?.startsWith('Identity ')) throw error;
    throw new Error('Identity receipt publication refused.');
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    if (lock) { await lock.close(); await unlink(filename + '.lock').catch(() => {}); }
  }
}
