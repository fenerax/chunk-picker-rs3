// Bounded static compatibility checks. Candidate code is read, never imported or run.
import path from 'node:path';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { reviewCoreOverlays } from './core-overlay-guard.mjs';
import { assertLivePayloadTarget, reviewLivePayloadOverlays, livePayloadProof, reopenLivePayloadContext } from './live-payload-rules.mjs';
import { inventoryMissing, practiceInventoryCapability } from './practice-inventory.mjs';

const safePath = value => typeof value === 'string' && !!value && !/[\\:%\x00-\x1f\x7f*?<>"|]/.test(value)
  && !value.startsWith('/') && value.split('/').every(p => p && p !== '.' && p !== '..' && !/[. ]$/.test(p)
    && !/^(?:\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
const sourceFile = name => /\.(?:mjs|js|cjs)$/.test(name);
// The source selection shared with export-repo-source.mjs.
export function privateSourcePath(name) {
  const lower = name.toLowerCase(), parts = lower.split('/');
  if (/^(?:\.git(?:\/|$)|\.private-source(?:\/|$)|tools(?:\/|$)|\.gitattributes$|\.gitignore$|readme\.md$|ignores\.md$|legacy-backups\.md$|backup-patch\.md$|secrets-proposal\.md$)/.test(lower)) return false;
  if (parts.some(part => part.includes('.bak-') || ['.git', '.local', 'node_modules'].includes(part))) return false;
  if (/^(?:packs|kits|releases|release-v2|operator|saves|corpus|dist|coverage)(?:\/|$)/.test(lower)) return false;
  if (parts.some(part => /^\.env(?:\.|$)/.test(part) || /^(?:credentials|access-token|release-corpus-keys)(?:\.|$)/.test(part))) return false;
  return !/(?:\.tmp|\.swp|~)$/.test(lower);
}
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].every(k => a[k] === b[k]);
async function ordinary(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw Error('Linked or nonregular private input refused.');
  const bytes = await readFile(file);
  if (!sameStat(before, await lstat(file))) throw Error('Private input changed during inspection.');
  return bytes;
}
async function inventory(root) {
  for (let current = root;; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Private directory link refused.');
    if (path.dirname(current) === current) break;
  }
  const names = new Map(), folded = new Set();
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name, key = name.toLowerCase();
      if (!privateSourcePath(name)) continue;
      if (!safePath(name) || folded.has(key)) throw Error('Unsafe or case-colliding private path refused.');
      folded.add(key);
      if (entry.isSymbolicLink()) throw Error('Private input link refused.');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) names.set(name, null);
      else throw Error('Nonregular private input refused.');
    }
  }
  await walk(root);
  return names;
}

