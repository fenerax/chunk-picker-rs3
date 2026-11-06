import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { constants, setPriority } from 'node:os';
import { moduleTokens } from './private-companion/tooling-module-graph.mjs';
import { affectedRules, globalTestChange, inertChange, ruleMatches } from './test-affected-rules.mjs';

export function feedbackOrder(files) {
  const early = ['browser-module-graph.test.mjs', 'server.test.mjs', 'storage-static.test.mjs'];
  const rank = file => early.indexOf(file) < 0 ? early.length : early.indexOf(file);
  return [...files].sort((a, b) => rank(a) - rank(b));
}

// Tokenization ignores comments, strings and regex bodies, and visits template
// interpolation code. No module is evaluated while constructing the graph.
function fileReferences(source) {
  const tokens = moduleTokens(source), references = [];
  const constant = start => {
    let i = start, depth = 0;
    while (tokens[i]?.value === '(') { depth++; i++; }
    const token = tokens[i++];
    if (!token || token.escaped || !(token.kind === 'string' || token.kind === 'template' && !token.value.includes('${'))) throw Error('Unresolved constant file load');
    while (depth-- > 0) if (tokens[i++]?.value !== ')') throw Error('Unresolved constant expression');
    if (![',', ')'].includes(tokens[i]?.value)) throw Error('Unresolved file-load expression');
    return { specifier: token.value, end: i };
  };
  const add = (token, options = {}) => {
    if (!token || token.escaped || token.kind !== 'string') throw Error('Unresolved module specifier');
    references.push({ specifier: token.value, kind: 'import', ...options });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'identifier') continue;
    if (t.value === 'import') {
      if (tokens[i + 1]?.value === '(') references.push({ ...constant(i + 2), kind: 'import' });
      else if (tokens[i + 1]?.kind === 'string') add(tokens[i + 1]);
    }
    if (t.value === 'from' && tokens[i + 1]?.kind === 'string') add(tokens[i + 1]);
    if (t.value === 'datasetJSON' && tokens[i + 1]?.value === '(') references.push({ ...constant(i + 2), kind: 'file', root: true });
    if (['require', 'createRequire', 'getBuiltinModule'].includes(t.value) && tokens[i + 1]?.value === '(') throw Error('Unmodeled module loader');
    if (['readFile', 'readFileSync', 'readdir', 'readdirSync'].includes(t.value) && tokens[i + 1]?.value === '(') {
      // The URL expression supplies its own module-relative edge below.
      if (!(tokens[i + 2]?.value === 'new' && tokens[i + 3]?.value === 'URL')) references.push({ ...constant(i + 2), kind: 'file', root: true, directory: t.value.startsWith('readdir') });
    }
    if (t.value === 'URL' && tokens[i - 1]?.value === 'new' && tokens[i + 1]?.value === '(') {
      const ref = constant(i + 2);
      if (/^[a-z][a-z\d+.-]*:/i.test(ref.specifier) && !ref.specifier.startsWith('file:')) continue;
      const base = tokens.slice(ref.end + 1, ref.end + 6).map(token => token.value).join('');
      if (tokens[ref.end]?.value !== ',' || base !== 'import.meta.url') throw Error('Unresolved file URL base');
      references.push({ ...ref, kind: 'file', directory: ref.specifier.endsWith('/') });
    }
  }
  return references;
}

export const moduleReferences = source => [...new Set(fileReferences(source).map(ref => ref.specifier))];

const repository = fileURLToPath(new URL('../', import.meta.url));
function resolveReference(file, ref) {
  const base = pathToFileURL(ref.root ? repository + path.sep : path.join(repository, file));
  const url = new URL(ref.specifier, base);
  // fileURLToPath applies Node's percent decoding and refuses encoded slashes.
  const target = path.relative(repository, fileURLToPath(url)).replaceAll('\\', '/');
  if (!target || target === '..' || target.startsWith('../') || path.isAbsolute(target)) throw Error('File reference outside repository');
  return target + (ref.directory ? '/' : '');
}

export function importGraph(sources) {
  const reverse = new Map(), uncertain = [];
  for (const [file, source] of sources) {
    let references;
    try { references = fileReferences(source); }
    catch { uncertain.push(file); continue; }
    for (const ref of references) {
      try {
        if (ref.kind === 'import' && isBuiltin(ref.specifier)) continue;
        if (ref.kind === 'import' && !/^(?:\.{1,2}\/|file:)/.test(ref.specifier)) throw Error('Unresolved package import');
        const target = resolveReference(file, ref);
        if (ref.kind === 'import' && !sources.has(target)) throw Error('Missing imported module');
        if (!reverse.has(target)) reverse.set(target, new Set());
        reverse.get(target).add(file);
      } catch { uncertain.push(file); }
    }
  }
  return { reverse, uncertain: [...new Set(uncertain)] };
}

