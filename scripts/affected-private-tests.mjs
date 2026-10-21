import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { classifyTest, selectTests } from './test-selection.mjs';

const slash = value => value.replaceAll('\\', '/');
const normalize = value => {
  const normalized = path.posix.normalize(slash(value));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Changed path must be repository-relative: ${value}`);
  }
  return normalized.replace(/^\.\//, '');
};

// Read-only exact diff, including both sides of moves by disabling rename
// detection. Never invoke a shell or infer a diff against a mutable branch name.
export function changedFilesFromDiff(coreRoot, diff) {
  if (typeof diff !== 'string' || !diff || diff.startsWith('-') || /[\0\r\n]/.test(diff)) throw new Error('A non-option core diff revision/range is required');
  const absolute = path.resolve(coreRoot), volume = path.parse(absolute).root;
  let current = volume;
  for (const component of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Input link refused: ${current}`);
  }
  if (realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) throw new Error('Core canonical path differs');
  return execFileSync('git', ['--no-optional-locks', '-C', absolute, 'diff', '--name-only', '-z', '--no-renames', diff, '--'],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean).map(normalize);
}

// Only statically traceable, single-owner leaf modules can narrow the full lane.
// Shared runtime/data/runner seams and unrecognized paths always retain it all.
const shared = /^(?:scripts\/|app\/(?:core|engine|server|workers?|rules|data|datasets|providers?|tasks)\/|app\/(?:engine|server|datasets|workers?|rules)[^/]*\.mjs$|app\/web\/(?:main|screen-[^/]+)\.mjs$|package(?:-lock)?\.json$|tests\/(?![^/]+\.test\.mjs$))/;
// Deliberately bounded import/export binding syntax. `export const` must never
// consume later statements while looking for a `from` clause. Unrecognized
// imports remain opaque, so unsupported syntax cannot silently narrow coverage.
function moduleEdges(source) {
  const specifiers = [];
  let indirectLoading = false;
  const bindings = String.raw`(?:[\w$]+\s*,\s*)?(?:\{[^{};]*\}|\*\s+as\s+[\w$]+|[\w$]+)`;
  const staticImports = new RegExp(String.raw`\bimport\s+(?:${bindings}\s+from\s*)?(['"])([^'"\r\n]+)\1`, 'g');
  const reexports = /\bexport\s+(?:\{[^{};]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*(['"])([^'"\r\n]+)\1/g;
  const literalImports = /\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g;
  let remainder = source;
  for (const pattern of [staticImports, reexports, literalImports]) {
    remainder = remainder.replace(pattern, (statement, quote, specifier) => {
      specifiers.push(specifier);
      // File/process/VM/module APIs can load code or fixtures through aliases.
      // Only ordinary assertion/test imports have a known non-loading role.
      if (specifier.startsWith('node:') && !/^node:assert(?:\/strict)?$/.test(specifier)
        && (specifier !== 'node:test' || /\*|\b(?:run|mock)\b/.test(statement))) indirectLoading = true;
      return '';
    });
  }
  return { specifiers, opaque: indirectLoading || /\bimport\b(?!\s*\.)|\b(?:require|getBuiltinModule)\s*\(/.test(remainder) };
}

async function noLinks(filename, { absent = false } = {}) {
  const absolute = path.resolve(filename), volume = path.parse(absolute).root;
  let current = volume;
  for (const component of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Input link refused: ${current}`); }
    catch (error) { if (absent && error.code === 'ENOENT') return; throw error; }
  }
  if ((await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error(`Input canonical path differs: ${absolute}`);
}

export async function affectedPrivateTests({ assemblyRoot, changedFiles = [], coreRoot, diff } = {}) {
  if (!assemblyRoot) throw new Error('assemblyRoot is required: use a disposable core plus private assembly');
  const root = path.resolve(assemblyRoot);
  await noLinks(path.join(root, 'tests'));
  const names = (await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.mjs'));
  for (const name of names) {
    const filename = path.join(root, 'tests', name);
    await noLinks(filename);
    if (!(await lstat(filename)).isFile()) throw new Error(`Test input must be a regular file: ${filename}`);
  }
  const all = selectTests(names, 'full'); // Unknown tests fail closed through the existing API.
  const fullOnly = all.filter(name => classifyTest(name) === 'full-only');
  const changes = [...new Set([...changedFiles.map(normalize), ...(diff ? changedFilesFromDiff(coreRoot ?? root, diff) : [])])].sort();
  for (const changed of changes) await noLinks(path.join(root, changed), { absent: true });
  const reasons = [];
  const full = reason => ({ mode: 'full', files: all.map(name => `tests/${name}`), fullOnlyFiles: fullOnly.map(name => `tests/${name}`), changedFiles: changes, reasons: [...reasons, reason] });
  if (!changes.length) return full('No changed files supplied; retain the whole full lane');
  for (const changed of changes) if (shared.test(changed)) return full(`Shared or runner seam: ${changed}`);

  const graph = new Map();
  const opaque = new Set();
  const unavailable = new Set();
  async function visit(relative) {
    if (graph.has(relative)) return;
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) throw new Error(`Dependency escapes assembly: ${relative}`);
    try {
      await noLinks(absolute);
      if (!(await lstat(absolute)).isFile()) { unavailable.add(relative); opaque.add(relative); graph.set(relative, []); return; }
      const source = await readFile(absolute, 'utf8');
      const edges = moduleEdges(source);
      const dependencies = edges.specifiers.filter(specifier => specifier.startsWith('.')).map(specifier => path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier)));
      // Runtime paths, computed imports and eval cannot be proven by the static
      // graph. Every test reaching one is conservatively included below.
      if (edges.opaque || edges.specifiers.some(specifier => !specifier.startsWith('.') && !specifier.startsWith('node:'))
        || /\b(?:eval|Function)\s*\(|\b(?:readFile(?:Sync)?|new\s+URL)\s*\(/.test(source)) opaque.add(relative);
      graph.set(relative, dependencies);
      for (const dependency of dependencies) {
        if (dependency.startsWith('../') || !dependency.endsWith('.mjs')) opaque.add(relative);
        else await visit(dependency);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      unavailable.add(relative); opaque.add(relative); graph.set(relative, []);
    }
  }
  for (const name of all) await visit(`tests/${name}`);
  const reaches = (start, target, seen = new Set()) => {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return (graph.get(start) ?? []).some(dependency => reaches(dependency, target, seen));
  };
  const selected = new Set();
  for (const changed of changes) {
    const owners = [...graph].filter(([, dependencies]) => dependencies.includes(changed));
    if (/^tests\/[^/]+\.test\.mjs$/.test(changed) && all.includes(path.posix.basename(changed))) {
      if (owners.length) return full(`Test is imported as a shared fixture: ${changed}`);
      if (classifyTest(path.posix.basename(changed)) === 'full-only') selected.add(changed);
      reasons.push(`Changed classified test: ${changed}`);
      continue;
    }
    if (!/^app\/web\/[^/]+\.mjs$/.test(changed) || !graph.has(changed) || unavailable.has(changed)) return full(`Unknown, missing or untraced path: ${changed}`);
    if (owners.length > 1) return full(`Shared module (${owners.length} direct owners): ${changed}`);
    const affected = fullOnly.filter(name => reaches(`tests/${name}`, changed));
    if (!affected.length) return full(`No proven full-only coverage: ${changed}`);
    for (const name of affected) selected.add(`tests/${name}`);
    reasons.push(`Static full-only dependents: ${changed}`);
  }
  if (opaque.size) {
    for (const name of fullOnly) if ([...opaque].some(dependency => reaches(`tests/${name}`, dependency))) selected.add(`tests/${name}`);
    reasons.push('Included every full-only test with runtime/computed dependencies');
  }
  return { mode: 'focused', files: [...selected].sort(), fullOnlyFiles: [...selected].sort(), changedFiles: changes, reasons };
}

export async function main(args = process.argv.slice(2)) {
  const options = { changedFiles: [] };
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--json') { json = true; continue; }
    if (!['--assembly', '--core', '--diff', '--changed'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--changed') options.changedFiles.push(value);
    else options[{ '--assembly': 'assemblyRoot', '--core': 'coreRoot', '--diff': 'diff' }[flag]] = value;
  }
  const result = await affectedPrivateTests(options);
  process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : result.files.join('\n') + (result.files.length ? '\n' : ''));
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