function readCore(core, coreRepo, privateFiles, privateRoot) {
  let repo = path.resolve(coreRepo ?? process.cwd()), ref = core ?? 'HEAD';
  if (path.isAbsolute(ref)) { repo = path.resolve(ref); ref = 'HEAD'; }
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\x00-\x20\x7f]/.test(ref)) throw Error('Core revision or tree refused.');
  // Ignore object replacements and inherited Git routing; never consult candidate hooks.
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  for (const key of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete env[key];
  const at = (directory, ...args) => execFileSync('git', ['--no-optional-locks', '-C', directory, ...args], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 ** 2 });
  const git = (...args) => at(repo, ...args);
  let revision;
  try { revision = git('rev-parse', '--verify', '--end-of-options', ref + '^{object}').toString().trim(); }
  catch (original) {
    if (coreRepo || path.isAbsolute(core ?? '')) throw original;
    // Private captures are often linked worktrees. Their common Git directory
    // identifies the owning private repository, whose public core is a sibling.
    // No checkout contents or candidate modules participate in this discovery.
    const candidates = new Set();
    for (const directory of new Set([repo, privateRoot])) {
      try {
        const common = at(directory, 'rev-parse', '--path-format=absolute', '--git-common-dir').toString().trim();
        const owner = path.basename(common) === '.git' ? path.dirname(common) : common;
        const stem = path.basename(owner).replace(/-private(?:-src)?$/, '');
        candidates.add(path.join(path.dirname(owner), stem + '-core'));
      } catch { /* A metadata-free source export has no repository of its own. */ }
      for (let ancestor = path.resolve(directory); path.dirname(ancestor) !== ancestor; ancestor = path.dirname(ancestor)) {
        if (!/-private(?:-src)?$/.test(path.basename(ancestor))) continue;
        candidates.add(path.join(path.dirname(ancestor), path.basename(ancestor).replace(/-private(?:-src)?$/, '-core')));
      }
    }
    for (const candidate of candidates) {
      try {
        const resolved = at(candidate, 'rev-parse', '--verify', '--end-of-options', ref + '^{object}').toString().trim();
        repo = candidate; revision = resolved; break;
      } catch { /* Try only derived sibling repositories, never search the disk. */ }
    }
    if (!revision) throw original;
  }
  const tree = git('rev-parse', '--verify', '--end-of-options', ref + '^{tree}').toString().trim();
  const objectFormat = git('rev-parse', '--show-object-format').toString().trim();
  if (!['sha1', 'sha256'].includes(objectFormat) || !/^[a-f0-9]{40,64}$/.test(tree)) throw Error('Core object identity refused.');
  const names = new Map(), folded = new Set(), wanted = [];
  for (const row of git('ls-tree', '-rz', '--full-tree', tree).toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match || !safePath(match[3]) || folded.has(match[3].toLowerCase())) throw Error('Unsafe, linked or case-colliding core tree entry refused.');
    const name = match[3]; folded.add(name.toLowerCase()); names.set(name, Buffer.alloc(0));
    if (sourceFile(name) || privateFiles.has(name)) wanted.push({ name, oid: match[2] });
  }
  const batch = wanted.length ? execFileSync('git', ['--no-optional-locks', '-C', repo, 'cat-file', '--batch'], {
    env, input: wanted.map(row => row.oid + '\n').join(''), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 ** 2,
  }) : Buffer.alloc(0);
  let offset = 0;
  for (const row of wanted) {
    const end = batch.indexOf(10, offset), header = /^([a-f0-9]+) blob (\d+)$/.exec(batch.subarray(offset, end).toString());
    if (!header || header[1] !== row.oid) throw Error('Core blob header refused.');
    const size = Number(header[2]); offset = end + 1;
    const bytes = batch.subarray(offset, offset + size); offset += size + 1;
    if (bytes.length !== size || createHash(objectFormat).update(`blob ${size}\0`).update(bytes).digest('hex') !== row.oid) throw Error('Core blob contents refused.');
    names.set(row.name, bytes);
  }
  if (offset !== batch.length) throw Error('Core batch framing refused.');
  return { files: names, revision, tree };
}