export function selectAffected({ sources, graph, changed, tests, rules = affectedRules }) {
  const full = (uncertain = [], reason = 'Uncertain dependencies') => ({ files: [...new Set(tests)].sort(), uncertain, reason, full: true });
  // These decisions precede graph construction, including for an invalid graph.
  if (changed.some(globalTestChange)) return full([], 'Global test/data input');
  changed = changed.filter(file => !inertChange(file));
  if (!changed.length) return { files: [], uncertain: [] };
  graph ??= importGraph(sources);
  const { reverse, uncertain } = graph;
  // A lexical failure must never silently omit an importer. Such a checkout
  // still gets correct feedback, conservatively running the whole inventory.
  if (uncertain.length) return full(uncertain);
  const directories = [...reverse.keys()].filter(key => key.endsWith('/'));
  const selected = new Set();
  // A source node existing in the graph is not proof that any test covers it.
  // Every changed path must reach a feedback test or match a usable contract.
  for (const file of changed) {
    const visited = new Set([file]), pending = [file, ...directories.filter(dir => file.startsWith(dir))];
    for (let i = 0; i < pending.length; i++) for (const importer of reverse.get(pending[i]) ?? []) {
      if (!visited.has(importer)) { visited.add(importer); pending.push(importer); }
    }
    const matching = rules.filter(rule => ruleMatches(rule, file));
    const consumers = tests.filter(test => visited.has(`tests/${test}`) || matching.some(rule => rule.tests.test(test)));
    if (!consumers.length) return full([file], 'Changed path has no proven test coverage');
    for (const test of consumers) selected.add(test);
  }
  return { files: feedbackOrder([...selected].sort()), uncertain };
}

export async function affectedSelection({ cwd = fileURLToPath(new URL('../', import.meta.url)), base = 'origin/main' } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  // Missing base is an error, never an empty selection. Include index/worktree
  // changes as well as committed branch changes for the local pre-push check.
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const changed = [...new Set([...git(['diff', '--no-renames', '--name-only', '-z', mergeBase]).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))];
  const names = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.mjs']).split('\0').filter(Boolean);
  const sources = new Map();
  await Promise.all(names.map(async name => {
    try { sources.set(name, await readFile(path.join(cwd, name), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }));
  const existing = new Set(sources.keys());
  // Union old import edges for changed/deleted modules: deleting an import or
  // moving a module must not hide tests that depended on its previous version.
  for (const name of changed.filter(name => name.endsWith('.mjs'))) {
    let previous;
    try { previous = git(['show', `${mergeBase}:${name}`]); } catch { continue; }
    sources.set(name, (sources.get(name) ?? '') + '\n' + previous);
  }
  const { discoverTests } = await import('./test-selection.mjs');
  // Audit classification/ports, then include every test entrypoint in feedback,
  // including detector suites whose complete CI gate lives in another lane.
  await discoverTests(path.join(cwd, 'tests'), 'full');
  const tests = names.filter(name => /^tests\/[^/]+\.test\.mjs$/.test(name) && existing.has(name)).map(name => name.slice(6));
  return { ...selectAffected({ sources, changed, tests }), changed, mergeBase };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.find(arg => arg.startsWith('--base='))?.slice(7) ?? 'origin/main';
  if (args.some(arg => arg !== '--list' && arg !== '--test-concurrency=1' && !arg.startsWith('--base='))) throw Error('Usage: test-affected.mjs [--list] [--base=origin/main] [--test-concurrency=1]');
  if (!args.includes('--list')) setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  const selection = await affectedSelection({ base });
  console.log(`Affected: ${selection.files.length} files (${selection.changed.length} changed paths)`);
  if (selection.full) console.log(`Conservative full selection: ${selection.reason}.`);
  if (args.includes('--list')) console.log(selection.files.map(file => `tests/${file}`).join('\n'));
  else {
    const { runSelectedTests } = await import('./test.mjs');
    // The local check is deliberately sequential, including isolated native
    // node:test children (whose concurrency is always 1 in the adaptive runner).
    const cap = process.env.GITHUB_ACTIONS === 'true' && !args.includes('--test-concurrency=1') ? 6 : 1;
    await runSelectedTests(feedbackOrder(selection.files), { failFast: true, options: { minConcurrency: 1, maxConcurrency: cap, soloFirst: false } });
  }
}
