// A focused contract runs against scripts/tests, never a product assembly.
// Missing runner helpers come only from the raw contract's pinned core blobs.
import path from 'node:path';
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digestValue, hashTree, sanitizeExecutionEnvironment } from './release-identity.mjs';
import { regularInput } from './file-test-evidence.mjs';

const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const prefix = 'checks/private-source/';
const inside = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
function safeName(name) {
  return typeof name === 'string' && !!name && !/[\\:%\x00-\x1f\x7f*?<>"|]/.test(name)
    && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
async function ordinary(directory, allowMissing = false) {
  if (!path.isAbsolute(directory ?? '')) throw Error('Focused workspace paths must be absolute.');
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()
          || path.resolve(await realpath(current)).toLowerCase() !== current.toLowerCase()) throw Error('Focused workspace directory is linked or noncanonical.');
    } catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}
async function absent(target) {
  try { await lstat(target); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
const compare = (a, b) => a.path.localeCompare(b.path);
const bytesProjection = files => files.map(({ path, size, sha256 }) => ({ path, size, sha256 })).sort(compare);
async function snapshot(root) {
  const files = [], directories = [], roots = {};
  for (const name of ['scripts', 'tests']) {
    const directory = path.join(root, name); await ordinary(directory);
    const tree = await hashTree(directory); roots[name] = tree.digest; directories.push(name);
    for (const row of tree.directories) {
      const relative = name + '/' + row.path;
      if (!safeName(relative)) throw Error('Unsafe focused workspace directory.');
      directories.push(relative);
    }
    for (const row of tree.files) {
      const relative = name + '/' + row.path;
      if (!safeName(relative)) throw Error('Unsafe focused workspace file.');
      files.push({ ...row, path: relative });
    }
  }
  const folded = [...directories, ...files.map(row => row.path)].map(name => name.toLowerCase());
  if (new Set(folded).size !== folded.length) throw Error('Focused workspace has case-colliding paths.');
  return { files: files.sort(compare), directories: directories.sort(), roots,
    projection: { files: bytesProjection(files), directories: directories.sort() } };
}
function assertIdentity(identity) {
  if (identity?.schema !== 'rs3-tooling-contract-input-v2' || !hex(identity.digest)
      || !Array.isArray(identity.files) || !Array.isArray(identity.dependencies)) throw Error('Raw tooling contract identity required.');
  const { digest, ...body } = identity;
  if (digestValue(body) !== digest) throw Error('Raw tooling contract identity changed.');
}

async function coreHelper({ repo, revision, name, sha256 }) {
  const env = sanitizeExecutionEnvironment(process.env, { overrides: {
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  } });
  const git = async (...args) => {
    try { return (await execute('git', ['--no-optional-locks', '-C', repo, ...args], {
      env, windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 ** 2, encoding: 'buffer',
    })).stdout; }
    catch { throw Error('Exact committed core helper could not be read.'); }
  };
  const rows = (await git('ls-tree', '-z', revision, '--', name)).toString('utf8').split('\0').filter(Boolean);
  const match = rows.length === 1 && /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[3] !== name) throw Error('Core helper is missing, linked or nonregular.');
  const bytes = await git('show', revision + ':' + name);
  if (sha(bytes) !== sha256 || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== match[2]) throw Error('Core helper differs from the raw contract identity.');
  return { bytes, gitMode: match[1] };
}

/** output must be absent and disjoint from the kit. The returned identity is the
 * unchanged raw contract identity; digest describes only materialized bytes and
 * directory names. A different feature commit with identical helper blobs does
 * not change it. Caller-owned temp/cache paths must stay outside returned cwd. */
export async function prepareToolingContractWorkspace({ kit, output, identity }) {
  if (![kit, output].every(value => path.isAbsolute(value ?? ''))) throw Error('Absolute focused workspace inputs required.');
  kit = path.resolve(kit); output = path.resolve(output);
  if (inside(kit, output) || inside(output, kit)) throw Error('Focused workspace overlaps its immutable kit.');
  await ordinary(kit); await ordinary(output, true);
  if (!await absent(output)) throw Error('Focused workspace output must be absent.');
  assertIdentity(identity); const originalIdentityDigest = digestValue(identity);
  const input = path.join(kit, 'checks/private-source'), before = await snapshot(input);
  const privateRows = new Map(before.files.map(row => [row.path, row]));
  for (const row of identity.files) {
    if (!safeName(row?.path) || !row.path.startsWith('tests/') || !hex(row.sha256)
        || privateRows.get(row.path)?.sha256 !== row.sha256) throw Error('Focused test differs from its raw identity.');
  }
  if (!Array.isArray(identity.rawSupport)) throw Error('Focused raw support identity required.');
  const supportNames = new Set();
  for (const row of identity.rawSupport) {
    if (!safeName(row?.path) || !/^scripts\/private-companion\/[^/]+\.(?:mjs|cjs|js|ps1|psm1)$/i.test(row.path)
        || !hex(row.sha256) || !Number.isInteger(row.mode) || row.mode < 0 || row.mode > 0o777
        || privateRows.get(row.path)?.sha256 !== row.sha256 || privateRows.get(row.path)?.mode !== row.mode
        || supportNames.has(row.path.toLowerCase())) throw Error('Focused support differs from its raw identity.');
    supportNames.add(row.path.toLowerCase());
  }
  const fallbacks = [], seen = new Set();
  for (const row of identity.dependencies) {
    if (!safeName(row?.path) || !hex(row.sha256) || ![undefined, 'kit', 'committed-core-tooling'].includes(row.origin)) throw Error('Focused dependency identity is invalid.');
    const folded = row.path.toLowerCase();
    if (seen.has(folded)) throw Error('Focused dependencies contain duplicate paths.'); seen.add(folded);
    if (row.origin === 'committed-core-tooling') {
      if (!row.path.startsWith(prefix + 'scripts/') || !/\.(?:mjs|cjs|js|ps1|psm1)$/.test(row.path)) throw Error('Core fallback must be an explicit script helper.');
      const name = row.path.slice(prefix.length);
      if (privateRows.has(name) || before.files.some(file => file.path.toLowerCase() === name.toLowerCase())
          || before.directories.some(directory => directory.toLowerCase() === name.toLowerCase())) throw Error('Core fallback would replace private source.');
      fallbacks.push({ path: name, sha256: row.sha256 });
    } else if (row.path.startsWith(prefix)) {
      const name = row.path.slice(prefix.length);
      if (!/^(?:scripts|tests)\//.test(name) || privateRows.get(name)?.sha256 !== row.sha256) throw Error('Focused dependency requires unavailable or product source.');
    }
  }
  let manifestBytes, manifest;
  if (fallbacks.length) {
    manifestBytes = await regularInput(path.join(kit, 'kit.json'));
    manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
    const repo = manifest.toolingCoreRepo ?? 'C:/Users/User/Projects/chunk-picker-rs3-core';
    if (!/^[a-f0-9]{40}$/.test(manifest.coreRevision ?? '') || !path.isAbsolute(repo)) throw Error('Exact core helper provenance required.');
    await ordinary(repo);
    for (const row of fallbacks) Object.assign(row, await coreHelper({ repo, revision: manifest.coreRevision, name: row.path, sha256: row.sha256 }));
  }
  // No app, packs, full core, operator installation, or candidate lane is copied.
  const cwd = path.join(output, 'source'); await mkdir(cwd, { recursive: true });
  for (const name of before.directories) await mkdir(path.join(cwd, name), { recursive: true });
  for (const row of before.files) {
    const bytes = await regularInput(path.join(input, row.path));
    if (bytes.length !== row.size || sha(bytes) !== row.sha256) throw Error('Private focused source changed during copying.');
    await writeFile(path.join(cwd, row.path), bytes, { flag: 'wx', mode: row.mode });
  }
  if (digestValue((await snapshot(cwd)).projection) !== digestValue(before.projection)
      || digestValue((await snapshot(input)).roots) !== digestValue(before.roots)) throw Error('Private focused copy changed.');
  for (const row of fallbacks) {
    const target = path.join(cwd, row.path); await mkdir(path.dirname(target), { recursive: true });
    // wx preserves the private file even if another writer races the preflight.
    await writeFile(target, row.bytes, { flag: 'wx', mode: row.gitMode === '100755' ? 0o755 : 0o644 });
  }
  const expectedDirectories = new Set(before.directories);
  for (const row of fallbacks) {
    const parts = row.path.split('/');
    for (let length = 1; length < parts.length; length++) expectedDirectories.add(parts.slice(0, length).join('/'));
  }
  const expected = { files: bytesProjection([...before.files, ...fallbacks.map(row => ({ ...row, size: row.bytes.length }))]), directories: [...expectedDirectories].sort() };
  const after = await snapshot(cwd);
  const copiedRows = new Map(after.files.map(row => [row.path, row]));
  if (identity.rawSupport.some(row => copiedRows.get(row.path)?.sha256 !== row.sha256 || copiedRows.get(row.path)?.mode !== row.mode)) throw Error('Copied focused support differs from its raw identity.');
  if (digestValue(after.projection) !== digestValue(expected) || digestValue((await snapshot(input)).roots) !== digestValue(before.roots)
      || manifestBytes && !manifestBytes.equals(await regularInput(path.join(kit, 'kit.json')))
      || digestValue(identity) !== originalIdentityDigest) throw Error('Focused workspace inputs changed during preparation.');
  const tree = await hashTree(cwd);
  return { cwd, source: cwd, output, digest: digestValue({ schema: 'rs3-tooling-contract-workspace-v1', ...after.projection }),
    treeDigest: tree.digest, contractDigest: identity.digest, identity,
    materialized: fallbacks.map(({ path, sha256 }) => ({ path, sha256 })) };
}