// Token recognition is intentionally local: literal strings, imports, exports,
// balanced function ranges and plain object pins. It does not evaluate expressions.
function tokens(source) {
  const out = [];
  for (let i = 0; i < source.length;) {
    const start = i, c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) throw Error('Unclosed source comment.'); i = end + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let value = '', escaped = false; i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') { escaped = true; value += source[i++]; }
        value += source[i++];
      }
      if (i === source.length) throw Error('Unclosed source string.');
      i++; out.push({ value, kind: c === '`' ? 'template' : 'string', escaped, start, end: i }); continue;
    }
    if (c === '/' && (!out.length || /^(?:\(|\[|\{|=|:|,|!|\?|;|return|throw|=>|&&|\|\|)$/.test(out.at(-1).value))) {
      let inClass = false; i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        if (source[i] === ']') inClass = false;
        if (source[i++] === '/' && !inClass) break;
      }
      while (/[a-z]/i.test(source[i] ?? '') && i < source.length) i++;
      out.push({ value: '<regexp>', kind: 'regexp', start, end: i }); continue;
    }
    const match = /^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?|^(?:\?\.|=>|===|!==|&&|\|\||\?\?|\.\.\.)/.exec(source.slice(i));
    const value = match?.[0] ?? c; i += value.length; out.push({ value, kind: /^[A-Za-z_$]/.test(value) ? 'identifier' : 'punctuation', start, end: i });
  }
  return out;
}
const value = (ts, i) => ts[i]?.value;
function close(ts, start) {
  const end = { '(': ')', '[': ']', '{': '}' }[value(ts, start)];
  if (!end) return start;
  let depth = 0;
  for (let i = start; i < ts.length; i++) {
    if (ts[i].kind === 'string' || ts[i].kind === 'template' || ts[i].kind === 'regexp') continue;
    if (value(ts, i) === value(ts, start)) depth++;
    if (value(ts, i) === end && !--depth) return i;
  }
  throw Error('Unbalanced source range.');
}
function imports(ts) {
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].kind !== 'identifier' || value(ts, i) !== 'import' || ['.', ':'].includes(value(ts, i + 1))) continue;
    if (value(ts, i + 1) === '(') {
      // Dynamic imports can be conditional optional providers. This bounded
      // checker follows mandatory static imports; runtime loader coverage belongs
      // to the release checks, including literal and computed dynamic imports.
      continue;
    }
    let end = i + 1;
    while (end < ts.length && ts[end].kind !== 'string' && value(ts, end) !== ';') end++;
    if (ts[end]?.kind !== 'string' || ts[end].escaped) continue;
    const names = [], locals = [];
    for (let j = i + 1; j < end; j++) {
      if (value(ts, j) === '{') {
        const limit = close(ts, j);
        for (let k = j + 1; k < limit; k++) if (ts[k].kind === 'identifier' && !['as', 'type'].includes(value(ts, k))) {
          names.push(value(ts, k)); locals.push(value(ts, k + 1) === 'as' ? value(ts, k + 2) : value(ts, k));
          if (value(ts, k + 1) === 'as') k += 2;
        }
        j = limit;
      } else if (j === i + 1 && ts[j].kind === 'identifier') { names.push('default'); locals.push(value(ts, j)); }
    }
    rows.push({ specifier: ts[end].value, names, locals }); i = end;
  }
  return rows;
}
function resolveRelative(owner, specifier) {
  if (/[\\:%\x00-\x1f?#]/.test(specifier)) return null;
  const name = path.posix.normalize(path.posix.join(path.posix.dirname(owner), specifier));
  return safePath(name) ? name : null;
}
function exportedNames(name, files, parsed, visiting = new Set()) {
  if (visiting.has(name) || !files.has(name)) return new Set();
  visiting.add(name);
  const ts = parsed(name), result = new Set();
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].kind !== 'identifier' || value(ts, i) !== 'export') continue;
    let j = i + 1;
    if (value(ts, j) === 'default') { result.add('default'); continue; }
    if (value(ts, j) === 'async') j++;
    if (['function', 'class'].includes(value(ts, j))) {
      const next = value(ts, j + 1) === '*' ? j + 2 : j + 1;
      if (ts[next]?.kind === 'identifier') result.add(value(ts, next));
    } else if (['const', 'let', 'var'].includes(value(ts, j))) {
      if (ts[j + 1]?.kind === 'identifier') result.add(value(ts, j + 1));
      for (let k = j + 2; k < ts.length && value(ts, k) !== ';'; k++) {
        if (['{', '[', '('].includes(value(ts, k))) { k = close(ts, k); continue; }
        if (value(ts, k) === ',' && ts[k + 1]?.kind === 'identifier') result.add(value(ts, k + 1));
      }
    }
    else if (value(ts, j) === '{') {
      const end = close(ts, j);
      for (let k = j + 1; k < end; k++) if (ts[k].kind === 'identifier') {
        result.add(value(ts, k + 1) === 'as' ? value(ts, k + 2) : value(ts, k)); if (value(ts, k + 1) === 'as') k += 2;
      }
    } else if (value(ts, j) === '*') {
      if (value(ts, j + 1) === 'as') result.add(value(ts, j + 2));
      else if (value(ts, j + 1) === 'from' && ts[j + 2]?.kind === 'string') {
        const target = resolveRelative(name, value(ts, j + 2));
        if (target) for (const item of exportedNames(target, files, parsed, visiting)) if (item !== 'default') result.add(item);
      }
    }
  }
  if (/\.c?js$/.test(name) && ts.some((t, i) => t.value === 'module' && value(ts, i + 1) === '.' && value(ts, i + 2) === 'exports')) result.add('default');
  visiting.delete(name); return result;
}
function literalObject(ts, start) {
  if (value(ts, start) !== '{') return null;
  const result = {}, end = close(ts, start);
  for (let i = start + 1; i < end;) {
    if (value(ts, i) === ',') { i++; continue; }
    const key = value(ts, i), token = ts[i + 2];
    if (!['identifier', 'string'].includes(ts[i]?.kind) || value(ts, i + 1) !== ':' || !token) return null;
    if (token.kind === 'string' && !token.escaped) result[key] = token.value;
    else if (/^\d+$/.test(token.value)) result[key] = Number(token.value);
    else if (['true', 'false', 'null'].includes(token.value)) result[key] = JSON.parse(token.value);
    else return null;
    i += 3;
  }
  return result;
}

/** Reopen in this module's own capability domain after toolkit relocation. */
export async function checkLivePayloadDrift({ proof, ...options }) {
  const livePayload = await reopenLivePayloadContext(proof, { source: options.privateRoot, revision: options.core });
  return checkPrivateDrift({ ...options, livePayload });
}

export async function checkPrivateDrift({ core = 'HEAD', privateRoot, coreRepo, privateRepo, privateCommit, livePayload } = {}) {
  const started = performance.now(), findings = [], tolerated = [];
  let revision = null, tree = null, privateRevision = null, privateTree = null;
  const add = (id, name, message, fixHint, extra = {}) => findings.push({ id, path: name, message, fixHint, ...extra });
  try {
    const selectedJSON = new Set(['tests/core-overlays.json', 'scripts/public-export/allowlist.json']);
    let privateFiles;
    if (privateRepo || privateCommit) {
      if (privateRoot || !path.isAbsolute(privateRepo ?? '') || !/^[a-f0-9]{40}$/.test(privateCommit ?? '')) throw Error('Choose an absolute private Git repository and exact 40-character commit, or a private source directory.');
      const requested = new Map([...selectedJSON, '.private-source/exclusions.json'].map(name => [name, null]));
      const pinned = readCore(privateCommit + '^{commit}', privateRepo, requested, privateRepo);
      if (pinned.revision !== privateCommit) throw Error('Exact private commit differs.');
      privateRevision = pinned.revision; privateTree = pinned.tree;
      let excluded = new Set();
      if (pinned.files.has('.private-source/exclusions.json')) {
        const rows = json(pinned.files.get('.private-source/exclusions.json'));
        if (!Array.isArray(rows) || rows.some(row => !safePath(row?.path))) throw Error('Private export exclusions are invalid.');
        excluded = new Set(rows.map(row => row.path));
      }
      privateFiles = new Map([...pinned.files].filter(([name]) => privateSourcePath(name) && !excluded.has(name)));
      privateRoot = path.resolve(privateRepo);
    } else {
      if (typeof privateRoot !== 'string' || !privateRoot) throw Error('A private source directory is required.');
      privateRoot = path.resolve(privateRoot);
      privateFiles = await inventory(privateRoot);
      for (const name of privateFiles.keys()) if (sourceFile(name) || selectedJSON.has(name)) privateFiles.set(name, await ordinary(path.join(privateRoot, name)));
    }
    const committed = readCore(core, coreRepo, privateFiles, privateRoot), coreFiles = committed.files;
    ({ revision, tree } = committed);
    let manifest;
    if (privateFiles.has('tests/core-overlays.json')) {
      try { manifest = json(privateFiles.get('tests/core-overlays.json')); }
      catch { manifest = null; }
    }
    let inventoryCapability;
    if (livePayload !== undefined) {
      // Only a reopened exact-live capability can change the introduced rules.
      // CLI and candidate staging have no way to supply this object.
      if (privateRepo || privateCommit) throw Error('Live payload context requires an exact directory input.');
      await assertLivePayloadTarget(livePayload, { source: privateRoot, revision });
      const review = reviewLivePayloadOverlays({ livePayload, manifest, coreFiles, privateFiles });
      findings.push(...review.findings); tolerated.push(...review.tolerated);
      const proof = livePayloadProof(livePayload);
      if (proof.tooling) inventoryCapability = await practiceInventoryCapability({ schema: 'rs3-practice-inputs-v1',
        kit: proof.tooling.kit, kitSha256: proof.tooling.kitSha256, coreRepo, livePayload: proof });
    } else findings.push(...reviewCoreOverlays({ manifest, coreFiles, privateFiles }));
    const permitted = new Set(['scripts/test.mjs', 'scripts/test-selection.mjs', 'scripts/adaptive-test-runner.mjs']);
    for (const name of privateFiles.keys()) if (coreFiles.has(name) && !name.startsWith('tests/') && !permitted.has(name)) add('private-overwrite', name,
      `Private ${name} would replace shared core source.`, 'Remove the private copy or move private behavior to an additive module.');
    const assembled = new Map([...coreFiles, ...privateFiles]), cache = new Map();
    const parsed = name => {
      if (!cache.has(name)) cache.set(name, tokens(assembled.get(name)?.toString('utf8') ?? ''));
      return cache.get(name);
    };
    // Follow actual private module imports from root tests. Unimported nested
    // fixtures may deliberately contain incomplete/invalid example programs.
    const pending = [...privateFiles.keys()].filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name)), visited = new Set();
    for (let next = 0; next < pending.length; next++) {
      const name = pending[next];
      if (visited.has(name)) continue;
      visited.add(name);
      const ts = parsed(name);
      for (const row of imports(ts)) {
        if (!row.specifier.startsWith('.')) continue;
        const target = resolveRelative(name, row.specifier);
        if (!target || !assembled.has(target)) add('import-missing', name, `Private import ${row.specifier} has no assembled source.`, 'Update this literal import to an existing core or private module.', { target: target ?? row.specifier });
        else if (sourceFile(target)) {
          if (privateFiles.has(target) && !visited.has(target)) pending.push(target);
          const exports = exportedNames(target, assembled, parsed);
          for (const imported of row.names) if (!exports.has(imported)) add('named-export-missing', name,
            `${target} no longer exports ${imported}, required by this private test.`, 'Port the private import and its uses to the current core interface.', { target, imported });
        }
      }
      for (let i = 0; i < ts.length; i++) if (value(ts, i) === 'new' && value(ts, i + 1) === 'URL' && value(ts, i + 2) === '(' && ts[i + 3]?.kind === 'string'
        && value(ts, i + 4) === ',' && value(ts, i + 5) === 'import' && value(ts, i + 6) === '.' && value(ts, i + 7) === 'meta' && value(ts, i + 8) === '.' && value(ts, i + 9) === 'url') {
        const literal = value(ts, i + 3);
        if (!literal.startsWith('.')) continue;
        const target = resolveRelative(name, literal);
        // Directory URLs are roots, not file fixtures. Files are presence-only.
        if (literal.endsWith('/') || ['.', '..'].includes(literal)) continue;
        if (!target || !assembled.has(target)) add('fixture-missing', name, `Literal fixture ${literal} is absent from the assembled tree.`, 'Restore the fixture or port this test to a current fixture.', { target: target ?? literal });
      }
    }
    const selector = 'scripts/test-selection.mjs';
    if (privateFiles.has(selector)) {
      const ts = parsed(selector);
      for (let i = 0; i < ts.length; i++) if (['quickTests', 'fullOnlyTests'].includes(value(ts, i)) && value(ts, i + 1) === '=') {
        const start = ts.findIndex((t, j) => j > i && t.value === '[');
        if (start < 0) continue;
        const end = close(ts, start);
        for (const token of ts.slice(start + 1, end)) if (token.kind === 'string' && token.value.endsWith('.test.mjs')) {
          const target = 'tests/' + token.value;
          if (!safePath(target) || !assembled.has(target)) {
            const reviewed = safePath(target) ? inventoryMissing([token.value], [], inventoryCapability) : { missing: [token.value], tolerated: [] };
            tolerated.push(...reviewed.tolerated);
            if (reviewed.missing.length) add('registered-test-missing', selector, `Registered test ${token.value} is absent from the assembled tree.`, 'Restore the test or remove its explicit registration.', { target });
          }
        }
        i = end;
      }
    }
    const allowlist = 'scripts/public-export/allowlist.json';
    if (privateFiles.has(allowlist)) {
      const policy = json(privateFiles.get(allowlist));
      if (!Array.isArray(policy.entries)) throw Error('Public export allowlist entries are invalid.');
      const missingEntry = target => add('public-export-missing', allowlist, `Public-export allowlist entry ${target} is absent from the assembled tree.`, 'Restore its core/private source or remove the obsolete export entry.', { target });
      for (const row of policy.entries) {
        if (!row || typeof row !== 'object') throw Error('Public export allowlist entry is invalid.');
        if (row.path !== undefined) {
          if (!safePath(row.path) || !assembled.has(row.path)) missingEntry(row.path);
        } else if (row.tree !== undefined) {
          if (row.tree !== 'app/datasets/open-f2p') throw Error('Public export tree selector is unsupported.');
          if (![...assembled.keys()].some(name => name.startsWith(row.tree + '/') && /(?:\.(?:json|mjs|md|txt)|\/(?:NOTICE|LICENSE))$/.test(name))) missingEntry(row.tree + '/');
        } else if (row.family !== undefined) {
          const family = { 'tests/open-f2p': /^tests\/open-f2p(?:[.-][\w.-]+)?\.test\.mjs$/, 'scripts/open-f2p': /^scripts\/(?:build|fetch)-open-f2p(?:[.-][\w.-]+)?\.mjs$/ }[row.family];
          if (!family) throw Error('Public export family selector is unsupported.');
          if (![...assembled.keys()].some(name => family.test(name))) missingEntry(row.family);
        } else if (typeof row.glob === 'string' && /^[\w/-]+\/\*\.[a-z0-9]+$/.test(row.glob) && Array.isArray(row.reviewedPaths)) {
          const [prefix, suffix] = row.glob.split('*');
          for (const name of row.reviewedPaths) {
            if (!safePath(name) || !name.startsWith(prefix) || !name.endsWith(suffix) || name.slice(prefix.length).includes('/')) throw Error('Public export reviewed glob path is invalid.');
            if (!assembled.has(name)) missingEntry(name);
          }
        } else throw Error('Public export allowlist selector is unsupported.');
      }
    }
    checkVmStubs({ privateFiles, coreFiles, parsed, add });
    const contractFile = 'app/datasets.mjs';
    if (coreFiles.has(contractFile)) {
      const ts = parsed(contractFile), index = ts.findIndex(t => t.value === 'DATASET_CONTRACT');
      const open = value(ts, index + 1) === '=' && value(ts, index + 2) === '{' ? index + 2
        : value(ts, index + 1) === '=' && ['Object', '.', 'freeze', '(', '{'].every((token, i) => value(ts, index + 2 + i) === token) ? index + 6 : -1;
      const contract = index >= 0 && open >= 0 ? literalObject(ts, open) : null;
      for (const name of privateFiles.keys()) if (/^scripts\/.*pack.*\.mjs$/.test(name)) {
        const pack = parsed(name);
        const artBuilder = name === 'scripts/build-art-pack.mjs';
        let requiresFound = false;
        for (let i = 0; i < pack.length; i++) if (value(pack, i) === 'requires' && value(pack, i + 1) === ':') {
          requiresFound = true;
          const pins = literalObject(pack, i + 2);
          if (artBuilder && (!contract || !pins)) add('pack-contract-unsupported', name,
            !contract ? 'Core DATASET_CONTRACT is not a supported literal contract.' : 'Private art pack requires pins are not a supported literal contract.',
            'Review the changed contract shape and port this static check before staging.', { target: contractFile });
          if (pins && contract) {
            const keys = new Set([...Object.keys(pins), ...(artBuilder ? ['corePackApi', 'datasetId', 'datasetContractVersion', 'coordinateSystem'] : [])]);
            for (const key of keys) if (!Object.hasOwn(contract, key) || pins[key] !== contract[key]) add('pack-contract-mismatch', name,
              `Private pack requires.${key} pins ${JSON.stringify(pins[key]) ?? 'nothing'}; core requires ${JSON.stringify(contract[key]) ?? 'nothing'}.`, 'Port the private builder to the current dataset contract before rebuilding packs.', { target: contractFile, key });
          }
        }
        if (artBuilder && !requiresFound) add('pack-contract-unsupported', name, 'Private art pack has no recognizable requires contract.', 'Restore the four reviewed literal art-pack requires pins.', { target: contractFile });
      }
    } else if (privateFiles.has('scripts/build-art-pack.mjs')) add('pack-contract-unsupported', 'scripts/build-art-pack.mjs',
      'Core dataset contract module is absent.', 'Port the private pack builder and this check to the new core contract location.', { target: contractFile });
  } catch (error) {
    add('input-invalid', '', error.message || 'Static inputs could not be inspected.', 'Supply ordinary private files and an existing Git core revision or tree.');
  }
  const unique = [...new Map(findings.map(row => [JSON.stringify(row), row])).values()];
  unique.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id) || a.message.localeCompare(b.message));
  return { passed: unique.length === 0, findings: unique, ...(livePayload !== undefined ? { tolerated } : {}), revision, tree, ...(privateRevision ? { privateRevision, privateTree } : {}), wallMs: Math.round(performance.now() - started) };
}

function checkVmStubs({ privateFiles, coreFiles, parsed, add }) {
  const name = 'tests/original-sync-web.test.mjs';
  if (!privateFiles.has(name)) return;
  const ts = parsed(name), selections = [];
  for (let i = 0; i < ts.length; i++) if (value(ts, i) === 'screenFunctionSource' && value(ts, i + 1) === '(' && value(ts, i + 3) === ',' && ts[i + 4]?.kind === 'string') selections.push(value(ts, i + 4));
  if (!selections.length) return;
  // Scope collaborator evidence to commandHarness: unrelated VMs cannot supply
  // this extracted function's bindings. Other fixture styles need a reviewed check.
  const harness = ts.findIndex((t, i) => t.value === 'function' && value(ts, i + 1) === 'commandHarness');
  const harnessOpen = harness < 0 ? -1 : ts.findIndex((t, i) => i > harness && t.value === '{');
  const scoped = harnessOpen < 0 ? [] : ts.slice(harnessOpen + 1, close(ts, harnessOpen));
  const provided = new Set(); let contexts = 0;
  for (let i = 0; i < scoped.length; i++) if (value(scoped, i) === 'createContext' && value(scoped, i + 1) === '(' && value(scoped, i + 2) === '{') {
    contexts++;
    const end = close(scoped, i + 2); let depth = 0;
    for (let j = i + 3; j < end; j++) {
      if (!depth && (j === i + 3 || value(scoped, j - 1) === ',') && ['identifier', 'string'].includes(scoped[j].kind)) provided.add(value(scoped, j));
      if (['{', '[', '('].includes(value(scoped, j))) depth++;
      if (['}', ']', ')'].includes(value(scoped, j))) depth--;
    }
  }
  if (contexts !== 1) {
    add('vm-stub-missing', name, 'The extracted screen function has no single recognizable commandHarness VM context.', 'Port this fixture to one explicit commandHarness createContext object.'); return;
  }
  for (const selected of selections) {
    let matched = 0;
    for (const coreName of coreFiles.keys()) {
    if (!/^app\/web\/(?:screen-[^/]+|main)\.mjs$/.test(coreName)) continue;
    const core = parsed(coreName), declarations = new Set();
    for (let i = 0; i < core.length - 1; i++) if (value(core, i) === 'function') declarations.add(value(core, i + 1));
    const imported = new Set(imports(core).flatMap(row => row.locals));
    for (let i = 0; i < core.length; i++) if (value(core, i) === 'function' && value(core, i + 1) === selected && value(core, i + 2) === '(') {
      matched++;
      const paramsEnd = close(core, i + 2), start = paramsEnd + 1;
      if (value(core, start) !== '{') continue;
      const end = close(core, start), required = new Set();
      for (let j = start + 1; j < end; j++) {
        const identifier = value(core, j);
        if (value(core, j - 1) === 'await' && identifier === 'c' && value(core, j + 1) === '.' && value(core, j + 3) === '(') required.add(value(core, j + 2));
        if (['.', '?.'].includes(value(core, j - 1))) continue;
        if (identifier === 'document' || imported.has(identifier) || value(core, j - 1) === 'await' && declarations.has(identifier) && identifier !== selected) required.add(identifier);
      }
      for (const dependency of required) if (!provided.has(dependency)) add('vm-stub-missing', name,
        `Extracted core ${selected} now needs ${dependency}, missing from the private VM context.`,
        `Port commandHarness to provide a reviewed ${dependency} stub matching ${coreName}.`, { target: coreName, function: selected, dependency });
    }
    }
    if (!matched) add('vm-stub-missing', name, `Extracted core screen function ${selected} is absent.`, 'Port this private harness to an existing shipped screen function.', { function: selected });
  }
}

export async function assertPrivateDriftForStaging({ source, privateRepo, privateCommit, coreRepo, coreRef } = {}) {
  if (!coreRepo && !coreRef && !privateRepo && !privateCommit) return { passed: true, skipped: true, reason: 'Legacy directory staging has no core identity.' };
  if ((privateRepo || privateCommit) && (!path.isAbsolute(coreRepo ?? '') || typeof coreRef !== 'string' || !coreRef)) {
    const error = new Error('Private source drift: paired Git staging requires a complete core repository/ref before private export.');
    error.privateDrift = true; throw error;
  }
  const report = await checkPrivateDrift({ core: coreRef ?? 'HEAD', privateRoot: source, privateRepo, privateCommit, coreRepo });
  if (!report.passed) {
    const error = new Error(`Private source drift: ${report.findings.map(row => `${row.path ? row.path + ': ' : ''}${row.message} ${row.fixHint}`).join('\n')}`);
    error.privateDrift = true; error.findings = report.findings; error.report = report; throw error;
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let asJSON = false;
  try {
    const options = {}, seen = new Set();
    for (let i = 2; i < process.argv.length; i++) {
      const flag = process.argv[i];
      if (flag === '--help') { console.log('Usage: check-private-drift.mjs --core <revision|tree|checkout> --private <directory> [--core-repo <repository>] [--json]'); process.exit(0); }
      if (seen.has(flag)) throw Error('Duplicate argument.'); seen.add(flag);
      if (flag === '--json') { asJSON = true; continue; }
      const key = { '--core': 'core', '--private': 'privateRoot', '--core-repo': 'coreRepo' }[flag];
      if (!key || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw Error('Arguments refused.');
      options[key] = process.argv[++i];
    }
    if (!options.core || !options.privateRoot) throw Error('--core and --private are required.');
    const report = await checkPrivateDrift(options);
    console.log(asJSON ? JSON.stringify(report) : [report.passed ? `Private drift check passed (${report.wallMs}ms).` : `Private drift check failed (${report.wallMs}ms):`, ...report.findings.map(row => `${row.id} ${row.path}: ${row.message} ${row.fixHint}`)].join('\n'));
    if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(asJSON ? JSON.stringify({ passed: false, findings: [{ id: 'input-invalid', path: '', message: error.message, fixHint: 'Use --help for supported arguments.' }] }) : error.message); process.exitCode = 1; }
}
